import { WebSocket } from 'ws';
import { DominoAI } from './engine/ai.js';
import { DominoEngine } from './engine/dominoEngine.js';
import { isAIDifficulty } from './engine/aiDifficulty.js';
import { DEFAULT_TABLE_ID, formatTableLabel, isTableId } from './engine/tableId.js';
import { AIDifficulty, EndSide, GameState, Player, Tile } from './engine/types.js';
import {
  emptyPartnershipFields,
  isTeamId,
  isValidLobbySeat,
  resetMatchScores,
  sameTileMultiset,
  seatPartnersOpposite,
  setPartnerPair,
  setPartnershipEnabled,
  setTeamName,
  swapSeatToOtherTeam,
  swapSeats,
  syncPartnershipRoster
} from './engine/partnership.js';
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
    tableId: DEFAULT_TABLE_ID,
    lastAction: 'Waiting for players…',
    winnerSeat: null,
    ...emptyPartnershipFields(),
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
    syncPartnershipRoster(this.state);
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
      syncPartnershipRoster(this.state);
    }

    this.dedupePlayers();
    this.broadcastState();
    return { ok: true };
  }

  public addAI(actorUserId: string, difficulty: unknown = 'easy'): ActionResult {
    const auth = this.requireHost(actorUserId);
    if (!auth.ok) return auth;
    const parsed = this.parseDifficulty(difficulty);
    if (!parsed.ok) return parsed;
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
      aiDifficulty: parsed.difficulty,
      hand: [],
      handCount: 0,
      score: 0,
      seat,
      connected: true,
      pendingJoin: false
    });
    syncPartnershipRoster(this.state);
    this.state.lastAction = `Host added ${nextName} (${parsed.difficulty.toUpperCase()} AI).`;
    this.broadcastState();
    return { ok: true };
  }

  public setAIDifficulty(actorUserId: string, seat: number, difficulty: unknown): ActionResult {
    const auth = this.requireHost(actorUserId);
    if (!auth.ok) return auth;
    const parsed = this.parseDifficulty(difficulty, { allowMissing: false });
    if (!parsed.ok) return parsed;
    if (this.state.status !== 'lobby') {
      return { ok: false, code: 'NOT_LOBBY', message: 'Difficulty can only be changed in the lobby.' };
    }
    const player = this.state.players.find((p) => p.seat === seat);
    if (!player) return { ok: false, code: 'NO_SEAT', message: 'Seat is empty.' };
    if (!player.isAI) {
      return { ok: false, code: 'HUMAN_SEAT', message: 'Cannot change difficulty for a human player.' };
    }
    player.aiDifficulty = parsed.difficulty;
    this.state.lastAction = `Host set ${player.name} to ${parsed.difficulty.toUpperCase()} AI.`;
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

  public setTable(actorUserId: string, tableId: unknown): ActionResult {
    const auth = this.requireHost(actorUserId);
    if (!auth.ok) return auth;
    if (this.state.status !== 'lobby') {
      return { ok: false, code: 'NOT_LOBBY', message: 'Table can only be changed in the lobby.' };
    }
    if (!isTableId(tableId)) {
      return { ok: false, code: 'BAD_TABLE', message: 'Table must be classic or dominican.' };
    }
    this.state.tableId = tableId;
    this.state.lastAction = `Table set to ${formatTableLabel(tableId)}.`;
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
    resetMatchScores(this.state);
    if (this.state.players.length === 4) {
      syncPartnershipRoster(this.state);
    }
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
    this.state.tableCall = null;
    this.state.lastPassSeat = null;
    this.state.roundSummary = undefined;
    resetMatchScores(this.state);
    this.state.lastAction = 'Returned to lobby.';
    this.broadcastState();
    return { ok: true };
  }

  public handleClientMessage(userId: string, data: Record<string, unknown>): ActionResult {
    const type = data.type;
    switch (type) {
      case 'ADD_AI':
        return this.addAI(userId, data.difficulty);
      case 'SET_AI_DIFFICULTY':
        return this.setAIDifficulty(userId, Number(data.seat), data.difficulty);
      case 'REMOVE_SEAT':
        return this.removeSeat(userId, Number(data.seat));
      case 'SET_TARGET_SCORE':
        return this.setTargetScore(userId, Number(data.score));
      case 'SET_TABLE':
        return this.setTable(userId, data.tableId);
      case 'SET_PARTNERSHIP':
        return this.setPartnership(userId, data.enabled);
      case 'SET_TEAM_NAME':
        return this.setTeamNameAction(userId, Number(data.teamId), data.name);
      case 'MOVE_SEAT_TEAM':
        return this.moveSeatToOtherTeam(userId, Number(data.seat));
      case 'SET_PARTNER_PAIR':
        return this.setPartnerPairAction(userId, data.seatA, data.seatB, data.teamId);
      case 'SWAP_SEATS':
        return this.swapSeatsAction(userId, data.seatA, data.seatB);
      case 'SEAT_PARTNERS_OPPOSITE':
        return this.seatPartnersOppositeAction(userId);
      case 'REORDER_HAND':
        return this.reorderHand(userId, data.hand);
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

  private parseDifficulty(
    value: unknown,
    options: { allowMissing?: boolean } = {}
  ): ActionResult & { difficulty: AIDifficulty } {
    const allowMissing = options.allowMissing !== false;
    if (value === undefined || value === null || value === '') {
      if (allowMissing) return { ok: true, difficulty: 'easy' };
      return { ok: false, code: 'BAD_DIFFICULTY', message: 'Difficulty must be easy, normal, or hard.', difficulty: 'easy' };
    }
    if (!isAIDifficulty(value)) {
      return { ok: false, code: 'BAD_DIFFICULTY', message: 'Difficulty must be easy, normal, or hard.', difficulty: 'easy' };
    }
    return { ok: true, difficulty: value };
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
    syncPartnershipRoster(this.state);
  }

  public setPartnership(actorUserId: string, enabled: unknown): ActionResult {
    const auth = this.requireHost(actorUserId);
    if (!auth.ok) return auth;
    if (this.state.status !== 'lobby') {
      return { ok: false, code: 'NOT_LOBBY', message: 'Teams can only be changed in the lobby.' };
    }
    if (this.state.players.length !== 4) {
      return { ok: false, code: 'NEED_FOUR', message: 'Partnership needs four seated players.' };
    }
    if (!setPartnershipEnabled(this.state, enabled === true)) {
      return { ok: false, code: 'BAD_TEAMS', message: 'Could not update partnership.' };
    }
    this.state.lastAction = this.state.partnership
      ? 'Partnership mode on — opposite seats are partners.'
      : 'Free-for-all scoring — each seat scores alone.';
    this.broadcastState();
    return { ok: true };
  }

  public setTeamNameAction(actorUserId: string, teamId: unknown, name: unknown): ActionResult {
    const auth = this.requireHost(actorUserId);
    if (!auth.ok) return auth;
    if (this.state.status !== 'lobby') {
      return { ok: false, code: 'NOT_LOBBY', message: 'Team names can only be changed in the lobby.' };
    }
    if (!isTeamId(teamId)) {
      return { ok: false, code: 'BAD_TEAM', message: 'Team must be 0 or 1.' };
    }
    if (this.state.players.length !== 4) {
      return { ok: false, code: 'NEED_FOUR', message: 'Team names need four seated players.' };
    }
    syncPartnershipRoster(this.state);
    if (!setTeamName(this.state, teamId, name)) {
      return { ok: false, code: 'BAD_TEAM', message: 'Unknown team.' };
    }
    this.state.lastAction = `Team renamed to ${this.state.teams[teamId]?.name}.`;
    this.broadcastState();
    return { ok: true };
  }

  public moveSeatToOtherTeam(actorUserId: string, seat: number): ActionResult {
    const auth = this.requireHost(actorUserId);
    if (!auth.ok) return auth;
    if (this.state.status !== 'lobby') {
      return { ok: false, code: 'NOT_LOBBY', message: 'Partners can only be rearranged in the lobby.' };
    }
    if (!swapSeatToOtherTeam(this.state, seat)) {
      return { ok: false, code: 'BAD_SEAT', message: 'Need four players to rearrange partners.' };
    }
    this.state.lastAction = 'Host swapped partners.';
    this.broadcastState();
    return { ok: true };
  }

  public setPartnerPairAction(
    actorUserId: string,
    seatA: unknown,
    seatB: unknown,
    teamId?: unknown
  ): ActionResult {
    const auth = this.requireHost(actorUserId);
    if (!auth.ok) return auth;
    if (this.state.status !== 'lobby') {
      return { ok: false, code: 'NOT_LOBBY', message: 'Partners can only be arranged in the lobby.' };
    }
    const a = Number(seatA);
    const b = Number(seatB);
    if (!isValidLobbySeat(a) || !isValidLobbySeat(b)) {
      return { ok: false, code: 'BAD_SEAT', message: 'Pick two seats between 1 and 4.' };
    }
    const chosenTeam = teamId === undefined || teamId === null || teamId === ''
      ? undefined
      : (isTeamId(Number(teamId)) ? Number(teamId) as 0 | 1 : null);
    if (chosenTeam === null) {
      return { ok: false, code: 'BAD_TEAM', message: 'Team must be 0 or 1.' };
    }
    if (!setPartnerPair(this.state, a, b, chosenTeam)) {
      return { ok: false, code: 'BAD_SEAT', message: 'Need four seated players and two different seats.' };
    }
    const pair = this.state.players.filter((p) => p.seat === a || p.seat === b);
    const others = this.state.players.filter((p) => p.seat !== a && p.seat !== b);
    this.state.lastAction = `Host set teams: ${pair.map((p) => p.name).join(' + ')} vs ${others.map((p) => p.name).join(' + ')}.`;
    this.broadcastState();
    return { ok: true };
  }

  public swapSeatsAction(actorUserId: string, seatA: unknown, seatB: unknown): ActionResult {
    const auth = this.requireHost(actorUserId);
    if (!auth.ok) return auth;
    if (this.state.status !== 'lobby') {
      return { ok: false, code: 'NOT_LOBBY', message: 'Seats can only be swapped in the lobby.' };
    }
    const a = Number(seatA);
    const b = Number(seatB);
    if (!isValidLobbySeat(a) || !isValidLobbySeat(b)) {
      return { ok: false, code: 'BAD_SEAT', message: 'Pick two seats between 1 and 4.' };
    }
    const beforeA = this.state.players.find((p) => p.seat === a);
    const beforeB = this.state.players.find((p) => p.seat === b);
    if (!swapSeats(this.state, a, b)) {
      return { ok: false, code: 'BAD_SEAT', message: 'Both seats must be occupied to swap.' };
    }
    this.state.lastAction = `Host swapped ${beforeA?.name ?? 'a player'} and ${beforeB?.name ?? 'a player'}.`;
    this.broadcastState();
    return { ok: true };
  }

  public seatPartnersOppositeAction(actorUserId: string): ActionResult {
    const auth = this.requireHost(actorUserId);
    if (!auth.ok) return auth;
    if (this.state.status !== 'lobby') {
      return { ok: false, code: 'NOT_LOBBY', message: 'Seats can only be rearranged in the lobby.' };
    }
    if (!seatPartnersOpposite(this.state)) {
      return { ok: false, code: 'NEED_FOUR', message: 'Need four players to seat partners opposite.' };
    }
    this.state.lastAction = 'Partners seated opposite (0+2 vs 1+3).';
    this.broadcastState();
    return { ok: true };
  }

  public reorderHand(actorUserId: string, hand: unknown): ActionResult {
    const player = this.state.players.find((p) => p.id === actorUserId && !p.isAI);
    if (!player) return { ok: false, code: 'NOT_SEATED', message: 'You are not seated at this table.' };
    if (this.state.status !== 'playing') {
      return { ok: false, code: 'NOT_PLAYING', message: 'Hands can only be rearranged during play.' };
    }
    if (!Array.isArray(hand) || !hand.every((t) => Array.isArray(t) && t.length === 2)) {
      return { ok: false, code: 'BAD_HAND', message: 'Invalid hand order.' };
    }
    const next = (hand as Tile[]).map((t) => [Number(t[0]), Number(t[1])] as Tile);
    if (!sameTileMultiset(player.hand, next)) {
      return { ok: false, code: 'BAD_HAND', message: 'Hand reorder must keep the same tiles.' };
    }
    player.hand = next;
    this.broadcastState();
    return { ok: true };
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
