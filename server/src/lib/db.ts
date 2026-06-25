// Server-side database access via PostgREST using the service-role key, which
// bypasses RLS — so the server is the sole authority for usernames and currency.
// We use fetch (not the Supabase SDK) to keep the server light on Node 20.

const url = process.env.SUPABASE_URL ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

if (!url || !serviceKey) {
  throw new Error(
    "Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — set them in server/.env.",
  );
}

const BASE = `${url}/rest/v1`;
const REST = `${BASE}/profiles`;
const FRIENDS = `${BASE}/friendships`;
const headers = {
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
  "Content-Type": "application/json",
};

const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;

export interface Profile {
  username: string;
  currency: number;
}

/** Generate a candidate guest username like "Player7K2Q". */
function genUsername(): string {
  return "Player" + Math.random().toString(36).slice(2, 6).toUpperCase();
}

/** Fetch a user's profile, or null if they don't have one yet. */
export async function getProfile(userId: string): Promise<Profile | null> {
  const res = await fetch(
    `${REST}?id=eq.${userId}&select=username,currency`,
    { headers },
  );
  if (!res.ok) throw new Error(`getProfile ${res.status}`);
  const rows = (await res.json()) as Profile[];
  return rows[0] ?? null;
}

/** Ensure the user has a profile with a username, creating/filling one. */
export async function ensureProfile(userId: string): Promise<Profile> {
  const existing = await getProfile(userId);
  if (existing?.username) return existing;

  // The row may already exist (e.g. created before usernames) without a name,
  // so upsert (merge on the id) to either insert it or fill in the username.
  for (let attempt = 0; attempt < 6; attempt++) {
    const username = genUsername();
    const res = await fetch(REST, {
      method: "POST",
      headers: {
        ...headers,
        Prefer: "resolution=merge-duplicates,return=representation",
      },
      body: JSON.stringify({ id: userId, username }),
    });
    if (res.ok) {
      const [row] = (await res.json()) as Profile[];
      return row;
    }
    // 409 here is the username unique index (the id conflict is merged) — retry.
    if (res.status === 409) continue;
    throw new Error(`ensureProfile ${res.status}`);
  }
  throw new Error("ensureProfile: could not allocate a unique username");
}

/** Credit the daily bonus if it's a new day; returns the resulting balance. */
export async function claimDaily(userId: string): Promise<number> {
  const res = await fetch(`${url}/rest/v1/rpc/claim_daily`, {
    method: "POST",
    headers,
    body: JSON.stringify({ uid: userId }),
  });
  if (!res.ok) throw new Error(`claimDaily ${res.status}`);
  return (await res.json()) as number;
}

/** Persist a player's currency (gamble winnings/losses). */
export async function setCurrency(userId: string, amount: number): Promise<void> {
  const res = await fetch(`${REST}?id=eq.${userId}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ currency: Math.round(amount) }),
  });
  if (!res.ok) throw new Error(`setCurrency ${res.status}`);
}

export type SetUsernameResult = "ok" | "taken" | "invalid";

/** Set a user's username (case-insensitive unique). */
export async function setUsername(
  userId: string,
  raw: string,
): Promise<SetUsernameResult> {
  const username = raw.trim();
  if (!USERNAME_RE.test(username)) return "invalid";

  const res = await fetch(`${REST}?id=eq.${userId}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ username }),
  });
  if (res.ok) return "ok";
  if (res.status === 409) return "taken"; // unique violation
  if (res.status === 400) return "invalid"; // check constraint
  throw new Error(`setUsername ${res.status}`);
}

// --- Friends ---------------------------------------------------------------

export interface Friend {
  id: string;
  username: string;
  status: "pending" | "accepted";
  /** For pending only: true if they sent the request to me (I can accept). */
  incoming: boolean;
}

interface FriendshipRow {
  user_id: string;
  friend_id: string;
  status: "pending" | "accepted";
}

/** List a user's friends and pending requests (both directions). */
export async function listFriends(userId: string): Promise<Friend[]> {
  const res = await fetch(
    `${FRIENDS}?or=(user_id.eq.${userId},friend_id.eq.${userId})` +
      `&select=user_id,friend_id,status`,
    { headers },
  );
  if (!res.ok) throw new Error(`listFriends ${res.status}`);
  const rows = (await res.json()) as FriendshipRow[];
  if (rows.length === 0) return [];

  // Resolve the "other" side of each relationship, then fetch their usernames.
  const meta = new Map<string, { status: Friend["status"]; incoming: boolean }>();
  for (const r of rows) {
    const otherId = r.user_id === userId ? r.friend_id : r.user_id;
    meta.set(otherId, {
      status: r.status,
      incoming: r.friend_id === userId && r.status === "pending",
    });
  }

  const ids = [...meta.keys()];
  const nameRes = await fetch(
    `${REST}?id=in.(${ids.join(",")})&select=id,username`,
    { headers },
  );
  if (!nameRes.ok) throw new Error(`listFriends names ${nameRes.status}`);
  const names = (await nameRes.json()) as { id: string; username: string }[];
  const nameById = new Map(names.map((n) => [n.id, n.username]));

  return ids.map((id) => ({
    id,
    username: nameById.get(id) ?? "(unknown)",
    status: meta.get(id)!.status,
    incoming: meta.get(id)!.incoming,
  }));
}

/** Just the user ids of a player's accepted friends (lean, for access checks). */
export async function acceptedFriendIds(userId: string): Promise<string[]> {
  const res = await fetch(
    `${FRIENDS}?status=eq.accepted&or=(user_id.eq.${userId},friend_id.eq.${userId})` +
      `&select=user_id,friend_id`,
    { headers },
  );
  if (!res.ok) throw new Error(`acceptedFriendIds ${res.status}`);
  const rows = (await res.json()) as { user_id: string; friend_id: string }[];
  return rows.map((r) => (r.user_id === userId ? r.friend_id : r.user_id));
}

export type AddFriendResult =
  | "sent"
  | "accepted"
  | "already_friends"
  | "already_pending"
  | "self"
  | "not_found";

/** Send a friend request by username (atomic; auto-accepts a reverse request). */
export async function addFriend(
  userId: string,
  targetUsername: string,
): Promise<AddFriendResult> {
  const res = await fetch(`${BASE}/rpc/friend_request`, {
    method: "POST",
    headers,
    body: JSON.stringify({ requester: userId, target_name: targetUsername.trim() }),
  });
  if (!res.ok) throw new Error(`addFriend ${res.status}`);
  return (await res.json()) as AddFriendResult;
}

/** Accept or decline a pending request that `otherId` sent to `userId`. */
export async function respondFriend(
  userId: string,
  otherId: string,
  accept: boolean,
): Promise<"ok" | "not_found"> {
  const filter = `?user_id=eq.${otherId}&friend_id=eq.${userId}&status=eq.pending`;
  const res = accept
    ? await fetch(`${FRIENDS}${filter}`, {
        method: "PATCH",
        headers: { ...headers, Prefer: "return=representation" },
        body: JSON.stringify({ status: "accepted" }),
      })
    : await fetch(`${FRIENDS}${filter}`, {
        method: "DELETE",
        headers: { ...headers, Prefer: "return=representation" },
      });
  if (!res.ok) throw new Error(`respondFriend ${res.status}`);
  const affected = (await res.json()) as unknown[];
  return affected.length > 0 ? "ok" : "not_found";
}

/** Remove a friendship (or cancel a pending request) between two users. */
export async function removeFriend(
  userId: string,
  otherId: string,
): Promise<void> {
  const res = await fetch(
    `${FRIENDS}?or=(and(user_id.eq.${userId},friend_id.eq.${otherId}),` +
      `and(user_id.eq.${otherId},friend_id.eq.${userId}))`,
    { method: "DELETE", headers },
  );
  if (!res.ok) throw new Error(`removeFriend ${res.status}`);
}
