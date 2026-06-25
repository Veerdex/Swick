import { useEffect, useState } from "react";
import { socket } from "../lib/socket";
import { linkGoogle } from "../lib/supabase";
import { useAuth } from "../lib/useAuth";
import { loadProfile, setUsername } from "../lib/profile";
import SwickCards from "./SwickCards";
import type { ActionAck, RoomSummary } from "../types";

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

const USERNAME_MSG: Record<string, string> = {
  taken: "That username is taken.",
  invalid: "3–20 letters, numbers, or underscores.",
  error: "Could not save — try again.",
};

export default function Lobby({ onEntered }: LobbyProps) {
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [roomName, setRoomName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const auth = useAuth();

  // The player's profile (server-owned). The input edits a draft username.
  const [username, setUsernameState] = useState("");
  const [currency, setCurrency] = useState(0);
  const [draft, setDraft] = useState("");
  const [nameMsg, setNameMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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

  const saveUsername = async () => {
    setSaving(true);
    setNameMsg(null);
    const result = await setUsername(draft.trim());
    setSaving(false);
    if (result === "ok") {
      setUsernameState(draft.trim());
      setNameMsg("Saved!");
    } else {
      setNameMsg(USERNAME_MSG[result] ?? "Could not save.");
    }
  };

  const handleLink = () => {
    setError(null);
    linkGoogle().catch((e) =>
      setError(e instanceof Error ? e.message : "Could not link account"),
    );
  };

  const createRoom = () => {
    setError(null);
    socket.emit(
      "room:create",
      { name: roomName },
      (ack: ActionAck) => (ack.ok ? onEntered() : setError(ack.error ?? "Failed")),
    );
  };

  const joinRoom = (roomId: string) => {
    setError(null);
    socket.emit(
      "room:join",
      { roomId },
      (ack: ActionAck) => (ack.ok ? onEntered() : setError(ack.error ?? "Failed")),
    );
  };

  return (
    <div className="w-full max-w-xl space-y-6 pt-14">
      {/* Floating SWICK title + Lobby */}
      <div className="flex flex-col items-center gap-4 pt-2">
        <SwickCards variant="float" />
        <p className="text-3xl font-semibold tracking-wide text-amber-200 drop-shadow">
          Lobby
        </p>
      </div>

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

      {/* Account: guests can link a Google account (unlocks gamble mode later) */}
      {auth.ready && (
        <div className={`${PANEL} flex items-center justify-between gap-3`}>
          {auth.isGuest ? (
            <>
              <span className="text-sm text-amber-100/80">Playing as guest</span>
              <button onClick={handleLink} className={`${GOLD_BTN} shrink-0`}>
                Link a Google account
              </button>
            </>
          ) : (
            <span className="text-sm text-amber-100/80">
              Signed in as{" "}
              <span className="font-semibold text-amber-50">{auth.email}</span>
            </span>
          )}
        </div>
      )}

      {/* Create a table */}
      <div className={PANEL}>
        <h2 className="mb-3 text-center text-sm font-semibold text-amber-100">
          Create a table
        </h2>
        <div className="flex gap-2">
          <input
            value={roomName}
            onChange={(e) => setRoomName(e.target.value)}
            placeholder="Table name (optional)"
            maxLength={30}
            className={INPUT}
          />
          <button onClick={createRoom} className={`${GOLD_BTN} shrink-0`}>
            Create
          </button>
        </div>
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
            {rooms.map((room) => (
              <li
                key={room.id}
                className="flex items-center justify-between rounded-lg border border-amber-400/30 bg-red-950/50 px-3 py-2"
              >
                <div>
                  <p className="text-sm font-medium text-amber-50">{room.name}</p>
                  <p className="text-xs text-amber-100/60">
                    {room.playerCount}/{room.maxPlayers} players · #{room.id}
                  </p>
                </div>
                <button
                  onClick={() => joinRoom(room.id)}
                  disabled={room.playerCount >= room.maxPlayers}
                  className={`${GOLD_BTN} px-3 py-1.5`}
                >
                  Join
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && (
        <p className="rounded-lg border border-red-400/40 bg-red-500/15 px-3 py-2 text-center text-sm text-red-200">
          {error}
        </p>
      )}
    </div>
  );
}
