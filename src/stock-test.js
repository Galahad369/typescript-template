/** @param {NS} ns */
export async function main(ns) {
  ns.disableLog("ALL");
  ns.ui.openTail();

  // Configuration
  const scriptTimer = 2000; // Tick interval (ms)
  const moneyKeep = 5000000000; // Reserve capital failsafe
  // 100k = 100,000
  // 1M = 1,000,000
  // 1B = 1,000,000,000
  const stockBuyOver_Long = 0.6; // Buy long when forecast >= this
  const stockBuyUnder_Short = 0.4; // Buy short when forecast <= this
  const stockVolatility = 0.05; // Max volatility to trade
  const minSharePercent = 5; // Minimum shares as % of max
  const maxSharePercent = 1.0; // Maximum shares as % of max
  const sellThreshold_Long = 0.55; // Sell long when forecast < this
  const sellThreshold_Short = 0.4; // Sell short when forecast > this
  const shortUnlock = false; // Enable short selling (requires BN8 or SF8 lvl 2)
  const DEBUG = false; // Enable detailed logging

  // API access check
  function hasRequiredAccess() {
    return ns.stock.hasTixApiAccess() && ns.stock.has4SDataTixApi();
  }

  // Format large numbers with proper notation
  function formatNumber(number) {
    if (Math.abs(number) < 1e-6) number = 0;
    return ns.format.number(number);
  }

  // Buy positions based on forecast and volatility
  function buyPositions(stock) {
    const position = ns.stock.getPosition(stock);
    const maxShares =
      ns.stock.getMaxShares(stock) * maxSharePercent - position[0];
    const maxSharesShort =
      ns.stock.getMaxShares(stock) * maxSharePercent - position[2];
    const askPrice = ns.stock.getAskPrice(stock);
    const forecast = ns.stock.getForecast(stock);
    const volatility = ns.stock.getVolatility(stock);
    const playerMoney = ns.getPlayer().money;
    const commission = 100000;

    // Buy Long positions
    if (forecast >= stockBuyOver_Long && volatility <= stockVolatility) {
      if (
        playerMoney - moneyKeep >
        ns.stock.getPurchaseCost(stock, minSharePercent, "L")
      ) {
        const shares = Math.min(
          Math.floor((playerMoney - moneyKeep - commission) / askPrice),
          maxShares,
        );
        if (shares > 0) {
          const boughtFor = ns.stock.buyStock(stock, shares);
          if (boughtFor > 0) {
            ns.print(
              `✓ LONG\t${stock}\t${ns.format.number(shares)} @ ${formatNumber(boughtFor)}`,
            );
          }
        }
      }
    }

    // Buy Short positions (if unlocked)
    if (
      shortUnlock &&
      forecast <= stockBuyUnder_Short &&
      volatility <= stockVolatility
    ) {
      if (
        playerMoney - moneyKeep >
        ns.stock.getPurchaseCost(stock, minSharePercent, "S")
      ) {
        const shares = Math.min(
          Math.floor((playerMoney - moneyKeep - commission) / askPrice),
          maxSharesShort,
        );
        if (shares > 0) {
          const boughtFor = ns.stock.buyShort(stock, shares);
          if (boughtFor > 0) {
            ns.print(
              `✓ SHORT\t${stock}\t${ns.format.number(shares)} @ ${formatNumber(boughtFor)}`,
            );
          }
        }
      }
    }
  }

  // Sell positions if forecast crosses threshold
  function sellIfOutsideThreshold(stock) {
    const position = ns.stock.getPosition(stock);
    const forecast = ns.stock.getForecast(stock);
    const bidPrice = ns.stock.getBidPrice(stock);
    const askPrice = ns.stock.getAskPrice(stock);
    const commission = 100000;

    // Sell Long positions
    if (position[0] > 0) {
      const profit = position[0] * (bidPrice - position[1]) - 2 * commission;
      const roi = ((profit / (position[0] * position[1])) * 100).toFixed(1);

      if (DEBUG) {
        ns.print(
          `${stock} LONG forecast ${(forecast * 100).toFixed(1)}% | ${ns.format.number(position[0])} shares | profit: ${formatNumber(profit)} (${roi}%)`,
        );
      }

      if (forecast < sellThreshold_Long) {
        const soldFor = ns.stock.sellStock(stock, position[0]);
        if (soldFor > 0) {
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

      if (forecast > sellThreshold_Short) {
        const soldFor = ns.stock.sellShort(stock, position[2]);
        if (soldFor > 0) {
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

  // Check API access
  if (!hasRequiredAccess()) {
    ns.tprint("ERROR: Missing TIX API or 4S Data TIX API access. Exiting.");
    return;
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
  while (true) {
    // Get stocks sorted by forecast strength (closest to 0 or 1)
    const orderedStocks = ns.stock
      .getSymbols()
      .sort(
        (a, b) =>
          Math.abs(0.5 - ns.stock.getForecast(b)) -
          Math.abs(0.5 - ns.stock.getForecast(a)),
      );

    let portfolioValue = 0;
    ns.print("─".repeat(60));

    for (const stock of orderedStocks) {
      const position = ns.stock.getPosition(stock);

      // Process existing positions
      if (position[0] > 0 || position[2] > 0) {
        sellIfOutsideThreshold(stock);
      }

      // Look for new positions
      buyPositions(stock);
    }

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
