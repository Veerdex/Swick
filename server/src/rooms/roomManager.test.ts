import { test } from "node:test";
import assert from "node:assert/strict";

import { RoomManager } from "./roomManager.js";
import { MAX_PLAYERS, roomSummary } from "./room.js";
import { createPlayer } from "../game/state.js";

/** Create a manager with a room hosted by "host", returning both + the room. */
function withRoom() {
  const mgr = new RoomManager();
  const host = createPlayer("host", "Host");
  const res = mgr.createRoom("Test Table", host);
  assert.ok(res.ok);
  return { mgr, host, room: res.value };
}

/** Monotonic counter so helper-created players always get unique ids. */
let nextPlayerNum = 0;

/** Add N extra ready players (ante must already be set) and return their ids. */
function fillReady(mgr: RoomManager, room: { id: string }, n: number): string[] {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const id = `p${nextPlayerNum++}`;
    const p = createPlayer(id, id.toUpperCase());
    assert.ok(mgr.joinRoom(room.id, p).ok);
    assert.ok(mgr.setReady(p.id, true).ok);
    ids.push(p.id);
  }
  return ids;
}

test("createRoom registers the host as the only player and the host", () => {
  const { room } = withRoom();
  assert.equal(room.state.players.length, 1);
  assert.equal(room.hostId, "host");
  assert.equal(room.started, false);
  assert.match(room.id, /^[0-9A-F]{6}$/);
});

test("createRoom rejects a player already in a room", () => {
  const { mgr, host } = withRoom();
  const res = mgr.createRoom("Another", host);
  assert.equal(res.ok, false);
});

test("joinRoom adds players up to the max, then rejects", () => {
  const { mgr, room } = withRoom();
  // Host counts as 1; add up to MAX_PLAYERS.
  for (let i = 0; i < MAX_PLAYERS - 1; i++) {
    assert.ok(mgr.joinRoom(room.id, createPlayer(`p${i}`, `P${i}`)).ok);
  }
  assert.equal(room.state.players.length, MAX_PLAYERS);
  const overflow = mgr.joinRoom(room.id, createPlayer("extra", "Extra"));
  assert.equal(overflow.ok, false);
});

test("joinRoom rejects unknown rooms and started games", () => {
  const { mgr, room } = withRoom();
  assert.equal(mgr.joinRoom("NOPE12", createPlayer("x", "X")).ok, false);

  mgr.setAnte("host", 3);
  mgr.setReady("host", true);
  fillReady(mgr, room, 2);
  assert.ok(mgr.startGame("host").ok);
  assert.equal(mgr.joinRoom(room.id, createPlayer("late", "Late")).ok, false);
});

test("listRooms shows live tables (including in-progress, for spectating)", () => {
  const { mgr, room } = withRoom();
  assert.equal(mgr.listRooms().length, 1);
  assert.equal(mgr.listRooms()[0].playerCount, 1);

  mgr.setAnte("host", 3);
  mgr.setReady("host", true);
  fillReady(mgr, room, 2);
  mgr.startGame("host");
  // Started rooms stay listed so they can be watched; the client gates Join.
  assert.equal(mgr.listRooms().length, 1);
  assert.equal(mgr.listRooms()[0].started, true);
});

test("setAnte: host only, integer >= minimum, sets the flag", () => {
  const { mgr, room } = withRoom();
  mgr.joinRoom(room.id, createPlayer("p1", "P1"));

  assert.equal(mgr.setAnte("p1", 6).ok, false, "non-host rejected");
  assert.equal(mgr.setAnte("host", 2).ok, false, "below minimum rejected");
  assert.equal(mgr.setAnte("host", 4.5).ok, false, "non-integer rejected");
  assert.equal(mgr.setAnte("host", 4).ok, false, "non-multiple-of-3 rejected");
  assert.equal(mgr.setAnte("host", 5).ok, false, "non-multiple-of-3 rejected");

  assert.ok(mgr.setAnte("host", 6).ok);
  assert.equal(room.state.anteAmount, 6);
  assert.equal(room.state.anteSet, true);
});

test("setAnte resets everyone's readiness", () => {
  const { mgr, room } = withRoom();
  mgr.setAnte("host", 3);
  mgr.setReady("host", true);
  mgr.joinRoom(room.id, createPlayer("p1", "P1"));
  mgr.setReady("p1", true);
  assert.ok(room.state.players.every((p) => p.ready));

  mgr.setAnte("host", 9); // raising the ante un-readies everyone
  assert.ok(room.state.players.every((p) => !p.ready));
});

test("setReady is blocked until the ante is set", () => {
  const { mgr } = withRoom();
  assert.equal(mgr.setReady("host", true).ok, false, "no ante yet");
  mgr.setAnte("host", 3);
  assert.ok(mgr.setReady("host", true).ok);
});

test("canStart requires ante set, 3+ players, all ready", () => {
  const { mgr, room } = withRoom();
  mgr.setAnte("host", 3);
  mgr.setReady("host", true);
  assert.equal(mgr.canStart(room), false, "only 1 player");

  fillReady(mgr, room, 1);
  assert.equal(mgr.canStart(room), false, "only 2 players");

  const [p] = fillReady(mgr, room, 1); // now 3 players, all ready
  assert.equal(mgr.canStart(room), true);

  mgr.setReady(p, false);
  assert.equal(mgr.canStart(room), false, "one not ready");
});

test("startGame gates on host + canStart and marks started", () => {
  const { mgr, room } = withRoom();
  mgr.setAnte("host", 3);
  mgr.setReady("host", true);
  fillReady(mgr, room, 2);

  assert.equal(mgr.startGame("p0").ok, false, "non-host cannot start");
  assert.ok(mgr.startGame("host").ok);
  assert.equal(room.started, true);
});

test("leaveRoom removes a player and reassigns the host", () => {
  const { mgr, room } = withRoom();
  mgr.joinRoom(room.id, createPlayer("p1", "P1"));

  const r = mgr.leaveRoom("host");
  assert.equal(r.closed, false);
  assert.equal(room.state.players.length, 1);
  assert.equal(room.hostId, "p1", "host passed to remaining player");
});

test("leaveRoom closes the room when the last player leaves", () => {
  const { mgr, room } = withRoom();
  const r = mgr.leaveRoom("host");
  assert.equal(r.closed, true);
  assert.equal(mgr.getRoom(room.id), undefined);
});

test("a player who left can create/join again", () => {
  const { mgr, host } = withRoom();
  mgr.leaveRoom("host");
  assert.ok(mgr.createRoom("Fresh", host).ok);
});

/** Build a ready-to-start gamble room with players at the given balances. */
function gambleRoom(balances: Record<string, number>, ante = 3) {
  const mgr = new RoomManager();
  const ids = Object.keys(balances);
  const host = createPlayer(ids[0], ids[0].toUpperCase());
  host.money = balances[ids[0]];
  const res = mgr.createRoom("Gamble Table", host, "gamble");
  assert.ok(res.ok);
  const room = res.value;
  for (const id of ids.slice(1)) {
    const p = createPlayer(id, id.toUpperCase());
    p.money = balances[id];
    assert.ok(mgr.joinRoom(room.id, p).ok);
  }
  assert.ok(mgr.setAnte("host", ante).ok);
  for (const id of ids) assert.ok(mgr.setReady(id, true).ok);
  return { mgr, room };
}

test("gamble: players who can't cover the pot sit out the hand", () => {
  // 4 players, ante 3 -> pot = 4*3 + 3 dealer extra = 15. Need money > 15.
  const { mgr, room } = gambleRoom({ host: 1000, r1: 1000, r2: 1000, broke: 5 });
  assert.ok(mgr.startGame("host").ok);

  const seated = room.state.players.map((p) => p.id).sort();
  assert.deepEqual(seated, ["host", "r1", "r2"]);
  assert.equal(room.sittingOut.length, 1);
  assert.equal(room.sittingOut[0].id, "broke");
  // The sitting-out player keeps their balance for a later rejoin.
  assert.equal(room.sittingOut[0].money, 5);
});

test("gamble: start fails when too few players can cover the pot", () => {
  // Only 2 of 3 can afford -> below MIN_PLAYERS.
  const { mgr } = gambleRoom({ host: 1000, r1: 1000, broke: 2 });
  const res = mgr.startGame("host");
  assert.equal(res.ok, false);
});

test("gamble: casual rooms never sit anyone out", () => {
  const mgr = new RoomManager();
  const host = createPlayer("host", "Host");
  host.money = 1; // wouldn't cover a gamble pot, but casual ignores money
  const created = mgr.createRoom("Casual", host, "casual");
  assert.ok(created.ok);
  const room = created.value;
  mgr.setAnte("host", 3);
  mgr.setReady("host", true);
  fillReady(mgr, room, 2);
  assert.ok(mgr.startGame("host").ok);
  assert.equal(room.sittingOut.length, 0);
  assert.equal(room.state.players.length, 3);
});

test("friends-only rooms are hidden from non-friends", () => {
  const mgr = new RoomManager();
  const secretHost = createPlayer("host", "Host");
  assert.ok(mgr.createRoom("Secret", secretHost, "casual", true).ok);
  const pubHost = createPlayer("pub", "Pub");
  assert.ok(mgr.createRoom("Public", pubHost, "casual", false).ok);

  const none = new Set<string>();
  const names = (viewer: string, friends: Set<string>) =>
    mgr.listRoomsVisibleTo(viewer, friends).map((r) => r.name).sort();

  assert.deepEqual(names("stranger", none), ["Public"], "stranger: friends-only hidden");
  assert.deepEqual(names("host", none), ["Public", "Secret"], "host sees own table");
  assert.deepEqual(
    names("buddy", new Set(["host"])),
    ["Public", "Secret"],
    "a friend of the host sees it",
  );
});

test("a started game below the minimum re-opens for a joiner (refill)", () => {
  const { mgr, room } = withRoom();
  mgr.setAnte("host", 3);
  mgr.setReady("host", true);
  const [, p1] = fillReady(mgr, room, 2); // 3 players, all ready
  assert.ok(mgr.startGame("host").ok);

  // A full (>= MIN) started game still rejects joiners.
  assert.equal(mgr.joinRoom(room.id, createPlayer("late", "Late")).ok, false);
  assert.equal(roomSummary(room).needsPlayers, false);

  // Drop below the minimum.
  mgr.leaveRoom(p1);
  assert.equal(room.state.players.length, 2);
  assert.equal(roomSummary(room).needsPlayers, true, "now open to refill");

  // A joiner can fill the seat even though the game is started.
  assert.ok(mgr.joinRoom(room.id, createPlayer("refill", "Refill")).ok);
  assert.equal(room.state.players.length, 3);
  assert.equal(roomSummary(room).needsPlayers, false, "back at the minimum");
});

test("setDecisionTime: host only, validated multiplier, defaults to 1", () => {
  const { mgr, room } = withRoom();
  assert.equal(room.state.decisionMult, 1, "defaults to Normal");
  mgr.joinRoom(room.id, createPlayer("p1", "P1"));

  assert.equal(mgr.setDecisionTime("p1", 2).ok, false, "non-host rejected");
  assert.equal(mgr.setDecisionTime("host", 3).ok, false, "invalid multiplier rejected");
  assert.equal(mgr.setDecisionTime("host", 1.5).ok, false, "invalid multiplier rejected");

  assert.ok(mgr.setDecisionTime("host", 0.5).ok);
  assert.equal(room.state.decisionMult, 0.5);
  assert.ok(mgr.setDecisionTime("host", 0).ok, "0 = Infinite is valid");
  assert.equal(room.state.decisionMult, 0);
});
