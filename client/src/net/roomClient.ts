import { AIDifficulty, EndSide, GameState, PlacedTile, TableId, TeamId, Tile } from '../engine/types.ts';
import { parseAIDifficulty } from '../engine/aiDifficulty.ts';
import { DEFAULT_TABLE_ID, formatTableLabel, parseTableId } from '../engine/tableId.ts';
import { DominoEngine } from '../engine/dominoEngine.ts';
import { DominoAI } from '../engine/ai.ts';
import {
  emptyPartnershipFields,
  resetMatchScores,
  sameTileMultiset,
  seatPartnersOpposite,
  setPartnershipEnabled,
  setTeamName,
  swapSeatToOtherTeam,
  syncPartnershipRoster
} from '../engine/partnership.ts';
import { soundManager } from '../renderer/sound.ts';
import { ActivityParticipantView } from './discord.ts';

export interface RoomClientEvents {
  onStateUpdate: (state: GameState) => void;
  onTilePlacedAnim?: (tile: Tile, side: EndSide, seat: number) => void;
  onNetError?: (message: string) => void;
}

export interface AuthoritativeConnectOptions {
  roomId: string;
  sessionToken: string;
  useProxy?: boolean;
}

function createStandaloneLobby(): GameState {
  return {
    status: 'lobby',
    players: [
      {
        id: 'local-you',
        name: 'You',
        avatar: 'https://cdn.discordapp.com/embed/avatars/0.png',
        isAI: false,
        hand: [],
        score: 0,
        seat: 0,
        isHost: true,
        connected: true
      },
      {
        id: 'ai-easy-1',
        name: 'Maya (AI)',
        avatar: 'https://cdn.discordapp.com/embed/avatars/1.png',
        isAI: true,
        aiDifficulty: 'easy',
        hand: [],
        score: 0,
        seat: 1,
        connected: true
      }
    ],
    boneyard: [],
    chain: [],
    openEnds: { left: null, right: null },
    currentTurn: 0,
    firstTurnOfRound: true,
    consecutivePasses: 0,
    roundNumber: 1,
    targetScore: 100,
    tableId: DEFAULT_TABLE_ID,
    lastAction: 'Welcome to Domino Gravity! Ready to play.',
    winnerSeat: null,
    ...emptyPartnershipFields(),
    seed: Date.now()
  };
}

export class RoomClient {
  private engine: DominoEngine;
  private ai: DominoAI;
  private state: GameState;
  private events: RoomClientEvents;
  private ws: WebSocket | null = null;
  private localSeat: number = 0;
  public isMultiplayer: boolean = false;
  public roomId: string | null = null;
  private aiTurnTimeout: ReturnType<typeof setTimeout> | null = null;
  /** `?preview=longchain` seats a QA snake; a real match must wipe it. */
  private layoutPreviewActive = false;

  constructor(events: RoomClientEvents) {
    this.events = events;
    this.engine = new DominoEngine();
    this.ai = new DominoAI(this.engine);
    this.state = createStandaloneLobby();
  }

  public getState(): GameState {
    return this.state;
  }

  public getLocalSeat(): number {
    return this.localSeat;
  }

  public isLocalHost(): boolean {
    const me = this.state.players.find((p) => p.seat === this.localSeat);
    return !!me?.isHost;
  }

  public isLayoutPreview(): boolean {
    return this.layoutPreviewActive;
  }

  public setLocalPlayer(name: string, avatar: string, id: string) {
    if (this.isMultiplayer) return;
    if (this.state.players[0]) {
      this.state.players[0].name = name;
      this.state.players[0].avatar = avatar;
      this.state.players[0].id = id;
      this.emitUpdate();
    }
  }

  public addAI(difficulty: AIDifficulty = 'easy'): boolean {
    const chosen = parseAIDifficulty(difficulty);
    if (this.isMultiplayer) {
      this.send({ type: 'ADD_AI', difficulty: chosen });
      return true;
    }
    if (this.state.status !== 'lobby') return false;
    if (this.state.players.length >= 4) return false;

    const names = ['Maya', 'Felix', 'Zara', 'Atlas', 'Nova', 'Leo'];
    const usedNames = new Set(this.state.players.map(p => p.name.split(' ')[0]));
    const nextName = names.find(n => !usedNames.has(n)) || `Bot ${this.state.players.length + 1}`;

    const seat = this.state.players.length;
    this.state.players.push({
      id: `ai-${Date.now()}-${seat}`,
      name: `${nextName} (AI)`,
      avatar: `https://cdn.discordapp.com/embed/avatars/${seat % 5}.png`,
      isAI: true,
      aiDifficulty: chosen,
      hand: [],
      score: 0,
      seat,
      connected: true
    });

    syncPartnershipRoster(this.state);
    this.state.lastAction = `Added ${nextName} (${chosen.toUpperCase()} AI) to Seat ${seat + 1}`;
    this.emitUpdate();
    return true;
  }

  public setAIDifficulty(seat: number, difficulty: AIDifficulty): boolean {
    const chosen = parseAIDifficulty(difficulty);
    if (this.isMultiplayer) {
      this.send({ type: 'SET_AI_DIFFICULTY', seat, difficulty: chosen });
      return true;
    }
    if (this.state.status !== 'lobby') return false;
    const target = this.state.players.find((p) => p.seat === seat);
    if (!target?.isAI) return false;

    target.aiDifficulty = chosen;
    this.state.lastAction = `${target.name} difficulty set to ${chosen.toUpperCase()}`;
    this.emitUpdate();
    return true;
  }

  public removePlayer(seat: number): boolean {
    if (this.isMultiplayer) {
      this.send({ type: 'REMOVE_SEAT', seat });
      return true;
    }
    if (this.state.status !== 'lobby' || seat === this.localSeat) return false;
    const target = this.state.players.find((p) => p.seat === seat);
    if (!target || !target.isAI) return false;

    this.state.players = this.state.players.filter((p) => p.seat !== seat);
    this.state.players.forEach((p, idx) => { p.seat = idx; });
    syncPartnershipRoster(this.state);
    this.state.lastAction = `Removed ${target.name}`;
    this.emitUpdate();
    return true;
  }

  public setTargetScore(score: number) {
    if (this.isMultiplayer) {
      this.send({ type: 'SET_TARGET_SCORE', score });
      return;
    }
    if (this.state.status !== 'lobby') return;
    this.state.targetScore = score;
    this.state.lastAction = `Target score set to ${score} points`;
    this.emitUpdate();
  }

  public setTable(tableId: TableId) {
    const chosen = parseTableId(tableId);
    if (this.isMultiplayer) {
      this.send({ type: 'SET_TABLE', tableId: chosen });
      return;
    }
    if (this.state.status !== 'lobby') return;
    this.state.tableId = chosen;
    this.state.lastAction = `Table set to ${formatTableLabel(chosen)}`;
    this.emitUpdate();
  }

  public setPartnership(enabled: boolean) {
    if (this.isMultiplayer) {
      this.send({ type: 'SET_PARTNERSHIP', enabled });
      return;
    }
    if (this.state.status !== 'lobby') return;
    if (!setPartnershipEnabled(this.state, enabled)) return;
    this.state.lastAction = enabled
      ? 'Partnership mode on — opposite seats are partners.'
      : 'Free-for-all scoring — each seat scores alone.';
    this.emitUpdate();
  }

  public setTeamName(teamId: TeamId, name: string) {
    if (this.isMultiplayer) {
      this.send({ type: 'SET_TEAM_NAME', teamId, name });
      return;
    }
    if (this.state.status !== 'lobby') return;
    if (this.state.players.length !== 4) return;
    syncPartnershipRoster(this.state);
    if (!setTeamName(this.state, teamId, name)) return;
    this.state.lastAction = `Team renamed to ${this.state.teams[teamId]?.name}`;
    this.emitUpdate();
  }

  public moveSeatToOtherTeam(seat: number) {
    if (this.isMultiplayer) {
      this.send({ type: 'MOVE_SEAT_TEAM', seat });
      return;
    }
    if (this.state.status !== 'lobby') return;
    if (!swapSeatToOtherTeam(this.state, seat)) return;
    this.state.lastAction = 'Host swapped partners.';
    this.emitUpdate();
  }

  public seatPartnersOpposite() {
    if (this.isMultiplayer) {
      this.send({ type: 'SEAT_PARTNERS_OPPOSITE' });
      return;
    }
    if (this.state.status !== 'lobby') return;
    if (!seatPartnersOpposite(this.state)) return;
    this.state.lastAction = 'Partners seated opposite (0+2 vs 1+3).';
    this.emitUpdate();
  }

  public reorderHand(hand: Tile[]): boolean {
    if (this.isMultiplayer) {
      this.send({ type: 'REORDER_HAND', hand });
      return true;
    }
    const me = this.state.players[this.localSeat];
    if (!me || this.state.status !== 'playing') return false;
    if (!sameTileMultiset(me.hand, hand)) return false;
    me.hand = hand.map((t) => [t[0], t[1]] as Tile);
    this.emitUpdate();
    return true;
  }

  /** Local-only table snapshot for layout QA (`?preview=longchain`). */
  public loadStandalonePreview(chain: PlacedTile[], localHand: Tile[]) {
    this.layoutPreviewActive = true;
    this.state.status = 'playing';
    this.state.players[0].hand = localHand.map(t => [t[0], t[1]] as Tile);
    if (this.state.players[1]) {
      this.state.players[1].hand = [[0, 1], [2, 3], [4, 5], [6, 6]];
    }
    this.state.chain = chain;
    this.state.currentTurn = 0;
    this.state.requiredLeadTile = null;
    this.state.openEnds = {
      left: chain[0]?.pipLeft ?? null,
      right: chain[chain.length - 1]?.pipRight ?? null
    };
    this.state.lastAction = `Layout preview — ${chain.length} tiles on the felt`;
    this.emitUpdate();
  }

  /**
   * Double-six draw/block does **not** auto-place the opener. The table
   * stays empty until the starter plays the required lead (highest double,
   * or highest tile if no double was dealt).
   */
  public startGame() {
    if (this.isMultiplayer) {
      this.send({ type: 'START_GAME' });
      return;
    }
    if (this.state.players.length < 2) return;

    if (this.aiTurnTimeout) {
      clearTimeout(this.aiTurnTimeout);
      this.aiTurnTimeout = null;
    }
    this.exitLayoutPreview();
    this.state.roundNumber = 1;
    resetMatchScores(this.state);
    if (this.state.players.length === 4) {
      syncPartnershipRoster(this.state);
    }
    this.engine.startRound(this.state, Date.now());
    soundManager.playShuffle();
    this.emitUpdate();
    this.checkNextTurn();
  }

  public startNextRound() {
    if (this.isMultiplayer) {
      this.send({ type: 'NEXT_ROUND' });
      return;
    }
    this.exitLayoutPreview();
    this.state.roundNumber++;
    this.engine.startRound(this.state, Date.now());
    soundManager.playShuffle();
    this.emitUpdate();
    this.checkNextTurn();
  }

  public resetMatch() {
    if (this.isMultiplayer) {
      this.send({ type: 'RESET_MATCH' });
      return;
    }
    this.exitLayoutPreview();
    if (this.aiTurnTimeout) {
      clearTimeout(this.aiTurnTimeout);
      this.aiTurnTimeout = null;
    }
    this.state.status = 'lobby';
    this.state.chain = [];
    this.state.boneyard = [];
    this.state.openEnds = { left: null, right: null };
    this.state.requiredLeadTile = null;
    this.state.players.forEach(p => {
      p.hand = [];
      p.score = 0;
    });
    this.state.tableCall = null;
    this.state.lastPassSeat = null;
    this.state.roundSummary = undefined;
    resetMatchScores(this.state);
    this.state.lastAction = 'Returned to lobby';
    this.emitUpdate();
  }

  /** Drop QA snake + `?preview=longchain` so a real deal starts on a clean felt. */
  private exitLayoutPreview() {
    this.layoutPreviewActive = false;
    if (typeof window === 'undefined' || typeof window.history === 'undefined') return;
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.get('preview') !== 'longchain') return;
      url.searchParams.delete('preview');
      const next = `${url.pathname}${url.search}${url.hash}`;
      window.history.replaceState({}, '', next);
    } catch {
      // Ignore URL cleanup when history is unavailable (tests / embedded).
    }
  }

  public playTile(tile: Tile, side: EndSide): boolean {
    if (this.isMultiplayer) {
      this.send({ type: 'PLAY_TILE', tile, side });
      return true;
    }
    const success = this.engine.playTile(this.state, this.localSeat, tile, side);
    if (success) {
      this.emitUpdate();
      this.checkNextTurn();
    }
    return success;
  }

  public drawTile(): Tile | null {
    if (this.isMultiplayer) {
      this.send({ type: 'DRAW_TILE' });
      return [0, 0];
    }
    const drawn = this.engine.drawTile(this.state, this.localSeat);
    if (drawn) {
      soundManager.playShuffle();
      this.emitUpdate();
      this.checkNextTurn();
    }
    return drawn;
  }

  public passTurn(): boolean {
    if (this.isMultiplayer) {
      this.send({ type: 'PASS_TURN' });
      return true;
    }
    const success = this.engine.passTurn(this.state, this.localSeat);
    if (success) {
      this.emitUpdate();
      this.checkNextTurn();
    }
    return success;
  }

  public reportParticipants(participants: ActivityParticipantView[]) {
    if (!this.isMultiplayer) return;
    this.send({ type: 'ACTIVITY_PARTICIPANTS', participants });
  }

  /**
   * Evaluates if the current active turn belongs to an AI, and triggers AI action with delay
   */
  private checkNextTurn() {
    if (this.isMultiplayer) return;
    if (this.aiTurnTimeout) {
      clearTimeout(this.aiTurnTimeout);
      this.aiTurnTimeout = null;
    }

    if (this.state.status !== 'playing') {
      if (this.state.status === 'round_end' || this.state.status === 'match_end') {
        soundManager.playVictoryFanfare();
      }
      return;
    }

    const currentTurnSeat = this.state.currentTurn;
    const currentPlayer = this.state.players[currentTurnSeat];

    if (!currentPlayer) return;

    if (!currentPlayer.isAI && currentTurnSeat === this.localSeat) {
      soundManager.playTurnChime();
      return;
    }

    if (currentPlayer.isAI) {
      const delay = 750 + Math.random() * 350;
      this.aiTurnTimeout = setTimeout(() => {
        this.executeAITurn(currentTurnSeat);
      }, delay);
    }
  }

  private executeAITurn(aiSeat: number) {
    if (this.state.status !== 'playing' || this.state.currentTurn !== aiSeat) return;

    const decision = this.ai.makeDecision(this.state, aiSeat);

    if (decision.action === 'play' && decision.move) {
      const { tile, side } = decision.move;
      const success = this.engine.playTile(this.state, aiSeat, tile, side);
      if (success) {
        soundManager.playTileClack();
        this.emitUpdate();
        this.checkNextTurn();
      }
    } else if (decision.action === 'draw') {
      const drawn = this.engine.drawTile(this.state, aiSeat);
      if (drawn) {
        soundManager.playShuffle();
        this.emitUpdate();
        this.checkNextTurn();
      } else {
        this.engine.passTurn(this.state, aiSeat);
        this.emitUpdate();
        this.checkNextTurn();
      }
    } else if (decision.action === 'pass') {
      this.engine.passTurn(this.state, aiSeat);
      this.emitUpdate();
      this.checkNextTurn();
    }
  }

  private emitUpdate() {
    this.events.onStateUpdate({ ...this.state });
  }

  public connectAuthoritative(options: AuthoritativeConnectOptions): Promise<void> {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const prefix = options.useProxy ? '/.proxy' : '';
    const wsUrl = `${protocol}//${host}${prefix}/ws?session=${encodeURIComponent(options.sessionToken)}&room=${encodeURIComponent(options.roomId)}`;

    return new Promise((resolve) => {
      try {
        this.ws = new WebSocket(wsUrl);
        this.isMultiplayer = true;
        this.roomId = options.roomId;
        this.localSeat = -1;

        let settled = false;
        const settle = () => {
          if (settled) return;
          settled = true;
          resolve();
        };

        this.ws.onopen = () => settle();

        this.ws.onmessage = (event) => {
          const msg = JSON.parse(event.data);
          if (msg.type === 'JOIN_CONFIRM' && msg.yourSeat !== undefined) {
            this.localSeat = msg.yourSeat;
          }
          if (msg.type === 'SYNC_STATE') {
            this.applyNetworkState(msg.state, msg.yourSeat);
          }
          if (msg.type === 'ERROR') {
            this.events.onNetError?.(msg.message || 'Action rejected');
          }
        };

        this.ws.onerror = () => {
          console.warn('WebSocket connection failed, remaining in local offline mode');
          this.isMultiplayer = false;
          this.ws = null;
          settle();
        };

        this.ws.onclose = () => {
          if (!settled) {
            this.isMultiplayer = false;
            settle();
          }
        };
      } catch {
        this.isMultiplayer = false;
        resolve();
      }
    });
  }

  /** @deprecated identity must come from a server session, not query params */
  public connectToServer(roomId: string, _playerName: string, _avatar: string, _userId: string) {
    console.warn('connectToServer(room, name, avatar, user) is no longer used. Use connectAuthoritative().');
    void roomId;
  }

  private applyNetworkState(state: GameState, yourSeat?: number) {
    const prevStatus = this.state.status;
    const prevAction = this.state.lastAction;
    this.state = {
      ...emptyPartnershipFields(),
      ...state,
      tableId: parseTableId(state.tableId),
      partnership: !!state.partnership,
      teams: state.teams ?? [],
      tableCall: state.tableCall ?? null,
      lastPassSeat: state.lastPassSeat ?? null
    };
    if (yourSeat !== undefined) this.localSeat = yourSeat;

    if (state.status === 'playing' && prevStatus !== 'playing') {
      soundManager.playShuffle();
    }
    if ((state.status === 'round_end' || state.status === 'match_end') && prevStatus === 'playing') {
      soundManager.playVictoryFanfare();
    }
    if (state.status === 'playing' && state.currentTurn === this.localSeat && prevAction !== state.lastAction) {
      const me = state.players.find((p) => p.seat === this.localSeat);
      if (me && !me.isAI) soundManager.playTurnChime();
    }
    this.emitUpdate();
  }

  private send(message: Record<string, unknown>) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }
}
