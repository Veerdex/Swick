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
 * Upgrade the current (guest) session into a permanent account by linking a
 * Google identity. The user id is preserved, so their profile and currency
 * carry over. Redirects to Google and back to the app to complete the flow.
 */
export async function linkGoogle(): Promise<void> {
  const { error } = await supabase.auth.linkIdentity({
    provider: "google",
    options: { redirectTo: window.location.origin },
  });
  if (error) throw error;
}

/**
 * Sign IN with Google (as opposed to linking). Use this for a returning player
 * whose Google account already exists — it switches to that account rather than
 * trying to attach the identity to the current guest. Any guest-only progress is
 * abandoned in favour of the real account.
 */
export async function signInWithGoogle(): Promise<void> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: window.location.origin },
  });
  if (error) throw error;
}

/**
 * Read an OAuth error returned in the URL (hash or query) after a redirect, and
 * strip it from the address bar so it doesn't linger on reload. Returns the
 * error code + a readable description, or null if there was none.
 */
export function consumeOAuthError(): { code: string; description: string } | null {
  if (typeof window === "undefined") return null;
  for (const raw of [window.location.hash, window.location.search]) {
    const params = new URLSearchParams(raw.replace(/^[#?]/, ""));
    if (!params.get("error")) continue;
    const code = params.get("error_code") ?? params.get("error") ?? "error";
    const description = (params.get("error_description") ?? "").replace(/\+/g, " ");
    history.replaceState(null, "", window.location.pathname); // clear the URL
    return { code, description };
  }
  return null;
}

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
