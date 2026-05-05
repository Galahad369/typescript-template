/** @param {NS} ns **/
export async function main(ns) {
  ns.disableLog("ALL");

  const commission = 100000; // 100k commission
  const tradeCommission = 2 * commission; // buy + sell transactions
  let overallValue = 0; // total value of held positions
  const forecastLong = 0.55; // buy/hold long above this
  const forecastShort = 0.45; // buy/hold short below this
  const minCashRatio = 0.2; // keep at least 20% of portfolio as cash
  const tickDuration = 5 * 1000; // ~4s offline, ~6s online (5s compromise)
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
    const canAfford = money >= cost + minCashRequired;
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
      const longProfit =
        stock.longShares * (stock.bidPrice - stock.longPrice) - tradeCommission;
      const shortProfit =
        stock.shortShares * (stock.shortPrice - stock.askPrice) -
        tradeCommission;
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
    overallValue += curValue;
  }

  function sellLong(stock) {
    const salePrice = ns.stock.sellStock(stock.sym, stock.longShares);
    if (salePrice <= 0) return;
    const saleTotal = salePrice * stock.longShares;
    const saleCost = stock.longPrice * stock.longShares;
    const saleProfit = saleTotal - saleCost - tradeCommission;
    ns.print(
      `WARN\t${stock.summary} SOLD LONG for ${ns.format.number(saleProfit, "0a")} profit`,
    );
  }

  function sellShort(stock) {
    if (!enableShorts) return;
    const salePrice = ns.stock.sellShort(stock.sym, stock.shortShares);
    if (salePrice <= 0) return;
    const saleTotal = salePrice * stock.shortShares;
    const saleCost = stock.shortPrice * stock.shortShares;
    const saleProfit = saleCost - saleTotal - tradeCommission;
    ns.print(
      `WARN\t${stock.summary} SOLD SHORT for ${ns.format.number(saleProfit, "0a")} profit`,
    );
  }

  function takeTendies(stocks) {
    for (const stock of stocks) {
      if (stock.longShares > 0) {
        if (stock.forecast >= forecastLong) {
          logHold(stock, "LONG");
        } else {
          sellLong(stock);
        }
      }
      if (stock.shortShares > 0) {
        if (!enableShorts) continue;
        if (stock.forecast <= forecastShort) {
          logHold(stock, "SHORT");
        } else {
          sellShort(stock);
        }
      }
    }
  }

  function buyLong(stock, money, portfolioValue) {
    ns.print(
      `DEBUG\tbuyLong: checking ${stock.sym} forecast=${stock.forecast.toFixed(3)}`,
    );
    const sharesWeCanBuy = Math.floor((money - commission) / stock.askPrice);
    ns.print(
      `DEBUG\tbuyLong: ${stock.sym} sharesWeCanBuy=${sharesWeCanBuy} (ask=${stock.askPrice.toFixed(2)}, money=${ns.format.number(money, "0a")})`,
    );
    const sharesToBuy = Math.min(stock.maxShares, sharesWeCanBuy);
    ns.print(
      `DEBUG\tbuyLong: ${stock.sym} sharesToBuy=${sharesToBuy} (max=${stock.maxShares})`,
    );
    if (sharesToBuy <= 0) {
      ns.print(`DEBUG\tbuyLong: ${stock.sym} BLOCKED - sharesToBuy <= 0`);
      return;
    }
    const purchaseCost = ns.stock.getPurchaseCost(stock.sym, sharesToBuy, "L");
    ns.print(
      `DEBUG\tbuyLong: ${stock.sym} purchaseCost=${ns.format.number(purchaseCost, "0a")}`,
    );
    if (!canAffordPurchase(purchaseCost, money, portfolioValue)) {
      const minRequired = (minCashRatio / (1 - minCashRatio)) * portfolioValue;
      ns.print(
        `DEBUG\tbuyLong: ${stock.sym} BLOCKED - need 20% cash reserve (cost ${ns.format.number(purchaseCost, "0a")} + reserve ${ns.format.number(minRequired, "0a")} = ${ns.format.number(purchaseCost + minRequired, "0a")}, have ${ns.format.number(money, "0a")})`,
      );
      return;
    }
    const buyResult = ns.stock.buyStock(stock.sym, sharesToBuy);
    ns.print(`DEBUG\tbuyLong: ${stock.sym} buyStock returned ${buyResult}`);
    if (buyResult > 0) {
      ns.print(
        `WARN\t${stock.summary}\t- LONG @ ${ns.format.number(sharesToBuy, "0a")} (price: ${ns.format.number(buyResult, "0.00")})`,
      );
    } else {
      ns.print(
        `DEBUG\tbuyLong: ${stock.sym} BLOCKED - buyStock returned ${buyResult}`,
      );
    }
  }

  function buyShort(stock, money, portfolioValue) {
    if (!enableShorts) return;
    ns.print(
      `DEBUG\tbuyShort: checking ${stock.sym} forecast=${stock.forecast.toFixed(3)}`,
    );
    const sharesWeCanBuy = Math.floor((money - commission) / stock.askPrice);
    ns.print(
      `DEBUG\tbuyShort: ${stock.sym} sharesWeCanBuy=${sharesWeCanBuy} (ask=${stock.askPrice.toFixed(2)}, money=${ns.format.number(money, "0a")})`,
    );
    const sharesToBuy = Math.min(stock.maxShares, sharesWeCanBuy);
    ns.print(
      `DEBUG\tbuyShort: ${stock.sym} sharesToBuy=${sharesToBuy} (max=${stock.maxShares})`,
    );
    if (sharesToBuy <= 0) {
      ns.print(`DEBUG\tbuyShort: ${stock.sym} BLOCKED - sharesToBuy <= 0`);
      return;
    }
    const purchaseCost = ns.stock.getPurchaseCost(stock.sym, sharesToBuy, "S");
    ns.print(
      `DEBUG\tbuyShort: ${stock.sym} purchaseCost=${ns.format.number(purchaseCost, "0a")}`,
    );
    if (!canAffordPurchase(purchaseCost, money, portfolioValue)) {
      const minRequired = (minCashRatio / (1 - minCashRatio)) * portfolioValue;
      ns.print(
        `DEBUG\tbuyShort: ${stock.sym} BLOCKED - need 20% cash reserve (cost ${ns.format.number(purchaseCost, "0a")} + reserve ${ns.format.number(minRequired, "0a")} = ${ns.format.number(purchaseCost + minRequired, "0a")}, have ${ns.format.number(money, "0a")})`,
      );
      return;
    }
    const buyResult = ns.stock.buyShort(stock.sym, sharesToBuy);
    ns.print(`DEBUG\tbuyShort: ${stock.sym} buyShort returned ${buyResult}`);
    if (buyResult > 0) {
      ns.print(
        `WARN\t${stock.summary}\t- SHORT @ ${ns.format.number(sharesToBuy, "0a")} (price: ${ns.format.number(buyResult, "0.00")})`,
      );
    } else {
      ns.print(
        `DEBUG\tbuyShort: ${stock.sym} BLOCKED - buyShort returned ${buyResult}`,
      );
    }
  }

  function yolo(stocks) {
    const portfolioValue = stocks.totalValue || 0;
    ns.print(
      `DEBUG\tyolo: evaluating ${stocks.length} stocks (portfolio value: ${ns.format.number(portfolioValue, "0a")}, longThresh=${forecastLong.toFixed(3)}, shortThresh=${forecastShort.toFixed(3)})`,
    );
    for (const stock of stocks) {
      const money = ns.getPlayer().money;
      ns.print(
        `DEBUG\tyolo: ${stock.sym} forecast=${stock.forecast.toFixed(3)} money=${ns.format.number(money, "0a")}`,
      );
      if (stock.forecast >= forecastLong) {
        ns.print(
          `DEBUG\tyolo: ${stock.sym} QUALIFIES for LONG (${stock.forecast.toFixed(3)} >= ${forecastLong.toFixed(3)})`,
        );
        buyLong(stock, money, portfolioValue);
      } else if (enableShorts && stock.forecast <= forecastShort) {
        ns.print(
          `DEBUG\tyolo: ${stock.sym} QUALIFIES for SHORT (${stock.forecast.toFixed(3)} <= ${forecastShort.toFixed(3)})`,
        );
        buyShort(stock, money, portfolioValue);
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
  ns.print(`enableShorts: ${enableShorts}`);
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
    ns.print(`DEBUG\tMain loop: fetched ${stocks.length} stocks`);
    takeTendies(stocks);
    yolo(stocks);
    ns.print("Stock value: " + ns.format.number(overallValue, "0a"));
    ns.print("");
    overallValue = 0;

    // @TODO - Extend for market manipulation
    // - hack -> makes stock more likely to go down
    // - grow -> makes stock more likely to go up

    await ns.sleep(tickDuration);
  }
}
