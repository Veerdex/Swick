import { useEffect, useState } from "react";
import { socket } from "./lib/socket";
import Lobby from "./components/Lobby";
import Room from "./components/Room";
import type { RoomView } from "./types";

const NAME_KEY = "swick:playerName";

// Phase 4: lobby & room system. App switches between the lobby (browse/create/
// join) and a room (ante, ready, start). The server is authoritative — we only
// render the room:state it broadcasts.
export default function App() {
  const [connected, setConnected] = useState(socket.connected);
  const [playerName, setPlayerName] = useState(
    () => localStorage.getItem(NAME_KEY) ?? "",
  );
  const [room, setRoom] = useState<RoomView | null>(null);

  // Persist the chosen name across reloads.
  useEffect(() => {
    localStorage.setItem(NAME_KEY, playerName);
  }, [playerName]);

  useEffect(() => {
    const onConnect = () => setConnected(true);
    const onDisconnect = () => {
      setConnected(false);
      setRoom(null); // our seat is gone once the socket drops
    };
    const onRoomState = (next: RoomView) => setRoom(next);

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("room:state", onRoomState);
    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("room:state", onRoomState);
    };
  }, []);

  return (
    <main className="min-h-screen bg-slate-900 text-slate-100 flex flex-col items-center p-6">
      <div className="mb-4 flex w-full max-w-xl items-center gap-2">
        <span
          className={`inline-block h-2.5 w-2.5 rounded-full ${
            connected ? "bg-emerald-400" : "bg-red-400"
          }`}
        />
        <span className="text-xs text-slate-400">
          {connected ? "Connected" : "Disconnected"}
        </span>
      </div>

      {room ? (
        <Room room={room} onLeft={() => setRoom(null)} />
      ) : (
        <Lobby
          playerName={playerName}
          onNameChange={setPlayerName}
          onEntered={() => {
            /* room:state will arrive and flip the view */
          }}
        />
      )}
    </main>
  );
}
