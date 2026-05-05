/** @param {NS} ns */
export async function main(ns) {
  ns.disableLog("ALL");

  // Constants for Bitburner IPvGO
  const FRIENDLY = "X";
  const ENEMY = "O";
  const EMPTY = ".";
  const WALL = "#";

  let BOARD_SIZE = 0;
  const evalCache = new Map();

  /**
   * HEURISTICS & STRATEGY
   */
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
      if (nr >= 0 && nr < BOARD_SIZE && nc >= 0 && nc < BOARD_SIZE)
        adj.push([nr, nc]);
    }
    return adj;
  }

  function getGroup(board, r, c, color) {
    const group = [];
    const liberties = new Set();
    const stack = [[r, c]];
    const visited = new Set([`${r},${c}`]);

    while (stack.length > 0) {
      const [cr, cc] = stack.pop();
      group.push([cr, cc]);

      for (const [nr, nc] of getAdjacent(cr, cc)) {
        const cell = board[nr][nc];
        if (cell === color && !visited.has(`${nr},${nc}`)) {
          visited.add(`${nr},${nc}`);
          stack.push([nr, nc]);
        } else if (cell === EMPTY) {
          liberties.add(`${nr},${nc}`);
        }
      }
    }
    return {
      group,
      liberties: Array.from(liberties).map((s) => s.split(",").map(Number)),
    };
  }

  function isEye(board, r, c, color) {
    if (board[r][c] !== EMPTY) return false;
    const adj = getAdjacent(r, c);
    // An eye is surrounded by friendly stones or board edges/walls
    return adj.every(
      ([nr, nc]) => board[nr][nc] === color || board[nr][nc] === WALL,
    );
  }

  /**
   * MOVE GENERATION (Priority Based)
   */
  function getCandidateMoves(board, color) {
    const enemy = color === FRIENDLY ? ENEMY : FRIENDLY;
    const moves = [];

    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (board[r][c] !== EMPTY) continue;
        if (isEye(board, r, c, color)) continue; // Don't fill own eyes

        let score = 0;
        const adj = getAdjacent(r, c);

        // 1. Capture/Defense (Atari)
        for (const [nr, nc] of adj) {
          if (board[nr][nc] === enemy) {
            const { liberties } = getGroup(board, nr, nc, enemy);
            if (liberties.length === 1) score += 500; // Winning Capture
            if (liberties.length === 2) score += 50; // Put in Atari
          } else if (board[nr][nc] === color) {
            const { liberties } = getGroup(board, nr, nc, color);
            if (liberties.length === 1) score += 400; // Save own group
            if (liberties.length === 2) score += 30; // Strengthen
          }
        }

        // 2. Positional (Distance to center/edges)
        // 3rd and 4th lines are best for 13x13
        const distEdgeR = Math.min(r, BOARD_SIZE - 1 - r);
        const distEdgeC = Math.min(c, BOARD_SIZE - 1 - c);
        if (
          (distEdgeR === 2 || distEdgeR === 3) &&
          (distEdgeC === 2 || distEdgeC === 3)
        )
          score += 20;

        // 3. Liberties for the move itself
        const testBoard = board.map((row) => [...row]);
        testBoard[r][c] = color;
        const { liberties: selfLibs } = getGroup(testBoard, r, c, color);
        if (selfLibs.length === 0) continue; // Basic suicide check
        score += selfLibs.length * 2;

        if (score > 0) moves.push({ r, c, score });
      }
    }

    return moves.sort((a, b) => b.score - a.score).slice(0, 10);
  }

  /**
   * EVALUATION
   */
  function evaluate(board) {
    let score = 0;
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (board[r][c] === FRIENDLY) score += 1;
        if (board[r][c] === ENEMY) score -= 1;
      }
    }
    return score;
  }

  /**
   * MAIN LOOP
   */
  while (true) {
    const board = ns.go.getBoardState();
    BOARD_SIZE = board.length;
    const gameState = ns.go.getGameState();

    if (gameState === "gameOver") break;
    if (ns.go.getCurrentPlayer() === "None") {
      await ns.sleep(100);
      continue;
    }

    const candidates = getCandidateMoves(board, FRIENDLY);

    let bestMove = null;

    if (candidates.length > 0) {
      // Pick the best rated move
      bestMove = candidates[0];

      // Log for debugging
      // ns.print(`Considering move: ${bestMove.r},${bestMove.c} with score ${bestMove.score}`);

      // Perform Move
      const result = await ns.go.makeMove(bestMove.c, bestMove.r);

      if (result.type === "invalid") {
        ns.print(
          `Move [${bestMove.r},${bestMove.c}] was invalid: ${result.reason}. Passing.`,
        );
        await ns.go.passTurn();
      }
    } else {
      // No good moves found
      ns.print("No candidate moves. Passing.");
      await ns.go.passTurn();
    }

    await ns.sleep(20); // Fast response for 13x13
  }
}
