import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RoomClient } from './roomClient.ts';
import { buildAlternatingSnake } from '../engine/chainPath.ts';
import { GameState } from '../engine/types.ts';

function clientWithUpdates() {
  const updates: GameState[] = [];
  const room = new RoomClient({
    onStateUpdate: (state) => {
      updates.push({
        ...state,
        chain: [...state.chain],
        players: state.players.map((p) => ({ ...p, hand: [...p.hand] }))
      });
    }
  });
  return { room, updates };
}

describe('local AI difficulty selection', () => {
  it('adds a bot at the chosen difficulty and can change it in the lobby', () => {
    const { room } = clientWithUpdates();
    const existing = room.getState().players.find((p) => p.isAI);
    expect(existing?.aiDifficulty).toBe('easy');

    expect(room.addAI('hard')).toBe(true);
    const added = room.getState().players.find((p) => p.name.startsWith('Felix'));
    expect(added?.isAI).toBe(true);
    expect(added?.aiDifficulty).toBe('hard');

    expect(room.setAIDifficulty(added!.seat, 'normal')).toBe(true);
    expect(room.getState().players.find((p) => p.seat === added!.seat)?.aiDifficulty).toBe('normal');

    room.startGame();
    expect(room.getState().status).toBe('playing');
    expect(room.getState().players.find((p) => p.seat === added!.seat)?.aiDifficulty).toBe('normal');
    expect(room.setAIDifficulty(added!.seat, 'easy')).toBe(false);
  });

  it('does not change a human seat difficulty', () => {
    const { room } = clientWithUpdates();
    expect(room.setAIDifficulty(room.getLocalSeat(), 'hard')).toBe(false);
    expect(room.getState().players[0].aiDifficulty).toBeUndefined();
  });
});

describe('local table selection', () => {
  it('defaults to classic and can switch maps in the lobby', () => {
    const { room } = clientWithUpdates();
    expect(room.getState().tableId).toBe('classic');

    room.setTable('dominican');
    expect(room.getState().tableId).toBe('dominican');
    expect(room.getState().lastAction).toMatch(/República Dominicana/);

    room.startGame();
    expect(room.getState().status).toBe('playing');
    expect(room.getState().tableId).toBe('dominican');
    room.setTable('classic');
    expect(room.getState().tableId).toBe('dominican');

    room.resetMatch();
    expect(room.getState().status).toBe('lobby');
    expect(room.getState().tableId).toBe('dominican');
    room.setTable('classic');
    expect(room.getState().tableId).toBe('classic');
  });

  it('enables partnership on the fourth seat and supports team names', () => {
    const { room } = clientWithUpdates();
    expect(room.getState().partnership).toBe(false);
    expect(room.addAI('easy')).toBe(true);
    expect(room.addAI('easy')).toBe(true);
    expect(room.getState().players).toHaveLength(4);
    expect(room.getState().partnership).toBe(true);
    room.setTeamName(0, 'Norte');
    expect(room.getState().teams[0].name).toBe('Norte');
    room.setPartnership(false);
    expect(room.getState().partnership).toBe(false);
  });
});

describe('Room start / rematch clears the table', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('deals a real match with an empty chain after a long-chain preview', () => {
    const { room, updates } = clientWithUpdates();
    room.loadStandalonePreview(buildAlternatingSnake(24), [[6, 5], [4, 3]]);
    expect(room.isLayoutPreview()).toBe(true);
    expect(room.getState().chain.length).toBe(24);

    room.startGame();

    expect(room.isLayoutPreview()).toBe(false);
    const state = room.getState();
    expect(state.status).toBe('playing');
    expect(state.chain).toEqual([]);
    expect(state.openEnds).toEqual({ left: null, right: null });
    expect(state.requiredLeadTile).not.toBeNull();
    expect(state.players.every((p) => p.hand.length === 7)).toBe(true);

    const afterStart = updates[updates.length - 1];
    expect(afterStart.chain).toEqual([]);
    expect(afterStart.status).toBe('playing');
  });

  it('does not auto-place the required lead — table stays empty until that tile is played', () => {
    const { room } = clientWithUpdates();
    room.startGame();
    const state = room.getState();
    const lead = state.requiredLeadTile!;
    expect(state.chain.length).toBe(0);

    const starter = state.currentTurn;
    if (starter === room.getLocalSeat()) {
      expect(room.playTile(lead, 'right')).toBe(true);
      expect(room.getState().chain.length).toBe(1);
      expect(room.getState().requiredLeadTile).toBeNull();
    } else {
      // AI holds the lead; they place it only after the think delay.
      expect(room.getState().chain.length).toBe(0);
      vi.advanceTimersByTime(2000);
      expect(room.getState().chain.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('clears the chain on rematch (lobby) and the following deal', () => {
    const { room } = clientWithUpdates();
    room.startGame();
    const lead = room.getState().requiredLeadTile!;
    if (room.getState().currentTurn === room.getLocalSeat()) {
      room.playTile(lead, 'right');
    } else {
      vi.advanceTimersByTime(2000);
    }
    expect(room.getState().chain.length).toBeGreaterThan(0);

    room.resetMatch();
    expect(room.getState().status).toBe('lobby');
    expect(room.getState().chain).toEqual([]);
    expect(room.getState().openEnds).toEqual({ left: null, right: null });

    room.startGame();
    expect(room.getState().chain).toEqual([]);
    expect(room.getState().status).toBe('playing');
  });

  it('clears the chain when starting the next round', () => {
    const { room } = clientWithUpdates();
    room.startGame();
    const lead = room.getState().requiredLeadTile!;
    if (room.getState().currentTurn === room.getLocalSeat()) {
      room.playTile(lead, 'right');
    } else {
      vi.advanceTimersByTime(2000);
    }
    expect(room.getState().chain.length).toBeGreaterThan(0);

    room.startNextRound();
    expect(room.getState().roundNumber).toBe(2);
    expect(room.getState().chain).toEqual([]);
    expect(room.getState().status).toBe('playing');
  });
});
