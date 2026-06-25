import { useEffect, useState } from "react";
import {
  listFriends,
  addFriend,
  respondFriend,
  removeFriend,
  type Friend,
  type AddFriendResult,
} from "../lib/friends";
import { playSfx } from "../lib/sfx";

const PANEL = "rounded-xl border border-amber-400/50 bg-red-950/70 p-4 shadow-lg";
const INPUT =
  "w-full rounded-lg border border-amber-400/40 bg-red-950/50 px-3 py-2 text-center text-sm text-amber-50 placeholder:text-amber-100/40 outline-none focus:border-amber-300";
const GOLD_BTN =
  "rounded-lg bg-gradient-to-b from-amber-300 to-amber-600 px-4 py-2 text-sm font-semibold text-red-950 shadow hover:from-amber-200 hover:to-amber-500 disabled:opacity-50";

const ADD_MSG: Record<AddFriendResult, string> = {
  sent: "Request sent!",
  accepted: "You're now friends!",
  already_friends: "You're already friends.",
  already_pending: "Request already pending.",
  self: "You can't friend yourself.",
  not_found: "No player with that username.",
  error: "Something went wrong — try again.",
};

export default function Friends() {
  const [friends, setFriends] = useState<Friend[]>([]);
  const [draft, setDraft] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    listFriends().then(setFriends);
  }, []);

  const add = async () => {
    const name = draft.trim();
    if (!name) return;
    setBusy(true);
    setMsg(null);
    const { result, friends } = await addFriend(name);
    setBusy(false);
    setFriends(friends);
    setMsg(ADD_MSG[result]);
    if (result === "sent" || result === "accepted") {
      setDraft("");
      playSfx("ui-ready");
    } else {
      playSfx("error");
    }
  };

  const accepted = friends.filter((f) => f.status === "accepted");
  const incoming = friends.filter((f) => f.status === "pending" && f.incoming);
  const outgoing = friends.filter((f) => f.status === "pending" && !f.incoming);

  return (
    <div className={PANEL}>
      <h2 className="mb-3 text-center text-sm font-semibold text-amber-100">
        Friends
      </h2>

      {/* Add by username */}
      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setMsg(null);
          }}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="Add by username"
          maxLength={20}
          className={INPUT}
        />
        <button
          onClick={add}
          disabled={busy || !draft.trim()}
          className={`${GOLD_BTN} shrink-0`}
        >
          Add
        </button>
      </div>
      {msg && <p className="mt-2 text-center text-xs text-amber-100/80">{msg}</p>}

      {/* Incoming requests — accept or decline */}
      {incoming.length > 0 && (
        <div className="mt-4">
          <p className="mb-1 text-xs uppercase tracking-wide text-amber-200/70">
            Requests
          </p>
          <ul className="space-y-2">
            {incoming.map((f) => (
              <li
                key={f.id}
                className="flex items-center justify-between rounded-lg border border-amber-400/30 bg-red-950/50 px-3 py-2"
              >
                <span className="text-sm text-amber-50">{f.username}</span>
                <span className="flex gap-2">
                  <button
                    onClick={() => {
                      playSfx("ui-ready");
                      respondFriend(f.id, true).then(setFriends);
                    }}
                    className="rounded bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-500"
                  >
                    Accept
                  </button>
                  <button
                    onClick={() => {
                      playSfx("ui-click");
                      respondFriend(f.id, false).then(setFriends);
                    }}
                    className="rounded bg-slate-700 px-2.5 py-1 text-xs font-semibold text-amber-100 hover:bg-slate-600"
                  >
                    Decline
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Accepted friends */}
      <div className="mt-4">
        <p className="mb-1 text-xs uppercase tracking-wide text-amber-200/70">
          Your friends ({accepted.length})
        </p>
        {accepted.length === 0 ? (
          <p className="py-2 text-center text-xs text-amber-100/50">
            No friends yet. Add someone by their username.
          </p>
        ) : (
          <ul className="space-y-2">
            {accepted.map((f) => (
              <li
                key={f.id}
                className="flex items-center justify-between rounded-lg border border-amber-400/30 bg-red-950/50 px-3 py-2"
              >
                <span className="text-sm text-amber-50">{f.username}</span>
                <button
                  onClick={() => {
                    playSfx("ui-click");
                    removeFriend(f.id).then(setFriends);
                  }}
                  className="text-xs text-red-300 hover:text-red-200"
                >
                  remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Outgoing pending requests — cancel */}
      {outgoing.length > 0 && (
        <div className="mt-4">
          <p className="mb-1 text-xs uppercase tracking-wide text-amber-200/70">
            Pending
          </p>
          <ul className="space-y-2">
            {outgoing.map((f) => (
              <li
                key={f.id}
                className="flex items-center justify-between rounded-lg border border-amber-400/20 bg-red-950/40 px-3 py-2"
              >
                <span className="text-sm text-amber-100/70">
                  {f.username} <span className="text-amber-200/50">· awaiting reply</span>
                </span>
                <button
                  onClick={() => {
                    playSfx("ui-click");
                    removeFriend(f.id).then(setFriends);
                  }}
                  className="text-xs text-amber-200/70 hover:text-amber-100"
                >
                  cancel
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
