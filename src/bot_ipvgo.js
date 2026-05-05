/** @param {NS} ns */
export async function main(ns) {
  ns.disableLog("ALL");

  // Board size and game state
  let BOARD_SIZE = 13;
  let PASS_COUNT = 0;
  let MOVE_COUNT = 0;
  let DEBUG = false;

  // AI parameters (adaptive to board size)
  let SEARCH_DEPTH = 8;
  let EVALUATION_WEIGHT = {
    territory: 1.0,
    capture: 2.5,
    defense: 2.0,
    influence: 0.8,
    pattern: 1.2,
  };

  // Strategic constants
  const KOMI = 6.5;
  const EMPTY = ".";
  const FRIENDLY = "X";
  const ENEMY = "O";
  const BOARD_PADDING = 1;

  // Initialize board parameters
  function initBoard(board) {
    BOARD_SIZE = board.length;
    // Adjust parameters by board size
    if (BOARD_SIZE <= 5) {
      SEARCH_DEPTH = 10;
    } else if (BOARD_SIZE <= 9) {
      SEARCH_DEPTH = 8;
    } else {
      SEARCH_DEPTH = 6; // 13x13 - balance speed vs strength
    }
  }

  // ==================== HELPER FUNCTIONS ====================

  function isValid(r, c) {
    return r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE;
  }

  function getCell(board, r, c) {
    if (!isValid(r, c)) return null;
    return board[r][c];
  }

  function boardToString(board) {
    return board.map((r) => r.join("")).join("|");
  }

  // ==================== MOVE LEGALITY AND CAPTURE ====================

  function getAdjacent(r, c) {
    const adj = [];
    for (const [dr, dc] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ]) {
      const nr = r + dr,
        nc = c + dc;
      if (isValid(nr, nc)) adj.push([nr, nc]);
    }
    return adj;
  }

  function getGroupLiberties(board, r, c, color) {
    const visited = new Set();
    const liberties = new Set();
    const stack = [[r, c]];

    while (stack.length > 0) {
      const [cr, cc] = stack.pop();
      const key = `${cr},${cc}`;
      if (visited.has(key)) continue;
      visited.add(key);

      for (const [nr, nc] of getAdjacent(cr, cc)) {
        const cell = getCell(board, nr, nc);
        if (cell === color) {
          const nkey = `${nr},${nc}`;
          if (!visited.has(nkey)) stack.push([nr, nc]);
        } else if (cell === EMPTY) {
          liberties.add(`${nr},${nc}`);
        }
      }
    }
    return liberties;
  }

  function simulateCapture(board, r, c, color) {
    const nb = board.map((r) => r.slice());
    const enemy = color === FRIENDLY ? ENEMY : FRIENDLY;

    for (const [nr, nc] of getAdjacent(r, c)) {
      if (getCell(nb, nr, nc) === enemy) {
        const libs = getGroupLiberties(nb, nr, nc, enemy);
        if (libs.size === 0) {
          // Remove captured group
          const visited = new Set();
          const stack = [[nr, nc]];
          while (stack.length > 0) {
            const [cr, cc] = stack.pop();
            const key = `${cr},${cc}`;
            if (visited.has(key)) continue;
            visited.add(key);
            nb[cr][cc] = EMPTY;
            for (const [ar, ac] of getAdjacent(cr, cc)) {
              if (
                getCell(nb, ar, ac) === enemy &&
                !visited.has(`${ar},${ac}`)
              ) {
                stack.push([ar, ac]);
              }
            }
          }
        }
      }
    }
    return nb;
  }

  function isLegalMove(board, r, c, color, previousBoard = null) {
    if (!isValid(r, c) || getCell(board, r, c) !== EMPTY) return false;

    // Create test board
    const testBoard = board.map((r) => r.slice());
    testBoard[r][c] = color;

    // Check for captures of enemy stones
    const enemy = color === FRIENDLY ? ENEMY : FRIENDLY;
    const capturesEnemy = getAdjacent(r, c).some(
      ([nr, nc]) =>
        getCell(testBoard, nr, nc) === enemy &&
        getGroupLiberties(testBoard, nr, nc, enemy).size === 0,
    );

    if (capturesEnemy) return true;

    // Check for own liberties
    const libs = getGroupLiberties(testBoard, r, c, color);
    if (libs.size > 0) return true;

    // Suicide check: no liberties and no captures
    return false;
  }

  // ==================== EVALUATION FUNCTIONS ====================

  function countStones(board) {
    let friendly = 0,
      enemy = 0;
    for (const row of board) {
      for (const cell of row) {
        if (cell === FRIENDLY) friendly++;
        else if (cell === ENEMY) enemy++;
      }
    }
    return { friendly, enemy };
  }

  function estimateTerritory(board, color) {
    const visited = new Set();
    let territory = 0;
    const enemy = color === FRIENDLY ? ENEMY : FRIENDLY;

    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        const key = `${r},${c}`;
        if (getCell(board, r, c) === EMPTY && !visited.has(key)) {
          const region = new Set();
          const borderColors = new Set();
          const stack = [[r, c]];

          while (stack.length > 0) {
            const [cr, cc] = stack.pop();
            const ckey = `${cr},${cc}`;
            if (region.has(ckey)) continue;
            region.add(ckey);

            for (const [nr, nc] of getAdjacent(cr, cc)) {
              const cell = getCell(board, nr, nc);
              const nkey = `${nr},${nc}`;
              if (cell === EMPTY && !region.has(nkey)) {
                stack.push([nr, nc]);
              } else if (cell !== EMPTY) {
                borderColors.add(cell);
              }
            }
          }

          region.forEach((k) => visited.add(k));

          // Territory belongs to player if only bordered by their color
          if (borderColors.size === 1 && borderColors.has(color)) {
            territory += region.size;
          }
        }
      }
    }
    return territory;
  }

  function evaluateBoard(board, color) {
    const enemy = color === FRIENDLY ? ENEMY : FRIENDLY;
    const { friendly, enemy: enemyCount } = countStones(board);

    let score = 0;

    // Stone differential
    score += (friendly - enemyCount) * EVALUATION_WEIGHT.capture;

    // Territory estimation
    const friendlyTerritory = estimateTerritory(board, color);
    const enemyTerritory = estimateTerritory(board, enemy);
    score += (friendlyTerritory - enemyTerritory) * EVALUATION_WEIGHT.territory;

    return score;
  }

  // ==================== MOVE CANDIDATE GENERATION ====================

  function getUrgentMoves(board, color) {
    const urgent = [];
    const enemy = color === FRIENDLY ? ENEMY : FRIENDLY;

    // Find weak enemy groups (atari)
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (getCell(board, r, c) === enemy) {
          const libs = getGroupLiberties(board, r, c, enemy);
          if (libs.size === 1) {
            // Attack: play the last liberty
            const lib = Array.from(libs)[0].split(",").map(Number);
            urgent.push(lib);
          } else if (libs.size === 2) {
            // Atari: threaten
            for (const libKey of libs) {
              const lib = libKey.split(",").map(Number);
              urgent.push(lib);
            }
          }
        }
      }
    }

    // Defense: capture friendly groups with low liberties
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (getCell(board, r, c) === color) {
          const libs = getGroupLiberties(board, r, c, color);
          if (libs.size === 1) {
            // Defend: play the liberty
            const lib = Array.from(libs)[0].split(",").map(Number);
            urgent.push(lib);
          } else if (libs.size === 2) {
            // Reinforce
            for (const libKey of libs) {
              const lib = libKey.split(",").map(Number);
              urgent.push(lib);
            }
          }
        }
      }
    }

    // Remove duplicates and invalid moves
    const unique = new Set();
    const validMoves = [];
    for (const [r, c] of urgent) {
      const key = `${r},${c}`;
      if (!unique.has(key)) {
        unique.add(key);
        if (isLegalMove(board, r, c, color)) {
          validMoves.push([r, c]);
        }
      }
    }

    return validMoves.slice(0, 12); // Limit to top candidates
  }

  function getCandidateMoves(board, color) {
    // Priority: urgent moves first
    const urgent = getUrgentMoves(board, color);
    if (urgent.length > 0) return urgent;

    // Fallback: high-value influence moves
    const candidates = [];
    const center = Math.floor((BOARD_SIZE - 1) / 2);

    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (getCell(board, r, c) === EMPTY) {
          // Heuristic: distance to center
          const distToCenter = Math.sqrt((r - center) ** 2 + (c - center) ** 2);
          const score =
            (BOARD_SIZE - distToCenter) * 10 +
            Math.random() * 5 +
            (getCell(board, r - 1, c) !== EMPTY ? 2 : 0) +
            (getCell(board, r + 1, c) !== EMPTY ? 2 : 0) +
            (getCell(board, r, c - 1) !== EMPTY ? 2 : 0) +
            (getCell(board, r, c + 1) !== EMPTY ? 2 : 0);

          candidates.push({ move: [r, c], score });
        }
      }
    }

    candidates.sort((a, b) => b.score - a.score);
    return candidates.slice(0, 8).map((c) => c.move);
  }

  // ==================== SEARCH ALGORITHM ====================

  const evalCache = {};

  function alphaBetaSearch(board, depth, alpha, beta, isMaximizing, color) {
    const boardKey = boardToString(board);
    const cacheKey = `${boardKey}|${depth}|${isMaximizing}`;

    if (evalCache[cacheKey] !== undefined) {
      return evalCache[cacheKey];
    }

    if (depth === 0) {
      const value = evaluateBoard(board, color);
      evalCache[cacheKey] = value;
      return value;
    }

    const enemy = color === FRIENDLY ? ENEMY : FRIENDLY;
    const currentColor = isMaximizing ? color : enemy;
    const candidates = getCandidateMoves(board, currentColor);

    if (candidates.length === 0) {
      // Pass
      const value = evaluateBoard(board, color) * 0.95;
      evalCache[cacheKey] = value;
      return value;
    }

    if (isMaximizing) {
      let maxEval = -Infinity;
      for (const [r, c] of candidates) {
        if (isLegalMove(board, r, c, currentColor)) {
          const newBoard = simulateCapture(board, r, c, currentColor);
          const eval_score = alphaBetaSearch(
            newBoard,
            depth - 1,
            alpha,
            beta,
            false,
            color,
          );
          maxEval = Math.max(maxEval, eval_score);
          alpha = Math.max(alpha, eval_score);
          if (beta <= alpha) break; // Beta cutoff
        }
      }
      evalCache[cacheKey] = maxEval === -Infinity ? 0 : maxEval;
      return evalCache[cacheKey];
    } else {
      let minEval = Infinity;
      for (const [r, c] of candidates) {
        if (isLegalMove(board, r, c, currentColor)) {
          const newBoard = simulateCapture(board, r, c, currentColor);
          const eval_score = alphaBetaSearch(
            newBoard,
            depth - 1,
            alpha,
            beta,
            true,
            color,
          );
          minEval = Math.min(minEval, eval_score);
          beta = Math.min(beta, eval_score);
          if (beta <= alpha) break; // Alpha cutoff
        }
      }
      evalCache[cacheKey] = minEval === Infinity ? 0 : minEval;
      return evalCache[cacheKey];
    }
  }

  function findBestMove(board, color) {
    const candidates = getCandidateMoves(board, color);

    if (candidates.length === 0) {
      return null; // Pass
    }

    let bestMove = candidates[0];
    let bestScore = -Infinity;

    for (const [r, c] of candidates.slice(0, 6)) {
      if (isLegalMove(board, r, c, color)) {
        const newBoard = simulateCapture(board, r, c, color);
        const score = -alphaBetaSearch(
          newBoard,
          SEARCH_DEPTH,
          -Infinity,
          Infinity,
          false,
          color,
        );

        if (score > bestScore) {
          bestScore = score;
          bestMove = [r, c];
        }
      }
    }

    return bestMove;
  }

  // ==================== GAME LOOP ====================

  while (true) {
    try {
      const board = ns.go.getBoardState();
      initBoard(board);

      const stats = ns.go.getStats();
      const gameState = ns.go.getGameState();

      if (gameState === "finished") {
        break;
      }

      if (gameState === "waiting") {
        await ns.sleep(100);
        continue;
      }

      // Clear cache periodically
      if (MOVE_COUNT % 10 === 0) {
        Object.keys(evalCache).forEach((k) => delete evalCache[k]);
      }

      const moveToPlay = findBestMove(board, FRIENDLY);

      if (moveToPlay === null) {
        ns.go.pass();
        PASS_COUNT++;
        if (PASS_COUNT >= 2) {
          if (DEBUG) ns.tprint("Game ended with double pass");
          break;
        }
      } else {
        const [row, col] = moveToPlay;
        const success = ns.go.playMove(row, col);
        if (success) {
          PASS_COUNT = 0;
          MOVE_COUNT++;
          if (DEBUG) ns.tprint(`Move ${MOVE_COUNT}: [${row},${col}]`);
        } else {
          ns.go.pass();
          PASS_COUNT++;
        }
      }

      await ns.sleep(50);
    } catch (e) {
      if (DEBUG) ns.tprint(`Error: ${e.message}`);
      ns.go.pass();
      PASS_COUNT++;
      await ns.sleep(100);
    }
  }

  // Game finished
  const finalStats = ns.go.getStats();
  if (DEBUG) {
    ns.tprint(
      `Game finished. Moves: ${MOVE_COUNT}, Final Score: ${finalStats.score}`,
    );
  }
}
