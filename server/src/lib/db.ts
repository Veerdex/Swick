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

const REST = `${url}/rest/v1/profiles`;
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
