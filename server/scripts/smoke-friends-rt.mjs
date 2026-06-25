// Runtime smoke test for friends-only tables, end-to-end over real sockets.
//
// Spawns a fresh SWICK server on a test port, mints real Supabase tokens for
// two throwaway accounts, connects two Socket.io clients, and asserts the
// friends-only lobby filtering + join/spectate gate. Cleans everything up.
//
// Requires a build first (`npm run build`) and the service-role + anon keys in
// server/.env. Run from server/:  node scripts/smoke-friends-rt.mjs
import "dotenv/config";
import { io } from "socket.io-client";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const SERVER_DIR = fileURLToPath(new URL("..", import.meta.url));
const PORT = 3099;
const BASE = `http://localhost:${PORT}`;

const url = process.env.SUPABASE_URL;
const anon = process.env.SUPABASE_ANON_KEY;
const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anon || !svc) throw new Error("Missing SUPABASE_URL / ANON / SERVICE_ROLE key in server/.env");
const h = { apikey: svc, Authorization: `Bearer ${svc}`, "Content-Type": "application/json" };

let passed = 0;
const check = (label, cond, detail) => {
  if (cond) { console.log(`  ✓ ${label}`); passed++; }
  else throw new Error(`FAILED: ${label}${detail ? ` — ${detail}` : ""}`);
};
const ask = (s, ev, ...args) => new Promise((res) => s.emit(ev, ...args, res));

async function makeUser(tag) {
  const email = `smoke_${tag}_${Date.now()}@swick.test`;
  const password = "Sw1ck!" + Math.random().toString(36).slice(2);
  const u = await fetch(`${url}/auth/v1/admin/users`, { method: "POST", headers: h,
    body: JSON.stringify({ email, password, email_confirm: true }) }).then((r) => r.json());
  const username = `RT${tag}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  await fetch(`${url}/rest/v1/profiles`, { method: "POST",
    headers: { ...h, Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ id: u.id, username }) });
  const tok = await fetch(`${url}/auth/v1/token?grant_type=password`, { method: "POST",
    headers: { apikey: anon, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }) }).then((r) => r.json());
  return { id: u.id, username, token: tok.access_token };
}
const delUser = (id) => fetch(`${url}/auth/v1/admin/users/${id}`, { method: "DELETE", headers: h }).catch(() => {});

const connect = (token) => new Promise((resolve, reject) => {
  const s = io(BASE, { auth: { token }, transports: ["websocket"], reconnection: false });
  s.on("connect", () => resolve(s));
  s.on("connect_error", reject);
});
const lobbyNames = async (s) => (await ask(s, "lobby:list")).map((r) => r.name);

const server = spawn("node", ["dist/index.js"], {
  cwd: SERVER_DIR, env: { ...process.env, PORT: String(PORT) }, stdio: "ignore",
});
async function waitForServer() {
  for (let i = 0; i < 40; i++) {
    try { if ((await fetch(BASE)).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("server did not start (did you run `npm run build`?)");
}

const created = [];
let sA, sB;
try {
  await waitForServer();
  console.log("Server up on", BASE);

  const A = await makeUser("A"); created.push(A.id);
  const B = await makeUser("B"); created.push(B.id);
  check("minted tokens for both accounts", !!A.token && !!B.token);
  console.log(`  A=${A.username}  B=${B.username}`);

  sA = await connect(A.token);
  sB = await connect(B.token);
  check("both sockets authenticated + connected", sA.connected && sB.connected);

  const mk = await ask(sA, "room:create", { name: "SecretA", mode: "casual", friendsOnly: true });
  check("A creates friends-only table", mk.ok, JSON.stringify(mk));
  const roomId = mk.roomId;

  check("B does NOT see SecretA in lobby", !(await lobbyNames(sB)).includes("SecretA"));
  check("A DOES see own SecretA in lobby", (await lobbyNames(sA)).includes("SecretA"));
  const joinBlocked = await ask(sB, "room:join", { roomId });
  check("B join rejected as not found", !joinBlocked.ok && /not found/i.test(joinBlocked.error), JSON.stringify(joinBlocked));
  const specBlocked = await ask(sB, "room:spectate", { roomId });
  check("B spectate rejected as not found", !specBlocked.ok && /not found/i.test(specBlocked.error), JSON.stringify(specBlocked));

  const req = await ask(sA, "friends:add", { username: B.username });
  check("A -> B request sent", req.ok && req.result === "sent", JSON.stringify(req));
  const acc = await ask(sB, "friends:add", { username: A.username });
  check("B -> A auto-accepts (now friends)", acc.ok && acc.result === "accepted", JSON.stringify(acc));

  check("B NOW sees SecretA in lobby", (await lobbyNames(sB)).includes("SecretA"));
  const joinOk = await ask(sB, "room:join", { roomId });
  check("B can now join SecretA", joinOk.ok, JSON.stringify(joinOk));

  console.log(`\n✅ All ${passed} checks passed.`);
} catch (err) {
  console.error(`\n❌ ${err.message}`);
  process.exitCode = 1;
} finally {
  sA?.disconnect(); sB?.disconnect();
  for (const id of created) await delUser(id);
  server.kill();
  console.log("Cleaned up (sockets, users, server).");
}
