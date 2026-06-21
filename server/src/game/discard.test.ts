import { test } from "node:test";
import assert from "node:assert/strict";

import { cardId, cardsEqual, type Card } from "./cards.js";
import { DECK_SIZE } from "./deck.js";
import { createGameState, createPlayer, type GameState } from "./state.js";
import { startHand, dealerTrumpDecision } from "./dealing.js";
import { applyKnock } from "./knockIn.js";
import { applyDiscard } from "./discard.js";

/** Start a hand and bring it to discard-draw with all players knocked in. */
function toDiscardPhase(n: number, keepTrump: boolean): GameState {
  const players = Array.from({ length: n }, (_, i) =>
    createPlayer(`p${i}`, `P${i}`),
  );
  const s = createGameState(players);
  s.anteAmount = 3;
  s.anteSet = true;
  startHand(s);
  dealerTrumpDecision(s, keepTrump);
  // Everyone knocks in, in order, until discard-draw begins.
  while (s.roundState === "knock-in") {
    applyKnock(s, s.currentKnockPlayerId!, true);
  }
  return s;
}

/** All 32 cards accounted for exactly once across hands, trump, stock, pile. */
function assertConservation(s: GameState) {
  const cards: Card[] = [
    ...s.players.flatMap((p) => p.hand),
    ...s.deck,
    ...s.discardPile,
  ];
  // The trump is in the dealer's hand if kept, otherwise out of play but still
  // a real card; count it once if it's not already in a hand.
  if (s.trumpCard && !s.dealerKeptTrump) cards.push(s.trumpCard);
  const ids = cards.map(cardId);
  assert.equal(new Set(ids).size, ids.length, "no duplicate cards");
  assert.equal(ids.length, DECK_SIZE, "all 32 cards present");
}

test("non-dealer discards advance in order; the dealer goes last", () => {
  const s = toDiscardPhase(4, false);
  assert.equal(s.roundState, "discard-draw");
  const dealerId = s.dealerId!;
  assert.notEqual(s.currentDiscardPlayerId, dealerId, "dealer is not first");

  // Walk all non-dealers (discard nothing).
  const seen: string[] = [];
  while (s.currentDiscardPlayerId && s.currentDiscardPlayerId !== dealerId) {
    seen.push(s.currentDiscardPlayerId);
    applyDiscard(s, s.currentDiscardPlayerId, []);
  }
  assert.equal(s.currentDiscardPlayerId, dealerId, "dealer discards last");
  assert.equal(seen.length, 3);
});

test("the dealer's hand stays hidden until their discard turn begins", () => {
  const s = toDiscardPhase(4, false);
  const dealerId = s.dealerId!;
  assert.equal(s.dealerHandRevealed, false);
  while (s.currentDiscardPlayerId !== dealerId) {
    applyDiscard(s, s.currentDiscardPlayerId!, []);
  }
  assert.equal(s.dealerHandRevealed, true);
});

test("discarding draws replacements and keeps the hand at 3", () => {
  const s = toDiscardPhase(4, false);
  const player = s.players.find((p) => p.id === s.currentDiscardPlayerId)!;
  const before = player.hand.map(cardId);
  applyDiscard(s, player.id, [0, 2]); // discard 2, draw 2
  assert.equal(player.hand.length, 3);
  // The two discarded cards are gone from the hand.
  assert.ok(!player.hand.some((c) => cardId(c) === before[0]));
  assert.ok(!player.hand.some((c) => cardId(c) === before[2]));
  assertConservation(s);
});

test("discarding zero keeps the same three cards", () => {
  const s = toDiscardPhase(4, false);
  const player = s.players.find((p) => p.id === s.currentDiscardPlayerId)!;
  const before = player.hand.map(cardId).sort();
  applyDiscard(s, player.id, []);
  assert.deepEqual(player.hand.map(cardId).sort(), before);
});

test("a kept-trump dealer cannot discard the trump and must trim to 3", () => {
  const s = toDiscardPhase(4, true);
  const dealerId = s.dealerId!;
  const trump = s.trumpCard!;
  // Advance to the dealer.
  while (s.currentDiscardPlayerId !== dealerId) {
    applyDiscard(s, s.currentDiscardPlayerId!, []);
  }
  const dealer = s.players.find((p) => p.id === dealerId)!;
  assert.equal(dealer.hand.length, 4, "kept trump -> 4 cards");
  const trumpIdx = dealer.hand.findIndex((c) => cardsEqual(c, trump));

  // Discarding the trump is rejected.
  assert.throws(() => applyDiscard(s, dealerId, [trumpIdx]), /trump card cannot/);

  // First action: discard a non-trump, draw one -> still 4, trim now pending.
  const nonTrumpIdx = dealer.hand.findIndex((c) => !cardsEqual(c, trump));
  applyDiscard(s, dealerId, [nonTrumpIdx]);
  assert.equal(s.dealerTrimPending, true);
  assert.equal(dealer.hand.length, 4);
  assert.ok(dealer.hand.some((c) => cardsEqual(c, trump)), "trump still held");

  // Trim must drop exactly one card; dropping zero is rejected.
  assert.throws(() => applyDiscard(s, dealerId, []), /exactly 1/);
  const dropIdx = dealer.hand.findIndex((c) => !cardsEqual(c, trump));
  applyDiscard(s, dealerId, [dropIdx]);

  assert.equal(s.dealerTrimPending, false);
  assert.equal(dealer.hand.length, 3);
  assert.ok(dealer.hand.some((c) => cardsEqual(c, trump)), "trump survives trim");
  assert.equal(s.roundState, "turns", "discard phase complete");
  assertConservation(s);
});

test("a kept-trump dealer who discards nothing still trims one card", () => {
  const s = toDiscardPhase(4, true);
  const dealerId = s.dealerId!;
  while (s.currentDiscardPlayerId !== dealerId) {
    applyDiscard(s, s.currentDiscardPlayerId!, []);
  }
  applyDiscard(s, dealerId, []); // discard nothing -> still 4
  assert.equal(s.dealerTrimPending, true);
  const dealer = s.players.find((p) => p.id === dealerId)!;
  const dropIdx = dealer.hand.findIndex((c) => !cardsEqual(c, s.trumpCard!));
  applyDiscard(s, dealerId, [dropIdx]);
  assert.equal(dealer.hand.length, 3);
});

test("completing all discards moves to trick-taking", () => {
  const s = toDiscardPhase(5, false);
  while (s.roundState === "discard-draw") {
    applyDiscard(s, s.currentDiscardPlayerId!, []);
  }
  assert.equal(s.roundState, "turns");
  assert.ok(s.currentTurnPlayerId);
});

test("rejects out-of-turn, wrong-phase, and bad-index discards", () => {
  const s = toDiscardPhase(4, false);
  const someoneElse = s.players.find((p) => p.id !== s.currentDiscardPlayerId)!;
  assert.throws(() => applyDiscard(s, someoneElse.id, []), /your turn/);
  assert.throws(() => applyDiscard(s, s.currentDiscardPlayerId!, [9]), /Invalid card/);
  s.roundState = "idle";
  assert.throws(() => applyDiscard(s, s.currentDiscardPlayerId!, []), /discard-draw/);
});

test("a heavy 6-player redraw never runs out of cards (reshuffle works)", () => {
  const s = toDiscardPhase(6, false);
  // Every knocked-in player discards all 3 and draws 3 — 18 draws from a
  // 13-card stock, which only works because the discard pile is recycled.
  let safety = 20;
  while (s.roundState === "discard-draw" && safety-- > 0) {
    const id = s.currentDiscardPlayerId!;
    const player = s.players.find((p) => p.id === id)!;
    const isKeptTrumpDealer =
      id === s.dealerId && s.dealerKeptTrump && !s.dealerTrimPending;
    applyDiscard(s, id, isKeptTrumpDealer ? [0, 1, 2] : [0, 1, 2].slice(0, Math.min(3, player.hand.length)));
  }
  assert.equal(s.roundState, "turns");
  for (const p of s.players) assert.equal(p.hand.length, 3);
  assertConservation(s);
});
