import { AIDifficulty, GameState, Player, TableId, TeamId } from '../engine/types.ts';
import { isPartnershipActive, seatsAreOpposite } from '../engine/partnership.ts';
import {
  cycleAIDifficulty,
  formatAIDifficultyLabel,
  parseAIDifficulty
} from '../engine/aiDifficulty.ts';
import { parseTableId } from '../engine/tableId.ts';
import { RoomClient } from '../net/roomClient.ts';
import { tableMusic } from '../renderer/tableMusic.ts';

type ArrangeMode = 'partner' | 'swap';

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[ch]!));
}

function partnerOf(state: GameState, seat: number): Player | undefined {
  const player = state.players.find((p) => p.seat === seat);
  if (player?.teamId !== 0 && player?.teamId !== 1) return undefined;
  return state.players.find((p) => p.seat !== seat && p.teamId === player.teamId);
}

export class LobbyUI {
  private container: HTMLElement;
  private roomClient: RoomClient;
  private pendingDifficulty: AIDifficulty = 'easy';
  private arrangeMode: ArrangeMode = 'partner';
  private selectedSeat: number | null = null;

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

    document.querySelectorAll('.arrange-pill').forEach((pill) => {
      pill.addEventListener('click', (e) => {
        if (!this.roomClient.isLocalHost()) return;
        const mode = (e.currentTarget as HTMLElement).getAttribute('data-arrange');
        this.arrangeMode = mode === 'swap' ? 'swap' : 'partner';
        this.selectedSeat = null;
        this.render(this.roomClient.getState());
      });
    });

    const seatOpposite = document.getElementById('btn-seat-opposite');
    seatOpposite?.addEventListener('click', () => {
      if (!this.roomClient.isLocalHost()) return;
      this.selectedSeat = null;
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
      this.selectedSeat = null;
      return;
    }

    this.container.classList.remove('hidden');
    const isHost = this.roomClient.isLocalHost();
    const canArrange = isHost && isPartnershipActive(state);

    if (this.selectedSeat !== null && !state.players.some((p) => p.seat === this.selectedSeat)) {
      this.selectedSeat = null;
    }

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
        const partner = state.partnership ? partnerOf(state, seatIdx) : undefined;
        const teamBadge = team && state.partnership
          ? `<span class="team-tag ${teamClass}">${escapeHtml(team.name)}</span>`
          : '';
        const partnerLine = partner
          ? `<span class="seat-partner">Partner: ${escapeHtml(partner.name)}</span>`
          : '';

        if (canArrange) {
          card.classList.add('arrange-host');
          if (this.selectedSeat === seatIdx) card.classList.add('selected');
          else if (this.selectedSeat !== null) card.classList.add('arrange-target');
          card.title = this.arrangeHint(state, seatIdx);
        }

        card.innerHTML = `
          <div class="seat-player-meta">
            <img class="seat-avatar" src="${escapeHtml(player.avatar)}" alt="" />
            <div class="seat-name-box">
              <span class="seat-index">Seat ${seatIdx + 1}</span>
              <span class="seat-player-name">${escapeHtml(player.name)}</span>
              ${diffBadge}
              ${teamBadge}
              ${partnerLine}
            </div>
          </div>
          ${kickBtn}
        `;

        if (player.isAI && isHost) {
          const kick = card.querySelector('.btn-kick');
          kick?.addEventListener('click', (event) => {
            event.stopPropagation();
            this.roomClient.removePlayer(seatIdx);
          });
          const badge = card.querySelector('.difficulty-tag.interactive');
          badge?.addEventListener('click', (event) => {
            event.stopPropagation();
            this.roomClient.setAIDifficulty(seatIdx, cycleAIDifficulty(player.aiDifficulty));
          });
        }
        if (canArrange) {
          card.addEventListener('click', () => this.onArrangeSeat(seatIdx));
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

  private onArrangeSeat(seatIdx: number) {
    if (!this.roomClient.isLocalHost()) return;
    if (this.selectedSeat === null) {
      this.selectedSeat = seatIdx;
      this.render(this.roomClient.getState());
      return;
    }
    if (this.selectedSeat === seatIdx) {
      this.selectedSeat = null;
      this.render(this.roomClient.getState());
      return;
    }
    const first = this.selectedSeat;
    this.selectedSeat = null;
    if (this.arrangeMode === 'swap') {
      this.roomClient.swapSeats(first, seatIdx);
      return;
    }
    this.roomClient.setPartnerPair(first, seatIdx);
  }

  private arrangeHint(state: GameState, seatIdx: number): string {
    const player = state.players.find((p) => p.seat === seatIdx);
    const name = player?.name ?? `Seat ${seatIdx + 1}`;
    if (this.arrangeMode === 'swap') {
      if (this.selectedSeat === null) return `Tap another seat to swap with ${name}`;
      if (this.selectedSeat === seatIdx) return 'Tap again to cancel';
      const selected = state.players.find((p) => p.seat === this.selectedSeat);
      return `Swap ${selected?.name ?? 'this seat'} with ${name}`;
    }
    if (this.selectedSeat === null) return `Tap who should partner with ${name}`;
    if (this.selectedSeat === seatIdx) return 'Tap again to cancel';
    const selected = state.players.find((p) => p.seat === this.selectedSeat);
    return `Make ${selected?.name ?? 'this player'} and ${name} partners (always 2 vs 2)`;
  }

  private syncPartnershipControls(state: GameState, isHost: boolean) {
    const block = document.getElementById('partnership-settings');
    if (!block) return;
    const show = state.players.length === 4;
    block.classList.toggle('hidden', !show);
    if (!show) {
      this.selectedSeat = null;
      return;
    }

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

    const actions = document.getElementById('team-arrange-actions');
    const canArrange = isHost && isPartnershipActive(state);
    actions?.classList.toggle('hidden', !canArrange);

    document.querySelectorAll('.arrange-pill').forEach((pill) => {
      const el = pill as HTMLButtonElement;
      const mode = el.getAttribute('data-arrange') === 'swap' ? 'swap' : 'partner';
      el.classList.toggle('active', mode === this.arrangeMode);
    });

    const opposite = document.getElementById('btn-seat-opposite') as HTMLButtonElement | null;
    if (opposite) {
      opposite.disabled = !canArrange;
      opposite.style.opacity = opposite.disabled ? '0.5' : '1';
    }

    this.renderTeamBoard(state, canArrange);
    this.syncArrangeHelp(state, isHost);
  }

  private renderTeamBoard(state: GameState, canArrange: boolean) {
    const board = document.getElementById('team-arrange-board');
    if (!board) return;
    const show = isPartnershipActive(state);
    board.hidden = !show;
    board.innerHTML = '';
    if (!show) return;

    for (const team of state.teams) {
      const col = document.createElement('div');
      const teamClass = team.id === 0 ? 'team-a' : 'team-b';
      col.className = `team-column ${teamClass}`;
      const members = state.players
        .filter((p) => p.teamId === team.id)
        .sort((a, b) => a.seat - b.seat);
      const opposite = members.length === 2 && seatsAreOpposite(members[0].seat, members[1].seat);

      const title = document.createElement('div');
      title.className = 'team-column-title';
      title.innerHTML = `<span>${escapeHtml(team.name)}</span><span class="team-column-meta">${
        opposite ? 'Sitting opposite' : 'Sitting adjacent'
      }</span>`;
      col.appendChild(title);

      for (const player of members) {
        const chip = document.createElement(canArrange ? 'button' : 'div');
        chip.className = 'team-chip';
        if (canArrange) (chip as HTMLButtonElement).type = 'button';
        if (this.selectedSeat === player.seat) chip.classList.add('selected');
        chip.innerHTML = `
          <img class="team-chip-avatar" src="${escapeHtml(player.avatar)}" alt="" />
          <span class="team-chip-copy">
            <span class="team-chip-name">${escapeHtml(player.name)}</span>
            <span class="team-chip-seat">Seat ${player.seat + 1}</span>
          </span>
        `;
        if (canArrange) {
          chip.setAttribute('title', this.arrangeHint(state, player.seat));
          chip.addEventListener('click', () => this.onArrangeSeat(player.seat));
        }
        col.appendChild(chip);
      }
      board.appendChild(col);
    }
  }

  private syncArrangeHelp(state: GameState, isHost: boolean) {
    const help = document.getElementById('team-arrange-help');
    if (!help) return;
    if (!state.partnership) {
      help.textContent = 'Free-for-all scoring — each seat scores alone.';
      return;
    }
    if (!isHost) {
      help.textContent = 'The host is arranging the two teams. You can see who partners with whom.';
      return;
    }
    const selected = this.selectedSeat === null
      ? undefined
      : state.players.find((p) => p.seat === this.selectedSeat);
    if (this.arrangeMode === 'swap') {
      help.textContent = selected
        ? `Tap the seat that should swap with ${selected.name}. Identity and team travel with the player.`
        : 'Swap seats: tap two seats to exchange who sits there. Partners stay together.';
      return;
    }
    help.textContent = selected
      ? `Now tap who should partner with ${selected.name}. The other two become the other team (always 2 vs 2).`
      : 'Set partners: tap a player, then tap their partner. Any two vs the other two — always 2 vs 2.';
  }
}
