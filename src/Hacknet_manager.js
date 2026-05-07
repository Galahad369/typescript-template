/** @param {NS} ns */
export async function main(ns) {
  const delayTime = 1000; // Hardcoded 1 second delay
  const bufferMultiplier = 2; // Keep 20% extra cash before buying
  const maxNodes = 30;

  while (true) {
    let ownedNodes = ns.hacknet.numNodes();

    // Step 1: Assume buying a brand new node is the cheapest option to start.
    // We set upgradeType to -1 to represent "Buy a new node".
    let minValue = ns.hacknet.getPurchaseNodeCost();
    let nodeIndex = ownedNodes; // The index of the new node if we buy one
    let upgradeType = -1; // -1: Buy Node | 0: Upgrade Level | 1: Upgrade RAM | 2: Upgrade Core

    if (ownedNodes >= maxNodes) {
      minValue = Infinity;
      upgradeType = 0;
    }

    // Step 2: Look at every single node we currently own and check upgrade prices.
    for (let i = 0; i < ownedNodes; i++) {
      // Get the cost of upgrading Level (index 0), RAM (index 1), and Core (index 2)
      let upgrades = [
        ns.hacknet.getLevelUpgradeCost(i, 1),
        ns.hacknet.getRamUpgradeCost(i, 1),
        ns.hacknet.getCoreUpgradeCost(i, 1),
      ];

      // Find the absolute cheapest upgrade among Level, RAM, and Core for this specific node
      let value = Math.min(...upgrades);

      // If this specific node's cheapest upgrade is cheaper than the cheapest thing we've found so far...
      if (value < minValue) {
        minValue = value; // Remember this new lowest price
        nodeIndex = i; // Remember which node this upgrade belongs to
        upgradeType = upgrades.indexOf(value); // Remember what type of upgrade it was (0, 1, or 2)
      }
    }

    // If everything is completely maxed out, the lowest cost becomes Infinity.
    // We can safely exit and save RAM!
    if (minValue === Infinity) {
      ns.tprint("All Hacknet nodes are fully maxed out! Exiting manager.");
      await ns.sleep(1000000); // Sleep for a very long time to effectively stop the script
      return;
    }

    // Step 3: Wait for money and then do the upgrade!
    await waitForMoney(ns, minValue, delayTime, bufferMultiplier);

    // Depending on what was the cheapest, perform that specific action.
    if (upgradeType === -1) {
      ns.hacknet.purchaseNode();
      ns.print("Bought a new Hacknet Node!");
    } else if (upgradeType === 0) {
      ns.hacknet.upgradeLevel(nodeIndex, 1);
      ns.print(`Upgraded Level on Node ${nodeIndex}`);
    } else if (upgradeType === 1) {
      ns.hacknet.upgradeRam(nodeIndex, 1);
      ns.print(`Upgraded RAM on Node ${nodeIndex}`);
    } else if (upgradeType === 2) {
      ns.hacknet.upgradeCore(nodeIndex, 1);
      ns.print(`Upgraded Core on Node ${nodeIndex}`);
    }

    await ns.sleep(1);
  }
}

async function waitForMoney(ns, targetMoney, delayTime, bufferMultiplier) {
  // Using getServerMoneyAvailable("home") is a cheaper RAM cost than getPlayer()
  const requiredMoney = targetMoney * bufferMultiplier;
  while (ns.getServerMoneyAvailable("home") < requiredMoney) {
    await ns.sleep(delayTime);
  }
}
