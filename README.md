# SWICK

A real-time multiplayer **trick-taking card game** for 3–6 players, with a betting/pot
mechanic. Players ante into a pot, try to win tricks, and anyone who knocks in but fails
to win a trick "goes set" — paying a penalty into the next pot.

> Created by Gary L. Koupal, 4/12/99. This is a digital reimplementation.

---

## Table of Contents

- [How It Plays](#how-it-plays)
- [The Rules](#the-rules)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [Getting Started](#getting-started)
- [Project Structure](#project-structure)
- [Roadmap](#roadmap)
- [Reference](#reference)

---

## How It Plays

Think Spades or Euchre, but simpler and with a pot. Each hand:

1. Players **ante** into a pot (always divisible by 3 — one third per trick).
2. Everyone gets **3 cards**; a **trump card** is flipped face-up.
3. Players **knock in** (commit) or **pass** (fold).
4. Knocked-in players **discard and draw** to improve their hands.
5. **3 tricks** are played. Win at least one to take a third of the pot.
6. Knock in but win nothing → you **go set** and pay a penalty into the next pot.

The catch: the **dealer is blind** to their own cards until late in the hand, and keeping
a high trump card raises the stakes — keep a face trump and you must win **two** tricks
or pay **double**.

---

## The Rules

### The Deck

- **32 cards:** 7, 8, 9, 10, J, Q, K, A in all four suits (♠ ♥ ♦ ♣). No 2–6, no Jokers.
- **Rank (high → low):** A K Q J 10 9 8 7. The 7 is the lowest card in normal play.

### The Pot

- The pot is **always divisible by 3** (3 tricks, each worth 1/3).
- **Minimum ante:** 3¢ per player. The **dealer antes 3¢ extra**.

| Player | Pays |
|--------|------|
| Player 1 | 3¢ |
| Player 2 | 3¢ |
| Dealer (Player 3) | 6¢ (3¢ + 3¢ extra) |
| **Total pot** | **12¢** |

### Objective

Win at least one trick (1/3 of the pot). Knock in and win nothing → you **go set** and
must match the pot for the next hand.

### Special Winning Hands

These beat everything and win the entire pot immediately:

| Rank | Hand |
|------|------|
| 1st (best) | Three Aces (any suits) |
| 2nd | Three 7s (any suits) |
| 3rd | Ace-King-Queen of Trump |

> Three Aces and Three 7s also beat A-K-Q of Trump.

### Sequence of a Hand

1. **Ante up** — dealer sets the amount and antes 3¢ extra.
2. **Deal** — 3 cards face-down to each player; the next card is flipped as **trump**.
3. **Trump selection (dealer only)** — keep the trump card (it joins your hand and can
   never be discarded) or pass on it. Either way the trump suit is now public.
   The dealer does **not** look at their 3 dealt cards yet.
4. **Knock-in** — clockwise from the dealer's left; dealer decides last. Pass = out,
   ante lost. If the dealer kept trump and then passes, the dealer goes set. If everyone
   else passes, the dealer wins automatically.
5. **Discard & draw** — non-dealers first, then the dealer (who now sees their cards for
   the first time). Trump card is never discardable.
6. **Trick-taking** — 3 tricks. Follow suit if able, and play a higher card of the lead
   suit if you can; otherwise play trump if you have it. Trump beats non-trump; the
   highest trump wins, else the highest of the lead suit. Trick winner leads next.

### Special Dealer Rule

If the dealer **kept** the trump card and it is a **face card (J/Q/K/A)**, before
trick-taking they must either:
- **Play these cards** — must win **2 tricks** or go **Set Double**, or
- **Set Single** — drop out and match the pot.

A kept **low** trump (7–10) only needs **1 trick** to avoid going set.

### Going Set

Only **knocked-in** players can go set. Passed players have no further obligation.

| Situation | Penalty |
|-----------|---------|
| Standard player wins 0 tricks | Match the pot (single) |
| Dealer kept low trump (7–10), 0 tricks | Match the pot (single) |
| Dealer kept face trump (J/Q/K/A), < 2 tricks | **Double the pot** (set double) |
| Dealer voluntarily declares "Set Single" | Match the pot (single) |

> **Free ride:** when anyone goes set, every player who won a trick pays **no ante** next
> hand. Only the new dealer antes their 3¢ extra. The set amount carries into the next
> pot, which can grow large over many hands.

A game **cannot end while a set is in play** — play continues until no one goes set and
the pot divides cleanly among the trick winners.

### Quick Reference

```
DECK:     32 cards — 7 through A in all 4 suits
PLAYERS:  3–6
DEAL:     3 cards each + 1 trump card flipped
TRICKS:   3 per hand (each worth 1/3 pot)
WIN:      Win ≥1 trick (or 2 if dealer kept face trump)
SET:      Miss required tricks → match (or double) the pot next hand
SPECIAL:  3 Aces > 3 Sevens > A-K-Q of Trump → instant pot win
```

The full canonical rules are in [`SWICK_RULES.md`](./SWICK_RULES.md).

---

## Tech Stack

| Layer | Choice |
|-------|--------|
| Backend | Node.js + TypeScript |
| Real-time | Socket.io |
| Frontend | React + Vite |
| Styling | TailwindCSS |
| Hosting | Railway |

**The server is the source of truth.** Clients only display state and send actions — they
never decide game outcomes. This prevents cheating and keeps all players in sync.

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│                  BROWSER (Client)                │
│  - Displays game state                           │
│  - Sends player actions (knock, play card, etc.) │
└───────────────────┬─────────────────────────────┘
                    │  WebSocket (Socket.io)
┌───────────────────▼─────────────────────────────┐
│                  SERVER (authoritative)          │
│  - Holds game state · enforces all rules         │
│  - Broadcasts state to everyone in the room      │
│  - Runs bot AI for non-human players             │
└─────────────────────────────────────────────────┘
```

---

## Getting Started

### Prerequisites

- Node.js 20.x and npm
- A Railway account (for deployment)

### Local development

```bash
# Backend (Socket.io server) — http://localhost:3001
cd server
npm install
npm run dev          # starts the authoritative game server (tsx watch)

# Frontend (React + Vite) — http://localhost:5173, in a second terminal
cd client
npm install
npm run dev          # starts the Vite dev server
```

Open http://localhost:5173, enter a name, create a table, and **+ Add bot** twice to
reach the 3-player minimum, then set the ante, ready up, and start. (The defaults wire
the client to the server with no env config needed.)

Run the server test suite with `cd server && npm test`.

### Deployment (Railway)

The app deploys as **two Railway services from this one repo**, each pointed at a
subfolder via its **Root Directory** setting. The server binds `process.env.PORT` and
Railway terminates SSL/WSS at its proxy, so WebSockets work with no extra config.

> **Order matters** — the client bakes `VITE_SERVER_URL` into its bundle at *build*
> time, so the server must have a public URL first.

1. **Server service**
   - New service → this repo → **Root Directory** = `server`.
   - Railway auto-builds (`npm run build` → `tsc`) and runs `npm start`
     (`node dist/index.js`); config is in `server/railway.json`.
   - Generate a public domain (Settings → Networking).
   - Leave `CLIENT_ORIGIN` unset for now (filled in step 3).

2. **Client service**
   - New service → same repo → **Root Directory** = `client`.
   - Add a **build variable** `VITE_SERVER_URL` = the server's public URL
     (e.g. `https://swick-server-production.up.railway.app`).
   - Railway builds (`vite build`) and serves the static `dist/` with `serve`
     (`client/railway.json`). Generate a public domain.

3. **Wire CORS back to the client**
   - On the **server** service, set `CLIENT_ORIGIN` = the client's public URL, then
     redeploy the server.

4. Open the client URL and play. If you change the client's domain or the server URL
   later, **redeploy the client** so the new `VITE_SERVER_URL` is baked in.

Environment variables at a glance:

| Service | Variable | Value | When |
|---------|----------|-------|------|
| server | `CLIENT_ORIGIN` | client's public URL | runtime (CORS) |
| client | `VITE_SERVER_URL` | server's public URL | **build** time |

---

## Project Structure

```
/server                  ← Node + TypeScript + Socket.io (authoritative)
  ├── game/              ← all rules: deck, state, state machine, rules, bots
  ├── rooms/             ← room/lobby management, player connections
  ├── socket/            ← Socket.io event handlers (thin — delegate to game/)
  └── index.ts           ← server bootstrap

/client                  ← React + Vite + Tailwind
  ├── components/        ← Card, Hand, Table, Lobby, etc.
  ├── hooks/             ← useSocket, useGameState
  └── lib/socket.ts      ← Socket.io client + state sync

SWICK_RULES.md           ← canonical game rules
SWICK_DEV_GUIDE.md       ← phased build plan
CLAUDE.md                ← contributor/AI development guide
```

---

## Roadmap

**Core game** — complete ✅

- [x] Project setup — server WS endpoint + client round-trip
- [x] 32-card deck — shuffle, deal, draw (no duplicates)
- [x] Authoritative game state
- [x] Lobby & room system (min 3 players, ante gating)
- [x] Dealing & trump selection (dealer blind)
- [x] Knock-in phase
- [x] Discard & draw phase (dealer last)
- [x] Trick-taking (follow-suit enforced server-side)
- [x] Going-set calculation
- [x] Special hands
- [x] Bot players (per-phase AI)

**Stretch goals**

- [ ] User accounts & authentication
- [ ] Persistent wallet
- [ ] Player stats & history
- [ ] Leaderboard
- [ ] Analytics dashboard (admin)
- [ ] Spectator mode
- [ ] Reconnect & mid-game join
- [ ] Smarter / named bots
- [ ] In-game chat
- [ ] Private tables / invite links
- [ ] Mobile (PWA first)

---

## Reference

- Game rules: [`SWICK_RULES.md`](./SWICK_RULES.md)
- Developer guide: [`SWICK_DEV_GUIDE.md`](./SWICK_DEV_GUIDE.md)
- Contributor / AI guide: [`CLAUDE.md`](./CLAUDE.md)
- Reference implementation (original author's version): https://github.com/bkoupal/swick-card-game
- Socket.io docs: https://socket.io/docs
