import { describe, it, expect } from 'vitest';
import { buildAlternatingSnake } from '../engine/chainPath.ts';
import { PlacedTile } from '../engine/types.ts';
import { diffRenderedChain } from './chainSync.ts';

function at(
  id: string,
  tile: [number, number],
  extras: Partial<PlacedTile> = {}
): PlacedTile {
  return {
    id,
    tile,
    isDouble: tile[0] === tile[1],
    position: { x: 0, y: 0.07, z: 0 },
    rotationY: 0,
    pipLeft: tile[0],
    pipRight: tile[1],
    outwardX: 1,
    outwardZ: 0,
    ...extras
  };
}

describe('Chain mesh reconciliation', () => {
  it('drops leftover preview tiles when a real deal starts empty', () => {
    const preview = buildAlternatingSnake(24);
    const { removeIds, add, update } = diffRenderedChain(
      preview.map((pt) => ({ id: pt.id, tile: pt.tile })),
      []
    );
    expect(removeIds.sort()).toEqual(preview.map((pt) => pt.id).sort());
    expect(add).toEqual([]);
    expect(update).toEqual([]);
  });

  it('does not keep a 24-tile snake when the live chain has a different opener', () => {
    const preview = buildAlternatingSnake(24);
    const opener = at('placed-0', [3, 3], { position: { x: 0, y: 0.07, z: 0 } });
    const { removeIds, add, update } = diffRenderedChain(
      preview.map((pt) => ({ id: pt.id, tile: pt.tile })),
      [opener]
    );

    expect(removeIds).toContain('placed-0');
    expect(removeIds.length).toBe(preview.length);
    expect(add).toEqual([opener]);
    expect(update).toEqual([]);
  });

  it('removes only ids that left the chain after a rematch-style replace', () => {
    const previous = [at('placed-0', [6, 6]), at('placed-1', [6, 5]), at('placed-2', [6, 4])];
    const next = [at('placed-0', [6, 6]), at('placed-1', [6, 1])];
    const { removeIds, add, update } = diffRenderedChain(
      previous.map((pt) => ({ id: pt.id, tile: pt.tile })),
      next
    );

    expect(removeIds.sort()).toEqual(['placed-1', 'placed-2']);
    expect(add.map((pt) => pt.id)).toEqual(['placed-1']);
    expect(update.map((pt) => pt.id)).toEqual(['placed-0']);
  });

  it('updates pose for tiles that stay on the felt', () => {
    const rendered = [at('placed-0', [6, 6])];
    const moved = at('placed-0', [6, 6], { position: { x: 1.2, y: 0.07, z: -0.4 }, rotationY: Math.PI / 2 });
    const { removeIds, add, update } = diffRenderedChain(
      rendered.map((pt) => ({ id: pt.id, tile: pt.tile })),
      [moved]
    );
    expect(removeIds).toEqual([]);
    expect(add).toEqual([]);
    expect(update).toEqual([moved]);
  });
});
