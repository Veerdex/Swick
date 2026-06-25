import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createGameState,
  createPlayer,
  STARTING_MONEY,
  type GameState,
} from "./state.js";
import { clockwiseFromDealerLeft } from "./dealing.js";
import { applyKnock, finishKnockIn } from "./knockIn.js";

/** Build a deterministic knock-in state with a chosen dealer. */
function knockState(
  n: number,
  dealerIndex: number,
  opts: { keptTrump?: boolean; pot?: number } = {},
): GameState {
  const players = Array.from({ length: n }, (_, i) =>
    createPlayer(`p${i}`, `P${i}`),
  );
  const s = createGameState(players);
  s.roundState = "knock-in";
  s.dealerId = players[dealerIndex].id;
  players[dealerIndex].isDealer = true;
  s.potValue = opts.pot ?? 12;
  s.dealerKeptTrump = opts.keptTrump ?? false;
  for (const p of players) p.hand = [{ suit: "spades", rank: "7" }]; // dummy
  const order = clockwiseFromDealerLeft(n, dealerIndex);
  s.currentKnockPlayerId = players[order[0]].id;
  return s;
}

/** The seat ids in knock order (dealer's left first, dealer last). */
function order(s: GameState): string[] {
  const di = s.players.findIndex((p) => p.isDealer);
  return clockwiseFromDealerLeft(s.players.length, di).map(
    (i) => s.players[i].id,
  );
}

test("knock-in goes clockwise from the dealer's left, dealer last", () => {
  const s = knockState(4, 0); // dealer is p0; order p1,p2,p3,p0
  const ids = order(s);
  assert.equal(s.currentKnockPlayerId, ids[0]);

  applyKnock(s, ids[0], true);
  assert.equal(s.currentKnockPlayerId, ids[1]);
  applyKnock(s, ids[1], true);
  assert.equal(s.currentKnockPlayerId, ids[2]);
  applyKnock(s, ids[2], true);
  // Now it's the dealer's turn (last).
  assert.equal(s.currentKnockPlayerId, ids[3]);
  assert.equal(ids[3], s.dealerId);
});

test("records knock/pass and gates with hasKnockDecision", () => {
  const s = knockState(4, 0);
  const ids = order(s);
  applyKnock(s, ids[0], false);
  const p = s.players.find((x) => x.id === ids[0])!;
  assert.equal(p.knockedIn, false);
  assert.equal(p.hasKnockDecision, true);
  // Can't decide twice.
  assert.throws(() => applyKnock(s, ids[0], true));
});

test("rejects out-of-turn and wrong-phase knocks", () => {
  const s = knockState(4, 0);
  const ids = order(s);
  assert.throws(() => applyKnock(s, ids[2], true), /your turn/);
  s.roundState = "idle";
  assert.throws(() => applyKnock(s, ids[0], true), /knock-in/);
});

test("all non-dealers pass: dealer auto-wins the pot and the hand ends", () => {
  const s = knockState(4, 0, { pot: 12 });
  const ids = order(s); // p1,p2,p3 then dealer p0
  const dealer = s.players.find((p) => p.isDealer)!;

  applyKnock(s, ids[0], false);
  applyKnock(s, ids[1], false);
  applyKnock(s, ids[2], false); // last non-dealer passes -> auto-win
  // Knock-in holds for its end-of-phase pause; finishKnockIn advances it.
  assert.equal(s.roundState, "knock-in");
  assert.equal(s.currentKnockPlayerId, null);
  finishKnockIn(s);

  assert.equal(s.roundState, "end");
  assert.equal(dealer.money, STARTING_MONEY + 12);
  assert.equal(s.currentKnockPlayerId, null);
  // Dealer never had to act.
  assert.equal(dealer.hasKnockDecision, false);
});

test("dealer knocks in: advances to discard-draw, first discard at dealer's left", () => {
  const s = knockState(4, 0);
  const ids = order(s);
  applyKnock(s, ids[0], true);
  applyKnock(s, ids[1], false);
  applyKnock(s, ids[2], true);
  applyKnock(s, ids[3], true); // dealer knocks
  finishKnockIn(s);

  assert.equal(s.roundState, "discard-draw");
  assert.equal(s.currentKnockPlayerId, null);
  // First discard is the first knocked-in player from the dealer's left.
  assert.equal(s.currentDiscardPlayerId, ids[0]);
});

test("dealer who kept trump then passes goes set single; others still play", () => {
  const s = knockState(4, 0, { keptTrump: true });
  const ids = order(s);
  applyKnock(s, ids[0], true); // a non-dealer knocks in
  applyKnock(s, ids[1], false);
  applyKnock(s, ids[2], false);
  applyKnock(s, ids[3], false); // dealer passes after keeping trump
  finishKnockIn(s);

  const dealer = s.players.find((p) => p.isDealer)!;
  assert.equal(dealer.wentSet, true);
  assert.equal(dealer.setType, "single");
  assert.equal(s.roundState, "discard-draw");
  assert.equal(s.currentDiscardPlayerId, ids[0]); // remaining player plays
});

test("dealer who did NOT keep trump can pass without going set", () => {
  const s = knockState(4, 0, { keptTrump: false });
  const ids = order(s);
  applyKnock(s, ids[0], true);
  applyKnock(s, ids[1], true);
  applyKnock(s, ids[2], false);
  applyKnock(s, ids[3], false); // dealer passes, no trump kept
  finishKnockIn(s);

  const dealer = s.players.find((p) => p.isDealer)!;
  assert.equal(dealer.wentSet, false);
  assert.equal(dealer.setType, null);
  assert.equal(s.roundState, "discard-draw");
});

test("auto-win fires only when ALL non-dealers pass (one knock keeps it alive)", () => {
  const s = knockState(5, 2);
  const ids = order(s); // 4 non-dealers then dealer
  applyKnock(s, ids[0], false);
  applyKnock(s, ids[1], true); // one knocks in
  applyKnock(s, ids[2], false);
  applyKnock(s, ids[3], false); // all non-dealers decided, one knocked
  // Should reach the dealer, not auto-win.
  assert.equal(s.roundState, "knock-in");
  assert.equal(s.currentKnockPlayerId, s.dealerId);
});
