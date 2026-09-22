import { AIDifficulty, GameState } from '../engine/types.ts';
import {
  cycleAIDifficulty,
  formatAIDifficultyLabel,
  parseAIDifficulty
} from '../engine/aiDifficulty.ts';
import { RoomClient } from '../net/roomClient.ts';

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[ch]!));
}

export class LobbyUI {
  private container: HTMLElement;
  private roomClient: RoomClient;
  private pendingDifficulty: AIDifficulty = 'easy';

  constructor(roomClient: RoomClient) {
    this.roomClient = roomClient;
    this.container = document.getElementById('lobby-screen')!;
    this.initEventListeners();
  }

  private initEventListeners() {
    const btnAddAI = document.getElementById('btn-add-ai');
    if (btnAddAI) {
      btnAddAI.addEventListener('click', () => {
        if (!this.roomClient.isLocalHost()) return;
        this.roomClient.addAI(this.pendingDifficulty);
      });
    }

    const btnStart = document.getElementById('btn-start-game');
    if (btnStart) {
      btnStart.addEventListener('click', () => {
        if (!this.roomClient.isLocalHost()) return;
        this.roomClient.startGame();
      });
    }

    const scorePills = document.querySelectorAll('.score-pill');
    scorePills.forEach(pill => {
      pill.addEventListener('click', (e) => {
        if (!this.roomClient.isLocalHost()) return;
        scorePills.forEach(p => p.classList.remove('active'));
        const target = e.currentTarget as HTMLElement;
        target.classList.add('active');
        const score = parseInt(target.getAttribute('data-score') || '100', 10);
        this.roomClient.setTargetScore(score);
      });
    });

    const diffPills = document.querySelectorAll('.diff-pill');
    diffPills.forEach(pill => {
      pill.addEventListener('click', (e) => {
        if (!this.roomClient.isLocalHost()) return;
        const target = e.currentTarget as HTMLElement;
        this.pendingDifficulty = parseAIDifficulty(target.getAttribute('data-difficulty'));
        this.syncDifficultyPills();
      });
    });
  }

  private syncDifficultyPills(isHost = this.roomClient.isLocalHost()) {
    const diffPills = document.querySelectorAll('.diff-pill');
    diffPills.forEach((pill) => {
      const el = pill as HTMLButtonElement;
      const diff = parseAIDifficulty(el.getAttribute('data-difficulty'));
      el.classList.toggle('active', diff === this.pendingDifficulty);
      el.disabled = !isHost;
    });
  }

  public render(state: GameState) {
    if (state.status !== 'lobby') {
      this.container.classList.add('hidden');
      return;
    }

    this.container.classList.remove('hidden');
    const isHost = this.roomClient.isLocalHost();

    const seatsGrid = document.getElementById('lobby-seats');
    if (!seatsGrid) return;

    seatsGrid.innerHTML = '';

    for (let seatIdx = 0; seatIdx < 4; seatIdx++) {
      const player = state.players.find(p => p.seat === seatIdx);
      const card = document.createElement('div');

      if (player) {
        const status = player.pendingJoin
          ? 'pending'
          : player.connected
            ? 'occupied'
            : 'disconnected';
        card.className = `seat-card ${status}`;
        const difficulty = parseAIDifficulty(player.aiDifficulty);
        const difficultyLabel = formatAIDifficultyLabel(difficulty);
        const diffBadge = player.isAI
          ? (isHost
            ? `<button type="button" class="difficulty-tag diff-${difficulty} interactive" data-seat="${seatIdx}" title="Click to cycle difficulty">${difficultyLabel}</button>`
            : `<span class="difficulty-tag diff-${difficulty}">${difficultyLabel}</span>`)
          : `<span class="seat-badge">${player.isHost ? '👑 Host' : player.pendingJoin ? 'Joining…' : player.connected ? 'Player' : 'Reconnecting…'}</span>`;

        const kickBtn = player.isAI && isHost
          ? `<button class="btn-kick" data-seat="${seatIdx}">Remove AI</button>`
          : '';

        card.innerHTML = `
          <div class="seat-player-meta">
            <img class="seat-avatar" src="${escapeHtml(player.avatar)}" alt="" />
            <div class="seat-name-box">
              <span class="seat-player-name">${escapeHtml(player.name)}</span>
              ${diffBadge}
            </div>
          </div>
          ${kickBtn}
        `;

        if (player.isAI && isHost) {
          const kick = card.querySelector('.btn-kick');
          kick?.addEventListener('click', () => {
            this.roomClient.removePlayer(seatIdx);
          });
          const badge = card.querySelector('.difficulty-tag.interactive');
          badge?.addEventListener('click', () => {
            this.roomClient.setAIDifficulty(seatIdx, cycleAIDifficulty(player.aiDifficulty));
          });
        }
      } else {
        card.className = 'seat-card empty';
        card.innerHTML = `<span>+ Seat ${seatIdx + 1} Empty</span>`;
      }

      seatsGrid.appendChild(card);
    }

    const readyCount = state.players.filter((p) => p.isAI || (p.connected && !p.pendingJoin)).length;
    const btnStart = document.getElementById('btn-start-game') as HTMLButtonElement;
    if (btnStart) {
      const canStart = isHost && readyCount >= 2 && !state.players.some((p) => p.pendingJoin);
      btnStart.disabled = !canStart;
      btnStart.style.opacity = canStart ? '1' : '0.5';
      btnStart.title = isHost
        ? (canStart ? 'Start the match' : 'Need two ready players and no pending joins')
        : 'Only the host can start';
    }

    const btnAddAI = document.getElementById('btn-add-ai') as HTMLButtonElement;
    if (btnAddAI) {
      btnAddAI.disabled = !isHost || state.players.length >= 4 || state.players.some((p) => p.pendingJoin);
      btnAddAI.style.opacity = btnAddAI.disabled ? '0.5' : '1';
    }

    const scorePills = document.querySelectorAll('.score-pill');
    scorePills.forEach((pill) => {
      const el = pill as HTMLButtonElement;
      el.disabled = !isHost;
      const score = parseInt(el.getAttribute('data-score') || '100', 10);
      el.classList.toggle('active', score === state.targetScore);
    });

    this.syncDifficultyPills(isHost);

    let meta = document.getElementById('lobby-meta');
    if (!meta) {
      meta = document.createElement('div');
      meta.id = 'lobby-meta';
      meta.className = 'lobby-meta';
      this.container.querySelector('.lobby-card')?.appendChild(meta);
    }
    const local = state.players.find((p) => p.seat === this.roomClient.getLocalSeat());
    const roomLabel = this.roomClient.roomId
      ? this.roomClient.roomId.replace(/^discord:[^:]+:[^:]+:/, 'activity · ')
      : 'local table';
    meta.textContent = `${local?.name || 'You'} · ${roomLabel}`;
  }
}
