// The SWICK card model.
//
// SWICK uses a 32-card deck: 7, 8, 9, 10, J, Q, K, A in all four suits.
// No 2-6, no Jokers. Rank order high -> low is A K Q J 10 9 8 7.

export const SUITS = ["spades", "hearts", "diamonds", "clubs"] as const;
export type Suit = (typeof SUITS)[number];

// Ordered LOW -> HIGH so the array index doubles as the rank's strength.
export const RANKS = ["7", "8", "9", "10", "J", "Q", "K", "A"] as const;
export type Rank = (typeof RANKS)[number];

export interface Card {
  suit: Suit;
  rank: Rank;
}

const SUIT_SYMBOLS: Record<Suit, string> = {
  spades: "♠",
  hearts: "♥",
  diamonds: "♦",
  clubs: "♣",
};

/**
 * Strength of a rank for comparing cards of the same suit.
 * Higher number = stronger card. A is highest, 7 is lowest.
 */
export function rankValue(rank: Rank): number {
  return RANKS.indexOf(rank);
}

/** A stable unique key for a card, e.g. "A-hearts". Useful for duplicate checks. */
export function cardId(card: Card): string {
  return `${card.rank}-${card.suit}`;
}

/** Human-readable label, e.g. "A♥". Used in logs and the UI. */
export function cardLabel(card: Card): string {
  return `${card.rank}${SUIT_SYMBOLS[card.suit]}`;
}

/** True if two cards are the same rank and suit. */
export function cardsEqual(a: Card, b: Card): boolean {
  return a.rank === b.rank && a.suit === b.suit;
}

/** Face cards (J, Q, K, A) — matters for the dealer's kept-trump rule. */
export function isFaceRank(rank: Rank): boolean {
  return rank === "J" || rank === "Q" || rank === "K" || rank === "A";
}
