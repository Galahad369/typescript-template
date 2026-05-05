/** @param {NS} ns */
export async function main(ns) {
  // ═══════════════════════════════════════════════════════════════════════
  // AGGRESSIVE PARALLEL HACKING FARM - BitBurner 3.0.0
  // ═══════════════════════════════════════════════════════════════════════
  // Pure hacking focused script - zero prep, maximum money generation
  // Runs entirely on home server with unlimited resources
  // Self-adapts as hacking level increases
  // ═══════════════════════════════════════════════════════════════════════

  const updateInterval = 5000; // Re-evaluate targets every 5 seconds
  const maxConcurrentHacks = 50; // Start with this many parallel hacks
  let lastHackingLevel = ns.getHackingLevel();
  let activeTargets = new Map(); // Track concurrent hacks per target

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

  function getHackableTargets() {
    const servers = getAllServers();
    const playerLevel = ns.getHackingLevel();
    const targets = [];

    for (const server of servers) {
      if (server === "home") continue;

      // Must have root access
      if (!ns.hasRootAccess(server)) continue;

      // Skip servers with no money
      const maxMoney = ns.getServerMaxMoney(server);
      if (maxMoney <= 0) continue;

      // Check hacking requirement
      const reqLevel = ns.getServerRequiredHackingLevel(server);
      if (reqLevel > playerLevel) continue;

      // Calculate profitability: money / hack time
      const hackTime = ns.getHackTime(server);
      if (hackTime <= 0) continue;

      const moneyPerMs = maxMoney / hackTime;

      targets.push({
        server,
        maxMoney,
        hackTime,
        moneyPerMs,
        securityLevel: ns.getServerSecurityLevel(server),
        minSecurity: ns.getServerMinSecurityLevel(server),
      });
    }

    // Sort by profitability (money per millisecond)
    return targets.sort((a, b) => b.moneyPerMs - a.moneyPerMs);
  }

  function calculateOptimalThreads(hackableTargets, playerLevel) {
    // Scale thread allocation based on hacking level
    // At level 1: conservative, as level increases: aggressive
    let threadsPerTarget = 1;

    if (playerLevel >= 10) threadsPerTarget = 2;
    if (playerLevel >= 30) threadsPerTarget = 3;
    if (playerLevel >= 50) threadsPerTarget = 5;
    if (playerLevel >= 100) threadsPerTarget = 8;
    if (playerLevel >= 200) threadsPerTarget = 15;
    if (playerLevel >= 500) threadsPerTarget = 30;
    if (playerLevel >= 1000) threadsPerTarget = 50;

    return Math.min(threadsPerTarget, maxConcurrentHacks);
  }

  async function parallelHackAll(targets, threadsPerTarget) {
    let totalEarned = 0;

    // Sequential hacking through multiple targets (BitBurner doesn't allow concurrent ns.hack calls)
    // Cycle through targets to maximize money generation
    for (const target of targets) {
      for (let i = 0; i < threadsPerTarget; i++) {
        try {
          // Execute hack sequentially (required by BitBurner)
          const money = await ns.hack(target.server);
          
          if (money > 0) {
            totalEarned += money;
            if (!activeTargets.has(target.server)) {
              activeTargets.set(target.server, 0);
            }
            activeTargets.set(
              target.server,
              activeTargets.get(target.server) + money,
            );
          }
        } catch (e) {
          // Server may have become inaccessible, skip
        }
      }
    }

    return totalEarned;
  }

  function logStatus(targets, playerLevel, threadsPerTarget, totalEarned) {
    const topTargets = targets.slice(0, 5);
    let log = `\n${"=".repeat(70)}\n`;
    log += `AGGRESSIVE HACKING FARM - Level ${playerLevel}\n`;
    log += `Threads/Target: ${threadsPerTarget} | Total Targets: ${targets.length}\n`;
    log += `Session Earnings: ${ns.format.money(totalEarned)}\n`;
    log += `${"=".repeat(70)}\n`;
    log += `TOP TARGETS:\n`;

    for (let i = 0; i < topTargets.length; i++) {
      const t = topTargets[i];
      const earnedFromTarget = activeTargets.get(t.server) || 0;
      log += `  ${i + 1}. ${t.server.padEnd(15)} - $${ns.format.money(t.maxMoney).padEnd(12)} | $/ms: ${t.moneyPerMs.toFixed(2)}\n`;
      if (earnedFromTarget > 0) {
        log += `     ↳ Earned: ${ns.format.money(earnedFromTarget)}\n`;
      }
    }

    log += `${"=".repeat(70)}`;
    ns.print(log);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // BONUS: Additional Money-Making Strategies
  // ═══════════════════════════════════════════════════════════════════════

  async function solveContracts(ns) {
    // Auto-solve coding contracts for bonus money (if available)
    const servers = getAllServers();
    let contractsSolved = 0;

    for (const server of servers) {
      const contracts = ns.ls(server, ".cct") || [];
      for (const contract of contracts) {
        try {
          const type = ns.codingcontract.getContractType(contract, server);
          const data = ns.codingcontract.getData(contract, server);
          let solution;

          // Handle common contract types
          if (type === "Find Largest Prime Factor") {
            solution = findLargestPrimeFactor(data);
          } else if (type === "Subarray with Maximum Sum") {
            solution = maxSubarraySum(data);
          } else if (type === "Total Ways to Sum") {
            solution = countWaysToSum(data);
          }

          if (solution !== undefined) {
            const reward = ns.codingcontract.attempt(
              solution,
              contract,
              server,
            );
            if (reward) {
              ns.print(
                `✓ Contract solved on ${server}: ${reward.money ? ns.format.money(reward.money) : "Reputation"}`,
              );
              contractsSolved++;
            }
          }
        } catch (e) {
          // Skip unsolvable contracts
        }
      }
    }

    return contractsSolved;
  }

  function findLargestPrimeFactor(n) {
    let largest = -1;
    for (let i = 2; i * i <= n; i++) {
      while (n % i === 0) {
        largest = i;
        n /= i;
      }
    }
    if (n > 1) largest = n;
    return largest;
  }

  function maxSubarraySum(arr) {
    let maxSum = arr[0];
    let currentSum = arr[0];
    for (let i = 1; i < arr.length; i++) {
      currentSum = Math.max(arr[i], currentSum + arr[i]);
      maxSum = Math.max(maxSum, currentSum);
    }
    return maxSum;
  }

  function countWaysToSum(target) {
    const dp = new Array(target + 1).fill(0);
    dp[0] = 1;
    for (let i = 1; i < target; i++) {
      for (let j = i; j <= target; j++) {
        dp[j] += dp[j - i];
      }
    }
    return dp[target];
  }

  // ═══════════════════════════════════════════════════════════════════════
  // MAIN LOOP
  // ═══════════════════════════════════════════════════════════════════════

  ns.print("\n");
  ns.print(
    "╔════════════════════════════════════════════════════════════════╗",
  );
  ns.print("║     AGGRESSIVE PARALLEL HACKING FARM - BitBurner 3.0.0        ║");
  ns.print(
    "║                                                                ║",
  );
  ns.print("║  Strategy: Pure hacking, no prep, unlimited resources         ║");
  ns.print("║  Goal: Maximum parallel money generation                      ║");
  ns.print("║  Scaling: Self-adapts as hacking level increases              ║");
  ns.print("║  Updates: Every 5 seconds                                     ║");
  ns.print(
    "║                                                                ║",
  );
  ns.print("║  Bonus Money-Making:                                          ║");
  ns.print("║    • Coding contracts (auto-solver)                           ║");
  ns.print(
    "║    • All available servers scanned and targeted                ║",
  );
  ns.print("║    • Level-based thread scaling                               ║");
  ns.print(
    "║                                                                ║",
  );
  ns.print(
    "╚════════════════════════════════════════════════════════════════╝\n",
  );

  let sessionEarnings = 0;
  let updateCount = 0;

  while (true) {
    const currentHackingLevel = ns.getHackingLevel();

    // Detect level increase for status update
    if (currentHackingLevel !== lastHackingLevel) {
      ns.print(
        `\n🎉 HACKING LEVEL UP: ${lastHackingLevel} → ${currentHackingLevel}\n`,
      );
      lastHackingLevel = currentHackingLevel;
    }

    // Get all hackable targets
    const targets = getHackableTargets();

    if (targets.length === 0) {
      ns.print("⚠ No hackable targets available yet. Waiting...");
      await ns.sleep(updateInterval);
      continue;
    }

    // Calculate optimal thread allocation based on current level
    const threadsPerTarget = calculateOptimalThreads(
      targets,
      currentHackingLevel,
    );

    // Run parallel hacks on top targets
    const topTargets = targets.slice(0, threadsPerTarget);
    const earned = await parallelHackAll(topTargets, 1);
    sessionEarnings += earned;

    // Periodic logging (every 12 updates = ~1 minute)
    updateCount++;
    if (updateCount % 12 === 0) {
      logStatus(
        targets,
        currentHackingLevel,
        threadsPerTarget,
        sessionEarnings,
      );

      // Attempt to solve any coding contracts
      try {
        await solveContracts(ns);
      } catch (e) {
        // Contracts not available at this stage
      }
    }

    await ns.sleep(updateInterval);
  }
}
