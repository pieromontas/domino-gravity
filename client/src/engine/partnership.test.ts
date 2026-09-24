import { describe, expect, it } from 'vitest';
import { DominoEngine } from './dominoEngine.ts';
import {
  isClassicCapicua,
  isPartnershipActive,
  opposingTeamPips,
  sanitizeTeamName,
  seatPartnersOpposite,
  setPartnerPair,
  swapSeatToOtherTeam,
  swapSeats,
  syncPartnershipRoster,
  teamsAreBalanced
} from './partnership.ts';
import { GameState, Tile } from './types.ts';

function fourPlayerState(): GameState {
  const engine = new DominoEngine();
  return engine.createGame(
    [
      { id: 'p0', name: 'Ana', avatar: '', isAI: false },
      { id: 'p1', name: 'Beto', avatar: '', isAI: false },
      { id: 'p2', name: 'Cata', avatar: '', isAI: false },
      { id: 'p3', name: 'Dario', avatar: '', isAI: true, aiDifficulty: 'easy' }
    ],
    100,
    7
  );
}

function forceHands(state: GameState, hands: Tile[][]) {
  state.requiredLeadTile = null;
  state.chain = [];
  state.openEnds = { left: null, right: null };
  state.currentTurn = 0;
  state.boneyard = [];
  state.consecutivePasses = 0;
  state.lastPassSeat = null;
  state.tableCall = null;
  state.players.forEach((p, i) => {
    p.hand = hands[i].map((t) => [t[0], t[1]] as Tile);
  });
}

describe('Partnership helpers', () => {
  it('defaults 4 seats to opposite partners 0+2 vs 1+3', () => {
    const state = fourPlayerState();
    expect(isPartnershipActive(state)).toBe(true);
    expect(state.players.map((p) => p.teamId)).toEqual([0, 1, 0, 1]);
    expect(state.teams[0].seats).toEqual([0, 2]);
    expect(state.teams[1].seats).toEqual([1, 3]);
    expect(state.teams[0].name).toBe('Equipo A');
  });

  it('drops partnership when a seat is removed', () => {
    const state = fourPlayerState();
    state.players.pop();
    state.players.forEach((p, i) => { p.seat = i; });
    syncPartnershipRoster(state);
    expect(isPartnershipActive(state)).toBe(false);
    expect(state.teams).toEqual([]);
  });

  it('swaps a seat onto the other team and keeps 2v2', () => {
    const state = fourPlayerState();
    expect(swapSeatToOtherTeam(state, 0)).toBe(true);
    expect(state.players[0].teamId).toBe(1);
    const counts = [0, 0];
    state.players.forEach((p) => { counts[p.teamId ?? 0] += 1; });
    expect(counts).toEqual([2, 2]);
  });

  it('reseats partners opposite after a swap', () => {
    const state = fourPlayerState();
    swapSeatToOtherTeam(state, 0);
    expect(seatPartnersOpposite(state)).toBe(true);
    expect(state.players.filter((_, i) => i % 2 === 0).every((p) => p.teamId === 0)).toBe(true);
    expect(state.players.filter((_, i) => i % 2 === 1).every((p) => p.teamId === 1)).toBe(true);
  });

  it('lets the host pair any two seats and forces the other two onto the other team', () => {
    const state = fourPlayerState();
    expect(setPartnerPair(state, 0, 1)).toBe(true);
    expect(state.players[0].teamId).toBe(0);
    expect(state.players[1].teamId).toBe(0);
    expect(state.players[2].teamId).toBe(1);
    expect(state.players[3].teamId).toBe(1);
    expect(teamsAreBalanced(state)).toBe(true);
    expect(state.teams[0].seats).toEqual([0, 1]);
    expect(state.teams[1].seats).toEqual([2, 3]);

    expect(setPartnerPair(state, 1, 3, 1)).toBe(true);
    expect(state.players.filter((p) => p.teamId === 1).map((p) => p.seat).sort()).toEqual([1, 3]);
    expect(state.players.filter((p) => p.teamId === 0).map((p) => p.seat).sort()).toEqual([0, 2]);
    expect(teamsAreBalanced(state)).toBe(true);
  });

  it('rejects partner pairs that would not stay 2v2', () => {
    const state = fourPlayerState();
    expect(setPartnerPair(state, 0, 0)).toBe(false);
    expect(setPartnerPair(state, 0, 4)).toBe(false);
    expect(setPartnerPair(state, -1, 2)).toBe(false);
    state.players.pop();
    expect(setPartnerPair(state, 0, 1)).toBe(false);
  });

  it('swaps seated identities without changing who partners with whom', () => {
    const state = fourPlayerState();
    const hostId = state.players[0].id;
    const aiId = state.players[3].id;
    expect(swapSeats(state, 0, 3)).toBe(true);
    expect(state.players[0].id).toBe(aiId);
    expect(state.players[3].id).toBe(hostId);
    expect(state.players[0].isAI).toBe(true);
    expect(state.players[3].name).toBe('Ana');
    expect(state.players[0].teamId).toBe(1);
    expect(state.players[3].teamId).toBe(0);
    expect(teamsAreBalanced(state)).toBe(true);
    expect(swapSeats(state, 0, 0)).toBe(false);
  });

  it('sanitizes team names', () => {
    expect(sanitizeTeamName('  Los Tigres  ', 'Equipo A')).toBe('Los Tigres');
    expect(sanitizeTeamName('<b>x</b>', 'Equipo A')).toBe('bx/b');
    expect(sanitizeTeamName('   ', 'Equipo A')).toBe('Equipo A');
  });
});

describe('Dominican scoring — pase, capicúa, team totals', () => {
  it('awards only opposing-team pips on a partnership domino', () => {
    const engine = new DominoEngine();
    const state = fourPlayerState();
    forceHands(state, [
      [[3, 6]],
      [[1, 1], [2, 2]],
      [[6, 6]],
      [[4, 4], [5, 5]]
    ]);
    state.openEnds = { left: 3, right: 2 };
    state.chain = [{
      id: 'c0',
      tile: [3, 2],
      isDouble: false,
      position: { x: 0, y: 0, z: 0 },
      rotationY: 0,
      pipLeft: 3,
      pipRight: 2,
      outwardX: 1,
      outwardZ: 0
    }];

    // Opposing team (1+3) has 2+4 + 8+10 = 24; partner leftover 12 is ignored.
    expect(opposingTeamPips(state, 0)).toBe(24);
    expect(engine.playTile(state, 0, [3, 6], 'left')).toBe(true);
    expect(state.status).toBe('round_end');
    expect(state.roundSummary?.pointsWon).toBe(24);
    expect(state.roundSummary?.capicua).toBe(false);
    expect(state.teams[0].score).toBe(24);
    expect(state.players[0].score).toBe(24);
    expect(state.players[2].score).toBe(24);
    expect(state.players[1].score).toBe(0);
  });

  it('doubles opposing-team pips on classic capicúa', () => {
    const engine = new DominoEngine();
    const state = fourPlayerState();
    forceHands(state, [
      [[3, 6]],
      [[1, 2]],
      [[0, 0]],
      [[4, 5]]
    ]);
    state.openEnds = { left: 3, right: 6 };
    state.chain = [{
      id: 'c0',
      tile: [3, 6],
      isDouble: false,
      position: { x: 0, y: 0, z: 0 },
      rotationY: 0,
      pipLeft: 3,
      pipRight: 6,
      outwardX: 1,
      outwardZ: 0
    }];

    const legal = engine.getLegalMoves([[3, 6]], state.openEnds, false);
    expect(isClassicCapicua([3, 6], state.openEnds, legal)).toBe(true);
    expect(engine.playTile(state, 0, [3, 6], 'left')).toBe(true);
    expect(state.tableCall?.kind).toBe('capicua');
    expect(state.tableCall?.text).toBe('¡Capicúa!');
    // Opponents: 3 + 9 = 12, doubled = 24
    expect(state.roundSummary?.pointsWon).toBe(24);
    expect(state.roundSummary?.capicua).toBe(true);
    expect(state.teams[0].score).toBe(24);
  });

  it('does not treat matching identical ends as classic capicúa', () => {
    const engine = new DominoEngine();
    const legal = engine.getLegalMoves([[5, 1]], { left: 5, right: 5 }, false);
    expect(isClassicCapicua([5, 1], { left: 5, right: 5 }, legal)).toBe(false);
  });

  it('shows ¡Pase! and then ¡Pase y corrido! on the next play', () => {
    const engine = new DominoEngine();
    const state = fourPlayerState();
    forceHands(state, [
      [[0, 1]],
      [[3, 4]],
      [[2, 5]],
      [[6, 6]]
    ]);
    state.openEnds = { left: 6, right: 6 };
    state.chain = [{
      id: 'c0',
      tile: [6, 6],
      isDouble: true,
      position: { x: 0, y: 0, z: 0 },
      rotationY: 0,
      pipLeft: 6,
      pipRight: 6,
      outwardX: 1,
      outwardZ: 0
    }];
    state.currentTurn = 0;

    expect(engine.passTurn(state, 0)).toBe(true);
    expect(state.tableCall?.kind).toBe('pase');
    expect(state.tableCall?.text).toBe('¡Pase!');
    expect(state.lastPassSeat).toBe(0);
    expect(state.currentTurn).toBe(1);

    // Seat 1 still cannot play; pass again
    expect(engine.passTurn(state, 1)).toBe(true);
    expect(state.tableCall?.kind).toBe('pase');

    // Seat 2 cannot play; pass
    expect(engine.passTurn(state, 2)).toBe(true);

    // Seat 3 can play the double-6 match... wait they have [6,6] but chain already has 6-6.
    // Give seat 3 a 6-2 after the three passes.
    state.players[3].hand = [[6, 2], [0, 0]];
    expect(engine.playTile(state, 3, [6, 2], 'right')).toBe(true);
    expect(state.tableCall?.kind).toBe('pase_corrido');
    expect(state.tableCall?.text).toBe('¡Pase y corrido!');
  });

  it('keeps 2-player free-for-all scoring (all other seats, no team share)', () => {
    const engine = new DominoEngine();
    const state = engine.createGame([
      { id: 'p0', name: 'You', avatar: '', isAI: false },
      { id: 'p1', name: 'Bot', avatar: '', isAI: true }
    ], 100, 3);
    expect(isPartnershipActive(state)).toBe(false);

    state.requiredLeadTile = null;
    state.currentTurn = 0;
    state.boneyard = [];
    state.openEnds = { left: 2, right: 5 };
    state.chain = [{
      id: 'c0',
      tile: [2, 5],
      isDouble: false,
      position: { x: 0, y: 0, z: 0 },
      rotationY: 0,
      pipLeft: 2,
      pipRight: 5,
      outwardX: 1,
      outwardZ: 0
    }];
    state.players[0].hand = [[2, 4]];
    state.players[1].hand = [[6, 6], [1, 1]];

    expect(engine.playTile(state, 0, [2, 4], 'left')).toBe(true);
    expect(state.roundSummary?.pointsWon).toBe(14);
    expect(state.players[0].score).toBe(14);
    expect(state.players[1].score).toBe(0);
  });

  it('scores a blocked partnership from team pip totals', () => {
    const engine = new DominoEngine();
    const state = fourPlayerState();
    forceHands(state, [
      [[0, 1]],
      [[6, 6]],
      [[0, 2]],
      [[5, 5]]
    ]);
    state.openEnds = { left: 3, right: 4 };
    state.chain = [{
      id: 'c0',
      tile: [3, 4],
      isDouble: false,
      position: { x: 0, y: 0, z: 0 },
      rotationY: 0,
      pipLeft: 3,
      pipRight: 4,
      outwardX: 1,
      outwardZ: 0
    }];
    state.currentTurn = 0;

    expect(engine.passTurn(state, 0)).toBe(true);
    expect(engine.passTurn(state, 1)).toBe(true);
    expect(engine.passTurn(state, 2)).toBe(true);
    expect(engine.passTurn(state, 3)).toBe(true);

    // Team A pips 1+2=3, Team B 12+10=22 → A wins 19
    expect(state.status).toBe('round_end');
    expect(state.roundSummary?.reason).toBe('blocked');
    expect(state.roundSummary?.pointsWon).toBe(19);
    expect(state.teams[0].score).toBe(19);
  });
});
