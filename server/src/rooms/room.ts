// A Room wraps one game: its players, host, and authoritative GameState.
//
// Room/lobby concerns (who's host, is it started, how many seats) live here.
// The in-hand game data lives in room.state (the GameState from Phase 3).

import {
  type GameState,
  type PlayerState,
  createGameState,
} from "../game/state.js";

/** SWICK supports 3-6 players. */
export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 6;

/** Casual = ephemeral 1000 each game; gamble = your real account currency. */
export type GameMode = "casual" | "gamble";

export interface Room {
  id: string;
  name: string;
  /** Player id of the host (sets ante, starts the game). */
  hostId: string;
  mode: GameMode;
  /** Once true, the room no longer appears in the joinable lobby list. */
  started: boolean;
  createdAt: number;
  /** The authoritative game state; players live in state.players. */
  state: GameState;
}

/** Compact room info for the lobby list. */
export interface RoomSummary {
  id: string;
  name: string;
  mode: GameMode;
  playerCount: number;
  maxPlayers: number;
  /** Current pot — a gamble table needs more than this to join. */
  pot: number;
  started: boolean;
}

export function createRoom(
  id: string,
  name: string,
  host: PlayerState,
  mode: GameMode = "casual",
): Room {
  return {
    id,
    name: name.trim() || "SWICK Table",
    hostId: host.id,
    mode,
    started: false,
    createdAt: Date.now(),
    state: createGameState([host]),
  };
}

export function roomSummary(room: Room): RoomSummary {
  return {
    id: room.id,
    name: room.name,
    mode: room.mode,
    playerCount: room.state.players.length,
    maxPlayers: MAX_PLAYERS,
    pot: room.state.potValue,
    started: room.started,
  };
}
