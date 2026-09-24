import { GameState, Tile } from '../engine/types.ts';
import { isPartnershipActive } from '../engine/partnership.ts';
import { formatAIDifficultyLabel, parseAIDifficulty } from '../engine/aiDifficulty.ts';
import { RoomClient } from '../net/roomClient.ts';
import { TableScene } from '../renderer/tableScene.ts';
import { soundManager } from '../renderer/sound.ts';
import { tableMusic } from '../renderer/tableMusic.ts';
import { parseTableId } from '../engine/tableId.ts';
import { DominoEngine } from '../engine/dominoEngine.ts';

export class GameHUD {
  private hudContainer: HTMLElement;
  private roomClient: RoomClient;
  private tableScene: TableScene;
  private engine: DominoEngine;

  private timerInterval: number | null = null;
  private timerSeconds: number = 45;
  private ruleToastTimeout: number | null = null;

  private selectedTile: Tile | null = null;
  private handView: 'fan' | 'inspect' = 'fan';
  private dragFrom: number | null = null;
  private lastCallKey = '';
  public onTrayTileClick?: (tile: Tile, index: number) => void;
  public onHandViewChange?: (mode: 'fan' | 'inspect') => void;

  constructor(roomClient: RoomClient, tableScene: TableScene, engine: DominoEngine) {
    this.roomClient = roomClient;
    this.tableScene = tableScene;
    this.engine = engine;
    this.hudContainer = document.getElementById('hud')!;

    this.initControls();
  }

  private initControls() {
    // Camera View Toggle
    const btnView = document.getElementById('btn-view-toggle');
    if (btnView) {
      btnView.addEventListener('click', () => {
        const cur = this.tableScene.getViewMode();
        const next = cur === 'perspective' ? 'topdown' : 'perspective';
        this.tableScene.setViewMode(next);
        btnView.textContent = next === 'topdown' ? '🎥' : '📐';
      });
    }

    // Camera Reset
    const btnReset = document.getElementById('btn-cam-reset');
    if (btnReset) {
      btnReset.addEventListener('click', () => {
        this.tableScene.resetCamera();
      });
    }

    // Audio Toggle
    const btnSound = document.getElementById('btn-sound-toggle');
    if (btnSound) {
      btnSound.addEventListener('click', () => {
        const enabled = soundManager.toggleSound();
        btnSound.textContent = enabled ? '🔊' : '🔇';
      });
    }

    const btnMusic = document.getElementById('btn-music-toggle');
    if (btnMusic) {
      btnMusic.addEventListener('click', () => {
        tableMusic.toggleMute();
        this.syncMusicButton(this.roomClient.getState());
      });
    }

    // Draw Button
    const btnDraw = document.getElementById('btn-draw');
    if (btnDraw) {
      btnDraw.addEventListener('click', () => {
        const res = this.roomClient.drawTile();
        if (!res) {
          const state = this.roomClient.getState();
          this.showRuleAlert(state.lastAction);
        }
      });
    }

    // Pass Button
    const btnPass = document.getElementById('btn-pass');
    if (btnPass) {
      btnPass.addEventListener('click', () => {
        const res = this.roomClient.passTurn();
        if (!res) {
          const state = this.roomClient.getState();
          this.showRuleAlert(state.lastAction);
        }
      });
    }

    const btnFan = document.getElementById('btn-hand-fan');
    const btnInspect = document.getElementById('btn-hand-inspect');
    btnFan?.addEventListener('click', () => this.setHandView('fan'));
    btnInspect?.addEventListener('click', () => this.setHandView('inspect'));
  }

  public getHandView(): 'fan' | 'inspect' {
    return this.handView;
  }

  private setHandView(mode: 'fan' | 'inspect') {
    this.handView = mode;
    document.getElementById('btn-hand-fan')?.classList.toggle('active', mode === 'fan');
    document.getElementById('btn-hand-inspect')?.classList.toggle('active', mode === 'inspect');
    document.getElementById('hand-tray-container')?.classList.toggle('inspect-view', mode === 'inspect');
    this.onHandViewChange?.(mode);
    this.render(this.roomClient.getState());
  }

  public setSelectedTile(tile: Tile | null) {
    this.selectedTile = tile;
    this.updateTraySelection();
  }

  public showRuleAlert(message: string) {
    const toast = document.getElementById('rule-alert-toast');
    const text = document.getElementById('rule-alert-text');
    if (!toast || !text) return;

    text.textContent = message;
    toast.classList.remove('hidden');

    if (this.ruleToastTimeout) {
      clearTimeout(this.ruleToastTimeout);
    }

    this.ruleToastTimeout = window.setTimeout(() => {
      toast.classList.add('hidden');
    }, 3800);
  }

  public render(state: GameState) {
    if (state.status === 'lobby') {
      this.hudContainer.classList.add('hidden');
      return;
    }

    this.hudContainer.classList.remove('hidden');
    this.syncMusicButton(state);

    const localSeat = this.roomClient.getLocalSeat();
    const isMyTurn = state.currentTurn === localSeat && state.status === 'playing';
    document.getElementById('hand-tray-container')?.classList.toggle('my-turn-glow', isMyTurn);
    const activePlayer = state.players[state.currentTurn];

    // Current turn card
    const turnAvatar = document.getElementById('turn-avatar') as HTMLImageElement;
    const turnName = document.getElementById('turn-player-name');
    const turnCard = document.getElementById('turn-card');

    if (activePlayer && turnAvatar && turnName) {
      turnAvatar.src = activePlayer.avatar;
      turnName.textContent = isMyTurn ? 'Your Turn' : activePlayer.name;
      if (turnCard) {
        turnCard.style.borderLeftColor = isMyTurn ? '#10B981' : '#F59E0B';
        turnCard.classList.toggle('my-turn', isMyTurn);
        turnCard.classList.toggle('their-turn', !isMyTurn && state.status === 'playing');
      }
    }

    this.renderTableCall(state);
    this.renderScores(state);

    // Boneyard & round info
    const boneyardCount = document.getElementById('boneyard-count');
    if (boneyardCount) {
      boneyardCount.textContent = String(state.boneyardCount ?? state.boneyard.length);
    }

    const roundNum = document.getElementById('round-number');
    if (roundNum) roundNum.textContent = state.roundNumber.toString();

    const targetScoreDisplay = document.getElementById('target-score-display');
    if (targetScoreDisplay) targetScoreDisplay.textContent = state.targetScore.toString();

    // Action banner
    const actionText = document.getElementById('action-text');
    if (actionText) actionText.textContent = state.lastAction;

    // Render Hand Tray
    this.renderHandTray(state, localSeat, isMyTurn);

    // Action buttons (Draw / Pass)
    const btnDraw = document.getElementById('btn-draw') as HTMLButtonElement;
    const btnPass = document.getElementById('btn-pass') as HTMLButtonElement;
    const btnDrawCount = document.getElementById('btn-draw-count');

    if (btnDraw && btnPass && isMyTurn) {
      const myHand = state.players[localSeat]?.hand || [];
      const legalMoves = this.engine.getLegalMoves(
        myHand,
        state.openEnds,
        state.chain.length === 0,
        state.requiredLeadTile
      );

      const hasMoves = legalMoves.length > 0;
      const boneyardHasTiles = (state.boneyardCount ?? state.boneyard.length) > 0;

      if (!hasMoves && boneyardHasTiles) {
        btnDraw.classList.remove('hidden');
        btnPass.classList.add('hidden');
        if (btnDrawCount) {
          btnDrawCount.textContent = String(state.boneyardCount ?? state.boneyard.length);
        }
      } else if (!hasMoves && !boneyardHasTiles) {
        btnDraw.classList.add('hidden');
        btnPass.classList.remove('hidden');
      } else {
        btnDraw.classList.add('hidden');
        btnPass.classList.add('hidden');
      }
    } else {
      btnDraw?.classList.add('hidden');
      btnPass?.classList.add('hidden');
    }

    // Manage turn timer reset
    this.resetTimer();
  }

  private syncMusicButton(state: GameState) {
    const btnMusic = document.getElementById('btn-music-toggle');
    if (!btnMusic) return;
    const onDominican = parseTableId(state.tableId) === 'dominican';
    btnMusic.classList.toggle('hidden', !onDominican);
    const unmuted = !tableMusic.isMuted();
    btnMusic.textContent = unmuted ? '🎵' : '🔇';
    btnMusic.title = unmuted
      ? 'Mute patio music'
      : 'Play patio music (bachata playlist)';
    btnMusic.classList.toggle('music-off', tableMusic.isMuted());
  }

  private renderHandTray(state: GameState, localSeat: number, isMyTurn: boolean) {
    const list = document.getElementById('hand-tiles-list');
    const title = document.getElementById('hand-tray-title');
    const hint = document.getElementById('hand-tray-hint');
    document.getElementById('btn-hand-fan')?.classList.toggle('active', this.handView === 'fan');
    document.getElementById('btn-hand-inspect')?.classList.toggle('active', this.handView === 'inspect');
    if (!list || !title) return;

    const myPlayer = state.players[localSeat];
    const hand = myPlayer?.hand || [];

    title.textContent = this.handView === 'inspect'
      ? `INSPECT (${hand.length}) · drag to rearrange`
      : `YOUR PIECES (${hand.length})`;

    if (state.status !== 'playing') {
      if (hint) hint.textContent = state.status === 'round_end' ? 'Round Completed' : 'Match Ended';
      list.innerHTML = '';
      return;
    }

    if (isMyTurn) {
      const allLegalMoves = this.engine.getLegalMoves(
        hand,
        state.openEnds,
        state.chain.length === 0,
        state.requiredLeadTile
      );

      if (allLegalMoves.length > 0) {
        if (state.requiredLeadTile) {
          if (hint) hint.textContent = `Round 1 Rule: You must lead with highest double [${state.requiredLeadTile[0]}|${state.requiredLeadTile[1]}]!`;
        } else {
          if (hint) hint.textContent = 'Your Turn: Click a highlighted piece to play';
        }
      } else {
        if ((state.boneyardCount ?? state.boneyard.length) > 0) {
          if (hint) hint.textContent = 'No playable pieces! You must draw from the boneyard.';
        } else {
          if (hint) hint.textContent = 'No playable pieces and boneyard is empty. Pass turn.';
        }
      }
    } else {
      if (hint) hint.textContent = `Waiting for ${state.players[state.currentTurn]?.name || 'opponent'}...`;
    }

    list.innerHTML = '';

    hand.forEach((tile, idx) => {
      const isLegal = isMyTurn && this.engine.getLegalMoves(
        [tile],
        state.openEnds,
        state.chain.length === 0,
        state.requiredLeadTile
      ).length > 0;

      const isSelected = this.selectedTile !== null &&
        ((this.selectedTile[0] === tile[0] && this.selectedTile[1] === tile[1]) ||
         (this.selectedTile[0] === tile[1] && this.selectedTile[1] === tile[0]));

      const el = document.createElement('div');
      el.className = `tray-domino ${isLegal ? 'playable' : 'unplayable'} ${isSelected ? 'selected' : ''}`;
      el.title = `Domino [${tile[0]}|${tile[1]}] — drag to rearrange`;
      el.dataset.index = String(idx);
      el.draggable = false;

      const canvasTop = this.createPipCanvas(tile[0]);
      const canvasBot = this.createPipCanvas(tile[1]);

      el.innerHTML = `
        <div class="tray-domino-half"></div>
        <div class="tray-domino-divider"></div>
        <div class="tray-domino-half"></div>
      `;

      el.children[0].appendChild(canvasTop);
      el.children[2].appendChild(canvasBot);

      this.bindTrayTile(el, tile, idx, isMyTurn, isLegal, state);
      list.appendChild(el);
    });
  }

  private bindTrayTile(
    el: HTMLElement,
    tile: Tile,
    idx: number,
    isMyTurn: boolean,
    isLegal: boolean,
    state: GameState
  ) {
    let pointerId: number | null = null;
    let startX = 0;
    let dragged = false;

    el.addEventListener('pointerdown', (e) => {
      pointerId = e.pointerId;
      startX = e.clientX;
      dragged = false;
      this.dragFrom = idx;
      el.classList.add('dragging');
      el.setPointerCapture(e.pointerId);
    });

    el.addEventListener('pointermove', (e) => {
      if (pointerId !== e.pointerId || this.dragFrom === null) return;
      if (Math.abs(e.clientX - startX) > 8) dragged = true;
      if (!dragged) return;
      const over = document.elementFromPoint(e.clientX, e.clientY)?.closest('.tray-domino') as HTMLElement | null;
      document.querySelectorAll('.tray-domino.drop-target').forEach((n) => n.classList.remove('drop-target'));
      if (over && over !== el) over.classList.add('drop-target');
    });

    const finish = (e: PointerEvent) => {
      if (pointerId !== e.pointerId) return;
      el.classList.remove('dragging');
      document.querySelectorAll('.tray-domino.drop-target').forEach((n) => n.classList.remove('drop-target'));
      const over = document.elementFromPoint(e.clientX, e.clientY)?.closest('.tray-domino') as HTMLElement | null;
      const from = this.dragFrom;
      this.dragFrom = null;
      pointerId = null;
      if (dragged && from !== null && over && over !== el) {
        const to = Number(over.dataset.index);
        if (Number.isInteger(to)) this.commitHandReorder(from, to);
        return;
      }
      if (dragged) return;
      if (!isMyTurn) {
        this.showRuleAlert(`⚠️ Rule: Please wait for your turn! Currently ${state.players[state.currentTurn]?.name}'s turn.`);
        return;
      }
      if (!isLegal) {
        if (state.requiredLeadTile) {
          this.showRuleAlert(`⚠️ Rule: You MUST lead with your highest double [${state.requiredLeadTile[0]}|${state.requiredLeadTile[1]}]!`);
        } else if (state.chain.length > 0) {
          this.showRuleAlert(`⚠️ Rule: [${tile[0]}|${tile[1]}] cannot be played. Open chain ends are [${state.openEnds.left}] and [${state.openEnds.right}].`);
        }
        return;
      }
      this.onTrayTileClick?.(tile, idx);
    };

    el.addEventListener('pointerup', finish);
    el.addEventListener('pointercancel', finish);
  }

  private commitHandReorder(from: number, to: number) {
    const seat = this.roomClient.getLocalSeat();
    const hand = [...(this.roomClient.getState().players[seat]?.hand || [])];
    if (from < 0 || to < 0 || from >= hand.length || to >= hand.length || from === to) return;
    const [moved] = hand.splice(from, 1);
    hand.splice(to, 0, moved);
    this.roomClient.reorderHand(hand);
  }

  private renderScores(state: GameState) {
    const scoresBar = document.getElementById('scores-bar');
    if (!scoresBar) return;
    scoresBar.innerHTML = '';
    scoresBar.classList.toggle('team-scores', isPartnershipActive(state));

    if (isPartnershipActive(state)) {
      state.teams.forEach((team) => {
        const wrap = document.createElement('div');
        const hasTurn = team.seats.includes(state.currentTurn);
        wrap.className = `team-chip team-${team.id} ${hasTurn ? 'active-turn' : 'idle-seat'}`;
        const members = state.players
          .filter((p) => p.teamId === team.id)
          .map((p) => {
            const on = p.seat === state.currentTurn ? ' seat-on' : '';
            return `<span class="team-member${on}">${p.name}</span>`;
          })
          .join('<span class="team-plus">+</span>');
        wrap.innerHTML = `
          <div class="team-chip-head">
            <strong>${team.name}</strong>
            <span class="team-score">${team.score}</span>
          </div>
          <div class="team-chip-members">${members}</div>
        `;
        scoresBar.appendChild(wrap);
      });
      return;
    }

    state.players.forEach((p) => {
      const chip = document.createElement('div');
      const isActive = p.seat === state.currentTurn;
      chip.className = `score-chip ${isActive ? 'active-turn' : 'idle-seat'}`;
      const difficulty = parseAIDifficulty(p.aiDifficulty);
      const diffBadge = p.isAI
        ? `<span class="difficulty-tag diff-${difficulty}">${formatAIDifficultyLabel(difficulty)}</span>`
        : '';
      chip.innerHTML = `
        <img class="chip-avatar ${isActive ? 'ring-active' : ''}" src="${p.avatar}" alt="" />
        <span>${p.name}: <strong>${p.score}</strong></span>
        ${diffBadge}
      `;
      scoresBar.appendChild(chip);
    });
  }

  private renderTableCall(state: GameState) {
    const call = document.getElementById('table-call');
    const text = document.getElementById('table-call-text');
    const seat = document.getElementById('table-call-seat');
    if (!call || !text || !seat) return;

    if (!state.tableCall || state.status === 'lobby') {
      call.classList.add('hidden');
      return;
    }

    const key = `${state.tableCall.kind}:${state.tableCall.seat}:${state.tableCall.text}`;
    text.textContent = state.tableCall.text;
    seat.textContent = state.tableCall.name;
    call.className = `table-call call-${state.tableCall.kind}`;
    if (key !== this.lastCallKey) {
      this.lastCallKey = key;
      call.classList.remove('hidden');
      soundManager.playCallChime(state.tableCall.kind);
    }
  }

  private updateTraySelection() {
    const list = document.getElementById('hand-tiles-list');
    if (!list) return;

    const cards = list.querySelectorAll('.tray-domino');
    cards.forEach(card => card.classList.remove('selected'));

    if (!this.selectedTile) return;

    // Highlight card matching selectedTile
    const myHand = this.roomClient.getState().players[this.roomClient.getLocalSeat()]?.hand || [];
    myHand.forEach((tile, idx) => {
      if ((tile[0] === this.selectedTile![0] && tile[1] === this.selectedTile![1]) ||
          (tile[0] === this.selectedTile![1] && tile[1] === this.selectedTile![0])) {
        if (cards[idx]) {
          cards[idx].classList.add('selected');
        }
      }
    });
  }

  private createPipCanvas(pips: number): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = 68;
    canvas.height = 68;
    canvas.className = 'tray-pip-canvas';
    const ctx = canvas.getContext('2d')!;

    if (pips === 0) return canvas;

    const cx = 34;
    const cy = 34;
    const rad = 5.2;
    const left = 16;
    const right = 52;
    const top = 16;
    const bottom = 52;

    const positions: [number, number][] = [];
    switch (pips) {
      case 1: positions.push([cx, cy]); break;
      case 2: positions.push([left, top], [right, bottom]); break;
      case 3: positions.push([left, top], [cx, cy], [right, bottom]); break;
      case 4: positions.push([left, top], [right, top], [left, bottom], [right, bottom]); break;
      case 5: positions.push([left, top], [right, top], [cx, cy], [left, bottom], [right, bottom]); break;
      case 6: positions.push([left, top], [right, top], [left, cy], [right, cy], [left, bottom], [right, bottom]); break;
    }

    ctx.fillStyle = '#1A1817';
    for (const [x, y] of positions) {
      ctx.beginPath();
      ctx.arc(x, y, rad, 0, Math.PI * 2);
      ctx.fill();
    }

    return canvas;
  }

  private resetTimer() {
    this.timerSeconds = 45;
    const el = document.getElementById('turn-timer');
    if (el) el.textContent = `${this.timerSeconds}s`;

    if (this.timerInterval) {
      clearInterval(this.timerInterval);
    }

    this.timerInterval = window.setInterval(() => {
      this.timerSeconds--;
      const timerEl = document.getElementById('turn-timer');
      if (timerEl) {
        timerEl.textContent = `${Math.max(0, this.timerSeconds)}s`;
      }
      if (this.timerSeconds <= 0) {
        clearInterval(this.timerInterval!);
      }
    }, 1000);
  }
}
