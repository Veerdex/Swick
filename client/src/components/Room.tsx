import { useEffect, useState } from "react";
import { socket } from "../lib/socket";
import GameTable from "./GameTable";
import type { ActionAck, RoomView } from "../types";

interface RoomProps {
  room: RoomView;
  /** Called after we leave (or the room closes). */
  onLeft: () => void;
}

export default function Room({ room, onLeft }: RoomProps) {
  const [error, setError] = useState<string | null>(null);
  const [anteInput, setAnteInput] = useState(String(room.state.anteAmount));

  const myId = room.youId;
  const isHost = myId === room.hostId;
  const me = room.state.players.find((p) => p.id === myId);

  // Keep the ante input in sync if the host changes it elsewhere.
  // (hooks must run before any early return)
  useEffect(() => {
    setAnteInput(String(room.state.anteAmount));
  }, [room.state.anteAmount]);

  const ack = (a: ActionAck) => {
    if (!a.ok) setError(a.error ?? "Action failed");
    else setError(null);
  };

  const setAnte = () =>
    socket.emit("room:setAnte", { amount: Number(anteInput) }, ack);
  const toggleReady = () =>
    socket.emit("room:ready", { ready: !me?.ready }, ack);
  const startGame = () => socket.emit("room:start", ack);
  const leave = () => socket.emit("room:leave", () => onLeft());

  // Once the hand is dealt, show the game table (it renders a watcher view for
  // spectators automatically).
  if (room.started) {
    return <GameTable room={room} onLeave={leave} />;
  }

  // A spectator on a table that hasn't started yet just waits to watch.
  if (room.isSpectator) {
    return (
      <div className="w-full max-w-md space-y-4 pt-14 text-center">
        <p className="text-2xl font-bold text-amber-200">Spectating {room.name}</p>
        <div className="rounded-xl border border-amber-400/40 bg-red-950/70 p-4">
          <p className="mb-2 text-xs uppercase tracking-wide text-amber-200/70">
            Players
          </p>
          <ul className="space-y-1 text-sm text-amber-50">
            {room.state.players.map((p) => (
              <li key={p.id}>{p.name}</li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-amber-100/60">
            Waiting for the host to start the game…
          </p>
        </div>
        <button
          onClick={leave}
          className="rounded-lg bg-slate-700 px-4 py-2 text-sm hover:bg-slate-600"
        >
          Leave
        </button>
      </div>
    );
  }

  return (
    <div className="w-full max-w-xl space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{room.name}</h1>
          <p className="text-xs text-slate-400">
            Table #{room.id} · {room.state.players.length} seated
          </p>
        </div>
        <button
          onClick={leave}
          className="rounded-lg bg-slate-700 px-3 py-1.5 text-sm hover:bg-slate-600"
        >
          Leave
        </button>
      </header>

      <div className="rounded-xl bg-slate-800 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Ante</h2>
          {room.state.anteSet ? (
            <span className="text-sm text-emerald-300">
              {room.state.anteAmount}¢ per player
            </span>
          ) : (
            <span className="text-sm text-amber-300">not set yet</span>
          )}
        </div>
        {isHost ? (
          <div className="flex gap-2">
            <input
              type="number"
              min={3}
              value={anteInput}
              onChange={(e) => setAnteInput(e.target.value)}
              className="w-24 rounded-lg bg-slate-700 px-3 py-2 text-sm outline-none ring-1 ring-slate-600 focus:ring-indigo-400"
            />
            <button
              onClick={setAnte}
              className="rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium hover:bg-indigo-400"
            >
              Set ante
            </button>
            <span className="self-center text-xs text-slate-500">
              min 3¢ · changing it un-readies everyone
            </span>
          </div>
        ) : (
          <p className="text-xs text-slate-500">The host sets the ante.</p>
        )}
      </div>

      <div className="rounded-xl bg-slate-800 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">
            Players ({room.state.players.length}/6)
          </h2>
          {isHost && room.state.players.length < 6 && (
            <button
              onClick={() => socket.emit("room:addBot", ack)}
              className="rounded-lg bg-slate-700 px-3 py-1 text-xs hover:bg-slate-600"
            >
              + Add bot
            </button>
          )}
        </div>
        <ul className="space-y-2">
          {room.state.players.map((p) => (
            <li
              key={p.id}
              className="flex items-center justify-between rounded-lg bg-slate-700/60 px-3 py-2"
            >
              <span className="flex items-center gap-2 text-sm">
                <span
                  className={`inline-block h-2.5 w-2.5 rounded-full ${
                    p.ready ? "bg-emerald-400" : "bg-slate-500"
                  }`}
                />
                {p.name}
                {p.isBot && (
                  <span className="rounded bg-slate-500/30 px-1.5 py-0.5 text-[10px] font-medium text-slate-300">
                    BOT
                  </span>
                )}
                {p.id === myId && (
                  <span className="text-xs text-slate-400">(you)</span>
                )}
                {p.id === room.hostId && (
                  <span className="rounded bg-indigo-500/20 px-1.5 py-0.5 text-[10px] font-medium text-indigo-300">
                    HOST
                  </span>
                )}
              </span>
              {isHost && p.isBot ? (
                <button
                  onClick={() => socket.emit("room:removeBot", { botId: p.id }, ack)}
                  className="text-xs text-red-300 hover:text-red-200"
                >
                  remove
                </button>
              ) : (
                <span className="text-xs text-slate-400">
                  {p.ready ? "ready" : "not ready"}
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={toggleReady}
          disabled={!room.state.anteSet}
          className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50 ${
            me?.ready
              ? "bg-slate-600 hover:bg-slate-500"
              : "bg-emerald-500 hover:bg-emerald-400"
          }`}
        >
          {me?.ready ? "Unready" : "Ready up"}
        </button>
        {isHost && (
          <button
            onClick={startGame}
            disabled={!room.canStart}
            className="flex-1 rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-amber-400 disabled:opacity-50"
          >
            Start game
          </button>
        )}
      </div>

      {!room.canStart && (
        <p className="text-center text-xs text-slate-500">
          Need the ante set and 3+ players, all ready, to start.
        </p>
      )}

      {error && (
        <p className="rounded-lg bg-red-500/15 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}
