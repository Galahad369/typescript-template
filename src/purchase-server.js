/** @param {NS} ns */
export async function main(ns) {
  const baseRam = 8;
  const serverLimit = ns.cloud.getServerLimit();
  const maxRam = ns.cloud.getRamLimit();
  const hackScript = "hack.js";
  const sleepTime = 5000; // 5 second check interval

  function canAfford(cost) {
    return ns.getPlayer().money >= cost;
  }

  function getCloudServers() {
    return ns.cloud.getServerNames();
  }

  function getNextServerName(ram, servers) {
    let index = 1;
    // *** CHANGE: Added safety check to prevent infinite loop ***
    const maxIterations = 10000;
    let iterations = 0;
    
    // Support both Array (has includes) and Set (has has)
    const hasName = (name) =>
      typeof servers.has === "function"
        ? servers.has(name)
        : servers.includes(name);
    
    while (iterations < maxIterations) {
      const name = `Server-${ram}GB-${index}`;
      if (!hasName(name)) return name;
      index++;
      iterations++;
    }
    
    // Fallback if we somehow hit max iterations
    return `Server-${ram}GB-${Date.now()}`;
  }

  function isStandardName(name, ram) {
    const match = /^Server-(\d+)GB-(\d+)$/.exec(name);
    if (!match) return false;
    return Number(match[1]) === ram;
  }

  function renameLegacyServers() {
    const servers = getCloudServers();
    const usedNames = new Set(servers);

    for (const server of servers) {
      const ram = ns.getServerMaxRam(server);
      if (isStandardName(server, ram)) continue;

      const newName = getNextServerName(ram, usedNames);
      if (ns.cloud.renameServer(server, newName)) {
        usedNames.delete(server);
        usedNames.add(newName);
      }
    }
  }

  function getSmallestServer(servers) {
    let smallest = servers[0];
    for (const server of servers) {
      if (ns.getServerMaxRam(server) < ns.getServerMaxRam(smallest)) {
        smallest = server;
      }
    }
    return smallest;
  }

  // *** CHANGE: Updated deployHack to use aggressive-hack if enough RAM, else hack.js ***
  async function deployHack(server) {
    const maxRamAvailable = ns.getServerMaxRam(server);
    const hackRam = ns.getScriptRam("hack.js");
    const aggressiveRam = ns.getScriptRam("aggressive-hack.js");

    let scriptToUse = "hack.js"; // Default fallback
    let maxThreads = Math.max(1, Math.floor(maxRamAvailable / hackRam));

    // *** CHANGE: Try aggressive-hack first if it exists and there's enough RAM ***
    if (
      ns.fileExists("aggressive-hack.js", "home") &&
      maxRamAvailable >= aggressiveRam * 2
    ) {
      // Need at least 2x the script RAM for aggressive-hack to be worthwhile
      scriptToUse = "aggressive-hack.js";
      maxThreads = Math.max(1, Math.floor(maxRamAvailable / aggressiveRam));
    }

    // Copy and execute the chosen script
    if (ns.fileExists(scriptToUse, "home")) {
      await ns.scp(scriptToUse, server);
      ns.exec(scriptToUse, server, maxThreads);
      ns.print(
        `✓ Deployed ${scriptToUse} (${maxThreads} threads) to ${server}`,
      );
    } else {
      ns.print(`✗ ${scriptToUse} not found on home`);
    }
  }

  renameLegacyServers();

  while (true) {
    const servers = getCloudServers();

    // Step 1: Buy 8GB servers until we hit the limit
    if (servers.length < serverLimit) {
      const cost = ns.cloud.getServerCost(baseRam);
      if (cost !== Infinity && canAfford(cost)) {
        const name = ns.cloud.purchaseServer(
          getNextServerName(baseRam, servers),
          baseRam,
        );
        if (name) {
          await deployHack(name);
        }
      }
      await ns.sleep(sleepTime);
      continue;
    }

    // Step 2: Replace the smallest server with a larger one
    const smallest = getSmallestServer(servers);
    const smallestRam = ns.getServerMaxRam(smallest);

    if (smallestRam >= maxRam) {
      ns.tprint("All cloud servers are at max RAM. Stopping.");
      return;
    }

    const newRam = Math.min(maxRam, smallestRam * 2);
    const upgradeCost = ns.cloud.getServerCost(newRam);
    if (upgradeCost === Infinity || !canAfford(upgradeCost)) {
      await ns.sleep(sleepTime);
      continue;
    }

    // Always delete the smallest RAM server first — ensure all scripts are stopped
    // Prefer a single killall call when available, otherwise kill each running script.
    try {
      if (typeof ns.killall === "function") {
        ns.killall(smallest);
      } else {
        const procs = ns.ps(smallest);
        for (const p of procs) {
          ns.scriptKill(p.filename, smallest);
        }
      }
    } catch (e) {
      ns.print(`Error while attempting to kill scripts on ${smallest}: ${e}`);
    }

    // Wait for processes to terminate (with a short timeout), then attempt deletion
    const maxWaitMs = 15000; // 15s
    const pollInterval = 1000;
    let waited = 0;
    while (ns.ps(smallest).length > 0 && waited < maxWaitMs) {
      ns.print(
        `Waiting for scripts to stop on ${smallest}... (${ns.ps(smallest).length})`,
      );
      await ns.sleep(pollInterval);
      waited += pollInterval;
    }

    // Final attempt to kill any remaining scripts (best-effort)
    const remaining = ns.ps(smallest);
    if (remaining.length > 0) {
      for (const p of remaining) ns.scriptKill(p.filename, smallest);
      await ns.sleep(500);
    }

    const deleted = ns.cloud.deleteServer(smallest);
    if (!deleted) {
      ns.print(
        `Could not delete ${smallest}. It might still be running scripts.`,
      );
      await ns.sleep(sleepTime);
      continue;
    }

    const updatedServers = getCloudServers();
    const name = ns.cloud.purchaseServer(
      getNextServerName(newRam, updatedServers),
      newRam,
    );
    if (name) {
      await deployHack(name);
    }

    await ns.sleep(sleepTime);
  }
}
