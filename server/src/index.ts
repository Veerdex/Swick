import { createServer } from "node:http";
import { Server } from "socket.io";

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

// Phase 1: prove the pipe works. No game logic yet — just a hello round-trip.
io.on("connection", (socket) => {
  console.log(`[connect]    ${socket.id}`);

  socket.on("hello", (name: string) => {
    const who = name?.trim() || "stranger";
    console.log(`[hello]      ${socket.id} says hi as "${who}"`);
    // Echo a greeting straight back to just this client.
    socket.emit("hello:reply", `Hello, ${who} — the SWICK server hears you.`);
  });

  socket.on("disconnect", (reason) => {
    console.log(`[disconnect] ${socket.id} (${reason})`);
  });
});

httpServer.listen(PORT, () => {
  console.log(`SWICK server listening on http://localhost:${PORT}`);
  console.log(`Accepting Socket.io connections from ${CLIENT_ORIGIN}`);
});
