import { socket } from "./socket";

// The player's profile (unique username + currency) is owned by the server.
// We read and change it over the socket so the server stays authoritative.

export interface Profile {
  username: string;
  currency: number;
}

/** Fetch the player's own username + balance from the server. */
export function loadProfile(): Promise<Profile> {
  return new Promise((resolve) => {
    socket.emit("profile:get", (p: Profile) => resolve(p));
  });
}

export type SetUsernameResult = "ok" | "taken" | "invalid" | "error";

/** Ask the server to change the username; it enforces format + uniqueness. */
export function setUsername(username: string): Promise<SetUsernameResult> {
  return new Promise((resolve) => {
    socket.emit(
      "profile:setUsername",
      { username },
      (ack: { ok: boolean; error?: string }) =>
        resolve(ack?.ok ? "ok" : ((ack?.error as SetUsernameResult) ?? "error")),
    );
  });
}
