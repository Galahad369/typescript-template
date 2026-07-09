/** @param {NS} ns */
export async function main(ns) {
  // ──────────────────────────────────────────────────────────────
  // 1️⃣  GLOBAL SETTINGS & HEATMAPS
  // ──────────────────────────────────────────────────────────────
  ns.disableLog('ALL');

  const LOG = {
    enable: false,
    debug: false,
    candidates: false,
    turns: false,
  };
  function log(...msg) {
    if (LOG.enable) ns.print(...msg);
  }
  function debug(...msg) {
    if (LOG.debug) ns.print(...msg);
  }

  const UPDATE_INTERVAL_MS = 110;
  const LOSS_MARGIN_THRESHOLD = 2.0; // points

  // Board‑size‑aware parameters (filled by initParams)
  let BOARD_SIZE, HEURISTIC_MOVE_LIMIT, MAX_ADAPTIVE_HEURISTIC_MOVE_LIMIT;
  let EXACT_SOLVE_EMPTY_THRESHOLD, EXACT_SOLVE_TIME_BUDGET_MS, EXACT_SOLVE_MAX_DEPTH;
  let PASS_THRESHOLD, OPENING_END_MOVE, MIDGAME_END_MOVE, ENDGAME_START_EMPTY_THRESHOLD;
  let HEATMAP, CORNER_EDGE_HEATMAP;
  // Weights (tuned)
  const WEIGHTS = {
    capture: 200_000,
    heat: 2_000,
    liberty: 25_000,
    territoryBase: 300_000,
    territoryLate: 800_000,
    eyeCreate: 35_000,
    eyeBlock: 15_000,
    atari: 250_000,
    risk: 220_000,
    selfEyeFill: 50_000_000, // hard ban
  };

  // -------------------------------------------------------------
  // 2️⃣  PARAMETER INITIALISER (board‑size specific)
  // -------------------------------------------------------------
  function initParams(size) {
    BOARD_SIZE = size;
    const center = Math.floor((size - 1) / 2);
    // heuristic width
    HEURISTIC_MOVE_LIMIT = size <= 5 ? 3 : size <= 9 ? 4 : 5;
    MAX_ADAPTIVE_HEURISTIC_MOVE_LIMIT = Math.max(HEURISTIC_MOVE_LIMIT, 7);
    // exact‑solve thresholds
    const area = size * size;
    EXACT_SOLVE_EMPTY_THRESHOLD = Math.max(6, Math.floor(area * 0.06));
    EXACT_SOLVE_TIME_BUDGET_MS = size <= 5 ? 600 : size <= 9 ? 960 : 1440;
    EXACT_SOLVE_MAX_DEPTH = size <= 5 ? 12 : size <= 9 ? 14 : 16;
    // pass threshold (negative score) – keep generous
    PASS_THRESHOLD = -Math.max(1e6, Math.floor(area * 50_000));
    // phase breakpoints
    if (size === 5) {
      OPENING_END_MOVE = 3; MIDGAME_END_MOVE = 10; ENDGAME_START_EMPTY_THRESHOLD = 8;
    } else if (size === 7) {
      OPENING_END_MOVE = 4; MIDGAME_END_MOVE = 14; ENDGAME_START_EMPTY_THRESHOLD = 15;
    } else if (size === 9) {
      OPENING_END_MOVE = 6; MIDGAME_END_MOVE = 18; ENDGAME_START_EMPTY_THRESHOLD = 20;
    } else {
      OPENING_END_MOVE = 8; MIDGAME_END_MOVE = 25; ENDGAME_START_EMPTY_THRESHOLD = 30;
    }
    // heatmaps
    HEATMAP = Array.from({ length: size }, (_, r) =>
      Array.from({ length: size }, (_, c) => {
        const d = Math.max(Math.abs(r - center), Math.abs(c - center));
        return Math.pow(center - d + 1, 2);
      })
    );
    CORNER_EDGE_HEATMAP = Array.from({ length: size }, (_, r) =>
      Array.from({ length: size }, (_, c) => {
        const dist = Math.min(r + c, r + size - 1 - c, size - 1 - r + c, size - 1 - r + size - 1 - c);
        return Math.max(0, center - dist + 1);
      })
    );
  }

  // -------------------------------------------------------------
  // 3️⃣  UTILS – board handling, neighbors, etc.
  // -------------------------------------------------------------
  const dirs = [[-1,0],[1,0],[0,-1],[0,1]];
  function inBounds(b,r,c){return r>=0&&c>=0&&r<b.length&&c<b[0].length;}
  function neighbors(r,c){return dirs.map(d=>[r+d[0],c+d[1]]).filter(p=>inBounds(board,p[0],p[1]));}
  function boardKey(b){return b.map(row=>row.join('')).join('|');}
  function copyBoard(b){return b.map(row=>Array.isArray(row)?row.slice():row.split(''));}

  // -------------------------------------------------------------
  // 4️⃣  MOVE SIMULATION (captures, suicide)
  // -------------------------------------------------------------
  function simulate(board, r, c, player){
    const sb = copyBoard(board);
    if(sb[r][c]!=='.') return null;
    sb[r][c]=player;
    const enemy = player==='X'?'O':'X';
    const captured = removeDeadGroups(sb, enemy);
    const ownLib = countLiberties(sb, r, c, player);
    if(ownLib===0) return null; // suicide
    return {board:sb, captured, ownLib};
  }
  function removeDeadGroups(board, color){
    const visited = board.map(row=>row.map(()=>false));
    let total = 0;
    for(let r=0;r<board.length;r++){
      for(let c=0;c<board[0].length;c++){
        if(board[r][c]!==color||visited[r][c]) continue;
        const group = collectGroup(board,r,c,color,visited);
        if(group.lib===0){
          total+=group.stones.length;
          for(const [sr,sc] of group.stones) board[sr][sc]='.';
        }
      }
    }
    return total;
  }
  function collectGroup(board,r,c,color,visited){
    const stack=[[r,c]];
    visited[r][c]=true;
    const stones=[];
    const libs=new Set();
    while(stack.length){
      const [cr,cc]=stack.pop();
      stones.push([cr,cc]);
      for(const [nr,nc] of neighbors(cr,cc)){
        if(board[nr][nc]==='.') libs.add(`${nr},${nc}`);
        else if(board[nr][nc]===color && !visited[nr][nc]){
          visited[nr][nc]=true;
          stack.push([nr,nc]);
        }
      }
    }
    return {stones, lib:libs.size};
  }
  function countLiberties(board,r,c,player){
    return collectGroup(board,r,c,player,board.map(row=>row.map(()=>false))).lib;
  }

  // -------------------------------------------------------------
  // 5️⃣  LEGAL MOVE GENERATOR
  // -------------------------------------------------------------
  function getLegalMoves(board, player, historySet){
    const moves=[];
    for(let r=0;r<board.length;r++){
      for(let c=0;c<board[0].length;c++){
        if(board[r][c]!=='.') continue;
        const sim = simulate(board,r,c,player);
        if(!sim) continue;
        if(historySet && historySet.has(boardKey(sim.board))) continue;
        moves.push({row:r,col:c,captured:sim.captured,ownLib:sim.ownLib,board:sim.board});
      }
    }
    return moves;
  }

  // -------------------------------------------------------------
  // 6️⃣  OPENING BOOK (size‑aware)
  // -------------------------------------------------------------
  const BOOK = {
    5:[[2,2],[1,1],[3,3]],
    7:[[3,3],[2,2],[4,4]],
    9:[[4,4],[2,2],[6,6]],
    13:[[6,6],[3,3],[9,9]],
  };
  function openingMove(board, turn){
    const pattern=BOOK[BOARD_SIZE];
    if(!pattern||turn>=pattern.length) return null;
    const [r,c]=pattern[turn];
    return board[r][c]==='.'? [r,c]:null;
  }

  // -------------------------------------------------------------
  // 7️⃣  TERRITORY ESTIMATION (fast, cached)
  // -------------------------------------------------------------
  const territoryCache=new Map();
  function evaluateTerritory(board){
    const key=boardKey(board);
    if(territoryCache.has(key)) return territoryCache.get(key);
    const visited=board.map(row=>row.map(()=>false));
    let black=0, white=0;
    for(let r=0;r<board.length;r++){
      for(let c=0;c<board[0].length;c++){
        if(visited[r][c]||board[r][c]!=='.') continue;
        const queue=[[r,c]];
        visited[r][c]=true;
        let size=0;
        const border=new Set();
        while(queue.length){
          const [cr,cc]=queue.pop();
          size++;
          for(const [nr,nc] of neighbors(cr,cc)){
            if(board[nr][nc]==='.') {
              if(!visited[nr][nc]){visited[nr][nc]=true;queue.push([nr,nc]);}
            } else border.add(board[nr][nc]);
          }
        }
        if(border.size===1){
          if(border.has('X')) black+=size;
          else if(border.has('O')) white+=size;
        }
      }
    }
    const result={black,white};
    territoryCache.set(key,result);
    return result;
  }

  // -------------------------------------------------------------
  // 8️⃣  EVALUATION FUNCTION (full heuristic)
  // -------------------------------------------------------------
  function evalMove(board, move, player, turn, origTerritory){
    const enemy = player==='X'?'O':'X';
    const {row,col,captured,ownLib,board:newBoard}=move;
    let score=0;

    // 1️⃣ Capture weight
    score+=WEIGHTS.capture*captured;

    // 2️⃣ Central heat
    score+=HEATMAP[row][col]*WEIGHTS.heat;

    // 3️⃣ Liberty bonus
    score+=ownLib*WEIGHTS.liberty;

    // 4️⃣ Territory delta (phase aware)
    const newTerr = evaluateTerritory(newBoard);
    const delta = (newTerr.black - origTerritory.black) - (newTerr.white - origTerritory.white);
    const terrWeight = turn<OPENING_END_MOVE ? WEIGHTS.territoryBase
                     : turn< MIDGAME_END_MOVE ? WEIGHTS.territoryBase
                     : WEIGHTS.territoryLate;
    score+=delta*terrWeight;

    // 5️⃣ Eye creation / blocking (very light)
    if(wouldCreateEye(board,row,col,player))   score+=WEIGHTS.eyeCreate;
    if(wouldBlockEnemyEye(board,row,col,player)) score+=WEIGHTS.eyeBlock;

    // 6️⃣ Ataris (enemy groups put in atari)
    for(const [nr,nc] of neighbors(row,col)){
      if(board[nr][nc]===enemy && countLiberties(board,nr,nc,enemy)===2) score+=WEIGHTS.atari;
    }

    // 7️⃣ Risk penalty – opponent could capture us next turn
    let risk=0;
    for(const [nr,nc] of neighbors(row,col)){
      if(board[nr][nc]===enemy){
        const lib=countLiberties(board,nr,nc,enemy);
        if(lib===1) risk+=WEIGHTS.risk;
      }
    }
    score-=risk;

    // 8️⃣ Self‑eye fill hard ban
    if(isTrueEye(board,row,col,player) && captured===0) score-=WEIGHTS.selfEyeFill;

    return {score, newBoard, newTerr};
  }

  // -------------------------------------------------------------
  // 9️⃣  QUICK‑SCORER (used for MCTS rollouts)
  // -------------------------------------------------------------
  function roughScore(board, move, player, turn){
    const {row,col,captured}=move;
    let s=0;
    s+=captured*40_000;
    s+=HEATMAP[row][col]*2_000;
    // favour adjacency to own stones early
    if(turn>=3 && turn<=14){
      let adj=0;
      for(const [nr,nc] of neighbors(row,col))
        if(board[nr][nc]===player) adj++;
      s+=adj*80_000;
    }
    return s;
  }

  // -------------------------------------------------------------
  // 🔟  MONTE‑CARLO TREE SEARCH
  // -------------------------------------------------------------
  function mcts(board, player, timeMs){
    const C=1.4;
    const root={board,player,visits:0,wins:0,children:[]};

    const deadline=Date.now()+timeMs;
    function select(node){
      while(node.children.length){
        let best=null, bestU=-Infinity;
        for(const ch of node.children){
          const exploitation=ch.wins/ch.visits;
          const uct=exploitation+C*Math.sqrt(Math.log(node.visits)/ch.visits);
          if(uct>bestU){bestU=uct;best=ch;}
        }
        node=best;
      }
      return node;
    }
    function expand(node){
      const moves=getLegalMoves(node.board,node.player);
      for(const mv of moves){
        const child={board:mv.board,player:node.player==='X'?'O':'X',move:mv,
                     visits:0,wins:0,children:[]};
        node.children.push(child);
      }
      return node.children[Math.floor(Math.random()*node.children.length)];
    }
    function rollout(node){
      let b=copyBoard(node.board);
      let pl=node.player;
      const maxPlayout= Math.max(20, BOARD_SIZE*BOARD_SIZE);
      for(let i=0;i<maxPlayout;i++){
        const legal=getLegalMoves(b,pl);
        if(!legal.length) break;
        const mv=legal.reduce((best,c)=> (roughScore(b,c,pl,turnCount)>roughScore(b,best,pl,turnCount)?c:best),legal[0]);
        b=mv.board;
        pl=pl==='X'?'O':'X';
      }
      // final score (X positive)
      const terr=evaluateTerritory(b);
      const score = (countCells(b,'X')+terr.black) - (countCells(b,'O')+terr.white+1.5);
      return score;
    }
    function backprop(node,val){
      while(node){
        node.visits+=1;
        node.wins+=val;
        node=node.parent;
      }
    }

    while(Date.now()<deadline){
      let node=select(root);
      if(node.visits===0){
        const val=rollout(node);
        backprop(node,val);
        continue;
      }
      if(node.children.length===0) expand(node);
      const child=node.children[Math.floor(Math.random()*node.children.length)];
      const val=rollout(child);
      backprop(child,val);
    }
    // pick child with most visits
    let best=null, bestV=-1;
    for(const ch of root.children){
      if(ch.visits>bestV){bestV=ch.visits;best=ch;}
    }
    return best? [best.move.row,best.move.col]:null;
  }

  // -------------------------------------------------------------
  // 1️⃣1️⃣  EXACT END‑GAME SOLVER (alpha‑beta with transposition)
  // -------------------------------------------------------------
  const transCache=new Map();
  function exactSolve(board, player, passes, start, timeLimit, depth=0){
    if(Date.now()-start>timeLimit) return {score: evaluateScore(board), timedOut:true};

    if(passes>=2) return {score:evaluateScore(board), timedOut:false};

    const key=boardKey(board)+'|'+player;
    if(transCache.has(key)){
      const entry=transCache.get(key);
      if(entry.depth>=depth) return entry;
    }

    const moves=getLegalMoves(board,player);
    const maximizing= player==='X';
    let bestScore = maximizing? -Infinity : Infinity;
    let bestMove=null;
    let alpha=-Infinity, beta=Infinity;

    for(const mv of moves){
      const res=exactSolve(mv.board, player==='X'?'O':'X',0,start,timeLimit,depth+1);
      if(res.timedOut) return {score:bestScore, timedOut:true};

      if(maximizing){
        if(res.score>bestScore){bestScore=res.score;bestMove=[mv.row,mv.col];}
        alpha=Math.max(alpha,bestScore);
        if(alpha>=beta) break;
      }else{
        if(res.score<bestScore){bestScore=res.score;bestMove=[mv.row,mv.col];}
        beta=Math.min(beta,bestScore);
        if(alpha>=beta) break;
      }
    }

    // pass option
    const passRes=exactSolve(board, player==='X'?'O':'X',passes+1,start,timeLimit,depth+1);
    if(!passRes.timedOut){
      if(maximizing){
        if(passRes.score>bestScore){bestScore=passRes.score;bestMove=null;}
      }else{
        if(passRes.score<bestScore){bestScore=passRes.score;bestMove=null;}
      }
    }

    const entry={score:bestScore, move:bestMove, timedOut:false, depth};
    transCache.set(key,entry);
    return entry;
  }
  function evaluateScore(board){
    const terr=evaluateTerritory(board);
    return (countCells(board,'X')+terr.black) - (countCells(board,'O')+terr.white+1.5);
  }

  // -------------------------------------------------------------
  // 1️⃣2️⃣  CORE DECISION LOOP (chooseMove)
  // -------------------------------------------------------------
  function chooseMove(board, turn){
    const player='X';
    const opponent='O';
    const historySet = new Set(ns.go.getMoveHistory().map(b=>boardKey(b)));

    // 1️⃣ opening book
    const book = openingMove(board, turn);
    if(book) return book;

    // 2️⃣ fast territory snapshot (for all later scoring)
    const origTerr = evaluateTerritory(board);

    // 3️⃣ generate legal moves
    const legal = getLegalMoves(board,player,historySet);
    if(!legal.length) return null; // must pass

    // 4️⃣ capture‑only shortcut
    const captureMoves = legal.filter(m=>m.captured>0);
    if(captureMoves.length){
      // if any capture eliminates all opponent stones → win immediately
      for(const m of captureMoves){
        if(countCells(m.board,'O')===0) return [m.row,m.col];
      }
    }

    // 5️⃣ heuristic filter – keep top N moves
    const scored = legal.map(m=>evalMove(board,m,player,turn,origTerr));
    scored.sort((a,b)=>b.score-a.score);
    const N = Math.min(scored.length, adaptiveHeuristicMoveLimit);
    const shortlist = scored.slice(0,N);

    // 6️⃣ MCTS (if board big or later turn)
    if(BOARD_SIZE>=7 || turn>=4){
      const mctsBudget = BOARD_SIZE<=5?300: BOARD_SIZE<=7?420: BOARD_SIZE<=9?600:960;
      const mctsMove = mcts(board,player,mctsBudget);
      if(mctsMove) return mctsMove;
    }

    // 7️⃣ exact solver for tiny endgames
    const empty = countCells(board,'.');
    if(empty<=EXACT_SOLVE_EMPTY_THRESHOLD && legal.length<=EXACT_SOLVE_MAX_DEPTH){
      const res = exactSolve(board,player,0,Date.now(),EXACT_SOLVE_TIME_BUDGET_MS);
      if(!res.timedOut && res.move) return res.move;
    }

    // 8️⃣ fallback: best from heuristic shortlist
    return [shortlist[0].move.row, shortlist[0].move.col];
  }

  // -------------------------------------------------------------
  // 1️⃣3️⃣  MAIN GAME LOOP
  // -------------------------------------------------------------
  // initialise board size from the first game (fallback 5)
  try{ initParams(ns.go.getBoardState().length); }
  catch{ initParams(5); }

  let turnCount=0, gameCount=0, winCount=0, lossCount=0;
  let adaptiveHeuristicMoveLimit=HEURISTIC_MOVE_LIMIT;
  let lossStreak=0, lastLossMargin=0;

  async function resetBoard(){
    const opponent=ns.go.getOpponent()||'Netburners';
    ns.go.resetBoardState(opponent, BOARD_SIZE);
    await ns.sleep(UPDATE_INTERVAL_MS);
  }

  while(true){
    try{
      const state=ns.go.getGameState();
      // -----------------------------------------------------------------
      //   New game? (currentPlayer === "None")
      // -----------------------------------------------------------------
      if(state.currentPlayer==='None'){
        gameCount++;
        await resetBoard();
        turnCount=0;
        continue;
      }

      // -----------------------------------------------------------------
      //   Our turn?
      // -----------------------------------------------------------------
      if(state.currentPlayer==='X'){
        const board=ns.go.getBoardState();
        if(board.length!==BOARD_SIZE){
          await ns.go.passTurn();
          await ns.sleep(UPDATE_INTERVAL_MS);
          continue;
        }
        const move=chooseMove(board, turnCount);
        turnCount++;
        if(move){
          await ns.go.makeMove(move[0],move[1]);
          if(LOG.turns) ns.print(`MOVE ${move[0]},${move[1]}`);
        }else{
          await ns.go.passTurn();
          if(LOG.turns) ns.print('PASS');
        }
      }

      // -----------------------------------------------------------------
      //   Game over?
      // -----------------------------------------------------------------
      if(state.currentPlayer==='None' && state.type==='gameOver'){
        const win = state.blackScore>state.whiteScore;
        if(win){
          winCount++; lossStreak=0;
          adaptiveHeuristicMoveLimit=Math.max(HEURISTIC_MOVE_LIMIT,
            adaptiveHeuristicMoveLimit-1);
        }else{
          lossCount++; lossStreak++;
          lastLossMargin = Math.max(0, state.whiteScore-state.blackScore);
          if(lossStreak>=2 && lastLossMargin>=LOSS_MARGIN_THRESHOLD){
            adaptiveHeuristicMoveLimit=Math.min(
               MAX_ADAPTIVE_HEURISTIC_MOVE_LIMIT,
               adaptiveHeuristicMoveLimit+1);
            ns.tprint(`Loss ${lossCount} | streak ${lossStreak} | margin ${lastLossMargin} → expand width to ${adaptiveHeuristicMoveLimit}`);
          }
        }
        const winRate = (winCount/gameCount*100).toFixed(1);
        ns.tprint(`Game ${gameCount}: ${win?'WIN':'LOSS'} – win rate ${winRate}%`);
        // clear caches for next game
        territoryCache.clear(); transCache.clear();
        await resetBoard();
        turnCount=0;
      }

      // -----------------------------------------------------------------
      //   Opponent turn (just wait)
      // -----------------------------------------------------------------
      await ns.sleep(UPDATE_INTERVAL_MS);
    }catch(e){
      ns.tprint(`ERROR: ${e && e.stack ? e.stack : e}`);
      await ns.sleep(5000);
    }
  }

  // -------------------------------------------------------------
  // 1️⃣4️⃣  SMALL HELPERS (count cells, eye detection, etc.)
  // -------------------------------------------------------------
  function countCells(board,ch){
    let c=0;
    for(const r of board) for(const cell of r) if(cell===ch) c++;
    return c;
  }
  function isTrueEye(board,r,c,player){
    for(const [nr,nc] of neighbors(r,c)){
      if(board[nr][nc]!==player) return false;
    }
    return true;
  }
  function wouldCreateEye(board,r,c,player){
    if(board[r][c]!=='.') return false;
    // after placement all 4 neighbours must be player (or board edge)
    for(const [nr,nc] of neighbors(r,c)){
      if(board[nr][nc]!==player) return false;
    }
    return true;
  }
  function wouldBlockEnemyEye(board,r,c,player){
    const enemy = player==='X'?'O':'X';
    if(board[r][c]!=='.') return false;
    // if the point *could* be an enemy eye, we block it
    for(const [nr,nc] of neighbors(r,c)){
      if(board[nr][nc]!==enemy) return false;
    }
    return true;
  }
}