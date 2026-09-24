import { EndSide, PlacedTile, Tile } from './types.ts';
import { isDouble } from './dominoDeck.ts';

export const TILE_LENGTH = 1.0;
export const TILE_WIDTH = 0.5;
export const TILE_THICKNESS = 0.14;

/**
 * Playable snake rails. Felt radius is 6.2 and the gold inset is 4.8;
 * a wide X rail lets a late-round chain (15–28 tiles) stay on 1–2 rows
 * per wing instead of folding into a tight, overlapping U.
 * Z rail stays inside the hand/seat clearance so long snakes rewind
 * instead of running through south/north racks (~z 3.7+).
 */
export const SNAKE_LIMIT_X = 5.25;
export const SNAKE_LIMIT_Z = 2.15;
/** Local / north hand rails sit beyond this so tiles never hide seats. */
export const HAND_CLEARANCE_Z = 3.2;

/** Extra air at 90° corners so L-turns read as a clean snake, not a pile. */
export const CORNER_GAP = 0.06;

export interface ChainBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/**
 * Mesh local axes (see tileMesh BoxGeometry):
 *   X = TILE_WIDTH (0.5), Y = thickness, Z = TILE_LENGTH (1.0)
 * Face texture maps tile[0] onto local -Z and tile[1] onto local +Z.
 * Yaw around Y therefore:
 *   0     → long axis along world Z (doubles / spinner when chain is on X)
 *   ±π/2  → long axis along world X (singles when chain is on X)
 */
export interface ChainHeadState {
  last: PlacedTile | null;
  dirX: number; // -1, 0, or 1
  dirZ: number; // -1, 0, or 1
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

export function chainWorldBounds(chain: PlacedTile[]): ChainBounds | null {
  if (chain.length === 0) return null;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const pt of chain) {
    const e = tileHalfExtents(pt.rotationY);
    minX = Math.min(minX, pt.position.x - e.hx);
    maxX = Math.max(maxX, pt.position.x + e.hx);
    minZ = Math.min(minZ, pt.position.z - e.hz);
    maxZ = Math.max(maxZ, pt.position.z + e.hz);
  }
  return { minX, maxX, minZ, maxZ };
}

/**
 * Orbit radius / top-down height that keeps the chain AABB in frame.
 * Pure so layout tests can lock the zoom curve without a WebGL context.
 */
export function recommendedViewForChain(
  bounds: ChainBounds,
  fovDeg: number,
  aspect: number
): { lookAtX: number; lookAtZ: number; radius: number; topY: number } {
  const spanX = bounds.maxX - bounds.minX;
  const spanZ = bounds.maxZ - bounds.minZ;
  const padding = 1.7;
  const halfW = spanX / 2 + padding;
  const halfD = spanZ / 2 + padding;
  const lookAtX = (bounds.minX + bounds.maxX) / 2;
  const lookAtZ = (bounds.minZ + bounds.maxZ) / 2 + 0.35;
  const fov = (fovDeg * Math.PI) / 180;
  const tan = Math.tan(fov / 2);
  const safeAspect = Math.max(aspect, 0.35);
  const frustum = Math.max(halfD / tan, halfW / (tan * safeAspect));
  // Pull back with chain span so a late-round line still reads on the felt,
  // even when the default 16:9 frustum would technically fit at radius 12.
  const spanBoost = 8.2 + Math.max(spanX, spanZ) * 0.82;
  const radius = Math.max(12, frustum, spanBoost);
  const topY = Math.max(14.5, halfW / tan + 2.2, halfD / tan + 2.2, radius + 2);
  return {
    lookAtX,
    lookAtZ,
    radius: Math.min(22, radius),
    topY: Math.min(24, topY)
  };
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
 * Center of the next tile so it kisses the previous one.
 * Straight joints meet end-to-end; 90° joints form an L (not a T or overlap).
 */
export function positionAfter(
  prev: PlacedTile,
  oldDirX: number,
  oldDirZ: number,
  dirX: number,
  dirZ: number,
  newRotationY: number,
  isTurn: boolean
): { x: number; z: number } {
  const prevExt = tileHalfExtents(prev.rotationY);
  const newExt = tileHalfExtents(newRotationY);
  const gap = isTurn ? CORNER_GAP : 0;

  if (!isTurn) {
    return {
      x: prev.position.x + dirX * (prevExt.hx + newExt.hx),
      z: prev.position.z + dirZ * (prevExt.hz + newExt.hz)
    };
  }

  // Leave an X-row: keep the turn flush with the previous tip so the
  // L-junction does not walk past the X rail, then step out in Z.
  if (Math.abs(oldDirX) === 1) {
    return {
      x: prev.position.x + oldDirX * (prevExt.hx - newExt.hx),
      z: prev.position.z + dirZ * (prevExt.hz + newExt.hz + gap)
    };
  }

  // Come off the corner onto the next row (Z → reverse X).
  return {
    x: prev.position.x + dirX * (prevExt.hx + newExt.hx + gap),
    z: prev.position.z + oldDirZ * (prevExt.hz + newExt.hz + gap)
  };
}

function aabbExceedsRail(x: number, z: number, hx: number, hz: number): boolean {
  return Math.abs(x) + hx > SNAKE_LIMIT_X || Math.abs(z) + hz > SNAKE_LIMIT_Z;
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
    this.leftHead = { last: null, dirX: -1, dirZ: 0 };
    this.rightHead = { last: null, dirX: 1, dirZ: 0 };
  }

  public reset() {
    this.leftHead = { last: null, dirX: -1, dirZ: 0 };
    this.rightHead = { last: null, dirX: 1, dirZ: 0 };
  }

  /**
   * Calculates the position and rotation for the very first tile placed at table center.
   */
  public calculateFirstTile(tile: Tile): PlacedTile {
    const double = isDouble(tile);
    // Doubles sit spinner-style (long axis Z). Singles lie along X with tile[0] on -X.
    const rot = double ? 0 : Math.PI / 2;

    const placed: PlacedTile = {
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

    this.leftHead = { last: placed, dirX: -1, dirZ: 0 };
    this.rightHead = { last: placed, dirX: 1, dirZ: 0 };

    return placed;
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
    const prev = head.last;
    if (!prev) {
      return this.calculateFirstTile(tile);
    }

    const double = isDouble(tile);

    let openPip: number;
    if (tile[0] === matchingPip) {
      openPip = tile[1];
    } else {
      openPip = tile[0];
    }

    const oldDirX = head.dirX;
    const oldDirZ = head.dirZ;
    let dirX = oldDirX;
    let dirZ = oldDirZ;

    // Snake before placing so this tile follows the new heading if we hit the rail.
    if (dirZ === 0) {
      const trialRot = yawForPlacedTile(tile, matchingPip, dirX, dirZ);
      const trialPos = positionAfter(prev, oldDirX, oldDirZ, dirX, dirZ, trialRot, false);
      const trialExt = tileHalfExtents(trialRot);
      if (aabbExceedsRail(trialPos.x, trialPos.z, trialExt.hx, trialExt.hz)) {
        const turnZ = side === 'right' ? 1 : -1;
        dirZ = turnZ;
        dirX = 0;
      }
    } else {
      dirX = side === 'right' ? -1 : 1;
      dirZ = 0;
    }

    const isTurn = dirX !== oldDirX || dirZ !== oldDirZ;
    const rot = yawForPlacedTile(tile, matchingPip, dirX, dirZ);
    const pos = positionAfter(prev, oldDirX, oldDirZ, dirX, dirZ, rot, isTurn);

    const outwardX = dirX;
    const outwardZ = dirZ;

    const pipLeft = side === 'left' ? openPip : matchingPip;
    const pipRight = side === 'right' ? openPip : matchingPip;

    const placed: PlacedTile = {
      id: `placed-${totalChainLength}`,
      tile,
      isDouble: double,
      position: { x: pos.x, y: TILE_THICKNESS / 2, z: pos.z },
      rotationY: rot,
      sideConnected: side,
      pipLeft,
      pipRight,
      outwardX,
      outwardZ
    };

    head.last = placed;
    head.dirX = dirX;
    head.dirZ = dirZ;

    return placed;
  }
}

/**
 * Deterministic late-round snake for tests and visual previews.
 * Alternates left/right so both wings grow, inserting an occasional double.
 */
export function buildAlternatingSnake(count: number): PlacedTile[] {
  const layout = new ChainLayoutManager();
  if (count <= 0) return [];

  const chain: PlacedTile[] = [layout.calculateFirstTile([6, 6])];
  let leftPip = 6;
  let rightPip = 6;

  for (let i = 1; i < count; i++) {
    const side: EndSide = i % 2 === 1 ? 'right' : 'left';
    const match = side === 'left' ? leftPip : rightPip;
    const asDouble = i % 8 === 0;
    const open = asDouble ? match : (match + 1 + (i % 5)) % 7;
    const tile: Tile = asDouble ? [match, match] : [match, open];
    const placed = layout.appendTile(tile, side, match, chain.length);
    if (side === 'left') {
      chain.unshift(placed);
      leftPip = open;
    } else {
      chain.push(placed);
      rightPip = open;
    }
  }

  return chain;
}
