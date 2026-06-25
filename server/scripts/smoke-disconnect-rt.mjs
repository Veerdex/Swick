// Runtime smoke test for disconnect/reconnect handling, end-to-end over real
// sockets. Spawns a fresh SWICK server on a test port, mints real Supabase
// tokens for throwaway accounts, and runs two scenarios:
//
//   A. A player who drops mid-hand is shown "away", a bot finishes their seat
//      (no stall), and they're pruned at hand-end.
//   B. A player who drops mid-hand but reconnects before it ends keeps their
//      seat (connected restored, not pruned).
//   C. A table that falls below the minimum re-opens for a refill join, then
//      the host can deal again (no soft-lock).
//
// Requires a build first (`npm run build`) and SUPABASE_* keys in server/.env.
// Run from server/:  node scripts/smoke-disconnect-rt.mjs
import "dotenv/config";
import { io } from "socket.io-client";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const SERVER_DIR = fileURLToPath(new URL("..", import.meta.url));
const PORT = 3098;
const BASE = `http://localhost:${PORT}`;

const url = process.env.SUPABASE_URL;
const anon = process.env.SUPABASE_ANON_KEY;
const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anon || !svc) throw new Error("Missing SUPABASE_URL / ANON / SERVICE_ROLE key in server/.env");
const h = { apikey: svc, Authorization: `Bearer ${svc}`, "Content-Type": "application/json" };

const ask = (s, ev, ...a) => new Promise((r) => s.emit(ev, ...a, r));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0;
const check = (label, cond, detail) => {
  if (cond) { console.log(`  ✓ ${label}`); passed++; }
  else throw new Error(`FAILED: ${label}${detail ? ` — ${detail}` : ""}`);
};

async function makeUser(tag) {
  const email = `smoke_${tag}_${Date.now()}@swick.test`;
  const password = "Sw1ck!" + Math.random().toString(36).slice(2);
  const u = await fetch(`${url}/auth/v1/admin/users`, { method: "POST", headers: h,
    body: JSON.stringify({ email, password, email_confirm: true }) }).then((r) => r.json());
  const username = `DC${tag}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  await fetch(`${url}/rest/v1/profiles`, { method: "POST",
    headers: { ...h, Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ id: u.id, username }) });
  const tok = await fetch(`${url}/auth/v1/token?grant_type=password`, { method: "POST",
    headers: { apikey: anon, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }) }).then((r) => r.json());
  return { id: u.id, username, token: tok.access_token };
}
const delUser = (id) => fetch(`${url}/auth/v1/admin/users/${id}`, { method: "DELETE", headers: h }).catch(() => {});
const connect = (token) => new Promise((res, rej) => {
  const s = io(BASE, { auth: { token }, transports: ["websocket"], reconnection: false });
  s.on("connect", () => res(s));
  s.on("connect_error", rej);
});

// Minimal auto-player: acts on its own turn in each phase (handles the dealer's
// forced 4->3 trim by dropping a non-trump card).
function autoPlay(socket, myId) {
  socket.on("room:state", (v) => {
    const s = v?.state; if (!s) return;
    if (s.roundState === "trump-selection" && s.dealerId === myId)
      socket.emit("room:keepTrump", { keep: true }, () => {});
    else if (s.roundState === "knock-in" && s.currentKnockPlayerId === myId)
      socket.emit("room:knock", { knock: true }, () => {});
    else if (s.roundState === "discard-draw" && s.currentDiscardPlayerId === myId) {
      const me = s.players.find((p) => p.id === myId);
      if (me && me.handCount > 3) {
        const hand = me.hand || [];
        let ix = hand.findIndex((c) => c && c.suit !== s.trumpSuit);
        if (ix < 0) ix = 0;
        socket.emit("room:discard", { indices: [ix] }, () => {});
      } else socket.emit("room:discard", { indices: [] }, () => {});
    } else if (s.roundState === "turns" && s.currentTurnPlayerId === myId) {
      const i = (s.yourLegalPlays || [])[0];
      if (i != null) socket.emit("room:playCard", { index: i }, () => {});
    }
  });
}

const ACTIVE = new Set(["knock-in", "discard-draw", "turns"]);
const server = spawn("node", ["dist/index.js"], {
  cwd: SERVER_DIR, env: { ...process.env, PORT: String(PORT) }, stdio: "ignore",
});
async function waitUp() {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(BASE)).ok) return; } catch {} await sleep(250); }
  throw new Error("server did not start (did you run `npm run build`?)");
}

/** Build a 3-seat casual table (observer O + victim V + 1 bot), ready to start. */
async function setupGame(tag) {
  const O = await makeUser(`${tag}O`);
  const V = await makeUser(`${tag}V`);
  const sO = await connect(O.token);
  const sV = await connect(V.token);
  autoPlay(sO, O.id);
  autoPlay(sV, V.id);
  const mk = await ask(sO, "room:create", { mode: "casual" });
  await ask(sO, "room:addBot");
  await ask(sV, "room:join", { roomId: mk.roomId });
  await ask(sO, "room:setAnte", { amount: 3 });
  await ask(sO, "room:ready", { ready: true });
  await ask(sV, "room:ready", { ready: true });
  return { O, V, sO, sV, roomId: mk.roomId };
}

const created = [];
const sockets = [];
try {
  await waitUp();
  console.log("Server up on", BASE);

  // ---- Scenario A: bot takeover + prune ----
  console.log("\nScenario A — drop mid-hand, bot finishes, pruned at end:");
  {
    const g = await setupGame("A");
    created.push(g.O.id, g.V.id);
    sockets.push(g.sO, g.sV);
    let latestO = null, sawAway = false, reachedEnd = false, dropped = false;
    g.sO.on("room:state", (v) => {
      latestO = v;
      const Vp = v?.state?.players?.find((p) => p.id === g.V.id);
      if (Vp && Vp.connected === false) sawAway = true;
      if (ACTIVE.has(v?.state?.roundState) && !dropped) { dropped = true; setTimeout(() => g.sV.disconnect(), 50); }
      if (v?.state?.roundState === "end") reachedEnd = true;
    });
    await ask(g.sO, "room:start");
    for (let i = 0; i < 160 && !reachedEnd; i++) await sleep(250);
    await sleep(400);
    check("dropped player shown as 'away' (bot took over)", sawAway);
    check("hand reached end (no stall)", reachedEnd);
    const ids = (latestO?.state?.players || []).map((p) => p.id);
    check("dropped player removed at hand end", !ids.includes(g.V.id), JSON.stringify(ids));
    check("observer kept their seat", ids.includes(g.O.id));
  }

  // ---- Scenario B: reconnect keeps the seat ----
  console.log("\nScenario B — drop mid-hand, reconnect before end, keep seat:");
  {
    const g = await setupGame("B");
    created.push(g.O.id, g.V.id);
    sockets.push(g.sO, g.sV);
    let latestO = null, sawAway = false, sawBack = false, reachedEnd = false, phase = 0;
    g.sO.on("room:state", (v) => {
      latestO = v;
      const Vp = v?.state?.players?.find((p) => p.id === g.V.id);
      if (Vp && Vp.connected === false) sawAway = true;
      if (sawAway && Vp && Vp.connected === true) sawBack = true;
      if (ACTIVE.has(v?.state?.roundState) && phase === 0) {
        phase = 1;
        setTimeout(() => g.sV.disconnect(), 50);
        setTimeout(async () => { const s2 = await connect(g.V.token); autoPlay(s2, g.V.id); sockets.push(s2); }, 1200);
      }
      if (v?.state?.roundState === "end") reachedEnd = true;
    });
    await ask(g.sO, "room:start");
    for (let i = 0; i < 160 && !reachedEnd; i++) await sleep(250);
    await sleep(400);
    check("player went 'away' on disconnect", sawAway);
    check("player came back (connected) on reconnect", sawBack);
    check("hand reached end", reachedEnd);
    const ids = (latestO?.state?.players || []).map((p) => p.id);
    check("reconnected player STILL seated at end", ids.includes(g.V.id), JSON.stringify(ids));
  }

  // ---- Scenario C: below-minimum table re-opens for a refill join ----
  console.log("\nScenario C — drop below the minimum, refill, deal again:");
  {
    const g = await setupGame("C");
    created.push(g.O.id, g.V.id);
    sockets.push(g.sO, g.sV);
    let latestO = null, reachedEnd = false, dropped = false;
    g.sO.on("room:state", (v) => {
      latestO = v;
      if (ACTIVE.has(v?.state?.roundState) && !dropped) { dropped = true; setTimeout(() => g.sV.disconnect(), 50); }
      if (v?.state?.roundState === "end") reachedEnd = true;
    });
    await ask(g.sO, "room:start");
    for (let i = 0; i < 160 && !reachedEnd; i++) await sleep(250);
    await sleep(500);
    check("dropped to 2 players", (latestO?.state?.players || []).length === 2);

    const W = await makeUser("CW");
    created.push(W.id);
    const sW = await connect(W.token);
    sockets.push(sW);
    const list = await ask(sW, "lobby:list");
    const r = list.find((x) => x.id === g.roomId);
    check("table flagged needsPlayers in the lobby", !!r && r.needsPlayers === true);
    const jn = await ask(sW, "room:join", { roomId: g.roomId });
    check("W refilled the below-minimum started game", jn.ok, JSON.stringify(jn));
    await sleep(300);
    check("back to 3 players", (latestO?.state?.players || []).length === 3);
    const nh = await ask(g.sO, "room:nextHand");
    check("host can deal the next hand again", nh.ok, JSON.stringify(nh));
    await sleep(400);
    check("new hand is live (not stuck at end)", latestO?.state?.roundState !== "end", latestO?.state?.roundState);
  }

  console.log(`\n✅ All ${passed} checks passed.`);
} catch (err) {
  console.error(`\n❌ ${err.message}`);
  process.exitCode = 1;
} finally {
  for (const s of sockets) s?.disconnect();
  for (const id of created) await delUser(id);
  server.kill();
  console.log("Cleaned up (sockets, users, server).");
}
