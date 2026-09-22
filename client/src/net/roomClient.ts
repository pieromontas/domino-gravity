import { AIDifficulty, EndSide, GameState, PlacedTile, Tile } from '../engine/types.ts';
import { DominoEngine } from '../engine/dominoEngine.ts';
import { DominoAI } from '../engine/ai.ts';
import { soundManager } from '../renderer/sound.ts';

export interface RoomClientEvents {
  onStateUpdate: (state: GameState) => void;
  onTilePlacedAnim?: (tile: Tile, side: EndSide, seat: number) => void;
}

export class RoomClient {
  private engine: DominoEngine;
  private ai: DominoAI;
  private state: GameState;
  private events: RoomClientEvents;
  private ws: WebSocket | null = null;
  private localSeat: number = 0;
  public isMultiplayer: boolean = false;
  private aiTurnTimeout: ReturnType<typeof setTimeout> | null = null;
  /** `?preview=longchain` seats a QA snake; a real match must wipe it. */
  private layoutPreviewActive = false;

  constructor(events: RoomClientEvents) {
    this.events = events;
    this.engine = new DominoEngine();
    this.ai = new DominoAI(this.engine);

    // Initial default lobby state
    this.state = {
      status: 'lobby',
      players: [
        {
          id: 'player-1',
          name: 'Player 1',
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
      lastAction: 'Welcome to Domino Gravity! Ready to play.',
      winnerSeat: null,
      seed: Date.now()
    };
  }

  public getState(): GameState {
    return this.state;
  }

  public getLocalSeat(): number {
    return this.localSeat;
  }

  public isLayoutPreview(): boolean {
    return this.layoutPreviewActive;
  }

  public setLocalPlayer(name: string, avatar: string, id: string) {
    if (this.state.players[0]) {
      this.state.players[0].name = name;
      this.state.players[0].avatar = avatar;
      this.state.players[0].id = id;
      this.emitUpdate();
    }
  }

  public addAI(difficulty: AIDifficulty = 'easy'): boolean {
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
      aiDifficulty: difficulty,
      hand: [],
      score: 0,
      seat,
      connected: true
    });

    this.state.lastAction = `Added ${nextName} (${difficulty.toUpperCase()} AI) to Seat ${seat + 1}`;
    this.emitUpdate();
    return true;
  }

  public removePlayer(seat: number): boolean {
    if (this.state.status !== 'lobby' || seat === 0) return false;
    if (seat >= this.state.players.length) return false;

    const removed = this.state.players.splice(seat, 1);
    // Re-index remaining seats
    this.state.players.forEach((p, idx) => { p.seat = idx; });
    this.state.lastAction = `Removed ${removed[0].name}`;
    this.emitUpdate();
    return true;
  }

  public setTargetScore(score: number) {
    if (this.state.status !== 'lobby') return;
    this.state.targetScore = score;
    this.state.lastAction = `Target score set to ${score} points`;
    this.emitUpdate();
  }

  /** Local-only table snapshot for layout QA (`?preview=longchain`). */
  public loadStandalonePreview(chain: PlacedTile[], localHand: Tile[]) {
    this.layoutPreviewActive = true;
    this.state.status = 'playing';
    this.state.chain = chain;
    this.state.players[0].hand = localHand.map(t => [t[0], t[1]] as Tile);
    if (this.state.players[1]) {
      this.state.players[1].hand = [[0, 1], [2, 3], [4, 5], [6, 6]];
    }
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
    if (this.state.players.length < 2) return;

    if (this.aiTurnTimeout) {
      clearTimeout(this.aiTurnTimeout);
      this.aiTurnTimeout = null;
    }
    this.exitLayoutPreview();
    this.state.roundNumber = 1;
    this.state.players.forEach(p => { p.score = 0; });
    this.engine.startRound(this.state, Date.now());
    soundManager.playShuffle();
    this.emitUpdate();
    this.checkNextTurn();
  }

  public startNextRound() {
    this.exitLayoutPreview();
    this.state.roundNumber++;
    this.engine.startRound(this.state, Date.now());
    soundManager.playShuffle();
    this.emitUpdate();
    this.checkNextTurn();
  }

  public resetMatch() {
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
    const success = this.engine.playTile(this.state, this.localSeat, tile, side);
    if (success) {
      this.emitUpdate();
      this.checkNextTurn();
    }
    return success;
  }

  public drawTile(): Tile | null {
    const drawn = this.engine.drawTile(this.state, this.localSeat);
    if (drawn) {
      soundManager.playShuffle();
      this.emitUpdate();
      this.checkNextTurn();
    }
    return drawn;
  }

  public passTurn(): boolean {
    const success = this.engine.passTurn(this.state, this.localSeat);
    if (success) {
      this.emitUpdate();
      this.checkNextTurn();
    }
    return success;
  }

  /**
   * Evaluates if the current active turn belongs to an AI, and triggers AI action with delay
   */
  private checkNextTurn() {
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
      // Natural human-like thinking delay (700ms - 1100ms)
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
        // After drawing, immediately re-evaluate (can AI now play the drawn tile?)
        this.checkNextTurn();
      } else {
        // Boneyard was empty, pass
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

  // Network connection for multiplayer
  public connectToServer(roomId: string, playerName: string, avatar: string, userId: string) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/ws?room=${encodeURIComponent(roomId)}&user=${encodeURIComponent(userId)}&name=${encodeURIComponent(playerName)}&avatar=${encodeURIComponent(avatar)}`;

    try {
      this.ws = new WebSocket(wsUrl);
      this.isMultiplayer = true;

      this.ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'SYNC_STATE') {
          this.state = msg.state;
          if (msg.yourSeat !== undefined) {
            this.localSeat = msg.yourSeat;
          }
          this.emitUpdate();
        }
      };

      this.ws.onerror = () => {
        console.warn('WebSocket connection failed, remaining in local offline mode');
        this.isMultiplayer = false;
      };
    } catch {
      this.isMultiplayer = false;
    }
  }
}
