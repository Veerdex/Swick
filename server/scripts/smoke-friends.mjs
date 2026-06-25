// Smoke test for the friends feature against the LIVE Supabase project.
//
// It creates two throwaway accounts (admin API), runs the exact request →
// list → accept → reverse-auto-accept → remove flow that server/src/lib/db.ts
// performs (RPC + PostgREST), asserts each result, then deletes the test
// users (which cascades to their profiles + friendships).
//
// Requires migration 0005 to be applied. Run from server/:  node scripts/smoke-friends.mjs
import "dotenv/config";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");

const h = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
const REST = `${url}/rest/v1`;
const ADMIN = `${url}/auth/v1/admin/users`;

let passed = 0;
function check(label, cond, detail) {
  if (cond) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    throw new Error(`FAILED: ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function j(res, ctx) {
  const text = await res.text();
  if (!res.ok) throw new Error(`${ctx} -> ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

// --- the db.ts flows, reimplemented inline so we test the real DB -----------
const rpcAdd = (requester, target_name) =>
  fetch(`${REST}/rpc/friend_request`, { method: "POST", headers: h, body: JSON.stringify({ requester, target_name }) }).then((r) => j(r, "friend_request"));

async function list(userId) {
  const rows = await fetch(`${REST}/friendships?or=(user_id.eq.${userId},friend_id.eq.${userId})&select=user_id,friend_id,status`, { headers: h }).then((r) => j(r, "list"));
  if (!rows.length) return [];
  const meta = new Map();
  for (const r of rows) {
    const other = r.user_id === userId ? r.friend_id : r.user_id;
    meta.set(other, { status: r.status, incoming: r.friend_id === userId && r.status === "pending" });
  }
  const ids = [...meta.keys()];
  const names = await fetch(`${REST}/profiles?id=in.(${ids.join(",")})&select=id,username`, { headers: h }).then((r) => j(r, "names"));
  const nameById = new Map(names.map((n) => [n.id, n.username]));
  return ids.map((id) => ({ id, username: nameById.get(id), ...meta.get(id) }));
}

const respond = (me, other, accept) =>
  fetch(`${REST}/friendships?user_id=eq.${other}&friend_id=eq.${me}&status=eq.pending`, {
    method: accept ? "PATCH" : "DELETE",
    headers: { ...h, Prefer: "return=representation" },
    body: accept ? JSON.stringify({ status: "accepted" }) : undefined,
  }).then((r) => j(r, "respond"));

const remove = (me, other) =>
  fetch(`${REST}/friendships?or=(and(user_id.eq.${me},friend_id.eq.${other}),and(user_id.eq.${other},friend_id.eq.${me}))`, { method: "DELETE", headers: h }).then((r) => j(r, "remove"));

// --- test-user lifecycle ----------------------------------------------------
async function makeUser(tag) {
  const email = `smoke_${tag}_${Date.now()}@swick.test`;
  const u = await fetch(ADMIN, { method: "POST", headers: h, body: JSON.stringify({ email, password: "Sw1ck!" + Math.random().toString(36).slice(2), email_confirm: true }) }).then((r) => j(r, "create user"));
  const username = `Smoke${tag}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  await fetch(`${REST}/profiles`, { method: "POST", headers: { ...h, Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ id: u.id, username }) }).then((r) => j(r, "create profile"));
  return { id: u.id, username };
}
const delUser = (id) => fetch(`${ADMIN}/${id}`, { method: "DELETE", headers: h }).then((r) => j(r, "delete user")).catch(() => {});

// --- run --------------------------------------------------------------------
const created = [];
try {
  console.log("Creating two test accounts...");
  const a = await makeUser("A"); created.push(a.id);
  const b = await makeUser("B"); created.push(b.id);
  console.log(`  A=${a.username}  B=${b.username}\n`);

  console.log("A sends a request to B:");
  check("returns 'sent'", (await rpcAdd(a.id, b.username)) === "sent");
  check("duplicate returns 'already_pending'", (await rpcAdd(a.id, b.username)) === "already_pending");
  check("unknown username returns 'not_found'", (await rpcAdd(a.id, "NoSuchUser9999")) === "not_found");
  check("self-request returns 'self'", (await rpcAdd(a.id, a.username)) === "self");

  console.log("\nPending shows on both sides:");
  const aList1 = await list(a.id);
  const bList1 = await list(b.id);
  check("A sees outgoing pending", aList1.length === 1 && aList1[0].status === "pending" && aList1[0].incoming === false, JSON.stringify(aList1));
  check("B sees incoming pending", bList1.length === 1 && bList1[0].status === "pending" && bList1[0].incoming === true, JSON.stringify(bList1));
  check("B sees A's username", bList1[0].username === a.username);

  console.log("\nB accepts:");
  const acc = await respond(b.id, a.id, true);
  check("PATCH affected 1 row", Array.isArray(acc) && acc.length === 1);
  check("A now has accepted friend", (await list(a.id))[0].status === "accepted");
  check("B now has accepted friend", (await list(b.id))[0].status === "accepted");

  console.log("\nReverse auto-accept (remove, then both request):");
  await remove(a.id, b.id);
  check("removed -> A list empty", (await list(a.id)).length === 0);
  check("A re-requests B -> 'sent'", (await rpcAdd(a.id, b.username)) === "sent");
  check("B requests A back -> 'accepted'", (await rpcAdd(b.id, a.username)) === "accepted");
  const aFinal = await list(a.id);
  check("exactly one accepted relationship", aFinal.length === 1 && aFinal[0].status === "accepted", JSON.stringify(aFinal));

  console.log("\nDecline path:");
  await remove(a.id, b.id);
  await rpcAdd(a.id, b.username);
  const dec = await respond(b.id, a.id, false);
  check("DELETE (decline) affected 1 row", Array.isArray(dec) && dec.length === 1);
  check("nothing remains after decline", (await list(a.id)).length === 0);

  console.log(`\n✅ All ${passed} checks passed.`);
} catch (err) {
  console.error(`\n❌ ${err.message}`);
  process.exitCode = 1;
} finally {
  console.log("\nCleaning up test users...");
  for (const id of created) await delUser(id);
  console.log("Done.");
}
