import { WebSocket } from 'ws';
import { DominoAI } from './engine/ai.js';
import { DominoEngine } from './engine/dominoEngine.js';
import { AIDifficulty, EndSide, GameState, Player, Tile } from './engine/types.js';
import { redactGameState } from './redact.js';
import { PlayerSession } from './session.js';

export interface ActivityParticipant {
  id: string;
  name: string;
  avatar: string;
}

export interface RoomOptions {
  graceMs?: number;
  aiDelayMs?: number;
  onDispose?: (roomId: string) => void;
}

export type ActionResult =
  | { ok: true }
  | { ok: false; code: string; message: string };

const AI_NAMES = ['Maya', 'Felix', 'Zara', 'Atlas', 'Nova', 'Leo'];

export function createEmptyLobbyState(): GameState {
  return {
    status: 'lobby',
    players: [],
    boneyard: [],
    boneyardCount: 0,
    chain: [],
    openEnds: { left: null, right: null },
    currentTurn: 0,
    firstTurnOfRound: true,
    consecutivePasses: 0,
    roundNumber: 1,
    targetScore: 100,
    lastAction: 'Waiting for players…',
    winnerSeat: null,
    seed: Date.now()
  };
}

export class GameRoom {
  public readonly id: string;
  public state: GameState;
  public readonly graceMs: number;
  public readonly aiDelayMs: number;

  private readonly engine = new DominoEngine();
  private readonly ai: DominoAI;
  private readonly sockets = new Map<string, WebSocket>();
  private readonly disconnectTimers = new Map<string, NodeJS.Timeout>();
  private emptyTimer?: NodeJS.Timeout;
  private aiTurnTimer?: NodeJS.Timeout;
  private readonly onDispose?: (roomId: string) => void;
  private disposed = false;

  constructor(id: string, options: RoomOptions = {}) {
    this.id = id;
    this.graceMs = options.graceMs ?? 60_000;
    this.aiDelayMs = options.aiDelayMs ?? 800;
    this.onDispose = options.onDispose;
    this.ai = new DominoAI(this.engine);
    this.state = createEmptyLobbyState();
  }

  public addAuthenticatedPlayer(session: PlayerSession, ws: WebSocket): number {
    this.clearEmptyTimer();
    this.sockets.set(session.userId, ws);

    const existing = this.state.players.find((p) => p.id === session.userId && !p.isAI);
    if (existing) {
      this.clearDisconnectTimer(session.userId);
      existing.connected = true;
      existing.pendingJoin = false;
      existing.name = session.globalName;
      existing.avatar = session.avatarUrl;
      if (!this.hostId()) {
        this.assignHost(existing.id);
      }
      this.state.lastAction = `${existing.name} reconnected.`;
      this.broadcastState();
      return existing.seat;
    }

    if (this.state.status !== 'lobby') {
      return -1;
    }

    if (this.state.players.length >= 4) {
      this.broadcastState();
      return -1;
    }

    const pending = this.state.players.find((p) => p.id === session.userId && p.pendingJoin);
    if (pending) {
      pending.connected = true;
      pending.pendingJoin = false;
      pending.name = session.globalName;
      pending.avatar = session.avatarUrl;
      pending.isAI = false;
      if (!this.hostId()) this.assignHost(pending.id);
      this.state.lastAction = `${pending.name} joined the table.`;
      this.broadcastState();
      return pending.seat;
    }

    const seat = this.state.players.length;
    const isFirstHuman = !this.state.players.some((p) => !p.isAI && !p.pendingJoin);
    const player: Player = {
      id: session.userId,
      name: session.globalName,
      avatar: session.avatarUrl,
      isAI: false,
      hand: [],
      handCount: 0,
      score: 0,
      seat,
      isHost: isFirstHuman,
      connected: true,
      pendingJoin: false
    };
    this.state.players.push(player);
    if (isFirstHuman) {
      this.state.lastAction = `${player.name} opened the table and is host.`;
    } else {
      this.state.lastAction = `${player.name} joined seat ${seat + 1}.`;
    }
    this.broadcastState();
    return seat;
  }

  public handleDisconnect(userId: string) {
    const player = this.state.players.find((p) => p.id === userId && !p.isAI);
    this.sockets.delete(userId);
    if (!player) {
      this.maybeDisposeIfEmpty();
      return;
    }

    player.connected = false;
    const wasHost = !!player.isHost;

    if (this.state.status === 'lobby' && wasHost) {
      this.migrateHost();
    }

    this.clearDisconnectTimer(userId);
    const timer = setTimeout(() => {
      this.disconnectTimers.delete(userId);
      this.expireGrace(userId);
    }, this.graceMs);
    this.disconnectTimers.set(userId, timer);

    this.state.lastAction = `${player.name} disconnected. Holding seat…`;
    this.broadcastState();
    this.maybeDisposeIfEmpty();
  }

  public applyParticipants(participants: ActivityParticipant[]): ActionResult {
    const seen = new Set(participants.map((p) => p.id));

    if (this.state.status === 'lobby') {
      for (const participant of participants) {
        if (this.state.players.some((p) => p.id === participant.id)) continue;
        if (this.state.players.length >= 4) break;
        this.state.players.push({
          id: participant.id,
          name: participant.name,
          avatar: participant.avatar,
          isAI: false,
          hand: [],
          handCount: 0,
          score: 0,
          seat: this.state.players.length,
          isHost: false,
          connected: false,
          pendingJoin: true
        });
      }

      const kept: Player[] = [];
      for (const player of this.state.players) {
        if (player.isAI) {
          kept.push(player);
          continue;
        }
        if (player.pendingJoin && !seen.has(player.id)) {
          continue;
        }
        kept.push(player);
      }
      if (kept.length !== this.state.players.length) {
        this.state.players = kept;
        this.reindexSeats();
        if (!this.hostId()) {
          const nextHuman = this.connectedHumans()[0];
          if (nextHuman) this.assignHost(nextHuman.id);
        }
      }
    }

    this.dedupePlayers();
    this.broadcastState();
    return { ok: true };
  }

  public addAI(actorUserId: string, difficulty: AIDifficulty = 'easy'): ActionResult {
    const auth = this.requireHost(actorUserId);
    if (!auth.ok) return auth;
    if (this.state.status !== 'lobby') {
      return { ok: false, code: 'NOT_LOBBY', message: 'Can only add AI in the lobby.' };
    }
    if (this.state.players.length >= 4) {
      return { ok: false, code: 'TABLE_FULL', message: 'All four seats are taken.' };
    }
    if (this.state.players.some((p) => p.pendingJoin)) {
      return {
        ok: false,
        code: 'HUMAN_PENDING',
        message: 'A Discord participant is still joining. AI cannot take their seat.'
      };
    }

    const used = new Set(this.state.players.map((p) => p.name.split(' ')[0]));
    const nextName = AI_NAMES.find((n) => !used.has(n)) || `Bot ${this.state.players.length + 1}`;
    const seat = this.state.players.length;
    this.state.players.push({
      id: `ai-${Date.now()}-${seat}`,
      name: `${nextName} (AI)`,
      avatar: `https://cdn.discordapp.com/embed/avatars/${seat % 5}.png`,
      isAI: true,
      aiDifficulty: difficulty,
      hand: [],
      handCount: 0,
      score: 0,
      seat,
      connected: true,
      pendingJoin: false
    });
    this.state.lastAction = `Host added ${nextName} (${difficulty.toUpperCase()} AI).`;
    this.broadcastState();
    return { ok: true };
  }

  public removeSeat(actorUserId: string, seat: number): ActionResult {
    const auth = this.requireHost(actorUserId);
    if (!auth.ok) return auth;
    if (this.state.status !== 'lobby') {
      return { ok: false, code: 'NOT_LOBBY', message: 'Can only change seats in the lobby.' };
    }
    const player = this.state.players.find((p) => p.seat === seat);
    if (!player) return { ok: false, code: 'NO_SEAT', message: 'Seat is empty.' };
    if (!player.isAI) {
      return { ok: false, code: 'HUMAN_SEAT', message: 'Cannot remove a human participant.' };
    }
    this.state.players = this.state.players.filter((p) => p.seat !== seat);
    this.reindexSeats();
    this.state.lastAction = `Removed ${player.name}.`;
    this.broadcastState();
    return { ok: true };
  }

  public setTargetScore(actorUserId: string, score: number): ActionResult {
    const auth = this.requireHost(actorUserId);
    if (!auth.ok) return auth;
    if (this.state.status !== 'lobby') {
      return { ok: false, code: 'NOT_LOBBY', message: 'Score can only be changed in the lobby.' };
    }
    if (![50, 100, 150].includes(score)) {
      return { ok: false, code: 'BAD_SCORE', message: 'Target score must be 50, 100, or 150.' };
    }
    this.state.targetScore = score;
    this.state.lastAction = `Target score set to ${score} points.`;
    this.broadcastState();
    return { ok: true };
  }

  public startGame(actorUserId: string): ActionResult {
    const auth = this.requireHost(actorUserId);
    if (!auth.ok) return auth;
    if (this.state.status !== 'lobby') {
      return { ok: false, code: 'NOT_LOBBY', message: 'Match already in progress.' };
    }
    if (this.readyPlayerCount() < 2) {
      return { ok: false, code: 'NEED_PLAYERS', message: 'Need at least two ready players to start.' };
    }
    if (this.state.players.some((p) => p.pendingJoin)) {
      return { ok: false, code: 'HUMAN_PENDING', message: 'Wait for joining Discord players before starting.' };
    }
    this.state.roundNumber = 1;
    this.state.players.forEach((p) => { p.score = 0; });
    this.engine.startRound(this.state, Date.now());
    this.state.lastAction = this.state.lastAction || 'Match started.';
    this.broadcastState();
    this.scheduleAiTurn();
    return { ok: true };
  }

  public playTile(actorUserId: string, tile: Tile, side: EndSide): ActionResult {
    const actor = this.requireActorTurn(actorUserId);
    if (!actor.ok) return actor;
    const success = this.engine.playTile(this.state, actor.seat, tile, side);
    if (!success) {
      return { ok: false, code: 'ILLEGAL', message: this.state.lastAction };
    }
    this.broadcastState();
    this.scheduleAiTurn();
    return { ok: true };
  }

  public drawTile(actorUserId: string): ActionResult {
    const actor = this.requireActorTurn(actorUserId);
    if (!actor.ok) return actor;
    const drawn = this.engine.drawTile(this.state, actor.seat);
    if (!drawn) {
      return { ok: false, code: 'ILLEGAL', message: this.state.lastAction };
    }
    this.broadcastState();
    this.scheduleAiTurn();
    return { ok: true };
  }

  public passTurn(actorUserId: string): ActionResult {
    const actor = this.requireActorTurn(actorUserId);
    if (!actor.ok) return actor;
    const success = this.engine.passTurn(this.state, actor.seat);
    if (!success) {
      return { ok: false, code: 'ILLEGAL', message: this.state.lastAction };
    }
    this.broadcastState();
    this.scheduleAiTurn();
    return { ok: true };
  }

  public startNextRound(actorUserId: string): ActionResult {
    const auth = this.requireHost(actorUserId);
    if (!auth.ok) return auth;
    if (this.state.status !== 'round_end') {
      return { ok: false, code: 'NOT_ROUND_END', message: 'No round to continue.' };
    }
    this.state.roundNumber++;
    this.engine.startRound(this.state, Date.now());
    this.broadcastState();
    this.scheduleAiTurn();
    return { ok: true };
  }

  public resetMatch(actorUserId: string): ActionResult {
    const auth = this.requireHost(actorUserId);
    if (!auth.ok) return auth;
    this.clearAiTimer();
    this.state.status = 'lobby';
    this.state.chain = [];
    this.state.boneyard = [];
    this.state.boneyardCount = 0;
    this.state.openEnds = { left: null, right: null };
    this.state.requiredLeadTile = null;
    this.state.roundSummary = undefined;
    this.state.winnerSeat = null;
    this.state.players.forEach((p) => {
      p.hand = [];
      p.handCount = 0;
      p.score = 0;
    });
    this.state.lastAction = 'Returned to lobby.';
    this.broadcastState();
    return { ok: true };
  }

  public handleClientMessage(userId: string, data: Record<string, unknown>): ActionResult {
    const type = data.type;
    switch (type) {
      case 'ADD_AI':
        return this.addAI(userId, (data.difficulty as AIDifficulty) || 'easy');
      case 'REMOVE_SEAT':
        return this.removeSeat(userId, Number(data.seat));
      case 'SET_TARGET_SCORE':
        return this.setTargetScore(userId, Number(data.score));
      case 'START_GAME':
        return this.startGame(userId);
      case 'PLAY_TILE':
        return this.playTile(userId, data.tile as Tile, data.side as EndSide);
      case 'DRAW_TILE':
        return this.drawTile(userId);
      case 'PASS_TURN':
        return this.passTurn(userId);
      case 'NEXT_ROUND':
        return this.startNextRound(userId);
      case 'RESET_MATCH':
        return this.resetMatch(userId);
      case 'ACTIVITY_PARTICIPANTS': {
        const raw = Array.isArray(data.participants) ? data.participants : [];
        const participants: ActivityParticipant[] = raw
          .map((p) => {
            const row = p as ActivityParticipant;
            if (!row?.id) return null;
            return {
              id: String(row.id),
              name: String(row.name || 'Discord Player'),
              avatar: String(row.avatar || 'https://cdn.discordapp.com/embed/avatars/0.png')
            };
          })
          .filter((p): p is ActivityParticipant => !!p)
          .slice(0, 8);
        return this.applyParticipants(participants);
      }
      default:
        return { ok: false, code: 'UNKNOWN', message: 'Unknown action.' };
    }
  }

  public viewFor(userId: string): { state: GameState; yourSeat: number } {
    const player = this.state.players.find((p) => p.id === userId && !p.isAI);
    const seat = player?.seat ?? -1;
    return { state: redactGameState(this.state, seat), yourSeat: seat };
  }

  public sendTo(userId: string, message: unknown) {
    const ws = this.sockets.get(userId);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  public broadcastState() {
    for (const [userId] of this.sockets) {
      const view = this.viewFor(userId);
      this.sendTo(userId, { type: 'SYNC_STATE', ...view });
    }
  }

  public connectedHumanCount(): number {
    return this.connectedHumans().length;
  }

  public dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.clearAiTimer();
    this.clearEmptyTimer();
    for (const timer of this.disconnectTimers.values()) clearTimeout(timer);
    this.disconnectTimers.clear();
    for (const ws of this.sockets.values()) {
      try { ws.close(); } catch { /* ignore */ }
    }
    this.sockets.clear();
    this.onDispose?.(this.id);
  }

  private expireGrace(userId: string) {
    const player = this.state.players.find((p) => p.id === userId && !p.isAI);
    if (!player || player.connected) return;

    if (this.state.status === 'lobby') {
      this.state.players = this.state.players.filter((p) => p.id !== userId);
      this.reindexSeats();
      if (player.isHost || !this.hostId()) this.migrateHost();
      this.state.lastAction = `${player.name} left the lobby.`;
      this.broadcastState();
      this.maybeDisposeIfEmpty();
      return;
    }

    // In a match, keep the seat and let the engine continue via AI so the
    // remaining humans are not stuck. This is not a silent lobby substitution.
    player.isAI = true;
    player.aiDifficulty = player.aiDifficulty || 'normal';
    if (!player.name.includes('(AI)')) player.name = `${player.name} (AI)`;
    player.pendingJoin = false;
    if (player.isHost) this.migrateHost();
    this.state.lastAction = `${player.name} was converted after the reconnect window.`;
    this.broadcastState();
    this.scheduleAiTurn();
    this.maybeDisposeIfEmpty();
  }

  private migrateHost() {
    this.state.players.forEach((p) => { p.isHost = false; });
    const next = this.connectedHumans()[0];
    if (next) {
      next.isHost = true;
      this.state.lastAction = `${next.name} is now the host.`;
    }
  }

  private assignHost(userId: string) {
    this.state.players.forEach((p) => { p.isHost = p.id === userId && !p.isAI; });
  }

  private hostId(): string | undefined {
    return this.state.players.find((p) => p.isHost && !p.isAI)?.id;
  }

  private connectedHumans(): Player[] {
    return this.state.players
      .filter((p) => !p.isAI && p.connected && !p.pendingJoin)
      .sort((a, b) => a.seat - b.seat);
  }

  private readyPlayerCount(): number {
    return this.state.players.filter((p) => p.isAI || (p.connected && !p.pendingJoin)).length;
  }

  private requireHost(userId: string): ActionResult {
    const player = this.state.players.find((p) => p.id === userId && !p.isAI);
    if (!player) return { ok: false, code: 'NOT_SEATED', message: 'You are not seated at this table.' };
    if (!player.isHost) return { ok: false, code: 'NOT_HOST', message: 'Only the host can do that.' };
    return { ok: true };
  }

  private requireActorTurn(userId: string): ActionResult & { seat: number } {
    const player = this.state.players.find((p) => p.id === userId && !p.isAI);
    if (!player) {
      return { ok: false, code: 'NOT_SEATED', message: 'You are not seated at this table.', seat: -1 };
    }
    if (this.state.status !== 'playing') {
      return { ok: false, code: 'NOT_PLAYING', message: 'The match is not in play.', seat: player.seat };
    }
    if (this.state.currentTurn !== player.seat) {
      return { ok: false, code: 'OUT_OF_TURN', message: 'It is not your turn.', seat: player.seat };
    }
    return { ok: true, seat: player.seat };
  }

  private reindexSeats() {
    this.state.players.forEach((p, idx) => { p.seat = idx; });
  }

  private dedupePlayers() {
    const seen = new Set<string>();
    this.state.players = this.state.players.filter((p) => {
      if (seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    });
    this.reindexSeats();
  }

  private scheduleAiTurn() {
    this.clearAiTimer();
    if (this.state.status !== 'playing') return;
    const current = this.state.players[this.state.currentTurn];
    if (!current?.isAI) return;

    this.aiTurnTimer = setTimeout(() => {
      this.executeAiTurn(current.seat);
    }, this.aiDelayMs);
  }

  private executeAiTurn(aiSeat: number) {
    if (this.state.status !== 'playing' || this.state.currentTurn !== aiSeat) return;
    const current = this.state.players[aiSeat];
    if (!current?.isAI) return;

    const decision = this.ai.makeDecision(this.state, aiSeat);
    if (decision.action === 'play' && decision.move) {
      this.engine.playTile(this.state, aiSeat, decision.move.tile, decision.move.side);
    } else if (decision.action === 'draw') {
      const drawn = this.engine.drawTile(this.state, aiSeat);
      if (!drawn) this.engine.passTurn(this.state, aiSeat);
    } else {
      this.engine.passTurn(this.state, aiSeat);
    }
    this.broadcastState();
    this.scheduleAiTurn();
  }

  private maybeDisposeIfEmpty() {
    if (this.connectedHumanCount() > 0) return;
    this.clearEmptyTimer();
    this.emptyTimer = setTimeout(() => {
      if (this.connectedHumanCount() === 0) {
        this.dispose();
      }
    }, this.graceMs);
  }

  private clearDisconnectTimer(userId: string) {
    const timer = this.disconnectTimers.get(userId);
    if (timer) clearTimeout(timer);
    this.disconnectTimers.delete(userId);
  }

  private clearAiTimer() {
    if (this.aiTurnTimer) clearTimeout(this.aiTurnTimer);
    this.aiTurnTimer = undefined;
  }

  private clearEmptyTimer() {
    if (this.emptyTimer) clearTimeout(this.emptyTimer);
    this.emptyTimer = undefined;
  }
}
