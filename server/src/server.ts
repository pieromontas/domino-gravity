import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import { handleDiscordTokenExchange } from './discordAuth.js';
import { GameRoom } from './room.js';

dotenv.config({ path: path.resolve(process.cwd(), '../.env') });
dotenv.config(); // fallback

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Discord OAuth token exchange endpoint
app.post('/api/token', handleDiscordTokenExchange);

// Health check endpoint
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Serve client static files if client/dist exists
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

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const rooms = new Map<string, GameRoom>();

wss.on('connection', (ws: WebSocket, req) => {
  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const roomId = url.searchParams.get('room') || 'default-room';
  const userId = url.searchParams.get('user') || `anon-${Math.random().toString(36).slice(2, 7)}`;
  const userName = url.searchParams.get('name') || 'Guest';
  const avatar = url.searchParams.get('avatar') || 'https://cdn.discordapp.com/embed/avatars/0.png';

  let room = rooms.get(roomId);
  if (!room) {
    room = new GameRoom(roomId);
    rooms.set(roomId, room);
  }

  const seat = room.addPlayer(userId, userName, avatar, ws);

  ws.send(JSON.stringify({
    type: 'JOIN_CONFIRM',
    yourSeat: seat,
    roomId
  }));

  ws.on('message', (rawData) => {
    try {
      const data = JSON.parse(rawData.toString());
      // Broadcast state update or action to room peers
      room?.broadcast(data, ws);
    } catch (err) {
      console.error('Invalid message payload:', err);
    }
  });

  ws.on('close', () => {
    room?.handleDisconnect(userId);
  });
});

server.listen(port, () => {
  console.log(`[Domino Gravity Server] Running on http://localhost:${port}`);
  console.log(`[Domino Gravity Server] WebSocket listening on /ws`);
});
