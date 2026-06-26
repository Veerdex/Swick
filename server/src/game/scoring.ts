// Phase 9: end-of-hand scoring — pay the trick winners and apply set penalties.
//
// Called once the third trick resolves. Each trick is worth 1/3 of the pot, so
// trick winners are paid pot/3 per trick. Then "going set" is settled:
//   - an ordinary knocked-in player who won 0 tricks -> set single (match pot);
//   - the dealer who kept a LOW trump (7-10) and won 0 tricks -> set single;
//   - the dealer who kept a FACE trump (J/Q/K/A) and won < 2 tricks -> set
//     double (their knock-in to play WAS the commitment to win two);
//   - the dealer who kept the trump but passed in knock-in -> set single.
// Each set player pays their penalty into nextRoundPotBonus, which seeds the
// next pot (a "free ride" hand — see startHand). Penalties are multiples of 3,
// so the carried pot stays divisible by 3.

import { type GameState, assertPotValid } from "./state.js";
import { dealerKeptFaceTrump } from "./dealing.js";

type SetKind = "single" | "double" | null;

/** Decide whether a player goes set, and how, given the finished hand. */
function setOutcome(state: GameState, playerId: string): SetKind {
  const player = state.players.find((p) => p.id === playerId)!;
  const isDealer = playerId === state.dealerId;

  if (isDealer && state.dealerKeptTrump) {
    if (!player.knockedIn) return "single"; // kept trump, then passed
    if (dealerKeptFaceTrump(state)) return player.tricksWon < 2 ? "double" : null;
    return player.tricksWon === 0 ? "single" : null; // kept low trump
  }

  // Ordinary knocked-in player must win at least one trick.
  if (player.knockedIn) return player.tricksWon === 0 ? "single" : null;

  return null; // folded/passed players have no obligation
}

/** Settle the hand: distribute the pot and carry set penalties forward. */
export function resolveHand(state: GameState): void {
  const pot = state.potValue;
  const share = pot / 3; // pot is always divisible by 3

  // 1. Pay each trick winner pot/3 per trick won.
  for (const p of state.players) {
    if (p.tricksWon > 0) p.money += p.tricksWon * share;
  }

  // 2. Apply set penalties; each carries into the next hand's pot.
  for (const p of state.players) {
    const kind = setOutcome(state, p.id);
    if (!kind) continue;
    const amount = kind === "double" ? pot * 2 : pot;
    p.wentSet = true;
    p.setType = kind;
    p.setAmount = amount;
    p.money -= amount;
    state.nextRoundPotBonus += amount;
  }

  assertPotValid(state.nextRoundPotBonus);

  state.roundState = "end";
  state.currentTurnPlayerId = null;
  state.currentTrick = [];
  state.leadSuit = null;
}

/** Identify bot players who have gone broke (balance < 0). */
export function getBrokeBots(state: GameState): string[] {
  return state.players
    .filter((p) => p.isBot && p.money < 0)
    .map((p) => p.id);
}
