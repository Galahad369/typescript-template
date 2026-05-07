/** @param {NS} ns */
export async function main(ns) {
  const controlServer = "home";
  const sleepTime = 30000;
  const DEBUG = false;

  // *** CHANGE: Removed ipvgo.js - manual control only ***
  // *** CHANGE: Keeping other automation intact ***
  // Core automation scripts
  const autoScripts = [
    "root-deploy-monitor.js", // Root new servers and deploy hack.js
    "profiler.js", // Analyze and rank servers
    "prep-servers.js", // Aggressively prep top targets (grow/weaken farm)
    "monitor.js", // Real-time dashboard
    // "ipvgo.js", // DISABLED: Manual control only for IPvGO
    "faction-worker.js", // Auto-farm faction reputation
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
    const usedRam = ns.getServerUsedRam(controlServer);
    const freeRam = totalRam - usedRam;

    // Split 80% allocation: 40% for early-hack-template, 40% for smart-early-hack
    const allocation40Pct = totalRam * 0.4;

    // Deploy early-hack-template.js with 40%
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

    // Deploy smart-early-hack.js with 40%
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

  // Deploy lightweight workers to rooted servers (use hacked servers' RAM).
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

  function deployToHackedServers() {
    const scriptsToDeploy = ["smart-early-hack.js"];
    // Ensure we have the primary script locally first
    if (!ns.fileExists(scriptsToDeploy[0], controlServer)) return;

    const servers = getAllServers();
    for (const server of servers) {
      if (server === controlServer) continue;
      // skip purchased servers (they're managed separately) and obvious infra
      if (server.startsWith("pserv-")) continue;

      try {
        if (!ns.hasRootAccess(server)) continue;
      } catch (e) {
        continue;
      }

      const maxRam = ns.getServerMaxRam(server);
      const usedRam = ns.getServerUsedRam(server);
      const freeRam = maxRam - usedRam;
      if (freeRam < 2) continue;

      // Copy script(s) to the server
      ns.scp(scriptsToDeploy, server);

      const remoteProcs = ns.ps(server).map((p) => p.filename);

      // If smart script not already running, start it to fill available RAM
      if (
        !remoteProcs.includes("smart-early-hack.js") &&
        ns.fileExists("smart-early-hack.js", server)
      ) {
        const ramPer = ns.getScriptRam("smart-early-hack.js");
        const threads = Math.floor(freeRam / ramPer);
        if (threads > 0) {
          try {
            ns.exec("smart-early-hack.js", server, threads);
            ns.print(
              `Started smart-early-hack.js ${threads} threads on ${server}`,
            );
          } catch {}
        }
      }
    }
  }

  ns.print("=== AUTO ORCHESTRATOR ===");
  ns.print("Starting automation suite:");
  ns.print("  1. root-deploy-monitor.js (root & deploy)");
  ns.print("  2. profiler.js (analyze targets)");
  ns.print("  3. prep-servers.js (prep top targets)");
  ns.print("  4. monitor.js (dashboard)");
  ns.print("  5. ipvgo.js (IPvGO automation)");
  ns.print("  6. faction-worker.js (faction rep)");
  ns.print("  7. Hacknet_manager.js (upgrade hacknet)");
  ns.print("  8. purchase-server.js (expand servers)");
  ns.print("  9. stock-test.js (trade stocks)");
  ns.print(" 10. contract-solver.js (solve coding contracts)");
  ns.print("  + hack.js (auto virus spreading)");
  ns.print("========================");
  ns.print("");

  // Main loop: keep automation running
  while (true) {
    ensureAutoScripts();
    deployToHackedServers();
    deployHackFarmOnHome();
    autoBuyTorRouter();
    autoBuyDarkwebPrograms();
    await ns.sleep(sleepTime);
  }

  // *** CHANGE: Added TOR router auto-buy function ***
  function autoBuyTorRouter() {
    const torCost = 500000;
    if (!ns.hasTorRouter() && ns.getPlayer().money >= torCost) {
      if (ns.singularity && typeof ns.singularity.purchaseTor === "function") {
        try {
          if (ns.singularity.purchaseTor()) ns.print(`✓ Purchased TOR router`);
        } catch (e) {
          ns.print(`Could not purchase TOR router: ${e}`);
        }
      } else {
        // Singularity API not available yet; ignore
      }
    }
  }

  // *** CHANGE: Added darkweb programs auto-buy function ***
  function autoBuyDarkwebPrograms() {
    if (!ns.hasTorRouter()) return;
    const programs = [
      { name: "BruteSSH.exe", cost: 500000 },
      { name: "FTPCrack.exe", cost: 1500000 },
      { name: "relaySMTP.exe", cost: 5000000 },
      { name: "HTTPWorm.exe", cost: 30000000 },
      { name: "SQLInject.exe", cost: 250000000 },
    ];

    // Helper: check if player has a Source-File (n). If sourceFiles unavailable, assume false.
    function hasSourceFile(n) {
      try {
        const sf = ns.getPlayer()?.sourceFiles ?? [];
        return sf.some((s) => s.n === n);
      } catch {
        return false;
      }
    }

    // purchaseProgram requires Source-File 4 (powerup). Guard the calls so the script doesn't throw.
    const canPurchasePrograms =
      hasSourceFile(4) &&
      ns.singularity &&
      typeof ns.singularity.purchaseProgram === "function";

    for (const prog of programs) {
      if (
        !ns.fileExists(prog.name, controlServer) &&
        ns.getPlayer().money >= prog.cost
      ) {
        if (!canPurchasePrograms) {
          // Log a short hint once and skip attempting purchase
          if (DEBUG)
            ns.print(
              `Skipping purchase of ${prog.name}: requires Source-File 4 (not owned) or Singularity API unavailable.`,
            );
          continue;
        }

        try {
          if (ns.singularity.purchaseProgram(prog.name))
            ns.print(`✓ Purchased ${prog.name}`);
        } catch (e) {
          ns.print(`Could not purchase ${prog.name}: ${e}`);
        }
      }
    }
  }
}
