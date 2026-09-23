import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebSocket } from 'ws';
import { GameRoom } from './room.js';
import { redactGameState, handsLeakInState } from './redact.js';
import { deriveActivityRoomKey, isForbiddenGlobalRoom } from './roomKey.js';
import { SessionStore } from './session.js';

function mockSocket() {
  const sent: unknown[] = [];
  const ws = {
    readyState: WebSocket.OPEN,
    sent,
    send(data: string) {
      sent.push(JSON.parse(data));
    },
    close() { /* noop */ }
  };
  return ws as unknown as WebSocket & { sent: unknown[] };
}

function session(store: SessionStore, name: string, userId: string) {
  return store.createDevSession({ displayName: name, userId });
}

describe('room key identity', () => {
  it('derives a stable key from instance + channel + guild', () => {
    const a = deriveActivityRoomKey({
      instanceId: 'i-111',
      channelId: 'chan-a',
      guildId: 'guild-a'
    });
    const b = deriveActivityRoomKey({
      instanceId: 'i-111',
      channelId: 'chan-a',
      guildId: 'guild-a'
    });
    const otherLaunch = deriveActivityRoomKey({
      instanceId: 'i-222',
      channelId: 'chan-a',
      guildId: 'guild-a'
    });
    expect(a).toBe('discord:guild-a:chan-a:i-111');
    expect(a).toBe(b);
    expect(otherLaunch).not.toBe(a);
  });

  it('rejects the global default-room fallback', () => {
    expect(isForbiddenGlobalRoom('default-room')).toBe(true);
    expect(isForbiddenGlobalRoom('')).toBe(true);
    expect(isForbiddenGlobalRoom('discord:g:c:i-1')).toBe(false);
  });
});

describe('unique seating, host, reconnect', () => {
  const store = new SessionStore();
  let room: GameRoom;

  beforeEach(() => {
    vi.useFakeTimers();
    room = new GameRoom('discord:g:c:i-1', { graceMs: 50, aiDelayMs: 0 });
  });

  afterEach(() => {
    room.dispose();
    vi.useRealTimers();
  });

  it('seats each authenticated user once and makes the first human host', () => {
    const alex = session(store, 'Alex', 'user-alex');
    const sam = session(store, 'Sam', 'user-sam');
    const seatA = room.addAuthenticatedPlayer(alex, mockSocket());
    const seatB = room.addAuthenticatedPlayer(sam, mockSocket());
    expect(seatA).toBe(0);
    expect(seatB).toBe(1);
    expect(room.state.players.filter((p) => p.id === 'user-alex')).toHaveLength(1);
    expect(room.state.players[0].isHost).toBe(true);
    expect(room.state.players[0].name).toBe('Alex');
    expect(room.state.players[1].isHost).toBe(false);
    expect(room.state.players[1].name).toBe('Sam');
  });

  it('does not duplicate a reconnecting user', () => {
    const alex = session(store, 'Alex', 'user-alex');
    const first = mockSocket();
    const seat1 = room.addAuthenticatedPlayer(alex, first);
    room.handleDisconnect('user-alex');
    const seat2 = room.addAuthenticatedPlayer(alex, mockSocket());
    expect(seat1).toBe(seat2);
    expect(room.state.players.filter((p) => p.id === 'user-alex')).toHaveLength(1);
    expect(room.state.players[0].connected).toBe(true);
  });

  it('migrates host to the next connected human without resetting the lobby', () => {
    const alex = session(store, 'Alex', 'user-alex');
    const sam = session(store, 'Sam', 'user-sam');
    room.addAuthenticatedPlayer(alex, mockSocket());
    room.addAuthenticatedPlayer(sam, mockSocket());
    room.setTargetScore('user-alex', 50);
    expect(room.state.targetScore).toBe(50);

    room.handleDisconnect('user-alex');
    expect(room.state.players.find((p) => p.id === 'user-sam')?.isHost).toBe(true);
    expect(room.state.status).toBe('lobby');
    expect(room.state.targetScore).toBe(50);

    const start = room.startGame('user-sam');
    expect(start.ok).toBe(false);
    room.addAI('user-sam', 'easy');
    expect(room.startGame('user-sam').ok).toBe(true);
    expect(room.state.status).toBe('playing');
  });

  it('reserves a pending Discord participant once and never lets AI take that seat', () => {
    const alex = session(store, 'Alex', 'user-alex');
    room.addAuthenticatedPlayer(alex, mockSocket());
    room.applyParticipants([
      { id: 'user-alex', name: 'Alex', avatar: '' },
      { id: 'user-sam', name: 'Sam', avatar: '' }
    ]);
    expect(room.state.players.map((p) => p.id)).toEqual(['user-alex', 'user-sam']);
    expect(room.addAI('user-alex', 'easy').ok).toBe(false);
    expect(room.state.players.filter((p) => p.id === 'user-sam')).toHaveLength(1);

    const sam = session(store, 'Sam', 'user-sam');
    const seat = room.addAuthenticatedPlayer(sam, mockSocket());
    expect(seat).toBe(1);
    expect(room.state.players.filter((p) => p.id === 'user-sam')).toHaveLength(1);
    expect(room.state.players[1].pendingJoin).toBe(false);
  });

  it('removes a pending participant who left the Activity', () => {
    const alex = session(store, 'Alex', 'user-alex');
    room.addAuthenticatedPlayer(alex, mockSocket());
    room.applyParticipants([
      { id: 'user-alex', name: 'Alex', avatar: '' },
      { id: 'user-sam', name: 'Sam', avatar: '' }
    ]);
    room.applyParticipants([{ id: 'user-alex', name: 'Alex', avatar: '' }]);
    expect(room.state.players.map((p) => p.id)).toEqual(['user-alex']);
  });

  it('reconnects the same user to the same seat within the grace period', () => {
    const alex = session(store, 'Alex', 'user-alex');
    const sam = session(store, 'Sam', 'user-sam');
    room.addAuthenticatedPlayer(alex, mockSocket());
    room.addAuthenticatedPlayer(sam, mockSocket());
    room.addAI('user-alex', 'easy');
    expect(room.startGame('user-alex').ok).toBe(true);
    const seatBefore = room.state.players.find((p) => p.id === 'user-sam')!.seat;
    room.handleDisconnect('user-sam');
    vi.advanceTimersByTime(20);
    const seatAfter = room.addAuthenticatedPlayer(sam, mockSocket());
    expect(seatAfter).toBe(seatBefore);
    expect(room.state.status).toBe('playing');
    expect(room.state.players.filter((p) => p.id === 'user-sam')).toHaveLength(1);
  });

  it('cleans up a dead lobby after the grace period', () => {
    const disposed: string[] = [];
    const ephemeral = new GameRoom('discord:g:c:dead', {
      graceMs: 40,
      aiDelayMs: 0,
      onDispose: (id) => disposed.push(id)
    });
    ephemeral.addAuthenticatedPlayer(session(store, 'Alex', 'user-alex'), mockSocket());
    ephemeral.handleDisconnect('user-alex');
    vi.advanceTimersByTime(40);
    expect(ephemeral.state.players).toHaveLength(0);
    vi.advanceTimersByTime(40);
    expect(disposed).toContain('discord:g:c:dead');
  });
});

describe('action authorization and redaction', () => {
  const store = new SessionStore();

  it('rejects out-of-turn actions and moves for someone else\'s hand', () => {
    const room = new GameRoom('discord:g:c:play', { graceMs: 50, aiDelayMs: 10_000 });
    const alex = session(store, 'Alex', 'user-alex');
    const sam = session(store, 'Sam', 'user-sam');
    room.addAuthenticatedPlayer(alex, mockSocket());
    room.addAuthenticatedPlayer(sam, mockSocket());
    expect(room.startGame('user-alex').ok).toBe(true);

    const starter = room.state.players[room.state.currentTurn];
    const waiter = room.state.players.find((p) => p.seat !== starter.seat)!;
    const lead = room.state.requiredLeadTile!;

    const outOfTurn = room.playTile(waiter.id, lead, 'right');
    expect(outOfTurn.ok).toBe(false);
    expect(outOfTurn.code).toBe('OUT_OF_TURN');
    expect(room.state.chain).toHaveLength(0);

    const stolen = room.playTile(starter.id, waiter.hand[0], 'right');
    expect(stolen.ok).toBe(false);
    expect(room.state.chain).toHaveLength(0);

    const legal = room.playTile(starter.id, lead, 'right');
    expect(legal.ok).toBe(true);
    expect(room.state.chain).toHaveLength(1);
    room.dispose();
  });

  it('redacts opponent hands and the boneyard for each viewer', () => {
    const room = new GameRoom('discord:g:c:hide', { graceMs: 50, aiDelayMs: 10_000 });
    const alex = session(store, 'Alex', 'user-alex');
    const sam = session(store, 'Sam', 'user-sam');
    room.addAuthenticatedPlayer(alex, mockSocket());
    room.addAuthenticatedPlayer(sam, mockSocket());
    room.startGame('user-alex');

    const alexView = redactGameState(room.state, 0);
    const samView = redactGameState(room.state, 1);

    expect(handsLeakInState(alexView, 0)).toBe(false);
    expect(handsLeakInState(samView, 1)).toBe(false);
    expect(alexView.players[0].hand.length).toBe(7);
    expect(alexView.players[1].hand).toEqual([]);
    expect(alexView.players[1].handCount).toBe(7);
    expect(alexView.boneyard).toEqual([]);
    expect(alexView.boneyardCount).toBe(14);
    expect(samView.players[1].hand.length).toBe(7);
    expect(samView.players[0].hand).toEqual([]);
    expect(JSON.stringify(alexView.players[1].hand)).not.toContain(JSON.stringify(room.state.players[1].hand[0]));
    room.dispose();
  });

  it('rejects host actions from a non-host', () => {
    const room = new GameRoom('discord:g:c:host', { graceMs: 50, aiDelayMs: 0 });
    room.addAuthenticatedPlayer(session(store, 'Alex', 'user-alex'), mockSocket());
    room.addAuthenticatedPlayer(session(store, 'Sam', 'user-sam'), mockSocket());
    expect(room.addAI('user-sam', 'easy').ok).toBe(false);
    expect(room.startGame('user-sam').ok).toBe(false);
    expect(room.state.status).toBe('lobby');
    room.dispose();
  });
});

describe('host-controlled AI difficulty', () => {
  const store = new SessionStore();

  it('lets the host pick and later change a seated bot difficulty', () => {
    const room = new GameRoom('discord:g:c:ai-diff', { graceMs: 50, aiDelayMs: 10_000 });
    room.addAuthenticatedPlayer(session(store, 'Alex', 'user-alex'), mockSocket());
    expect(room.addAI('user-alex', 'hard').ok).toBe(true);
    const bot = room.state.players.find((p) => p.isAI);
    expect(bot?.aiDifficulty).toBe('hard');

    expect(room.setAIDifficulty('user-alex', bot!.seat, 'easy').ok).toBe(true);
    expect(room.state.players.find((p) => p.isAI)?.aiDifficulty).toBe('easy');

    const guest = room.setAIDifficulty('user-nobody', bot!.seat, 'normal');
    expect(guest.ok).toBe(false);

    expect(room.startGame('user-alex').ok).toBe(true);
    expect(room.state.players.find((p) => p.isAI)?.aiDifficulty).toBe('easy');
    expect(room.setAIDifficulty('user-alex', bot!.seat, 'hard').ok).toBe(false);
    expect(room.state.players.find((p) => p.isAI)?.aiDifficulty).toBe('easy');
    room.dispose();
  });

  it('rejects invalid difficulty and non-host changes', () => {
    const room = new GameRoom('discord:g:c:ai-diff-auth', { graceMs: 50, aiDelayMs: 0 });
    room.addAuthenticatedPlayer(session(store, 'Alex', 'user-alex'), mockSocket());
    room.addAuthenticatedPlayer(session(store, 'Sam', 'user-sam'), mockSocket());
    expect(room.addAI('user-alex', 'legendary').ok).toBe(false);
    expect(room.state.players.some((p) => p.isAI)).toBe(false);

    expect(room.addAI('user-alex').ok).toBe(true);
    const seat = room.state.players.find((p) => p.isAI)!.seat;
    expect(room.state.players.find((p) => p.isAI)?.aiDifficulty).toBe('easy');
    expect(room.setAIDifficulty('user-sam', seat, 'hard').ok).toBe(false);
    expect(room.setAIDifficulty('user-alex', 0, 'hard').ok).toBe(false);
    expect(room.handleClientMessage('user-alex', {
      type: 'SET_AI_DIFFICULTY',
      seat,
      difficulty: 'normal'
    }).ok).toBe(true);
    expect(room.state.players.find((p) => p.isAI)?.aiDifficulty).toBe('normal');
    room.dispose();
  });
});

describe('host-controlled table selection', () => {
  const store = new SessionStore();

  it('defaults to the classic table and lets the host change it in the lobby', () => {
    const room = new GameRoom('discord:g:c:table', { graceMs: 50, aiDelayMs: 10_000 });
    room.addAuthenticatedPlayer(session(store, 'Alex', 'user-alex'), mockSocket());
    room.addAuthenticatedPlayer(session(store, 'Sam', 'user-sam'), mockSocket());
    expect(room.state.tableId).toBe('classic');

    expect(room.setTable('user-sam', 'dominican').ok).toBe(false);
    expect(room.state.tableId).toBe('classic');

    expect(room.setTable('user-alex', 'not-a-map').ok).toBe(false);
    expect(room.state.tableId).toBe('classic');

    expect(room.setTable('user-alex', 'dominican').ok).toBe(true);
    expect(room.state.tableId).toBe('dominican');
    expect(room.state.lastAction).toMatch(/República Dominicana/);

    expect(room.addAI('user-alex', 'easy').ok).toBe(true);
    expect(room.startGame('user-alex').ok).toBe(true);
    expect(room.state.tableId).toBe('dominican');
    expect(room.setTable('user-alex', 'classic').ok).toBe(false);
    expect(room.state.tableId).toBe('dominican');

    expect(room.resetMatch('user-alex').ok).toBe(true);
    expect(room.state.tableId).toBe('dominican');
    room.dispose();
  });

  it('accepts SET_TABLE over the client message bus', () => {
    const room = new GameRoom('discord:g:c:table-msg', { graceMs: 50, aiDelayMs: 0 });
    room.addAuthenticatedPlayer(session(store, 'Alex', 'user-alex'), mockSocket());
    expect(room.handleClientMessage('user-alex', { type: 'SET_TABLE', tableId: 'dominican' }).ok).toBe(true);
    expect(room.state.tableId).toBe('dominican');
    room.dispose();
  });
});
