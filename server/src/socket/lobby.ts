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

// One shared manager for the whole server process (in-memory state).
const manager = new RoomManager();

const MAX_NAME = 20;
function sanitizeName(raw: unknown): string {
  const name = typeof raw === "string" ? raw.trim().slice(0, MAX_NAME) : "";
  return name || "Player";
}

/** The room view for one specific viewer (hidden info filtered out). */
function roomStateFor(room: Room, viewerId: string) {
  return {
    id: room.id,
    name: room.name,
    hostId: room.hostId,
    started: room.started,
    canStart: manager.canStart(room),
    youId: viewerId,
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
}

function broadcastLobby(io: Server) {
  io.emit("lobby:rooms", manager.listRooms());
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

/** Ack a Result, broadcasting the updated room on success and driving bots. */
function settle(io: Server, res: Result<Room>, ack: Ack) {
  if (!res.ok) {
    ack?.({ ok: false, error: res.error });
    return;
  }
  ack?.({ ok: true });
  broadcastRoom(io, res.value);
  driveTable(io, res.value.id);
}

/** Leave whatever room this player is in, broadcasting to anyone still there. */
function handleLeave(io: Server, socket: Socket) {
  const userId = socket.data.userId as string;
  const { room, closed } = manager.leaveRoom(userId);
  if (room && !closed) broadcastRoom(io, room);
  if (room) socket.leave(room.id);
  broadcastLobby(io);
}

export function registerLobbyHandlers(io: Server, socket: Socket) {
  // The authoritative player key for this connection (verified Supabase user).
  const userId = socket.data.userId as string;

  socket.on("lobby:list", (ack: Ack) => ack?.(manager.listRooms()));

  socket.on(
    "room:create",
    (payload: { name?: string; playerName?: string }, ack: Ack) => {
      const player = createPlayer(userId, sanitizeName(payload?.playerName));
      const res = manager.createRoom(payload?.name ?? "", player);
      if (!res.ok) return ack?.({ ok: false, error: res.error });

      socket.join(res.value.id);
      ack?.({ ok: true, roomId: res.value.id });
      broadcastRoom(io, res.value);
      broadcastLobby(io);
    },
  );

  socket.on(
    "room:join",
    (payload: { roomId?: string; playerName?: string }, ack: Ack) => {
      const player = createPlayer(userId, sanitizeName(payload?.playerName));
      const res = manager.joinRoom(payload?.roomId ?? "", player);
      if (!res.ok) return ack?.({ ok: false, error: res.error });

      socket.join(res.value.id);
      ack?.({ ok: true, roomId: res.value.id });
      broadcastRoom(io, res.value);
      broadcastLobby(io);
    },
  );

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
