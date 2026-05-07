# BitBurner Go AI (ipvgo.js) - Strategic Framework

## Overview

ipvgo.js now implements **pro-level Go strategy** adapted to different board sizes (5x5, 7x7, 9x9, 13x13). The key insight: **2 eyes = guaranteed life, 0-1 eyes = threat**.

---

## Eye Strategy (Universal Principle)

### What are Eyes?

- **True Eye**: An empty point surrounded only by friendly stones (or board edges) → counts as safe territory
- **Potential Eye**: An empty point that COULD become a true eye if the player occupies it
- **Group Safety**: A group with 2+ true eyes cannot be captured (alive forever); 0-1 eyes = killable

### Offensive Eye Strategy: Create Your Own Eyes

```
PRIORITY: If our group has 0 eyes → urgently create an eye
TACTIC:
  1. Play at empty points that form true eyes (surrounded by our stones)
  2. Link separate groups to share eyes
  3. Create multiple disconnected eye-regions to guarantee 2+ total eyes
```

### Defensive Eye Strategy: Block Enemy Eyes

```
PRIORITY: If enemy group has 0-1 eyes → block their remaining eye-point
TACTIC:
  1. Identify vulnerable enemy groups (< 2 eyes)
  2. Occupy their potential eye-points before they do
  3. Force enemy groups into atari (1 liberty) or capture
```

### Implementation in ipvgo.js

- **isPotentialEye()**: Detects empty points that could become eyes
- **countEyesForGroup()**: Counts true eyes for a given group
- **wouldCreateEye()**: Tests if a move creates an eye
- **wouldBlockEnemyEye()**: Tests if a move blocks enemy eye creation
- **findMostVulnerableEnemyGroup()**: Finds enemy groups at risk

---

## Board-Size-Aware Strategy Framework

### 5x5 Board (Smallest)

**Character**: Fast, tactical, corner-focused

| Phase       | Moves | Strategy            | Key Actions                              |
| ----------- | ----- | ------------------- | ---------------------------------------- |
| **Opening** | 0-3   | Secure corners      | Center→corners, no mid-board exploration |
| **Midgame** | 4-10  | Build territory     | Connect groups, create first eyes        |
| **Endgame** | 11+   | Aggressive captures | Occupy enemy area, protect own eyes      |

**Pro Principles**:

- **Corners first**: Worth 2-3 points each vs 1 pt in center
- **Density**: Every stone matters; no wasted moves
- **Early eyes**: Create 2 eyes by move 10 to survive endgame

**Heuristic Bonuses** (5x5):

- Territory multiplier (moves 0-14): 80k-120k
- Territory multiplier (moves 15+): 500k-800k (aggressive endgame)
- Eye creation: 300k mid-game, 200k endgame
- Eye blocking: 150k-280k (higher if blocks vulnerable group)

---

### 7x7 Board (Compact)

**Character**: Balanced, strategic, requires early eye commitment

| Phase       | Moves | Strategy           | Key Actions                            |
| ----------- | ----- | ------------------ | -------------------------------------- |
| **Opening** | 0-4   | Establish base     | Corners, edges, secure 1st group       |
| **Midgame** | 5-14  | Territory battle   | Compete for influence, create eyes     |
| **Endgame** | 15+   | Score maximization | Capture territory, verify 2-eye safety |

**Pro Principles**:

- **Two-point opening**: Secure opposite corners (3-3 points or 3-4)
- **Fuseki patterns**: Play near edges initially, avoid isolated center play
- **Eye creation by move 12**: Ensures group survival in late midgame

**Heuristic Bonuses** (7x7):

- Endgame empty threshold: ~30% full
- Territory capture reward multiplies at move 15+
- Priority: Block enemy 2nd eye before creating your own (if you already have 1)

---

### 9x9 Board (Standard)

**Character**: Long strategic battles, opening fuseki matters, influence vs territory

| Phase       | Moves | Strategy            | Key Actions                                     |
| ----------- | ----- | ------------------- | ----------------------------------------------- |
| **Opening** | 0-6   | Influence patterns  | Classic 3-3, 3-4, 4-4 joseki; secure regions    |
| **Midgame** | 7-18  | Fight for territory | Invade/defend, eye creation chains              |
| **Endgame** | 19+   | Precision scoring   | Verify group safety, capture loose enemy stones |

**Pro Principles**:

- **Joseki knowledge**: Follow proven opening sequences (3-3 invasions, corner fights)
- **Influence before territory**: Early game is about strength/shape, not direct area
- **Split enemy territory**: Break their potential eye regions early

**Heuristic Bonuses** (9x9):

- Consolidation phase extends to move 14 (more mid-game territory fight)
- Eye creation priority: Mid-game (moves 7-14) >>> Late-game
- MCTS activated at move 4+ (more exploration needed)

---

### 13x13 Board (Large)

**Character**: Deep strategic planning, long-term influence, pro-level complexity

| Phase       | Moves | Strategy          | Key Actions                                 |
| ----------- | ----- | ----------------- | ------------------------------------------- |
| **Opening** | 0-8   | Fuseki/influence  | Extended opening book; establish frameworks |
| **Midgame** | 9-25  | Territory wars    | Invasions, reductions, group building       |
| **Endgame** | 26+   | Fine calculations | Verify all groups alive, tactical captures  |

**Pro Principles**:

- **Framework thinking**: Don't fight every point; build potential territory and invade
- **Sabaki (flexible play)**: Allow opponent territory but neutralize with living shapes
- **Eye creation chains**: Multi-stage eye creation (1st eye early, 2nd eye mid-late)
- **Kiai (fighting spirit)**: Take losses in one area to win decisively elsewhere

**Heuristic Bonuses** (13x13):

- Exact solver budget: 1200ms (longer search horizon)
- Longer MCTS time budgets: 800ms+ (deep tree search needed)
- Eye creation bonuses adjusted for larger board complexity

---

## Unified Scoring Model

### Main Move Heuristic (scoreMoveHeuristic)

```javascript
// Endgame filter (emptyCount < ENDGAME_START_EMPTY_THRESHOLD)
// Phase-aware bonuses:
score += capturedStones × 40000           // Always reward captures
score -= self_eye_fills × 50M             // HARD BAN
score += liberties × 25000                // Survival
score += consolidation_bonus × neighbors  // Build safe groups
score += eye_strategy_bonus               // NEW: Create/block eyes

// Territory control:
score += friendlyControl × 500-800k       // Scales by board size + phase
score -= enemyControl × 450-750k          // Endgame: punish enemy territory growth

// Weak chain protection:
score -= weaknesses × 120k                // Prevent captures
```

### Rough Scorer (MCTS Playouts)

```javascript
// Simpler, faster version for tree search:
score += captures × 40000
score += territory_owner_bonus × 250-800k
score += eye_strategy_bonus × 100-150k    // Scaled down (heuristic approximation)
```

---

## Strategic Decision Order (in chooseMove)

1. **Opening book**: Verified good first moves (if moveCount ≤ 2)
2. **Immediate captures**: Win-all moves that eliminate enemy
3. **Urgent defense**: Groups in atari
4. **Urgent structured defense**: Weak chains, threatened territory
5. **Urgent eye strategy** (NEW): Groups with 0 eyes OR enemy about to create 2 eyes
6. **Exact solver**: For late endgame with few moves left
7. **MCTS search**: For mid-game boards ≥7x7 or moveCount ≥ 4
8. **Heuristic ranking**: Score all remaining moves, pick top K, analyze deeply

---

## Key Adaptations by Board Size

| Factor            | 5x5                      | 7x7         | 9x9         | 13x13                  |
| ----------------- | ------------------------ | ----------- | ----------- | ---------------------- |
| Opening moves     | 0-3                      | 0-4         | 0-6         | 0-8                    |
| Midgame           | 4-10                     | 5-14        | 7-18        | 9-25                   |
| Eye priority      | HIGH (critical survival) | MEDIUM-HIGH | MEDIUM      | MEDIUM (space to live) |
| Territory focus   | CORNER-EDGE              | MIXED       | CENTER-EDGE | FRAMEWORK/INFLUENCE    |
| Exact solve depth | 12                       | 12          | 14          | 16                     |
| MCTS time budget  | 250ms                    | 350ms       | 500ms       | 800ms                  |

---

## Test Results (Current Win Rates vs BitBurner Bots)

- **Netburners** (AI style): 60%
- **Slum Snakes** (Tactical): 40%
- **Illuminati** (Pro-level): 7% → Target: 20-30% with eye strategy

---

## Future Enhancements

1. **Opening book expansion**: More fuseki patterns for 7x7, 9x9, 13x13
2. **Endgame solver improvements**: Faster evaluation of eye-creation tactics
3. **Ladder reading**: Detect running sequences and forced captures
4. **Influence map**: Use to avoid bad invasions early-game
5. **Pro game database analysis**: Learn winning patterns from real pro Go games

---

## Conclusion

**Pro Go Strategy** is about **resource management**: secure your group's life (2 eyes), threaten opponent's groups (block their eyes), and then maximize territory. This framework scales from fast 5x5 tactical play to strategic 13x13 battles.

**Key Insight**: When in doubt:

- **Early game**: Create eyes safely, don't invade recklessly
- **Mid-game**: Balance territory + eye creation, block enemy eyes
- **Endgame**: Capture all remaining enemy territory while protecting own eyes
