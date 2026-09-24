export type Tile = [number, number];

export type EndSide = 'left' | 'right';

export type AIDifficulty = 'easy' | 'normal' | 'hard';

/** Selectable lobby table / map. `classic` is the original oval casino table. */
export type TableId = 'classic' | 'dominican';

export interface PlacedTile {
  id: string;
  tile: Tile;
  isDouble: boolean;
  position: { x: number; y: number; z: number };
  rotationY: number; // in radians
  sideConnected?: EndSide; // which end of the chain this was added to
  pipLeft: number;  // pip facing open towards left/start of chain
  pipRight: number; // pip facing open towards right/end of chain
  /** Unit vector from tile center toward the newly opened end (chain growth direction). */
  outwardX: number;
  outwardZ: number;
}

export type TeamId = 0 | 1;

export type TableCallKind = 'pase' | 'pase_corrido' | 'capicua';

export interface Team {
  id: TeamId;
  name: string;
  seats: [number, number];
  score: number;
}

export interface TableCall {
  kind: TableCallKind;
  seat: number;
  name: string;
  text: string;
}

export interface Player {
  id: string;
  name: string;
  avatar: string;
  isAI: boolean;
  aiDifficulty?: AIDifficulty;
  hand: Tile[];
  /** Always present in networked views; used when opponent `hand` is redacted. */
  handCount?: number;
  score: number;
  seat: number;
  isHost?: boolean;
  connected: boolean;
  /** Discord participant reserved a seat but has not authenticated yet. */
  pendingJoin?: boolean;
  /** Set in 4-player partnership; seats 0+2 vs 1+3 by default. */
  teamId?: TeamId;
}

export interface LegalMove {
  tile: Tile;
  side: EndSide;
  flip: boolean; // whether tile needs to be flipped to match the open end
}

export type GameStatus = 'lobby' | 'playing' | 'round_end' | 'match_end';

export interface GameState {
  status: GameStatus;
  players: Player[];
  boneyard: Tile[];
  /** Always present in networked views; used when `boneyard` tiles are redacted. */
  boneyardCount?: number;
  chain: PlacedTile[];
  openEnds: {
    left: number | null;
    right: number | null;
  };
  currentTurn: number; // seat index
  firstTurnOfRound: boolean;
  consecutivePasses: number;
  roundNumber: number;
  targetScore: number;
  /** Host-chosen table theme. Defaults to the original oval table. */
  tableId: TableId;
  lastAction: string;
  winnerSeat: number | null;
  requiredLeadTile?: Tile | null;
  /** Host-enabled 2v2 partnership. Default on when four seats are filled. */
  partnership: boolean;
  teams: Team[];
  tableCall: TableCall | null;
  /** Seat that last passed; next successful play is "pase y corrido". */
  lastPassSeat: number | null;
  roundSummary?: {
    reason: 'domino' | 'blocked';
    winnerSeat: number;
    winnerTeamId?: TeamId;
    pointsWon: number;
    capicua?: boolean;
    playerPips: { seat: number; name: string; pips: number; teamId?: TeamId }[];
    teamPips?: { teamId: TeamId; name: string; pips: number }[];
  };
  seed: number;
}
