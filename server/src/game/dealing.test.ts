import { test } from "node:test";
import assert from "node:assert/strict";

import { cardId, type Card } from "./cards.js";
import { DECK_SIZE } from "./deck.js";
import {
  createGameState,
  createPlayer,
  isPotDivisible,
  type GameState,
} from "./state.js";
import {
  DEALER_EXTRA,
  CARDS_PER_PLAYER,
  determineFirstDealerIndex,
  nextDealerIndex,
  clockwiseFromDealerLeft,
  startHand,
  dealerTrumpDecision,
  dealerKeptFaceTrump,
} from "./dealing.js";

function gameWith(numPlayers: number, ante = 3): GameState {
  const players = Array.from({ length: numPlayers }, (_, i) =>
    createPlayer(`p${i}`, `P${i}`),
  );
  const s = createGameState(players);
  s.anteAmount = ante;
  s.anteSet = true;
  return s;
}

/** Every card visible anywhere in the game (hands + trump + stock). */
function allCardsInPlay(s: GameState): Card[] {
  const cards: Card[] = [...s.players.flatMap((p) => p.hand), ...s.deck];
  if (s.trumpCard) cards.push(s.trumpCard);
  return cards;
}

test("determineFirstDealerIndex picks the seat of the first Ace", () => {
  const deck: Card[] = [
    { suit: "spades", rank: "7" }, // seat 0
    { suit: "hearts", rank: "9" }, // seat 1
    { suit: "clubs", rank: "A" }, // seat 2 -> dealer
  ];
  assert.equal(determineFirstDealerIndex(3, deck), 2);
});

test("nextDealerIndex rotates left and wraps", () => {
  assert.equal(nextDealerIndex(4, 0), 3);
  assert.equal(nextDealerIndex(4, 3), 2);
});

test("clockwiseFromDealerLeft starts at dealer's left", () => {
  assert.deepEqual(clockwiseFromDealerLeft(4, 0), [3, 2, 1, 0]);
  assert.deepEqual(clockwiseFromDealerLeft(4, 2), [1, 0, 3, 2]);
});

test("startHand deals 3 to each, flips trump, and leaves a valid stock", () => {
  for (let n = 3; n <= 6; n++) {
    const s = gameWith(n);
    startHand(s);

    assert.equal(s.roundState, "trump-selection");
    for (const p of s.players) assert.equal(p.hand.length, CARDS_PER_PLAYER);
    assert.ok(s.trumpCard);
    assert.equal(s.trumpSuit, s.trumpCard!.suit);
    assert.equal(s.deck.length, DECK_SIZE - n * CARDS_PER_PLAYER - 1);

    // No duplicates across all cards in play.
    const ids = allCardsInPlay(s).map(cardId);
    assert.equal(new Set(ids).size, ids.length, `dupes for ${n} players`);
    assert.equal(ids.length, DECK_SIZE);
  }
});

test("startHand sets a dealer and points the turn at them", () => {
  const s = gameWith(4);
  startHand(s);
  assert.ok(s.dealerId);
  const dealer = s.players.find((p) => p.isDealer);
  assert.equal(dealer?.id, s.dealerId);
  assert.equal(s.currentTurnPlayerId, s.dealerId);
  assert.equal(s.players.filter((p) => p.isDealer).length, 1);
});

test("startHand builds a pot of players*ante + dealer extra, divisible by 3", () => {
  const s = gameWith(4, 6);
  startHand(s);
  assert.equal(s.potValue, 4 * 6 + DEALER_EXTRA); // 27
  assert.ok(isPotDivisible(s.potValue));
  assert.equal(s.nextRoundPotBonus, 0);
});

test("startHand deducts antes from money (dealer pays extra)", () => {
  const s = gameWith(3, 3);
  startHand(s);
  const dealer = s.players.find((p) => p.isDealer)!;
  const nonDealer = s.players.find((p) => !p.isDealer)!;
  // Started at STARTING_MONEY (1000).
  assert.equal(nonDealer.money, 1000 - 3);
  assert.equal(dealer.money, 1000 - 3 - DEALER_EXTRA);
});

test("a carried set bonus seeds a free-ride pot (no standard antes), then clears", () => {
  const s = gameWith(3, 3);
  s.nextRoundPotBonus = 12;
  startHand(s);
  // Free ride: the carried penalty funds the pot; only the dealer's 3¢ extra
  // is added. No standard antes.
  assert.equal(s.potValue, 12 + DEALER_EXTRA); // 15
  assert.ok(isPotDivisible(s.potValue));
  assert.equal(s.nextRoundPotBonus, 0);
});

test("second hand rotates the dealer to the left", () => {
  const s = gameWith(4);
  startHand(s);
  const firstDealerIndex = s.players.findIndex((p) => p.id === s.dealerId);
  startHand(s);
  const secondDealerIndex = s.players.findIndex((p) => p.id === s.dealerId);
  assert.equal(secondDealerIndex, (firstDealerIndex - 1 + 4) % 4);
});

test("dealer keeps trump: it joins the hand (4 cards) and is recorded", () => {
  const s = gameWith(4);
  startHand(s);
  const dealer = s.players.find((p) => p.isDealer)!;
  const trump = s.trumpCard!;

  dealerTrumpDecision(s, true);

  assert.equal(s.dealerKeptTrump, true);
  assert.equal(s.dealerTrumpValue, trump.rank);
  assert.equal(dealer.hand.length, CARDS_PER_PLAYER + 1);
  assert.ok(dealer.hand.some((c) => c.suit === trump.suit && c.rank === trump.rank));
  assert.equal(s.roundState, "knock-in");
});

test("dealer passes trump: hand stays 3 and trump is not kept", () => {
  const s = gameWith(4);
  startHand(s);
  const dealer = s.players.find((p) => p.isDealer)!;

  dealerTrumpDecision(s, false);

  assert.equal(s.dealerKeptTrump, false);
  assert.equal(s.dealerTrumpValue, null);
  assert.equal(dealer.hand.length, CARDS_PER_PLAYER);
  assert.equal(s.roundState, "knock-in");
});

test("knock-in begins with the player to the dealer's left", () => {
  const s = gameWith(5);
  startHand(s);
  const dealerIndex = s.players.findIndex((p) => p.isDealer);
  dealerTrumpDecision(s, false);
  assert.equal(s.currentKnockPlayerId, s.players[(dealerIndex - 1 + 5) % 5].id);
});

test("dealerKeptFaceTrump reflects a kept face card only", () => {
  const s = gameWith(4);
  startHand(s);
  // Force a known trump to test both branches deterministically.
  s.trumpCard = { suit: "hearts", rank: "K" };
  s.trumpSuit = "hearts";
  dealerTrumpDecision(s, true);
  assert.equal(dealerKeptFaceTrump(s), true);

  const s2 = gameWith(4);
  startHand(s2);
  s2.trumpCard = { suit: "hearts", rank: "9" };
  s2.trumpSuit = "hearts";
  dealerTrumpDecision(s2, true);
  assert.equal(dealerKeptFaceTrump(s2), false);
});

test("dealerTrumpDecision rejects calls outside trump-selection", () => {
  const s = gameWith(4);
  startHand(s);
  dealerTrumpDecision(s, false); // now in knock-in
  assert.throws(() => dealerTrumpDecision(s, false));
});
