// Phase 5: starting a hand and the dealer's trump decision.
//
// This module owns the transition idle -> dealing -> trump-selection -> knock-in:
//   1. determine the dealer (first Ace on the first hand; rotate left after),
//   2. collect antes into the pot (dealer pays a fixed 3¢ extra),
//   3. deal 3 cards to each player starting at the dealer's left,
//   4. flip the trump card,
//   5. let the dealer keep or pass on it.
//
// Functions mutate the GameState in place, matching the rest of the server.

import { type Card, isFaceRank } from "./cards.js";
import { createShuffledDeck } from "./deck.js";
import {
  type GameState,
  assertPotValid,
  getPlayer,
  resetPlayerForHand,
} from "./state.js";

/** The fixed extra the dealer antes, on top of the standard ante (in cents). */
export const DEALER_EXTRA = 3;

/** Cards dealt to each player at the start of a hand. */
export const CARDS_PER_PLAYER = 3;

/**
 * First-dealer ceremony: deal face-up one card at a time around the table; the
 * first player to receive an Ace becomes the dealer. Returns that seat index.
 */
export function determineFirstDealerIndex(
  numPlayers: number,
  ceremonyDeck: Card[],
): number {
  for (let i = 0; i < ceremonyDeck.length; i++) {
    if (ceremonyDeck[i].rank === "A") return i % numPlayers;
  }
  return 0; // unreachable: a real 32-card deck always contains an Ace
}

/** The next dealer rotates left (to the next seat). */
export function nextDealerIndex(
  numPlayers: number,
  currentDealerIndex: number,
): number {
  return (currentDealerIndex + 1) % numPlayers;
}

/** Seat order for dealing/turns: start at the dealer's left, go clockwise. */
export function clockwiseFromDealerLeft(
  numPlayers: number,
  dealerIndex: number,
): number[] {
  return Array.from(
    { length: numPlayers },
    (_, k) => (dealerIndex + 1 + k) % numPlayers,
  );
}

/**
 * Begin a new hand. Assumes state.players is set (3-6) and the ante is set.
 * Leaves the game in trump-selection with the dealer to act.
 */
export function startHand(state: GameState): void {
  const players = state.players;
  const n = players.length;
  if (n < 3) throw new Error("Need at least 3 players to start a hand");

  for (const p of players) resetPlayerForHand(p);

  // 1. Dealer: first Ace on the very first hand, otherwise rotate left.
  let dealerIndex: number;
  if (state.dealerId === null) {
    dealerIndex = determineFirstDealerIndex(n, createShuffledDeck());
  } else {
    const prev = players.findIndex((p) => p.id === state.dealerId);
    dealerIndex = nextDealerIndex(n, prev < 0 ? n - 1 : prev);
  }
  const dealer = players[dealerIndex];
  dealer.isDealer = true;
  state.dealerId = dealer.id;

  // 2. Antes -> pot. Each player pays the ante; the dealer pays 3¢ extra.
  // Carried set penalties (nextRoundPotBonus) seed the pot, then reset.
  let pot = state.nextRoundPotBonus;
  for (const p of players) {
    p.money -= state.anteAmount;
    pot += state.anteAmount;
  }
  dealer.money -= DEALER_EXTRA;
  pot += DEALER_EXTRA;
  state.potValue = pot;
  state.nextRoundPotBonus = 0;
  assertPotValid(state.potValue);

  // 3. Deal 3 cards each, one at a time, starting at the dealer's left.
  const deck = createShuffledDeck();
  let next = 0;
  const order = clockwiseFromDealerLeft(n, dealerIndex);
  for (let round = 0; round < CARDS_PER_PLAYER; round++) {
    for (const seat of order) {
      players[seat].hand.push(deck[next++]);
    }
  }

  // 4. Flip the trump card; the rest is the draw stock.
  const trumpCard = deck[next++];
  state.trumpCard = trumpCard;
  state.trumpSuit = trumpCard.suit;
  state.deck = deck.slice(next);

  // Reset trump/turn state for the new hand.
  state.dealerKeptTrump = false;
  state.dealerTrumpValue = null;
  state.dealerHandRevealed = false;
  state.specialHandWinner = null;
  state.trickNumber = 0;
  state.currentTrick = [];
  state.leadSuit = null;

  // 5. Dealer decides keep/pass next.
  state.roundState = "trump-selection";
  state.currentTurnPlayerId = dealer.id;
  state.currentKnockPlayerId = null;
  state.currentDiscardPlayerId = null;
}

/**
 * The dealer keeps or passes on the flipped trump card.
 *   keep  -> trump joins the dealer's hand (4 cards) and can never be discarded.
 *   pass  -> trump stays on the table, out of play; dealer keeps 3 cards.
 * Either way the trump suit is already public. Advances to knock-in.
 */
export function dealerTrumpDecision(state: GameState, keep: boolean): void {
  if (state.roundState !== "trump-selection") {
    throw new Error("Not in trump-selection");
  }
  const dealer = state.dealerId ? getPlayer(state, state.dealerId) : undefined;
  if (!dealer || !state.trumpCard) throw new Error("No dealer or trump card");

  if (keep) {
    dealer.hand.push(state.trumpCard);
    state.dealerKeptTrump = true;
    state.dealerTrumpValue = state.trumpCard.rank;
  } else {
    state.dealerKeptTrump = false;
    state.dealerTrumpValue = null;
  }

  // Knock-in begins with the player to the dealer's left.
  const dealerIndex = state.players.findIndex((p) => p.id === dealer.id);
  const order = clockwiseFromDealerLeft(state.players.length, dealerIndex);
  state.roundState = "knock-in";
  state.currentTurnPlayerId = null;
  state.currentKnockPlayerId = state.players[order[0]].id;
}

/** True if the dealer kept a face-card trump (J/Q/K/A) — raises the stakes. */
export function dealerKeptFaceTrump(state: GameState): boolean {
  return (
    state.dealerKeptTrump &&
    state.dealerTrumpValue !== null &&
    isFaceRank(state.dealerTrumpValue)
  );
}
