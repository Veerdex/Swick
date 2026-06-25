import { io, type Socket } from "socket.io-client";
import { ensureSession, supabase } from "./supabase";

// Server URL: configurable via env for deployment, defaults to local dev server.
const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? "http://localhost:3001";

// A single shared socket for the whole app. It does NOT auto-connect — we first
// sign the player in (anonymously for guests) and attach their access token to
// the handshake so the server can verify who they are.
export const socket: Socket = io(SERVER_URL, {
  autoConnect: false,
});

let started = false;

/** Sign in (guest if needed), attach the token, and connect. Idempotent. */
export async function connectWithAuth(): Promise<void> {
  if (started) return;
  started = true;

  const session = await ensureSession();
  socket.auth = { token: session.access_token };

  // Keep the handshake token fresh so reconnects re-authenticate cleanly.
  supabase.auth.onAuthStateChange((_event, next) => {
    socket.auth = { token: next?.access_token };
  });

  socket.connect();
}
