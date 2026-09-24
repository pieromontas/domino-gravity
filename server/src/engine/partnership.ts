import { GameState, LegalMove, TableCall, Team, TeamId, Tile } from './types.js';
import { getTileId, handTotalPips } from './dominoDeck.js';

export const DEFAULT_TEAM_NAMES: [string, string] = ['Equipo A', 'Equipo B'];
export const TEAM_NAME_MAX_LEN = 20;

/** Opposite seats around a 4-player table. */
export const DEFAULT_TEAM_SEATS: [Team['seats'], Team['seats']] = [
  [0, 2],
  [1, 3]
];

export function emptyPartnershipFields(): {
  partnership: boolean;
  teams: Team[];
  tableCall: TableCall | null;
  lastPassSeat: number | null;
} {
  return {
    partnership: false,
    teams: [],
    tableCall: null,
    lastPassSeat: null
  };
}

export function isTeamId(value: unknown): value is TeamId {
  return value === 0 || value === 1;
}

export function isValidLobbySeat(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 3;
}

/** Opposite seats around a square table (0↔2, 1↔3). */
export function seatsAreOpposite(a: number, b: number): boolean {
  return isValidLobbySeat(a) && isValidLobbySeat(b) && Math.abs(a - b) === 2;
}

export function teamCounts(state: Pick<GameState, 'players'>): [number, number] {
  const counts: [number, number] = [0, 0];
  for (const player of state.players) {
    counts[player.teamId === 1 ? 1 : 0] += 1;
  }
  return counts;
}

export function teamsAreBalanced(state: Pick<GameState, 'players'>): boolean {
  if (state.players.length !== 4) return false;
  const [a, b] = teamCounts(state);
  return a === 2 && b === 2;
}

export function sanitizeTeamName(raw: unknown, fallback: string): string {
  const text = String(raw ?? '')
    .replace(/[\u0000-\u001F<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return fallback;
  return text.slice(0, TEAM_NAME_MAX_LEN);
}

export function isPartnershipActive(state: Pick<GameState, 'partnership' | 'players' | 'teams'>): boolean {
  return !!state.partnership && state.players.length === 4 && state.teams.length === 2;
}

export function teamById(state: Pick<GameState, 'teams'>, teamId: TeamId): Team | undefined {
  return state.teams.find((t) => t.id === teamId);
}

export function teamForSeat(
  state: Pick<GameState, 'players' | 'teams'>,
  seat: number
): Team | undefined {
  const player = state.players.find((p) => p.seat === seat);
  if (player?.teamId === 0 || player?.teamId === 1) {
    return teamById(state, player.teamId);
  }
  return state.teams.find((t) => t.seats.includes(seat));
}

export function defaultTeamIdForSeat(seat: number): TeamId {
  return seat % 2 === 0 ? 0 : 1;
}

export function createDefaultTeams(preserved?: Team[]): Team[] {
  return [
    {
      id: 0,
      name: sanitizeTeamName(preserved?.[0]?.name, DEFAULT_TEAM_NAMES[0]),
      seats: [...DEFAULT_TEAM_SEATS[0]],
      score: preserved?.[0]?.score ?? 0
    },
    {
      id: 1,
      name: sanitizeTeamName(preserved?.[1]?.name, DEFAULT_TEAM_NAMES[1]),
      seats: [...DEFAULT_TEAM_SEATS[1]],
      score: preserved?.[1]?.score ?? 0
    }
  ];
}

export function rebuildTeamSeats(state: GameState): void {
  if (!state.teams.length) return;
  for (const team of state.teams) {
    const seats = state.players
      .filter((p) => p.teamId === team.id)
      .map((p) => p.seat)
      .sort((a, b) => a - b);
    if (seats.length === 2) {
      team.seats = [seats[0], seats[1]];
    }
  }
}

/**
 * Keep 4-seat lobbies in partnership by default (opposite partners).
 * Fewer than 4 seats always drops back to free-for-all.
 */
export function syncPartnershipRoster(state: GameState): void {
  if (state.players.length !== 4) {
    state.partnership = false;
    state.teams = [];
    for (const player of state.players) {
      player.teamId = undefined;
    }
    return;
  }

  const firstFour = state.teams.length === 0;
  if (firstFour) {
    state.teams = createDefaultTeams();
    state.partnership = true;
  }

  const assigned = state.players.filter((p) => p.teamId === 0 || p.teamId === 1);
  if (assigned.length !== 4) {
    for (const player of state.players) {
      player.teamId = defaultTeamIdForSeat(player.seat);
    }
  }

  const counts = [0, 0];
  for (const player of state.players) {
    counts[player.teamId === 1 ? 1 : 0] += 1;
  }
  if (counts[0] !== 2 || counts[1] !== 2) {
    for (const player of state.players) {
      player.teamId = defaultTeamIdForSeat(player.seat);
    }
  }

  rebuildTeamSeats(state);
}

export function setPartnershipEnabled(state: GameState, enabled: boolean): boolean {
  if (state.players.length !== 4) return false;
  state.partnership = enabled;
  if (enabled) {
    syncPartnershipRoster(state);
  } else {
    // Keep team colors/names for the lobby, but FFA scoring applies in-match.
    if (!state.teams.length) state.teams = createDefaultTeams();
  }
  return true;
}

export function setTeamName(state: GameState, teamId: TeamId, name: unknown): boolean {
  if (!state.teams.length) state.teams = createDefaultTeams();
  const team = teamById(state, teamId);
  if (!team) return false;
  team.name = sanitizeTeamName(name, DEFAULT_TEAM_NAMES[teamId]);
  return true;
}

/**
 * Move a seated player onto the other team by swapping with one occupant
 * so the table stays 2v2.
 */
export function swapSeatToOtherTeam(state: GameState, seat: number): boolean {
  if (state.players.length !== 4) return false;
  syncPartnershipRoster(state);
  const player = state.players.find((p) => p.seat === seat);
  if (!player || (player.teamId !== 0 && player.teamId !== 1)) return false;
  const otherId: TeamId = player.teamId === 0 ? 1 : 0;
  const swap = state.players.find((p) => p.teamId === otherId);
  if (!swap) return false;
  swap.teamId = player.teamId;
  player.teamId = otherId;
  rebuildTeamSeats(state);
  return true;
}

/**
 * Put any two occupied seats on one team and the remaining two on the other.
 * Always 2v2. The pair joins `teamId` when given, otherwise seat A's team.
 */
export function setPartnerPair(
  state: GameState,
  seatA: number,
  seatB: number,
  teamId?: TeamId
): boolean {
  if (state.players.length !== 4) return false;
  if (!isValidLobbySeat(seatA) || !isValidLobbySeat(seatB) || seatA === seatB) return false;
  const playerA = state.players.find((p) => p.seat === seatA);
  const playerB = state.players.find((p) => p.seat === seatB);
  if (!playerA || !playerB) return false;

  if (!state.teams.length) state.teams = createDefaultTeams();
  const keepTeam: TeamId = isTeamId(teamId)
    ? teamId
    : (playerA.teamId === 1 ? 1 : 0);
  const otherTeam: TeamId = keepTeam === 0 ? 1 : 0;
  for (const player of state.players) {
    player.teamId = player.seat === seatA || player.seat === seatB ? keepTeam : otherTeam;
  }
  rebuildTeamSeats(state);
  return teamsAreBalanced(state);
}

/**
 * Swap the people sitting in two seats. Discord / AI identity, host flag,
 * and team membership travel with the player so partnerships stay intact.
 */
export function swapSeats(state: GameState, seatA: number, seatB: number): boolean {
  if (!isValidLobbySeat(seatA) || !isValidLobbySeat(seatB) || seatA === seatB) return false;
  const playerA = state.players.find((p) => p.seat === seatA);
  const playerB = state.players.find((p) => p.seat === seatB);
  if (!playerA || !playerB) return false;
  playerA.seat = seatB;
  playerB.seat = seatA;
  state.players.sort((a, b) => a.seat - b.seat);
  rebuildTeamSeats(state);
  return true;
}

/** Place team 0 at seats 0+2 and team 1 at 1+3 (partners sit opposite). */
export function seatPartnersOpposite(state: GameState): boolean {
  if (state.players.length !== 4) return false;
  syncPartnershipRoster(state);
  const team0 = state.players.filter((p) => p.teamId === 0);
  const team1 = state.players.filter((p) => p.teamId === 1);
  if (team0.length !== 2 || team1.length !== 2) return false;
  const ordered = [team0[0], team1[0], team0[1], team1[1]];
  state.players = ordered;
  state.players.forEach((p, idx) => { p.seat = idx; });
  rebuildTeamSeats(state);
  return true;
}

export function resetMatchScores(state: GameState): void {
  for (const player of state.players) player.score = 0;
  for (const team of state.teams) team.score = 0;
}

export function awardPoints(state: GameState, winnerSeat: number, points: number): TeamId | undefined {
  if (isPartnershipActive(state)) {
    const team = teamForSeat(state, winnerSeat);
    if (!team) return undefined;
    team.score += points;
    for (const player of state.players) {
      if (player.teamId === team.id) player.score = team.score;
    }
    return team.id;
  }
  const winner = state.players[winnerSeat];
  if (winner) winner.score += points;
  return undefined;
}

export function playerPipRows(state: GameState) {
  return state.players.map((p) => ({
    seat: p.seat,
    name: p.name,
    pips: handTotalPips(p.hand),
    teamId: p.teamId
  }));
}

export function teamPipRows(state: GameState): { teamId: TeamId; name: string; pips: number }[] {
  return state.teams.map((team) => ({
    teamId: team.id,
    name: team.name,
    pips: state.players
      .filter((p) => p.teamId === team.id)
      .reduce((sum, p) => sum + handTotalPips(p.hand), 0)
  }));
}

/** Remaining pips on the opposing partnership (not including the winner's partner). */
export function opposingTeamPips(state: GameState, winnerSeat: number): number {
  const team = teamForSeat(state, winnerSeat);
  if (!team) return 0;
  return state.players
    .filter((p) => p.teamId !== team.id)
    .reduce((sum, p) => sum + handTotalPips(p.hand), 0);
}

export function otherSeatsPips(state: GameState, winnerSeat: number): number {
  return state.players
    .filter((p) => p.seat !== winnerSeat)
    .reduce((sum, p) => sum + handTotalPips(p.hand), 0);
}

/**
 * Classic capicúa: the going-out tile is legal on *both* open ends, and
 * those ends are different pips (a 3-6 closing 3 and 6, not a 5 on two 5s).
 */
export function isClassicCapicua(
  tile: Tile,
  openEnds: { left: number | null; right: number | null },
  legalMoves: LegalMove[]
): boolean {
  if (openEnds.left === null || openEnds.right === null) return false;
  if (openEnds.left === openEnds.right) return false;
  const left = legalMoves.some((m) => tilesEqual(m.tile, tile) && m.side === 'left');
  const right = legalMoves.some((m) => tilesEqual(m.tile, tile) && m.side === 'right');
  return left && right;
}

export function tilesEqual(a: Tile, b: Tile): boolean {
  return (a[0] === b[0] && a[1] === b[1]) || (a[0] === b[1] && a[1] === b[0]);
}

export function sameTileMultiset(a: Tile[], b: Tile[]): boolean {
  if (a.length !== b.length) return false;
  const counts = new Map<string, number>();
  for (const tile of a) {
    const id = getTileId(tile);
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  for (const tile of b) {
    const id = getTileId(tile);
    const next = (counts.get(id) || 0) - 1;
    if (next < 0) return false;
    counts.set(id, next);
  }
  return [...counts.values()].every((n) => n === 0);
}

export function makeTableCall(
  kind: TableCall['kind'],
  seat: number,
  name: string
): TableCall {
  const text =
    kind === 'pase' ? '¡Pase!'
      : kind === 'pase_corrido' ? '¡Pase y corrido!'
        : '¡Capicúa!';
  return { kind, seat, name, text };
}

export function scoreMeetsTarget(state: GameState, winnerSeat: number): boolean {
  if (isPartnershipActive(state)) {
    const team = teamForSeat(state, winnerSeat);
    return !!team && team.score >= state.targetScore;
  }
  return (state.players[winnerSeat]?.score ?? 0) >= state.targetScore;
}
