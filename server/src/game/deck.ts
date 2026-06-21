// Deck operations for SWICK: build, shuffle, deal, and draw.
//
// All functions are PURE — they never mutate their inputs. Shuffling, dealing,
// and drawing each return new arrays. This keeps the deck testable in isolation
// and makes "no duplicate card ever appears" easy to reason about and assert.

import { randomInt } from "node:crypto";
import { SUITS, RANKS, type Card } from "./cards.js";

/** The number of cards in a complete SWICK deck (8 ranks x 4 suits). */
export const DECK_SIZE = SUITS.length * RANKS.length; // 32

/** Build a fresh, ordered 32-card deck. */
export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ suit, rank });
    }
  }
  return deck;
}

/**
 * Return a new, shuffled copy of the given cards using a Fisher-Yates shuffle
 * backed by crypto.randomInt for unbiased, unpredictable ordering.
 */
export function shuffle(cards: Card[]): Card[] {
  const out = [...cards];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(i + 1); // 0..i inclusive
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Convenience: a freshly created deck, shuffled. */
export function createShuffledDeck(): Card[] {
  return shuffle(createDeck());
}

export interface DealResult {
  /** One hand per player, in player order. */
  hands: Card[][];
  /** The cards left in the deck after dealing. */
  remaining: Card[];
}

/**
 * Deal `cardsPerPlayer` cards to `numPlayers`, one card at a time going around
 * the table (the way cards are actually dealt), drawing from the top of the deck.
 *
 * Throws if the deck doesn't have enough cards to complete the deal.
 */
export function deal(
  deck: Card[],
  numPlayers: number,
  cardsPerPlayer: number,
): DealResult {
  if (numPlayers <= 0) throw new Error("numPlayers must be positive");
  if (cardsPerPlayer < 0) throw new Error("cardsPerPlayer cannot be negative");

  const needed = numPlayers * cardsPerPlayer;
  if (needed > deck.length) {
    throw new Error(
      `Not enough cards to deal: need ${needed}, deck has ${deck.length}`,
    );
  }

  const hands: Card[][] = Array.from({ length: numPlayers }, () => []);
  const remaining = [...deck];

  // One card at a time, around the table, taking from the top of the deck.
  for (let round = 0; round < cardsPerPlayer; round++) {
    for (let p = 0; p < numPlayers; p++) {
      hands[p].push(remaining.shift()!);
    }
  }

  return { hands, remaining };
}

export interface DrawResult {
  /** The cards drawn from the top of the deck. */
  drawn: Card[];
  /** The cards left in the deck after drawing. */
  remaining: Card[];
}

/**
 * Draw `count` cards from the top of the deck (used for discard/draw and for
 * flipping the trump card with count = 1).
 *
 * Throws if the deck doesn't have enough cards.
 */
export function draw(deck: Card[], count: number): DrawResult {
  if (count < 0) throw new Error("count cannot be negative");
  if (count > deck.length) {
    throw new Error(`Cannot draw ${count}: deck has ${deck.length}`);
  }
  return {
    drawn: deck.slice(0, count),
    remaining: deck.slice(count),
  };
}
