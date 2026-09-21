import { Tile } from './types.ts';

/**
 * Generates the standard double-six set of 28 dominoes:
 * [0|0] up to [6|6]
 */
export function generateDoubleSixDeck(): Tile[] {
  const deck: Tile[] = [];
  for (let i = 0; i <= 6; i++) {
    for (let j = i; j <= 6; j++) {
      deck.push([i, j]);
    }
  }
  return deck;
}

/**
 * Canonical tile identifier, e.g. "3-6" (always smaller number first)
 */
export function getTileId(tile: Tile): string {
  const [a, b] = tile;
  return a <= b ? `${a}-${b}` : `${b}-${a}`;
}

export function tileTotalPips(tile: Tile): number {
  return tile[0] + tile[1];
}

export function handTotalPips(hand: Tile[]): number {
  return hand.reduce((sum, tile) => sum + tileTotalPips(tile), 0);
}

export function isDouble(tile: Tile): boolean {
  return tile[0] === tile[1];
}

/**
 * Deterministic pseudo-random number generator (Mulberry32)
 */
export function createPRNG(seed: number) {
  let s = seed >>> 0;
  return function next(): number {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministic Fisher-Yates shuffle with seed
 */
export function shuffleDeck(deck: Tile[], seed: number = Date.now()): Tile[] {
  const prng = createPRNG(seed);
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(prng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/**
 * Finds highest double in a player's hand, or null if no double
 */
export function getHighestDouble(hand: Tile[]): Tile | null {
  let highestDouble: Tile | null = null;
  let maxPip = -1;
  for (const tile of hand) {
    if (isDouble(tile) && tile[0] > maxPip) {
      maxPip = tile[0];
      highestDouble = tile;
    }
  }
  return highestDouble;
}

/**
 * Finds tile with highest total pips in hand
 */
export function getHighestTile(hand: Tile[]): Tile {
  let highest = hand[0];
  let maxPip = -1;
  for (const tile of hand) {
    const total = tileTotalPips(tile);
    if (total > maxPip) {
      maxPip = total;
      highest = tile;
    }
  }
  return highest;
}
