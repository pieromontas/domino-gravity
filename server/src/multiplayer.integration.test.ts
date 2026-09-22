import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { createGameServer, GameServer } from './server.js';

interface Packet {
  type: string;
  state?: {
    status: string;
    currentTurn: number;
    chain: unknown[];
    players: Array<{ id: string; name: string; hand: unknown[]; handCount?: number; isHost?: boolean }>;
    lastAction: string;
    requiredLeadTile?: [number, number] | null;
    boneyard?: unknown[];
    boneyardCount?: number;
  };
  yourSeat?: number;
  code?: string;
  message?: string;
}

async function connectClient(port: number, sessionToken: string, room: string) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?session=${sessionToken}&room=${encodeURIComponent(room)}`);
  const inbox: Packet[] = [];
  const waiters: Array<(p: Packet) => void> = [];

  ws.on('message', (raw) => {
    const packet = JSON.parse(raw.toString()) as Packet;
    inbox.push(packet);
    const waiter = waiters.shift();
    if (waiter) waiter(packet);
  });

  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });

  const next = () => new Promise<Packet>((resolve) => {
    const queued = inbox.shift();
    if (queued) resolve(queued);
    else waiters.push(resolve);
  });

  const waitFor = async (type: string, predicate?: (p: Packet) => boolean) => {
    const match = (p: Packet) => p.type === type && (!predicate || predicate(p));
    const existing = inbox.findIndex(match);
    if (existing >= 0) return inbox.splice(existing, 1)[0];
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline) {
      const remaining = deadline - Date.now();
      const packet = await Promise.race([
        next(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`timeout waiting for ${type}`)), remaining))
      ]);
      if (match(packet)) return packet;
    }
    throw new Error(`timeout waiting for ${type}`);
  };

  return { ws, inbox, waitFor, send: (msg: unknown) => ws.send(JSON.stringify(msg)) };
}

describe('two clients share a room while a third room stays isolated', () => {
  let server: GameServer | undefined;

  afterEach(async () => {
    if (server) await server.close();
    server = undefined;
  });

  it('synchronizes turns and chain for two sockets and isolates another room', async () => {
    server = createGameServer({ graceMs: 200, aiDelayMs: 10_000, allowDevSessions: true });
    const port = await server.listen(0);

    const alex = server.sessions.createDevSession({ displayName: 'Alex', userId: 'alex' });
    const sam = server.sessions.createDevSession({ displayName: 'Sam', userId: 'sam' });
    const rio = server.sessions.createDevSession({ displayName: 'Rio', userId: 'rio' });

    const roomA = 'browser:table-alpha';
    const roomB = 'browser:table-beta';

    const clientA = await connectClient(port, alex.token, roomA);
    const clientB = await connectClient(port, sam.token, roomA);
    const clientC = await connectClient(port, rio.token, roomB);

    const syncA = await clientA.waitFor('SYNC_STATE', (p) => (p.state?.players.length ?? 0) >= 2);
    const syncB = await clientB.waitFor('SYNC_STATE', (p) => (p.state?.players.length ?? 0) >= 2);
    const syncC = await clientC.waitFor('SYNC_STATE', (p) => (p.state?.players.length ?? 0) >= 1);

    expect(syncA.state?.players.map((p) => p.name).sort()).toEqual(['Alex', 'Sam']);
    expect(syncB.state?.players.map((p) => p.name).sort()).toEqual(['Alex', 'Sam']);
    expect(syncC.state?.players.map((p) => p.name)).toEqual(['Rio']);
    expect(syncA.state?.players.find((p) => p.name === 'Alex')?.isHost).toBe(true);
    expect(syncC.state?.players[0].isHost).toBe(true);

    clientA.send({ type: 'START_GAME' });
    const playA = await clientA.waitFor('SYNC_STATE', (p) => p.state?.status === 'playing');
    const playB = await clientB.waitFor('SYNC_STATE', (p) => p.state?.status === 'playing');
    expect(playA.state?.status).toBe('playing');
    expect(playB.state?.status).toBe('playing');
    expect(playA.state?.chain).toEqual([]);
    expect(playB.state?.chain).toEqual([]);
    expect(playA.state?.currentTurn).toBe(playB.state?.currentTurn);

    expect(server.rooms.get(roomB)?.state.status).toBe('lobby');
    expect(server.rooms.get(roomB)?.state.chain).toEqual([]);

    const starterSeat = playA.state!.currentTurn;
    const starter = starterSeat === playA.yourSeat ? clientA : clientB;
    const starterView = starterSeat === playA.yourSeat ? playA : playB;
    const otherView = starterSeat === playA.yourSeat ? playB : playA;
    expect(otherView.state!.players[starterSeat].hand).toEqual([]);
    expect(starterView.state!.players[starterSeat].hand.length).toBe(7);
    expect(starterView.state!.boneyard).toEqual([]);

    const lead = starterView.state!.requiredLeadTile!;
    starter.send({ type: 'PLAY_TILE', tile: lead, side: 'right' });
    const afterA = await clientA.waitFor('SYNC_STATE', (p) => (p.state?.chain.length ?? 0) === 1);
    const afterB = await clientB.waitFor('SYNC_STATE', (p) => (p.state?.chain.length ?? 0) === 1);
    expect(afterA.state?.chain).toHaveLength(1);
    expect(afterB.state?.chain).toHaveLength(1);
    expect(afterA.state?.currentTurn).toBe(afterB.state?.currentTurn);
    expect(afterA.state?.currentTurn).not.toBe(starterSeat);
    expect(server.rooms.get(roomB)?.state.chain).toEqual([]);

    clientC.ws.close();
    clientB.ws.close();
    clientA.ws.close();
  });

  it('rejects unauthenticated sockets and the default-room fallback', async () => {
    server = createGameServer({ allowDevSessions: true, graceMs: 100, aiDelayMs: 0 });
    const port = await server.listen(0);

    const noSession = new WebSocket(`ws://127.0.0.1:${port}/ws?room=browser:x`);
    const noSessionClosed = await new Promise<number>((resolve) => {
      noSession.on('close', (code) => resolve(code));
      noSession.on('error', () => resolve(-1));
    });
    expect(noSessionClosed).toBe(4001);

    const session = server.sessions.createDevSession({ displayName: 'You' });
    const defaultRoom = new WebSocket(`ws://127.0.0.1:${port}/ws?session=${session.token}&room=default-room`);
    const defaultClosed = await new Promise<number>((resolve) => {
      defaultRoom.on('close', (code) => resolve(code));
      defaultRoom.on('error', () => resolve(-1));
    });
    expect(defaultClosed).toBe(4002);
  });
});
