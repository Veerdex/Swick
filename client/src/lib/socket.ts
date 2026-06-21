import { io, type Socket } from "socket.io-client";

// Server URL: configurable via env for deployment, defaults to local dev server.
const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? "http://localhost:3001";

// A single shared socket instance for the whole app.
export const socket: Socket = io(SERVER_URL, {
  autoConnect: true,
});
