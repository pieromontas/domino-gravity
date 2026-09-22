import { AIDifficulty, GameState, LegalMove, Tile } from './types.js';
import { DominoEngine } from './dominoEngine.js';
import { isDouble, tileTotalPips } from './dominoDeck.js';

export interface AIDecision {
  action: 'play' | 'draw' | 'pass';
  move?: LegalMove;
}

export class DominoAI {
  private engine: DominoEngine;

  constructor(engine: DominoEngine) {
    this.engine = engine;
  }

  /**
   * Evaluates best action for AI given current game state
   */
  public makeDecision(state: GameState, aiSeat: number): AIDecision {
    const aiPlayer = state.players[aiSeat];
    const difficulty: AIDifficulty = aiPlayer.aiDifficulty || 'easy';
    const isChainEmpty = state.chain.length === 0;

    const legalMoves = this.engine.getLegalMoves(aiPlayer.hand, state.openEnds, isChainEmpty, state.requiredLeadTile);

    // If legal moves exist, pick based on difficulty
    if (legalMoves.length > 0) {
      const chosenMove = this.selectMove(legalMoves, difficulty, state, aiPlayer.hand);
      return { action: 'play', move: chosenMove };
    }

    // No legal moves: draw if boneyard has tiles
    if (state.boneyard.length > 0) {
      return { action: 'draw' };
    }

    // Otherwise pass
    return { action: 'pass' };
  }

  private selectMove(
    legalMoves: LegalMove[],
    difficulty: AIDifficulty,
    state: GameState,
    hand: Tile[]
  ): LegalMove {
    if (difficulty === 'easy') {
      // Pick random legal move
      const idx = Math.floor(Math.random() * legalMoves.length);
      return legalMoves[idx];
    }

    if (difficulty === 'normal') {
      // Normal:
      // 1. Prefer playing doubles to unclog them
      // 2. Prefer high-pip tiles
      const rankedMoves = [...legalMoves].sort((a, b) => {
        const doubleA = isDouble(a.tile) ? 100 : 0;
        const doubleB = isDouble(b.tile) ? 100 : 0;
        const pipsA = tileTotalPips(a.tile);
        const pipsB = tileTotalPips(b.tile);
        return (doubleB + pipsB) - (doubleA + pipsA);
      });
      return rankedMoves[0];
    }

    // Hard:
    // 1. Card counting: track tiles already played + in own hand
    // 2. If an opponent has 1 or 2 tiles left, prioritize dumping highest tiles or blocking
    // 3. Keep chain open to suits where AI has multiple matching tiles
    return this.selectHardMove(legalMoves, state, hand);
  }

  private selectHardMove(legalMoves: LegalMove[], state: GameState, hand: Tile[]): LegalMove {
    // Count suit frequencies in our remaining hand
    const suitCounts: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
    for (const tile of hand) {
      suitCounts[tile[0]]++;
      suitCounts[tile[1]]++;
    }

    // Check if next opponent is low on tiles (threat alert)
    const nextPlayerIdx = (state.currentTurn + 1) % state.players.length;
    const nextPlayer = state.players[nextPlayerIdx];
    const isThreat = nextPlayer.hand.length <= 2;

    let bestScore = -Infinity;
    let bestMove = legalMoves[0];

    for (const move of legalMoves) {
      let score = 0;
      const pips = tileTotalPips(move.tile);
      const isDbl = isDouble(move.tile);

      // Value getting rid of high pips
      score += pips * 1.5;

      // Doubles are risky to hold late game
      if (isDbl) {
        score += 15;
      }

      // Determine what new pip will be open on this end
      const targetPip = move.side === 'left' ? state.openEnds.left : state.openEnds.right;
      const newOpenPip = (targetPip !== null && move.tile[0] === targetPip) ? move.tile[1] : move.tile[0];

      // Bonus if we hold another tile of the new open pip (maintaining initiative)
      const matchesInHand = suitCounts[newOpenPip] || 0;
      score += matchesInHand * 8;

      // If next player is low on tiles, heavily penalize holding high doubles
      if (isThreat) {
        if (pips >= 8) score += 20;
      }

      if (score > bestScore) {
        bestScore = score;
        bestMove = move;
      }
    }

    return bestMove;
  }
}
