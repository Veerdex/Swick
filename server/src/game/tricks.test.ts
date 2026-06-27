import { test } from "node:test";
import assert from "node:assert/strict";

import type { Card, Rank, Suit } from "./cards.js";
import {
  createGameState,
  createPlayer,
  type GameState,
  type PlayedCard,
} from "./state.js";
import { legalPlays, trickWinner, playCard, finishTrick } from "./tricks.js";

const C = (rank: Rank, suit: Suit): Card => ({ rank, suit });

/** Build a trick-taking state with explicit hands; all players knocked in. */
function mkState(
  ids: string[],
  dealerId: string,
  trumpSuit: Suit,
  hands: Record<string, Card[]>,
  leaderId: string,
): GameState {
  const players = ids.map((id) => {
    const p = createPlayer(id, id);
    p.knockedIn = true;
    p.hand = hands[id];
    return p;
  });
  const s = createGameState(players);
  s.roundState = "turns";
  s.dealerId = dealerId;
  players.find((p) => p.id === dealerId)!.isDealer = true;
  s.trumpSuit = trumpSuit;
  s.trickNumber = 0;
  s.currentTrick = [];
  s.leadSuit = null;
  s.currentTurnPlayerId = leaderId;
  return s;
}

test("leader may play any card (no special rule in effect)", () => {
  const s = mkState(
    ["p0", "p1", "p2"],
    "p0",
    "clubs",
    { p0: [C("7", "hearts")], p1: [C("9", "spades")], p2: [C("K", "diamonds")] },
    "p2",
  );
  s.trickNumber = 1; // not the first trick
  assert.deepEqual(legalPlays(s, "p2"), [0]);
});

test("first trick: dealer's left must lead the Ace of Trump if held", () => {
  const s = mkState(
    ["p0", "p1", "p2"],
    "p0", // dealer
    "hearts",
    {
      p0: [C("7", "spades")],
      p1: [C("9", "clubs"), C("A", "hearts"), C("8", "spades")], // left of dealer
      p2: [C("K", "diamonds")],
    },
    "p1",
  );
  assert.deepEqual(legalPlays(s, "p1"), [1], "only the Ace of Trump");
});

test("Ace-of-Trump lead rule does not apply after the first trick", () => {
  const s = mkState(
    ["p0", "p1", "p2"],
    "p0",
    "hearts",
    { p0: [C("7", "spades")], p1: [C("A", "hearts"), C("8", "clubs")], p2: [C("K", "diamonds")] },
    "p1",
  );
  s.trickNumber = 1;
  assert.deepEqual(legalPlays(s, "p1"), [0, 1], "any card");
});

test("must follow suit and beat the best led card if able", () => {
  const s = mkState(
    ["p0", "p1"],
    "p0",
    "clubs",
    { p0: [], p1: [C("K", "hearts"), C("8", "hearts"), C("7", "spades")] },
    "p0",
  );
  // p0 led 9 of hearts.
  s.currentTrick = [{ playerId: "p0", card: C("9", "hearts") }];
  s.leadSuit = "hearts";
  assert.deepEqual(legalPlays(s, "p1"), [0], "only the higher heart (K)");
});

test("must follow suit but may play low when unable to beat", () => {
  const s = mkState(
    ["p0", "p1"],
    "p0",
    "clubs",
    { p0: [], p1: [C("8", "hearts"), C("7", "hearts"), C("A", "spades")] },
    "p0",
  );
  s.currentTrick = [{ playerId: "p0", card: C("9", "hearts") }];
  s.leadSuit = "hearts";
  assert.deepEqual(legalPlays(s, "p1"), [0, 1], "both low hearts, not the spade");
});

test("void of the led suit: must play a trump if able", () => {
  const s = mkState(
    ["p0", "p1"],
    "p0",
    "clubs",
    { p0: [], p1: [C("K", "clubs"), C("8", "spades"), C("7", "diamonds")] },
    "p0",
  );
  s.currentTrick = [{ playerId: "p0", card: C("9", "hearts") }];
  s.leadSuit = "hearts";
  assert.deepEqual(legalPlays(s, "p1"), [0], "must play the trump (clubs)");
});

test("void of both led suit and trump: play anything", () => {
  const s = mkState(
    ["p0", "p1"],
    "p0",
    "clubs",
    { p0: [], p1: [C("K", "spades"), C("8", "spades"), C("7", "diamonds")] },
    "p0",
  );
  s.currentTrick = [{ playerId: "p0", card: C("9", "hearts") }];
  s.leadSuit = "hearts";
  assert.deepEqual(legalPlays(s, "p1"), [0, 1, 2]);
});

test("trickWinner: highest trump wins; otherwise highest of led suit", () => {
  const withTrump: PlayedCard[] = [
    { playerId: "a", card: C("A", "hearts") },
    { playerId: "b", card: C("7", "clubs") }, // trump
    { playerId: "c", card: C("K", "hearts") },
  ];
  assert.equal(trickWinner(withTrump, "clubs", "hearts"), "b");

  const noTrump: PlayedCard[] = [
    { playerId: "a", card: C("9", "hearts") },
    { playerId: "b", card: C("K", "hearts") },
    { playerId: "c", card: C("8", "spades") }, // off-suit, can't win
  ];
  assert.equal(trickWinner(noTrump, "clubs", "hearts"), "b");
});

test("a full trick: trump wins, winner leads next, tricksWon increments", () => {
  const s = mkState(
    ["p0", "p1", "p2"],
    "p2", // dealer (so trick-1 ace rule won't fire for p0)
    "clubs",
    {
      p0: [C("A", "hearts")],
      p1: [C("K", "hearts")],
      p2: [C("7", "clubs")], // void hearts -> trumps in
    },
    "p0",
  );
  s.trickNumber = 1; // avoid the ace-lead rule
  playCard(s, "p0", 0);
  assert.equal(s.leadSuit, "hearts");
  playCard(s, "p2", 0); // next clockwise after p0
  playCard(s, "p1", 0); // completes the trick -> pause

  // The completed trick is held for display until finishTrick runs.
  assert.equal(s.roundState, "trick-complete");
  assert.equal(s.trickWinnerId, "p2");
  assert.equal(s.players.find((p) => p.id === "p2")!.tricksWon, 1);
  assert.equal(s.currentTrick.length, 3, "trick still on the table");

  finishTrick(s);
  assert.equal(s.roundState, "turns");
  assert.equal(s.currentTurnPlayerId, "p2", "winner leads next");
  assert.equal(s.trickNumber, 2);
  assert.deepEqual(s.currentTrick, []);
  assert.equal(s.trickWinnerId, null);
});

test("after the third trick the hand ends", () => {
  const s = mkState(
    ["p0", "p1"],
    "p1",
    "clubs",
    { p0: [C("A", "hearts")], p1: [C("7", "hearts")] },
    "p0",
  );
  s.trickNumber = 2; // this will be the final trick
  playCard(s, "p0", 0);
  playCard(s, "p1", 0); // completes the third trick -> pause
  assert.equal(s.roundState, "trick-complete");
  finishTrick(s); // ... then the hand ends
  assert.equal(s.trickNumber, 3);
  assert.equal(s.roundState, "end");
  assert.equal(s.currentTurnPlayerId, null);
});

test("play order skips players who aren't knocked in", () => {
  const s = mkState(
    ["p0", "p1", "p2"],
    "p2",
    "clubs",
    { p0: [C("A", "hearts")], p1: [C("K", "spades")], p2: [C("9", "hearts")] },
    "p0",
  );
  s.trickNumber = 1;
  s.players.find((p) => p.id === "p1")!.knockedIn = false; // p1 folded
  playCard(s, "p0", 0);
  // Next active after p0 skips p1 and lands on p2.
  assert.equal(s.currentTurnPlayerId, "p2");
});

test("rejects out-of-turn, wrong-phase, and illegal plays", () => {
  const s = mkState(
    ["p0", "p1"],
    "p1",
    "clubs",
    { p0: [C("A", "hearts"), C("K", "spades")], p1: [C("7", "hearts")] },
    "p0",
  );
  s.trickNumber = 1;
  assert.throws(() => playCard(s, "p1", 0), /your turn/);
  // p0 leads hearts; p1 must follow with the heart, not... but here test illegal
  playCard(s, "p0", 0); // A hearts led
  assert.throws(() => playCard(s, "p1", 99), /legal play/);
  s.roundState = "idle";
  assert.throws(() => playCard(s, "p0", 0), /trick-taking/);
});
