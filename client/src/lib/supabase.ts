import { createClient, type Session } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  // Surface a clear message rather than a cryptic createClient failure.
  console.error(
    "Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — copy client/.env.example to .env.local.",
  );
}

// The session is persisted in localStorage and auto-refreshed, so a returning
// guest keeps the same anonymous identity across reloads.
export const supabase = createClient(url, anonKey, {
  auth: { persistSession: true, autoRefreshToken: true },
});

/**
 * Ensure there's a signed-in session, creating an anonymous (guest) one the
 * first time. Returns the current access token. Casual play uses this guest
 * identity; it can later be upgraded to a real account without changing the id.
 */
export async function ensureSession(): Promise<Session> {
  const { data } = await supabase.auth.getSession();
  if (data.session) return data.session;

  const { data: signedIn, error } = await supabase.auth.signInAnonymously();
  if (error || !signedIn.session) {
    throw new Error(`Anonymous sign-in failed: ${error?.message ?? "no session"}`);
  }
  return signedIn.session;
}
