import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MIN_ANTE,
  STARTING_MONEY,
  createPlayer,
  resetPlayerForHand,
  createGameState,
  isPotDivisible,
  assertPotValid,
  getPlayer,
} from "./state.js";

test("createPlayer sets identity and safe per-hand defaults", () => {
  const p = createPlayer("p1", "Alice");
  assert.equal(p.id, "p1");
  assert.equal(p.name, "Alice");
  assert.equal(p.isBot, false);
  assert.equal(p.money, STARTING_MONEY);

  assert.deepEqual(p.hand, []);
  assert.equal(p.isDealer, false);
  assert.equal(p.knockedIn, false);
  assert.equal(p.hasKnockDecision, false);
  assert.equal(p.hasDiscardDecision, false);
  assert.equal(p.tricksWon, 0);
  assert.equal(p.wentSet, false);
  assert.equal(p.setType, null);
  assert.equal(p.setAmount, 0);
  assert.equal(p.connected, true);
});

test("createPlayer can flag a bot", () => {
  assert.equal(createPlayer("b1", "Bot", true).isBot, true);
});

test("resetPlayerForHand clears per-hand fields but keeps id, name, money", () => {
  const p = createPlayer("p1", "Alice");
  // Dirty the player as if a hand had been played.
  p.money = 742;
  p.hand = [{ suit: "hearts", rank: "A" }];
  p.isDealer = true;
  p.knockedIn = true;
  p.hasKnockDecision = true;
  p.hasDiscardDecision = true;
  p.tricksWon = 2;
  p.wentSet = true;
  p.setType = "double";
  p.setAmount = 24;

  resetPlayerForHand(p);

  // Preserved
  assert.equal(p.id, "p1");
  assert.equal(p.name, "Alice");
  assert.equal(p.money, 742);
  // Reset
  assert.deepEqual(p.hand, []);
  assert.equal(p.isDealer, false);
  assert.equal(p.knockedIn, false);
  assert.equal(p.hasKnockDecision, false);
  assert.equal(p.hasDiscardDecision, false);
  assert.equal(p.tricksWon, 0);
  assert.equal(p.wentSet, false);
  assert.equal(p.setType, null);
  assert.equal(p.setAmount, 0);
});

test("createGameState starts idle with a valid empty pot", () => {
  const s = createGameState();
  assert.equal(s.roundState, "idle");
  assert.deepEqual(s.players, []);

  assert.equal(s.anteAmount, MIN_ANTE);
  assert.equal(s.potValue, 0);
  assert.ok(isPotDivisible(s.potValue));
  assert.equal(s.nextRoundPotBonus, 0);

  assert.equal(s.trumpSuit, null);
  assert.equal(s.trumpCard, null);
  assert.equal(s.dealerKeptTrump, false);
  assert.equal(s.dealerTrumpValue, null);

  assert.equal(s.dealerId, null);
  assert.equal(s.currentTurnPlayerId, null);
  assert.equal(s.currentKnockPlayerId, null);
  assert.equal(s.currentDiscardPlayerId, null);

  assert.equal(s.trickNumber, 0);
  assert.deepEqual(s.currentTrick, []);
  assert.equal(s.leadSuit, null);

  assert.equal(s.specialHandWinner, null);
  assert.deepEqual(s.deck, []);
});

test("createGameState can be seeded with players", () => {
  const players = [createPlayer("p1", "Alice"), createPlayer("p2", "Bob")];
  const s = createGameState(players);
  assert.equal(s.players.length, 2);
  assert.equal(getPlayer(s, "p2")?.name, "Bob");
  assert.equal(getPlayer(s, "nope"), undefined);
});

test("isPotDivisible accepts multiples of 3, rejects others", () => {
  for (const ok of [0, 3, 6, 12, 24, 99]) assert.ok(isPotDivisible(ok), `${ok}`);
  for (const bad of [1, 2, 4, 10, 13]) assert.ok(!isPotDivisible(bad), `${bad}`);
  assert.ok(!isPotDivisible(3.3), "non-integer");
});

test("assertPotValid throws only on invalid pots", () => {
  assert.doesNotThrow(() => assertPotValid(12));
  assert.throws(() => assertPotValid(10), /not divisible by 3/);
});
