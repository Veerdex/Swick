// In-memory registry of rooms and the rules for the lobby lifecycle:
// create/join/leave, listing joinable rooms, ante setting, readiness, and the
// 3-player minimum to start.
//
// Pure logic, no sockets — every method returns a Result so the (thin) socket
// layer just translates the outcome into emits/acks. This keeps the lobby
// rules unit-testable without a network.

import { randomBytes } from "node:crypto";
import {
  type Room,
  type RoomSummary,
  type GameMode,
  createRoom,
  roomSummary,
  MIN_PLAYERS,
  MAX_PLAYERS,
} from "./room.js";
import { type PlayerState, MIN_ANTE, createPlayer } from "../game/state.js";
import { startHand, dealerTrumpDecision, DEALER_EXTRA } from "../game/dealing.js";
import { applyKnock, finishKnockIn } from "../game/knockIn.js";
import { applyDiscard } from "../game/discard.js";
import { playCard, finishTrick } from "../game/tricks.js";

export type Result<T = void> =
  | { ok: true; value: T }
  | { ok: false; error: string };

const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = (error: string): Result<never> => ({ ok: false, error });

const BOT_NAMES = [
  "Botworth",
  "Cara-bot",
  "Tin Tristan",
  "RoboRiver",
  "Chip",
  "Ada",
];

/** Generate a short, human-friendly room code (e.g. "K3F9Q2"). */
function makeRoomCode(): string {
  return randomBytes(4).toString("hex").slice(0, 6).toUpperCase();
}

export class RoomManager {
  private rooms = new Map<string, Room>();
  /** playerId -> roomId, so we can find/leave a player's room in O(1). */
  private playerRoom = new Map<string, string>();

  getRoom(id: string): Room | undefined {
    return this.rooms.get(id);
  }

  getRoomForPlayer(playerId: string): Room | undefined {
    const roomId = this.playerRoom.get(playerId);
    return roomId ? this.rooms.get(roomId) : undefined;
  }

  /** Rooms that can still be joined (not started, not full). */
  listRooms(): RoomSummary[] {
    // All live tables — in-progress ones can still be spectated (the client
    // gates the Join button on started/full).
    return [...this.rooms.values()]
      .sort((a, b) => a.createdAt - b.createdAt)
      .map(roomSummary);
  }

  /**
   * Rooms visible to a given viewer. A friends-only table is shown only to its
   * host and the host's accepted friends (passed in as a set of host ids the
   * viewer is friends with). Public tables are visible to everyone.
   */
  listRoomsVisibleTo(
    viewerId: string,
    friendIds: ReadonlySet<string>,
  ): RoomSummary[] {
    return [...this.rooms.values()]
      .filter((r) => this.canSee(r, viewerId, friendIds))
      .sort((a, b) => a.createdAt - b.createdAt)
      .map(roomSummary);
  }

  /** Whether a viewer may see/join a room (friends-only gate). */
  canSee(
    room: Room,
    viewerId: string,
    friendIds: ReadonlySet<string>,
  ): boolean {
    return (
      !room.friendsOnly ||
      room.hostId === viewerId ||
      friendIds.has(room.hostId)
    );
  }

  createRoom(
    name: string,
    host: PlayerState,
    mode: GameMode = "casual",
    friendsOnly = false,
  ): Result<Room> {
    if (this.playerRoom.has(host.id)) return fail("You are already in a room");

    let id = makeRoomCode();
    while (this.rooms.has(id)) id = makeRoomCode();

    const room = createRoom(id, name, host, mode, friendsOnly);
    this.rooms.set(id, room);
    this.playerRoom.set(host.id, id);
    return ok(room);
  }

  joinRoom(roomId: string, player: PlayerState): Result<Room> {
    const room = this.rooms.get(roomId);
    if (!room) return fail("Room not found");
    if (room.started) return fail("That game has already started");
    if (this.playerRoom.has(player.id)) return fail("You are already in a room");
    if (room.state.players.length >= MAX_PLAYERS) return fail("Room is full");

    room.state.players.push(player);
    this.playerRoom.set(player.id, roomId);
    // A new arrival changes who's ready relative to the seat count; the new
    // player simply starts un-ready, which is already their default.
    return ok(room);
  }

  /** Join a room as a watcher (any table, including in-progress ones). */
  spectate(roomId: string, userId: string, name: string): Result<Room> {
    const room = this.rooms.get(roomId);
    if (!room) return fail("Room not found");
    if (this.playerRoom.has(userId)) return fail("You are already in a room");

    room.spectators.push({ id: userId, name });
    this.playerRoom.set(userId, roomId);
    return ok(room);
  }

  /**
   * Remove a player from their room. The room is closed once no humans remain
   * (bots can't host); otherwise the host, if they left, passes to another
   * human. Returns the affected room and whether it was closed.
   */
  leaveRoom(playerId: string): { room?: Room; closed: boolean } {
    const roomId = this.playerRoom.get(playerId);
    this.playerRoom.delete(playerId);
    if (!roomId) return { closed: false };

    const room = this.rooms.get(roomId);
    if (!room) return { closed: false };

    // A watcher leaving just drops out of the spectator list.
    if (room.spectators.some((s) => s.id === playerId)) {
      room.spectators = room.spectators.filter((s) => s.id !== playerId);
      return { room, closed: false };
    }
    // A sitting-out player leaving drops out of that list.
    if (room.sittingOut.some((p) => p.id === playerId)) {
      room.sittingOut = room.sittingOut.filter((p) => p.id !== playerId);
      return { room, closed: false };
    }

    room.state.players = room.state.players.filter((p) => p.id !== playerId);

    const humans = room.state.players.filter((p) => !p.isBot);
    if (humans.length === 0) {
      // No humans left — close the room and release any bots + watchers.
      for (const p of room.state.players) this.playerRoom.delete(p.id);
      for (const s of room.spectators) this.playerRoom.delete(s.id);
      for (const p of room.sittingOut) this.playerRoom.delete(p.id);
      this.rooms.delete(roomId);
      return { room, closed: true };
    }

    if (room.hostId === playerId) {
      room.hostId = humans[0].id; // host always passes to a human
    }
    return { room, closed: false };
  }

  /** Host adds a bot to fill a seat. Bots are always ready. */
  addBot(hostId: string): Result<Room> {
    const room = this.getRoomForPlayer(hostId);
    if (!room) return fail("You are not in a room");
    if (room.hostId !== hostId) return fail("Only the host can add bots");
    if (room.mode === "gamble") return fail("Gamble tables are human-only");
    if (room.started) return fail("Game already started");
    if (room.state.players.length >= MAX_PLAYERS) return fail("Room is full");

    const taken = new Set(room.state.players.map((p) => p.name));
    const base = BOT_NAMES.find((n) => !taken.has(n)) ?? "Bot";
    let name = base;
    for (let k = 2; taken.has(name); k++) name = `${base} ${k}`;

    const id = `bot-${randomBytes(4).toString("hex")}`;
    const bot = createPlayer(id, name, true);
    bot.ready = true; // bots are always ready
    room.state.players.push(bot);
    this.playerRoom.set(id, room.id);
    return ok(room);
  }

  /** Host removes a bot from the room. */
  removeBot(hostId: string, botId: string): Result<Room> {
    const room = this.getRoomForPlayer(hostId);
    if (!room) return fail("You are not in a room");
    if (room.hostId !== hostId) return fail("Only the host can remove bots");
    if (room.started) return fail("Game already started");
    const bot = room.state.players.find((p) => p.id === botId && p.isBot);
    if (!bot) return fail("No such bot");

    room.state.players = room.state.players.filter((p) => p.id !== botId);
    this.playerRoom.delete(botId);
    return ok(room);
  }

  /** Host sets the ante (>= the 3¢ minimum). Resets readiness so players reconfirm. */
  setAnte(playerId: string, amount: number): Result<Room> {
    const room = this.getRoomForPlayer(playerId);
    if (!room) return fail("You are not in a room");
    if (room.started) return fail("Game already started");
    if (room.hostId !== playerId) return fail("Only the host sets the ante");
    if (!Number.isInteger(amount) || amount < MIN_ANTE || amount % 3 !== 0) {
      // Multiples of 3 keep the pot (players x ante + 3 dealer extra)
      // divisible by 3 for any player count.
      return fail(`Ante must be a multiple of ${MIN_ANTE}¢ (at least ${MIN_ANTE}¢)`);
    }

    room.state.anteAmount = amount;
    room.state.anteSet = true;
    for (const p of room.state.players) if (!p.isBot) p.ready = false;
    return ok(room);
  }

  /** Toggle a player's readiness. Can't ready before the ante is set. */
  setReady(playerId: string, ready: boolean): Result<Room> {
    const room = this.getRoomForPlayer(playerId);
    if (!room) return fail("You are not in a room");
    if (room.started) return fail("Game already started");
    if (ready && !room.state.anteSet) return fail("The ante hasn't been set yet");

    const player = room.state.players.find((p) => p.id === playerId);
    if (!player) return fail("Player not in room");
    player.ready = ready;
    return ok(room);
  }

  /** Can this room begin a hand? Ante set, 3+ players, every human ready. */
  canStart(room: Room): boolean {
    return (
      room.state.anteSet &&
      room.state.players.length >= MIN_PLAYERS &&
      room.state.players.every((p) => p.isBot || p.ready)
    );
  }

  /**
   * Before a gamble hand, re-seat sitting-out players who can now afford the pot
   * and drop seated players who can't. Casual rooms are untouched. Returns how
   * many players will actually be in the hand.
   */
  private reseatGamble(room: Room): number {
    if (room.mode !== "gamble") return room.state.players.length;

    const all = [...room.state.players, ...room.sittingOut];
    const ante = room.state.anteAmount;
    const carried = room.state.nextRoundPotBonus;
    // The pot a hand would create — a carried set bonus is a free ride (no new
    // antes). You must be able to cover it (a set costs the pot) to play.
    const pot = (carried > 0 ? 0 : all.length * ante) + DEALER_EXTRA + carried;

    const seated: PlayerState[] = [];
    const out: PlayerState[] = [];
    for (const p of all) (p.money > pot ? seated : out).push(p);
    room.state.players = seated;
    room.sittingOut = out;
    return seated.length;
  }

  /**
   * Host starts the game: mark the room started (removing it from the lobby)
   * and deal the first hand, leaving the dealer to decide on the trump card.
   */
  startGame(playerId: string): Result<Room> {
    const room = this.getRoomForPlayer(playerId);
    if (!room) return fail("You are not in a room");
    if (room.hostId !== playerId) return fail("Only the host can start the game");
    if (room.state.players.length < MIN_PLAYERS) {
      return fail(`Need at least ${MIN_PLAYERS} players to start`);
    }
    if (!this.canStart(room)) {
      return fail("Everyone must be ready and the ante must be set");
    }
    if (this.reseatGamble(room) < MIN_PLAYERS) {
      return fail(`Need ${MIN_PLAYERS} players who can cover the pot`);
    }

    room.started = true;
    startHand(room.state);
    return ok(room);
  }

  /** The dealer keeps or passes on the flipped trump card. */
  keepTrump(playerId: string, keep: boolean): Result<Room> {
    const room = this.getRoomForPlayer(playerId);
    if (!room) return fail("You are not in a room");
    if (room.state.roundState !== "trump-selection") {
      return fail("It isn't trump-selection time");
    }
    if (room.state.dealerId !== playerId) {
      return fail("Only the dealer decides on the trump card");
    }

    dealerTrumpDecision(room.state, keep);
    return ok(room);
  }

  /** A player knocks in or passes during the knock-in phase. */
  knock(playerId: string, knockIn: boolean): Result<Room> {
    const room = this.getRoomForPlayer(playerId);
    if (!room) return fail("You are not in a room");
    if (room.state.roundState !== "knock-in") return fail("It isn't knock-in time");
    if (room.state.currentKnockPlayerId !== playerId) {
      return fail("It isn't your turn to knock");
    }

    applyKnock(room.state, playerId, knockIn);
    return ok(room);
  }

  /** A knocked-in player discards the chosen card indices (and draws). */
  discard(playerId: string, indices: number[]): Result<Room> {
    const room = this.getRoomForPlayer(playerId);
    if (!room) return fail("You are not in a room");
    if (room.state.roundState !== "discard-draw") {
      return fail("It isn't discard time");
    }
    if (room.state.currentDiscardPlayerId !== playerId) {
      return fail("It isn't your turn to discard");
    }

    applyDiscard(room.state, playerId, indices);
    return ok(room);
  }

  /** A player plays the card at the given hand index during trick-taking. */
  playCard(playerId: string, cardIndex: number): Result<Room> {
    const room = this.getRoomForPlayer(playerId);
    if (!room) return fail("You are not in a room");
    if (room.state.roundState !== "turns") return fail("It isn't trick-taking time");
    if (room.state.currentTurnPlayerId !== playerId) {
      return fail("It isn't your turn");
    }

    playCard(room.state, playerId, cardIndex);
    return ok(room);
  }

  /** End the knock-in end-of-phase pause (server-driven, by room id). */
  finishKnockIn(roomId: string): Result<Room> {
    const room = this.getRoom(roomId);
    if (!room) return fail("No such room");
    if (room.state.roundState !== "knock-in" || room.state.currentKnockPlayerId !== null) {
      return fail("Knock-in is not awaiting completion");
    }
    finishKnockIn(room.state);
    return ok(room);
  }

  /** End a trick-complete pause (server-driven, by room id): clear and advance. */
  finishTrick(roomId: string): Result<Room> {
    const room = this.getRoom(roomId);
    if (!room) return fail("No such room");
    if (room.state.roundState !== "trick-complete") {
      return fail("No completed trick to finish");
    }
    finishTrick(room.state);
    return ok(room);
  }

  /** Host deals the next hand once the previous one has ended. */
  nextHand(playerId: string): Result<Room> {
    const room = this.getRoomForPlayer(playerId);
    if (!room) return fail("You are not in a room");
    if (room.hostId !== playerId) return fail("Only the host deals the next hand");
    if (room.state.roundState !== "end") return fail("The hand isn't over yet");

    // Re-seat/drop players by who can afford the next pot (gamble only).
    if (this.reseatGamble(room) < MIN_PLAYERS) {
      return fail(`Need ${MIN_PLAYERS} players who can cover the pot`);
    }

    startHand(room.state);
    return ok(room);
  }
}
