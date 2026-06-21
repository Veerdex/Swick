import { test } from "node:test";
import assert from "node:assert/strict";

import { createGameState, createPlayer, type GameState } from "./state.js";
import { startHand, dealerTrumpDecision } from "./dealing.js";
import { viewFor } from "./view.js";

function startedGame(n = 4): GameState {
  const players = Array.from({ length: n }, (_, i) =>
    createPlayer(`p${i}`, `P${i}`),
  );
  const s = createGameState(players);
  s.anteAmount = 3;
  s.anteSet = true;
  startHand(s);
  return s;
}

function viewOfPlayer(view: ReturnType<typeof viewFor>, id: string) {
  return view.players.find((p) => p.id === id)!;
}

test("a non-dealer sees their own hand but not opponents'", () => {
  const s = startedGame();
  const me = s.players.find((p) => !p.isDealer)!;
  const view = viewFor(s, me.id);

  const mine = viewOfPlayer(view, me.id);
  assert.equal(mine.handCount, 3);
  assert.ok(mine.hand.every((c) => c !== null), "own cards visible");

  for (const other of s.players) {
    if (other.id === me.id) continue;
    const ov = viewOfPlayer(view, other.id);
    assert.equal(ov.handCount, other.hand.length);
    assert.ok(ov.hand.every((c) => c === null), "others hidden");
  }
});

test("the dealer is blind to their own hand during trump-selection", () => {
  const s = startedGame();
  const dealerId = s.dealerId!;
  const view = viewFor(s, dealerId);
  const dealerView = viewOfPlayer(view, dealerId);

  assert.equal(dealerView.handCount, 3);
  assert.ok(dealerView.hand.every((c) => c === null), "dealer can't see own cards");
});

test("a blind dealer who kept trump still sees only the trump card", () => {
  const s = startedGame();
  const dealerId = s.dealerId!;
  const trump = s.trumpCard!;
  dealerTrumpDecision(s, true); // keep -> hand is now 4 cards

  const dealerView = viewOfPlayer(viewFor(s, dealerId), dealerId);
  assert.equal(dealerView.handCount, 4);

  const visible = dealerView.hand.filter((c) => c !== null);
  assert.equal(visible.length, 1, "exactly the trump is visible");
  assert.equal(visible[0]!.suit, trump.suit);
  assert.equal(visible[0]!.rank, trump.rank);
});

test("once dealerHandRevealed flips, the dealer sees everything", () => {
  const s = startedGame();
  const dealerId = s.dealerId!;
  dealerTrumpDecision(s, true);
  s.dealerHandRevealed = true; // simulates reaching the dealer's discard turn

  const dealerView = viewOfPlayer(viewFor(s, dealerId), dealerId);
  assert.ok(dealerView.hand.every((c) => c !== null), "all 4 cards visible");
});

test("the view never leaks the draw stock, only its count", () => {
  const s = startedGame(4);
  const view = viewFor(s, s.players[0].id);
  assert.equal(view.deckCount, s.deck.length);
  assert.ok(!("deck" in view), "no raw deck on the view");
});

test("public fields (pot, trump, dealer) are present for everyone", () => {
  const s = startedGame();
  const view = viewFor(s, s.players[0].id);
  assert.ok(view.potValue > 0);
  assert.equal(view.trumpSuit, s.trumpSuit);
  assert.equal(view.dealerId, s.dealerId);
  assert.equal(view.roundState, "trump-selection");
});
