import { AIDifficulty, GameState, TableId, TeamId } from '../engine/types.ts';
import { isPartnershipActive } from '../engine/partnership.ts';
import {
  cycleAIDifficulty,
  formatAIDifficultyLabel,
  parseAIDifficulty
} from '../engine/aiDifficulty.ts';
import { parseTableId } from '../engine/tableId.ts';
import { RoomClient } from '../net/roomClient.ts';
import { tableMusic } from '../renderer/tableMusic.ts';

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

    const tableCards = document.querySelectorAll('.table-card');
    tableCards.forEach((card) => {
      card.addEventListener('click', (e) => {
        if (!this.roomClient.isLocalHost()) return;
        const target = e.currentTarget as HTMLElement;
        const tableId = parseTableId(target.getAttribute('data-table'));
        this.roomClient.setTable(tableId);
      });
    });

    const musicBtn = document.getElementById('btn-lobby-music');
    musicBtn?.addEventListener('click', () => {
      tableMusic.toggleMute();
      this.syncMusicControls(this.roomClient.getState().tableId);
    });

    const volume = document.getElementById('lobby-music-volume') as HTMLInputElement | null;
    volume?.addEventListener('input', () => {
      tableMusic.setVolume(Number(volume.value) / 100);
      this.syncMusicControls(this.roomClient.getState().tableId);
    });

    document.querySelectorAll('.mode-pill').forEach((pill) => {
      pill.addEventListener('click', (e) => {
        if (!this.roomClient.isLocalHost()) return;
        const target = e.currentTarget as HTMLElement;
        this.roomClient.setPartnership(target.getAttribute('data-partnership') === 'on');
      });
    });

    const seatOpposite = document.getElementById('btn-seat-opposite');
    seatOpposite?.addEventListener('click', () => {
      if (!this.roomClient.isLocalHost()) return;
      this.roomClient.seatPartnersOpposite();
    });

    for (const teamId of [0, 1] as TeamId[]) {
      const input = document.getElementById(`team-name-${teamId}`) as HTMLInputElement | null;
      input?.addEventListener('change', () => {
        if (!this.roomClient.isLocalHost()) return;
        this.roomClient.setTeamName(teamId, input.value);
      });
    }
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

  private syncTableCards(tableId: TableId, isHost: boolean) {
    const cards = document.querySelectorAll('.table-card');
    cards.forEach((card) => {
      const el = card as HTMLButtonElement;
      const id = parseTableId(el.getAttribute('data-table'));
      el.classList.toggle('active', id === tableId);
      el.disabled = !isHost;
      el.title = isHost
        ? `Play on the ${id === 'dominican' ? 'Dominican patio' : 'classic oval'} table`
        : 'Only the host can change the table';
    });
    this.syncMusicControls(tableId);
  }

  private syncMusicControls(tableId: TableId) {
    const row = document.getElementById('table-music-row');
    if (row) row.classList.toggle('hidden', tableId !== 'dominican');

    const btn = document.getElementById('btn-lobby-music');
    if (btn) {
      const on = !tableMusic.isMuted();
      btn.textContent = on ? '🎵 On' : '🔇 Off';
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    }

    const volume = document.getElementById('lobby-music-volume') as HTMLInputElement | null;
    if (volume) {
      volume.value = String(Math.round(tableMusic.getVolume() * 100));
      volume.disabled = tableMusic.isMuted();
    }
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

        const team = state.teams.find((t) => t.id === player.teamId);
        const teamClass = player.teamId === 0 ? 'team-a' : player.teamId === 1 ? 'team-b' : '';
        if (teamClass && state.partnership) card.classList.add(teamClass);
        const teamBadge = team && state.partnership
          ? (isHost
            ? `<button type="button" class="team-tag ${teamClass} interactive" data-seat="${seatIdx}" title="Move to the other team">${escapeHtml(team.name)}</button>`
            : `<span class="team-tag ${teamClass}">${escapeHtml(team.name)}</span>`)
          : '';

        card.innerHTML = `
          <div class="seat-player-meta">
            <img class="seat-avatar" src="${escapeHtml(player.avatar)}" alt="" />
            <div class="seat-name-box">
              <span class="seat-player-name">${escapeHtml(player.name)}</span>
              ${diffBadge}
              ${teamBadge}
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
        const teamBtn = card.querySelector('.team-tag.interactive');
        teamBtn?.addEventListener('click', () => {
          this.roomClient.moveSeatToOtherTeam(seatIdx);
        });
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
    this.syncTableCards(parseTableId(state.tableId), isHost);
    this.syncPartnershipControls(state, isHost);

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

  private syncPartnershipControls(state: GameState, isHost: boolean) {
    const block = document.getElementById('partnership-settings');
    if (!block) return;
    const show = state.players.length === 4;
    block.classList.toggle('hidden', !show);
    if (!show) return;

    document.querySelectorAll('.mode-pill').forEach((pill) => {
      const el = pill as HTMLButtonElement;
      const on = el.getAttribute('data-partnership') === 'on';
      el.classList.toggle('active', on === state.partnership);
      el.disabled = !isHost;
    });

    for (const teamId of [0, 1] as TeamId[]) {
      const input = document.getElementById(`team-name-${teamId}`) as HTMLInputElement | null;
      if (!input) continue;
      const name = state.teams.find((t) => t.id === teamId)?.name ?? '';
      if (document.activeElement !== input) input.value = name;
      input.disabled = !isHost || !state.partnership;
    }

    const opposite = document.getElementById('btn-seat-opposite') as HTMLButtonElement | null;
    if (opposite) {
      opposite.disabled = !isHost || !isPartnershipActive(state);
      opposite.style.opacity = opposite.disabled ? '0.5' : '1';
    }
  }
}
