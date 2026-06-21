import { useEffect, useState } from "react";
import { socket } from "./lib/socket";

// Phase 1: prove the client <-> server pipe works with a hello round-trip.
// No game logic yet — this screen exists only to confirm the connection.
export default function App() {
  const [connected, setConnected] = useState(socket.connected);
  const [name, setName] = useState("");
  const [reply, setReply] = useState<string | null>(null);

  useEffect(() => {
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    const onReply = (message: string) => setReply(message);

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("hello:reply", onReply);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("hello:reply", onReply);
    };
  }, []);

  const sendHello = () => {
    setReply(null);
    socket.emit("hello", name);
  };

  return (
    <main className="min-h-screen bg-slate-900 text-slate-100 flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl bg-slate-800 p-8 shadow-xl">
        <h1 className="text-3xl font-bold tracking-tight">SWICK</h1>
        <p className="mt-1 text-sm text-slate-400">
          Phase 1 — connection check
        </p>

        <div className="mt-6 flex items-center gap-2">
          <span
            className={`inline-block h-3 w-3 rounded-full ${
              connected ? "bg-green-400" : "bg-red-400"
            }`}
            aria-hidden
          />
          <span className="text-sm">
            {connected ? "Connected to server" : "Disconnected"}
          </span>
        </div>

        <div className="mt-6 space-y-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            className="w-full rounded-lg bg-slate-700 px-3 py-2 text-sm outline-none ring-1 ring-slate-600 focus:ring-indigo-400"
          />
          <button
            onClick={sendHello}
            disabled={!connected}
            className="w-full rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Say hello to the server
          </button>
        </div>

        {reply && (
          <p className="mt-5 rounded-lg bg-slate-900/60 px-3 py-2 text-sm text-green-300">
            {reply}
          </p>
        )}
      </div>
    </main>
  );
}
