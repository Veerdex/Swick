// Phase 6: the knock-in phase.
//
// Going clockwise from the dealer's left (dealer decides LAST), each player
// knocks in (commits to the hand) or passes (folds, losing their ante). Two
// special outcomes:
//   - If every non-dealer passes, the dealer wins the pot automatically.
//   - If the dealer KEPT the trump and then passes, the dealer goes set single
//     immediately; the remaining knocked-in players still play for the pot.
//
// On normal completion the hand advances to discard-draw. Functions mutate the
// GameState in place.

import { type GameState, getPlayer } from "./state.js";
import { clockwiseFromDealerLeft } from "./dealing.js";

/** Knock order: dealer's left first, dealer last. */
function knockOrder(state: GameState) {
  const dealerIndex = state.players.findIndex((p) => p.id === state.dealerId);
  return clockwiseFromDealerLeft(state.players.length, dealerIndex).map(
    (i) => state.players[i],
  );
}

/**
 * Move into the discard-draw phase, pointing at the first knocked-in player to
 * the dealer's left. (The discard actions themselves arrive in Phase 7.)
 */
export function beginDiscardDraw(state: GameState): void {
  const firstKnocked = knockOrder(state).find((p) => p.knockedIn);
  state.roundState = "discard-draw";
  state.currentKnockPlayerId = null;
  state.currentTurnPlayerId = null;
  state.currentDiscardPlayerId = firstKnocked ? firstKnocked.id : null;
}

/** Everyone but the dealer passed: the dealer takes the pot, hand ends. */
function awardPotToDealer(state: GameState): void {
  const dealer = state.dealerId ? getPlayer(state, state.dealerId) : undefined;
  if (dealer) dealer.money += state.potValue;
  state.roundState = "end";
  state.currentKnockPlayerId = null;
  state.currentTurnPlayerId = null;
  state.currentDiscardPlayerId = null;
}

/** Resolve the dealer's own (final) knock decision. */
function resolveDealerDecision(state: GameState): void {
  const dealer = getPlayer(state, state.dealerId!)!;
  if (!dealer.knockedIn && state.dealerKeptTrump) {
    // Kept the trump then bailed -> immediate set single. The remaining
    // knocked-in players still play; the penalty amount is finalized at end.
    dealer.wentSet = true;
    dealer.setType = "single";
  }
  beginDiscardDraw(state);
}

/**
 * Complete the knock-in phase after its brief end-of-phase pause. Knock-in
 * stays in place (currentKnockPlayerId === null) once everyone has decided, so
 * the last decision is visible for a moment; this then actually advances —
 * either the dealer auto-wins (all non-dealers passed) or we move to
 * discard-draw (resolving the dealer's own decision along the way).
 */
export function finishKnockIn(state: GameState): void {
  if (state.roundState !== "knock-in" || state.currentKnockPlayerId !== null) {
    throw new Error("Knock-in is not awaiting completion");
  }
  const dealer = getPlayer(state, state.dealerId!)!;
  if (dealer.hasKnockDecision) {
    resolveDealerDecision(state);
  } else {
    // The dealer never had to act — every non-dealer passed.
    awardPotToDealer(state);
  }
}

/**
 * Apply a player's knock/pass decision. Validates turn order and the
 * hasKnockDecision gate, then either advances the turn, ends the hand
 * (dealer auto-win), or resolves the dealer's decision into discard-draw.
 */
export function applyKnock(
  state: GameState,
  playerId: string,
  knock: boolean,
): void {
  if (state.roundState !== "knock-in") throw new Error("Not in knock-in");
  if (state.currentKnockPlayerId !== playerId) {
    throw new Error("It isn't your turn to knock");
  }
  const player = getPlayer(state, playerId);
  if (!player) throw new Error("No such player");
  if (player.hasKnockDecision) throw new Error("You've already decided");

  player.hasKnockDecision = true;
  player.knockedIn = knock;

  const dealerId = state.dealerId!;
  const nonDealers = state.players.filter((p) => p.id !== dealerId);
  const allNonDealersDecided = nonDealers.every((p) => p.hasKnockDecision);
  const anyNonDealerKnocked = nonDealers.some((p) => p.knockedIn);
  const dealerJustDecided = playerId === dealerId;

  // Terminal: the dealer just decided (last to act), or every non-dealer passed
  // (dealer auto-win). Don't advance yet — clear the turn pointer and stay in
  // knock-in so the last decision shows; the socket layer pauses ~2s, then
  // finishKnockIn() advances the hand.
  const allPassed = allNonDealersDecided && !anyNonDealerKnocked;
  if (dealerJustDecided || allPassed) {
    state.currentKnockPlayerId = null;
    return;
  }

  // Advance to the next undecided player in clockwise order (dealer is last).
  const next = knockOrder(state).find((p) => !p.hasKnockDecision);
  state.currentKnockPlayerId = next ? next.id : null;
}
