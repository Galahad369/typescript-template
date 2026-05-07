/** @param {NS} ns */
export async function main(ns) {
  const updateInterval = 5000; // Update every 5 seconds

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

  function getActiveScripts() {
    const home = ns.getPlayer().location;
    const active = {};

    const scripts = [
      "hack.js",
      "root-deploy-monitor.js",
      "profiler.js",
      "prep-servers.js",
      "Hacknet_manager.js",
      "purchase-server.js",
      "stock-test.js",
    ];

    for (const script of scripts) {
      if (ns.scriptRunning(script, "home")) {
        const procs = ns.ps("home").filter((p) => p.filename === script);
        const threads = procs.reduce((sum, p) => sum + p.threads, 0);
        const ram = ns.getScriptRam(script);
        active[script] = { threads, ram: threads * ram };
      }
    }

    return active;
  }

  function calculateEarningsPerSec() {
    // Calculate actual earnings based on hack.js's current target
    const servers = getAllServers();
    const playerLevel = ns.getHackingLevel();

    // Find the best target (same logic as hack.js)
    let bestTarget = null;
    let bestMoney = 0;

    for (const server of servers) {
      if (!ns.hasRootAccess(server)) continue;
      if (server === "home") continue;

      const maxMoney = ns.getServerMaxMoney(server);
      if (maxMoney <= 0) continue;

      const reqLevel = ns.getServerRequiredHackingLevel(server);
      if (reqLevel > playerLevel) continue;

      if (maxMoney > bestMoney) {
        bestMoney = maxMoney;
        bestTarget = server;
      }
    }

    if (!bestTarget) return 0;

    // Calculate earnings for ONLY this one target
    const hackTime = ns.getHackTime(bestTarget) / 1000;
    const hackThreads = ns
      .ps("home")
      .filter((p) => p.filename === "hack.js")
      .reduce((sum, p) => sum + p.threads, 0);

    if (hackThreads === 0) return 0;

    // Each hack returns some percentage of money based on threads
    // Rough estimate: ~10% per hack cycle per 1 thread at that level
    const percentPerThread = ns.hackAnalyze(bestTarget);
    const percentStolen = Math.min(percentPerThread * hackThreads, 1);

    return (bestMoney * percentStolen) / hackTime;
  }

  function getNextMilestones() {
    const money = ns.getPlayer().money;
    const milestones = [
      { amount: 1e6, label: "1M" },
      { amount: 10e6, label: "10M" },
      { amount: 100e6, label: "100M" },
      { amount: 1e9, label: "1B" },
      { amount: 10e9, label: "10B" },
      { amount: 100e9, label: "100B" },
      { amount: 1e12, label: "1T" },
    ];

    const next = milestones.find((m) => m.amount > money);
    if (!next) return null;

    const needed = next.amount - money;
    const earningsPerSec = calculateEarningsPerSec();
    const secondsNeeded =
      earningsPerSec > 0 ? needed / earningsPerSec : Infinity;

    return {
      target: next.label,
      needed: ns.format.number(needed, "0.00a"),
      secondsNeeded,
      timeStr: formatTime(secondsNeeded),
    };
  }

  function formatTime(seconds) {
    if (seconds === Infinity) return "N/A";
    if (seconds < 60) return `${Math.floor(seconds)}s`;
    const minutes = seconds / 60;
    if (minutes < 60) return `${Math.floor(minutes)}m`;
    const hours = minutes / 60;
    if (hours < 24) return `${Math.floor(hours)}h`;
    const days = hours / 24;
    return `${Math.floor(days)}d`;
  }

  function getCloudServers() {
    return ns.cloud.getServerNames();
  }

  while (true) {
    const money = ns.getPlayer().money;
    const moneyStr = ns.format.number(money, "0.00a");
    const earningsPerSec = calculateEarningsPerSec();
    const earningsStr = ns.format.number(earningsPerSec, "0.00a");
    const hackLevel = ns.getHackingLevel();
    const active = getActiveScripts();
    const cloudServers = getCloudServers();
    const nextMilestone = getNextMilestones();

    ns.clearLog();
    ns.print("╔════════════════════════════════════════════════════╗");
    ns.print("║           BITBURNER AUTOMATION MONITOR             ║");
    ns.print("╚════════════════════════════════════════════════════╝");
    ns.print("");
    ns.print(`💰 MONEY: ${moneyStr}`);
    ns.print(`📈 EARNINGS/SEC: ${earningsStr}`);
    ns.print(`🎓 HACKING LEVEL: ${hackLevel}`);
    ns.print("");

    if (nextMilestone) {
      ns.print(`🎯 NEXT MILESTONE: ${nextMilestone.target}`);
      ns.print(`   └─ Need: ${nextMilestone.needed}`);
      ns.print(`   └─ ETA: ${nextMilestone.timeStr}`);
    }
    ns.print("");

    ns.print("📊 ACTIVE SCRIPTS:");
    let totalActiveRam = 0;
    for (const [script, info] of Object.entries(active)) {
      totalActiveRam += info.ram;
      const ramStr = ns.format.number(info.ram, "0.00");
      ns.print(
        `   ✓ ${script.padEnd(25)} | ${info.threads} threads | ${ramStr}GB`,
      );
    }
    ns.print(
      `   └─ Total RAM in use: ${ns.format.number(totalActiveRam, "0.00")}GB`,
    );
    ns.print("");

    ns.print(`☁️  CLOUD SERVERS: ${cloudServers.length}`);
    for (let i = 0; i < Math.min(5, cloudServers.length); i++) {
      const server = cloudServers[i];
      const ram = ns.getServerMaxRam(server);
      ns.print(`   ├─ ${server}: ${ns.format.number(ram, "0.0")}GB`);
    }
    if (cloudServers.length > 5) {
      ns.print(`   └─ ... and ${cloudServers.length - 5} more`);
    }
    ns.print("");

    ns.print("═══════════════════════════════════════════════════════");

    await ns.sleep(updateInterval);
  }
}
