import { PlacedTile, Tile } from '../engine/types.ts';

export interface RenderedChainTile {
  id: string;
  tile: Tile;
}

export function tilesMatch(a: Tile, b: Tile): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

/**
 * True table sync: drop meshes whose ids left the chain, rebuild when
 * `placed-N` is reused for a different tile (new round / leftover preview),
 * and refresh pose for ids that remain.
 */
export function diffRenderedChain(
  rendered: Iterable<RenderedChainTile>,
  chain: PlacedTile[]
): { removeIds: string[]; add: PlacedTile[]; update: PlacedTile[] } {
  const renderedById = new Map<string, RenderedChainTile>();
  for (const item of rendered) {
    renderedById.set(item.id, item);
  }

  const incomingIds = new Set(chain.map((pt) => pt.id));
  const removeIds: string[] = [];
  const add: PlacedTile[] = [];
  const update: PlacedTile[] = [];

  for (const id of renderedById.keys()) {
    if (!incomingIds.has(id)) {
      removeIds.push(id);
    }
  }

  for (const pt of chain) {
    const prev = renderedById.get(pt.id);
    if (!prev || !tilesMatch(prev.tile, pt.tile)) {
      if (prev) removeIds.push(pt.id);
      add.push(pt);
    } else {
      update.push(pt);
    }
  }

  return { removeIds, add, update };
}
