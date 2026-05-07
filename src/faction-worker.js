/** @param {NS} ns */
export async function main(ns) {
  // Check if Source-File 4 is available by trying to use it
  try {
    ns.singularity.getFactionRep("Tian Di Hui");
  } catch (e) {
    if (e.toString().includes("Source-File 4")) {
      ns.print("⚠️  Faction Worker requires Source-File 4 (Singularity)");
      ns.print("   Available after early-game progression");
      ns.print("   Exiting... will retry on next auto.js cycle");
      return;
    }
    // Re-throw if different error
    throw e;
  }

  const updateInterval = 60000; // Check every minute
  const minRepPerAug = 100000; // Minimum rep needed per augmentation

  function getAvailableFactions(ns) {
    const allFactions = ns.getPlayer().factions || [];
    const inFactions = new Set(allFactions);

    // Major factions available early
    const availableFactions = [
      "Tian Di Hui",
      "CyberSec",
      "Netburners",
      "Sector-12",
      "East-Palo-Alto",
      "Silhouette",
      "Speakers for the Dead",
      "The Dark Army",
      "The Syndicate",
      "The Covenant",
      "NWO",
      "Illuminati",
      "Four Sigma",
      "OmniTek Incorporated",
      "Blade Industries",
      "KuaiGong International",
      "Fulcrum Secret Technologies",
      "BitRunners",
      "The Black Hand",
      "Tetrads",
      "Slum Snakes",
      "Society of Dwarves",
      "Church of the Machine God",
      "Penthouse",
      "Rogue",
      "Deepsea",
    ];

    return availableFactions.filter((f) => inFactions.has(f));
  }

  function getBestFaction(ns) {
    const factions = getAvailableFactions(ns);
    if (factions.length === 0) return null;

    // Find faction with lowest rep (most room to grow)
    let bestFaction = factions[0];
    let lowestRep = ns.singularity.getFactionRep(bestFaction);

    for (const faction of factions) {
      const rep = ns.singularity.getFactionRep(faction);
      if (rep < lowestRep) {
        lowestRep = rep;
        bestFaction = faction;
      }
    }

    return bestFaction;
  }

  function getAugmentationsForFaction(ns, faction) {
    try {
      return ns.singularity.getAugmentationsFromFaction(faction);
    } catch {
      return [];
    }
  }

  function getRepNeededForAugs(ns, faction) {
    const augs = getAugmentationsForFaction(ns, faction);
    let totalRep = 0;

    for (const aug of augs) {
      try {
        const cost = ns.singularity.getAugmentationRepReq(aug);
        totalRep += cost;
      } catch {
        // Skip if can't get cost
      }
    }

    return totalRep;
  }

  function tryJoinAvailableFactions(ns) {
    const player = ns.getPlayer();
    const currentFactions = new Set(player.factions || []);
    const hackingLevel = ns.getHackingLevel();

    // Check which factions player can join
    const joinableFactions = [
      "Tian Di Hui", // $5M
      "CyberSec", // 30 hacking
      "Netburners", // 80 hacking
    ];

    for (const faction of joinableFactions) {
      if (currentFactions.has(faction)) continue;

      if (faction === "Tian Di Hui" && player.money >= 5e6) {
        ns.singularity.joinFaction(faction);
        ns.print(`✓ Joined faction: ${faction}`);
        return true;
      }

      // Use the live hacking level so faction joins stay accurate in 3.0.0.
      if (faction === "CyberSec" && hackingLevel >= 30) {
        ns.singularity.joinFaction(faction);
        ns.print(`✓ Joined faction: ${faction}`);
        return true;
      }

      if (faction === "Netburners" && hackingLevel >= 80) {
        ns.singularity.joinFaction(faction);
        ns.print(`✓ Joined faction: ${faction}`);
        return true;
      }
    }

    return false;
  }

  ns.print("=== FACTION WORKER STARTED ===");
  ns.print("Auto-farming faction reputation");
  ns.print("");

  while (true) {
    // Try to join new factions
    tryJoinAvailableFactions(ns);

    // Get best faction to work for
    const faction = getBestFaction(ns);

    if (!faction) {
      ns.print("No factions available yet. Waiting...");
      await ns.sleep(updateInterval);
      continue;
    }

    const currentRep = ns.singularity.getFactionRep(faction);
    const totalRepNeeded = getRepNeededForAugs(ns, faction);
    const repProgress = ((currentRep / totalRepNeeded) * 100).toFixed(1);

    ns.print(`═══════════════════════════════════════`);
    ns.print(`Working with: ${faction}`);
    ns.print(
      `Rep: ${ns.format.number(currentRep, "0.00a")} / ${ns.format.number(totalRepNeeded, "0.00a")} (${repProgress}%)`,
    );

    const augs = getAugmentationsForFaction(ns, faction);
    ns.print(`Available augmentations: ${augs.length}`);
    if (augs.length > 0) {
      ns.print(`  Examples: ${augs.slice(0, 3).join(", ")}`);
      if (augs.length > 3) ns.print(`  ... and ${augs.length - 3} more`);
    }

    ns.print(`═══════════════════════════════════════`);
    ns.print("");

    // Work for the faction (2 seconds of work)
    ns.singularity.workForFaction(faction, "hacking");

    // Check status every update interval
    await ns.sleep(updateInterval);
  }
}
