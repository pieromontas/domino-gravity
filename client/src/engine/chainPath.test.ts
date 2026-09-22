import { describe, it, expect } from 'vitest';
import {
  ChainLayoutManager,
  SNAKE_LIMIT_X,
  SNAKE_LIMIT_Z,
  TILE_LENGTH,
  TILE_WIDTH,
  buildAlternatingSnake,
  chainWorldBounds,
  getPlacementMarkerPosition,
  recommendedViewForChain,
  tileHalfExtents,
  tilesOverlap,
  yawForPlacedTile
} from './chainPath.ts';
import { DominoEngine } from './dominoEngine.ts';
import { Tile } from './types.ts';

describe('Tile yaw vs mesh axes', () => {
  it('lays a double spinner-style (long axis along Z) when the chain runs on X', () => {
    expect(yawForPlacedTile([3, 3], 3, 1, 0)).toBe(0);
    const ext = tileHalfExtents(0);
    expect(ext.hx).toBeCloseTo(TILE_WIDTH / 2);
    expect(ext.hz).toBeCloseTo(TILE_LENGTH / 2);
  });

  it('lays a single along X with the matching pip facing the neighbor', () => {
    // Growing +X, matching pip is tile[0] → tile[0] on -X (π/2)
    expect(yawForPlacedTile([5, 1], 5, 1, 0)).toBeCloseTo(Math.PI / 2);
    // Growing +X, matching pip is tile[1] → flip so tile[1] is on -X
    expect(yawForPlacedTile([5, 1], 1, 1, 0)).toBeCloseTo(-Math.PI / 2);

    const alongX = tileHalfExtents(Math.PI / 2);
    expect(alongX.hx).toBeCloseTo(TILE_LENGTH / 2);
    expect(alongX.hz).toBeCloseTo(TILE_WIDTH / 2);
  });
});

describe('Chain layout — end-to-end placement', () => {
  it('opens a double spinner and attaches singles on both ends without overlap', () => {
    const layout = new ChainLayoutManager();
    const opener = layout.calculateFirstTile([0, 0]);
    expect(opener.isDouble).toBe(true);
    expect(opener.rotationY).toBe(0);

    const left = layout.appendTile([0, 4], 'left', 0, 1);
    const right = layout.appendTile([0, 1], 'right', 0, 2);

    expect(tilesOverlap(opener, left)).toBe(false);
    expect(tilesOverlap(opener, right)).toBe(false);
    expect(tilesOverlap(left, right)).toBe(false);

    // Singles must lie along X, not stand as fake spinners
    expect(Math.abs(Math.sin(left.rotationY))).toBeGreaterThan(0.5);
    expect(Math.abs(Math.sin(right.rotationY))).toBeGreaterThan(0.5);

    // Right tile sits to the +X of the opener
    expect(right.position.x).toBeGreaterThan(opener.position.x);
    expect(left.position.x).toBeLessThan(opener.position.x);
  });

  it('places drop-targets past the open tips, not on top of the tile', () => {
    const layout = new ChainLayoutManager();
    const opener = layout.calculateFirstTile([3, 3]);
    const leftTip = getPlacementMarkerPosition(opener, 'left', 1);
    const rightTip = getPlacementMarkerPosition(opener, 'right', 1);
    const ext = tileHalfExtents(opener.rotationY);

    expect(leftTip.x).toBeLessThan(opener.position.x - ext.hx);
    expect(rightTip.x).toBeGreaterThan(opener.position.x + ext.hx);
  });

  it('after a left play, the left drop-target follows the new left head — not chain-start ±X', () => {
    const layout = new ChainLayoutManager();
    const first = layout.calculateFirstTile([6, 6]);
    const left1 = layout.appendTile([6, 2], 'left', 6, 1);
    const left2 = layout.appendTile([2, 5], 'left', 2, 2);

    const chain = [left2, left1, first];
    const marker = getPlacementMarkerPosition(chain[0], 'left', chain.length);

    // Marker must sit beyond the newest left tile, not back at the opener
    expect(marker.x).toBeLessThan(left2.position.x);
    const openerLeft = getPlacementMarkerPosition(first, 'left', 1);
    expect(Math.abs(marker.x - openerLeft.x)).toBeGreaterThan(0.5);
  });
});

describe('Engine — only legal ends lock in', () => {
  function seatedGame(hands: Tile[][]) {
    const engine = new DominoEngine();
    const state = engine.createGame(
      hands.map((_, i) => ({
        id: `p${i}`,
        name: `P${i}`,
        avatar: '',
        isAI: false
      })),
      100,
      1
    );
    state.requiredLeadTile = null;
    state.chain = [];
    state.openEnds = { left: null, right: null };
    state.currentTurn = 0;
    state.players.forEach((p, i) => {
      p.hand = hands[i].map(t => [t[0], t[1]] as Tile);
    });
    return { engine, state };
  }

  it('rejects a tile on the end it does not match, even if the other end would fit', () => {
    const { engine, state } = seatedGame([
      [[2, 5], [2, 4], [0, 1]],
      [[6, 6], [1, 1], [3, 3], [4, 4]]
    ]);

    expect(engine.playTile(state, 0, [2, 5], 'right')).toBe(true);
    expect(state.openEnds).toEqual({ left: 2, right: 5 });

    state.currentTurn = 0;
    // [2|4] matches LEFT only
    expect(engine.playTile(state, 0, [2, 4], 'right')).toBe(false);
    expect(state.chain.length).toBe(1);
    expect(state.players[0].hand.some(t => t[0] === 2 && t[1] === 4)).toBe(true);

    expect(engine.playTile(state, 0, [2, 4], 'left')).toBe(true);
    expect(state.chain.length).toBe(2);
    expect(state.chain[0].tile).toEqual([2, 4]);
    expect(state.chain[1].tile).toEqual([2, 5]);
    expect(state.chain[0].pipRight).toBe(2);
    expect(state.chain[1].pipLeft).toBe(2);
  });

  it('keeps chain[0] as the left end so later left plays do not snap onto the opener', () => {
    const { engine, state } = seatedGame([
      [[3, 3], [3, 1], [1, 4]],
      [[0, 0], [5, 5], [6, 6], [2, 2]]
    ]);

    expect(engine.playTile(state, 0, [3, 3], 'right')).toBe(true);
    state.currentTurn = 0;
    expect(engine.playTile(state, 0, [3, 1], 'left')).toBe(true);
    state.currentTurn = 0;
    expect(engine.playTile(state, 0, [1, 4], 'left')).toBe(true);

    expect(state.chain.map(p => p.tile)).toEqual([[1, 4], [3, 1], [3, 3]]);
    expect(state.openEnds.left).toBe(4);
    expect(state.openEnds.right).toBe(3);

    for (let i = 0; i < state.chain.length - 1; i++) {
      expect(state.chain[i].pipRight).toBe(state.chain[i + 1].pipLeft);
      expect(tilesOverlap(state.chain[i], state.chain[i + 1])).toBe(false);
    }
  });

  it('rejects a completely mismatched tile on either end', () => {
    const { engine, state } = seatedGame([
      [[6, 6], [0, 1]],
      [[2, 2], [3, 3], [4, 4], [5, 5]]
    ]);
    expect(engine.playTile(state, 0, [6, 6], 'right')).toBe(true);
    state.currentTurn = 0;
    expect(engine.playTile(state, 0, [0, 1], 'left')).toBe(false);
    expect(engine.playTile(state, 0, [0, 1], 'right')).toBe(false);
    expect(state.chain.length).toBe(1);
  });
});

describe('Chain layout — long snakes stay readable', () => {
  it('lays a late-round snake without overlaps or leaving the felt rails', () => {
    for (const count of [15, 22, 28]) {
      const chain = buildAlternatingSnake(count);
      expect(chain.length).toBe(count);

      for (let i = 0; i < chain.length; i++) {
        for (let j = i + 1; j < chain.length; j++) {
          expect(tilesOverlap(chain[i], chain[j])).toBe(false);
        }
      }

      const bounds = chainWorldBounds(chain);
      expect(bounds).not.toBeNull();
      expect(bounds!.minX).toBeGreaterThanOrEqual(-SNAKE_LIMIT_X - 0.01);
      expect(bounds!.maxX).toBeLessThanOrEqual(SNAKE_LIMIT_X + 0.01);
      expect(bounds!.minZ).toBeGreaterThanOrEqual(-SNAKE_LIMIT_Z - 0.01);
      expect(bounds!.maxZ).toBeLessThanOrEqual(SNAKE_LIMIT_Z + 0.01);

      // Local hand sits near z ≈ 3.35; the snake must stay north of it.
      expect(bounds!.maxZ).toBeLessThan(3.1);
    }
  });

  it('uses an L-junction at the rail instead of stacking the turn on the last tile', () => {
    const layout = new ChainLayoutManager();
    const opener = layout.calculateFirstTile([6, 6]);
    const row: typeof opener[] = [opener];
    let pip = 6;
    for (let i = 0; i < 8; i++) {
      const next = (pip + 1) % 7;
      row.push(layout.appendTile([pip, next], 'right', pip, row.length));
      pip = next;
    }

    const turned = row.find(t => Math.abs(t.position.z) > 0.2);
    expect(turned).toBeDefined();
    const beforeTurn = row[row.indexOf(turned!) - 1];
    expect(beforeTurn).toBeDefined();
    expect(tilesOverlap(beforeTurn!, turned!)).toBe(false);
    expect(Math.abs(turned!.position.x)).toBeGreaterThan(Math.abs(beforeTurn!.position.x));
    expect(Math.abs(turned!.outwardZ)).toBe(1);
  });

  it('widens the camera when the chain AABB grows', () => {
    const short = chainWorldBounds(buildAlternatingSnake(4))!;
    const long = chainWorldBounds(buildAlternatingSnake(24))!;
    const shortView = recommendedViewForChain(short, 46, 16 / 9);
    const longView = recommendedViewForChain(long, 46, 16 / 9);
    expect(longView.radius).toBeGreaterThan(shortView.radius);
    expect(longView.radius).toBeGreaterThanOrEqual(12);
    expect(longView.radius).toBeLessThanOrEqual(22);
  });
});
