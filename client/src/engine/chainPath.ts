import { EndSide, PlacedTile, Tile } from './types.ts';
import { isDouble } from './dominoDeck.ts';

export const TILE_LENGTH = 1.0;
export const TILE_WIDTH = 0.5;
export const TILE_THICKNESS = 0.14;
const TABLE_LIMIT_X = 3.6;

/**
 * Mesh local axes (see tileMesh BoxGeometry):
 *   X = TILE_WIDTH (0.5), Y = thickness, Z = TILE_LENGTH (1.0)
 * Face texture maps tile[0] onto local -Z and tile[1] onto local +Z.
 * Yaw around Y therefore:
 *   0     → long axis along world Z (doubles / spinner when chain is on X)
 *   ±π/2  → long axis along world X (singles when chain is on X)
 */
export interface ChainHeadState {
  x: number;
  z: number;
  dirX: number; // -1, 0, or 1
  dirZ: number; // -1, 0, or 1
  curRow: number; // row offset
}

/** Half-extents of a placed tile on X/Z given its yaw. */
export function tileHalfExtents(rotationY: number): { hx: number; hz: number } {
  const longAlongX = Math.abs(Math.sin(rotationY)) > 0.5;
  if (longAlongX) {
    return { hx: TILE_LENGTH / 2, hz: TILE_WIDTH / 2 };
  }
  return { hx: TILE_WIDTH / 2, hz: TILE_LENGTH / 2 };
}

export function tilesOverlap(a: PlacedTile, b: PlacedTile, epsilon = 0.02): boolean {
  const ea = tileHalfExtents(a.rotationY);
  const eb = tileHalfExtents(b.rotationY);
  const dx = Math.abs(a.position.x - b.position.x);
  const dz = Math.abs(a.position.z - b.position.z);
  return dx < ea.hx + eb.hx - epsilon && dz < ea.hz + eb.hz - epsilon;
}

/**
 * World yaw so the tile's long axis follows `dir` and the matching pip
 * faces the already-placed neighbor (opposite of growth).
 */
export function yawForPlacedTile(
  tile: Tile,
  matchingPip: number,
  dirX: number,
  dirZ: number
): number {
  const double = isDouble(tile);
  const matchingIsFirstPip = tile[0] === matchingPip;

  if (dirX !== 0) {
    if (double) {
      return 0; // spinner: long axis along Z, chain along X
    }
    // ±π/2 puts tile[0] at -X / tile[1] at +X (π/2) or the reverse (−π/2).
    if (dirX > 0) {
      return matchingIsFirstPip ? Math.PI / 2 : -Math.PI / 2;
    }
    return matchingIsFirstPip ? -Math.PI / 2 : Math.PI / 2;
  }

  if (double) {
    return Math.PI / 2; // spinner: long axis along X, chain along Z
  }
  // 0 puts tile[0] at -Z / tile[1] at +Z; π flips it.
  if (dirZ > 0) {
    return matchingIsFirstPip ? 0 : Math.PI;
  }
  return matchingIsFirstPip ? Math.PI : 0;
}

/**
 * Glowing drop-target just past the open tip of an end tile, along the true
 * chain heading — not a naive ±X offset from chain[0].
 */
export function getPlacementMarkerPosition(
  endTile: PlacedTile,
  side: EndSide,
  chainLength: number
): { x: number; z: number } {
  const along = endTile.isDouble ? TILE_WIDTH / 2 : TILE_LENGTH / 2;
  const dist = along + 0.55;

  if (chainLength === 1) {
    const dirX = side === 'left' ? -1 : 1;
    return { x: endTile.position.x + dirX * dist, z: endTile.position.z };
  }

  return {
    x: endTile.position.x + endTile.outwardX * dist,
    z: endTile.position.z + endTile.outwardZ * dist
  };
}

export class ChainLayoutManager {
  private leftHead: ChainHeadState;
  private rightHead: ChainHeadState;

  constructor() {
    this.leftHead = { x: 0, z: 0, dirX: -1, dirZ: 0, curRow: 0 };
    this.rightHead = { x: 0, z: 0, dirX: 1, dirZ: 0, curRow: 0 };
  }

  public reset() {
    this.leftHead = { x: 0, z: 0, dirX: -1, dirZ: 0, curRow: 0 };
    this.rightHead = { x: 0, z: 0, dirX: 1, dirZ: 0, curRow: 0 };
  }

  /**
   * Calculates the position and rotation for the very first tile placed at table center.
   */
  public calculateFirstTile(tile: Tile): PlacedTile {
    const double = isDouble(tile);
    // Doubles sit spinner-style (long axis Z). Singles lie along X with tile[0] on -X.
    const rot = double ? 0 : Math.PI / 2;
    const halfSpan = double ? TILE_WIDTH / 2 : TILE_LENGTH / 2;

    this.leftHead = {
      x: -halfSpan,
      z: 0,
      dirX: -1,
      dirZ: 0,
      curRow: 0
    };
    this.rightHead = {
      x: halfSpan,
      z: 0,
      dirX: 1,
      dirZ: 0,
      curRow: 0
    };

    return {
      id: `placed-0`,
      tile,
      isDouble: double,
      position: { x: 0, y: TILE_THICKNESS / 2, z: 0 },
      rotationY: rot,
      pipLeft: tile[0],
      pipRight: tile[1],
      outwardX: 1,
      outwardZ: 0
    };
  }

  /**
   * Calculates position and orientation for appending a tile to either 'left' or 'right' head.
   */
  public appendTile(
    tile: Tile,
    side: EndSide,
    matchingPip: number,
    totalChainLength: number
  ): PlacedTile {
    const head = side === 'left' ? this.leftHead : this.rightHead;
    const double = isDouble(tile);

    let openPip: number;
    if (tile[0] === matchingPip) {
      openPip = tile[1];
    } else {
      openPip = tile[0];
    }

    // Snake before placing so this tile follows the new heading if we hit the rail.
    if (head.dirZ === 0) {
      const willExceed = (head.dirX > 0 && head.x + TILE_LENGTH > TABLE_LIMIT_X) ||
                         (head.dirX < 0 && head.x - TILE_LENGTH < -TABLE_LIMIT_X);

      if (willExceed) {
        const turnZ = side === 'right' ? 1 : -1;
        head.curRow += turnZ;
        head.dirZ = turnZ;
        head.dirX = 0;
      }
    } else if (head.dirX === 0) {
      const newDirX = side === 'right' ? -1 : 1;
      head.dirX = newDirX;
      head.dirZ = 0;
    }

    const stepLength = double ? TILE_WIDTH : TILE_LENGTH;
    const halfStep = stepLength / 2;

    const posX = head.x + head.dirX * halfStep;
    const posZ = head.z + head.dirZ * halfStep;

    const outwardX = head.dirX;
    const outwardZ = head.dirZ;

    head.x += head.dirX * stepLength;
    head.z += head.dirZ * stepLength;

    const rot = yawForPlacedTile(tile, matchingPip, outwardX, outwardZ);

    const pipLeft = side === 'left' ? openPip : matchingPip;
    const pipRight = side === 'right' ? openPip : matchingPip;

    return {
      id: `placed-${totalChainLength}`,
      tile,
      isDouble: double,
      position: { x: posX, y: TILE_THICKNESS / 2, z: posZ },
      rotationY: rot,
      sideConnected: side,
      pipLeft,
      pipRight,
      outwardX,
      outwardZ
    };
  }
}
