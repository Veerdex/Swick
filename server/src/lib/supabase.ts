// Server-side auth: we only need to VERIFY a player's access token, not run a
// full Supabase client (which pulls in Realtime + a WebSocket Node 20 lacks).
// A direct call to Supabase's auth endpoint validates the token and returns the
// user. The anon key is public; trust comes from Supabase validating the JWT.

// Default to "" so these are typed `string` (not `string | undefined`) for use
// in fetch headers; the check below still fails fast if they're actually unset.
const url = process.env.SUPABASE_URL ?? "";
const anonKey = process.env.SUPABASE_ANON_KEY ?? "";

if (!url || !anonKey) {
  throw new Error(
    "Missing SUPABASE_URL / SUPABASE_ANON_KEY — copy server/.env.example to .env.",
  );
}

/** Verify an access token and return the Supabase user id, or null if invalid. */
export async function verifyToken(token: string | undefined): Promise<string | null> {
  if (!token) return null;
  try {
    const res = await fetch(`${url}/auth/v1/user`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const user = (await res.json()) as { id?: unknown };
    return typeof user.id === "string" ? user.id : null;
  } catch {
    return null;
  }
}
