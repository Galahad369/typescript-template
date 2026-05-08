/** @param {NS} ns */
export async function main(ns) {
  ns.disableLog("ALL");
  ns.ui.openTail();

  // Configuration
  const scriptTimer = 2000; // Tick interval (ms)
  const moneyKeep = 1000000; // Reserve capital failsafe
  const moneyKeepPercent = 0.01; // reserve at least 1% of current money (capped by moneyKeep)
  // 100k = 100,000
  // 1M = 1,000,000
  // 1B = 1,000,000,000
  // 100B = 100,000,000,000
  const stockBuyOver_Long = 0.6; // Buy long when forecast >= this
  const stockBuyUnder_Short = 0.4; // Buy short when forecast <= this
  const stockVolatility = 0.05; // Max volatility to trade
  const minSharePercent = 5; // Minimum shares as % of max
  const maxSharePercent = 1.0; // Maximum shares as % of max
  const sellThreshold_Long = 0.55; // Sell long when forecast < this
  const sellThreshold_Short = 0.4; // Sell short when forecast > this
  const shortUnlock = true; // Enable short selling (requires BN8 or SF8 lvl 2)
  const DEBUG = false; // Enable detailed logging
  const momentumShortWindow = 5; // ticks
  const momentumLongWindow = 30; // ticks
  const orderSlippage = 0.0025; // 0.25% price buffer for limit entry
  const stopBuffer = 0.01; // 1% stop loss buffer
  const orderTTL = 1000 * 60 * 30; // 30 minutes TTL for placed orders (ms)

  // Local registry to track our placed orders and timestamps so we can cancel stale ones
  const orderRegistry = new Map(); // key -> {stock, price, type, pos, ts, shares}

  // API access check
  function hasRequiredAccess() {
    try {
      return ns.stock.hasTixApiAccess() && ns.stock.has4SDataTixApi();
    } catch (e) {
      return false;
    }
  }

  // Format large numbers with proper notation
  function formatNumber(number) {
    if (Math.abs(number) < 1e-6) number = 0;
    return ns.format.number(number);
  }

  // Buy positions based on forecast and volatility
  function buyPositions(stock, use4S, priceHistory) {
    const position = ns.stock.getPosition(stock);
    const maxShares =
      ns.stock.getMaxShares(stock) * maxSharePercent - position[0];
    const maxSharesShort =
      ns.stock.getMaxShares(stock) * maxSharePercent - position[2];
    const askPrice = ns.stock.getAskPrice(stock);
    const forecast = use4S ? ns.stock.getForecast(stock) : null;
    const volatility = use4S ? ns.stock.getVolatility(stock) : null;
    const playerMoney = ns.getPlayer().money;
    const effectiveReserve = Math.min(moneyKeep, Math.floor(playerMoney * moneyKeepPercent));
    const commission = 100000;

    // Momentum fallback: compute simple moving averages when 4S is not available
    let momentumSignal = null; // 'buy' | 'sell' | null
    if (!use4S) {
      const hist = priceHistory[stock] || [];
      if (hist.length >= momentumLongWindow) {
        const shortSlice = hist.slice(-momentumShortWindow);
        const longSlice = hist.slice(-momentumLongWindow);
        const sma = (arr) => arr.reduce((s, v) => s + v, 0) / arr.length;
        const sSMA = sma(shortSlice);
        const lSMA = sma(longSlice);
        const rel = (sSMA - lSMA) / lSMA;
        if (rel > 0.01) momentumSignal = "buy";
        else if (rel < -0.01) momentumSignal = "sell";
      }
    }

    // Buy Long positions
    if (
      (use4S &&
        forecast >= stockBuyOver_Long &&
        volatility <= stockVolatility) ||
      (!use4S && momentumSignal === "buy")
    ) {
      const minShares = Math.max(1, Math.ceil(ns.stock.getMaxShares(stock) * (minSharePercent / 100)));
      if (playerMoney - effectiveReserve > ns.stock.getPurchaseCost(stock, minShares, "L")) {
        const shares = Math.min(
          Math.floor((playerMoney - effectiveReserve - commission) / askPrice),
          maxShares,
        );
        if (shares > 0) {
          if (use4S) {
            const placed = tryPlaceLimitOrder(
              stock,
              shares,
              askPrice * (1 + orderSlippage),
              "Limit Buy Order",
              "L",
            );
            if (!placed) {
              const boughtFor = ns.stock.buyStock(stock, shares);
              if (boughtFor > 0) {
                ns.print(
                  `✓ LONG\t${stock}\t${ns.format.number(shares)} @ ${formatNumber(boughtFor)}`,
                );
                cancelOppositeOrders(stock, "L");
                placeProtectiveStop(stock, shares, boughtFor, "L");
              }
            } else {
              // If limit placed, cancel opposite orders and place protective stop when filled (reconciled later)
              cancelOppositeOrders(stock, "L");
            }
          } else {
            const boughtFor = ns.stock.buyStock(stock, shares);
            if (boughtFor > 0) {
              ns.print(
                `✓ LONG\t${stock}\t${ns.format.number(shares)} @ ${formatNumber(boughtFor)}`,
              );
              cancelOppositeOrders(stock, "L");
              placeProtectiveStop(stock, shares, boughtFor, "L");
            }
          }
        }
      }
    }

    // Buy Short positions (if unlocked)
    if (
      shortUnlock &&
      ((use4S &&
        forecast <= stockBuyUnder_Short &&
        volatility <= stockVolatility) ||
        (!use4S && momentumSignal === "sell"))
    ) {
      const minSharesShort = Math.max(1, Math.ceil(ns.stock.getMaxShares(stock) * (minSharePercent / 100)));
      if (playerMoney - effectiveReserve > ns.stock.getPurchaseCost(stock, minSharesShort, "S")) {
        const shares = Math.min(
          Math.floor((playerMoney - effectiveReserve - commission) / askPrice),
          maxSharesShort,
        );
        if (shares > 0) {
          if (use4S) {
            const placed = tryPlaceLimitOrder(
              stock,
              shares,
              askPrice * (1 - orderSlippage),
              "Limit Sell Order",
              "S",
            );
            if (!placed) {
              const boughtFor = ns.stock.buyShort(stock, shares);
              if (boughtFor > 0) {
                ns.print(
                  `✓ SHORT\t${stock}\t${ns.format.number(shares)} @ ${formatNumber(boughtFor)}`,
                );
                cancelOppositeOrders(stock, "S");
                placeProtectiveStop(stock, shares, boughtFor, "S");
              }
            } else {
              cancelOppositeOrders(stock, "S");
            }
          } else {
            const boughtFor = ns.stock.buyShort(stock, shares);
            if (boughtFor > 0) {
              ns.print(
                `✓ SHORT\t${stock}\t${ns.format.number(shares)} @ ${formatNumber(boughtFor)}`,
              );
              cancelOppositeOrders(stock, "S");
              placeProtectiveStop(stock, shares, boughtFor, "S");
            }
          }
        }
      }
    }
  }

  // Sell positions if forecast crosses threshold
  function sellIfOutsideThreshold(stock, use4S, priceHistory) {
    const position = ns.stock.getPosition(stock);
    const forecast = use4S ? ns.stock.getForecast(stock) : null;
    const bidPrice = ns.stock.getBidPrice(stock);
    const askPrice = ns.stock.getAskPrice(stock);
    const commission = 100000;

    // Momentum fallback
    let momentumSignal = null;
    if (!use4S) {
      const hist = priceHistory[stock] || [];
      if (hist.length >= momentumLongWindow) {
        const shortSlice = hist.slice(-momentumShortWindow);
        const longSlice = hist.slice(-momentumLongWindow);
        const sma = (arr) => arr.reduce((s, v) => s + v, 0) / arr.length;
        const sSMA = sma(shortSlice);
        const lSMA = sma(longSlice);
        const rel = (sSMA - lSMA) / lSMA;
        if (rel > 0.01) momentumSignal = "buy";
        else if (rel < -0.01) momentumSignal = "sell";
      }
    }

    // Sell Long positions
    if (position[0] > 0) {
      const profit = position[0] * (bidPrice - position[1]) - 2 * commission;
      const roi = ((profit / (position[0] * position[1])) * 100).toFixed(1);

      if (DEBUG) {
        ns.print(
          `${stock} LONG forecast ${(forecast * 100).toFixed(1)}% | ${ns.format.number(position[0])} shares | profit: ${formatNumber(profit)} (${roi}%)`,
        );
      }

      if (
        (use4S && forecast < sellThreshold_Long) ||
        (!use4S && momentumSignal === "sell")
      ) {
        if (use4S) {
          const placed = tryPlaceLimitOrder(
            stock,
            position[0],
            bidPrice * (1 - orderSlippage),
            "Limit Sell Order",
            "L",
          );
          if (!placed) {
            const soldFor = ns.stock.sellStock(stock, position[0]);
            if (soldFor > 0)
              ns.print(
                `✗ SELL LONG\t${stock}\t${ns.format.number(position[0])} @ ${formatNumber(soldFor)} (profit: ${formatNumber(profit)})`,
              );
          } else {
            // placed a sell limit — remove any protective stops
            const orders = getMyOrders();
            (orders[stock] || []).forEach((o) => {
              if (o.position === "L" && o.type === "Stop Sell Order")
                tryCancelOrder(stock, o.shares, o.price, o.type, o.position);
            });
          }
        } else {
          const soldFor = ns.stock.sellStock(stock, position[0]);
          if (soldFor > 0)
            ns.print(
              `✗ SELL LONG\t${stock}\t${ns.format.number(position[0])} @ ${formatNumber(soldFor)} (profit: ${formatNumber(profit)})`,
            );
        }
      }
    }

    // Sell Short positions (if unlocked)
    if (shortUnlock && position[2] > 0) {
      const profit =
        position[2] * Math.abs(position[3] - askPrice) - 2 * commission;
      const roi = ((profit / (position[2] * position[3])) * 100).toFixed(1);

      if (DEBUG) {
        ns.print(
          `${stock} SHORT forecast ${(forecast * 100).toFixed(1)}% | ${ns.format.number(position[2])} shares | profit: ${formatNumber(profit)} (${roi}%)`,
        );
      }
      if (
        (use4S && forecast > sellThreshold_Short) ||
        (!use4S && momentumSignal === "buy")
      ) {
        if (use4S) {
          const placed = tryPlaceLimitOrder(
            stock,
            position[2],
            askPrice * (1 + orderSlippage),
            "Limit Buy Order",
            "S",
          );
          if (!placed) {
            const soldFor = ns.stock.sellShort(stock, position[2]);
            if (soldFor > 0)
              ns.print(
                `✗ SELL SHORT\t${stock}\t${ns.format.number(position[2])} @ ${formatNumber(soldFor)} (profit: ${formatNumber(profit)})`,
              );
          } else {
            // remove protective stops for short
            const orders = getMyOrders();
            (orders[stock] || []).forEach((o) => {
              if (o.position === "S" && o.type === "Stop Buy Order")
                tryCancelOrder(stock, o.shares, o.price, o.type, o.position);
            });
          }
        } else {
          const soldFor = ns.stock.sellShort(stock, position[2]);
          if (soldFor > 0)
            ns.print(
              `✗ SELL SHORT\t${stock}\t${ns.format.number(position[2])} @ ${formatNumber(soldFor)} (profit: ${formatNumber(profit)})`,
            );
        }
      }
    }
  }

  // Calculate total portfolio value
  function getPortfolioValue() {
    let totalValue = 0;
    const stocks = ns.stock.getSymbols();

    for (const stock of stocks) {
      const position = ns.stock.getPosition(stock);
      const bidPrice = ns.stock.getBidPrice(stock);
      const askPrice = ns.stock.getAskPrice(stock);

      // Long position value
      const longValue = position[0] * bidPrice - (position[0] > 0 ? 100000 : 0);
      // Short position value (calculate loss/gain)
      const shortValue =
        position[2] * (position[3] - askPrice) - (position[2] > 0 ? 100000 : 0);

      totalValue += longValue + shortValue;
    }

    return totalValue;
  }

  // Order helpers
  function getMyOrders() {
    try {
      return ns.stock.getOrders();
    } catch (e) {
      return {};
    }
  }

  function hasOrder(stock, price, type, position) {
    const orders = getMyOrders();
    if (!orders[stock]) return false;
    return orders[stock].some(
      (o) => o.price === price && o.type === type && o.position === position,
    );
  }

  function tryPlaceLimitOrder(
    stock,
    shares,
    price,
    orderTypeLabel,
    positionType,
  ) {
    try {
      // Avoid duplicate identical orders
      if (hasOrder(stock, price, orderTypeLabel, positionType)) return true;
      const ok = ns.stock.placeOrder(
        stock,
        Math.round(shares),
        price,
        orderTypeLabel,
        positionType,
      );
      if (ok) {
        const key = `${stock}|${price}|${orderTypeLabel}|${positionType}`;
        orderRegistry.set(key, {
          stock,
          price,
          type: orderTypeLabel,
          pos: positionType,
          ts: Date.now(),
          shares: Math.round(shares),
        });
        ns.print(
          `✦ ORDER PLACED ${orderTypeLabel} ${positionType}\t${stock}\t${ns.format.number(Math.round(shares))} @ ${formatNumber(price)}`,
        );
        return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  function tryCancelOrder(stock, shares, price, orderTypeLabel, positionType) {
    try {
      ns.stock.cancelOrder(
        stock,
        Math.round(shares),
        price,
        orderTypeLabel,
        positionType,
      );
      const key = `${stock}|${price}|${orderTypeLabel}|${positionType}`;
      orderRegistry.delete(key);
      ns.print(
        `✗ ORDER CANCELED ${orderTypeLabel} ${positionType}\t${stock}\t${ns.format.number(Math.round(shares))} @ ${formatNumber(price)}`,
      );
      return true;
    } catch (e) {
      return false;
    }
  }

  function reconcileOrders() {
    // Remove registry entries that no longer show in actual orderbook, or that are stale
    const orders = getMyOrders();
    const now = Date.now();
    for (const [key, meta] of Array.from(orderRegistry.entries())) {
      const { stock, price, type, pos, ts } = meta;
      const found = (orders[stock] || []).some(
        (o) => o.price === price && o.type === type && o.position === pos,
      );
      if (!found || now - ts > orderTTL) {
        orderRegistry.delete(key);
        if (found && now - ts > orderTTL) {
          // cancel it on exchange if still present and stale
          tryCancelOrder(stock, meta.shares || 1, price, type, pos);
        }
      }
    }
  }

  function cancelOppositeOrders(stock, keepPositionType) {
    // Cancel any orders for stock that are opposite of keepPositionType ("L" or "S")
    const orders = getMyOrders();
    if (!orders[stock]) return;
    for (const o of orders[stock]) {
      if (o.position !== keepPositionType) {
        tryCancelOrder(stock, o.shares, o.price, o.type, o.position);
      }
    }
  }

  function placeProtectiveStop(stock, shares, entryPrice, positionType) {
    // For long: place Stop Sell at entryPrice * (1 - stopBuffer)
    // For short: place Stop Buy at entryPrice * (1 + stopBuffer)
    const stopPrice =
      positionType === "L"
        ? entryPrice * (1 - stopBuffer)
        : entryPrice * (1 + stopBuffer);
    const orderTypeLabel =
      positionType === "L" ? "Stop Sell Order" : "Stop Buy Order";
    // Ensure we don't place orders that would exceed the stock's max shares when combined with existing orders
    const maxShares = ns.stock.getMaxShares(stock);
    const orders = getMyOrders();
    const outstanding = (orders[stock] || []).reduce((s, o) => s + (o.position === positionType ? o.shares : 0), 0);
    let allowed = Math.max(0, maxShares - outstanding);
    if (shares > allowed) {
      ns.print(
        `WARN: Reducing protective stop for ${stock} from ${ns.format.number(shares)} to ${ns.format.number(allowed)} because of max shares limit`,
      );
      shares = allowed;
    }

    if (shares <= 0) return false;

    if (positionType === "S") {
      // For short protective buy order we must ensure we have funds to cover buyback
      const playerMoney = ns.getPlayer().money;
      const effectiveReserve = Math.min(moneyKeep, Math.floor(playerMoney * moneyKeepPercent));
      const costToCover = ns.stock.getPurchaseCost(stock, shares, "L");
      if (playerMoney - effectiveReserve < costToCover) {
        ns.print(
          `WARN: Skipping protective Stop Buy for ${stock} @ ${formatNumber(stopPrice)} — insufficient funds to cover ${ns.format.number(shares)} shares (need ${formatNumber(costToCover)}, have ${formatNumber(playerMoney - effectiveReserve)})`,
        );
        return false;
      }
    }

    return tryPlaceLimitOrder(stock, shares, stopPrice, orderTypeLabel, positionType);
  }

  // Check API access
  const use4S = hasRequiredAccess();
  if (!use4S) {
    ns.tprint(
      "WARN: Missing TIX API or 4S Data TIX API access. Falling back to momentum trading.",
    );
  }

  ns.print("=== STOCK TRADER INITIALIZED ===");
  ns.print(
    `Forecast thresholds: Long=${(stockBuyOver_Long * 100).toFixed(0)}% | Short=${(stockBuyUnder_Short * 100).toFixed(0)}%`,
  );
  ns.print(`Max volatility: ${(stockVolatility * 100).toFixed(2)}%`);
  ns.print(
    `Sell thresholds: Long=${(sellThreshold_Long * 100).toFixed(0)}% | Short=${(sellThreshold_Short * 100).toFixed(0)}%`,
  );
  ns.print(`Reserve capital: ${formatNumber(moneyKeep)}`);
  ns.print(`Shorts enabled: ${shortUnlock}`);
  ns.print("==================================");
  ns.print("");

  // Main loop
  // price history store for momentum fallback (persist across ticks)
  const priceHistory = {};
  // Main loop
  while (true) {

    // Get stocks sorted by forecast strength (closest to 0 or 1)
    const symbols = ns.stock.getSymbols();
    const orderedStocks = use4S
      ? symbols.sort(
          (a, b) =>
            Math.abs(0.5 - ns.stock.getForecast(b)) -
            Math.abs(0.5 - ns.stock.getForecast(a)),
        )
      : symbols.slice();

    let portfolioValue = 0;
    ns.print("─".repeat(60));

    for (const stock of orderedStocks) {
      const position = ns.stock.getPosition(stock);

      // sample price for history
      const price = ns.stock.getAskPrice(stock);
      if (!priceHistory[stock]) priceHistory[stock] = [];
      priceHistory[stock].push(price);
      if (priceHistory[stock].length > momentumLongWindow) {
        priceHistory[stock].shift();
      }

      // Process existing positions
      if (position[0] > 0 || position[2] > 0) {
        sellIfOutsideThreshold(stock, use4S, priceHistory);
      }

      // Look for new positions
      buyPositions(stock, use4S, priceHistory);
    }

    // Reconcile tracked orders with exchange and remove stale ones
    reconcileOrders();

    // Output status
    portfolioValue = getPortfolioValue();
    const totalWealth = portfolioValue + ns.getPlayer().money;

    ns.print("─".repeat(60));
    ns.print(
      `Portfolio value: ${formatNumber(portfolioValue)} | Total wealth: ${formatNumber(totalWealth)}`,
    );
    ns.print(`Time: ${new Date().toLocaleTimeString()} | Running...`);
    ns.print("");

    await ns.sleep(scriptTimer);
  }
}
