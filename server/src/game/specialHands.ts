// Phase 10: special hands. Checked once, after discard-draw and before any
// trick is played. A knocked-in player holding one of these wins the entire pot
// immediately and no tricks are played:
//
//   1. Three Aces        (best)
//   2. Three Sevens      (beats A-K-Q of trump)
//   3. A-K-Q of Trump
//
// Since a special hand ends the hand before any trick, nobody goes set — it's a
// clean pot transfer to the winner (an interpretation: the rules don't spell
// out set penalties when no tricks are contested).

import type { Card, Suit } from "./cards.js";
import { type GameState, getPlayer } from "./state.js";

export type SpecialHand = "three-aces" | "three-sevens" | "akq-trump";

/** Lower number = stronger. Three Aces beats Three Sevens beats A-K-Q trump. */
const PRIORITY: Record<SpecialHand, number> = {
  "three-aces": 1,
  "three-sevens": 2,
  "akq-trump": 3,
};

/** Identify a special hand in a final 3-card hand, or null. */
export function detectSpecialHand(
  hand: Card[],
  trumpSuit: Suit | null,
): SpecialHand | null {
  if (hand.length !== 3) return null;

  if (hand.every((c) => c.rank === "A")) return "three-aces";
  if (hand.every((c) => c.rank === "7")) return "three-sevens";

  if (trumpSuit && hand.every((c) => c.suit === trumpSuit)) {
    const ranks = new Set(hand.map((c) => c.rank));
    if (ranks.has("A") && ranks.has("K") && ranks.has("Q")) return "akq-trump";
  }
  return null;
}

/** The best special hand among knocked-in players, or null if none. */
export function findSpecialHandWinner(
  state: GameState,
): { playerId: string; hand: SpecialHand } | null {
  let best: { playerId: string; hand: SpecialHand } | null = null;
  for (const p of state.players) {
    if (!p.knockedIn) continue;
    const hand = detectSpecialHand(p.hand, state.trumpSuit);
    if (hand && (!best || PRIORITY[hand] < PRIORITY[best.hand])) {
      best = { playerId: p.id, hand };
    }
  }
  return best;
}

/** Award the whole pot to the special-hand winner and end the hand. */
export function resolveSpecialHand(
  state: GameState,
  winnerId: string,
  hand: SpecialHand,
): void {
  const winner = getPlayer(state, winnerId);
  if (winner) winner.money += state.potValue;
  state.specialHandWinner = winnerId;
  state.specialHandType = hand;
  state.roundState = "end";
  state.currentTurnPlayerId = null;
  state.currentDiscardPlayerId = null;
  state.currentTrick = [];
  state.leadSuit = null;
}
