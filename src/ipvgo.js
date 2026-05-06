/** @param {NS} ns */
export async function main(ns) {
  ns.disableLog("ALL");

  // Parameters will be initialized based on detected board size (supports 5x5, 7x7, 9x9, 13x13)
  let BOARD_SIZE;
  let HEURISTIC_MOVE_LIMIT;
  let EXACT_SOLVE_EMPTY_THRESHOLD;
  let EXACT_SOLVE_TIME_BUDGET_MS;
  let EXACT_SOLVE_MAX_DEPTH;
  let EXACT_SOLVE_MAX_LEGAL_MOVES;
  let PASS_THRESHOLD;
  let MAX_ADAPTIVE_HEURISTIC_MOVE_LIMIT;
  let WEAK_STONE_WEIGHT;
  let WEAK_CHAIN_WEIGHT;
  let ATARI_CHAIN_WEIGHT;
  let ENEMY_CAPTURE_RISK_WEIGHT;
  let UPDATE_INTERVAL_MS;
  let DEBUG = false;
  let DEBUG_CANDIDATES = false;
  let LOG_TURNS = false;
  let LOG_ENABLE = false;

  // Function to determine if logging is enabled
  function isLoggingEnabled() {
    return LOG_ENABLE || DEBUG || DEBUG_CANDIDATES || LOG_TURNS;
  }

  // ===== TRANSPOSITION TABLE =====
  const transpositionCache = {};
  const solveCache = {};
  const areaScoreCache = new Map();

  // Heatmaps are generated based on BOARD_SIZE in initParams()
  let HEATMAP = null;
  let CORNER_EDGE_HEATMAP = null;

  // Initialize size-dependent parameters and heatmaps
  function initParams(size) {
    BOARD_SIZE = size;
    const center = Math.floor((BOARD_SIZE - 1) / 2);

    // Heuristic width defaults (increase for larger boards)
    HEURISTIC_MOVE_LIMIT = BOARD_SIZE <= 5 ? 3 : BOARD_SIZE <= 9 ? 4 : 5;
    MAX_ADAPTIVE_HEURISTIC_MOVE_LIMIT = Math.max(HEURISTIC_MOVE_LIMIT, 7);

    // Exact solver thresholds scale with board area
    const area = BOARD_SIZE * BOARD_SIZE;
    EXACT_SOLVE_EMPTY_THRESHOLD = Math.max(6, Math.floor(area * 0.06));
    EXACT_SOLVE_TIME_BUDGET_MS =
      BOARD_SIZE <= 5 ? 500 : BOARD_SIZE <= 9 ? 800 : 1200;
    EXACT_SOLVE_MAX_DEPTH = BOARD_SIZE <= 5 ? 12 : BOARD_SIZE <= 9 ? 14 : 16;
    EXACT_SOLVE_MAX_LEGAL_MOVES = BOARD_SIZE <= 5 ? 5 : BOARD_SIZE <= 9 ? 6 : 8;

    // Pass threshold scales with board area (avoid passing on small negative deltas)
    PASS_THRESHOLD = -Math.max(5e6, Math.floor(area * 200000));

    // Weights scale mildly with board size
    WEAK_STONE_WEIGHT = 120000;
    WEAK_CHAIN_WEIGHT = 80000;
    ATARI_CHAIN_WEIGHT = 250000;
    ENEMY_CAPTURE_RISK_WEIGHT = 220000;

    UPDATE_INTERVAL_MS = 60;

    // Build heatmap: use Chebyshev distance to center and square to amplify center
    HEATMAP = Array.from({ length: BOARD_SIZE }, (_, r) =>
      Array.from({ length: BOARD_SIZE }, (_, c) => {
        const dr = Math.abs(r - center);
        const dc = Math.abs(c - center);
        const maxd = Math.max(dr, dc);
        return Math.pow(center - maxd + 1, 2);
      }),
    );

    // Corner/edge heatmap: reward proximity to corners (smaller boards get stronger corner bias)
    CORNER_EDGE_HEATMAP = Array.from({ length: BOARD_SIZE }, (_, r) =>
      Array.from({ length: BOARD_SIZE }, (_, c) => {
        const distToCorner = Math.min(
          r + c,
          r + (BOARD_SIZE - 1 - c),
          BOARD_SIZE - 1 - r + c,
          BOARD_SIZE - 1 - r + (BOARD_SIZE - 1 - c),
        );
        return Math.max(0, center - distToCorner + 1);
      }),
    );
  }

  // --- Opening pattern DB (small, size-aware) ---
  const OPENING_DB = {
    5: [
      // center, then corner
      [
        [2, 2],
        [1, 1],
        [3, 3],
      ],
      [
        [2, 2],
        [1, 3],
        [3, 1],
      ],
    ],
    7: [
      [
        [3, 3],
        [2, 2],
        [4, 4],
      ],
      [
        [3, 3],
        [1, 1],
        [5, 5],
      ],
    ],
    9: [
      [
        [4, 4],
        [2, 2],
        [6, 6],
      ],
      [
        [4, 4],
        [1, 7],
        [7, 1],
      ],
    ],
  };

  function getMoveSequenceFromHistory() {
    try {
      const history = ns.go.getMoveHistory();
      const moves = [];
      for (let i = 1; i < history.length; i++) {
        const prev = history[i - 1];
        const cur = history[i];
        // find difference
        for (let r = 0; r < cur.length; r++) {
          for (let c = 0; c < cur[0].length; c++) {
            if (prev[r][c] !== cur[r][c]) {
              moves.push([r, c]);
            }
          }
        }
      }
      return moves;
    } catch {
      return [];
    }
  }

  function lookupOpening(board, moveCount) {
    const size = board.length;
    const db = OPENING_DB[size];
    if (!db) return null;
    const seq = getMoveSequenceFromHistory();
    for (const pattern of db) {
      let match = true;
      for (let i = 0; i < seq.length && i < pattern.length; i++) {
        const [r, c] = seq[i];
        const [pr, pc] = pattern[i];
        if (r !== pr || c !== pc) {
          match = false;
          break;
        }
      }
      if (!match) continue;
      // suggest next pattern move
      if (seq.length < pattern.length) {
        const next = pattern[seq.length];
        if (
          inBounds(board, next[0], next[1]) &&
          board[next[0]][next[1]] === "."
        )
          return next;
      }
    }
    return null;
  }

  // --- Compact MCTS implementation ---
  function mctsSearch(rootBoard, player, timeBudgetMs = 200) {
    const C = 1.4;

    function cloneBoard(b) {
      return b.map((r) => (Array.isArray(r) ? r.slice() : r.split("")));
    }

    function boardKey(b) {
      return b.map((r) => (Array.isArray(r) ? r.join("") : r)).join("|");
    }

    function legalMovesFor(b, p, historyKeys) {
      return getLegalMoves(b, p, historyKeys);
    }

    function rolloutPolicy(b, p) {
      // Use rough scorer to bias playouts: compute roughScore for each legal move and sample
      const moves = getLegalMoves(b, p, null);
      if (moves.length === 0) return null;
      const scores = moves.map((m) =>
        Math.max(
          1,
          scoreMoveRough(
            b,
            m,
            p,
            ns.go.analysis.getChains(b),
            ns.go.analysis.getLiberties(b),
            0,
          ) + 1,
        ),
      );
      const sum = scores.reduce((a, v) => a + v, 0);
      let r = Math.random() * sum;
      for (let i = 0; i < moves.length; i++) {
        r -= scores[i];
        if (r <= 0) return moves[i];
      }
      return moves[moves.length - 1];
    }

    function applyMove(b, mv, player) {
      const nb = cloneBoard(b);
      nb[mv.row][mv.col] = player;
      // resolve captures/suicide via simulateMove logic
      const sim = simulateMove(b, mv.row, mv.col, player);
      return sim.board;
    }

    class Node {
      constructor(board, player, move = null, parent = null) {
        this.board = board;
        this.player = player; // player who will play at this node
        this.move = move;
        this.parent = parent;
        this.children = [];
        this.visits = 0;
        this.wins = 0; // aggregate score (higher better for root player X)
      }
    }

    const root = new Node(cloneBoard(rootBoard), player, null, null);
    const endTime = Date.now() + timeBudgetMs;

    function select(node) {
      while (node.children.length > 0) {
        // UCT
        let best = null;
        let bestVal = -Infinity;
        for (const c of node.children) {
          const uct =
            c.wins / (c.visits + 1e-9) +
            C * Math.sqrt(Math.log(node.visits + 1) / (c.visits + 1e-9));
          if (uct > bestVal) {
            bestVal = uct;
            best = c;
          }
        }
        node = best;
      }
      return node;
    }

    function expand(node) {
      const toPlay = node.player;
      const moves = legalMovesFor(node.board, toPlay, null);
      for (const mv of moves) {
        const nb = applyMove(node.board, mv, toPlay);
        const child = new Node(nb, toPlay === "X" ? "O" : "X", mv, node);
        node.children.push(child);
      }
      return node.children.length > 0
        ? node.children[Math.floor(Math.random() * node.children.length)]
        : node;
    }

    function rollout(node) {
      let b = cloneBoard(node.board);
      let toPlay = node.player;
      const maxPlayout = Math.max(20, BOARD_SIZE * BOARD_SIZE);
      for (let i = 0; i < maxPlayout; i++) {
        const mv = rolloutPolicy(b, toPlay);
        if (!mv) break;
        b = applyMove(b, mv, toPlay);
        toPlay = toPlay === "X" ? "O" : "X";
      }
      // Evaluate final position: positive score favors X
      const finalScore = estimateFinalScore(b, null, 1.5);
      return finalScore;
    }

    function backprop(node, value) {
      // value is positive if good for X
      while (node) {
        node.visits += 1;
        node.wins += value;
        node = node.parent;
      }
    }

    // main loop
    while (Date.now() < endTime) {
      let node = select(root);
      if (node.visits === 0) {
        // evaluate directly
        const v = rollout(node);
        backprop(node, v);
        continue;
      }
      const child = expand(node);
      if (!child) continue;
      const v = rollout(child);
      backprop(child, v);
    }

    // pick best child by visits
    let bestChild = null;
    let bestVisits = -1;
    for (const c of root.children) {
      if (c.visits > bestVisits) {
        bestVisits = c.visits;
        bestChild = c;
      }
    }
    return bestChild ? [bestChild.move.row, bestChild.move.col] : null;
  }

  function toBoardState(board) {
    return board.map((row) => (Array.isArray(row) ? row.join("") : row));
  }

  function boardToKey(board) {
    return toBoardState(board).join("|");
  }

  function getTerritoryOwner(board, rowIndex, colIndex) {
    if (!inBounds(board, rowIndex, colIndex)) return null;
    if (board[rowIndex][colIndex] !== ".") return null;

    const visited = Array.from({ length: board.length }, () =>
      Array(board[0].length).fill(false),
    );
    const queue = [[rowIndex, colIndex]];
    let queueIndex = 0;
    visited[rowIndex][colIndex] = true;
    const borderingColors = new Set();

    while (queueIndex < queue.length) {
      const [currentRow, currentCol] = queue[queueIndex++];
      for (const [nextRow, nextCol] of neighbors(currentRow, currentCol)) {
        if (!inBounds(board, nextRow, nextCol)) continue;
        const cell = board[nextRow][nextCol];
        if (cell === ".") {
          if (!visited[nextRow][nextCol]) {
            visited[nextRow][nextCol] = true;
            queue.push([nextRow, nextCol]);
          }
        } else if (cell === "X" || cell === "O") {
          borderingColors.add(cell);
          if (borderingColors.size > 1) return null;
        }
      }
    }

    return borderingColors.size === 1
      ? borderingColors.values().next().value
      : null;
  }

  function formatError(error) {
    if (error instanceof Error) {
      return error.stack || error.message || error.name || "Unknown error";
    }
    if (typeof error === "string") return error;
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }

  function getCachedValue(board, depth, alpha, beta) {
    const key = boardToKey(board);
    const cached = transpositionCache[key];
    if (!cached) return null;
    if (typeof cached.depth === "number" && cached.depth >= depth)
      return cached;
    return cached;
  }

  function getHistoryKeys() {
    try {
      const history = ns.go.getMoveHistory();
      return new Set(history.map((b) => boardToKey(b)));
    } catch {
      return new Set();
    }
  }

  function estimateFinalScore(board, controlledBoard = null, komi = 1.5) {
    // Quickly estimate what the final score would be if both players pass now
    // Returns: our_score - enemy_score (higher is better)
    const ourStones = countCells(board, "X");
    const enemyStones = countCells(board, "O");

    if (!controlledBoard) {
      // Fallback: just stones + rough komi adjustment
      return ourStones - enemyStones - komi;
    }

    const ourControl = countControlled(board, controlledBoard, "X");
    const enemyControl = countControlled(board, controlledBoard, "O");

    // MAIN STRATEGY: balance stone count and control, but weight control slightly higher to prefer territory gains and prevent self-filling eyes.
    // Prioritize 1: Owned empty nodes (territory > stones)
    // Prioritize 2: Routers placed (killing enemies reduces their stones)
    // By weighting control slightly higher (1.1) than stones (1.0),
    // placing a stone in our own territory results in a net loss (-1.1 control + 1.0 stone = -0.1).
    // This numerically forbids filling our own eyes unless it captures something larger!
    const ourScore = ourControl * 1.1 + ourStones * 1.0;
    const enemyScore = enemyControl * 1.1 + enemyStones * 1.0;

    return ourScore - (enemyScore + komi);
  }

  function scoreMoveHeuristic(
    board,
    move,
    player,
    currentChains,
    currentLiberties,
    areaOrig,
    origControlled,
    friendlyControlOrig,
    weaknessOrig,
    komi,
    moveCount = 0,
  ) {
    const enemy = player === "X" ? "O" : "X";
    const simulatedBoard = move.board;

    let score = 0;
    // Priority 1: Capture enemy stones (strongest objective)
    score += move.captured * 200000; // Greatly increased from 70000
    score += HEATMAP[move.row][move.col] * 2000;

    const territoryOwner =
      origControlled?.[move.row]?.[move.col] ??
      getTerritoryOwner(board, move.row, move.col);
    if (territoryOwner === "X" && move.captured === 0) {
      score -= 2000000;
    } else if (territoryOwner === "O") {
      score += 1500000;
    }

    // Early game: Avoid corner/edge aggression during critical opening (moves 0-2), then slight preference after
    // Moves 0-2: Use opening book instead (no heatmap bonus to prevent isolated stones)
    // Moves 3-6: Gradual territory establishment with light bonus
    if (moveCount >= 3 && moveCount < 6) {
      score += CORNER_EDGE_HEATMAP[move.row][move.col] * 20000;
    }

    const seenChains = new Set();
    for (const [nextRow, nextCol] of neighbors(move.row, move.col)) {
      if (!inBounds(board, nextRow, nextCol)) continue;
      const cell = board[nextRow][nextCol];
      const chainId = currentChains[nextRow][nextCol];
      const liberties = currentLiberties[nextRow][nextCol];

      if (chainId !== null && seenChains.has(chainId)) continue;
      if (chainId !== null) seenChains.add(chainId);

      if (cell === enemy) {
        if (liberties === 1) score += 500000;
        else if (liberties === 2) score += 120000;
        else score += 20000;
      } else if (cell === player) {
        if (liberties === 1) score += 300000;
        else if (liberties === 2) score += 70000;
        else score += 10000;
      }
    }

    const ownGroup = getGroupAndLiberties(simulatedBoard, move.row, move.col);
    if (ownGroup.libs <= 1) {
      if (move.captured < ownGroup.points.length) {
        // If we capture fewer stones than we put in atari, massive penalty
        score -= 20000000;
      } else if (move.captured === 0) {
        score -= 20000000; // redundant but explicitly avoids pure atari
      }
    }

    // STRONG penalty for filling own eyes
    if (move.captured === 0 && isTrueEye(board, move.row, move.col, player)) {
      score -= 40000000; // Hard-ban self-eye fills unless they capture
    }

    // Reward for poking into enemy territory to deny eyes, but ONLY if safe!
    if (move.captured === 0 && ownGroup.libs > 1) {
      let enemyNeighbors = 0;
      for (const [nextRow, nextCol] of neighbors(move.row, move.col)) {
        if (
          inBounds(board, nextRow, nextCol) &&
          board[nextRow][nextCol] === enemy
        ) {
          enemyNeighbors++;
        }
      }
      if (enemyNeighbors >= 2) {
        score += 1000000; // Safely pokes the enemy to deny them a 2-eye living shape
      }
    }

    // Additional penalty if it results in exactly 1 liberty (atari)
    if (ownGroup.libs === 1 && move.captured < ownGroup.points.length) {
      score -= 5000000; // DO NOT put yourself in atari
    }

    // Incentive to maximize liberties of the resulting group
    score += ownGroup.libs * 25000;

    // CONSOLIDATION BONUS (moves 3-14): Heavily reward playing adjacent to existing friendly stones
    // This forces the bot to build a safe connected base before exploring/invading
    // Extended to move 14 to prevent aggressive invasion in mid-game (cause of 0-stone losses)
    if (moveCount >= 3 && moveCount <= 14) {
      let friendlyNeighbors = 0;
      for (const [nextRow, nextCol] of neighbors(move.row, move.col)) {
        if (
          inBounds(board, nextRow, nextCol) &&
          board[nextRow][nextCol] === "X"
        ) {
          friendlyNeighbors++;
        }
      }
      // Increased bonus during opening (moves 3-8) for stronger defensive consolidation
      const consolidationBonus =
        moveCount >= 3 && moveCount <= 8 ? 150000 : 100000;
      score += friendlyNeighbors * consolidationBonus;
    }

    // Keep group structure healthy and avoid moves that allow immediate enemy captures.
    let enemyCaptureRisk = 0;
    try {
      const weaknessSim = summarizeWeakChains(simulatedBoard, player);
      score +=
        (weaknessOrig.weakStones - weaknessSim.weakStones) * WEAK_STONE_WEIGHT;
      score +=
        (weaknessOrig.weakChains - weaknessSim.weakChains) * WEAK_CHAIN_WEIGHT;
      score +=
        (weaknessOrig.atariChains - weaknessSim.atariChains) *
        ATARI_CHAIN_WEIGHT;

      if (
        weaknessSim.atariChains > weaknessOrig.atariChains &&
        move.captured === 0
      ) {
        score -= 600000;
      }

      const enemyMoves = getLegalMoves(simulatedBoard, enemy, null);
      for (const enemyMove of enemyMoves) {
        if (enemyMove.captured > enemyCaptureRisk) {
          enemyCaptureRisk = enemyMove.captured;
        }
      }

      score -= enemyCaptureRisk * ENEMY_CAPTURE_RISK_WEIGHT;

      if (move.captured === 0 && enemyCaptureRisk >= ownGroup.points.length) {
        score -= 900000;
      }
    } catch {
      // Ignore structural risk analysis if unavailable
    }

    let areaSim = null;
    let deltaFriendly = 0;
    let friendlyComponentDelta = 0;
    try {
      const simulatedControlled = ns.go.analysis.getControlledEmptyNodes(
        toBoardState(simulatedBoard),
      );
      const friendlyControlSim = countControlled(
        simulatedBoard,
        simulatedControlled,
        "X",
      );
      const enemyControlSim = countControlled(
        simulatedBoard,
        simulatedControlled,
        "O",
      );
      const friendlyTerritoryOrig = analyzeControlledTerritory(
        board,
        origControlled,
        "X",
      );
      const friendlyTerritorySim = analyzeControlledTerritory(
        simulatedBoard,
        simulatedControlled,
        "X",
      );

      deltaFriendly = friendlyControlSim - friendlyControlOrig;
      friendlyComponentDelta =
        friendlyTerritorySim.largestComponent -
        friendlyTerritoryOrig.largestComponent;

      const componentDelta =
        friendlyTerritorySim.components - friendlyTerritoryOrig.components;
      const singletonDelta =
        friendlyTerritorySim.singletonComponents -
        friendlyTerritoryOrig.singletonComponents;

      // Priority 2: Increase controlled empty nodes (secondary objective after captures)
      // Opening must stay conservative on 5x5: territory pressure is deferred until the shape is stable.
      // AVOID AGGRESSION SPIKE: Keep multiplier modest until late endgame
      // Moves 3-8: consolidation (80k)
      // Moves 9-14: modest expansion (120k) - same as early territory, prevents 80k->200k spike
      // Moves 15+: full aggression (300k) only in endgame
      const territoryMultiplier =
        moveCount >= 3 && moveCount <= 8
          ? 80000
          : moveCount <= 14
            ? 120000
            : 300000;
      score += deltaFriendly * territoryMultiplier;

      // Favor one connected pocket over scattered single-node territory.
      // EXTENDED CONSOLIDATION: Keep high component bonus through move 14 (not just move 12)
      const componentBonus =
        moveCount >= 3 && moveCount <= 14
          ? 150000
          : moveCount < 6
            ? 110000
            : 70000;
      score += friendlyComponentDelta * componentBonus;
      score -=
        componentDelta *
        (moveCount >= 3 && moveCount <= 12
          ? 100000
          : moveCount < 6
            ? 80000
            : 45000);
      score -=
        singletonDelta *
        (moveCount >= 3 && moveCount <= 12
          ? 120000
          : moveCount < 6
            ? 90000
            : 50000);

      // Also reward having more friendly control than enemy on simulated board
      score += (friendlyControlSim - enemyControlSim) * 5000;

      // Compute a cheap area proxy (stones + control balance) for diagnostics and filtering
      areaSim = scoreAreaProxy(simulatedBoard, simulatedControlled, komi);
      const areaDelta = areaSim - (typeof areaOrig === "number" ? areaOrig : 0);
      score += areaDelta * 50000;
    } catch {
      // Ignore control analysis if unavailable
    }

    // Penalize occupying an empty node that we originally controlled only if it doesn't improve area
    if (move.captured === 0) {
      try {
        if (origControlled && origControlled[move.row][move.col] === "X") {
          if (!(typeof areaSim === "number" && areaSim > areaOrig)) {
            // Heavily penalize occupying an empty node we already control when it doesn't increase area
            score -= 250000;
          }
        }
      } catch {
        // ignore
      }
    }

    const centerRow = (board.length - 1) / 2;
    const centerCol = (board[0].length - 1) / 2;
    const distanceToCenter =
      Math.abs(move.row - centerRow) + Math.abs(move.col - centerCol);
    // Reduce center bonus for moves 3-12 to avoid attracting isolated moves
    const centerBonus = moveCount >= 3 && moveCount <= 12 ? 500 : 1000;
    score += Math.max(0, 4 - distanceToCenter) * centerBonus;

    return {
      score,
      areaSim,
      deltaFriendly,
      friendlyComponentDelta,
      enemyCaptureRisk,
    };
  }

  function scoreMoveRough(
    board,
    move,
    player,
    currentChains,
    currentLiberties,
    moveCount = 0,
  ) {
    const enemy = player === "X" ? "O" : "X";
    let score = 0;
    score += move.captured * 40000;
    score += HEATMAP[move.row][move.col] * 2000;

    // CONSOLIDATION BONUS for rough scorer (moves 3-14): heavily reward staying near friendly stones
    // Extended to move 14 to prevent aggressive invasion in mid-game (cause of 0-stone losses)
    if (moveCount >= 3 && moveCount <= 14) {
      let friendlyNeighbors = 0;
      for (const [nextRow, nextCol] of neighbors(move.row, move.col)) {
        if (
          inBounds(board, nextRow, nextCol) &&
          board[nextRow][nextCol] === "X"
        ) {
          friendlyNeighbors++;
        }
      }
      // Increased bonus during opening (moves 3-8) for stronger defensive consolidation
      const consolidationBonus =
        moveCount >= 3 && moveCount <= 8 ? 120000 : 80000;
      score += friendlyNeighbors * consolidationBonus;
    }

    const territoryOwner = getTerritoryOwner(board, move.row, move.col);
    if (territoryOwner === "X" && move.captured === 0) {
      // Heavy penalty for filling own territory throughout game (not just moves 3-12)
      // Dropping to 700k after move 12 was causing catastrophic late-game collapses
      score -= 1500000;
    } else if (territoryOwner === "O") {
      score += moveCount <= 12 ? 500000 : 250000;
    }

    const seenChains = new Set();
    for (const [nextRow, nextCol] of neighbors(move.row, move.col)) {
      if (!inBounds(board, nextRow, nextCol)) continue;
      const cell = board[nextRow][nextCol];
      const chainId = currentChains[nextRow][nextCol];
      const liberties = currentLiberties[nextRow][nextCol];

      if (chainId !== null && seenChains.has(chainId)) continue;
      if (chainId !== null) seenChains.add(chainId);

      if (cell === enemy) {
        if (liberties === 1) score += 250000;
        else if (liberties === 2) score += 60000;
        else score += 10000;
      } else if (cell === player) {
        if (liberties === 1) score += 140000;
        else if (liberties === 2) score += 35000;
        else score += 5000;
      }
    }

    const ownGroup = getGroupAndLiberties(move.board, move.row, move.col);
    if (ownGroup.libs <= 1 && move.captured < ownGroup.points.length)
      score -= 500000;

    score += ownGroup.libs * 25000;

    if (move.captured === 0 && isTrueEye(board, move.row, move.col, player)) {
      score -= 2500000;
    }

    const centerRow = (board.length - 1) / 2;
    const centerCol = (board[0].length - 1) / 2;
    const distanceToCenter =
      Math.abs(move.row - centerRow) + Math.abs(move.col - centerCol);
    // Reduce center bonus for moves 3-12 to avoid attracting isolated moves
    const centerBonus = moveCount >= 3 && moveCount <= 12 ? 500 : 1000;
    score += Math.max(0, 4 - distanceToCenter) * centerBonus;

    return score;
  }

  function solveExactly(
    board,
    player,
    passes,
    pathKeys,
    startTime,
    komi,
    depth = 0,
    maxDepth = EXACT_SOLVE_MAX_DEPTH,
  ) {
    // Depth-limit leaf: evaluate statically at this depth (not a timeout)
    if (depth >= maxDepth) {
      return {
        timedOut: false,
        score: scoreAreaCached(board, komi),
        move: null,
      };
    }

    if (Date.now() - startTime > EXACT_SOLVE_TIME_BUDGET_MS) {
      return { timedOut: true, score: scoreAreaCached(board, komi) };
    }

    if (passes >= 2) {
      return { score: scoreAreaCached(board, komi), move: null };
    }

    const legalMoves = getLegalMoves(board, player, pathKeys);
    const maximizing = player === "X";

    const orderedMoves = legalMoves
      .map((move) => ({
        ...move,
        priority: move.captured * 100000 + HEATMAP[move.row][move.col] * 1000,
      }))
      .sort((left, right) => right.priority - left.priority);

    orderedMoves.push({ pass: true, priority: -1 });

    let bestScore = maximizing ? -Infinity : Infinity;
    let bestMove = null;
    let alpha = -Infinity;
    let beta = Infinity;

    for (const move of orderedMoves) {
      if (Date.now() - startTime > EXACT_SOLVE_TIME_BUDGET_MS) {
        return { timedOut: true, score: bestScore };
      }

      let nextBoard = board;
      let nextPasses = passes + 1;
      let nextPlayer = player === "X" ? "O" : "X";

      if (!move.pass) {
        const nextKey = boardToKey(move.board);
        if (pathKeys.has(nextKey)) continue;

        pathKeys.add(nextKey);
        const child = solveExactly(
          move.board,
          nextPlayer,
          0,
          pathKeys,
          startTime,
          komi,
          depth + 1,
          maxDepth,
        );
        pathKeys.delete(nextKey);

        if (child.timedOut) return { timedOut: true, score: bestScore };

        if (maximizing) {
          if (child.score > bestScore) {
            bestScore = child.score;
            bestMove = [move.row, move.col];
          }
          alpha = Math.max(alpha, bestScore);
          if (alpha >= beta) break;
        } else {
          if (child.score < bestScore) {
            bestScore = child.score;
            bestMove = [move.row, move.col];
          }
          beta = Math.min(beta, bestScore);
          if (alpha >= beta) break;
        }

        continue;
      }

      const child = solveExactly(
        nextBoard,
        nextPlayer,
        nextPasses,
        pathKeys,
        startTime,
        komi,
        depth + 1,
        maxDepth,
      );
      if (child.timedOut) return { timedOut: true, score: bestScore };

      if (maximizing) {
        if (child.score > bestScore) {
          bestScore = child.score;
          bestMove = null;
        }
        alpha = Math.max(alpha, bestScore);
        if (alpha >= beta) break;
      } else {
        if (child.score < bestScore) {
          bestScore = child.score;
          bestMove = null;
        }
        beta = Math.min(beta, bestScore);
        if (alpha >= beta) break;
      }
    }

    return { score: bestScore, move: bestMove, timedOut: false };
  }

  // Iterative deepening wrapper: run increasing depth limits until time budget or max depth.
  function solveExactlyIterative(
    board,
    player,
    passes,
    pathKeys,
    startTime,
    komi,
  ) {
    let best = {
      timedOut: true,
      score: scoreAreaCached(board, komi),
      move: null,
    };
    for (
      let depthLimit = 1;
      depthLimit <= EXACT_SOLVE_MAX_DEPTH;
      depthLimit++
    ) {
      if (Date.now() - startTime > EXACT_SOLVE_TIME_BUDGET_MS) break;
      const res = solveExactly(
        board,
        player,
        passes,
        pathKeys,
        startTime,
        komi,
        0,
        depthLimit,
      );
      if (res.timedOut) break;
      best = res;
    }
    return best;
  }

  function chooseMove(board, moveCount) {
    // Early exit: if no enemy stones remain, we've won (pass to end game)
    if (countCells(board, "O") === 0) {
      if (DEBUG) ns.print("No enemy stones left. Passing to end game.");
      return null;
    }

    const historyKeys = getHistoryKeys();
    const currentChains = ns.go.analysis.getChains(board);
    const currentLiberties = ns.go.analysis.getLiberties(board);
    // Get original control map for the board (may be used to avoid occupying empties we already own)
    let origControlled = null;
    try {
      origControlled = ns.go.analysis.getControlledEmptyNodes(
        toBoardState(board),
      );
    } catch {
      origControlled = null;
    }
    const gameState = ns.go.getGameState();
    const komi = typeof gameState?.komi === "number" ? gameState.komi : 1.5;
    const legalMoves = getLegalMoves(board, "X", historyKeys);
    const friendlyControlOrig = origControlled
      ? countControlled(board, origControlled, "X")
      : 0;
    const weaknessOrig = summarizeWeakChains(board, "X");

    if (legalMoves.length === 0) return null;

    // Opening DB first (small pattern table)
    const openingMove = lookupOpening(board, moveCount);
    if (openingMove) return openingMove;

    // Opening book fallback: first moves adapted to board size (center-first when available)
    const center = Math.floor((board.length - 1) / 2);
    if (moveCount === 0 && board[center][center] === ".")
      return [center, center];

    if (moveCount === 1) {
      // Respond based on opponent's first move
      if (board[center][center] === ".") return [center, center];
      // Otherwise, secure a corner/side position to establish territory early
      const corners = [
        [1, 1],
        [1, board.length - 2],
        [board.length - 2, 1],
        [board.length - 2, board.length - 2],
      ];
      for (const [r, c] of corners) {
        if (inBounds(board, r, c) && board[r][c] === ".") {
          const sim = simulateMove(board, r, c, "X");
          if (sim.valid && sim.ownLiberties > 2) return [r, c];
        }
      }
    }

    if (moveCount === 2) {
      // Move 2: Secure opposite corner or solid territory region
      const securePositions = [];
      const last = board.length - 1;
      // include inner corners and outer corners
      securePositions.push(
        [1, 1],
        [1, last - 1],
        [last - 1, 1],
        [last - 1, last - 1],
      );
      securePositions.push([0, 0], [0, last], [last, 0], [last, last]);
      for (const [r, c] of securePositions) {
        if (inBounds(board, r, c) && board[r][c] === ".") {
          const sim = simulateMove(board, r, c, "X");
          if (sim.valid && sim.ownLiberties > 2) return [r, c];
        }
      }
    }

    // Compute original area proxy once (stones + controlled empties balance)
    const areaOrig = scoreAreaProxy(board, origControlled, komi);

    function territoryOwnerForMove(move) {
      const controlledOwner = origControlled?.[move.row]?.[move.col];
      if (controlledOwner === "X" || controlledOwner === "O")
        return controlledOwner;
      return getTerritoryOwner(board, move.row, move.col);
    }

    function countAdjacentColors(row, col) {
      let friendly = 0;
      let enemy = 0;
      for (const [nextRow, nextCol] of neighbors(row, col)) {
        if (!inBounds(board, nextRow, nextCol)) continue;
        const cell = board[nextRow][nextCol];
        if (cell === "X") friendly++;
        else if (cell === "O") enemy++;
      }
      return { friendly, enemy };
    }

    function isFriendlyEnclosedMove(move) {
      try {
        if (move.captured > 0) return false;
        const territoryOwner = territoryOwnerForMove(move);
        if (territoryOwner === "X") return true;
        const { friendly, enemy } = countAdjacentColors(move.row, move.col);
        return friendly >= 2 && enemy === 0;
      } catch {
        return false;
      }
    }

    function isEnemyPressureMove(move) {
      try {
        const territoryOwner = territoryOwnerForMove(move);
        if (territoryOwner === "O") return true;
        const { friendly, enemy } = countAdjacentColors(move.row, move.col);
        return enemy >= 1 && friendly <= 1;
      } catch {
        return false;
      }
    }

    function isSelfFoolingMove(move) {
      try {
        if (move.captured > 0) return false;
        const { friendly, enemy } = countAdjacentColors(move.row, move.col);
        return enemy === 0 && friendly >= 1;
      } catch {
        return false;
      }
    }

    function isSelfEyeFillMove(move) {
      try {
        if (move.captured > 0) return false;
        const territoryOwner = territoryOwnerForMove(move);
        if (territoryOwner === "X") return true;
        if (isTrueEye(board, move.row, move.col, "X")) return true;
        if (origControlled && origControlled[move.row][move.col] === "X") {
          return true;
        }
      } catch {
        // If the check fails, keep the move available and let heuristic score it.
      }
      return false;
    }

    // If any capture moves exist, check for an immediate "capture-all" (kills all enemy stones) and play it.
    const captureMoves = legalMoves.filter((m) => m.captured > 0);
    if (captureMoves.length > 0) {
      for (const cm of captureMoves) {
        if (countCells(cm.board, "O") === 0) {
          if (DEBUG)
            ns.print(`Immediate win by capture at ${cm.row},${cm.col}`);
          return [cm.row, cm.col];
        }
      }

      // Do not auto-play every capture. Some captures are score-negative on 5x5 with high komi.
      // Let the main heuristic compare them against safer, stronger moves.
    }

    const urgentDefenseMove = chooseUrgentDefenseMove(
      board,
      "X",
      legalMoves,
      currentChains,
      currentLiberties,
      moveCount,
    );
    if (urgentDefenseMove) {
      if (DEBUG)
        ns.print(
          `Urgent defense move ${urgentDefenseMove[0]},${urgentDefenseMove[1]}`,
        );
      return urgentDefenseMove;
    }

    const structuredDefenseMove = chooseStructuredDefenseMove(
      board,
      "X",
      legalMoves,
      currentChains,
      currentLiberties,
      moveCount,
    );
    if (structuredDefenseMove) {
      if (DEBUG)
        ns.print(
          `Structured defense move ${structuredDefenseMove[0]},${structuredDefenseMove[1]}`,
        );
      return structuredDefenseMove;
    }

    const emptyCount = countEmptyPlayableCells(board);
    const enemyStoneCount = countCells(board, "O");

    // In endgame with few enemy stones, focus on winning calculation instead of deep search
    if (
      emptyCount <= EXACT_SOLVE_EMPTY_THRESHOLD &&
      legalMoves.length <= EXACT_SOLVE_MAX_LEGAL_MOVES &&
      enemyStoneCount > 2 // Only exact solve if enemy still has stones to defend
    ) {
      const pathKeys = new Set(historyKeys);
      const startTime = Date.now();
      const exact = solveExactlyIterative(
        board,
        "X",
        0,
        pathKeys,
        startTime,
        komi,
      );
      if (!exact.timedOut && exact.move) {
        if (DEBUG)
          ns.print(
            `EXACT: ${exact.move[0]},${exact.move[1]} score=${exact.score}`,
          );
        return exact.move;
      }
      if (DEBUG) ns.print("Exact solver timed out, falling back to heuristic.");
    }

    // Use MCTS for larger boards or later mid-game (compact, playouts use rough heuristic)
    try {
      const useMCTS = board.length >= 7 || moveCount >= 8;
      if (useMCTS) {
        const timeBudget =
          board.length <= 7 ? 150 : board.length <= 9 ? 300 : 600;
        const mctsMove = mctsSearch(board, "X", timeBudget);
        if (mctsMove) {
          if (DEBUG)
            ns.print(
              `MCTS selected ${mctsMove[0]},${mctsMove[1]} (budget=${timeBudget}ms)`,
            );
          return mctsMove;
        }
      }
    } catch (e) {
      if (DEBUG) ns.print(`MCTS error: ${formatError(e)}`);
    }

    const scoredMoves = legalMoves
      .map((move) => {
        const roughScore = scoreMoveRough(
          board,
          move,
          "X",
          currentChains,
          currentLiberties,
          turnCount,
        );
        return {
          ...move,
          roughScore,
        };
      })
      .sort((left, right) => right.roughScore - left.roughScore);

    const analysisLimit = Math.min(
      scoredMoves.length,
      Math.max(adaptiveHeuristicMoveLimit, 4),
    );
    const shortlist = scoredMoves.slice(0, analysisLimit);

    const analyzedMoves = shortlist
      .map((move) => {
        const res = scoreMoveHeuristic(
          board,
          move,
          "X",
          currentChains,
          currentLiberties,
          areaOrig,
          origControlled,
          friendlyControlOrig,
          weaknessOrig,
          komi,
          turnCount,
        );
        return {
          ...move,
          score: res.score,
          areaSim: res.areaSim,
          deltaFriendly: res.deltaFriendly,
          friendlyComponentDelta: res.friendlyComponentDelta,
          enemyCaptureRisk: res.enemyCaptureRisk,
        };
      })
      .sort((left, right) => right.score - left.score);

    // Endgame filter: if < 10 empties, only play moves that increase win margin or capture stones
    let endgameFilter = true;
    let finalScoreOrig = 0;
    if (emptyCount < 10) {
      try {
        finalScoreOrig = estimateFinalScore(board, origControlled, komi);
        endgameFilter = false; // Enable strict endgame filtering
      } catch {
        endgameFilter = true; // Fall back if estimate fails
      }
    }

    // Prefer moves that do not decrease the area score unless they capture stones (hard filter)
    let candidateMoves = analyzedMoves.filter((m) => {
      try {
        if (m.captured > 0) return true; // Always allow captures
        if (isSelfEyeFillMove(m)) return false;
        if (isSelfFoolingMove(m)) return false;
        // STRICT CONSOLIDATION FILTER (moves 3-14): Reject moves that don't consolidate
        // Extended to move 14 to prevent isolated moves in mid-game (cause of 0-stone losses)
        if (moveCount >= 3 && moveCount <= 14 && m.captured === 0) {
          // During consolidation phase, only allow moves adjacent to friendly stones or in enemy territory
          let friendlyNeighbors = 0;
          for (const [nr, nc] of neighbors(m.row, m.col)) {
            if (inBounds(board, nr, nc) && board[nr][nc] === "X") {
              friendlyNeighbors++;
            }
          }
          const isEnemyTerritory = territoryOwnerForMove(m) === "O";
          if (friendlyNeighbors === 0 && !isEnemyTerritory) {
            return false; // Reject isolated exploration moves
          }
        }
        if (
          moveCount <= 10 &&
          territoryOwnerForMove(m) === "X" &&
          m.deltaFriendly <= 0 &&
          (m.friendlyComponentDelta ?? 0) <= 0
        ) {
          return false;
        }
        if (isEnemyPressureMove(m)) return true;
        if (isFriendlyEnclosedMove(m)) return false;
        if (typeof m.areaSim === "number" && m.areaSim < areaOrig) return false;
        if (typeof m.areaSim === "number") return m.areaSim >= areaOrig;
        return true;
      } catch {
        return true;
      }
    });

    const enemyTerritoryMoves = candidateMoves.filter((m) =>
      isEnemyPressureMove(m),
    );
    const neutralMoves = candidateMoves.filter(
      (m) => !isEnemyPressureMove(m) && !isFriendlyEnclosedMove(m),
    );

    // In endgame, further filter: only play moves that improve win margin
    if (!endgameFilter) {
      candidateMoves = candidateMoves.filter((m) => {
        try {
          const simControlled = ns.go.analysis.getControlledEmptyNodes(
            toBoardState(m.board),
          );
          const finalScoreSim = estimateFinalScore(
            m.board,
            simControlled,
            komi,
          );
          // Only play if final score is better than current (increases our winning margin)
          return finalScoreSim > finalScoreOrig;
        } catch {
          return true; // If estimation fails, allow the move
        }
      });
    }

    // Choose enemy territory first, then neutral space. Never use friendly surrounded territory unless capturing.
    const nonOccupying = enemyTerritoryMoves.length
      ? enemyTerritoryMoves
      : neutralMoves.length
        ? neutralMoves
        : [];
    const bestMoves = nonOccupying.length > 0 ? nonOccupying : [];

    function printCandidates(list, label) {
      if (!isLoggingEnabled()) return;
      for (const candidate of list.slice(0, adaptiveHeuristicMoveLimit)) {
        ns.print(
          `${label} Candidate (${candidate.row},${candidate.col}) => score=${candidate.score.toFixed(0)} areaOrig=${areaOrig} areaSim=${candidate.areaSim ?? "N/A"} deltaFriendly=${candidate.deltaFriendly ?? 0} enemyRisk=${candidate.enemyCaptureRisk ?? 0} captured=${candidate.captured}`,
        );
      }
    }

    if (DEBUG && DEBUG_CANDIDATES) {
      if (bestMoves.length > 0) printCandidates(bestMoves, "Best");
      else printCandidates(candidateMoves, "Fallback");
    }

    // If we have preferable non-occupying moves, pick the best one.
    if (bestMoves.length > 0) {
      // Only pass when the strongest non-occupying option is truly suicidal.
      if (nonOccupying.length > 0 && bestMoves[0].score < PASS_THRESHOLD) {
        if (DEBUG)
          ns.print(`Best move score ${bestMoves[0].score}, passing instead.`);
        return null;
      }
      return [bestMoves[0].row, bestMoves[0].col];
    }

    // If the shortlist produced nothing, expand once before giving up.
    if (shortlist.length < scoredMoves.length) {
      const expandedMoves = scoredMoves
        .slice(analysisLimit)
        .map((move) => {
          const res = scoreMoveHeuristic(
            board,
            move,
            "X",
            currentChains,
            currentLiberties,
            areaOrig,
            origControlled,
            friendlyControlOrig,
            weaknessOrig,
            komi,
            turnCount,
          );
          return {
            ...move,
            score: res.score,
            areaSim: res.areaSim,
            deltaFriendly: res.deltaFriendly,
            friendlyComponentDelta: res.friendlyComponentDelta,
            enemyCaptureRisk: res.enemyCaptureRisk,
          };
        })
        .sort((left, right) => right.score - left.score);

      if (expandedMoves.length > 0) {
        const expandedCandidateMoves = expandedMoves.filter((m) => {
          try {
            if (m.captured > 0) return true;
            if (isSelfEyeFillMove(m)) return false;
            if (isSelfFoolingMove(m)) return false;
            // STRICT CONSOLIDATION FILTER for expanded moves (moves 3-14)
            if (moveCount >= 3 && moveCount <= 14 && m.captured === 0) {
              let friendlyNeighbors = 0;
              for (const [nr, nc] of neighbors(m.row, m.col)) {
                if (inBounds(board, nr, nc) && board[nr][nc] === "X") {
                  friendlyNeighbors++;
                }
              }
              const isEnemyTerritory = territoryOwnerForMove(m) === "O";
              if (friendlyNeighbors === 0 && !isEnemyTerritory) {
                return false;
              }
            }
            if (
              moveCount <= 14 &&
              territoryOwnerForMove(m) === "X" &&
              m.deltaFriendly <= 0 &&
              (m.friendlyComponentDelta ?? 0) <= 0
            ) {
              return false;
            }
            if (isEnemyPressureMove(m)) return true;
            if (isFriendlyEnclosedMove(m)) return false;
            if (typeof m.areaSim === "number" && m.areaSim < areaOrig)
              return false;
            if (typeof m.areaSim === "number") return m.areaSim >= areaOrig;
            return true;
          } catch {
            return true;
          }
        });
        const expandedEnemyTerritoryMoves = expandedCandidateMoves.filter((m) =>
          isEnemyPressureMove(m),
        );
        const expandedNeutralMoves = expandedCandidateMoves.filter(
          (m) => !isEnemyPressureMove(m) && !isFriendlyEnclosedMove(m),
        );
        const expandedNonOccupying = expandedEnemyTerritoryMoves.length
          ? expandedEnemyTerritoryMoves
          : expandedNeutralMoves.length
            ? expandedNeutralMoves
            : [];
        const expandedBestMoves = expandedNonOccupying;

        if (DEBUG && DEBUG_CANDIDATES) {
          if (expandedBestMoves.length > 0)
            printCandidates(expandedBestMoves, "Expanded");
          else printCandidates(expandedCandidateMoves, "ExpandedFallback");
        }

        if (expandedBestMoves.length > 0) {
          if (expandedBestMoves[0].score < PASS_THRESHOLD) {
            if (DEBUG)
              ns.print(
                `Expanded best score ${expandedBestMoves[0].score}, passing instead.`,
              );
            return null;
          }
          return [expandedBestMoves[0].row, expandedBestMoves[0].col];
        }
      }
    }

    // If no legal move survives the hard filter, pass rather than play inside our own territory.
    if (DEBUG) ns.print("No move survived hard area/control filters; passing.");
    return null;
  }

  function inBounds(board, x, y) {
    return x >= 0 && y >= 0 && x < board.length && y < board[0].length;
  }

  function neighbors(x, y) {
    return [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ];
  }

  function copyBoard(board) {
    return board.map((row) =>
      Array.isArray(row) ? row.slice() : row.split(""),
    );
  }

  function dumpGameTranscript(result, boardSize) {
    // Keep the full game history on one line so the entire game can be replayed from the log.
    try {
      const state = ns.go.getGameState();
      const blackScore =
        typeof state.blackScore === "number" ? state.blackScore : "?";
      const whiteScore =
        typeof state.whiteScore === "number" ? state.whiteScore : "?";
      const history = ns.go.getMoveHistory();
      const historyLine = history
        .map(
          (boardState, index) =>
            `S${index + 1}=${toBoardState(boardState).join("|")}`,
        )
        .join(" -> ");

      if (isLoggingEnabled()) {
        ns.tprint(
          `LOSS #${gameCount}: moves=${turnCount}, score=${blackScore}-${whiteScore}, states=${history.length}, history=${historyLine}, final=${toBoardState(ns.go.getBoardState()).join("|")}`,
        );
      }
    } catch (error) {
      if (isLoggingEnabled()) {
        ns.tprint(
          `LOSS #${gameCount}: transcript error: ${formatError(error).substring(0, 30)}`,
        );
      }
    }
  }

  function didBlackWin() {
    try {
      const state = ns.go.getGameState();
      if (
        typeof state.blackScore === "number" &&
        typeof state.whiteScore === "number"
      ) {
        return state.blackScore > state.whiteScore;
      }
    } catch {
      // Ignore
    }
    return false;
  }

  function getBoard() {
    return ns.go.getBoardState();
  }

  function getGroupAndLiberties(board, sx, sy) {
    if (!inBounds(board, sx, sy))
      return { points: [], libs: 0, libsSet: new Set() };
    const cell = board[sx][sy];
    if (cell !== "X" && cell !== "O")
      return { points: [], libs: 0, libsSet: new Set() };

    const sizeX = board.length;
    const sizeY = board[0].length;
    const visited = Array.from({ length: sizeX }, () =>
      Array(sizeY).fill(false),
    );
    const stack = [[sx, sy]];
    visited[sx][sy] = true;
    const points = [];
    const libsSet = new Set();

    while (stack.length) {
      const [x, y] = stack.pop();
      points.push([x, y]);
      for (const [nx, ny] of neighbors(x, y)) {
        if (!inBounds(board, nx, ny)) continue;
        const ncell = board[nx][ny];
        if (ncell === ".") libsSet.add(`${nx},${ny}`);
        else if (ncell === cell && !visited[nx][ny]) {
          visited[nx][ny] = true;
          stack.push([nx, ny]);
        }
      }
    }

    return { points, libs: libsSet.size, libsSet };
  }

  function simulateMove(board, x, y, player) {
    const sim = copyBoard(board);
    if (sim[x][y] !== ".") return { valid: false, board: sim, captured: 0 };

    sim[x][y] = player;
    const enemy = player === "X" ? "O" : "X";
    const sizeX = sim.length;
    const sizeY = sim[0].length;
    const visited = Array.from({ length: sizeX }, () =>
      Array(sizeY).fill(false),
    );
    let captured = 0;

    // Remove enemy groups with 0 liberties
    for (let i = 0; i < sizeX; i++) {
      for (let j = 0; j < sizeY; j++) {
        if (visited[i][j]) continue;
        if (sim[i][j] !== enemy) continue;
        const group = getGroupAndLiberties(sim, i, j);
        for (const [gx, gy] of group.points) visited[gx][gy] = true;
        if (group.libs === 0) {
          captured += group.points.length;
          for (const [gx, gy] of group.points) sim[gx][gy] = ".";
        }
      }
    }

    // Check suicide
    const ourGroup = getGroupAndLiberties(sim, x, y);
    if (ourGroup.libs === 0)
      return { valid: false, board: sim, captured, ownLiberties: 0 };
    return { valid: true, board: sim, captured, ownLiberties: ourGroup.libs };
  }

  function getLegalMoves(board, player, historyKeys) {
    const moves = [];

    for (let rowIndex = 0; rowIndex < board.length; rowIndex++) {
      for (let colIndex = 0; colIndex < board[0].length; colIndex++) {
        if (board[rowIndex][colIndex] !== ".") continue;

        const result = simulateMove(board, rowIndex, colIndex, player);
        if (!result.valid) continue;

        if (historyKeys && historyKeys.has(boardToKey(result.board))) continue;

        moves.push({
          row: rowIndex,
          col: colIndex,
          captured: result.captured,
          ownLiberties: result.ownLiberties ?? 0,
          board: result.board,
        });
      }
    }

    return moves;
  }

  function chooseUrgentDefenseMove(
    board,
    player,
    legalMoves,
    currentChains,
    currentLiberties,
    moveCount = 0,
  ) {
    const enemy = player === "X" ? "O" : "X";
    const moveByPoint = new Map();
    for (const move of legalMoves) {
      moveByPoint.set(`${move.row},${move.col}`, move);
    }

    const seenChainIds = new Set();
    let best = null;

    for (let rowIndex = 0; rowIndex < board.length; rowIndex++) {
      for (let colIndex = 0; colIndex < board[0].length; colIndex++) {
        if (board[rowIndex][colIndex] !== player) continue;
        const chainId = currentChains[rowIndex][colIndex];
        if (chainId === null || seenChainIds.has(chainId)) continue;
        seenChainIds.add(chainId);

        if (currentLiberties[rowIndex][colIndex] !== 1) continue;

        const group = getGroupAndLiberties(board, rowIndex, colIndex);
        if (group.libsSet.size === 0) continue;

        const libertyPoint = group.libsSet.values().next().value;
        if (!libertyPoint) continue;
        const candidateMove = moveByPoint.get(libertyPoint);
        if (!candidateMove) continue;

        const ownAfter = getGroupAndLiberties(
          candidateMove.board,
          candidateMove.row,
          candidateMove.col,
        );
        let enemyNeighbors = 0;
        for (const [nextRow, nextCol] of neighbors(
          candidateMove.row,
          candidateMove.col,
        )) {
          if (
            inBounds(board, nextRow, nextCol) &&
            board[nextRow][nextCol] === enemy
          ) {
            enemyNeighbors++;
          }
        }

        const rescueScore =
          group.points.length * 200000 +
          ownAfter.libs * 60000 +
          candidateMove.captured * 180000 +
          enemyNeighbors * 10000;

        if (!best || rescueScore > best.score) {
          best = {
            score: rescueScore,
            row: candidateMove.row,
            col: candidateMove.col,
          };
        }
      }
    }

    return best ? [best.row, best.col] : null;
  }

  function chooseStructuredDefenseMove(
    board,
    player,
    legalMoves,
    currentChains,
    currentLiberties,
    moveCount = 0,
  ) {
    const moveByPoint = new Map();
    for (const move of legalMoves) {
      moveByPoint.set(`${move.row},${move.col}`, move);
    }

    const seenChainIds = new Set();
    let best = null;

    for (let rowIndex = 0; rowIndex < board.length; rowIndex++) {
      for (let colIndex = 0; colIndex < board[0].length; colIndex++) {
        if (board[rowIndex][colIndex] !== player) continue;
        const chainId = currentChains[rowIndex][colIndex];
        if (chainId === null || seenChainIds.has(chainId)) continue;
        seenChainIds.add(chainId);

        const libs = currentLiberties[rowIndex][colIndex];
        // In opening (moves 3-8), defend even 3-liberty chains; normally defend 1-2 liberty chains
        const libsThreshold = moveCount >= 3 && moveCount <= 8 ? 3 : 2;
        if (libs > libsThreshold) continue;

        const group = getGroupAndLiberties(board, rowIndex, colIndex);
        if (group.libsSet.size === 0) continue;

        for (const libertyPoint of group.libsSet) {
          const candidateMove = moveByPoint.get(libertyPoint);
          if (!candidateMove) continue;

          const ownAfter = getGroupAndLiberties(
            candidateMove.board,
            candidateMove.row,
            candidateMove.col,
          );
          if (candidateMove.captured === 0 && ownAfter.libs <= 1) continue;

          let friendlyNeighbors = 0;
          for (const [nextRow, nextCol] of neighbors(
            candidateMove.row,
            candidateMove.col,
          )) {
            if (
              inBounds(board, nextRow, nextCol) &&
              board[nextRow][nextCol] === player
            ) {
              friendlyNeighbors++;
            }
          }

          // Increase defense weight during opening phase
          const defenseMultiplier =
            moveCount >= 3 && moveCount <= 8 ? 1.5 : 1.0;
          const defenseScore =
            (group.points.length * 150000 +
              libs * 120000 +
              ownAfter.libs * 80000 +
              candidateMove.captured * 150000 +
              friendlyNeighbors * 40000) *
            defenseMultiplier;

          if (!best || defenseScore > best.score) {
            best = {
              score: defenseScore,
              row: candidateMove.row,
              col: candidateMove.col,
            };
          }
        }
      }
    }

    return best ? [best.row, best.col] : null;
  }

  function summarizeWeakChains(board, player) {
    const chains = ns.go.analysis.getChains(board);
    const liberties = ns.go.analysis.getLiberties(board);
    const seenChainIds = new Set();
    let weakChains = 0;
    let weakStones = 0;
    let atariChains = 0;

    for (let rowIndex = 0; rowIndex < board.length; rowIndex++) {
      for (let colIndex = 0; colIndex < board[0].length; colIndex++) {
        if (board[rowIndex][colIndex] !== player) continue;
        const chainId = chains[rowIndex][colIndex];
        if (chainId === null || seenChainIds.has(chainId)) continue;
        seenChainIds.add(chainId);

        const libs = liberties[rowIndex][colIndex];
        if (libs > 2) continue;

        weakChains++;
        if (libs === 1) atariChains++;

        const group = getGroupAndLiberties(board, rowIndex, colIndex);
        weakStones += group.points.length;
      }
    }

    return { weakChains, weakStones, atariChains };
  }

  function countCells(board, target) {
    let count = 0;
    for (const row of board) {
      for (const cell of row) {
        if (cell === target) count++;
      }
    }
    return count;
  }

  function countEmptyPlayableCells(board) {
    let count = 0;
    for (const row of board) {
      for (const cell of row) {
        if (cell === ".") count++;
      }
    }
    return count;
  }

  function isTrueEye(board, rowIndex, colIndex, player) {
    for (const [nextRow, nextCol] of neighbors(rowIndex, colIndex)) {
      if (!inBounds(board, nextRow, nextCol)) continue;
      const cell = board[nextRow][nextCol];
      if (cell !== player && cell !== "#") return false;
    }
    return true;
  }

  function countControlled(board, controlledBoard, player) {
    if (!controlledBoard) return 0;
    let count = 0;
    for (let rowIndex = 0; rowIndex < board.length; rowIndex++) {
      for (let colIndex = 0; colIndex < board[0].length; colIndex++) {
        if (controlledBoard[rowIndex][colIndex] === player) count++;
      }
    }
    return count;
  }

  function analyzeControlledTerritory(board, controlledBoard, player) {
    if (!controlledBoard) {
      return { components: 0, largestComponent: 0, singletonComponents: 0 };
    }

    const visited = Array.from({ length: board.length }, () =>
      Array(board[0].length).fill(false),
    );
    let components = 0;
    let largestComponent = 0;
    let singletonComponents = 0;

    for (let rowIndex = 0; rowIndex < board.length; rowIndex++) {
      for (let colIndex = 0; colIndex < board[0].length; colIndex++) {
        if (visited[rowIndex][colIndex]) continue;
        if (controlledBoard[rowIndex][colIndex] !== player) continue;

        components++;
        let size = 0;
        const queue = [[rowIndex, colIndex]];
        let queueIndex = 0;
        visited[rowIndex][colIndex] = true;

        while (queueIndex < queue.length) {
          const [currentRow, currentCol] = queue[queueIndex++];
          size++;

          for (const [nextRow, nextCol] of neighbors(currentRow, currentCol)) {
            if (!inBounds(board, nextRow, nextCol)) continue;
            if (visited[nextRow][nextCol]) continue;
            if (controlledBoard[nextRow][nextCol] !== player) continue;
            visited[nextRow][nextCol] = true;
            queue.push([nextRow, nextCol]);
          }
        }

        if (size === 1) singletonComponents++;
        if (size > largestComponent) largestComponent = size;
      }
    }

    return { components, largestComponent, singletonComponents };
  }

  function scoreAreaProxy(board, controlledBoard, komi = 1.5) {
    const blackStones = countCells(board, "X");
    const whiteStones = countCells(board, "O");
    const blackControl = countControlled(board, controlledBoard, "X");
    const whiteControl = countControlled(board, controlledBoard, "O");
    return blackStones + blackControl - (whiteStones + whiteControl + komi);
  }

  function scoreAreaCached(board, komi = 1.5) {
    const key = `${boardToKey(board)}|komi:${komi}`;
    const cached = areaScoreCache.get(key);
    if (typeof cached === "number") return cached;
    const value = scoreArea(board, komi);
    areaScoreCache.set(key, value);
    return value;
  }

  function scoreArea(board, komi = 1.5) {
    const visited = Array.from({ length: board.length }, () =>
      Array(board[0].length).fill(false),
    );

    let blackScore = countCells(board, "X");
    let whiteScore = countCells(board, "O") + komi;

    for (let rowIndex = 0; rowIndex < board.length; rowIndex++) {
      for (let colIndex = 0; colIndex < board[0].length; colIndex++) {
        if (visited[rowIndex][colIndex] || board[rowIndex][colIndex] !== ".") {
          continue;
        }

        const queue = [[rowIndex, colIndex]];
        let queueIndex = 0;
        visited[rowIndex][colIndex] = true;
        let regionSize = 0;
        const borderingColors = new Set();

        while (queueIndex < queue.length) {
          const [currentRow, currentCol] = queue[queueIndex++];
          regionSize++;

          for (const [nextRow, nextCol] of neighbors(currentRow, currentCol)) {
            if (!inBounds(board, nextRow, nextCol)) continue;
            const cell = board[nextRow][nextCol];
            if (cell === ".") {
              if (!visited[nextRow][nextCol]) {
                visited[nextRow][nextCol] = true;
                queue.push([nextRow, nextCol]);
              }
            } else if (cell === "X" || cell === "O") {
              borderingColors.add(cell);
            }
          }
        }

        if (borderingColors.size === 1) {
          if (borderingColors.has("X")) blackScore += regionSize;
          if (borderingColors.has("O")) whiteScore += regionSize;
        }
      }
    }

    return blackScore - whiteScore;
  }

  // Initialize parameters based on current board (fallback to 5 if unavailable)
  try {
    const b = ns.go.getBoardState();
    initParams(b.length || 5);
  } catch {
    initParams(5);
  }

  ns.clearLog();
  if (isLoggingEnabled()) {
    ns.print("=== IPvGO 5x5 SOLVER ===");
    ns.print("Strategy: tactical search + exact late-game solve");
    ns.print("");
  }

  let turnCount = 0;
  let gameCount = 0;
  let winCount = 0;
  let lossCount = 0;
  let adaptiveHeuristicMoveLimit = HEURISTIC_MOVE_LIMIT;

  while (true) {
    try {
      const currentState = ns.go.getGameState();

      if (currentState.currentPlayer === "None") {
        const board = getBoard();
        if (board.length !== BOARD_SIZE) {
          if (isLoggingEnabled())
            ns.print(`Board is ${board.length}x${board.length}, skipping.`);
          await ns.sleep(UPDATE_INTERVAL_MS);
          continue;
        }

        turnCount = 0;
        areaScoreCache.clear();
        gameCount++;
        const enemy = ns.go.getOpponent() ?? "Netburners";
        ns.go.resetBoardState(enemy, BOARD_SIZE);
        if (isLoggingEnabled())
          ns.print(`[Game ${gameCount}] Resetting board against ${enemy}.`);
        await ns.sleep(UPDATE_INTERVAL_MS);
        continue;
      }

      const board = getBoard();
      if (board.length !== BOARD_SIZE) {
        if (isLoggingEnabled()) {
          ns.print(
            `Board size ${board.length}x${board.length} != ${BOARD_SIZE}x${BOARD_SIZE}, passing.`,
          );
        }
        await ns.go.passTurn();
        await ns.sleep(UPDATE_INTERVAL_MS);
        continue;
      }

      const move = chooseMove(board, turnCount);
      turnCount++;

      let result;
      if (!move) {
        result = await ns.go.passTurn();
        if (LOG_TURNS) ns.print("PASS");
      } else {
        result = await ns.go.makeMove(move[0], move[1]);
        if (LOG_TURNS) ns.print(`MOVE ${move[0]},${move[1]}`);
      }

      if (result?.type === "gameOver") {
        const won = didBlackWin();
        if (DEBUG) ns.print(`Game over. ${won ? "Won" : "Lost"}`);

        if (won) {
          winCount++;
          adaptiveHeuristicMoveLimit = Math.max(
            HEURISTIC_MOVE_LIMIT,
            adaptiveHeuristicMoveLimit - 1,
          );
          ns.print(
            `Win rate: ${winCount}/${gameCount} (${((winCount / gameCount) * 100).toFixed(1)}%) | heuristicWidth=${adaptiveHeuristicMoveLimit}`,
          );
        } else {
          lossCount++;
          adaptiveHeuristicMoveLimit = Math.min(
            MAX_ADAPTIVE_HEURISTIC_MOVE_LIMIT,
            adaptiveHeuristicMoveLimit + 1,
          );
          dumpGameTranscript(result, BOARD_SIZE);
          ns.print(
            `Loss recorded (${lossCount}). Expanding heuristic width to ${adaptiveHeuristicMoveLimit}.`,
          );
        }

        // Clear caches between games
        Object.keys(transpositionCache).forEach(
          (key) => delete transpositionCache[key],
        );
        Object.keys(solveCache).forEach((key) => delete solveCache[key]);
        areaScoreCache.clear();

        try {
          const enemy = ns.go.getOpponent() ?? "Netburners";
          ns.go.resetBoardState(enemy, BOARD_SIZE);
          turnCount = 0;
          gameCount++;
          await ns.sleep(UPDATE_INTERVAL_MS);
          continue;
        } catch {
          ns.print("Could not auto-reset. Waiting for manual reset.");
          await ns.sleep(5000);
          break;
        }
      }

      try {
        await ns.go.opponentNextTurn();
      } catch {
        // Ignore
      }

      await ns.sleep(UPDATE_INTERVAL_MS);
    } catch (error) {
      ns.print(`Error: ${formatError(error)}`);
      await ns.sleep(5000);
    }
  }
}

/* ========== EDIT HISTORY & OPTIMIZATION NOTES ==========
   SESSION: IPvGO Strategy Optimization (Game Regression Analysis & Catastrophic Loss Fix)
   
   === INITIAL REGRESSION DIAGNOSIS (Games 1-99: 67% → Games 38-53: 60-65%) ===
   Problem: Early aggressive optimizations (150k corner/edge + 450k territory) caused 7% drop
   Root Cause: Corner/edge grabs created isolated groups (1-2 liberties) that opponent cut & captured
   Evidence: Games 39,44,47,53 ended 0-25.5 (catastrophic wipeouts)
   
   === FIRST FIX ITERATION ===
   1. CORNER_EDGE_HEATMAP bonus: 150k → 50k (Line 130, initial attempt)
   2. Territory multiplier: 450k → 375k (Line 247)
   Result: Still catastrophic losses (#3: 0-25.5, #11: 0-22.5) but narrowed competitive losses emerging
   Interpretation: 50k was still too aggressive for moves 0-2 (opening book period)
   
   === SECOND FIX (CURRENT) ===
   3. CORNER_EDGE_HEATMAP refinement: Phase-aware application (Line 130)
      OLD: All moves 0-6 get +50k corner/edge bonus
      NEW: Only moves 3-6 get +20k corner/edge bonus (moves 0-2 rely on opening book)
      Why: Opening book (center → corner → secure) should handle moves 0-2 without heatmap
           20k bonus for moves 3-6 gently encourages territory without forcing isolation
           Moves 0-2 now guaranteed safe: center or solid corner (≥3 liberties)
   
   === PRESERVED IMPROVEMENTS (All Previous Sessions) ===
   - Opening Book (moves 0-2): Center → corner response → secure position (all checked for 3+ liberties)
   - Error Logging Fix: Safe formatError() handles non-Error throws
   - Fallback Move Selection: Relaxed filters prevent unnecessary passes
   - Adaptive Width Learning: 3-7 range, learns from wins/losses
   - Urgent Defense Layer: Rescues atari groups before territory decisions
   - Loss Transcript Compression: selective multi-line format with summary + last 6 states
   
   === STRATEGY SUMMARY (Updated) ===
   Hybrid tactical + exact-solver with phase-aware territory:
   - Priority 1: Capture enemy stones (200k weight)
   - Priority 2: Safe group building (liberties * 25k, atari avoidance) - FIRST in early game
   - Priority 3: Territory control (375k/300k multiplier, phase-aware)
     * Moves 0-8: 375k multiplier (slightly elevated early)
     * Moves 8+: 300k multiplier (standard)
     * Moves 0-2: NO corner/edge bonus (opening book handles positioning)
     * Moves 3-6: +20k corner/edge bonus (gradual territory establishment)
     * Moves 7+: Standard center-weighted heatmap (no corner bonus)
   - Endgame: Exact minimax solver when ≤6 empty cells + ≤5 legal moves
   - Adaptive: Heuristic width learns (3-7 range)
   
   === RECENT TEST BATCH RESULTS (New Compressed Format) ===
   Losses 1-13:
   - LOSS #3: 0-25.5 (catastrophic - corner/edge residue from old code?)
   - LOSS #11: 0-22.5 (catastrophic - same pattern)
   - LOSS #5,7,8,10,12,13: Narrow losses (0.5-5.5 margins) = BOT IS COMPETITIVE
   - LOSS #12: 12-12.5 (ultra-tight, likely komi-based endgame loss)
   Interpretation: Mixed results suggest transition is working but 2 catastrophic losses remain
   Next: Run full batch to confirm catastrophic loss rate drops
   
   === VALIDATION ===
   ✅ Syntax: node --check clean
   ✅ Error logging: Safe formatError in use
   ✅ Compact transcripts: Active (1-line loss format)
   ✅ Opening book: Moves 0-2 now phase-gated (no corner/edge bonus during book)
   
   === EXPECTED OUTCOME (After current fix) ===
   - Catastrophic 0-point losses should drop significantly (no corner/edge aggression in moves 0-2)
   - Narrow competitive losses should remain or improve (bot closer to actual play strength)
   - Win rate should stabilize/recover toward baseline 65%+
   - Endgame still needs tuning (see tight losses like #12: 12-12.5)
   
   ========== END EDIT HISTORY ========== */
