// Phase 8: trick-taking. Three tricks per hand among the knocked-in players.
//
// Play rules (SWICK_RULES.md):
//   - Lead: any card. EXCEPT on the first trick of each hand, if the player
//     immediately left of the dealer holds the Ace of Trump they must lead it.
//   - Follow: must follow the led suit if able, AND must play a higher card of
//     that suit than the current best if they hold one.
//   - Void of the led suit: must play a trump if they hold one (any trump).
//   - Void of both: play anything.
// Winner: highest trump wins; with no trump, the highest card of the led suit.
// The winner leads the next trick. After three tricks the hand ends.
//
// Functions mutate the GameState in place.

import { type Card, rankValue } from "./cards.js";
import { type GameState, getPlayer, type PlayerState } from "./state.js";
import type { PlayedCard } from "./state.js";
import { resolveHand } from "./scoring.js";

/** Knocked-in players in seat order — the ones actually playing tricks. */
function activePlayers(state: GameState): PlayerState[] {
  return state.players.filter((p) => p.knockedIn);
}

/** The next knocked-in player clockwise after the given player. */
function nextActiveAfter(state: GameState, playerId: string): string {
  const n = state.players.length;
  const idx = state.players.findIndex((p) => p.id === playerId);
  for (let k = 1; k <= n; k++) {
    const p = state.players[(idx + k) % n];
    if (p.knockedIn) return p.id;
  }
  return playerId;
}

/** Is this player seated immediately to the dealer's left? */
function isImmediateLeftOfDealer(state: GameState, playerId: string): boolean {
  const dealerIndex = state.players.findIndex((p) => p.isDealer);
  if (dealerIndex < 0) return false;
  const leftIndex = (dealerIndex + 1) % state.players.length;
  return state.players[leftIndex].id === playerId;
}

/**
 * Indices into the player's hand of the cards they may legally play right now.
 * Empty if it isn't a sensible time for them to play.
 */
export function legalPlays(state: GameState, playerId: string): number[] {
  const player = getPlayer(state, playerId);
  if (!player) return [];
  const hand = player.hand;
  const trump = state.trumpSuit;
  const all = hand.map((_, i) => i);

  // Leading the trick.
  if (state.currentTrick.length === 0) {
    // First trick of the hand: the dealer's left must lead the Ace of Trump
    // if they hold it.
    if (
      state.trickNumber === 0 &&
      trump &&
      isImmediateLeftOfDealer(state, playerId)
    ) {
      const aceIdx = hand.findIndex((c) => c.suit === trump && c.rank === "A");
      if (aceIdx >= 0) return [aceIdx];
    }
    return all;
  }

  const leadSuit = state.leadSuit!;
  const leadIdxs = all.filter((i) => hand[i].suit === leadSuit);

  if (leadIdxs.length > 0) {
    // Must follow suit, and must beat the best led-suit card if able.
    const bestLed = Math.max(
      ...state.currentTrick
        .filter((p) => p.card.suit === leadSuit)
        .map((p) => rankValue(p.card.rank)),
    );
    const higher = leadIdxs.filter((i) => rankValue(hand[i].rank) > bestLed);
    return higher.length > 0 ? higher : leadIdxs;
  }

  // Void of the led suit: must play a trump if holding one.
  if (trump) {
    const trumpIdxs = all.filter((i) => hand[i].suit === trump);
    if (trumpIdxs.length > 0) return trumpIdxs;
  }

  // Void of both led suit and trump: play anything.
  return all;
}

/** The player id that wins a completed trick. */
export function trickWinner(
  plays: PlayedCard[],
  trumpSuit: Card["suit"],
  leadSuit: Card["suit"],
): string {
  const best = (cards: PlayedCard[]) =>
    cards.reduce((b, p) =>
      rankValue(p.card.rank) > rankValue(b.card.rank) ? p : b,
    );
  const trumps = plays.filter((p) => p.card.suit === trumpSuit);
  if (trumps.length > 0) return best(trumps).playerId;
  const leads = plays.filter((p) => p.card.suit === leadSuit);
  return best(leads).playerId;
}

/**
 * A trick's third card was just played: award it and PAUSE. The completed
 * trick stays on the table (currentTrick is kept) in roundState
 * "trick-complete" so clients can show all the cards and who won. The pause is
 * ended by finishTrick(), which clears the trick and advances.
 */
function resolveTrick(state: GameState): void {
  const winnerId = trickWinner(
    state.currentTrick,
    state.trumpSuit!,
    state.leadSuit!,
  );
  getPlayer(state, winnerId)!.tricksWon += 1;
  state.trickWinnerId = winnerId;
  state.roundState = "trick-complete";
  state.currentTurnPlayerId = null;
}

/**
 * End the trick-complete pause: the played cards leave play, and we either
 * start the next trick (winner leads) or, after three tricks, settle the hand.
 */
export function finishTrick(state: GameState): void {
  if (state.roundState !== "trick-complete") {
    throw new Error("No completed trick to finish");
  }
  const winnerId = state.trickWinnerId;
  state.discardPile.push(...state.currentTrick.map((p) => p.card));
  state.trickNumber += 1;
  state.currentTrick = [];
  state.leadSuit = null;
  state.trickWinnerId = null;

  if (state.trickNumber >= 3) {
    resolveHand(state); // pay trick winners and settle set penalties
  } else {
    state.roundState = "turns";
    state.currentTurnPlayerId = winnerId; // winner leads the next trick
  }
}

/** Play the card at `cardIndex` from the current player's hand. */
export function playCard(
  state: GameState,
  playerId: string,
  cardIndex: number,
): void {
  if (state.roundState !== "turns") throw new Error("It isn't trick-taking time");
  if (state.currentTurnPlayerId !== playerId) throw new Error("It isn't your turn");
  const player = getPlayer(state, playerId);
  if (!player) throw new Error("No such player");
  if (!player.knockedIn) throw new Error("You aren't in this hand");
  if (!legalPlays(state, playerId).includes(cardIndex)) {
    throw new Error("That card isn't a legal play");
  }

  const [card] = player.hand.splice(cardIndex, 1);
  state.currentTrick.push({ playerId, card });
  if (state.currentTrick.length === 1) state.leadSuit = card.suit;

  if (state.currentTrick.length < activePlayers(state).length) {
    state.currentTurnPlayerId = nextActiveAfter(state, playerId);
    return;
  }
  resolveTrick(state);
}
