/** @param {NS} ns */
export async function main(ns) {
  // *** CHANGE: Minimal hack worker — if rooted, just hack continuously.
  const host = ns.getHostname();
  let target = ns.args[0];

  // If no usable target is provided, pick a rooted server with money instead of the current host.
  if (!target || !isGoodTarget(ns, target, host)) {
    target = pickBestTarget(ns, host);
    if (!target) {
      ns.print("✗ No hackable money targets found");
      return;
    }
    ns.print(`\n=== HACK.JS - Target: ${target} ===`);
  } else {
    ns.print(`\n=== HACK.JS - Target: ${target} ===`);
  }

  // Simple loop: only hack when we have root, hacking level is sufficient, and target has money
  const playerLevel = ns.getHackingLevel();
  while (true) {
    try {
      if (!ns.hasRootAccess(target)) {
        target = pickBestTarget(ns, host);
        if (!target) {
          await ns.sleep(1000);
          continue;
        }
        await ns.sleep(1000);
        continue;
      }

      const req = ns.getServerRequiredHackingLevel(target);
      if (req > playerLevel) {
        await ns.sleep(1000);
        continue;
      }

      const money = ns.getServerMoneyAvailable(target);
      if (money <= 0) {
        const nextTarget = pickBestTarget(ns, target);
        if (nextTarget && nextTarget !== target) {
          target = nextTarget;
          ns.print(`→ Switching target to ${target}`);
        }
        await ns.sleep(1000);
        continue;
      }

      await ns.hack(target);
    } catch (e) {
      ns.print(`✗ hack error: ${e.message}`);
      await ns.sleep(1000);
    }
  }
}

function isGoodTarget(ns, target, host) {
  if (!target) return false;
  if (target === host) return false;
  if (target.startsWith("Server-")) return false;
  try {
    if (!ns.hasRootAccess(target)) return false;
    if (ns.getServerRequiredHackingLevel(target) > ns.getHackingLevel())
      return false;
    return ns.getServerMaxMoney(target) > 0;
  } catch {
    return false;
  }
}

// Helper: pick a single best target from the network (highest max money we can hack)
function pickBestTarget(ns, exclude = null) {
  const visited = new Set(["home"]);
  const queue = ["home"];
  const playerLevel = ns.getHackingLevel();
  let best = null;
  let bestMoney = 0;

  while (queue.length) {
    const s = queue.shift();
    for (const n of ns.scan(s)) {
      if (visited.has(n)) continue;
      visited.add(n);
      queue.push(n);

      try {
        if (!ns.hasRootAccess(n)) continue;
      } catch (e) {
        continue;
      }

      if (n === exclude || n === "home" || n.startsWith("Server-")) continue;

      const req = ns.getServerRequiredHackingLevel(n);
      if (req > playerLevel) continue;

      const maxMoney = ns.getServerMaxMoney(n);
      if (maxMoney > bestMoney) {
        bestMoney = maxMoney;
        best = n;
      }
    }
  }

  return best;
}
