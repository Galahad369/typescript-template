/** @param {NS} ns */
export async function main(ns) {
  const target = ns.args[0] || selectBestTarget(ns);
  const minSecurityThreshold = 5; // How much above minimum is acceptable
  const growthThreshold = 0.75; // Only hack when money is at least this % of max

  ns.print(`Batch Hacker targeting: ${target}`);

  function selectBestTarget(ns) {
    const servers = getAllServers(ns);
    const playerLevel = ns.getHackingLevel();
    let best = "n00dles";
    let bestMoney = 0;

    for (const server of servers) {
      if (!ns.hasRootAccess(server)) continue;
      const maxMoney = ns.getServerMaxMoney(server);
      if (maxMoney <= 0) continue;
      const reqLevel = ns.getServerRequiredHackingLevel(server);
      if (reqLevel > playerLevel) continue;

      if (maxMoney > bestMoney) {
        bestMoney = maxMoney;
        best = server;
      }
    }

    return best;
  }

  function getAllServers(ns) {
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

  function getAvailableRam(ns) {
    let totalRam = 0;
    const servers = getAllServers(ns);

    for (const server of servers) {
      if (!ns.hasRootAccess(server)) continue;
      const available =
        ns.getServerMaxRam(server) - ns.getServerUsedRam(server);
      totalRam += Math.max(0, available);
    }

    return totalRam;
  }

  async function weakenPhase(ns, target) {
    const curSec = ns.getServerSecurityLevel(target);
    const minSec = ns.getServerMinSecurityLevel(target);

    if (curSec <= minSec + 1) return;

    const secDiff = curSec - minSec;
    const weakenTime = ns.getWeakenTime(target);
    const threads = Math.ceil(secDiff / 0.05); // Each weaken does 0.05 security reduction

    ns.print(
      `WEAKEN: ${target} security ${curSec.toFixed(1)} → ${minSec.toFixed(1)} (need ${threads} threads)`,
    );
    await ns.weaken(target);
  }

  async function growPhase(ns, target) {
    const maxMoney = ns.getServerMaxMoney(target);
    const curMoney = ns.getServerMoneyAvailable(target);
    const threshold = maxMoney * growthThreshold;

    if (curMoney >= threshold) return;

    ns.print(
      `GROW: ${target} money ${ns.format.number(curMoney, "0.00a")} → ${ns.format.number(maxMoney, "0.00a")}`,
    );
    await ns.grow(target);
  }

  async function hackPhase(ns, target) {
    const curSec = ns.getServerSecurityLevel(target);
    const minSec = ns.getServerMinSecurityLevel(target);
    const maxMoney = ns.getServerMaxMoney(target);
    const curMoney = ns.getServerMoneyAvailable(target);
    const threshold = maxMoney * growthThreshold;

    // Only hack if conditions are good
    if (curSec <= minSec + minSecurityThreshold && curMoney >= threshold) {
      const result = await ns.hack(target);
      if (result > 0) {
        ns.print(
          `HACK: ${target} gained ${ns.format.number(result, "0.00a")} (${(100 * (result / maxMoney)).toFixed(1)}%)`,
        );
        return true;
      }
    }

    return false;
  }

  // Main loop: continuous WEAKEN -> GROW -> HACK cycle
  while (true) {
    const curSec = ns.getServerSecurityLevel(target);
    const minSec = ns.getServerMinSecurityLevel(target);
    const maxMoney = ns.getServerMaxMoney(target);
    const curMoney = ns.getServerMoneyAvailable(target);

    // Phase priority: WEAKEN first, then GROW, then HACK
    if (curSec > minSec + minSecurityThreshold) {
      await weakenPhase(ns, target);
    } else if (curMoney < maxMoney * growthThreshold) {
      await growPhase(ns, target);
    } else {
      const hacked = await hackPhase(ns, target);
      if (!hacked) {
        // If we can't hack, maintain security
        await ns.weaken(target);
      }
    }

    // Brief pause between operations
    await ns.sleep(100);
  }
}
