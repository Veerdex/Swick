import { createServer } from "node:http";
import { Server } from "socket.io";
import { registerLobbyHandlers } from "./socket/lobby.js";

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

io.on("connection", (socket) => {
  console.log(`[connect]    ${socket.id}`);
  registerLobbyHandlers(io, socket);

  socket.on("disconnect", (reason) => {
    console.log(`[disconnect] ${socket.id} (${reason})`);
  });
});

httpServer.listen(PORT, () => {
  console.log(`SWICK server listening on http://localhost:${PORT}`);
  console.log(`Accepting Socket.io connections from ${CLIENT_ORIGIN}`);
});
