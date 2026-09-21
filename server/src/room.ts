import { WebSocket } from 'ws';

export interface RoomPlayer {
  id: string;
  name: string;
  avatar: string;
  seat: number;
  isAI: boolean;
  aiDifficulty?: 'easy' | 'normal' | 'hard';
  ws?: WebSocket;
  connected: boolean;
  disconnectTimer?: NodeJS.Timeout;
}

export class GameRoom {
  public id: string;
  public players: RoomPlayer[] = [];
  public targetScore: number = 100;

  constructor(id: string) {
    this.id = id;
  }

  public addPlayer(id: string, name: string, avatar: string, ws: WebSocket): number {
    // Check if player is reconnecting
    const existing = this.players.find(p => p.id === id);
    if (existing) {
      if (existing.disconnectTimer) {
        clearTimeout(existing.disconnectTimer);
        existing.disconnectTimer = undefined;
      }
      existing.ws = ws;
      existing.connected = true;
      console.log(`[Room ${this.id}] Player ${name} reconnected to seat ${existing.seat}`);
      return existing.seat;
    }

    // Find next available seat
    const seat = this.players.length;
    if (seat >= 4) {
      // Spectator
      return -1;
    }

    this.players.push({
      id,
      name,
      avatar,
      seat,
      isAI: false,
      ws,
      connected: true
    });

    console.log(`[Room ${this.id}] Player ${name} joined seat ${seat}`);
    return seat;
  }

  public handleDisconnect(id: string) {
    const player = this.players.find(p => p.id === id);
    if (!player) return;

    player.connected = false;
    player.ws = undefined;
    console.log(`[Room ${this.id}] Player ${player.name} disconnected. Holding seat for 60s...`);

    // 60 second reconnect grace period
    player.disconnectTimer = setTimeout(() => {
      console.log(`[Room ${this.id}] Grace period expired for ${player.name}. Converting to AI.`);
      player.isAI = true;
      player.name = `${player.name} (AI)`;
      player.aiDifficulty = 'normal';
      this.broadcast({
        type: 'PLAYER_CONVERTED_AI',
        seat: player.seat,
        name: player.name
      });
    }, 60000);
  }

  public broadcast(message: unknown, excludeWs?: WebSocket) {
    const data = JSON.stringify(message);
    for (const p of this.players) {
      if (p.ws && p.ws !== excludeWs && p.ws.readyState === WebSocket.OPEN) {
        p.ws.send(data);
      }
    }
  }
}
