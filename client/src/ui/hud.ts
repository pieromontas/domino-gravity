import { GameState, Tile } from '../engine/types.ts';
import { RoomClient } from '../net/roomClient.ts';
import { TableScene } from '../renderer/tableScene.ts';
import { soundManager } from '../renderer/sound.ts';
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
  public onTrayTileClick?: (tile: Tile, index: number) => void;

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

    const localSeat = this.roomClient.getLocalSeat();
    const isMyTurn = state.currentTurn === localSeat && state.status === 'playing';
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
      }
    }

    // Boneyard & round info
    const boneyardCount = document.getElementById('boneyard-count');
    if (boneyardCount) {
      boneyardCount.textContent = String(state.boneyardCount ?? state.boneyard.length);
    }

    const roundNum = document.getElementById('round-number');
    if (roundNum) roundNum.textContent = state.roundNumber.toString();

    const targetScoreDisplay = document.getElementById('target-score-display');
    if (targetScoreDisplay) targetScoreDisplay.textContent = state.targetScore.toString();

    // Scores bar
    const scoresBar = document.getElementById('scores-bar');
    if (scoresBar) {
      scoresBar.innerHTML = '';
      state.players.forEach(p => {
        const chip = document.createElement('div');
        const isActive = p.seat === state.currentTurn;
        chip.className = `score-chip ${isActive ? 'active-turn' : ''}`;
        chip.innerHTML = `
          <img class="chip-avatar" src="${p.avatar}" alt="" />
          <span>${p.name}: <strong>${p.score}</strong></span>
        `;
        scoresBar.appendChild(chip);
      });
    }

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

  private renderHandTray(state: GameState, localSeat: number, isMyTurn: boolean) {
    const list = document.getElementById('hand-tiles-list');
    const title = document.getElementById('hand-tray-title');
    const hint = document.getElementById('hand-tray-hint');
    if (!list || !title) return;

    const myPlayer = state.players[localSeat];
    const hand = myPlayer?.hand || [];

    title.textContent = `YOUR PIECES (${hand.length})`;

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
      el.title = `Domino [${tile[0]}|${tile[1]}]`;

      const canvasTop = this.createPipCanvas(tile[0]);
      const canvasBot = this.createPipCanvas(tile[1]);

      el.innerHTML = `
        <div class="tray-domino-half"></div>
        <div class="tray-domino-divider"></div>
        <div class="tray-domino-half"></div>
      `;

      el.children[0].appendChild(canvasTop);
      el.children[2].appendChild(canvasBot);

      el.addEventListener('click', () => {
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

        if (this.onTrayTileClick) {
          this.onTrayTileClick(tile, idx);
        }
      });

      list.appendChild(el);
    });
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
