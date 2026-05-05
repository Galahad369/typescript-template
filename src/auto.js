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
    const hackScript = "hack.js";
    if (!ns.fileExists(hackScript, controlServer)) return;

    const scriptRam = ns.getScriptRam(hackScript);
    const runningHacks = ns
      .ps(controlServer)
      .filter((p) => p.filename === hackScript);
    const runningThreads = runningHacks.reduce(
      (total, p) => total + p.threads,
      0,
    );

    // Aggressively use 60% of total home RAM for hack.js + stock.js + priority tasks
    const totalRam = ns.getServerMaxRam(controlServer);
    const usedRam = ns.getServerUsedRam(controlServer);
    const aggressiveAllocation = totalRam * 0.6;

    if (aggressiveAllocation < scriptRam) return;

    // Don't spawn if already running
    if (runningThreads > 0) return;

    // Use 60% of total RAM for hack.js threads (aggressive)
    const maxThreads = Math.floor(aggressiveAllocation / scriptRam);
    if (maxThreads > 0) {
      // Auto-select best target
      ns.exec(hackScript, controlServer, maxThreads);
      ns.print(
        `✓ Hack farm on home: ${maxThreads} threads (${ns.format.number(aggressiveAllocation, "0.00")}GB / 60% of total RAM)`,
      );
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
    const scriptsToDeploy = ["aggressive-hack.js", "hack.js"];
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

      // Copy scripts (scp returns true/false)
      ns.scp(scriptsToDeploy, server);

      const remoteProcs = ns.ps(server).map((p) => p.filename);

      // Prefer aggressive-hack (coordinator) if available and not already running
      if (
        !remoteProcs.includes("aggressive-hack.js") &&
        ns.fileExists("aggressive-hack.js", server)
      ) {
        try {
          ns.exec("aggressive-hack.js", server, 1);
          ns.print(`Deployed aggressive-hack.js -> ${server}`);
        } catch {}
        continue;
      }

      // Otherwise, run hack.js to use spare RAM (will farm from that remote server)
      if (
        !remoteProcs.includes("hack.js") &&
        ns.fileExists("hack.js", server)
      ) {
        const ramPer = ns.getScriptRam("hack.js");
        const threads = Math.floor(freeRam / ramPer);
        if (threads > 0) {
          try {
            ns.exec("hack.js", server, threads);
            ns.print(`Started hack.js ${threads} threads on ${server}`);
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
    const canPurchasePrograms = hasSourceFile(4) && ns.singularity && typeof ns.singularity.purchaseProgram === "function";

    for (const prog of programs) {
      if (!ns.fileExists(prog.name, controlServer) && ns.getPlayer().money >= prog.cost) {
        if (!canPurchasePrograms) {
          // Log a short hint once and skip attempting purchase
          if (DEBUG) ns.print(`Skipping purchase of ${prog.name}: requires Source-File 4 (not owned) or Singularity API unavailable.`);
          continue;
        }

        try {
          if (ns.singularity.purchaseProgram(prog.name)) ns.print(`✓ Purchased ${prog.name}`);
        } catch (e) {
          ns.print(`Could not purchase ${prog.name}: ${e}`);
        }
      }
    }
  }
}
