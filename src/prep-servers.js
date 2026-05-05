/** @param {NS} ns */
export async function main(ns) {
  const topTargets = 3; // Prep top 3 targets
  const updateInterval = 30000;

  function getAllServers() {
    const visited = new Set();
    const stack = ["home"];

    while (stack.length > 0) {
      const server = stack.pop();
      if (!server || visited.has(server)) continue;
      visited.add(server);
      for (const neighbor of ns.scan(server)) {
        if (!visited.has(neighbor)) stack.push(neighbor);
      }
    }

    return [...visited];
  }

  function getTopTargets() {
    const servers = getAllServers();
    const playerLevel = ns.getHackingLevel();
    const candidates = [];

    for (const server of servers) {
      if (server === "home") continue;
      if (!ns.hasRootAccess(server)) continue;

      const maxMoney = ns.getServerMaxMoney(server);
      if (maxMoney <= 0) continue;

      const reqLevel = ns.getServerRequiredHackingLevel(server);
      if (reqLevel > playerLevel) continue;

      const hackTime = ns.getHackTime(server);
      const moneyPerSec = maxMoney / hackTime;

      candidates.push({
        server,
        maxMoney,
        moneyPerSec,
        minSec: ns.getServerMinSecurityLevel(server),
      });
    }

    // Return top N by profitability
    return candidates
      .sort((a, b) => b.moneyPerSec - a.moneyPerSec)
      .slice(0, topTargets);
  }

  async function prepServer(target) {
    const curSec = ns.getServerSecurityLevel(target);
    const minSec = ns.getServerMinSecurityLevel(target);
    const maxMoney = ns.getServerMaxMoney(target);
    const curMoney = ns.getServerMoneyAvailable(target);

    // If security too high, weaken aggressively
    if (curSec > minSec + 5) {
      const threads = Math.ceil((curSec - minSec) / 0.05); // Weaken does 0.05 per thread
      await ns.weaken(target);
      ns.print(
        `PREP: ${target} - Weakening (sec: ${curSec.toFixed(1)} → ${minSec.toFixed(1)})`,
      );
      return;
    }

    // If money too low, grow aggressively
    if (curMoney < maxMoney * 0.5) {
      await ns.grow(target);
      ns.print(
        `PREP: ${target} - Growing (${ns.format.number(curMoney, "0.00a")} → ${ns.format.number(maxMoney, "0.00a")})`,
      );
      return;
    }

    // Otherwise maintain
    if (curSec > minSec + 1) {
      await ns.weaken(target);
    } else {
      await ns.grow(target);
    }
  }

  ns.print("=== SERVER PREP FARM ===");
  ns.print(`Targeting top ${topTargets} servers for aggressive prep`);
  ns.print("Strategy: Reduce security, maximize money, repeat");
  ns.print("======================");
  ns.print("");

  while (true) {
    const targets = getTopTargets();

    if (targets.length === 0) {
      ns.print("No targets available for prep");
      await ns.sleep(updateInterval);
      continue;
    }

    ns.print(`Prepping ${targets.length} targets:`);
    for (const target of targets) {
      ns.print(
        `  ${target.server}: $${ns.format.number(target.moneyPerSec, "0.00a")}/sec`,
      );
      await prepServer(target.server);
    }
    ns.print("");

    await ns.sleep(updateInterval);
  }
}
