import { test } from "node:test";
import assert from "node:assert/strict";

import { RoomManager } from "./roomManager.js";
import { MAX_PLAYERS } from "./room.js";
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
