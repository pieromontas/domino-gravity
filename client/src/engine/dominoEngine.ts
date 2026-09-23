import {
  AIDifficulty,
  EndSide,
  GameState,
  LegalMove,
  Player,
  Tile
} from './types.ts';
import {
  generateDoubleSixDeck,
  getHighestDouble,
  getHighestTile,
  handTotalPips,
  isDouble,
  shuffleDeck
} from './dominoDeck.ts';
import { ChainLayoutManager } from './chainPath.ts';

export class DominoEngine {
  private layoutManager: ChainLayoutManager;

  constructor() {
    this.layoutManager = new ChainLayoutManager();
  }

  /**
   * Initializes a brand new game state for a set of players
   */
  public createGame(
    playerConfigs: { id: string; name: string; avatar: string; isAI: boolean; aiDifficulty?: AIDifficulty; isHost?: boolean }[],
    targetScore: number = 100,
    seed: number = Date.now()
  ): GameState {
    const players: Player[] = playerConfigs.map((cfg, idx) => ({
      ...cfg,
      hand: [],
      score: 0,
      seat: idx,
      connected: true
    }));

    const state: GameState = {
      status: 'playing',
      players,
      boneyard: [],
      chain: [],
      openEnds: { left: null, right: null },
      currentTurn: 0,
      firstTurnOfRound: true,
      consecutivePasses: 0,
      roundNumber: 1,
      targetScore,
      tableId: 'classic',
      lastAction: 'Game started',
      winnerSeat: null,
      seed
    };

    this.startRound(state, seed);
    return state;
  }

  /**
   * Starts a new round: deals 7 tiles to each player, determines first turn or starts chain
   */
  public startRound(state: GameState, seed: number = Date.now()): void {
    this.layoutManager.reset();
    state.chain = [];
    state.openEnds = { left: null, right: null };
    state.consecutivePasses = 0;
    state.firstTurnOfRound = true;
    state.status = 'playing';
    state.winnerSeat = null;
    state.roundSummary = undefined;

    const deck = shuffleDeck(generateDoubleSixDeck(), seed);
    const handSize = 7;

    for (let i = 0; i < state.players.length; i++) {
      state.players[i].hand = deck.splice(0, handSize);
    }
    state.boneyard = deck;

    // Determine starter
    if (state.roundNumber === 1) {
      // Find player with highest double, or highest tile if none
      let bestDoublePip = -1;
      let starterSeat = 0;
      let starterTile: Tile | null = null;

      for (let i = 0; i < state.players.length; i++) {
        const d = getHighestDouble(state.players[i].hand);
        if (d && d[0] > bestDoublePip) {
          bestDoublePip = d[0];
          starterSeat = i;
          starterTile = d;
        }
      }

      if (!starterTile) {
        let maxTotal = -1;
        for (let i = 0; i < state.players.length; i++) {
          const t = getHighestTile(state.players[i].hand);
          const tot = t[0] + t[1];
          if (tot > maxTotal) {
            maxTotal = tot;
            starterSeat = i;
            starterTile = t;
          }
        }
      }

      state.currentTurn = starterSeat;
      state.requiredLeadTile = starterTile;
      if (starterTile && isDouble(starterTile)) {
        state.lastAction = `🌟 ${state.players[starterSeat].name} has the highest double [${starterTile[0]}|${starterTile[1]}] and MUST lead!`;
      } else if (starterTile) {
        state.lastAction = `🌟 No doubles dealt. ${state.players[starterSeat].name} has highest tile [${starterTile[0]}|${starterTile[1]}] and MUST lead!`;
      }
    } else {
      // In subsequent rounds, previous winner leads
      state.requiredLeadTile = null;
      state.lastAction = `Round ${state.roundNumber} started. ${state.players[state.currentTurn].name} won previous round and leads!`;
    }
  }

  /**
   * Computes all legal moves for a given hand against current chain open ends
   */
  public getLegalMoves(
    hand: Tile[],
    openEnds: { left: number | null; right: number | null },
    isChainEmpty: boolean,
    requiredLeadTile?: Tile | null
  ): LegalMove[] {
    const moves: LegalMove[] = [];

    // If a specific lead tile is required (Round 1 starter rule)
    if (isChainEmpty && requiredLeadTile) {
      const hasTile = hand.some(t =>
        (t[0] === requiredLeadTile[0] && t[1] === requiredLeadTile[1]) ||
        (t[0] === requiredLeadTile[1] && t[1] === requiredLeadTile[0])
      );
      if (hasTile) {
        moves.push({ tile: requiredLeadTile, side: 'right', flip: false });
      }
      return moves;
    }

    if (isChainEmpty) {
      // On empty chain without required lead, any tile can be placed
      for (const tile of hand) {
        moves.push({ tile, side: 'right', flip: false });
      }
      return moves;
    }

    const { left, right } = openEnds;
    if (left === null || right === null) return moves;

    for (const tile of hand) {
      const [p0, p1] = tile;

      // Check left end
      if (p0 === left) {
        moves.push({ tile, side: 'left', flip: true });
      } else if (p1 === left) {
        moves.push({ tile, side: 'left', flip: false });
      }

      // Check right end
      if (p0 === right) {
        moves.push({ tile, side: 'right', flip: false });
      } else if (p1 === right) {
        moves.push({ tile, side: 'right', flip: true });
      }
    }

    return moves;
  }

  /**
   * Plays a tile onto the chain
   */
  public playTile(state: GameState, playerSeat: number, tile: Tile, side: EndSide): boolean {
    if (state.currentTurn !== playerSeat || state.status !== 'playing') {
      return false;
    }

    const player = state.players[playerSeat];
    const tileIdx = player.hand.findIndex(t => (t[0] === tile[0] && t[1] === tile[1]) || (t[0] === tile[1] && t[1] === tile[0]));
    if (tileIdx === -1) return false;

    const actualTile = player.hand[tileIdx];

    // Rule: First turn of Round 1 requires leading with highest double
    if (state.chain.length === 0 && state.requiredLeadTile) {
      const isLead = (actualTile[0] === state.requiredLeadTile[0] && actualTile[1] === state.requiredLeadTile[1]) ||
                     (actualTile[0] === state.requiredLeadTile[1] && actualTile[1] === state.requiredLeadTile[0]);
      if (!isLead) {
        state.lastAction = `⚠️ Rule: Must lead with your highest double [${state.requiredLeadTile[0]}|${state.requiredLeadTile[1]}]!`;
        return false;
      }
    }

    // If chain is empty:
    if (state.chain.length === 0) {
      const placed = this.layoutManager.calculateFirstTile(actualTile);
      state.chain.push(placed);
      state.openEnds = { left: actualTile[0], right: actualTile[1] };
      player.hand.splice(tileIdx, 1);
      state.requiredLeadTile = null;
      state.lastAction = `🎲 ${player.name} opened with [${actualTile[0]}|${actualTile[1]}] (Open ends: ${actualTile[0]} & ${actualTile[1]})`;
      state.consecutivePasses = 0;
      this.finishTurnOrRound(state, playerSeat);
      return true;
    }

    // Chain not empty: only a legal matching end may lock in
    const targetPip = side === 'left' ? state.openEnds.left : state.openEnds.right;
    if (targetPip === null) return false;

    const legalOnSide = this.getLegalMoves(
      [actualTile],
      state.openEnds,
      false,
      state.requiredLeadTile
    ).some(m => m.side === side);

    if (!legalOnSide) {
      state.lastAction = `⚠️ Rule: [${actualTile[0]}|${actualTile[1]}] cannot be played on ${side} (needs ${targetPip})!`;
      return false;
    }

    const placed = this.layoutManager.appendTile(actualTile, side, targetPip, state.chain.length);
    // Keep chain[0] = left end, chain[last] = right end so drop-targets track the real tips.
    if (side === 'left') {
      state.chain.unshift(placed);
    } else {
      state.chain.push(placed);
    }

    // Update open end
    const newPip = actualTile[0] === targetPip ? actualTile[1] : actualTile[0];
    if (side === 'left') {
      state.openEnds.left = newPip;
    } else {
      state.openEnds.right = newPip;
    }

    player.hand.splice(tileIdx, 1);
    state.consecutivePasses = 0;
    state.lastAction = `🎲 ${player.name} played [${actualTile[0]}|${actualTile[1]}] on ${side} (Open ends: ${state.openEnds.left} & ${state.openEnds.right})`;

    this.finishTurnOrRound(state, playerSeat);
    return true;
  }

  /**
   * Draws a tile from the boneyard into player's hand
   * Enforces rule: Player CANNOT draw if they already have a playable tile in hand!
   */
  public drawTile(state: GameState, playerSeat: number): Tile | null {
    if (state.currentTurn !== playerSeat || state.status !== 'playing') {
      return null;
    }

    const player = state.players[playerSeat];

    // Rule: Cannot draw if player already has a legal move!
    const legalMoves = this.getLegalMoves(player.hand, state.openEnds, state.chain.length === 0, state.requiredLeadTile);
    if (legalMoves.length > 0) {
      state.lastAction = `⚠️ Rule: ${player.name} has a playable tile in hand and cannot draw!`;
      return null;
    }

    if (state.boneyard.length === 0) {
      state.lastAction = `⚠️ Boneyard is empty! Must pass if no legal moves.`;
      return null;
    }

    const drawn = state.boneyard.pop()!;
    player.hand.push(drawn);

    // Check if the drawn tile is playable right away
    const canPlayDrawn = this.getLegalMoves([drawn], state.openEnds, state.chain.length === 0, state.requiredLeadTile).length > 0;
    if (canPlayDrawn) {
      state.lastAction = `📥 ${player.name} drew [${drawn[0]}|${drawn[1]}] — it can be played! (${state.boneyard.length} left)`;
    } else {
      state.lastAction = `📥 ${player.name} drew [${drawn[0]}|${drawn[1]}] (no match, ${state.boneyard.length} left in boneyard)`;
    }

    return drawn;
  }

  /**
   * Passes the turn if player has no legal moves and boneyard is empty
   * Enforces rules:
   * 1. Cannot pass if holding a playable tile.
   * 2. Cannot pass if boneyard still has tiles (must draw first).
   */
  public passTurn(state: GameState, playerSeat: number): boolean {
    if (state.currentTurn !== playerSeat || state.status !== 'playing') {
      return false;
    }

    const player = state.players[playerSeat];

    // Rule 1: Cannot pass if player has playable tiles
    const legalMoves = this.getLegalMoves(player.hand, state.openEnds, state.chain.length === 0, state.requiredLeadTile);
    if (legalMoves.length > 0) {
      state.lastAction = `⚠️ Rule: ${player.name} has playable tiles and cannot pass!`;
      return false;
    }

    // Rule 2: Cannot pass if boneyard is not empty
    if (state.boneyard.length > 0) {
      state.lastAction = `⚠️ Rule: Cannot pass while boneyard has tiles! You must draw.`;
      return false;
    }

    state.consecutivePasses++;
    state.lastAction = `⏭️ ${player.name} has no playable tiles & boneyard is empty. Passed turn.`;

    // Check if game is blocked: all players passed consecutively and boneyard is empty
    if (state.consecutivePasses >= state.players.length && state.boneyard.length === 0) {
      this.handleBlockedGame(state);
      return true;
    }

    this.advanceTurn(state);
    return true;
  }

  /**
   * Checks for round end (empty hand) or advances turn
   */
  private finishTurnOrRound(state: GameState, playerSeat: number): void {
    const player = state.players[playerSeat];

    // Check if player cleared hand
    if (player.hand.length === 0) {
      // Domino! Player wins the round
      let roundPoints = 0;
      const playerPips = state.players.map(p => {
        const pips = handTotalPips(p.hand);
        if (p.seat !== playerSeat) {
          roundPoints += pips;
        }
        return { seat: p.seat, name: p.name, pips };
      });

      player.score += roundPoints;
      state.winnerSeat = playerSeat;
      state.roundSummary = {
        reason: 'domino',
        winnerSeat: playerSeat,
        pointsWon: roundPoints,
        playerPips
      };

      if (player.score >= state.targetScore) {
        state.status = 'match_end';
        state.lastAction = `🏆 ${player.name} DOMINO! Won the match with ${player.score} points!`;
      } else {
        state.status = 'round_end';
        state.lastAction = `🎉 ${player.name} DOMINO! Won round with +${roundPoints} points!`;
      }
      return;
    }

    // Check if chain is blocked after this play
    this.advanceTurn(state);
  }

  private handleBlockedGame(state: GameState): void {
    let lowestPips = 999;
    let winnerSeat = 0;
    let isTie = false;

    const playerPips = state.players.map(p => {
      const pips = handTotalPips(p.hand);
      if (pips < lowestPips) {
        lowestPips = pips;
        winnerSeat = p.seat;
        isTie = false;
      } else if (pips === lowestPips) {
        isTie = true;
      }
      return { seat: p.seat, name: p.name, pips };
    });

    if (isTie) {
      // Tie: no points awarded
      state.status = 'round_end';
      state.winnerSeat = winnerSeat;
      state.roundSummary = {
        reason: 'blocked',
        winnerSeat,
        pointsWon: 0,
        playerPips
      };
      state.lastAction = `Round blocked! Tie with ${lowestPips} pips. No points awarded.`;
      return;
    }

    const winner = state.players[winnerSeat];
    let pointsWon = 0;
    for (const p of state.players) {
      if (p.seat !== winnerSeat) {
        pointsWon += handTotalPips(p.hand);
      }
    }
    // Standard block rule: winner gets opponent pips minus winner's own pips
    pointsWon = Math.max(0, pointsWon - lowestPips);
    winner.score += pointsWon;

    state.winnerSeat = winnerSeat;
    state.roundSummary = {
      reason: 'blocked',
      winnerSeat,
      pointsWon,
      playerPips
    };

    if (winner.score >= state.targetScore) {
      state.status = 'match_end';
      state.lastAction = `🏆 Blocked! ${winner.name} wins the match with ${winner.score} points!`;
    } else {
      state.status = 'round_end';
      state.lastAction = `Round blocked! ${winner.name} had lowest pips (${lowestPips}) and won +${pointsWon} points!`;
    }
  }

  private advanceTurn(state: GameState): void {
    state.firstTurnOfRound = false;
    state.currentTurn = (state.currentTurn + 1) % state.players.length;
  }
}
