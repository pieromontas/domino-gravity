import { AIDifficulty, GameState } from '../engine/types.ts';
import { RoomClient } from '../net/roomClient.ts';

export class LobbyUI {
  private container: HTMLElement;
  private roomClient: RoomClient;

  constructor(roomClient: RoomClient) {
    this.roomClient = roomClient;
    this.container = document.getElementById('lobby-screen')!;
    this.initEventListeners();
  }

  private initEventListeners() {
    const btnAddAI = document.getElementById('btn-add-ai');
    if (btnAddAI) {
      btnAddAI.addEventListener('click', () => {
        // Cycle difficulties or default to easy/normal
        const count = this.roomClient.getState().players.length;
        const diffs: AIDifficulty[] = ['easy', 'normal', 'hard'];
        const chosenDiff = diffs[(count - 1) % diffs.length];
        this.roomClient.addAI(chosenDiff);
      });
    }

    const btnStart = document.getElementById('btn-start-game');
    if (btnStart) {
      btnStart.addEventListener('click', () => {
        this.roomClient.startGame();
      });
    }

    // Score pills
    const scorePills = document.querySelectorAll('.score-pill');
    scorePills.forEach(pill => {
      pill.addEventListener('click', (e) => {
        scorePills.forEach(p => p.classList.remove('active'));
        const target = e.currentTarget as HTMLElement;
        target.classList.add('active');
        const score = parseInt(target.getAttribute('data-score') || '100', 10);
        this.roomClient.setTargetScore(score);
      });
    });
  }

  public render(state: GameState) {
    if (state.status !== 'lobby') {
      this.container.classList.add('hidden');
      return;
    }

    this.container.classList.remove('hidden');

    const seatsGrid = document.getElementById('lobby-seats');
    if (!seatsGrid) return;

    seatsGrid.innerHTML = '';

    for (let seatIdx = 0; seatIdx < 4; seatIdx++) {
      const player = state.players.find(p => p.seat === seatIdx);
      const card = document.createElement('div');

      if (player) {
        card.className = 'seat-card occupied';
        const diffBadge = player.isAI
          ? `<span class="difficulty-tag diff-${player.aiDifficulty || 'easy'}">${player.aiDifficulty || 'EASY'}</span>`
          : `<span class="seat-badge">${player.isHost ? '👑 Host' : 'Player'}</span>`;

        const kickBtn = player.isAI
          ? `<button class="btn-kick" data-seat="${seatIdx}">Kick</button>`
          : '';

        card.innerHTML = `
          <div class="seat-player-meta">
            <img class="seat-avatar" src="${player.avatar}" alt="${player.name}" />
            <div class="seat-name-box">
              <span class="seat-player-name">${player.name}</span>
              ${diffBadge}
            </div>
          </div>
          ${kickBtn}
        `;

        if (player.isAI) {
          const kick = card.querySelector('.btn-kick');
          kick?.addEventListener('click', () => {
            this.roomClient.removePlayer(seatIdx);
          });
        }
      } else {
        card.className = 'seat-card empty';
        card.innerHTML = `<span>+ Seat ${seatIdx + 1} Empty</span>`;
      }

      seatsGrid.appendChild(card);
    }

    // Enable / disable start button (need at least 2 players)
    const btnStart = document.getElementById('btn-start-game') as HTMLButtonElement;
    if (btnStart) {
      btnStart.disabled = state.players.length < 2;
      btnStart.style.opacity = state.players.length < 2 ? '0.5' : '1';
    }
  }
}
