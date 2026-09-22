import { GameState, Tile } from './engine/types.js';

export function redactGameState(state: GameState, viewerSeat: number): GameState {
  return {
    ...state,
    openEnds: { ...state.openEnds },
    chain: state.chain.map((placed) => ({
      ...placed,
      tile: [placed.tile[0], placed.tile[1]] as Tile,
      position: { ...placed.position }
    })),
    boneyard: [],
    boneyardCount: state.boneyard.length,
    players: state.players.map((player) => ({
      ...player,
      hand: player.seat === viewerSeat
        ? player.hand.map((tile) => [tile[0], tile[1]] as Tile)
        : [],
      handCount: player.hand.length
    })),
    requiredLeadTile: state.requiredLeadTile
      ? [state.requiredLeadTile[0], state.requiredLeadTile[1]] as Tile
      : state.requiredLeadTile,
    roundSummary: state.roundSummary
      ? {
          ...state.roundSummary,
          playerPips: state.roundSummary.playerPips.map((row) => ({ ...row }))
        }
      : undefined,
    lastAction: redactLastAction(state, viewerSeat)
  };
}

function redactLastAction(state: GameState, viewerSeat: number): string {
  const action = state.lastAction;
  const drawer = state.players.find((p) => action.includes(p.name) && /drew \[/.test(action));
  if (drawer && drawer.seat !== viewerSeat) {
    return action.replace(/drew \[\d+\|\d+\][^()]*/, 'drew a tile ');
  }
  return action;
}

export function handsLeakInState(state: GameState, viewerSeat: number): boolean {
  return state.players.some((p) => p.seat !== viewerSeat && p.hand.length > 0)
    || state.boneyard.length > 0;
}
