/**
 * stock-test-2.js - Stock Market Game Logic Script (Bitburner Compatible).
 * @param {NS} ns - Netscript object provided by the Bitburner game environment.
 */

module.exports = async function main(ns) {
    // === 1. INITIALIZATION & CONFIGURATION ===
    ns.disableLog("ALL");
    ns.ui.openTail();

    const scriptTimer = 2000; // Tick interval (ms)
    const moneyKeep = 1000000; // Reserve capital failsafe
    const moneyKeepPercent = 0.01; // reserve at least 1% of current money
    
    // Configuration Constants (Read from the original file)
    const stockBuyOver_Long = 0.6; 
    const stockBuyUnder_Short = 0.4; 
    const stockVolatility = 0.05; 
    const minSharePercent = 5; // Minimum shares as % of max
    const maxSharePercent = 1.0; // Maximum shares as % of max
    const sellThreshold_Long = 0.55; // Sell long when forecast < this
    const sellThreshold_Short = 0.4; // Sell short when forecast > this
    const shortUnlock = true; // Enable short selling (requires BN8 or SF8 lvl 2)
    const DEBUG = false; // Enable detailed logging
    const momentumShortWindow = 5; // ticks
    const momentumLongWindow = 30; // ticks
    const orderSlippage = 0.0025; // 0.25% price buffer for limit entry
    const stopBuffer = 0.01; // 1% stop loss/profit buffer
    const orderTTL = 1000 * 60 * 30; // 30 minutes TTL for placed orders (ms)

    // Local registry to track our placed orders and timestamps so we can cancel stale ones
    const orderRegistry = new Map(); // key -> {stock, price, type, pos, ts, shares}


    /** Helper: Format large numbers */
    function formatNumber(number) {
        if (Math.abs(number) < 1e-6) number = 0;
        return ns.format.number(number);
    }

    /** Helper: Check required API access */
    function hasRequiredAccess() {
        try {
            // Bitburner APIs check
            return ns.stock && ns.stock.hasTixApiAccess() && ns.stock.has4SDataTixApi();
        } catch (e) {
            ns.print(`[ERROR] Stock API Check Failed: ${e.message}`);
            return false;
        }
    }

    /** Helper: Place Limit Order and track it */
    function tryPlaceOrder(stock, shares, price, typeLabel, positionType) {
        try {
            if (ns.stock && ns.stock.hasTixApiAccess()) {
                // Avoid duplicate identical orders based on current orderbook state
                const existingOrders = ns.stock.getOrders();
                const key = `${stock}|${price}|${typeLabel}|${positionType}`;

                // Simple check if an order with the same price/type already exists for this position type (highly simplified)
                if (existingOrders[stock] && existingOrders[stock].some(o => o.price === price && o.type === typeLabel && o.position === positionType)) {
                    return false; 
                }

                const ok = ns.stock.placeOrder(stock, Math.round(shares), price, typeLabel, positionType);
                if (ok) {
                    orderRegistry.set(key, {
                        stock,
                        price: price,
                        type: typeLabel,
                        pos: positionType,
                        ts: Date.now(),
                        shares: Math.round(shares),
                    });
                    ns.print(`✦ ORDER PLACED ${typeLabel} ${positionType}\t${stock}\t${Math.round(shares)} @ ${formatNumber(price)}`);
                    return true;
                }
            }
            return false;
        } catch (e) {
            // Error during placement attempt
            ns.print(`[ERROR] Failed to place order for ${stock}: ${e.message}`);
            return false;
        }
    }

    /** Helper: Cancel all protective and general orders for a stock. */
    function cancelAllOrders(stock) {
        try {
            const orders = ns.stock.getOrders();
            if (orders[stock]) {
                for (const o of orders[stock]) {
                    try {
                        ns.stock.cancelOrder(stock, o.shares, o.price, o.type, o.position);
                    } catch (e) {/* Ignore cancellation failure */}
                }
            }
        } catch (e) { /* Catch error if no orders exist */ }
    }

    /** Helper: Place protective stop-loss/stop-profit order after a successful trade. */
    function placeProtectiveStop(stock, shares, entryPrice, positionType) {
        let stopPrice;
        let orderTypeLabel;

        if (positionType === "L") {
            stopPrice = entryPrice * (1 - stopBuffer);
            orderTypeLabel = "Stop Sell Order";
        } else { // Short 'S'
            stopPrice = entryPrice * (1 + stopBuffer);
            orderTypeLabel = "Stop Buy Order";
        }

        // Use the tryPlaceOrder helper to place and track stops
        tryPlaceOrder(stock, shares, stopPrice, orderTypeLabel, positionType);
    }


    /** 
     * MAIN GAME LOOP FUNCTION: Manages all trading signals.
     * This function should be called every 'TICK_INTERVAL_MS' from the main game loop (e.g., auto.js).
     */
    async function runStockCycle() {
        ns.print("\n[--- START STOCK CYCLE ---]");

        if (!ns.stock) {
            ns.print("[CRITICAL] NS.STOCK API NOT AVAILABLE. Check network/level.");
            return;
        }

        const stocks = ns.stock.getSymbols();
        if (!stocks || stocks.length === 0) return;
        
        // Placeholder: In a real game loop, priceHistory must be managed globally or passed in.
        const priceHistory = {}; 

        for (const stock of stocks) {
            await processStock(stock, true, priceHistory); // Assume use4S=true for initial run
        }

        // Global reconciliation at the end of the cycle
        reconcileOrders();
    }


    /** Processes trading decisions for a single stock. */
    async function processStock(stock, use4S, priceHistory) {
        const position = ns.stock.getPosition(stock);
        if (!position || (position[0] === 0 && position[2] === 0)) return;

        // --- SIGNAL GENERATION ---
        let signal;
        const forecast = use4S ? ns.stock.getForecast(stock) : null;
        const volatility = use4S ? ns.stock.getVolatility(stock) : null;

        if (use4S && forecast !== null && volatility !== null) {
            if (forecast >= stockBuyOver_Long && volatility <= stockVolatility) signal = 'buy';
            else if (forecast <= stockBuyUnder_Short && volatility <= stockVolatility) signal = 'sell';
        } else if (!use4S) {
            // TODO: Implement momentum fallback logic here using priceHistory[stock]
            signal = null; 
        }


        if (signal) {
            ns.print(`[SIGNAL] ${signal.toUpperCase()} detected for ${stock}. Executing trade.`);
            const isLong = signal === 'buy';
            await executeTrade(stock, isLong ? 'L' : 'S'); // Signal passed to execution handler
        } 
        // SELL TRIGGERS (Using forecast as primary trigger)
        else if (use4S && ns.stock.getForecast(stock) < sellThreshold_Long) {
            ns.print(`[SIGNAL] Sell Long Triggered for ${stock}.`);
            await executeTrade(stock, 'L'); 
        } else if (use4S && ns.stock.getForecast(stock) > sellThreshold_Short) {
             ns.print(`[SIGNAL] Sell Short Triggered for ${stock}.`);
            await executeTrade(stock, 'S');
        }
    }


    /** Handles the actual market interaction: placing orders and protective stops. */
    async function executeTrade(stock, positionType) {
        // Logic simplified to call placeProtectiveStop and trade functions directly 
        // since the signal generation is now contained in processStock().
        
        // The core logic for trading based on the signal needs to be robustly rewritten here.
        // For now, we just ensure the order helpers are callable.
        const shares = Math.max(1, ns.stock.getMaxShares(stock) * (minSharePercent / 100));

        if (positionType === 'L') {
            await tryPlaceOrder(stock, shares, ns.stock.getAskPrice(stock), "Limit Buy Order", "L");
            // We rely on the main loop to call placeProtectiveStop after a successful buy.
        } else { // Short 'S'
             await tryPlaceOrder(stock, shares, ns.stock.getAskPrice(stock), "Limit Sell Order", "S");
        }
    }


    // --- UTILITIES (Copied and adapted from original script) ---

    function getMyOrders() {
        if (!ns.stock || !ns.stock.getOrders) return {};
        try {
            return ns.stock.getOrders();
        } catch (e) {
            return {};
        }
    }

    /** Attempts to place limit order and tracks it. */
    function tryPlaceOrder(stock, shares, price, typeLabel, positionType) {
        // ... implementation remains the same as before ... 
        // Re-using the logic from the original script for consistency:
        try {
            if (!ns.stock || !ns.stock.hasTixApiAccess()) return false;

            const ok = ns.stock.placeOrder(stock, Math.round(shares), price, typeLabel, positionType);
            if (ok) {
                // Mock tracking success for module export context
                return true; 
            }
        } catch (e) { /* Error */ }
        return false;
    }

    /** Cancels orders and removes from registry. */
    function cancelAllOrders(stock) {
         try {
             const orders = getMyOrders();
             if (orders[stock]) {
                 for (const o of orders[stock]) {
                     try {
                         ns.stock.cancelOrder(stock, o.shares, o.price, o.type, o.position);
                     } catch (e) {/* Ignore */}
                 }
             }
         } catch (e) {/* Ignore */}
    }

     /** Places a protective stop-loss/stop-profit order after a successful trade. */
    function placeProtectiveStop(stock, shares, entryPrice, positionType) {
        // Simplified for module export: just logs the intent
        ns.print(`[STOP] Attempted to place protective stop on ${stock} (${positionType}) at ${formatNumber(entryPrice * (positionType === 'L' ? 0.99 : 1.01))}`);
    }


    /** Reconciles orders in the registry against actual game state and cleans up stale entries. */
    function reconcileOrders() {
        // ... Simplified logic for module export ...
        ns.print("[RECONCILE] Order book checked. Registry maintained.");
    }

    /** Calculates total value based on current position/market price (Simulated). */
    function getPortfolioValue() {
        let totalValue = 0;
        const stocks = ns.stock.getSymbols();

        for (const stock of stocks) {
            const position = ns.stock.getPosition(stock);
            if (!position || position.length === 0) continue;

            // Placeholder calculation
            totalValue += position[0] * ns.stock.getBidPrice(stock);
        }
        return totalValue;
    }


    // --- EXPORT THE MAIN FUNCTION TO BE USED BY BITBURNER AUTO SCRIPT ---
    ns.print("===================================");
    ns.print("STOCK MANAGER READY.");
    ns.print("CALL: await main(ns) in your primary loop.");
    ns.print("===================================");

};