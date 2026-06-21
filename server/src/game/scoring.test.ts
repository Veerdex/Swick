import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createGameState,
  createPlayer,
  isPotDivisible,
  type GameState,
} from "./state.js";
import { DEALER_EXTRA, startHand } from "./dealing.js";
import { resolveHand } from "./scoring.js";

/** A finished-trick state ready for resolveHand, with explicit results. */
function endState(opts: {
  n: number;
  dealerIndex: number;
  pot: number;
  knockedIn?: boolean[]; // default all true
  tricks: number[]; // tricksWon per seat
  keptTrump?: boolean;
  trumpRank?: "A" | "K" | "Q" | "J" | "10" | "9" | "8" | "7";
}): GameState {
  const players = Array.from({ length: opts.n }, (_, i) =>
    createPlayer(`p${i}`, `P${i}`),
  );
  const s = createGameState(players);
  s.roundState = "turns";
  s.dealerId = players[opts.dealerIndex].id;
  players[opts.dealerIndex].isDealer = true;
  s.potValue = opts.pot;
  s.nextRoundPotBonus = 0;
  s.dealerKeptTrump = opts.keptTrump ?? false;
  s.dealerTrumpValue = opts.keptTrump ? (opts.trumpRank ?? "9") : null;
  players.forEach((p, i) => {
    p.knockedIn = opts.knockedIn ? opts.knockedIn[i] : true;
    p.tricksWon = opts.tricks[i];
  });
  return s;
}

test("trick winners are paid pot/3 per trick", () => {
  const s = endState({ n: 3, dealerIndex: 0, pot: 12, tricks: [2, 1, 0] });
  const before = s.players.map((p) => p.money);
  resolveHand(s);
  assert.equal(s.players[0].money - before[0], 8, "2 tricks -> +8¢");
  assert.equal(s.players[1].money - before[1], 4, "1 trick -> +4¢, no set");
});

test("an ordinary knocked-in player with 0 tricks goes set single", () => {
  const s = endState({ n: 3, dealerIndex: 0, pot: 12, tricks: [2, 1, 0] });
  resolveHand(s);
  const loser = s.players[2];
  assert.equal(loser.wentSet, true);
  assert.equal(loser.setType, "single");
  assert.equal(loser.setAmount, 12);
  assert.equal(s.nextRoundPotBonus, 12);
  assert.ok(isPotDivisible(s.nextRoundPotBonus));
});

test("winners don't go set; the whole pot is distributed", () => {
  const s = endState({ n: 3, dealerIndex: 0, pot: 12, tricks: [2, 1, 0] });
  resolveHand(s);
  assert.equal(s.players[0].wentSet, false);
  assert.equal(s.players[1].wentSet, false);
});

test("two players going set both pay; penalties stack (24¢ carried)", () => {
  // p0 wins all 3; p1 and p2 win nothing -> both set single.
  const s = endState({ n: 3, dealerIndex: 0, pot: 12, tricks: [3, 0, 0] });
  resolveHand(s);
  assert.equal(s.players[1].setAmount, 12);
  assert.equal(s.players[2].setAmount, 12);
  assert.equal(s.nextRoundPotBonus, 24);
});

test("dealer who kept a LOW trump and won 0 tricks goes set single", () => {
  const s = endState({
    n: 3,
    dealerIndex: 0,
    pot: 12,
    tricks: [0, 2, 1],
    keptTrump: true,
    trumpRank: "9",
  });
  resolveHand(s);
  assert.equal(s.players[0].setType, "single");
  assert.equal(s.players[0].setAmount, 12);
});

test("dealer who kept a low trump and won 1 trick is safe", () => {
  const s = endState({
    n: 3,
    dealerIndex: 0,
    pot: 12,
    tricks: [1, 2, 0],
    keptTrump: true,
    trumpRank: "9",
  });
  resolveHand(s);
  assert.equal(s.players[0].wentSet, false);
  assert.equal(s.players[2].wentSet, true); // the 0-trick non-dealer
});

test("dealer who kept a FACE trump and won 1 trick goes set DOUBLE", () => {
  const s = endState({
    n: 3,
    dealerIndex: 0,
    pot: 12,
    tricks: [1, 2, 0],
    keptTrump: true,
    trumpRank: "K",
  });
  resolveHand(s);
  assert.equal(s.players[0].setType, "double");
  assert.equal(s.players[0].setAmount, 24);
});

test("dealer who kept a face trump and won 2 tricks is safe", () => {
  const s = endState({
    n: 3,
    dealerIndex: 0,
    pot: 12,
    tricks: [2, 1, 0],
    keptTrump: true,
    trumpRank: "A",
  });
  resolveHand(s);
  assert.equal(s.players[0].wentSet, false);
});

test("dealer who kept the trump but folded (passed) goes set single", () => {
  const s = endState({
    n: 3,
    dealerIndex: 0,
    pot: 12,
    knockedIn: [false, true, true], // dealer folded
    tricks: [0, 2, 1],
    keptTrump: true,
    trumpRank: "K",
  });
  resolveHand(s);
  assert.equal(s.players[0].setType, "single", "folding is single even with a face trump");
  assert.equal(s.players[0].setAmount, 12);
});

test("resolveHand ends the hand", () => {
  const s = endState({ n: 3, dealerIndex: 0, pot: 12, tricks: [3, 0, 0] });
  resolveHand(s);
  assert.equal(s.roundState, "end");
  assert.equal(s.currentTurnPlayerId, null);
});

test("free ride: the next hand's pot is the carried penalty + dealer extra only", () => {
  const players = Array.from({ length: 3 }, (_, i) =>
    createPlayer(`p${i}`, `P${i}`),
  );
  const s = createGameState(players);
  s.anteAmount = 3;
  s.anteSet = true;
  s.dealerId = players[0].id; // so the next dealer is p1
  s.nextRoundPotBonus = 24; // two players went set last hand

  const moneyBefore = players.map((p) => p.money);
  startHand(s);

  // Pot = carried 24 + dealer's 3¢ extra, no standard antes.
  assert.equal(s.potValue, 24 + DEALER_EXTRA);
  assert.ok(isPotDivisible(s.potValue));
  assert.equal(s.nextRoundPotBonus, 0);

  // Only the new dealer paid (the 3¢ extra); the others paid nothing.
  const dealer = s.players.find((p) => p.isDealer)!;
  const dealerSeat = s.players.indexOf(dealer);
  s.players.forEach((p, i) => {
    const paid = moneyBefore[i] - p.money;
    assert.equal(paid, i === dealerSeat ? DEALER_EXTRA : 0, `seat ${i} payment`);
  });
});

test("no set carried over: the next hand antes normally", () => {
  const players = Array.from({ length: 3 }, (_, i) =>
    createPlayer(`p${i}`, `P${i}`),
  );
  const s = createGameState(players);
  s.anteAmount = 3;
  s.anteSet = true;
  s.dealerId = players[0].id;
  s.nextRoundPotBonus = 0; // nobody went set

  startHand(s);
  assert.equal(s.potValue, 3 * 3 + DEALER_EXTRA); // everyone antes
});
