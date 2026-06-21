import { useEffect, useState } from "react";
import { socket } from "../lib/socket";
import type { ActionAck, RoomSummary } from "../types";

interface LobbyProps {
  playerName: string;
  onNameChange: (name: string) => void;
  /** Called once we've successfully entered a room. */
  onEntered: () => void;
}

export default function Lobby({
  playerName,
  onNameChange,
  onEntered,
}: LobbyProps) {
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [roomName, setRoomName] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const refresh = () => socket.emit("lobby:list", (list: RoomSummary[]) => setRooms(list));
    refresh();
    socket.on("lobby:rooms", setRooms);
    socket.on("connect", refresh);
    return () => {
      socket.off("lobby:rooms", setRooms);
      socket.off("connect", refresh);
    };
  }, []);

  const guardName = (): boolean => {
    if (!playerName.trim()) {
      setError("Enter a name first.");
      return false;
    }
    return true;
  };

  const createRoom = () => {
    if (!guardName()) return;
    setError(null);
    socket.emit(
      "room:create",
      { name: roomName, playerName },
      (ack: ActionAck) => (ack.ok ? onEntered() : setError(ack.error ?? "Failed")),
    );
  };

  const joinRoom = (roomId: string) => {
    if (!guardName()) return;
    setError(null);
    socket.emit(
      "room:join",
      { roomId, playerName },
      (ack: ActionAck) => (ack.ok ? onEntered() : setError(ack.error ?? "Failed")),
    );
  };

  return (
    <div className="w-full max-w-xl space-y-6">
      <header>
        <h1 className="text-4xl font-bold tracking-tight">SWICK</h1>
        <p className="text-sm text-slate-400">Lobby</p>
      </header>

      <div className="space-y-2">
        <label className="text-xs uppercase tracking-wide text-slate-400">
          Your name
        </label>
        <input
          value={playerName}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="Display name"
          maxLength={20}
          className="w-full rounded-lg bg-slate-700 px-3 py-2 text-sm outline-none ring-1 ring-slate-600 focus:ring-indigo-400"
        />
      </div>

      <div className="rounded-xl bg-slate-800 p-4">
        <h2 className="mb-3 text-sm font-semibold">Create a table</h2>
        <div className="flex gap-2">
          <input
            value={roomName}
            onChange={(e) => setRoomName(e.target.value)}
            placeholder="Table name (optional)"
            maxLength={30}
            className="flex-1 rounded-lg bg-slate-700 px-3 py-2 text-sm outline-none ring-1 ring-slate-600 focus:ring-indigo-400"
          />
          <button
            onClick={createRoom}
            className="rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium hover:bg-indigo-400"
          >
            Create
          </button>
        </div>
      </div>

      <div className="rounded-xl bg-slate-800 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Open tables</h2>
          <span className="text-xs text-slate-400">{rooms.length} available</span>
        </div>
        {rooms.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">
            No open tables. Create one above.
          </p>
        ) : (
          <ul className="space-y-2">
            {rooms.map((room) => (
              <li
                key={room.id}
                className="flex items-center justify-between rounded-lg bg-slate-700/60 px-3 py-2"
              >
                <div>
                  <p className="text-sm font-medium">{room.name}</p>
                  <p className="text-xs text-slate-400">
                    {room.playerCount}/{room.maxPlayers} players · #{room.id}
                  </p>
                </div>
                <button
                  onClick={() => joinRoom(room.id)}
                  disabled={room.playerCount >= room.maxPlayers}
                  className="rounded-lg bg-emerald-500 px-3 py-1.5 text-sm font-medium hover:bg-emerald-400 disabled:opacity-50"
                >
                  Join
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && (
        <p className="rounded-lg bg-red-500/15 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}
