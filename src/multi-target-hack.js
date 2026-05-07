/** @param {NS} ns */
export async function main(ns) {
  // Configuration
  const numTargets = 5; // Monitor top 5 targets
  const minSecurityThreshold = 5; // Keep security within 5 of minimum
  const moneyThreshold = 0.75; // Hack only when money >= 75% of max
  const logInterval = 15000; // Log stats every 15 seconds

  let lastLog = 0;
  let totalHacked = 0;

  // Utility: DFS scan to get all servers
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

  // Get top N hackable targets ranked by profitability ($/sec)
  function getTopTargets(n) {
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

    // Sort by profitability, return top N
    return candidates.sort((a, b) => b.moneyPerSec - a.moneyPerSec).slice(0, n);
  }

  // Intelligently select which target needs the most help right now
  function selectBestTarget(targets) {
    let bestTarget = null;
    let bestScore = -Infinity;

    for (const target of targets) {
      const curSec = ns.getServerSecurityLevel(target.server);
      const curMoney = ns.getServerMoneyAvailable(target.server);
      const maxMoney = target.maxMoney;
      const minSec = target.minSec;

      // Score based on how urgently this target needs help
      // Security reduction is highest priority (10x weight) since it blocks hacking
      const securityGap = Math.max(0, curSec - minSec - minSecurityThreshold);
      const moneyGap = Math.max(0, maxMoney * moneyThreshold - curMoney);

      // Weighted score: weaken gaps are 10x more important than grow gaps
      const score = securityGap * 10 + moneyGap;

      if (score > bestScore) {
        bestScore = score;
        bestTarget = target;
      }
    }

    return bestTarget || targets[0];
  }

  ns.print("=== MULTI-TARGET HACKER ===");
  ns.print(`Coordinating across top ${numTargets} hackable targets`);
  ns.print("Priority: WEAKEN > GROW > HACK");
  ns.print("===========================");
  ns.print("");

  // Main coordination loop: each thread independently selects and works on targets
  while (true) {
    const targets = getTopTargets(numTargets);

    if (targets.length === 0) {
      ns.print("No hackable targets available");
      await ns.sleep(1000);
      continue;
    }

    // Select the target that needs the most help right now
    const target = selectBestTarget(targets);
    const curSec = ns.getServerSecurityLevel(target.server);
    const curMoney = ns.getServerMoneyAvailable(target.server);
    const maxMoney = target.maxMoney;
    const minSec = target.minSec;

    // Execute operation based on target state (priority-driven)
    try {
      if (curSec > minSec + minSecurityThreshold) {
        // Priority 1: Reduce security (blocks everything else)
        await ns.weaken(target.server);

        if (Date.now() - lastLog > logInterval) {
          const secToReduce = curSec - minSec - minSecurityThreshold;
          ns.print(
            `⬇️  WEAKEN: ${target.server} (${curSec.toFixed(1)} → ${minSec.toFixed(1)}, need to reduce by ${secToReduce.toFixed(1)})`,
          );
          lastLog = Date.now();
        }
      } else if (curMoney < maxMoney * moneyThreshold) {
        // Priority 2: Grow money (enables profitable hacking)
        await ns.grow(target.server);

        if (Date.now() - lastLog > logInterval) {
          const growPercent = ((curMoney / maxMoney) * 100).toFixed(1);
          ns.print(
            `📈 GROW: ${target.server} (${growPercent}% → ${(moneyThreshold * 100).toFixed(0)}%)`,
          );
          lastLog = Date.now();
        }
      } else {
        // Priority 3: Hack for profit (only when target is fully prepped)
        const result = await ns.hack(target.server);

        if (result > 0) {
          totalHacked += result;
          ns.print(
            `💰 HACK: ${target.server} gained ${ns.format.number(result, "0.00a")} (total: ${ns.format.number(totalHacked, "0.00a")})`,
          );
        }
      }
    } catch (e) {
      ns.print(`ERROR on ${target.server}: ${e}`);
    }
  }
}
