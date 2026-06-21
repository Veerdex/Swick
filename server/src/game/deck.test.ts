import { test } from "node:test";
import assert from "node:assert/strict";

import { SUITS, RANKS, cardId, type Card } from "./cards.js";
import {
  DECK_SIZE,
  createDeck,
  shuffle,
  createShuffledDeck,
  deal,
  draw,
} from "./deck.js";

/** Assert that a collection of cards contains no duplicates. */
function assertNoDuplicates(cards: Card[], context: string) {
  const ids = cards.map(cardId);
  const unique = new Set(ids);
  assert.equal(
    unique.size,
    ids.length,
    `${context}: found duplicate card(s) in [${ids.join(", ")}]`,
  );
}

test("deck has exactly 32 cards", () => {
  assert.equal(DECK_SIZE, 32);
  assert.equal(createDeck().length, 32);
});

test("deck contains every rank in every suit, exactly once", () => {
  const deck = createDeck();
  assertNoDuplicates(deck, "fresh deck");

  for (const suit of SUITS) {
    for (const rank of RANKS) {
      const matches = deck.filter((c) => c.suit === suit && c.rank === rank);
      assert.equal(matches.length, 1, `expected exactly one ${rank} of ${suit}`);
    }
  }
});

test("deck has no removed cards (no 2-6, no Jokers)", () => {
  const deck = createDeck();
  const ranks = new Set(deck.map((c) => c.rank));
  for (const forbidden of ["2", "3", "4", "5", "6"]) {
    assert.ok(!ranks.has(forbidden as never), `${forbidden} should not exist`);
  }
});

test("shuffle preserves the exact set of cards (no adds, drops, or dupes)", () => {
  const deck = createDeck();
  const shuffled = shuffle(deck);

  assert.equal(shuffled.length, deck.length);
  assertNoDuplicates(shuffled, "shuffled deck");

  const before = new Set(deck.map(cardId));
  const after = new Set(shuffled.map(cardId));
  assert.deepEqual([...after].sort(), [...before].sort());
});

test("shuffle does not mutate its input", () => {
  const deck = createDeck();
  const snapshot = deck.map(cardId);
  shuffle(deck);
  assert.deepEqual(deck.map(cardId), snapshot);
});

test("shuffle actually reorders (statistically)", () => {
  // A 32-card deck returning to identical order by chance is ~1/32! — never.
  const deck = createDeck();
  const shuffled = createShuffledDeck();
  const samePositions = deck.filter(
    (c, i) => cardId(c) === cardId(shuffled[i]),
  ).length;
  assert.ok(samePositions < deck.length, "shuffle returned identical order");
});

test("deal gives each player the right count and no duplicates anywhere", () => {
  for (let players = 3; players <= 6; players++) {
    const deck = createShuffledDeck();
    const { hands, remaining } = deal(deck, players, 3);

    assert.equal(hands.length, players);
    for (const hand of hands) assert.equal(hand.length, 3);
    assert.equal(remaining.length, 32 - players * 3);

    // Combine every dealt card with the remaining deck — must equal the deck,
    // with zero duplicates across the whole table.
    const all = [...hands.flat(), ...remaining];
    assert.equal(all.length, 32);
    assertNoDuplicates(all, `deal for ${players} players`);
  }
});

test("deal does not mutate the source deck", () => {
  const deck = createShuffledDeck();
  const snapshot = deck.map(cardId);
  deal(deck, 4, 3);
  assert.deepEqual(deck.map(cardId), snapshot);
});

test("deal throws when the deck is too small", () => {
  const deck = createDeck();
  assert.throws(() => deal(deck, 6, 6)); // 36 > 32
});

test("draw takes from the top and leaves the rest intact", () => {
  const deck = createShuffledDeck();
  const { drawn, remaining } = draw(deck, 3);

  assert.equal(drawn.length, 3);
  assert.equal(remaining.length, 29);
  assert.deepEqual(drawn.map(cardId), deck.slice(0, 3).map(cardId));
  assertNoDuplicates([...drawn, ...remaining], "draw result");
});

test("draw of 1 (trump flip) works and draw throws past the end", () => {
  const deck = createShuffledDeck();
  const { drawn } = draw(deck, 1);
  assert.equal(drawn.length, 1);
  assert.throws(() => draw(deck, 33));
});

test("full hand simulation: deal + trump flip stays duplicate-free", () => {
  // Mirror a real SWICK deal: 3 cards each to 5 players, then flip a trump.
  const deck = createShuffledDeck();
  const { hands, remaining } = deal(deck, 5, 3);
  const { drawn: trump, remaining: stock } = draw(remaining, 1);

  const inPlay = [...hands.flat(), ...trump, ...stock];
  assert.equal(inPlay.length, 32);
  assertNoDuplicates(inPlay, "deal + trump flip");
});
