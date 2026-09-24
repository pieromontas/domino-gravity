import { describe, expect, it, vi } from 'vitest';
import { DominoAI } from './ai.ts';
import { DominoEngine } from './dominoEngine.ts';
import { AIDifficulty, GameState, Tile } from './types.ts';
import { cycleAIDifficulty, formatAIDifficultyLabel, parseAIDifficulty } from './aiDifficulty.ts';
import { emptyPartnershipFields } from './partnership.ts';

function decisionState(hand: Tile[], difficulty: AIDifficulty): GameState {
  return {
    status: 'playing',
    players: [
      {
        id: 'ai',
        name: 'Bot',
        avatar: '',
        isAI: true,
        aiDifficulty: difficulty,
        hand,
        score: 0,
        seat: 0,
        connected: true
      },
      {
        id: 'human',
        name: 'You',
        avatar: '',
        isAI: false,
        hand: [[0, 0], [3, 3]],
        score: 0,
        seat: 1,
        connected: true
      }
    ],
    boneyard: [],
    chain: [{
      id: 'c0',
      tile: [6, 0],
      isDouble: false,
      position: { x: 0, y: 0, z: 0 },
      rotationY: 0,
      pipLeft: 6,
      pipRight: 0,
      outwardX: 1,
      outwardZ: 0
    }],
    openEnds: { left: 6, right: 0 },
    currentTurn: 0,
    firstTurnOfRound: false,
    consecutivePasses: 0,
    roundNumber: 1,
    targetScore: 100,
    tableId: 'classic',
    lastAction: '',
    winnerSeat: null,
    ...emptyPartnershipFields(),
    seed: 1
  };
}

describe('AI difficulty helpers', () => {
  it('parses, labels, and cycles Easy → Normal → Hard', () => {
    expect(parseAIDifficulty(undefined)).toBe('easy');
    expect(parseAIDifficulty('nope')).toBe('easy');
    expect(parseAIDifficulty('hard')).toBe('hard');
    expect(formatAIDifficultyLabel('normal')).toBe('NORMAL');
    expect(formatAIDifficultyLabel(undefined)).toBe('EASY');
    expect(cycleAIDifficulty('easy')).toBe('normal');
    expect(cycleAIDifficulty('normal')).toBe('hard');
    expect(cycleAIDifficulty('hard')).toBe('easy');
  });
});

describe('DominoAI difficulty behavior', () => {
  const engine = new DominoEngine();
  const ai = new DominoAI(engine);
  /** [6|5] is the high-pip play; [6|2] keeps a 2-suit the AI still holds. */
  const hand: Tile[] = [[6, 2], [2, 2], [6, 5]];

  it('easy picks a random legal move', () => {
    const state = decisionState(hand, 'easy');
    const legal = engine.getLegalMoves(hand, state.openEnds, false);
    expect(legal.length).toBeGreaterThan(1);

    vi.spyOn(Math, 'random').mockReturnValue(0);
    const first = ai.makeDecision(state, 0);
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    const last = ai.makeDecision(state, 0);
    vi.restoreAllMocks();

    expect(first.action).toBe('play');
    expect(last.action).toBe('play');
    expect(first.move?.tile).toEqual(legal[0].tile);
    expect(last.move?.tile).toEqual(legal[legal.length - 1].tile);
  });

  it('normal prefers high-pip tiles over suit control', () => {
    const decision = ai.makeDecision(decisionState(hand, 'normal'), 0);
    expect(decision.action).toBe('play');
    expect(decision.move?.tile).toEqual([6, 5]);
  });

  it('hard prefers keeping a suit it still holds', () => {
    const decision = ai.makeDecision(decisionState(hand, 'hard'), 0);
    expect(decision.action).toBe('play');
    expect(decision.move?.tile).toEqual([6, 2]);
  });
});
