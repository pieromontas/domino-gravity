import { EndSide, PlacedTile, Tile } from './types.ts';
import { isDouble } from './dominoDeck.ts';

export const TILE_LENGTH = 1.0;
export const TILE_WIDTH = 0.5;
export const TILE_THICKNESS = 0.14;
const TABLE_LIMIT_X = 3.6;

export interface ChainHeadState {
  x: number;
  z: number;
  dirX: number; // -1, 0, or 1
  dirZ: number; // -1, 0, or 1
  curRow: number; // row offset
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
    // Doubles are laid crosswise (rotation 90 deg = Math.PI / 2), singles are laid along X axis (rotation 0)
    const rot = double ? Math.PI / 2 : 0;

    // Set initial head positions based on center tile half-length/width
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
      pipRight: tile[1]
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

    // Orient pips: matching pip connects to current end, other pip becomes the new open end
    let openPip: number;
    if (tile[0] === matchingPip) {
      openPip = tile[1];
    } else {
      openPip = tile[0];
    }

    // Check if we need to snake/turn because we are reaching table edge
    if (head.dirZ === 0) {
      const willExceed = (head.dirX > 0 && head.x + TILE_LENGTH > TABLE_LIMIT_X) ||
                         (head.dirX < 0 && head.x - TILE_LENGTH < -TABLE_LIMIT_X);

      if (willExceed) {
        // Snake turn: if right head, turn towards +Z; if left head, turn towards -Z
        const turnZ = side === 'right' ? 1 : -1;
        head.curRow += turnZ;
        head.dirZ = turnZ;
        head.dirX = 0;
      }
    } else if (head.dirX === 0) {
      // We just stepped perpendicular, now turn to snake backwards along X
      const newDirX = side === 'right' ? -1 : 1;
      head.dirX = newDirX;
      head.dirZ = 0;
    }

    // Calculate length contribution
    // For doubles: crosswise length along movement direction is TILE_WIDTH (0.5), perpendicular is TILE_LENGTH (1.0)
    // For singles: length along movement direction is TILE_LENGTH (1.0)
    const stepLength = double ? TILE_WIDTH : TILE_LENGTH;
    const halfStep = stepLength / 2;

    // Tile center position
    const posX = head.x + head.dirX * halfStep;
    const posZ = head.z + head.dirZ * halfStep;

    // Advance head to the new tip of this tile
    head.x += head.dirX * stepLength;
    head.z += head.dirZ * stepLength;

    // Calculate rotation angle
    // In standard orientation (moving along +X):
    // Single: 0 rad (along X)
    // Double: Math.PI / 2 (crosswise, along Z)
    let rot = 0;
    if (head.dirX !== 0) {
      rot = double ? Math.PI / 2 : 0;
    } else {
      // Moving along Z
      rot = double ? 0 : Math.PI / 2;
    }

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
      pipRight
    };
  }
}
