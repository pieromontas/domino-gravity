import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import http from 'http';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import { createDevSessionHandler, createTokenHandler } from './discordAuth.js';
import { GameRoom } from './room.js';
import { assertExplicitRoomId } from './roomKey.js';
import { SessionStore } from './session.js';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface ServerOptions {
  graceMs?: number;
  aiDelayMs?: number;
  allowDevSessions?: boolean;
}

export interface GameServer {
  app: express.Express;
  httpServer: http.Server;
  wss: WebSocketServer;
  rooms: Map<string, GameRoom>;
  sessions: SessionStore;
  listen(port?: number | string): Promise<number>;
  close(): Promise<void>;
}

export function createGameServer(options: ServerOptions = {}): GameServer {
  const sessions = new SessionStore();
  const rooms = new Map<string, GameRoom>();
  const graceMs = options.graceMs ?? Number(process.env.ROOM_GRACE_MS || 60_000);
  const aiDelayMs = options.aiDelayMs ?? Number(process.env.AI_DELAY_MS || 800);
  const allowDevSessions = options.allowDevSessions
    ?? (process.env.NODE_ENV !== 'production' || process.env.ALLOW_DEV_SESSIONS === '1');

  const app = express();
  app.use(cors());
  app.use(express.json());

  app.post('/api/token', createTokenHandler(sessions));
  app.post('/api/dev-session', createDevSessionHandler(sessions, () => allowDevSessions));

  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      time: new Date().toISOString(),
      rooms: rooms.size
    });
  });

  const clientDist = path.resolve(__dirname, '../../client/dist');
  app.use(express.static(clientDist));
  app.get('*', (_req, res, next) => {
    if (_req.path.startsWith('/api') || _req.path.startsWith('/ws')) {
      return next();
    }
    res.sendFile(path.join(clientDist, 'index.html'), (err) => {
      if (err) next();
    });
  });

  const httpServer = http.createServer(app);
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', (ws: WebSocket, req) => {
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const sessionToken = url.searchParams.get('session');
    const session = sessions.get(sessionToken);

    if (!session) {
      ws.send(JSON.stringify({ type: 'ERROR', code: 'AUTH', message: 'Valid session required.' }));
      ws.close(4001, 'unauthorized');
      return;
    }

    let roomId: string;
    try {
      roomId = assertExplicitRoomId(url.searchParams.get('room'));
    } catch {
      ws.send(JSON.stringify({
        type: 'ERROR',
        code: 'ROOM',
        message: 'An explicit room id is required. default-room is not allowed.'
      }));
      ws.close(4002, 'room required');
      return;
    }

    if (session.source === 'discord' && !roomId.startsWith('discord:')) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        code: 'ROOM',
        message: 'Discord sessions must join a discord: room key.'
      }));
      ws.close(4002, 'discord room required');
      return;
    }

    let room = rooms.get(roomId);
    if (!room) {
      room = new GameRoom(roomId, {
        graceMs,
        aiDelayMs,
        onDispose: (id) => rooms.delete(id)
      });
      rooms.set(roomId, room);
    }

    const seat = room.addAuthenticatedPlayer(session, ws);
    ws.send(JSON.stringify({
      type: 'JOIN_CONFIRM',
      yourSeat: seat,
      roomId,
      userId: session.userId
    }));
    const view = room.viewFor(session.userId);
    ws.send(JSON.stringify({ type: 'SYNC_STATE', ...view }));

    ws.on('message', (rawData) => {
      try {
        const data = JSON.parse(rawData.toString()) as Record<string, unknown>;
        const result = room!.handleClientMessage(session.userId, data);
        if (!result.ok) {
          ws.send(JSON.stringify({
            type: 'ERROR',
            code: result.code,
            message: result.message
          }));
          const latest = room!.viewFor(session.userId);
          ws.send(JSON.stringify({ type: 'SYNC_STATE', ...latest }));
        }
      } catch (err) {
        console.error('Invalid message payload:', err);
      }
    });

    ws.on('close', () => {
      room?.handleDisconnect(session.userId);
    });
  });

  return {
    app,
    httpServer,
    wss,
    rooms,
    sessions,
    listen(port?: number | string) {
      const bind = Number(port ?? process.env.PORT ?? 3001);
      return new Promise((resolve) => {
        httpServer.listen(bind, () => {
          const address = httpServer.address();
          const actual = typeof address === 'object' && address ? address.port : bind;
          console.log(`[Domino Gravity Server] Running on http://localhost:${actual}`);
          console.log('[Domino Gravity Server] WebSocket listening on /ws');
          resolve(actual);
        });
      });
    },
    close() {
      return new Promise((resolve, reject) => {
        for (const room of rooms.values()) room.dispose();
        rooms.clear();
        wss.close();
        httpServer.close((err) => (err ? reject(err) : resolve()));
      });
    }
  };
}

function isExecutedDirectly(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(path.resolve(entry)).href;
  } catch {
    return false;
  }
}

if (isExecutedDirectly()) {
  const server = createGameServer();
  server.listen();
}
