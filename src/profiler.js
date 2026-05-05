/** @param {NS} ns */
export async function main(ns) {
  const updateInterval = 6000; // Update rankings every 6 seconds

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

  function rankServers() {
    const servers = getAllServers();
    const playerLevel = ns.getHackingLevel();
    const ranked = [];

    for (const server of servers) {
      if (server === "home") continue;
      if (!ns.hasRootAccess(server)) continue;

      const maxMoney = ns.getServerMaxMoney(server);
      if (maxMoney <= 0) continue;

      const reqLevel = ns.getServerRequiredHackingLevel(server);
      if (reqLevel > playerLevel) continue;

      const hackTime = ns.getHackTime(server);
      const minSec = ns.getServerMinSecurityLevel(server);
      const curSec = ns.getServerSecurityLevel(server);
      const moneyPerSec = maxMoney / hackTime;

      ranked.push({
        server,
        maxMoney,
        hackTime,
        moneyPerSec,
        minSec,
        curSec,
        secDiff: curSec - minSec,
        reqLevel,
      });
    }

    // Sort by profitability ($/sec)
    return ranked.sort((a, b) => b.moneyPerSec - a.moneyPerSec);
  }

  function formatTime(ms) {
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h`;
  }

  while (true) {
    const ranked = rankServers();
    ns.print("=== SERVER PROFILER ===");
    ns.print(`${ranked.length} hackable servers found`);
    ns.print("");

    if (ranked.length === 0) {
      ns.print("No hackable targets found yet!");
      ns.print("=======================");
      ns.print("");
      await ns.sleep(updateInterval);
      continue;
    }

    // Print a compact table for every ranked server (descending by $/sec)
    ns.print(
      "RANK | SERVER               | $/SEC            | MAX $        | HACK TIME",
    );
    ns.print(
      "-----+----------------------+------------------+--------------+----------",
    );

    for (let i = 0; i < ranked.length; i++) {
      const s = ranked[i];
      const rank = (i + 1).toString().padEnd(4);
      const name = s.server.padEnd(20);
      const profitSec = ns.format.number(s.moneyPerSec, "0.00a").padEnd(16);
      const money = ns.format.number(s.maxMoney, "0.00a").padEnd(12);
      const time = formatTime(s.hackTime).padEnd(9);
      ns.print(`${rank} | ${name} | ${profitSec} | ${money} | ${time}`);
    }

    ns.print("=======================");
    ns.print("");

    await ns.sleep(updateInterval);
  }
}
