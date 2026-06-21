// Thin Socket.io handlers for the lobby/room lifecycle. These translate client
// events into RoomManager calls and broadcast the results. No game rules live
// here — that's the RoomManager's job (and game/ for in-hand logic later).

import type { Server, Socket } from "socket.io";
import { RoomManager, type Result } from "../rooms/roomManager.js";
import type { Room } from "../rooms/room.js";
import { createPlayer } from "../game/state.js";
import { viewFor } from "../game/view.js";

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

type Ack = ((response: unknown) => void) | undefined;

/** Ack a Result, broadcasting the updated room on success. */
function settle(io: Server, res: Result<Room>, ack: Ack) {
  if (!res.ok) {
    ack?.({ ok: false, error: res.error });
    return;
  }
  ack?.({ ok: true });
  broadcastRoom(io, res.value);
}

/** Leave whatever room this socket is in, broadcasting to anyone still there. */
function handleLeave(io: Server, socket: Socket) {
  const { room, closed } = manager.leaveRoom(socket.id);
  if (room && !closed) broadcastRoom(io, room);
  if (room) socket.leave(room.id);
  broadcastLobby(io);
}

export function registerLobbyHandlers(io: Server, socket: Socket) {
  socket.on("lobby:list", (ack: Ack) => ack?.(manager.listRooms()));

  socket.on(
    "room:create",
    (payload: { name?: string; playerName?: string }, ack: Ack) => {
      const player = createPlayer(socket.id, sanitizeName(payload?.playerName));
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
      const player = createPlayer(socket.id, sanitizeName(payload?.playerName));
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

  socket.on("room:setAnte", (payload: { amount?: number }, ack: Ack) => {
    settle(io, manager.setAnte(socket.id, Number(payload?.amount)), ack);
  });

  socket.on("room:ready", (payload: { ready?: boolean }, ack: Ack) => {
    settle(io, manager.setReady(socket.id, !!payload?.ready), ack);
  });

  socket.on("room:start", (ack: Ack) => {
    const res = manager.startGame(socket.id);
    settle(io, res, ack);
    if (res.ok) broadcastLobby(io); // started room drops out of the lobby
  });

  socket.on("room:keepTrump", (payload: { keep?: boolean }, ack: Ack) => {
    settle(io, manager.keepTrump(socket.id, !!payload?.keep), ack);
  });

  socket.on("room:knock", (payload: { knock?: boolean }, ack: Ack) => {
    settle(io, manager.knock(socket.id, !!payload?.knock), ack);
  });

  socket.on("room:discard", (payload: { indices?: number[] }, ack: Ack) => {
    const indices = Array.isArray(payload?.indices) ? payload.indices : [];
    settle(io, manager.discard(socket.id, indices), ack);
  });

  socket.on("room:nextHand", (ack: Ack) => {
    const res = manager.nextHand(socket.id);
    settle(io, res, ack);
  });

  socket.on("disconnect", () => handleLeave(io, socket));
}
