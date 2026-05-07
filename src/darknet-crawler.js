/** @param {NS} ns */
export async function main(ns) {
  ns.disableLog("ALL");
  const dataFile = "/data/darknet-passwords.json";
  const logFile = "/data/darknet-log.txt";
  const stateFile = "/data/darknet-state.json";

  // ============ CONFIG ============
  const SCRIPT_NAME = ns.getScriptName();
  const TICK_INTERVAL = 3000; // ms between main loop iterations
  const MAX_STASIS_LINKS = 5; // conservative stasis link usage
  const MAX_AUTH_THREADS = 4; // parallel authentication threads per server
  const PHISHING_LOOPS = 2; // number of phishing attacks per server visit
  const RAM_FREE_LOOPS = 2; // number of memoryReallocation calls per server

  // ============ UTILITIES ============
  function log(msg) {
    ns.print(msg);
    // Optionally write to file for persistence: ns.write(logFile, msg + "\n", "a");
  }

  function loadPasswords() {
    if (ns.fileExists(dataFile)) {
      const data = ns.read(dataFile);
      try {
        return JSON.parse(data);
      } catch (e) {
        log("ERROR parsing passwords file: " + e);
        return {};
      }
    }
    return {};
  }

  function savePasswords(passwords) {
    ns.write(dataFile, JSON.stringify(passwords, null, 2), "w");
  }

  function loadState() {
    if (ns.fileExists(stateFile)) {
      const data = ns.read(stateFile);
      try {
        return JSON.parse(data);
      } catch (e) {
        log("ERROR parsing state file: " + e);
        return { exploredServers: [], stasisLinkedServers: [] };
      }
    }
    return { exploredServers: [], stasisLinkedServers: [] };
  }

  function saveState(state) {
    ns.write(stateFile, JSON.stringify(state, null, 2), "w");
  }

  // ============ PASSWORD CRACKING ============
  async function crackServer(hostname, passwords) {
    const details = ns.dnet.getServerAuthDetails(hostname);

    // Already authenticated or offline
    if (details.hasSession) {
      log(`[${hostname}] Already authenticated (session exists)`);
      return true;
    }
    if (!details.isOnline) {
      log(`[${hostname}] Server offline`);
      return false;
    }
    if (!details.isConnectedToCurrentServer) {
      log(`[${hostname}] Not connected to current server`);
      return false;
    }

    // Try known password first
    if (passwords[hostname]) {
      const result = await ns.dnet.authenticate(hostname, passwords[hostname]);
      if (result.success) {
        log(`[${hostname}] ✓ Authenticated with known password`);
        return true;
      } else {
        log(`[${hostname}] Known password failed (server may have restarted)`);
        delete passwords[hostname];
      }
    }

    // Try model-specific passwords
    if (details.modelId === "ZeroLogon") {
      const result = await ns.dnet.authenticate(hostname, "");
      if (result.success) {
        log(`[${hostname}] ✓ ZeroLogon cracked (empty password)`);
        passwords[hostname] = "";
        savePasswords(passwords);
        return true;
      }
    }

    // Try common password patterns and hints
    const commonPasswords = [
      "",
      "password",
      "admin",
      "123456",
      "letmein",
      details.passwordHint || "",
    ];

    for (const pwd of commonPasswords) {
      if (pwd.length === 0) continue; // skip empty, already tried
      const result = await ns.dnet.authenticate(hostname, pwd);
      if (result.success) {
        log(`[${hostname}] ✓ Authenticated with password: ${pwd}`);
        passwords[hostname] = pwd;
        savePasswords(passwords);
        return true;
      }
    }

    // Last resort: use heartbleed to get more clues
    try {
      const logResult = await ns.dnet.heartbleed(hostname, { peek: true });
      if (logResult.logs && logResult.logs.length > 0) {
        log(`[${hostname}] Heartbleed logs:\n${logResult.logs.join("\n")}`);
      }
    } catch (e) {
      // heartbleed may fail or not be available
    }

    log(
      `[${hostname}] ✗ Could not crack password (hint: ${details.passwordHint})`,
    );
    return false;
  }

  // ============ SERVER EXPLOITATION ============
  async function exploitServer(hostname, passwords) {
    const currentHostname = ns.getHostname();

    // Connect to server if we know the password
    if (!passwords[hostname]) {
      return;
    }

    try {
      ns.dnet.connectToSession(hostname, passwords[hostname]);
    } catch (e) {
      log(`[${hostname}] Error connecting to session: ${e}`);
      return;
    }

    // Copy this script to spread
    try {
      ns.scp(SCRIPT_NAME, hostname);
      if (!ns.scriptRunning(SCRIPT_NAME, hostname)) {
        ns.exec(SCRIPT_NAME, hostname, 1);
        log(`[${hostname}] ✓ Script deployed and running`);
      }
    } catch (e) {
      log(`[${hostname}] Could not deploy script: ${e}`);
    }

    // Free up blocked RAM
    for (let i = 0; i < RAM_FREE_LOOPS; i++) {
      try {
        const freed = ns.dnet.memoryReallocation();
        if (freed > 0) {
          log(`[${hostname}] Freed ${ns.format.number(freed)} blocked RAM`);
        } else {
          break; // No more blocked RAM
        }
      } catch (e) {
        // memoryReallocation may fail
        break;
      }
    }

    // Open .cache files for loot
    try {
      const cacheFiles = ns.ls(hostname, ".cache");
      for (const cacheFile of cacheFiles) {
        try {
          const result = ns.dnet.openCache(cacheFile);
          log(`[${hostname}] ✓ Looted ${cacheFile}: ${result}`);
        } catch (e) {
          log(`[${hostname}] Could not loot ${cacheFile}: ${e}`);
        }
      }
    } catch (e) {
      // ls may fail
    }

    // Run phishing attacks to earn money
    for (let i = 0; i < PHISHING_LOOPS; i++) {
      try {
        const result = ns.dnet.phishingAttack();
        log(`[${hostname}] Phishing attack earned ${ns.format.number(result)}`);
      } catch (e) {
        log(`[${hostname}] Phishing attack failed: ${e}`);
      }
    }

    // Promote stocks for profit (requires access)
    try {
      const stocks = ns.stock.getSymbols();
      if (stocks.length > 0) {
        const targetStock = stocks[Math.floor(Math.random() * stocks.length)];
        const volatilityBefore = ns.stock.getVolatility(targetStock);
        await ns.dnet.promoteStock(targetStock);
        const volatilityAfter = ns.stock.getVolatility(targetStock);
        log(
          `[${hostname}] Promoted ${targetStock}: volatility ${(volatilityBefore * 100).toFixed(1)}% -> ${(volatilityAfter * 100).toFixed(1)}%`,
        );
      }
    } catch (e) {
      // promoteStock may fail
    }
  }

  // ============ STASIS LINK MANAGEMENT ============
  async function manageStasisLinks(state) {
    try {
      const currentLimit = ns.dnet.getStasisLinkLimit();
      const stasisLinked = ns.dnet.getStasisLinkedServers();

      if (
        stasisLinked.length < Math.min(MAX_STASIS_LINKS, currentLimit) &&
        state.exploredServers.length > 0
      ) {
        // Pick an explored server that isn't stasis-linked yet
        const candidate = state.exploredServers.find(
          (s) => !stasisLinked.includes(s),
        );
        if (candidate) {
          try {
            ns.dnet.setStasisLink(true); // Link current server first
            log(`[Stasis] Linked ${ns.getHostname()}`);
          } catch (e) {
            // May already be linked or at limit
          }
        }
      }
    } catch (e) {
      // stasis link calls may fail
    }
  }

  // ============ MAIN LOOP ============
  log("=== DARKNET CRAWLER INITIALIZED ===");
  log(`Script: ${SCRIPT_NAME}`);
  log(`Server: ${ns.getHostname()}`);

  let passwords = loadPasswords();
  let state = loadState();

  while (true) {
    log("");
    log(`[Main] Scanning nearby servers...`);

    const nearbyServers = ns.dnet.probe();
    log(`[Main] Found ${nearbyServers.length} nearby servers`);

    for (const hostname of nearbyServers) {
      log(`[Main] Processing ${hostname}...`);

      // Try to crack the server
      const cracked = await crackServer(hostname, passwords);
      if (cracked) {
        if (!state.exploredServers.includes(hostname)) {
          state.exploredServers.push(hostname);
          saveState(state);
        }

        // Exploit the server (loot, spread, etc.)
        await exploitServer(hostname, passwords);
      }
    }

    // Manage stasis links periodically
    await manageStasisLinks(state);

    // Status update
    log(
      `[Main] Known servers: ${Object.keys(passwords).length} | Explored: ${state.exploredServers.length} | Stasis links: ${ns.dnet.getStasisLinkedServers().length}`,
    );

    await ns.sleep(TICK_INTERVAL);
  }
}

export function autocomplete(data) {
  return ["--tail"];
}
