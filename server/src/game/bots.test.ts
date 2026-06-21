import { test } from "node:test";
import assert from "node:assert/strict";

import type { Card, Rank, Suit } from "./cards.js";
import { createGameState, createPlayer, type GameState } from "./state.js";
import {
  botTrumpDecision,
  botKnockDecision,
  botDiscardDecision,
  botPlayDecision,
} from "./bots.js";

const C = (rank: Rank, suit: Suit): Card => ({ rank, suit });

function game(players = ["p0", "p1", "p2"]): GameState {
  const ps = players.map((id) => createPlayer(id, id));
  const s = createGameState(ps);
  s.dealerId = "p0";
  ps[0].isDealer = true;
  s.trumpSuit = "hearts";
  return s;
}

test("trump decision keeps low trumps, passes face trumps", () => {
  const s = game();
  s.trumpCard = C("9", "hearts");
  assert.equal(botTrumpDecision(s), true);
  s.trumpCard = C("K", "hearts");
  assert.equal(botTrumpDecision(s), false);
});

test("knock decision: dealer always knocks; non-dealers need strength", () => {
  const s = game();
  // Dealer is blind -> always knocks.
  assert.equal(botKnockDecision(s, "p0"), true);

  const p1 = s.players.find((p) => p.id === "p1")!;
  p1.hand = [C("9", "hearts"), C("8", "spades"), C("7", "clubs")]; // one trump
  assert.equal(botKnockDecision(s, "p1"), true);

  p1.hand = [C("A", "spades"), C("K", "diamonds"), C("8", "clubs")]; // two high
  assert.equal(botKnockDecision(s, "p1"), true);

  p1.hand = [C("9", "spades"), C("8", "diamonds"), C("7", "clubs")]; // weak, no trump
  assert.equal(botKnockDecision(s, "p1"), false);
});

test("discard keeps trumps and high cards, dumps low off-suit", () => {
  const s = game();
  const p1 = s.players.find((p) => p.id === "p1")!;
  p1.hand = [C("A", "spades"), C("9", "hearts"), C("8", "clubs")];
  // Keep A (high) and 9 hearts (trump); discard 8 clubs (index 2).
  assert.deepEqual(botDiscardDecision(s, "p1"), [2]);
});

test("kept-trump dealer trims the lowest non-trump down to three", () => {
  const s = game();
  s.dealerKeptTrump = true;
  s.trumpCard = C("9", "hearts");
  s.dealerTrimPending = true;
  const dealer = s.players.find((p) => p.id === "p0")!;
  // 4 cards incl. the protected trump 9♥; lowest non-trump is 7♣ (index 3).
  dealer.hand = [C("9", "hearts"), C("A", "spades"), C("K", "diamonds"), C("7", "clubs")];
  assert.deepEqual(botDiscardDecision(s, "p0"), [3]);
});

test("play: leads the highest non-trump, saving trump", () => {
  const s = game();
  s.roundState = "turns";
  s.currentTrick = [];
  s.trickNumber = 1;
  s.currentTurnPlayerId = "p1";
  const p1 = s.players.find((p) => p.id === "p1")!;
  p1.knockedIn = true;
  p1.hand = [C("A", "hearts"), C("K", "spades"), C("8", "clubs")]; // A♥ is trump
  // Highest non-trump is K♠ (index 1), not the A of trump.
  assert.equal(botPlayDecision(s, "p1"), 1);
});

test("play: wins cheaply when following, else dumps the lowest", () => {
  const s = game();
  s.roundState = "turns";
  s.leadSuit = "spades";
  s.currentTrick = [{ playerId: "p0", card: C("9", "spades") }];
  s.currentTurnPlayerId = "p1";
  const p1 = s.players.find((p) => p.id === "p1")!;
  p1.knockedIn = true;

  // Can follow spades: must beat 9 if able -> only K/J spades are legal; pick
  // the cheaper winner (J).
  p1.hand = [C("K", "spades"), C("J", "spades"), C("7", "clubs")];
  assert.equal(botPlayDecision(s, "p1"), 1, "cheapest winning spade (J)");

  // Can't beat and void of trump elsewhere: dump the lowest legal card.
  p1.hand = [C("8", "spades"), C("7", "spades"), C("A", "clubs")];
  assert.equal(botPlayDecision(s, "p1"), 1, "lowest spade (7)");
});
