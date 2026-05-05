/** @param {NS} ns */
export async function main(ns) {
  const updateInterval = 5000; // Check every 5 seconds
  const priorityServers = ["sigma-cosmetics", "CSEC"];

  const rootedServers = new Set();

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

  function availablePortOpeners() {
    const tools = [
      { file: "BruteSSH.exe", run: ns.brutessh },
      { file: "FTPCrack.exe", run: ns.ftpcrack },
      { file: "relaySMTP.exe", run: ns.relaysmtp },
      { file: "HTTPWorm.exe", run: ns.httpworm },
      { file: "SQLInject.exe", run: ns.sqlinject },
    ];

    return tools.filter((tool) => ns.fileExists(tool.file, "home"));
  }

  function canRoot(server, openers) {
    const requiredPorts = ns.getServerNumPortsRequired(server);
    return openers.length >= requiredPorts;
  }

  function tryRoot(server, openers) {
    for (const tool of openers) {
      tool.run(server);
    }
    ns.nuke(server);
  }

  while (true) {
    const servers = getAllServers();
    const openers = availablePortOpeners();

    ns.print(`=== ROOT DEPLOY MONITOR ===`);
    ns.print(`Port tools available: ${openers.length}/5`);
    ns.print(`Rooted servers: ${rootedServers.size}`);

    // Try priority servers first
    for (const server of priorityServers) {
      if (rootedServers.has(server)) continue;
      if (!servers.includes(server)) continue;

      if (ns.hasRootAccess(server)) {
        rootedServers.add(server);
        ns.print(`✓ PRIORITY ROOTED: ${server}`);
        continue;
      }

      if (!canRoot(server, openers)) continue;
      tryRoot(server, openers);
      if (ns.hasRootAccess(server)) {
        rootedServers.add(server);
        ns.print(`✓ PRIORITY ROOTED: ${server}`);
      }
    }

    // Then scan all other servers
    for (const server of servers) {
      if (server === "home") continue;
      if (rootedServers.has(server)) continue;

      if (ns.hasRootAccess(server)) {
        rootedServers.add(server);
        ns.print(`✓ New root: ${server}`);
        continue;
      }

      if (!canRoot(server, openers)) continue;
      tryRoot(server, openers);
      if (ns.hasRootAccess(server)) {
        rootedServers.add(server);
        ns.print(`✓ New root: ${server}`);
      }
    }

    ns.print(`===========================`);
    await ns.sleep(updateInterval);
  }
}
