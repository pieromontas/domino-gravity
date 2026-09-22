import confetti from 'canvas-confetti';
import { GameState } from '../engine/types.ts';
import { RoomClient } from '../net/roomClient.ts';

export class ModalsUI {
  private roomClient: RoomClient;
  private roundModal: HTMLElement;
  private matchModal: HTMLElement;

  constructor(roomClient: RoomClient) {
    this.roomClient = roomClient;
    this.roundModal = document.getElementById('round-modal')!;
    this.matchModal = document.getElementById('match-modal')!;

    const btnNextRound = document.getElementById('btn-next-round');
    btnNextRound?.addEventListener('click', () => {
      if (!this.roomClient.isLocalHost()) return;
      this.roundModal.classList.add('hidden');
      this.roomClient.startNextRound();
    });

    const btnPlayAgain = document.getElementById('btn-play-again');
    btnPlayAgain?.addEventListener('click', () => {
      if (!this.roomClient.isLocalHost()) return;
      this.matchModal.classList.add('hidden');
      this.roomClient.resetMatch();
    });
  }

  public render(state: GameState) {
    if (state.status === 'round_end' && state.roundSummary) {
      this.showRoundModal(state);
    } else {
      this.roundModal.classList.add('hidden');
    }

    if (state.status === 'match_end') {
      this.showMatchModal(state);
    } else {
      this.matchModal.classList.add('hidden');
    }
  }

  private showRoundModal(state: GameState) {
    const summary = state.roundSummary!;
    const winner = state.players[summary.winnerSeat];

    const icon = document.getElementById('round-modal-icon');
    const title = document.getElementById('round-modal-title');
    const subtitle = document.getElementById('round-modal-subtitle');
    const table = document.getElementById('round-score-table');

    if (icon) icon.textContent = summary.reason === 'domino' ? '🎉' : '🛡️';
    if (title) title.textContent = summary.reason === 'domino' ? `${winner.name} DOMINO!` : 'Game Blocked!';
    if (subtitle) {
      subtitle.textContent = summary.pointsWon > 0
        ? `${winner.name} wins +${summary.pointsWon} points this round!`
        : `Tie game! No points awarded this round.`;
    }

    if (table) {
      table.innerHTML = '';
      summary.playerPips.forEach(p => {
        const row = document.createElement('div');
        const isWinner = p.seat === summary.winnerSeat;
        row.className = `score-row ${isWinner ? 'winner' : ''}`;
        row.innerHTML = `
          <span>${isWinner ? '👑 ' : ''}${p.name}</span>
          <span>${p.pips} pips in hand</span>
        `;
        table.appendChild(row);
      });
    }

    const btnNextRound = document.getElementById('btn-next-round') as HTMLButtonElement | null;
    if (btnNextRound) {
      const host = this.roomClient.isLocalHost();
      btnNextRound.disabled = !host;
      btnNextRound.style.opacity = host ? '1' : '0.5';
      btnNextRound.textContent = host ? 'Next Round →' : 'Waiting for host…';
    }

    this.roundModal.classList.remove('hidden');
  }

  private showMatchModal(state: GameState) {
    const winner = state.winnerSeat !== null ? state.players[state.winnerSeat] : state.players[0];

    const title = document.getElementById('match-winner-title');
    const desc = document.getElementById('match-winner-desc');
    const list = document.getElementById('final-score-list');

    if (title) title.textContent = `🏆 ${winner.name} Wins!`;
    if (desc) desc.textContent = `Reached ${winner.score} points and claimed match victory!`;

    if (list) {
      list.innerHTML = '';
      const sorted = [...state.players].sort((a, b) => b.score - a.score);
      sorted.forEach((p, idx) => {
        const row = document.createElement('div');
        row.className = `score-row ${idx === 0 ? 'winner' : ''}`;
        row.innerHTML = `
          <span>#${idx + 1} ${p.name}</span>
          <span><strong>${p.score}</strong> points</span>
        `;
        list.appendChild(row);
      });
    }

    const btnPlayAgain = document.getElementById('btn-play-again') as HTMLButtonElement | null;
    if (btnPlayAgain) {
      const host = this.roomClient.isLocalHost();
      btnPlayAgain.disabled = !host;
      btnPlayAgain.style.opacity = host ? '1' : '0.5';
      btnPlayAgain.textContent = host ? 'Play Again (Lobby)' : 'Waiting for host…';
    }

    this.matchModal.classList.remove('hidden');

    // Launch celebration confetti!
    try {
      confetti({
        particleCount: 80,
        spread: 70,
        origin: { y: 0.6 }
      });
    } catch {}
  }
}
