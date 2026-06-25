import { useEffect, useState } from "react";
import { socket, connectWithAuth } from "./lib/socket";
import { loadDisplayName, saveDisplayName } from "./lib/profile";
import { useBackgroundMusic } from "./lib/useBackgroundMusic";
import { usePreventZoom } from "./lib/usePreventZoom";
import Frame from "./components/Frame";
import Intro from "./components/Intro";
import Lobby from "./components/Lobby";
import Room from "./components/Room";
import type { RoomView } from "./types";

const NAME_KEY = "swick:playerName";

// Phase 4: lobby & room system. App switches between the lobby (browse/create/
// join) and a room (ante, ready, start). The server is authoritative — we only
// render the room:state it broadcasts.
export default function App() {
  const [playerName, setPlayerName] = useState(
    () => localStorage.getItem(NAME_KEY) ?? "",
  );
  // Whether the saved profile name has been fetched yet (gates writing back, so
  // we don't overwrite the stored name with a stale local value on first load).
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [room, setRoom] = useState<RoomView | null>(null);
  const [showIntro, setShowIntro] = useState(true);
  const { audioRef, musicOn, toggleMusic } = useBackgroundMusic();
  usePreventZoom();

  // Once a hand is in progress the backdrop becomes the green poker table.
  const inGame = !!room?.started;

  // Cache the name locally for instant paint on the next load.
  useEffect(() => {
    localStorage.setItem(NAME_KEY, playerName);
  }, [playerName]);

  // Sign in (anonymously for guests) and connect the socket once on load.
  useEffect(() => {
    connectWithAuth().catch((err) => console.error("Auth/connect failed:", err));
  }, []);

  // Load the saved display name from the profile; it's the source of truth and
  // overrides the local cache when present.
  useEffect(() => {
    let active = true;
    loadDisplayName()
      .then((name) => {
        if (!active) return;
        if (name) setPlayerName(name);
        setProfileLoaded(true);
      })
      .catch(() => active && setProfileLoaded(true));
    return () => {
      active = false;
    };
  }, []);

  // Persist name edits back to the profile (debounced), but only after the
  // saved name has loaded so we never clobber it with a stale local value.
  useEffect(() => {
    if (!profileLoaded || !playerName.trim()) return;
    const t = setTimeout(() => saveDisplayName(playerName.trim()), 600);
    return () => clearTimeout(t);
  }, [playerName, profileLoaded]);

  // Lock page scrolling while the intro is on screen.
  useEffect(() => {
    document.body.style.overflow = showIntro ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [showIntro]);

  useEffect(() => {
    const onDisconnect = () => setRoom(null); // our seat is gone once the socket drops
    const onRoomState = (next: RoomView) => setRoom(next);

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
