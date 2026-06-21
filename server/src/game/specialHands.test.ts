import { test } from "node:test";
import assert from "node:assert/strict";

import type { Card, Rank, Suit } from "./cards.js";
import {
  createGameState,
  createPlayer,
  STARTING_MONEY,
  type GameState,
} from "./state.js";
import {
  detectSpecialHand,
  findSpecialHandWinner,
} from "./specialHands.js";
import { beginTurns } from "./discard.js";

const C = (rank: Rank, suit: Suit): Card => ({ rank, suit });

test("detects three aces, three sevens, and A-K-Q of trump", () => {
  assert.equal(
    detectSpecialHand([C("A", "spades"), C("A", "hearts"), C("A", "clubs")], "diamonds"),
    "three-aces",
  );
  assert.equal(
    detectSpecialHand([C("7", "spades"), C("7", "hearts"), C("7", "clubs")], "diamonds"),
    "three-sevens",
  );
  assert.equal(
    detectSpecialHand([C("A", "hearts"), C("K", "hearts"), C("Q", "hearts")], "hearts"),
    "akq-trump",
  );
});

test("A-K-Q only counts when all three are the trump suit", () => {
  // Right ranks, wrong (non-trump) suit alignment.
  assert.equal(
    detectSpecialHand([C("A", "hearts"), C("K", "hearts"), C("Q", "spades")], "hearts"),
    null,
  );
  // A-K-Q of a non-trump suit is not special.
  assert.equal(
    detectSpecialHand([C("A", "hearts"), C("K", "hearts"), C("Q", "hearts")], "clubs"),
    null,
  );
});

test("ordinary hands are not special", () => {
  assert.equal(
    detectSpecialHand([C("A", "spades"), C("K", "spades"), C("9", "spades")], "spades"),
    null,
  );
  assert.equal(detectSpecialHand([C("A", "spades"), C("A", "hearts")], "spades"), null);
});

function gameWithHands(
  hands: Card[][],
  trumpSuit: Suit,
  knockedIn?: boolean[],
): GameState {
  const players = hands.map((h, i) => {
    const p = createPlayer(`p${i}`, `P${i}`);
    p.hand = h;
    p.knockedIn = knockedIn ? knockedIn[i] : true;
    return p;
  });
  const s = createGameState(players);
  s.trumpSuit = trumpSuit;
  s.dealerId = players[0].id;
  players[0].isDealer = true;
  s.roundState = "discard-draw";
  s.potValue = 12;
  return s;
}

test("three aces outranks three sevens and A-K-Q of trump", () => {
  const s = gameWithHands(
    [
      [C("7", "spades"), C("7", "hearts"), C("7", "clubs")], // p0 three 7s
      [C("A", "spades"), C("A", "hearts"), C("A", "clubs")], // p1 three aces
      [C("A", "diamonds"), C("K", "diamonds"), C("Q", "diamonds")], // p2 akq trump
    ],
    "diamonds",
  );
  assert.deepEqual(findSpecialHandWinner(s), { playerId: "p1", hand: "three-aces" });
});

test("three sevens outranks A-K-Q of trump", () => {
  const s = gameWithHands(
    [
      [C("A", "diamonds"), C("K", "diamonds"), C("Q", "diamonds")], // akq trump
      [C("7", "spades"), C("7", "hearts"), C("7", "clubs")], // three 7s
      [C("9", "clubs"), C("8", "clubs"), C("J", "spades")],
    ],
    "diamonds",
  );
  assert.deepEqual(findSpecialHandWinner(s), { playerId: "p1", hand: "three-sevens" });
});

test("a folded player's special hand does not count", () => {
  const s = gameWithHands(
    [
      [C("A", "spades"), C("A", "hearts"), C("A", "clubs")], // p0 has aces but folded
      [C("9", "clubs"), C("8", "clubs"), C("J", "spades")],
      [C("9", "hearts"), C("8", "hearts"), C("J", "clubs")],
    ],
    "diamonds",
    [false, true, true],
  );
  assert.equal(findSpecialHandWinner(s), null);
});

test("beginTurns awards the pot and ends the hand on a special hand", () => {
  const s = gameWithHands(
    [
      [C("9", "clubs"), C("8", "clubs"), C("J", "spades")],
      [C("A", "spades"), C("A", "hearts"), C("A", "clubs")], // p1 three aces
      [C("9", "hearts"), C("8", "hearts"), C("J", "clubs")],
    ],
    "diamonds",
  );
  const before = s.players[1].money;
  beginTurns(s);

  assert.equal(s.roundState, "end", "skips trick-taking");
  assert.equal(s.specialHandWinner, "p1");
  assert.equal(s.specialHandType, "three-aces");
  assert.equal(s.players[1].money - before, 12, "winner takes the whole pot");
  // Nobody goes set on a special-hand win.
  assert.ok(s.players.every((p) => !p.wentSet));
});

test("beginTurns starts trick-taking when there is no special hand", () => {
  const s = gameWithHands(
    [
      [C("A", "spades"), C("K", "spades"), C("9", "spades")],
      [C("9", "clubs"), C("8", "clubs"), C("J", "spades")],
      [C("9", "hearts"), C("8", "hearts"), C("J", "clubs")],
    ],
    "diamonds",
  );
  beginTurns(s);
  assert.equal(s.roundState, "turns");
  assert.equal(s.specialHandWinner, null);
  assert.ok(s.players.every((p) => p.money === STARTING_MONEY));
});
