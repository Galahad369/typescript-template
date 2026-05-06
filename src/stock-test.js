/** @param {NS} ns **/
export async function main(ns) {
  ns.disableLog("ALL");

  const DEBUG = false; // Set to true for detailed trade logging
  const commission = 100000; // fixed 100k commission
  const tradeCommission = 2 * commission; // buy + sell transactions
  let overallValue = 0; // total value of held positions
  let totalLifetimeProfit = 0; // track all-time profit
  const forecastLong = 0.55; // buy/hold long above this
  const forecastShort = 0.45; // buy/hold short below this
  const minCashRatio = 0.2; // keep at least 20% of portfolio as cash
  const dropThreshold = -0.2; // sell 80% if drops 20%
  const riseThreshold = 0.2; // buy more if rises 20%
  const stopLossImmediate = -0.15; // immediate full exit if loss exceeds 15%
  const tickDuration = 5 * 1000; // ~4s offline, ~6s online (5s compromise)
  const STRATEGY = ns.args[0] || "aggressive"; // '2080' | 'aggressive' | 'diversify'
  const baseAllocation = 0.2; // base fraction of available cash to allocate per new stock
  let portfolioAllocationPerStock = baseAllocation; // may be adapted each loop based on volatility
  const baseMaxPositions = 6; // base max concurrent long/short positions
  let maxPositions = baseMaxPositions; // may be adapted each loop based on volatility
  const aggressivePriceRise = 0.1; // consider scaling/buying if price rose 10%
  const diversifyCount = 6; // buy top-N stocks when using 'diversify'
  const accessCheckInterval = 60 * 1000; // 1 minute
  let lastAccessCheck = 0;
  const enableShorts = false; // Set to true only if you have BN8 or SF8 lvl 2

  function hasRequiredAccess() {
    return ns.stock.hasTixApiAccess() && ns.stock.has4SDataTixApi();
  }

  function canAffordPurchase(cost, money, stocksValue) {
    // Ensure: cash_after >= 20% of total_portfolio
    // money - cost >= minCashRatio * (money - cost + stocksValue)
    // Rearranged: money >= cost + (minCashRatio / (1 - minCashRatio)) * stocksValue
    const minCashRequired = (minCashRatio / (1 - minCashRatio)) * stocksValue;
    // Also account for the commission that will be charged when making the
    // purchase. Require commission + cost + reserve to be available.
    const canAfford = money >= cost + commission + minCashRequired;
    return canAfford;
  }

  function getStonks() {
    const stockSymbols = ns.stock.getSymbols();
    const stocks = [];
    let totalStockValue = 0;
    for (const sym of stockSymbols) {
      const pos = ns.stock.getPosition(sym); // [longShares, longPrice, shortShares, shortPrice]
      const stock = {
        sym,
        longShares: pos[0],
        longPrice: pos[1],
        shortShares: pos[2],
        shortPrice: pos[3],
        forecast: ns.stock.getForecast(sym),
        volatility: ns.stock.getVolatility(sym),
        askPrice: ns.stock.getAskPrice(sym),
        bidPrice: ns.stock.getBidPrice(sym),
        maxShares: ns.stock.getMaxShares(sym),
      };
      // Unrealized profit (do NOT subtract commissions here — commissions
      // are applied when the trade is executed). Keeping unrealized profit
      // free of transaction fees prevents double-counting losses each loop.
      const longProfit = stock.longShares * (stock.bidPrice - stock.longPrice);
      const shortProfit =
        stock.shortShares * (stock.shortPrice - stock.askPrice);
      stock.profit = longProfit + shortProfit;

      const longCost = stock.longShares * stock.longPrice;
      const shortCost = stock.shortShares * stock.shortPrice;
      stock.cost = longCost + shortCost;
      totalStockValue += stock.cost;

      // 0.6 -> 0.1 (10% - LONG), 0.4 -> 0.1 (10% - SHORT)
      const profitChance = Math.abs(stock.forecast - 0.5); // chance to make profit for either positions
      stock.profitPotential = stock.volatility * profitChance; // potential to get the price movement

      stock.summary = `${stock.sym}: ${stock.forecast.toFixed(3)} +/- ${stock.volatility.toFixed(3)}`;
      stocks.push(stock);
    }

    // Sort by profit potential
    stocks.sort((a, b) => b.profitPotential - a.profitPotential);
    stocks.totalValue = totalStockValue;
    return stocks;
  }

  function logHold(stock, label) {
    if (stock.cost <= 0) return;
    const curValue = stock.cost + stock.profit;
    const roi = (100 * (stock.profit / stock.cost)).toFixed(2);
    ns.print(
      `INFO\t ${stock.summary} ${label} ${ns.format.number(curValue, "0a")} ${roi}%`,
    );
    // overallValue reflects current portfolio valuation. Do NOT add
    // unrealized profit to totalLifetimeProfit here — that would double-
    // count the same unrealized P/L across iterations.
    overallValue += curValue;
  }

  function sellLong(stock) {
    const shares = stock.longShares;
    if (shares <= 0) return;
    const salePrice = ns.stock.sellStock(stock.sym, shares);
    if (salePrice <= 0) return;
    const saleTotal = salePrice * shares;
    const saleCost = stock.longPrice * shares;
    // Subtract single transaction commission for the sell
    const saleProfit = saleTotal - saleCost - commission;
    totalLifetimeProfit += saleProfit;
    ns.print(
      `WARN\t${stock.summary} SOLD LONG ${ns.format.number(shares, "0a")} for ${ns.format.number(saleProfit, "0a")} profit`,
    );
  }

  function sellShort(stock) {
    if (!enableShorts) return;
    const shares = stock.shortShares;
    if (shares <= 0) return;
    const salePrice = ns.stock.sellShort(stock.sym, shares);
    if (salePrice <= 0) return;
    const saleTotal = salePrice * shares;
    const saleCost = stock.shortPrice * shares;
    // For shorts, profit is (entryPrice - salePrice) * shares
    const saleProfit = saleCost - saleTotal - commission;
    totalLifetimeProfit += saleProfit;
    ns.print(
      `WARN\t${stock.summary} SOLD SHORT ${ns.format.number(shares, "0a")} for ${ns.format.number(saleProfit, "0a")} profit`,
    );
  }

  function takeTendies(stocks) {
    // 2080 Strategy:
    // - If price drops 20% from entry → SELL 80% (keep 20% for recovery hope)
    // - If price rises 20% from entry → BUY MORE (scale into winners)
    // - Otherwise HOLD and let it run
    for (const stock of stocks) {
      if (stock.longShares > 0) {
        const entryPrice = stock.longPrice;
        const currentPrice = stock.bidPrice;
        const priceChangePercent = (currentPrice - entryPrice) / entryPrice;

        // Immediate full exit for severe loss before partial 80% rule
        if (priceChangePercent <= stopLossImmediate) {
          ns.print(
            `STOP_IMMEDIATE\t${stock.summary} dropped ${(priceChangePercent * 100).toFixed(2)}% - SELLING ALL to limit loss`,
          );
          sellLong(stock);
          continue;
        }

        if (priceChangePercent <= dropThreshold) {
          // Dropped 20%+ → SELL 80% to cut losses
          const sharesToSell = Math.floor(stock.longShares * 0.8);
          if (sharesToSell > 0) {
            const salePrice = ns.stock.sellStock(stock.sym, sharesToSell);
            if (salePrice > 0) {
              const saleTotal = salePrice * sharesToSell;
              const saleCost = entryPrice * sharesToSell;
              const saleProfit = saleTotal - saleCost - commission;
              totalLifetimeProfit += saleProfit;
              ns.print(
                `SELL_80%\t${stock.summary} dropped ${(priceChangePercent * 100).toFixed(1)}% - sold ${sharesToSell} shares (${ns.format.number(saleProfit, "0a")} profit)`,
              );
            }
          }
        } else if (priceChangePercent >= riseThreshold) {
          // Mark for buying more in yolo() instead of selling
          stock.shouldBuyMore = true;
          const curValue = stock.longShares * currentPrice - commission;
          const roi = (100 * priceChangePercent).toFixed(2);
          ns.print(
            `HOLD_BUY\t${stock.summary} up ${roi}% - ready to scale in more`,
          );
          overallValue += curValue;
        } else {
          // Between -20% and +20% → HOLD
          const curValue = stock.longShares * currentPrice - commission;
          const roi = (100 * priceChangePercent).toFixed(2);
          ns.print(
            `HOLD\t${stock.summary} at ${roi}% - ${stock.longShares} shares @ ${currentPrice.toFixed(2)}`,
          );
          overallValue += curValue;
        }
      }
      if (stock.shortShares > 0) {
        if (!enableShorts) continue;
        const entryPrice = stock.shortPrice;
        const currentPrice = stock.askPrice;
        const priceChangePercent = (entryPrice - currentPrice) / entryPrice; // inverted for shorts

        // Immediate full exit for shorts if severe loss
        if (priceChangePercent <= stopLossImmediate) {
          ns.print(
            `STOP_IMMEDIATE_SHORT\t${stock.summary} moved ${(priceChangePercent * 100).toFixed(2)}% against short - SELLING ALL to limit loss`,
          );
          sellShort(stock);
          continue;
        }

        if (priceChangePercent <= dropThreshold) {
          // Rose 20%+ (short position lost) → SELL 80% to cut losses
          const sharesToSell = Math.floor(stock.shortShares * 0.8);
          if (sharesToSell > 0) {
            const salePrice = ns.stock.sellShort(stock.sym, sharesToSell);
            if (salePrice > 0) {
              const saleTotal = salePrice * sharesToSell;
              const saleCost = entryPrice * sharesToSell;
              const saleProfit = saleCost - saleTotal - commission;
              totalLifetimeProfit += saleProfit;
              ns.print(
                `SELL_SHORT_80%\t${stock.summary} rose ${(Math.abs(priceChangePercent) * 100).toFixed(1)}% - sold ${sharesToSell} shares (${ns.format.number(saleProfit, "0a")} profit)`,
              );
            }
          }
        } else if (priceChangePercent >= riseThreshold) {
          // Dropped 20%+ (short position winning) → mark for scaling
          stock.shouldBuyMoreShort = true;
          const curValue = stock.shortShares * currentPrice - commission;
          const roi = (100 * priceChangePercent).toFixed(2);
          ns.print(
            `HOLD_SHORT_BUY\t${stock.summary} up ${roi}% - ready to scale in more`,
          );
          overallValue += curValue;
        } else {
          // Between -20% and +20% → HOLD
          const curValue = stock.shortShares * currentPrice - commission;
          const roi = (100 * priceChangePercent).toFixed(2);
          ns.print(
            `HOLD_SHORT\t${stock.summary} at ${roi}% - ${stock.shortShares} shares @ ${currentPrice.toFixed(2)}`,
          );
          overallValue += curValue;
        }
      }
    }
  }

  function buyLong(stock, money, portfolioValue) {
    if (DEBUG)
      ns.print(
        `DEBUG\tbuyLong: checking ${stock.sym} forecast=${stock.forecast.toFixed(3)}`,
      );
    // Size position inversely to volatility: lower volatility = larger position
    const volatilityFactor = Math.max(0.3, 1 - stock.volatility);
    const baseShares = Math.floor((money - commission) / stock.askPrice);
    const sharesWeCanBuy = Math.floor(baseShares * volatilityFactor);
    if (DEBUG)
      ns.print(
        `DEBUG\tbuyLong: ${stock.sym} sharesWeCanBuy=${sharesWeCanBuy} (volatility=${stock.volatility.toFixed(3)}, factor=${volatilityFactor.toFixed(3)})`,
      );
    const sharesToBuy = Math.min(stock.maxShares, sharesWeCanBuy);
    if (DEBUG)
      ns.print(
        `DEBUG\tbuyLong: ${stock.sym} sharesToBuy=${sharesToBuy} (max=${stock.maxShares})`,
      );
    if (sharesToBuy <= 0) {
      if (DEBUG)
        ns.print(`DEBUG\tbuyLong: ${stock.sym} BLOCKED - sharesToBuy <= 0`);
      return;
    }
    const purchaseCost = ns.stock.getPurchaseCost(stock.sym, sharesToBuy, "L");
    if (DEBUG)
      ns.print(
        `DEBUG\tbuyLong: ${stock.sym} purchaseCost=${ns.format.number(purchaseCost, "0a")}`,
      );
    if (!canAffordPurchase(purchaseCost, money, portfolioValue)) {
      const minRequired = (minCashRatio / (1 - minCashRatio)) * portfolioValue;
      if (DEBUG)
        ns.print(
          `DEBUG\tbuyLong: ${stock.sym} BLOCKED - need 20% cash reserve (cost ${ns.format.number(purchaseCost, "0a")} + reserve ${ns.format.number(minRequired, "0a")} = ${ns.format.number(purchaseCost + minRequired, "0a")}, have ${ns.format.number(money, "0a")})`,
        );
      return;
    }
    const buyResult = ns.stock.buyStock(stock.sym, sharesToBuy);
    if (DEBUG)
      ns.print(`DEBUG\tbuyLong: ${stock.sym} buyStock returned ${buyResult}`);
    if (buyResult > 0) {
      // After a successful buy, clear any 'shouldBuyMore' marker so we don't
      // repeatedly scale into the same position during this cycle.
      stock.shouldBuyMore = false;
      ns.print(
        `WARN\t${stock.summary}\t- LONG @ ${ns.format.number(sharesToBuy, "0a")} (price: ${ns.format.number(buyResult, "0.00")})`,
      );
    } else if (DEBUG) {
      ns.print(
        `DEBUG\tbuyLong: ${stock.sym} BLOCKED - buyStock returned ${buyResult}`,
      );
    }
  }

  function buyShort(stock, money, portfolioValue) {
    if (!enableShorts) return;
    if (DEBUG)
      ns.print(
        `DEBUG\tbuyShort: checking ${stock.sym} forecast=${stock.forecast.toFixed(3)}`,
      );
    // Size position inversely to volatility: lower volatility = larger position
    const volatilityFactor = Math.max(0.3, 1 - stock.volatility);
    const baseShares = Math.floor((money - commission) / stock.askPrice);
    const sharesWeCanBuy = Math.floor(baseShares * volatilityFactor);
    if (DEBUG)
      ns.print(
        `DEBUG\tbuyShort: ${stock.sym} sharesWeCanBuy=${sharesWeCanBuy} (volatility=${stock.volatility.toFixed(3)}, factor=${volatilityFactor.toFixed(3)})`,
      );
    const sharesToBuy = Math.min(stock.maxShares, sharesWeCanBuy);
    if (DEBUG)
      ns.print(
        `DEBUG\tbuyShort: ${stock.sym} sharesToBuy=${sharesToBuy} (max=${stock.maxShares})`,
      );
    if (sharesToBuy <= 0) {
      if (DEBUG)
        ns.print(`DEBUG\tbuyShort: ${stock.sym} BLOCKED - sharesToBuy <= 0`);
      return;
    }
    const purchaseCost = ns.stock.getPurchaseCost(stock.sym, sharesToBuy, "S");
    if (DEBUG)
      ns.print(
        `DEBUG\tbuyShort: ${stock.sym} purchaseCost=${ns.format.number(purchaseCost, "0a")}`,
      );
    if (!canAffordPurchase(purchaseCost, money, portfolioValue)) {
      const minRequired = (minCashRatio / (1 - minCashRatio)) * portfolioValue;
      if (DEBUG)
        ns.print(
          `DEBUG\tbuyShort: ${stock.sym} BLOCKED - need 20% cash reserve (cost ${ns.format.number(purchaseCost, "0a")} + reserve ${ns.format.number(minRequired, "0a")} = ${ns.format.number(purchaseCost + minRequired, "0a")}, have ${ns.format.number(money, "0a")})`,
        );
      return;
    }
    const buyResult = ns.stock.buyShort(stock.sym, sharesToBuy);
    if (DEBUG)
      ns.print(`DEBUG\tbuyShort: ${stock.sym} buyShort returned ${buyResult}`);
    if (buyResult > 0) {
      stock.shouldBuyMoreShort = false;
      ns.print(
        `WARN\t${stock.summary}\t- SHORT @ ${ns.format.number(sharesToBuy, "0a")} (price: ${ns.format.number(buyResult, "0.00")})`,
      );
    } else if (DEBUG) {
      ns.print(
        `DEBUG\tbuyShort: ${stock.sym} BLOCKED - buyShort returned ${buyResult}`,
      );
    }
  }

  function yolo(stocks) {
    const portfolioValue = stocks.totalValue || 0;
    if (DEBUG)
      ns.print(
        `DEBUG\tyolo: evaluating ${stocks.length} stocks (portfolio value: ${ns.format.number(portfolioValue, "0a")}, longThresh=${forecastLong.toFixed(3)}, shortThresh=${forecastShort.toFixed(3)})`,
      );
    for (const stock of stocks) {
      const money = ns.getPlayer().money;
      if (DEBUG)
        ns.print(
          `DEBUG\tyolo: ${stock.sym} forecast=${stock.forecast.toFixed(3)} money=${ns.format.number(money, "0a")}`,
        );

      // SCALE INTO WINNERS: If stock rose 20%+ from entry, buy 80% more
      if (stock.shouldBuyMore && stock.longShares > 0) {
        if (DEBUG)
          ns.print(
            `DEBUG\tyolo: ${stock.sym} SCALING IN - stock up 20%+, buying 80% more shares`,
          );
        const sharesToAdd = Math.min(
          Math.floor(stock.longShares * 0.8),
          Math.max(0, stock.maxShares - stock.longShares),
        );
        if (sharesToAdd > 0) {
          const scaleCost = ns.stock.getPurchaseCost(
            stock.sym,
            sharesToAdd,
            "L",
          );
          if (canAffordPurchase(scaleCost, money, portfolioValue)) {
            const buyResult = ns.stock.buyStock(stock.sym, sharesToAdd);
            if (buyResult > 0) {
              // Clear the scale marker so we don't repeatedly attempt to add
              stock.shouldBuyMore = false;
              ns.print(
                `SCALE_IN\t${stock.summary} - Added ${sharesToAdd} shares @ ${ns.format.number(buyResult, "0.00")} (up 20%+)`,
              );
            }
          }
        }
      }

      // SCALE SHORTS: if we marked a short to buy more (position is winning)
      if (stock.shouldBuyMoreShort && stock.shortShares > 0) {
        if (DEBUG)
          ns.print(
            `DEBUG\tyolo: ${stock.sym} SCALING IN SHORT - stock down 20%+, buying 80% more shares`,
          );
        const sharesToAdd = Math.min(
          Math.floor(stock.shortShares * 0.8),
          Math.max(0, stock.maxShares - stock.shortShares),
        );
        if (sharesToAdd > 0) {
          const scaleCost = ns.stock.getPurchaseCost(
            stock.sym,
            sharesToAdd,
            "S",
          );
          if (canAffordPurchase(scaleCost, money, portfolioValue)) {
            const buyResult = ns.stock.buyShort(stock.sym, sharesToAdd);
            if (buyResult > 0) {
              stock.shouldBuyMoreShort = false;
              ns.print(
                `SCALE_IN_SHORT\t${stock.summary} - Added ${sharesToAdd} shares @ ${ns.format.number(buyResult, "0.00")} (down 20%)`,
              );
            }
          }
        }
      }

      // NORMAL BUYING: strategy-aware
      const openPositions = stocks.filter(
        (s) => s.longShares > 0 || s.shortShares > 0,
      ).length;

      // AGGRESSIVE: buy multiple top signals up to maxPositions, allocate a
      // fraction of cash per stock.
      if (STRATEGY === "aggressive") {
        if (
          stock.longShares === 0 &&
          openPositions < maxPositions &&
          stock.forecast >= forecastLong
        ) {
          const allocation = Math.floor(
            ns.getPlayer().money * portfolioAllocationPerStock,
          );
          const sharesAffordable = Math.floor(
            (allocation - commission) / stock.askPrice,
          );
          const sharesToBuy = Math.min(
            stock.maxShares,
            Math.max(0, sharesAffordable),
          );
          if (sharesToBuy > 0) {
            const cost = ns.stock.getPurchaseCost(stock.sym, sharesToBuy, "L");
            if (canAffordPurchase(cost, money, portfolioValue))
              buyLong(stock, money, portfolioValue);
          }
        }
        if (
          enableShorts &&
          stock.shortShares === 0 &&
          openPositions < maxPositions &&
          stock.forecast <= forecastShort
        ) {
          const allocation = Math.floor(
            ns.getPlayer().money * portfolioAllocationPerStock,
          );
          const sharesAffordable = Math.floor(
            (allocation - commission) / stock.askPrice,
          );
          const sharesToBuy = Math.min(
            stock.maxShares,
            Math.max(0, sharesAffordable),
          );
          if (sharesToBuy > 0) {
            const cost = ns.stock.getPurchaseCost(stock.sym, sharesToBuy, "S");
            if (canAffordPurchase(cost, money, portfolioValue))
              buyShort(stock, money, portfolioValue);
          }
        }
      } else if (STRATEGY === "diversify") {
        // Diversify into top-N by profitPotential (stocks are already sorted)
        const idx = stocks.indexOf(stock);
        if (
          stock.longShares === 0 &&
          idx < diversifyCount &&
          stock.forecast >= 0.51 &&
          openPositions < maxPositions
        ) {
          const allocation = Math.floor(
            ns.getPlayer().money * (portfolioAllocationPerStock / 2),
          );
          const sharesAffordable = Math.floor(
            (allocation - commission) / stock.askPrice,
          );
          const sharesToBuy = Math.min(
            stock.maxShares,
            Math.max(0, sharesAffordable),
          );
          if (sharesToBuy > 0) {
            const cost = ns.stock.getPurchaseCost(stock.sym, sharesToBuy, "L");
            if (canAffordPurchase(cost, money, portfolioValue))
              buyLong(stock, money, portfolioValue);
          }
        }
      } else {
        // Default/2080-compatible: only buy on forecast signal if no position
        if (stock.longShares === 0 && stock.forecast >= forecastLong) {
          buyLong(stock, money, portfolioValue);
        } else if (
          enableShorts &&
          stock.shortShares === 0 &&
          stock.forecast <= forecastShort
        ) {
          buyShort(stock, money, portfolioValue);
        }
      }
    }
  }

  if (!hasRequiredAccess()) {
    ns.tprint("Missing TIX or 4S Data TIX access. Exiting stock script.");
    return;
  }

  ns.print("=== STOCK TRADER STARTED ===");
  ns.print(`forecastLong threshold: ${forecastLong.toFixed(3)}`);
  ns.print(`forecastShort threshold: ${forecastShort.toFixed(3)}`);
  ns.print(
    `minCashRatio: ${(minCashRatio * 100).toFixed(0)}% (maintain 20% cash on hand)`,
  );
  ns.print(`2080 Strategy:`);
  ns.print(`  - DROP 20% → SELL 80% of position (keep 20% for recovery)`);
  ns.print(`  - RISE 20% → BUY MORE (scale into winners)`);
  ns.print(`  - Otherwise HOLD and let it run`);
  ns.print(`enableShorts: ${enableShorts}`);
  ns.print(`DEBUG: ${DEBUG}`);
  ns.print(`tickDuration: ${tickDuration}ms`);
  ns.print(`==========================`);
  ns.print("");

  while (true) {
    const now = Date.now();
    if (now - lastAccessCheck >= accessCheckInterval) {
      lastAccessCheck = now;
      if (!hasRequiredAccess()) {
        ns.tprint("Lost TIX or 4S Data TIX access. Exiting stock script.");
        return;
      }
    }

    const stocks = getStonks();
    // Adapt portfolio allocation and max positions based on market volatility.
    // Lower volatility -> larger per-stock allocation and more positions.
    const avgVolatility =
      stocks.length > 0
        ? stocks.reduce((s, x) => s + x.volatility, 0) / stocks.length
        : 0.2;
    // Compute allocation: baseAllocation scaled by (1 - avgVolatility), clamped
    portfolioAllocationPerStock = Math.max(
      0.03,
      Math.min(0.5, baseAllocation * Math.max(0.3, 1 - avgVolatility)),
    );
    // Compute max positions: baseMaxPositions scaled by (1 - avgVolatility)
    maxPositions = Math.max(
      2,
      Math.min(
        12,
        Math.round(baseMaxPositions * Math.max(0.4, 1 - avgVolatility)),
      ),
    );
    if (DEBUG)
      ns.print(
        `DEBUG\tAdaptive allocation: ${(
          portfolioAllocationPerStock * 100
        ).toFixed(
          1,
        )}% per stock, maxPositions=${maxPositions}, avgVol=${avgVolatility.toFixed(3)}`,
      );
    if (DEBUG) ns.print(`DEBUG\tMain loop: fetched ${stocks.length} stocks`);
    takeTendies(stocks);
    yolo(stocks);
    ns.print("Stock value: " + ns.format.number(overallValue, "0a"));
    ns.print("Lifetime profit: " + ns.format.number(totalLifetimeProfit, "0a"));
    ns.print("");
    overallValue = 0;

    // @TODO - ADVANCED: Market manipulation via hacking operations
    // Requires Singularity or stock market SF upgrades
    // - ns.hack(server) → decreases stock price (simulate selling/negative news)
    // - ns.grow(server) → increases stock price (simulate growth/positive news)
    // Synergy: Coordinate hacking targets with stock positions
    //   1. Identify stocks with >0.5 forecast (buy LONG)
    //   2. Grow that company's server to push price up
    //   3. Sell when price spikes
    // Risk: Can lose money if forecast changes or growth costs exceed gains
    // Consider cross-system integration with smart-early-hack automation

    await ns.sleep(tickDuration);
  }
}
