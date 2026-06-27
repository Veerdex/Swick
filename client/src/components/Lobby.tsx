import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { socket } from "../lib/socket";
import { linkGoogle, signInWithGoogle, consumeOAuthError } from "../lib/supabase";
import { useAuth } from "../lib/useAuth";
import { loadProfile, setUsername } from "../lib/profile";
import SwickCards from "./SwickCards";
import Friends from "./Friends";
import ScaledMenu from "./ScaledMenu";
import SfxControl from "./SfxControl";
import { playSfx } from "../lib/sfx";
import { useBackgroundMusic } from "../lib/useBackgroundMusic";
import type { ActionAck, GameMode, RoomSummary } from "../types";

// Shared casino styling: deep-red panels with a gold border, gold-bordered
// centered inputs.
const PANEL = "rounded-xl border border-amber-400/50 bg-red-950/70 p-4 shadow-lg";
const INPUT =
  "w-full rounded-lg border border-amber-400/40 bg-red-950/50 px-3 py-2 text-center text-sm text-amber-50 placeholder:text-amber-100/40 outline-none focus:border-amber-300";
const GOLD_BTN =
  "rounded-lg bg-gradient-to-b from-amber-300 to-amber-600 px-4 py-2 text-sm font-semibold text-red-950 shadow hover:from-amber-200 hover:to-amber-500 disabled:opacity-50";

interface LobbyProps {
  /** Called once we've successfully entered a room. */
  onEntered: () => void;
}

// The three swipeable lobby pages, left → right. Tables is the primary action,
// so the lobby opens there (rightmost); swipe/tap left for Friends + Settings.
const TABS = ["Settings", "Friends", "Tables"] as const;
const HOME_PAGE = 2; // Tables

const USERNAME_MSG: Record<string, string> = {
  taken: "That username is taken.",
  invalid: "3–20 letters, numbers, or underscores.",
  error: "Could not save — try again.",
};

export default function Lobby({ onEntered }: LobbyProps) {
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [createMode, setCreateMode] = useState<GameMode>("casual");
  const [friendsOnly, setFriendsOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joinWarning, setJoinWarning] = useState<{ roomId: string; pot: number } | null>(null);
  const [isLandscape, setIsLandscape] = useState(window.innerWidth > window.innerHeight);
  // A Google sign-in/link error returned via the URL after a redirect.
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const [alreadyLinked, setAlreadyLinked] = useState(false);
  const auth = useAuth();

  // Detect landscape orientation and adjust menu scale accordingly.
  useEffect(() => {
    const checkOrientation = () => {
      setIsLandscape(window.innerWidth > window.innerHeight);
    };
    checkOrientation();
    window.addEventListener("resize", checkOrientation);
    return () => window.removeEventListener("resize", checkOrientation);
  }, []);

  useEffect(() => {
    const e = consumeOAuthError();
    if (!e) return;
    if (e.code === "identity_already_exists") {
      setAlreadyLinked(true);
      setAuthNotice("That Google account already has a SWICK account — sign in with it instead.");
    } else {
      setAuthNotice(e.description || "Google sign-in failed. Please try again.");
    }
  }, []);

  // The player's profile (server-owned). The input edits a draft username.
  const [username, setUsernameState] = useState("");
  const [currency, setCurrency] = useState(0);
  const [draft, setDraft] = useState("");
  const [nameMsg, setNameMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Swipeable pager: a horizontal scroll-snap container, one page per tab. The
  // indicator follows the *continuous* scroll position (progress, a float in
  // [0, TABS.length-1]) so it tracks the finger 1:1 and slides smoothly during
  // a tap-driven smooth-scroll — no fighting between click state and scroll
  // events (which previously made the pill jerk at the start of a jump).
  const pagerRef = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState(HOME_PAGE);
  const page = Math.round(progress); // which tab is "active" (text colour)

  // Open on the Tables page without a visible scroll animation (pre-paint).
  useLayoutEffect(() => {
    const el = pagerRef.current;
    if (el) el.scrollLeft = HOME_PAGE * el.clientWidth;
  }, []);

  const onPagerScroll = () => {
    const el = pagerRef.current;
    if (el) setProgress(el.scrollLeft / el.clientWidth);
  };

  const goTo = (i: number) => {
    playSfx("swipe");
    const el = pagerRef.current;
    if (el) el.scrollTo({ left: i * el.clientWidth, behavior: "smooth" });
  };


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

  // Load our username + balance from the server.
  useEffect(() => {
    loadProfile().then((p) => {
      setUsernameState(p.username);
      setDraft(p.username);
      setCurrency(p.currency);
    });
  }, []);

  // Live currency updates — emitted by the server when the daily bonus is awarded.
  useEffect(() => {
    const onCurrency = ({ currency }: { currency: number }) => setCurrency(currency);
    socket.on("profile:currency", onCurrency);
    return () => { socket.off("profile:currency", onCurrency); };
  }, []);

  const saveUsername = async () => {
    setSaving(true);
    setNameMsg(null);
    const result = await setUsername(draft.trim());
    setSaving(false);
    if (result === "ok") {
      setUsernameState(draft.trim());
      setNameMsg("Saved!");
      playSfx("ui-ready");
    } else {
      setNameMsg(USERNAME_MSG[result] ?? "Could not save.");
      playSfx("error");
    }
  };

  const handleLink = () => {
    setError(null);
    linkGoogle().catch((e) =>
      setError(e instanceof Error ? e.message : "Could not link account"),
    );
  };

  const handleSignIn = () => {
    setError(null);
    signInWithGoogle().catch((e) =>
      setError(e instanceof Error ? e.message : "Could not sign in"),
    );
  };

  const enterAck = (ack: ActionAck) => {
    if (ack.ok) onEntered();
    else {
      setError(ack.error ?? "Failed");
      playSfx("error");
    }
  };

  const createRoom = () => {
    setError(null);
    playSfx("ui-click");
    socket.emit("room:create", { mode: createMode, friendsOnly }, enterAck);
  };

  const joinRoom = (roomId: string, force = false) => {
    setError(null);
    playSfx("ui-click");
    if (!force) {
      const room = rooms.find((r) => r.id === roomId);
      if (room?.mode === "gamble" && currency > 0 && currency < room.pot) {
        setJoinWarning({ roomId, pot: room.pot });
        return;
      }
    }
    socket.emit("room:join", { roomId }, enterAck);
  };

  const spectateRoom = (roomId: string) => {
    setError(null);
    playSfx("ui-click");
    socket.emit("room:spectate", { roomId }, enterAck);
  };

  // Sound settings for the Settings tab
  function SoundSettings() {
    const { musicOn, toggleMusic } = useBackgroundMusic();
    const handleToggleMusic = () => {
      playSfx("ui-click");
      toggleMusic();
    };

    return (
      <div className={PANEL}>
        <h3 className="mb-3 text-sm font-semibold text-amber-100">Sound</h3>

        {/* Music toggle */}
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl leading-none">{musicOn ? "🔊" : "🔇"}</span>
            <span className="text-sm text-amber-100/80">Background Music</span>
          </div>
          <button
            onClick={handleToggleMusic}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
              musicOn
                ? "bg-gradient-to-b from-amber-300 to-amber-600 text-red-950"
                : "border border-amber-400/40 text-amber-100/80"
            }`}
          >
            {musicOn ? "On" : "Off"}
          </button>
        </div>

        {/* Sound effects control */}
        <div className="border-t border-amber-400/20 pt-3">
          <p className="mb-2 text-xs uppercase tracking-wide text-amber-200/80">
            Sound Effects
          </p>
          <SfxControl variant="inline" />
        </div>
      </div>
    );
  }

  return (
    <ScaledMenu className="pt-12" scaleMultiplier={isLandscape ? 0.7 : 1}>
        {/* Floating SWICK title */}
        <div className="flex shrink-0 flex-col items-center pt-2">
          <div style={{ transform: "scale(0.85)", transformOrigin: "top center" }}>
            <SwickCards variant="float" />
          </div>
        </div>

      {/* A Google sign-in/link error returned via the redirect — e.g. the
          account is already registered, so they should sign in, not link. */}
      {authNotice && (
        <div className={`${PANEL} mt-4 shrink-0 space-y-3 text-center`}>
          <p className="text-sm text-amber-100/90">{authNotice}</p>
          {alreadyLinked && (
            <button onClick={handleSignIn} className={GOLD_BTN}>
              Sign in with Google
            </button>
          )}
          <button
            onClick={() => setAuthNotice(null)}
            className="block w-full text-xs text-amber-200/60 hover:text-amber-100"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Swipeable pager: one full-width, vertically-scrolling page per tab.
          flex-1 + min-h-0 lets it fill the space between the title and the
          bottom tab bar (and scroll internally) instead of fixing a height. */}
      <div
        ref={pagerRef}
        onScroll={onPagerScroll}
        className="no-scrollbar mt-4 flex min-h-0 flex-1 snap-x snap-mandatory overflow-x-auto"
      >
        {/* ─────────────── Settings ─────────────── */}
        <section className="h-full w-full shrink-0 snap-center space-y-6 overflow-y-auto px-px pb-2">
      {/* Username (unique) + balance */}
      <div className={`${PANEL} text-center`}>
        <label className="mb-2 block text-xs uppercase tracking-wide text-amber-200/80">
          Username
        </label>
        <div className="flex gap-2">
          <input
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setNameMsg(null);
            }}
            placeholder="username"
            maxLength={20}
            className={INPUT}
          />
          <button
            onClick={saveUsername}
            disabled={saving || !draft.trim() || draft.trim() === username}
            className={`${GOLD_BTN} shrink-0`}
          >
            Save
          </button>
        </div>
        {nameMsg && (
          <p className="mt-2 text-xs text-amber-100/80">{nameMsg}</p>
        )}
        <p className="mt-2 text-xs text-amber-200/60">Balance: {currency}¢</p>
      </div>

      {/* Account: a guest can LINK Google (keeps this guest's progress) or
          SIGN IN to an account they already have. */}
      {auth.ready && (
        <div className={PANEL}>
          {auth.isGuest ? (
            <div className="space-y-2">
              <p className="text-sm text-amber-100/80">Playing as guest</p>
              <div className="flex gap-2">
                <button onClick={handleLink} className={`${GOLD_BTN} flex-1`}>
                  Link Google
                </button>
                <button
                  onClick={handleSignIn}
                  className="flex-1 rounded-lg border border-amber-400/40 px-4 py-2 text-sm font-semibold text-amber-100 hover:bg-red-900/60"
                >
                  Sign in
                </button>
              </div>
              <p className="text-xs text-amber-200/50">
                Link to save this guest's progress · Sign in if you already have an account.
              </p>
            </div>
          ) : (
            <span className="text-sm text-amber-100/80">
              Signed in as{" "}
              <span className="font-semibold text-amber-50">{auth.email}</span>
            </span>
          )}
        </div>
      )}

      {/* Sound settings */}
      <SoundSettings />
        </section>

        {/* ─────────────── Friends ─────────────── */}
        <section className="h-full w-full shrink-0 snap-center space-y-6 overflow-y-auto px-px pb-2">
          {/* Accounts only — guests have no stable identity */}
          {auth.ready && !auth.isGuest ? (
            <Friends />
          ) : (
            <div className={`${PANEL} text-center`}>
              <h2 className="mb-2 text-sm font-semibold text-amber-100">Friends</h2>
              <p className="mb-4 text-sm text-amber-100/70">
                Link an account to add friends and keep them between sessions.
              </p>
              <button onClick={handleLink} className={GOLD_BTN}>
                Link a Google account
              </button>
            </div>
          )}
        </section>

        {/* ─────────────── Tables ─────────────── */}
        <section className="h-full w-full shrink-0 snap-center space-y-6 overflow-y-auto px-px pb-2">
      {/* Create a table */}
      <div className={PANEL}>
        <h2 className="mb-3 text-center text-sm font-semibold text-amber-100">
          Create a table
        </h2>
        {/* Casual vs Gamble — gamble needs a linked account */}
        <div className="mb-3 flex justify-center gap-2">
          <button
            onClick={() => setCreateMode("casual")}
            className={`rounded-lg px-4 py-1.5 text-sm font-semibold ${
              createMode === "casual"
                ? "bg-gradient-to-b from-amber-300 to-amber-600 text-red-950"
                : "border border-amber-400/40 text-amber-100/80"
            }`}
          >
            Casual
          </button>
          <button
            onClick={() => !auth.isGuest && setCreateMode("gamble")}
            disabled={auth.isGuest}
            title={auth.isGuest ? "Link an account to play gamble mode" : ""}
            className={`rounded-lg px-4 py-1.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40 ${
              createMode === "gamble"
                ? "bg-gradient-to-b from-amber-300 to-amber-600 text-red-950"
                : "border border-amber-400/40 text-amber-100/80"
            }`}
          >
            Gamble
          </button>
        </div>
        {/* Friends only — hides the table from everyone but your friends.
            Accounts only (guests have no friends list). */}
        <button
          onClick={() => !auth.isGuest && setFriendsOnly((v) => !v)}
          disabled={auth.isGuest}
          title={auth.isGuest ? "Link an account to invite friends" : ""}
          className={`mb-3 flex w-full items-center justify-center gap-2 rounded-lg border px-4 py-1.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40 ${
            friendsOnly
              ? "border-amber-300 bg-amber-400/20 text-amber-100"
              : "border-amber-400/40 text-amber-100/80"
          }`}
        >
          <span
            className={`flex h-4 w-4 items-center justify-center rounded border text-[10px] ${
              friendsOnly ? "border-amber-200 bg-amber-300 text-red-950" : "border-amber-400/50"
            }`}
          >
            {friendsOnly ? "✓" : ""}
          </span>
          Friends only
        </button>
        <button onClick={createRoom} className={`${GOLD_BTN} w-full`}>
          Create
        </button>
      </div>

      {/* Open tables */}
      <div className={PANEL}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-amber-100">Open tables</h2>
          <span className="text-xs text-amber-200/70">{rooms.length} available</span>
        </div>
        {rooms.length === 0 ? (
          <p className="py-6 text-center text-sm text-amber-100/50">
            No open tables. Create one above.
          </p>
        ) : (
          <ul className="space-y-2">
            {rooms.map((room) => {
              const gamble = room.mode === "gamble";
              const gambleBlocked =
                gamble && (auth.isGuest || currency <= 0);
              // Joinable whenever there are fewer than 6 humans at the table.
              // Mid-game joins queue for the next hand (replacing a bot or
              // filling an open slot when one becomes available).
              const canJoin = !gambleBlocked && room.humanCount < room.maxPlayers;
              const joinTitle = gambleBlocked
                ? auth.isGuest
                  ? "Gamble mode requires an account"
                  : "You need a positive balance to join gamble mode"
                : room.started && room.hasBots
                  ? "Replace a bot — you'll play starting next hand"
                  : room.started
                    ? "Join — you'll play starting next hand"
                    : "";
              return (
                <li
                  key={room.id}
                  className="flex items-center justify-between rounded-lg border border-amber-400/30 bg-red-950/50 px-3 py-2"
                >
                  <div>
                    <p className="flex items-center gap-2 text-sm font-medium text-amber-50">
                      {room.name}
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                          gamble
                            ? "bg-amber-400 text-red-950"
                            : "bg-slate-500/40 text-amber-100/80"
                        }`}
                      >
                        {room.mode}
                      </span>
                      {room.friendsOnly && (
                        <span className="rounded bg-emerald-500/30 px-1.5 py-0.5 text-[10px] font-bold uppercase text-emerald-200">
                          Friends
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-amber-100/60">
                      {room.humanCount}/{room.maxPlayers} humans
                      {room.hasBots ? ` + ${room.playerCount - room.humanCount} bots` : ""}
                      {" "}· #{room.id}
                      {room.started ? " · in progress" : ""}
                      {room.spectatorCount > 0
                        ? ` · ${room.spectatorCount} watching`
                        : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      onClick={() => joinRoom(room.id)}
                      disabled={!canJoin}
                      title={canJoin ? joinTitle : (gambleBlocked ? joinTitle : "Room is full")}
                      className={`${GOLD_BTN} px-3 py-1.5`}
                    >
                      Join
                    </button>
                    <button
                      onClick={() => spectateRoom(room.id)}
                      className="rounded-lg border border-amber-400/40 px-3 py-1.5 text-sm font-semibold text-amber-100 hover:bg-red-900/60"
                    >
                      Spectate
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {error && (
        <p className="rounded-lg border border-red-400/40 bg-red-500/15 px-3 py-2 text-center text-sm text-red-200">
          {error}
        </p>
      )}
        </section>
      </div>

      {/* Warning dialog: joining a gamble table when balance < pot */}
      {joinWarning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className={`${PANEL} w-full max-w-sm space-y-4 text-center`}>
            <h3 className="text-base font-bold text-amber-100">Low Balance Warning</h3>
            <p className="text-sm text-amber-100/80">
              Your balance ({currency}¢) is less than the current pot ({joinWarning.pot}¢).
              If you go set, you'll go negative and won't be able to play further hands
              until your balance recovers.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setJoinWarning(null)}
                className="flex-1 rounded-lg border border-amber-400/40 px-4 py-2 text-sm font-semibold text-amber-100 hover:bg-red-900/60"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const id = joinWarning.roomId;
                  setJoinWarning(null);
                  joinRoom(id, true);
                }}
                className={`${GOLD_BTN} flex-1`}
              >
                Join anyway
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bottom tab bar — doubles as the active-page indicator. Tap to jump, or
          swipe the pages above. The gold pill follows the continuous scroll
          position, so it tracks the finger and slides smoothly between tabs.
          shrink-0 keeps it a fixed height pinned just inside the frame. */}
      <div className="relative mt-4 flex shrink-0 rounded-xl border border-amber-400/40 bg-red-950/60 p-1">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-1 left-1 rounded-lg bg-gradient-to-b from-amber-300 to-amber-600 will-change-transform"
          style={{
            width: "calc((100% - 0.5rem) / 3)",
            transform: `translateX(${progress * 100}%)`,
          }}
        />
        {TABS.map((label, i) => (
          <button
            key={label}
            onClick={() => goTo(i)}
            className={`relative z-10 flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
              page === i ? "text-red-950" : "text-amber-100/70 hover:text-amber-100"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
    </ScaledMenu>
  );
}
