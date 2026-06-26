// Phase 7: the discard & draw phase.
//
// Going clockwise from the dealer's left, each knocked-in player may discard
// 0-3 cards and draw replacements. The dealer goes LAST and only now sees their
// cards (dealerHandRevealed flips on). Rules enforced here:
//   - the kept trump card can never be discarded;
//   - a kept-trump dealer holds 4 cards and must shed exactly one (the faithful
//     two-step: discard/draw, then a final non-trump discard down to 3);
//   - when the draw stock runs low it is refilled by reshuffling the discards,
//     so a full 6-player table never runs out.
//
// When every knocked-in player has finished, the hand moves to trick-taking.

import { type Card, cardsEqual } from "./cards.js";
import { shuffle } from "./deck.js";
import { type GameState, getPlayer, type PlayerState } from "./state.js";
import { clockwiseFromDealerLeft } from "./dealing.js";
import { findSpecialHandWinner, resolveSpecialHand } from "./specialHands.js";

/** Knocked-in players in discard order: dealer's left first, dealer last. */
function discardOrder(state: GameState): PlayerState[] {
  const dealerIndex = state.players.findIndex((p) => p.id === state.dealerId);
  return clockwiseFromDealerLeft(state.players.length, dealerIndex)
    .map((i) => state.players[i])
    .filter((p) => p.knockedIn);
}

/** Draw `count` cards, reshuffling the discard pile into the stock if needed. */
function drawCards(state: GameState, count: number): Card[] {
  const drawn: Card[] = [];
  for (let i = 0; i < count; i++) {
    if (state.deck.length === 0) {
      if (state.discardPile.length === 0) break; // truly out (shouldn't happen)
      state.deck = shuffle(state.discardPile);
      state.discardPile = [];
    }
    drawn.push(state.deck.shift()!);
  }
  return drawn;
}

/** Remove the given hand indices (descending splice) and return the cards. */
function removeFromHand(player: PlayerState, indices: number[]): Card[] {
  const removed: Card[] = [];
  for (const idx of [...indices].sort((a, b) => b - a)) {
    removed.push(player.hand.splice(idx, 1)[0]);
  }
  return removed;
}

/**
 * Once everyone has discarded, check for a special hand (3 Aces / 3 Sevens /
 * A-K-Q of trump). If one exists the holder wins the pot instantly and no
 * tricks are played. Also check if only one player knocked in: if so, award
 * them all 3 tricks and end the hand (no trick-taking needed since the outcome
 * is already determined). Otherwise trick-taking begins.
 */
export function beginTurns(state: GameState): void {
  const special = findSpecialHandWinner(state);
  if (special) {
    resolveSpecialHand(state, special.playerId, special.hand);
    return;
  }

  // Only one player knocked in: they automatically win all 3 tricks.
  const knockedIn = discardOrder(state);
  if (knockedIn.length === 1) {
    knockedIn[0].tricksWon = 3;
    state.roundState = "end";
    state.currentDiscardPlayerId = null;
    return;
  }

  state.roundState = "turns";
  state.trickNumber = 0;
  state.currentTrick = [];
  state.leadSuit = null;
  state.currentDiscardPlayerId = null;
  const first = knockedIn[0];
  state.currentTurnPlayerId = first ? first.id : null;
}

/** Advance to the next player who still owes a discard, else start the tricks. */
function advanceDiscard(state: GameState): void {
  const next = discardOrder(state).find((p) => !p.hasDiscardDecision);
  if (!next) {
    beginTurns(state);
    return;
  }
  state.currentDiscardPlayerId = next.id;
  // The dealer is blind until their discard turn begins.
  if (next.id === state.dealerId) state.dealerHandRevealed = true;
}

/**
 * Apply a player's discard selection (the indices of cards to discard).
 * For a normal hand: discard those, draw the same number.
 * For a kept-trump dealer's first action: discard/draw, then they still owe a
 * final trim (handled by a second call while dealerTrimPending is true).
 */
export function applyDiscard(
  state: GameState,
  playerId: string,
  discardIndices: number[],
): void {
  if (state.roundState !== "discard-draw") throw new Error("Not in discard-draw");
  if (state.currentDiscardPlayerId !== playerId) {
    throw new Error("It isn't your turn to discard");
  }
  const player = getPlayer(state, playerId);
  if (!player) throw new Error("No such player");
  if (!player.knockedIn) throw new Error("You aren't in this hand");
  if (player.hasDiscardDecision) throw new Error("You've already discarded");

  // Validate indices: unique and in range.
  const indices = [...new Set(discardIndices)];
  for (const idx of indices) {
    if (!Number.isInteger(idx) || idx < 0 || idx >= player.hand.length) {
      throw new Error("Invalid card index");
    }
  }

  const keptTrump = playerId === state.dealerId && state.dealerKeptTrump;
  if (keptTrump && state.trumpCard) {
    for (const idx of indices) {
      if (cardsEqual(player.hand[idx], state.trumpCard)) {
        throw new Error("The trump card cannot be discarded");
      }
    }
  }

  const nextSeq = (state.lastDiscard?.seq ?? 0) + 1;

  // Final trim step for a kept-trump dealer (no draw, must land on exactly 3).
  if (keptTrump && state.dealerTrimPending) {
    const needed = player.hand.length - 3;
    if (indices.length !== needed) {
      throw new Error(`Discard exactly ${needed} card(s) to get back to 3`);
    }
    state.discardPile.push(...removeFromHand(player, indices));
    state.dealerTrimPending = false;
    state.lastDiscard = { playerId, out: indices.length, in: 0, seq: nextSeq };
    player.hasDiscardDecision = true;
    advanceDiscard(state);
    return;
  }

  // Normal discard-draw: draw replacements BEFORE the discards rejoin the pile
  // so a player can never immediately redraw a card they just discarded.
  const removed = removeFromHand(player, indices);
  const drawn = drawCards(state, removed.length);
  player.hand.push(...drawn);
  state.discardPile.push(...removed);
  state.lastDiscard = {
    playerId,
    out: removed.length,
    in: drawn.length,
    seq: nextSeq,
  };

  // A kept-trump dealer is now at 4 cards and still owes a final discard.
  if (keptTrump && player.hand.length > 3) {
    state.dealerTrimPending = true;
    return; // stay on the dealer for the trim
  }

  player.hasDiscardDecision = true;
  advanceDiscard(state);
}
