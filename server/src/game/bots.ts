// Phase 11: bot decision logic — one heuristic per phase. Pure functions over
// the (full, unfiltered) GameState; the bot driver in the socket layer calls
// these and feeds the result into the normal RoomManager actions, so bots play
// by exactly the same rules as humans.
//
// Style: a cautious "medium" bot — keep low trumps, knock on real strength,
// keep trumps/high cards, win tricks cheaply and save high cards.

import { rankValue, cardsEqual, isFaceRank, type Card } from "./cards.js";
import { type GameState, getPlayer } from "./state.js";
import { legalPlays, trickWinner } from "./tricks.js";

/** Dealer keep/pass. Blind to their hand, so decide from the trump card alone. */
export function botTrumpDecision(state: GameState): boolean {
  const t = state.trumpCard;
  if (!t) return false;
  // Keep low trumps (only need 1 trick); pass face trumps (need 2 -> risky).
  return !isFaceRank(t.rank);
}

/** Knock in or pass. */
export function botKnockDecision(state: GameState, playerId: string): boolean {
  const p = getPlayer(state, playerId)!;
  // The dealer is still blind here and acts last with the discard advantage.
  if (playerId === state.dealerId) return true;
  const trumps = p.hand.filter((c) => c.suit === state.trumpSuit).length;
  const highCards = p.hand.filter((c) => c.rank === "A" || c.rank === "K").length;
  return trumps >= 1 || highCards >= 2;
}

/** Which card indices to discard (handles the kept-trump dealer's trim step). */
export function botDiscardDecision(state: GameState, playerId: string): number[] {
  const p = getPlayer(state, playerId)!;
  const hand = p.hand;
  const keptTrumpDealer = playerId === state.dealerId && state.dealerKeptTrump;
  const isProtectedTrump = (c: Card) =>
    keptTrumpDealer && state.trumpCard ? cardsEqual(c, state.trumpCard) : false;

  // Final trim: drop the lowest non-trump card(s) to get back to 3.
  if (keptTrumpDealer && state.dealerTrimPending) {
    const need = hand.length - 3;
    return hand
      .map((c, i) => ({ c, i }))
      .filter((x) => !isProtectedTrump(x.c))
      .sort((a, b) => rankValue(a.c.rank) - rankValue(b.c.rank))
      .slice(0, need)
      .map((x) => x.i);
  }

  // Keep trumps and high cards (A/K); discard everything else to draw better.
  const worthKeeping = (c: Card) =>
    c.suit === state.trumpSuit || c.rank === "A" || c.rank === "K";
  return hand
    .map((c, i) => ({ c, i }))
    .filter((x) => !worthKeeping(x.c) && !isProtectedTrump(x.c))
    .map((x) => x.i);
}

/** Which card index to play during a trick. */
export function botPlayDecision(state: GameState, playerId: string): number {
  const p = getPlayer(state, playerId)!;
  const hand = p.hand;
  const trump = state.trumpSuit!;
  const legal = legalPlays(state, playerId);

  const highest = (idxs: number[]) =>
    idxs.reduce((b, i) => (rankValue(hand[i].rank) > rankValue(hand[b].rank) ? i : b), idxs[0]);
  const lowest = (idxs: number[]) =>
    idxs.reduce((b, i) => (rankValue(hand[i].rank) < rankValue(hand[b].rank) ? i : b), idxs[0]);

  // Leading: enforce ace-of-trump lead rule on the first trick of each hand.
  // If this is the first trick and the player immediately left of the dealer is
  // leading and holds the Ace of Trump, they must play it.
  if (state.currentTrick.length === 0) {
    if (state.trickNumber === 0) {
      // Find the player immediately left of the dealer (first leader).
      const dealerIdx = state.players.findIndex((p) => p.id === state.dealerId);
      const firstLeaderIdx = (dealerIdx + 1) % state.players.length;
      const firstLeader = state.players[firstLeaderIdx];

      // If this is the first leader and they hold the Ace of Trump, force it.
      if (playerId === firstLeader.id) {
        const aceOfTrumpIdx = hand.findIndex(
          (c) => c.rank === "A" && c.suit === trump,
        );
        if (aceOfTrumpIdx !== -1 && legal.includes(aceOfTrumpIdx)) {
          return aceOfTrumpIdx;
        }
      }
    }

    // Standard lead: play the highest non-trump if possible (save trump), else highest.
    const nonTrump = legal.filter((i) => hand[i].suit !== trump);
    return highest(nonTrump.length ? nonTrump : legal);
  }

  // Following: play the cheapest card that wins the trick; otherwise dump low.
  const winning = legal.filter(
    (i) =>
      trickWinner(
        [...state.currentTrick, { playerId, card: hand[i] }],
        trump,
        state.leadSuit!,
      ) === playerId,
  );
  return winning.length ? lowest(winning) : lowest(legal);
}
