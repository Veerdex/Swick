import { useEffect, useState } from "react";
import { socket, connectWithAuth } from "./lib/socket";
import { useBackgroundMusic } from "./lib/useBackgroundMusic";
import { usePreventZoom } from "./lib/usePreventZoom";
import Frame from "./components/Frame";
import Intro from "./components/Intro";
import Lobby from "./components/Lobby";
import Room from "./components/Room";
import type { RoomView } from "./types";

// Phase 4: lobby & room system. App switches between the lobby (browse/create/
// join) and a room (ante, ready, start). The server is authoritative — we only
// render the room:state it broadcasts.
export default function App() {
  const [room, setRoom] = useState<RoomView | null>(null);
  const [showIntro, setShowIntro] = useState(true);
  const { audioRef, musicOn, toggleMusic } = useBackgroundMusic();
  usePreventZoom();

  // Once a hand is in progress the backdrop becomes the green poker table.
  const inGame = !!room?.started;

  // Sign in (anonymously for guests) and connect the socket once on load.
  useEffect(() => {
    connectWithAuth().catch((err) => console.error("Auth/connect failed:", err));
  }, []);

  // Lock page scrolling while the intro is on screen.
  useEffect(() => {
    document.body.style.overflow = showIntro ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [showIntro]);

  useEffect(() => {
    const onDisconnect = () => setRoom(null); // our seat is gone once the socket drops
    const onRoomState = (next: RoomView) => {
      setRoom(next);
      // Reconnecting mid-game (e.g. after a refresh) drops us straight back into
      // the seat the server is holding, past the intro.
      setShowIntro(false);
    };

    socket.on("disconnect", onDisconnect);
    socket.on("room:state", onRoomState);
    return () => {
      socket.off("disconnect", onDisconnect);
      socket.off("room:state", onRoomState);
    };
  }, []);

  return (
    <main className="relative min-h-screen text-slate-100 flex flex-col items-center p-6">
      {/* Fixed, non-scrolling casino background — pinned to the viewport so it
          never moves, even when overscrolling past the top/bottom. */}
      <div
        aria-hidden
        className="fixed inset-0 -z-10 bg-slate-950"
        style={{
          backgroundImage: inGame
            ? "url('/poker-table-green.png')"
            : "linear-gradient(rgba(2,6,23,0.45), rgba(2,6,23,0.6)), url('/lobby-background.png')",
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      />

      {/* Decorative gold frame — hidden once the game (poker table) is showing. */}
      {!inGame && <Frame />}

      {/* Looping background music. Starts on first interaction (autoplay policy). */}
      <audio ref={audioRef} src="/casino-music.mp3" loop preload="auto" />

      {/* Music toggle — hidden during the intro. */}
      {!showIntro && (
        <button
          onClick={toggleMusic}
          aria-label={musicOn ? "Mute music" : "Unmute music"}
          title={musicOn ? "Mute music" : "Play music"}
          className="fixed right-7 top-7 z-20 rounded-xl bg-slate-900/70 px-3 py-2 text-2xl leading-none hover:bg-slate-800"
        >
          {musicOn ? "🔊" : "🔇"}
        </button>
      )}

      {showIntro ? (
        <Intro onPlay={() => setShowIntro(false)} />
      ) : (
        <>
          {room ? (
            <Room room={room} onLeft={() => setRoom(null)} />
          ) : (
            <Lobby
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
