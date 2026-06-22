import { useEffect, useState } from "react";
import { socket } from "./lib/socket";
import { useBackgroundMusic } from "./lib/useBackgroundMusic";
import Intro from "./components/Intro";
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
  const [showIntro, setShowIntro] = useState(true);
  const { audioRef, musicOn, toggleMusic } = useBackgroundMusic();

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
    <main
      className="min-h-screen text-slate-100 flex flex-col items-center p-6 bg-slate-900"
      style={{
        backgroundImage:
          "linear-gradient(rgba(2,6,23,0.45), rgba(2,6,23,0.6)), url('/lobby-background.png')",
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundAttachment: "fixed",
      }}
    >
      {/* Looping background music. Starts on first interaction (autoplay policy). */}
      <audio ref={audioRef} src="/casino-music.mp3" loop preload="auto" />

      {/* Music toggle stays available even during the intro. */}
      <button
        onClick={toggleMusic}
        aria-label={musicOn ? "Mute music" : "Unmute music"}
        title={musicOn ? "Mute music" : "Play music"}
        className="fixed right-4 top-4 z-20 rounded-lg bg-slate-900/70 px-2 py-1 text-sm hover:bg-slate-800"
      >
        {musicOn ? "🔊" : "🔇"}
      </button>

      {showIntro ? (
        <Intro onPlay={() => setShowIntro(false)} />
      ) : (
        <>
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
        </>
      )}
    </main>
  );
}
