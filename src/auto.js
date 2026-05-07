/** @param {NS} ns */
export async function main(ns) {
  const controlServer = "home";
  const sleepTime = 30000;
  // Keep this supervisor focused on scripts that do not depend on Source-Files.
  const autoScripts = [
    "root-deploy-monitor.js", // Root new servers and deploy hack.js
    "profiler.js", // Analyze and rank servers
    "prep-servers.js", // Aggressively prep top targets (grow/weaken farm)
    "monitor.js", // Real-time dashboard
    "Hacknet_manager.js", // Manage hacknet nodes
    "purchase-server.js", // Manage cloud servers
    "stock-test.js", // Trade stocks
    "contract-solver.js", // Solve coding contracts
  ];

  function ensureAutoScripts() {
    for (const script of autoScripts) {
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
    const totalRam = ns.getServerMaxRam(controlServer);
    const allocation40Pct = totalRam * 0.4;

    // Run the template locally if we have room for it.
    const earlyHackScript = "early-hack-template.js";
    if (ns.fileExists(earlyHackScript, controlServer)) {
      const earlyHackRam = ns.getScriptRam(earlyHackScript);
      const runningEarlyHacks = ns
        .ps(controlServer)
        .filter((p) => p.filename === earlyHackScript);
      const runningEarlyThreads = runningEarlyHacks.reduce(
        (total, p) => total + p.threads,
        0,
      );

      if (runningEarlyThreads === 0 && allocation40Pct >= earlyHackRam) {
        const maxThreads = Math.floor(allocation40Pct / earlyHackRam);
        if (maxThreads > 0) {
          ns.exec(earlyHackScript, controlServer, maxThreads);
          ns.print(
            `✓ Early hack farm on home: ${maxThreads} threads (${ns.format.number(allocation40Pct, "0.00")}GB / 40% of total RAM)`,
          );
        }
      }
    }

    // Keep one smart worker on home as a low-friction fallback.
    const smartScript = "smart-early-hack.js";
    if (ns.fileExists(smartScript, controlServer)) {
      const smartRam = ns.getScriptRam(smartScript);
      const runningSmartHacks = ns
        .ps(controlServer)
        .filter((p) => p.filename === smartScript);
      const runningSmartThreads = runningSmartHacks.reduce(
        (total, p) => total + p.threads,
        0,
      );

      if (runningSmartThreads === 0 && allocation40Pct >= smartRam) {
        const maxThreads = Math.floor(allocation40Pct / smartRam);
        if (maxThreads > 0) {
          ns.exec(smartScript, controlServer, maxThreads);
          ns.print(
            `✓ Smart early hack farm on home: ${maxThreads} threads (${ns.format.number(allocation40Pct, "0.00")}GB / 40% of total RAM)`,
          );
        }
      }
    }
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
    const script = "smart-early-hack.js";
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
  ns.print("Starting non-SF automation supervisor:");
  ns.print("  1. root-deploy-monitor.js (root & deploy)");
  ns.print("  2. profiler.js (analyze targets)");
  ns.print("  3. prep-servers.js (prep top targets)");
  ns.print("  4. monitor.js (dashboard)");
  ns.print("  5. Hacknet_manager.js (upgrade hacknet)");
  ns.print("  6. purchase-server.js (expand servers)");
  ns.print("  7. contract-solver.js (solve coding contracts)");
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
