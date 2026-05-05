/** @param {NS} ns */
export async function main(ns) {
  // Smart wrapper combining profiling logic with the early-hack template.
  // It continuously selects the most profitable hackable server (by maxMoney / hackTime)
  // that the player's hacking level can handle, then runs the simple weaken/grow/hack
  // loop from the template against that target.

  function getAllServers() {
    const visited = new Set();
    const stack = ["home"];
    while (stack.length) {
      const s = stack.pop();
      if (!s || visited.has(s)) continue;
      visited.add(s);
      for (const n of ns.scan(s)) if (!visited.has(n)) stack.push(n);
    }
    return [...visited];
  }

  function chooseBestTarget() {
    const servers = getAllServers();
    const playerLevel = ns.getHackingLevel();
    const candidates = [];
    for (const server of servers) {
      if (server === "home") continue;
      try {
        const maxMoney = ns.getServerMaxMoney(server);
        if (!maxMoney || maxMoney <= 0) continue;
        const req = ns.getServerRequiredHackingLevel(server);
        if (req > playerLevel) continue;
        const hackTime = ns.getHackTime(server);
        const score = maxMoney / Math.max(1, hackTime);
        candidates.push({ server, maxMoney, hackTime, score });
      } catch (e) {
        // ignore unreachable metadata calls
      }
    }

    if (candidates.length === 0) return null;
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0].server;
  }

  // Try to open ports (best-effort) similar to what a deployer would do.
  function tryOpenPorts(target) {
    try {
      if (ns.fileExists("BruteSSH.exe", "home")) ns.brutessh(target);
      if (ns.fileExists("FTPCrack.exe", "home")) ns.ftpcrack(target);
      if (ns.fileExists("relaySMTP.exe", "home")) ns.relaysmtp(target);
      if (ns.fileExists("HTTPWorm.exe", "home")) ns.httpworm(target);
      if (ns.fileExists("SQLInject.exe", "home")) ns.sqlinject(target);
    } catch (e) {
      // ignore port-open errors
    }
  }

  ns.print("Starting smart early-hack (profiler-driven)");

  while (true) {
    let target = chooseBestTarget();
    if (!target) {
      ns.print("No suitable target found; defaulting to n00dles");
      target = "n00dles";
    }

    // Ensure we have root access (best-effort)
    tryOpenPorts(target);
    try {
      if (!ns.hasRootAccess(target)) ns.nuke(target);
    } catch (e) {
      // nuke may fail if not enough ports; continue and the loop will re-evaluate
    }

    // Use the same thresholds as the template so behavior is familiar
    const moneyThresh = ns.getServerMaxMoney(target);
    const securityThresh = ns.getServerMinSecurityLevel(target);

    // Run the template logic against the selected target until it stops being attractive
    while (true) {
      // Re-evaluate target conditions occasionally
      try {
        if (ns.getServerSecurityLevel(target) > securityThresh) {
          await ns.weaken(target);
          continue;
        }
        if (ns.getServerMoneyAvailable(target) < moneyThresh) {
          await ns.grow(target);
          continue;
        }
        await ns.hack(target);
      } catch (e) {
        // If something goes wrong (server unreachable), break and pick a new target
        ns.print(`Error working on ${target}: ${e}`);
        break;
      }

      // If player level or server landscape changed, allow outer loop to pick new best target
      // Check every few seconds
      await ns.sleep(2000);
      const bestNow = chooseBestTarget();
      if (bestNow && bestNow !== target) {
        ns.print(`Switching target: ${target} -> ${bestNow}`);
        break;
      }
    }
  }
}
