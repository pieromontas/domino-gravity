import { describe, it, expect } from 'vitest';
import { DominoEngine } from './dominoEngine.ts';
import { generateDoubleSixDeck, getHighestDouble, handTotalPips } from './dominoDeck.ts';
import { DominoAI } from './ai.ts';

describe('Domino Deck & Math', () => {
  it('generates exactly 28 unique tiles for Double-Six set', () => {
    const deck = generateDoubleSixDeck();
    expect(deck.length).toBe(28);

    const ids = new Set(deck.map(t => `${Math.min(t[0], t[1])}-${Math.max(t[0], t[1])}`));
    expect(ids.size).toBe(28);
  });

  it('determines highest double correctly', () => {
    const hand = [[1, 2], [3, 3], [5, 5], [0, 4]] as [number, number][];
    const highest = getHighestDouble(hand);
    expect(highest).toEqual([5, 5]);
  });

  it('calculates total pips in hand', () => {
    const hand = [[6, 6], [1, 2], [0, 0]] as [number, number][];
    expect(handTotalPips(hand)).toBe(15);
  });
});

describe('Domino Rules Engine - Strict Rule Enforcement', () => {
  it('creates and starts a 2-player game with 7 tiles each', () => {
    const engine = new DominoEngine();
    const state = engine.createGame([
      { id: 'p1', name: 'Human', avatar: '', isAI: false },
      { id: 'ai1', name: 'Bot', avatar: '', isAI: true, aiDifficulty: 'easy' }
    ], 100, 12345);

    expect(state.players[0].hand.length).toBe(7);
    expect(state.players[1].hand.length).toBe(7);
    expect(state.boneyard.length).toBe(14); // 28 - 14 = 14
    expect(state.chain.length).toBe(0);
    expect(state.status).toBe('playing');
    expect(state.requiredLeadTile).not.toBeNull();
  });

  it('does not auto-place the opener — highest double stays in the starter hand', () => {
    const engine = new DominoEngine();
    const state = engine.createGame([
      { id: 'p1', name: 'Human', avatar: '', isAI: false },
      { id: 'ai1', name: 'Bot', avatar: '', isAI: true, aiDifficulty: 'easy' }
    ], 100, 12345);

    const lead = state.requiredLeadTile!;
    expect(state.chain.length).toBe(0);
    expect(state.openEnds).toEqual({ left: null, right: null });
    const starter = state.players[state.currentTurn];
    expect(starter.hand.some((t) =>
      (t[0] === lead[0] && t[1] === lead[1]) || (t[0] === lead[1] && t[1] === lead[0])
    )).toBe(true);
  });

  it('enforces starter rule: starter must lead with highest double', () => {
    const engine = new DominoEngine();
    const state = engine.createGame([
      { id: 'p1', name: 'Human', avatar: '', isAI: false },
      { id: 'ai1', name: 'Bot', avatar: '', isAI: true }
    ], 100, 12345);

    const starterSeat = state.currentTurn;
    const starterPlayer = state.players[starterSeat];
    const requiredLead = state.requiredLeadTile!;

    // Find a non-lead tile in starter's hand
    const nonLeadTile = starterPlayer.hand.find(t =>
      !(t[0] === requiredLead[0] && t[1] === requiredLead[1]) &&
      !(t[0] === requiredLead[1] && t[1] === requiredLead[0])
    );

    if (nonLeadTile) {
      // Trying to play any other tile must be rejected!
      const invalidMoveSuccess = engine.playTile(state, starterSeat, nonLeadTile, 'right');
      expect(invalidMoveSuccess).toBe(false);
      expect(state.chain.length).toBe(0);
    }

    // Playing the required lead tile must succeed
    const validSuccess = engine.playTile(state, starterSeat, requiredLead, 'right');
    expect(validSuccess).toBe(true);
    expect(state.chain.length).toBe(1);
    expect(state.requiredLeadTile).toBeNull();
  });

  it('enforces draw rule: cannot draw when holding playable tiles', () => {
    const engine = new DominoEngine();
    const state = engine.createGame([
      { id: 'p1', name: 'Human', avatar: '', isAI: false },
      { id: 'ai1', name: 'Bot', avatar: '', isAI: true }
    ], 100, 12345);

    // Play lead tile
    const starter = state.currentTurn;
    engine.playTile(state, starter, state.requiredLeadTile!, 'right');

    const nextSeat = state.currentTurn;
    const nextPlayer = state.players[nextSeat];

    // Check if next player has a legal move
    const legalMoves = engine.getLegalMoves(nextPlayer.hand, state.openEnds, false);
    if (legalMoves.length > 0) {
      // Trying to draw when having legal moves must return null
      const drawResult = engine.drawTile(state, nextSeat);
      expect(drawResult).toBeNull();
    }
  });

  it('enforces pass rule: cannot pass when boneyard still has tiles or moves exist', () => {
    const engine = new DominoEngine();
    const state = engine.createGame([
      { id: 'p1', name: 'Human', avatar: '', isAI: false },
      { id: 'ai1', name: 'Bot', avatar: '', isAI: true }
    ], 100, 12345);

    // Play lead tile
    const starter = state.currentTurn;
    engine.playTile(state, starter, state.requiredLeadTile!, 'right');

    const nextSeat = state.currentTurn;
    // Boneyard has tiles: passing must fail
    expect(state.boneyard.length).toBeGreaterThan(0);
    const passResult = engine.passTurn(state, nextSeat);
    expect(passResult).toBe(false);
  });

  it('detects legal moves properly on chain', () => {
    const engine = new DominoEngine();
    const state = engine.createGame([
      { id: 'p1', name: 'Human', avatar: '', isAI: false },
      { id: 'ai1', name: 'Bot', avatar: '', isAI: true }
    ], 100, 12345);

    // Force open ends to [2, 5]
    state.openEnds = { left: 2, right: 5 };
    state.chain = [{
      id: 'p0',
      tile: [2, 5],
      isDouble: false,
      position: { x: 0, y: 0, z: 0 },
      rotationY: 0,
      pipLeft: 2,
      pipRight: 5,
      outwardX: 1,
      outwardZ: 0
    }];

    const testHand: [number, number][] = [[2, 4], [5, 5], [0, 1]];
    const moves = engine.getLegalMoves(testHand, state.openEnds, false);

    expect(moves.length).toBe(2);
    expect(moves.some(m => m.tile[0] === 2 && m.tile[1] === 4 && m.side === 'left')).toBe(true);
    expect(moves.some(m => m.tile[0] === 5 && m.tile[1] === 5 && m.side === 'right')).toBe(true);
  });

  it('AI makes legal moves or draws/passes', () => {
    const engine = new DominoEngine();
    const ai = new DominoAI(engine);
    const state = engine.createGame([
      { id: 'p1', name: 'Human', avatar: '', isAI: false },
      { id: 'ai1', name: 'Bot', avatar: '', isAI: true, aiDifficulty: 'normal' }
    ], 100, 12345);

    // Let current player play lead tile
    const starter = state.currentTurn;
    engine.playTile(state, starter, state.requiredLeadTile!, 'right');

    const nextSeat = state.currentTurn;
    const decision = ai.makeDecision(state, nextSeat);

    expect(['play', 'draw', 'pass']).toContain(decision.action);
    if (decision.action === 'play') {
      expect(decision.move).toBeDefined();
    }
  });
});
