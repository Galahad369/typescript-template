/** @param {NS} ns */
export async function main(ns) {
  const controlServer = "home";
  const sleepTime = 30000;
  const minimumRamForSupportScripts = 64;
  // Keep this supervisor focused on scripts that do not depend on Source-Files.
  const autoScripts = [
    "root-deploy-monitor.js", // Root new servers and deploy hack.js
    "profiler.js", // Analyze and rank servers
    "prep-servers.js", // Aggressively prep top targets (grow/weaken farm)
    "monitor.js", // Real-time dashboard
    //    "Hacknet_manager.js", // Manage hacknet nodes - At bitnode 8, only earn by stock, hacknet is useless
    "purchase-server.js", // Manage cloud servers
    "stock-test.js", // Trade stocks
    "contract-solver.js", // Solve coding contracts
  ];

  function ensureAutoScripts() {
    const homeRam = ns.getServerMaxRam(controlServer);

    for (const script of autoScripts) {
      if (
        homeRam < minimumRamForSupportScripts &&
        ["root-deploy-monitor.js", "profiler.js", "monitor.js"].includes(script)
      ) {
        continue;
      }

      if (!ns.fileExists(script, controlServer)) {
        ns.print(`WARN: ${script} not found on home`);
        continue;
      }

      if (ns.scriptRunning(script, controlServer)) continue;

      const requiredRam = ns.getScriptRam(script);
      const freeRam =
        ns.getServerMaxRam(controlServer) - ns.getServerUsedRam(controlServer);

      if (freeRam < requiredRam) {
        ns.print(
          `WARN: Not enough RAM for ${script} (need ${ns.format.number(requiredRam, "0.00")}GB, have ${ns.format.number(freeRam, "0.00")}GB)`,
        );
        continue;
      }

      ns.exec(script, controlServer, 1);
      ns.print(`✓ Started ${script}`);
    }
  }

  function deployHackFarmOnHome() {
    const script = "multi-target-hack.js";
    if (!ns.fileExists(script, controlServer)) return;

    const totalRam = ns.getServerMaxRam(controlServer);
    const usedRam = ns.getServerUsedRam(controlServer);
    const availableRam = totalRam - usedRam;
    const scriptRam = ns.getScriptRam(script);

    // Scale multi-target-hack to use all remaining free RAM, but reserve 5% for supervisor overhead
    const reserveRam = totalRam * 0.05;
    const allocationRam = Math.floor(availableRam - reserveRam);
    const maxThreads = Math.floor(allocationRam / scriptRam);

    if (maxThreads <= 0) return;

    // Check if already running and get current thread count
    const running = ns.ps(controlServer).filter((p) => p.filename === script);
    const currentThreads = running.reduce((sum, p) => sum + p.threads, 0);

    // Only restart if threads have decreased significantly (at least 10% drop) or not running
    if (currentThreads > 0 && currentThreads >= maxThreads * 0.9) {
      return; // Close enough, don't restart
    }

    // Kill existing process to restart with new thread count
    if (currentThreads > 0) {
      ns.scriptKill(script, controlServer);
    }

    ns.exec(script, controlServer, maxThreads);
    ns.print(
      `✓ Multi-target hack on home: ${maxThreads} threads (${ns.format.number(allocationRam, "0.00")}GB allocated)`,
    );
  }

  // Deploy the smart worker to the single best rooted host so we avoid duplicate remote copies.
  function getAllServers() {
    const seen = new Set([controlServer]);
    const queue = [controlServer];
    while (queue.length) {
      const s = queue.shift();
      for (const n of ns.scan(s)) {
        if (!seen.has(n)) {
          seen.add(n);
          queue.push(n);
        }
      }
    }
    return Array.from(seen);
  }

  function getBestDeployTarget() {
    const servers = getAllServers();
    let bestServer = null;
    let bestFreeRam = 0;

    for (const server of servers) {
      if (server === controlServer || server.startsWith("pserv-")) continue;

      try {
        if (!ns.hasRootAccess(server)) continue;
      } catch {
        continue;
      }

      const freeRam = ns.getServerMaxRam(server) - ns.getServerUsedRam(server);
      if (freeRam > bestFreeRam) {
        bestFreeRam = freeRam;
        bestServer = server;
      }
    }

    return { server: bestServer, freeRam: bestFreeRam };
  }

  function deployToBestServer() {
    const script = "multi-target-hack.js";
    if (!ns.fileExists(script, controlServer)) return;

    const best = getBestDeployTarget();
    if (!best.server || best.freeRam < 2) return;

    if (!ns.fileExists(script, best.server)) {
      ns.scp(script, best.server);
    }

    const ramPer = ns.getScriptRam(script);
    const threads = Math.floor(best.freeRam / ramPer);
    if (threads <= 0) return;

    const running = ns.ps(best.server).some((p) => p.filename === script);
    if (!running) {
      ns.exec(script, best.server, threads);
      ns.print(
        `✓ Deployed ${script} to best host ${best.server} (${threads} threads)`,
      );
    }
  }

  ns.print("=== AUTO ORCHESTRATOR ===");
  ns.print("Starting automation supervisor:");
  ns.print("  1. root-deploy-monitor.js (root & deploy)");
  ns.print("  2. profiler.js (analyze targets)");
  ns.print("  3. prep-servers.js (prep top targets)");
  ns.print("  4. monitor.js (dashboard)");
  ns.print("  5. Hacknet_manager.js (upgrade hacknet)");
  ns.print("  6. purchase-server.js (expand servers)");
  ns.print("  7. contract-solver.js (solve coding contracts)");
  ns.print("Hack farms:");
  ns.print("  - multi-target-hack (home + best rooted server)");
  ns.print("========================");
  ns.print("");

  // Main loop: keep automation running
  while (true) {
    ensureAutoScripts();
    deployToBestServer();
    deployHackFarmOnHome();
    await ns.sleep(sleepTime);
  }
}
