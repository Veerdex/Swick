import "dotenv/config";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { registerLobbyHandlers } from "./socket/lobby.js";
import { verifyToken } from "./lib/supabase.js";
import { ensureProfile, claimDaily, acceptedFriendIds } from "./lib/db.js";

// Railway injects PORT in production; fall back to 3001 for local dev.
const PORT = Number(process.env.PORT) || 3001;
// Allow the Vite dev server (and a configurable production origin) to connect.
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN ?? "http://localhost:5173";

const httpServer = createServer((_req, res) => {
  // Tiny health endpoint so Railway (and curl) can confirm the process is up.
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("SWICK server OK");
});

const io = new Server(httpServer, {
  cors: { origin: CLIENT_ORIGIN, methods: ["GET", "POST"] },
});

// Authenticate every connection: the client attaches its Supabase access token
// to the handshake; we verify it and stamp the trusted user id onto the socket.
// From here on, that user id (not the volatile socket.id) is the player's key.
io.use(async (socket, next) => {
  const token = (socket.handshake.auth as { token?: string })?.token;
  const auth = await verifyToken(token);
  if (!auth) {
    next(new Error("unauthorized"));
    return;
  }
  socket.data.userId = auth.userId;
  socket.data.isGuest = auth.isGuest; // gamble mode requires a non-guest
  // The set of host ids this viewer is friends with, used to gate friends-only
  // tables in the lobby. Guests have no friends; refreshed by friends actions.
  socket.data.friendIds = new Set<string>();
  // Ensure a profile + apply the daily bonus, and stamp the (unique) username
  // and current balance onto the socket. Best-effort so a transient DB hiccup
  // doesn't block play.
  try {
    const profile = await ensureProfile(auth.userId);
    socket.data.username = profile.username;
    socket.data.currency = await claimDaily(auth.userId); // applies +250/day
    if (!auth.isGuest) {
      socket.data.friendIds = new Set(await acceptedFriendIds(auth.userId));
    }
  } catch (err) {
    console.error("profile setup failed:", err);
    socket.data.username = "Player" + auth.userId.slice(0, 4);
    socket.data.currency = 1000;
  }
  next();
});

io.on("connection", (socket) => {
  const userId = socket.data.userId as string;
  console.log(`[connect]    ${socket.id} -> user ${userId}`);
  // Join a room named by the user id so io.to(userId) reaches this client even
  // across reconnects (the broadcast layer addresses players by user id).
  socket.join(userId);
  registerLobbyHandlers(io, socket);

  socket.on("disconnect", (reason) => {
    console.log(`[disconnect] user ${userId} (${reason})`);
  });
});

httpServer.listen(PORT, () => {
  console.log(`SWICK server listening on http://localhost:${PORT}`);
  console.log(`Accepting Socket.io connections from ${CLIENT_ORIGIN}`);
});
