# CLAUDE.md — SWICK Card Game

Guidance for Claude Code when working in this repository. Read this in full before
making changes. The authoritative game rules live in `SWICK_RULES.md` and the build
plan lives in `SWICK_DEV_GUIDE.md` — this file is the operational contract between them.

---

## 1. What This Project Is

SWICK is a **real-time multiplayer trick-taking card game** for 3–6 players, with a
betting/pot mechanic. Players ante into a pot, try to win tricks, and anyone who
knocks in but fails to win a trick "goes set" — paying a penalty into the next pot.

The game was created by Gary L. Koupal (4/12/99). We are building a faithful digital
version. The reference implementation (the original author's son's version) is at
https://github.com/bkoupal/swick-card-game and uses Colyseus + Angular — **we are not
copying its stack**, but its game logic is a useful cross-reference.

---

## 2. Tech Stack (committed)

| Layer | Choice |
|-------|--------|
| Backend language | **Node.js + TypeScript** |
| Real-time framework | **Socket.io** |
| Frontend framework | **React + Vite** |
| UI styling | **TailwindCSS** |
| Backend hosting | **Railway** |
| Frontend hosting | **Railway** (or Vercel/Netlify if split out) |

**Do not introduce other frameworks** (Angular, Colyseus, Vue, Next.js, etc.) without
explicit approval. If a task seems to need one, ask first.

Railway implications worth remembering:
- The backend is a **long-lived, stateful Node process** — not serverless. In-memory
  authoritative game state is acceptable for the core game (persistence comes later).
- WebSockets (WSS) work out of the box; Railway terminates SSL and auto-restarts on crash.
- Set the server to bind `process.env.PORT` (Railway injects it).

---

## 3. Repository Layout

```
/server                  ← Node + TypeScript + Socket.io (authoritative)
  ├── game/              ← ALL rules enforced here
  │   ├── deck.ts        ← 32-card deck, shuffle, deal, draw
  │   ├── state.ts       ← GameState type + room state
  │   ├── stateMachine.ts← roundState transitions
  │   ├── rules.ts       ← follow-suit, trick winner, set calc, special hands
  │   └── bots.ts        ← per-phase bot decision logic
  ├── rooms/            ← room/lobby management, player connections
  ├── socket/           ← Socket.io event handlers (thin — delegate to game/)
  └── index.ts          ← server bootstrap, binds process.env.PORT

/client                  ← React + Vite + Tailwind
  ├── components/        ← Card, Hand, Table, Lobby, etc.
  ├── hooks/             ← useSocket, useGameState
  ├── lib/socket.ts      ← Socket.io client + state sync
  └── App.tsx

SWICK_RULES.md           ← canonical game rules (source of truth for gameplay)
SWICK_DEV_GUIDE.md       ← phased build plan
CLAUDE.md                ← this file
```

This is a target layout; create directories as phases require them. Keep **all rule
enforcement on the server** — the client only displays state and sends input.

---

## 4. The Single Most Important Architectural Rule

**The server is the source of truth.** Clients display state and send actions; they
never decide game outcomes. Every rule, every validation, every random draw happens
server-side. This prevents cheating and keeps players in sync. Never move authoritative
logic into the client to "save a round trip."

---

## 5. Game Rules Claude Must Get Right

These are the rules most commonly implemented wrong. Treat each as a hard requirement
and cross-check against `SWICK_RULES.md`.

**The deck**
- Exactly **32 cards**: 7, 8, 9, 10, J, Q, K, A in ♠ ♥ ♦ ♣. No 2–6, no Jokers.
- Rank high→low: A K Q J 10 9 8 7. The 7 is lowest in normal play.
- After every shuffle/deal/draw, assert no duplicate card exists.

**The pot**
- Must **always be divisible by 3** (3 tricks, each worth 1/3). Validate after every
  pot-touching state change. If it goes off, something is wrong.
- Minimum ante 3¢/player. **Dealer antes 3¢ extra** on top of the standard ante.

**Dealer visibility (easy to break)**
- The dealer is **blind** to their 3 dealt cards until their own discard turn.
- Do NOT reveal the dealer's hand during trump-selection, knock-in, or while
  non-dealers discard. Only reveal at the dealer's discard phase.

**Trump selection**
- Dealer flips the top remaining card after the deal — that is the trump card; trump
  suit becomes public either way.
- Keep it → it joins the dealer's hand and **cannot be discarded**, ever (even if a
  4-card overdraw forces a discard, discard a non-trump).
- Pass on it → trump suit still public, dealer gets no extra card.

**Knock-in**
- Clockwise from dealer's left; dealer decides **last**.
- Pass = out, ante lost, **no further obligation** (cannot go set).
- Dealer who kept trump then passes → goes **set single** immediately.
- Everyone except dealer passes → dealer **auto-wins** the pot.

**Discard & draw**
- Non-dealers go first (clockwise from dealer's left); **dealer goes last**.
- Discard 0–3, draw that many. Trump card never discardable.

**Ace-of-Trump lead rule**
- Applies **only to the very first trick of the entire game**, not every hand. If the
  player immediately left of the dealer holds the Ace of Trump, they must lead it.

**Trick-taking**
- Must follow suit if able, AND must play a **higher card of the lead suit** if you
  have one.
- Can't follow suit → must play trump if you have one. Else play anything.
- Trump beats non-trump; highest trump wins; else highest of lead suit wins.
- Trick winner leads next. 3 tricks per hand.

**Special hands** — check **before** trick-taking begins; they win the whole pot instantly:
1. Three Aces (best)
2. Three 7s (beats A-K-Q of trump)
3. A-K-Q of Trump
   Priority: 3 Aces > 3 Sevens > A-K-Q of Trump.

**Going set**
- Only **knocked-in** players can go set.
- Standard knocked-in player, 0 tricks → **set single** (match pot).
- Dealer kept **face trump** (J/Q/K/A) and won **< 2 tricks** → **set double** (double pot).
- Dealer kept **low trump** (7–10) and won 0 tricks → **set single**.
- Dealer voluntarily declares "Set Single" before play → always single.
- Set amounts carry into `nextRoundPotBonus`.

**Free ride**
- When anyone goes set, **all trick winners get a free ride next hand** (no ante). Only
  the next dealer pays the standard 3¢ extra. Normal antes resume only when no set bonus
  is carried over.

**Game end**
- A game **cannot end while a set is in play**. Continue until no one goes set and the
  pot divides cleanly among trick winners.

---

## 6. State Machine

`roundState` drives the game:

```
idle → dealing → trump-selection → knock-in → discard-draw
        → turns ⇄ trick-complete  (loop for 3 tricks)
        → end → idle (next hand)
```

Special exits:
- Special hand detected during discard-draw → skip to `end`.
- Everyone passes during knock-in → dealer auto-wins → `end`.
- Dealer voluntarily goes Set Single → remaining players play tricks → `end`.

---

## 7. Game State Shape

Track at minimum (see `SWICK_DEV_GUIDE.md` Phase 3 for the full list):

```
roundState, potValue, trumpSuit, trumpCard,
dealerId, dealerKeptTrump, dealerTrumpValue,
currentTurnPlayerId, currentKnockPlayerId, currentDiscardPlayerId,
nextRoundPotBonus, specialHandWinner

per player:
  hand[], knockedIn, hasKnockDecision, hasDiscardDecision,
  tricksWon, wentSet, setType('single'|'double'), setAmount,
  money, isDealer, isBot
```

**Duplicate-action guard:** every action is gated by a boolean flag
(`hasKnockDecision`, `hasDiscardDecision`, …). Check the flag before processing, set it
immediately after. Bots and rapid clicks WILL fire actions twice otherwise.

---

## 8. Client → Server Actions

Name them sensibly; semantics matter more than names:

| Action | Data | When |
|--------|------|------|
| Set ante | amount | Dealer, before round |
| Ready/unready | boolean | Player joins/leaves ready queue |
| Keep trump | boolean | Dealer's trump decision |
| Knock in | boolean | Player's knock decision |
| Select card (discard) | card index | Toggle a card for discard |
| Confirm discard | — | Finalize discard |
| Play card | card index | During trick-taking |
| Dealer go set | boolean | Dealer voluntarily Set Single |

Server validates **every** action against current `roundState`, whose turn it is, and
the relevant gate flag. Reject and ignore anything illegal — never trust the client.

---

## 9. Build Order

Build incrementally and **test each phase before moving on**. Do not attempt the whole
game at once.

**Core game (do these first, in order):**
1. Project setup — backend WS endpoint + frontend connecting; prove round-trip "hello".
2. The deck — 32 cards, shuffle, deal; assert no duplicates.
3. Game state — define the state object; everything the UI reacts to lives here.
4. Lobby & rooms — create/join, room list w/ player count, min 3 to start, ante gating.
5. Dealing & trump selection — deal 3 face-down + flip trump; dealer keep/pass; dealer blind.
6. Knock-in phase.
7. Discard & draw phase (dealer last, sees cards for first time).
8. Trick-taking (3 tricks, follow-suit enforced server-side).
9. Going-set calculation.
10. Special hands (checked before trick-taking).
11. Bot players — one decision handler per phase (trump / knock / discard / play).

**Stretch roadmap (after core is solid and playable):**
12. User accounts & auth — use a library (Auth.js / Passport / Supabase Auth); never roll your own.
13. Persistent wallet — DB-backed balance; handle insufficient-funds-for-set case.
14. Player stats & history — per-hand history records, profile stats.
15. Leaderboard — sortable rankings; decide global vs time-windowed.
16. Analytics dashboard (admin) — password-protected route, charts over our own DB.
17. Spectator mode — `isSpectator` flag, hidden-info filtered, no actions accepted.
18. Reconnect & mid-game join — seat hold + reconnect token; mid-hand joins disallowed.
19. Smarter bots — Easy/Medium/Hard tiers, optional named personalities.
20. Chat — room broadcast, last 10–20 messages, optional emoji/mute/filter.
21. Private tables / invite links.
22. Mobile — PWA first (cheapest), then consider Capacitor/React Native.

When persistence is introduced (phases 12+), a database is added; until then in-memory
room state on the Railway process is fine.

---

## 10. How to Work in This Repo

- **One feature or bug fix at a time.** Incremental changes, tested before the next.
- **Describe bugs in terms of game rules** (e.g. "dealer hand is visible during knock-in
  but the rules require the dealer to be blind until discard").
- **Log every state transition.** Server logs are the primary debugging tool for game
  state. Structured logs around each phase change are worth the extra lines:

  ```
  === STATE: knock-in ===
  Current player: Alice | Has decision: false
  Pot: 12¢ | Trump: K♥ | Dealer kept trump: true

  === BOT DECISION: Alice (Medium) ===
  Hand: [A♥, 9♦, 7♥] | Trump cards: 2 | Deciding to knock... → knocks in
  ```

- **Bot bugs:** always describe what the bot did vs. what it should have done. Bot timing
  issues are the trickiest class of bug here. Log bot reasoning verbosely.
- **Keep `socket/` handlers thin** — they parse input and delegate to `game/`. Game logic
  must be unit-testable without a socket.
- After touching pot/set logic, re-assert pot divisibility by 3.

---

## 11. Production Gotchas (Railway)

- Bind `process.env.PORT`; don't hardcode a port.
- In-memory state is lost on restart/redeploy — players drop mid-game. Acceptable for
  core dev; revisit with persistence (phase 13+) or a reconnect window (phase 18).
- Verify WSS connects through Railway's proxy; configure Socket.io CORS for the frontend origin.

---

## 12. Quick Reference

```
DECK:     32 cards — 7 through A in all 4 suits
PLAYERS:  3–6
DEAL:     3 cards each + 1 trump card flipped
TRICKS:   3 per hand (each worth 1/3 pot)
WIN:      Win ≥1 trick (or 2 if dealer kept face trump)
SET:      Miss required tricks → match (or double) the pot next hand
SPECIAL:  3 Aces > 3 Sevens > A-K-Q of Trump → instant pot win
SERVER:   Source of truth. Client only displays + sends input.
```
