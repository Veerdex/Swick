// Thin Socket.io handlers for the lobby/room lifecycle. These translate client
// events into RoomManager calls and broadcast the results. No game rules live
// here — that's the RoomManager's job (and game/ for in-hand logic later).

import type { Server, Socket } from "socket.io";
import { RoomManager, type Result } from "../rooms/roomManager.js";
import type { Room } from "../rooms/room.js";
import { createPlayer } from "../game/state.js";
import { viewFor } from "../game/view.js";
import {
  botTrumpDecision,
  botKnockDecision,
  botDiscardDecision,
  botPlayDecision,
} from "../game/bots.js";
import {
  setUsername,
  setCurrency,
  listFriends,
  addFriend,
  respondFriend,
  removeFriend,
  acceptedFriendIds,
  type Friend,
} from "../lib/db.js";
import type { GameMode } from "../rooms/room.js";

// One shared manager for the whole server process (in-memory state).
const manager = new RoomManager();

/** The room view for one specific viewer (hidden info filtered out). */
function roomStateFor(room: Room, viewerId: string) {
  return {
    id: room.id,
    name: room.name,
    hostId: room.hostId,
    mode: room.mode,
    started: room.started,
    canStart: manager.canStart(room),
    youId: viewerId,
    // Spectators and sitting-out players aren't in state.players, so viewFor
    // already hides every hand; these flags drive the watcher UI.
    isSpectator:
      room.spectators.some((s) => s.id === viewerId) ||
      room.sittingOut.some((p) => p.id === viewerId),
    isSittingOut: room.sittingOut.some((p) => p.id === viewerId),
    state: viewFor(room.state, viewerId),
  };
}

/**
 * Broadcast to every member individually, since each player gets a different
 * filtered view (their own hand; the dealer stays blind). Each socket auto-joins
 * a room named by its own id, so io.to(playerId) targets exactly that client.
 */
function broadcastRoom(io: Server, room: Room) {
  for (const player of room.state.players) {
    io.to(player.id).emit("room:state", roomStateFor(room, player.id));
  }
  for (const watcher of room.spectators) {
    io.to(watcher.id).emit("room:state", roomStateFor(room, watcher.id));
  }
  for (const sitter of room.sittingOut) {
    io.to(sitter.id).emit("room:state", roomStateFor(room, sitter.id));
  }
}

/** A socket's friend-id set (host ids it's allowed to see friends-only tables for). */
const friendIdsOf = (socket: Socket): Set<string> =>
  (socket.data.friendIds as Set<string>) ?? new Set<string>();

/** The lobby list as a specific viewer should see it (friends-only filtered). */
const lobbyFor = (socket: Socket) =>
  manager.listRoomsVisibleTo(socket.data.userId as string, friendIdsOf(socket));

/** Friends-only tables differ per viewer, so each socket gets its own list. */
function broadcastLobby(io: Server) {
  for (const s of io.sockets.sockets.values()) {
    s.emit("lobby:rooms", lobbyFor(s));
  }
}

/** Accepted friend ids from a friends list (for refreshing the cached set). */
const acceptedSet = (friends: Friend[]): Set<string> =>
  new Set(friends.filter((f) => f.status === "accepted").map((f) => f.id));

/**
 * Re-fetch a user's accepted-friend ids onto all their connected sockets and
 * push them a fresh lobby list — so a newly added/removed friendship updates
 * which friends-only tables they can see, on both sides.
 */
async function refreshFriendIds(io: Server, userId: string) {
  let ids: Set<string>;
  try {
    ids = new Set(await acceptedFriendIds(userId));
  } catch (err) {
    console.error("refreshFriendIds failed:", err);
    return;
  }
  for (const s of io.sockets.sockets.values()) {
    if (s.data.userId === userId) {
      s.data.friendIds = ids;
      s.emit("lobby:rooms", lobbyFor(s));
    }
  }
}

// --- Bot driver ------------------------------------------------------------
// When the current actor is a bot, act on a short delay so humans can follow
// along, then chain to the next bot. One pending timer per room.
const BOT_DELAY_MS = 800;
const botPending = new Set<string>();

/** The bot whose turn it is right now (by phase), or null. */
function currentBotActor(room: Room): string | null {
  const s = room.state;
  let id: string | null = null;
  if (s.roundState === "trump-selection") id = s.dealerId;
  else if (s.roundState === "knock-in") id = s.currentKnockPlayerId;
  else if (s.roundState === "discard-draw") id = s.currentDiscardPlayerId;
  else if (s.roundState === "turns") id = s.currentTurnPlayerId;
  if (!id) return null;
  const p = s.players.find((x) => x.id === id);
  return p?.isBot ? id : null;
}

function performBotAction(room: Room, botId: string) {
  const s = room.state;
  switch (s.roundState) {
    case "trump-selection":
      manager.keepTrump(botId, botTrumpDecision(s));
      break;
    case "knock-in":
      manager.knock(botId, botKnockDecision(s, botId));
      break;
    case "discard-draw":
      manager.discard(botId, botDiscardDecision(s, botId));
      break;
    case "turns":
      manager.playCard(botId, botPlayDecision(s, botId));
      break;
  }
}

/** If a bot is up, schedule its move (and the chain that follows). */
function driveBots(io: Server, roomId: string) {
  if (botPending.has(roomId)) return;
  const room = manager.getRoom(roomId);
  if (!room || !currentBotActor(room)) return;

  botPending.add(roomId);
  setTimeout(() => {
    botPending.delete(roomId);
    const room = manager.getRoom(roomId);
    if (!room) return;
    const botId = currentBotActor(room);
    if (!botId) return;
    try {
      performBotAction(room, botId);
    } catch (err) {
      console.error(`[bot] ${botId} failed:`, err);
      return;
    }
    broadcastRoom(io, room);
    driveTable(io, roomId); // next bot, or pause on a completed trick
  }, BOT_DELAY_MS);
}

// After a completed trick the table sits in "trick-complete" with the cards
// still showing. Hold that for a beat so everyone sees the trick and the
// winner, then clear it and continue.
const TRICK_PAUSE_MS = 1600;
const trickPending = new Set<string>();
function scheduleTrickAdvance(io: Server, roomId: string) {
  if (trickPending.has(roomId)) return;
  trickPending.add(roomId);
  setTimeout(() => {
    trickPending.delete(roomId);
    const res = manager.finishTrick(roomId);
    if (!res.ok) return;
    broadcastRoom(io, res.value);
    persistGamble(res.value);
    driveTable(io, roomId); // next trick's bots, or the end of the hand
  }, TRICK_PAUSE_MS);
}

// Once everyone has knocked in, knock-in holds (currentKnockPlayerId === null)
// so the last decision is visible. Pause ~2s, then advance the hand.
const KNOCK_PAUSE_MS = 2000;
const knockPending = new Set<string>();
function scheduleKnockAdvance(io: Server, roomId: string) {
  if (knockPending.has(roomId)) return;
  knockPending.add(roomId);
  setTimeout(() => {
    knockPending.delete(roomId);
    const res = manager.finishKnockIn(roomId);
    if (!res.ok) return;
    broadcastRoom(io, res.value);
    persistGamble(res.value);
    driveTable(io, roomId);
  }, KNOCK_PAUSE_MS);
}

/** Drive whatever the table needs next: finish a completed trick, or move bots. */
function driveTable(io: Server, roomId: string) {
  const room = manager.getRoom(roomId);
  if (!room) return;
  const s = room.state;
  if (s.roundState === "trick-complete") {
    scheduleTrickAdvance(io, roomId);
  } else if (s.roundState === "knock-in" && s.currentKnockPlayerId === null) {
    scheduleKnockAdvance(io, roomId);
  } else {
    driveBots(io, roomId);
  }
}

type Ack = ((response: unknown) => void) | undefined;

/** At a gamble hand's end, persist each human player's balance to their account. */
function persistGamble(room: Room) {
  if (room.mode !== "gamble" || room.state.roundState !== "end") return;
  for (const p of room.state.players) {
    if (p.isBot) continue;
    setCurrency(p.id, p.money).catch((e) => console.error("persistGamble:", e));
  }
}

/** Ack a Result, broadcasting the updated room on success and driving bots. */
function settle(io: Server, res: Result<Room>, ack: Ack) {
  if (!res.ok) {
    ack?.({ ok: false, error: res.error });
    return;
  }
  ack?.({ ok: true });
  broadcastRoom(io, res.value);
  persistGamble(res.value);
  driveTable(io, res.value.id);
}

/** Leave whatever room this player is in, broadcasting to anyone still there. */
function handleLeave(io: Server, socket: Socket) {
  const userId = socket.data.userId as string;
  // In a gamble game, save their current balance before they leave the seat.
  const before = manager.getRoomForPlayer(userId);
  if (before?.mode === "gamble") {
    const me = before.state.players.find((p) => p.id === userId);
    if (me) setCurrency(userId, me.money).catch((e) => console.error("leave save:", e));
  }
  const { room, closed } = manager.leaveRoom(userId);
  if (room && !closed) broadcastRoom(io, room);
  if (room) socket.leave(room.id);
  broadcastLobby(io);
}

export function registerLobbyHandlers(io: Server, socket: Socket) {
  // The authoritative player key (verified user) and their unique username,
  // which is the in-game name — the client no longer supplies a name.
  const userId = socket.data.userId as string;
  const nameOf = () => (socket.data.username as string) ?? "Player";
  const isGuest = () => socket.data.isGuest === true;
  const balance = () => (socket.data.currency as number) ?? 0;

  socket.on("lobby:list", (ack: Ack) => ack?.(lobbyFor(socket)));

  // The client's own profile (username + balance) for the lobby.
  socket.on("profile:get", (ack: Ack) =>
    ack?.({
      username: socket.data.username as string,
      currency: socket.data.currency as number,
    }),
  );

  socket.on(
    "room:create",
    (payload: { name?: string; mode?: GameMode; friendsOnly?: boolean }, ack: Ack) => {
      const mode: GameMode = payload?.mode === "gamble" ? "gamble" : "casual";
      const friendsOnly = payload?.friendsOnly === true;
      if (mode === "gamble" && isGuest()) {
        return ack?.({ ok: false, error: "Gamble mode requires an account" });
      }
      if (friendsOnly && isGuest()) {
        return ack?.({ ok: false, error: "Friends-only tables require an account" });
      }
      const player = createPlayer(userId, nameOf());
      if (mode === "gamble") player.money = balance(); // play with real currency
      const res = manager.createRoom(payload?.name ?? "", player, mode, friendsOnly);
      if (!res.ok) return ack?.({ ok: false, error: res.error });

      socket.join(res.value.id);
      ack?.({ ok: true, roomId: res.value.id });
      broadcastRoom(io, res.value);
      broadcastLobby(io);
    },
  );

  socket.on("room:join", (payload: { roomId?: string }, ack: Ack) => {
    const room = manager.getRoom(payload?.roomId ?? "");
    // A friends-only table is invisible to non-friends — treat as not found so
    // we don't leak its existence.
    if (room && !manager.canSee(room, userId, friendIdsOf(socket))) {
      return ack?.({ ok: false, error: "Room not found" });
    }
    if (room?.mode === "gamble") {
      if (isGuest()) {
        return ack?.({ ok: false, error: "Gamble mode requires an account" });
      }
      if (balance() <= room.state.potValue) {
        return ack?.({ ok: false, error: "You need more than the pot to join" });
      }
    }
    const player = createPlayer(userId, nameOf());
    if (room?.mode === "gamble") player.money = balance();
    const res = manager.joinRoom(payload?.roomId ?? "", player);
    if (!res.ok) return ack?.({ ok: false, error: res.error });

    socket.join(res.value.id);
    ack?.({ ok: true, roomId: res.value.id });
    broadcastRoom(io, res.value);
    broadcastLobby(io);
  });

  socket.on("room:spectate", (payload: { roomId?: string }, ack: Ack) => {
    const room = manager.getRoom(payload?.roomId ?? "");
    if (room && !manager.canSee(room, userId, friendIdsOf(socket))) {
      return ack?.({ ok: false, error: "Room not found" });
    }
    const res = manager.spectate(payload?.roomId ?? "", userId, nameOf());
    if (!res.ok) return ack?.({ ok: false, error: res.error });

    socket.join(res.value.id);
    ack?.({ ok: true, roomId: res.value.id });
    broadcastRoom(io, res.value);
    broadcastLobby(io);
  });

  // Change the player's unique username (server validates + enforces uniqueness).
  socket.on(
    "profile:setUsername",
    async (payload: { username?: string }, ack: Ack) => {
      try {
        const result = await setUsername(userId, String(payload?.username ?? ""));
        if (result !== "ok") return ack?.({ ok: false, error: result });
        socket.data.username = String(payload?.username).trim();
        ack?.({ ok: true });
      } catch (err) {
        console.error("setUsername failed:", err);
        ack?.({ ok: false, error: "error" });
      }
    },
  );

  // --- Friends (accounts only — guests have no stable identity) ------------

  socket.on("friends:list", async (ack: Ack) => {
    if (isGuest()) return ack?.({ ok: false, error: "Sign in to add friends" });
    try {
      ack?.({ ok: true, friends: await listFriends(userId) });
    } catch (err) {
      console.error("friends:list failed:", err);
      ack?.({ ok: false, error: "error" });
    }
  });

  socket.on("friends:add", async (payload: { username?: string }, ack: Ack) => {
    if (isGuest()) return ack?.({ ok: false, error: "Sign in to add friends" });
    try {
      const result = await addFriend(userId, String(payload?.username ?? ""));
      const friends = await listFriends(userId);
      // Refresh our friend set + lobby (a reverse-request auto-accept here means
      // a new friend, so friends-only tables may now be visible).
      socket.data.friendIds = acceptedSet(friends);
      socket.emit("lobby:rooms", lobbyFor(socket));
      ack?.({ ok: true, result, friends });
    } catch (err) {
      console.error("friends:add failed:", err);
      ack?.({ ok: false, error: "error" });
    }
  });

  socket.on(
    "friends:respond",
    async (payload: { userId?: string; accept?: boolean }, ack: Ack) => {
      if (isGuest()) return ack?.({ ok: false, error: "Sign in to add friends" });
      try {
        const otherId = String(payload?.userId ?? "");
        await respondFriend(userId, otherId, !!payload?.accept);
        const friends = await listFriends(userId);
        socket.data.friendIds = acceptedSet(friends);
        socket.emit("lobby:rooms", lobbyFor(socket));
        // The other side's friend set changed too — update their lobby.
        refreshFriendIds(io, otherId);
        ack?.({ ok: true, friends });
      } catch (err) {
        console.error("friends:respond failed:", err);
        ack?.({ ok: false, error: "error" });
      }
    },
  );

  socket.on("friends:remove", async (payload: { userId?: string }, ack: Ack) => {
    if (isGuest()) return ack?.({ ok: false, error: "Sign in to add friends" });
    try {
      const otherId = String(payload?.userId ?? "");
      await removeFriend(userId, otherId);
      const friends = await listFriends(userId);
      socket.data.friendIds = acceptedSet(friends);
      socket.emit("lobby:rooms", lobbyFor(socket));
      refreshFriendIds(io, otherId); // they lose visibility of our friends-only tables
      ack?.({ ok: true, friends });
    } catch (err) {
      console.error("friends:remove failed:", err);
      ack?.({ ok: false, error: "error" });
    }
  });

  socket.on("room:leave", (ack: Ack) => {
    handleLeave(io, socket);
    ack?.({ ok: true });
  });

  socket.on("room:addBot", (ack: Ack) => {
    const res = manager.addBot(userId);
    settle(io, res, ack);
    if (res.ok) broadcastLobby(io);
  });

  socket.on("room:removeBot", (payload: { botId?: string }, ack: Ack) => {
    const res = manager.removeBot(userId, String(payload?.botId ?? ""));
    settle(io, res, ack);
    if (res.ok) broadcastLobby(io);
  });

  socket.on("room:setAnte", (payload: { amount?: number }, ack: Ack) => {
    settle(io, manager.setAnte(userId, Number(payload?.amount)), ack);
  });

  socket.on("room:ready", (payload: { ready?: boolean }, ack: Ack) => {
    settle(io, manager.setReady(userId, !!payload?.ready), ack);
  });

  socket.on("room:start", (ack: Ack) => {
    const res = manager.startGame(userId);
    settle(io, res, ack);
    if (res.ok) broadcastLobby(io); // started room drops out of the lobby
  });

  socket.on("room:keepTrump", (payload: { keep?: boolean }, ack: Ack) => {
    settle(io, manager.keepTrump(userId, !!payload?.keep), ack);
  });

  socket.on("room:knock", (payload: { knock?: boolean }, ack: Ack) => {
    settle(io, manager.knock(userId, !!payload?.knock), ack);
  });

  socket.on("room:discard", (payload: { indices?: number[] }, ack: Ack) => {
    const indices = Array.isArray(payload?.indices) ? payload.indices : [];
    settle(io, manager.discard(userId, indices), ack);
  });

  socket.on("room:playCard", (payload: { index?: number }, ack: Ack) => {
    settle(io, manager.playCard(userId, Number(payload?.index)), ack);
  });

  socket.on("room:nextHand", (ack: Ack) => {
    const res = manager.nextHand(userId);
    settle(io, res, ack);
  });

  socket.on("disconnect", () => handleLeave(io, socket));
}
