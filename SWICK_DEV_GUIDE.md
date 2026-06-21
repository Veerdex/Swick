# SWICK Card Game — Developer Guide
### Building from Scratch with Claude Code

---

## What You're Building

SWICK is a **real-time multiplayer trick-taking card game** for 3–6 players. Think Spades or Euchre, but simpler and with a betting/pot mechanic. Players ante into a pot, try to win tricks (rounds), and anyone who fails to win enough tricks must "go set" — paying a penalty into the next pot.

The full rules are in `SWICK_RULES.md`. Read them before you start coding.

---

## Tech Stack — Pick What Works for You

There's no single required stack. The reference implementation (your dad's version) uses a specific set of tools, but you should use whatever you're comfortable with or want to learn. What matters is that the stack supports these requirements:

**Non-negotiable technical requirements:**
- Real-time bidirectional communication between server and all clients (WebSockets or equivalent)
- A server that can hold authoritative game state (not just a static host)
- A UI that can react to live state changes

**Reference implementation choices** (documented here so you can look at the existing code for reference):

| Layer | Reference Choice | Alternatives That Work Fine |
|-------|-----------------|----------------------------|
| Backend language | Node.js + TypeScript | Python, Go, Java, C#, plain JS |
| Real-time framework | Colyseus | Socket.io, Supabase Realtime, Ably, Pusher, raw WebSockets |
| Frontend framework | Angular | React, Vue, Svelte, plain HTML/JS |
| UI styling | TailwindCSS + Angular Material | Bootstrap, plain CSS, any component library |
| Backend hosting | AWS EC2 | Railway, Render, Fly.io, Heroku, DigitalOcean, your own machine |
| Frontend hosting | AWS S3 + CloudFront | Vercel, Netlify, GitHub Pages, same server as backend |
| Process manager | PM2 | systemd, Docker, whatever your host provides |
| SSL | Let's Encrypt / Certbot | Your host may handle this automatically |

> **Tip:** If you're just starting out, something like **Railway** or **Render** for the backend and **Vercel** or **Netlify** for the frontend will handle a lot of the infrastructure complexity for you automatically (SSL, restarts, deploys). The reference implementation runs on raw EC2 which requires more manual setup.

---

## Core Architecture (Stack-Agnostic)

Regardless of your tech choices, the architecture is the same:

```
┌─────────────────────────────────────────────────┐
│                  BROWSER (Client)                │
│  - Displays game state                           │
│  - Sends player actions (knock, play card, etc.) │
└───────────────────┬─────────────────────────────┘
                    │  WebSocket (or equivalent)
┌───────────────────▼─────────────────────────────┐
│                  SERVER                          │
│  - Holds authoritative game state                │
│  - Enforces all rules                            │
│  - Broadcasts state to all players in room       │
│  - Runs bot AI for non-human players             │
└─────────────────────────────────────────────────┘
```

**The server is the source of truth.** Clients only display and send input — they never decide game outcomes. This prevents cheating and keeps all players in sync.

---

## Project Structure (Logical, Not Framework-Specific)

However you organize your files, you need these logical pieces:

```
/backend (or /server)
  ├── game logic         ← ALL rules enforced here
  ├── game state         ← The authoritative state of each room
  ├── player management  ← Track who's connected, their hands, scores
  ├── deck / card logic  ← Shuffle, deal, draw
  └── bot AI             ← One bot handler per game phase

/frontend (or /client)
  ├── lobby / room list  ← See available games, create/join
  ├── game screen        ← Main play UI
  ├── card display       ← Individual card rendering
  └── connection layer   ← WebSocket client, state sync
```

---

## Build Order (Phases)

Build incrementally. Test each phase before moving on. **Do not try to build the whole game at once.**

### Phase 1 — Project Setup
- Get your chosen backend running and serving a WebSocket endpoint
- Get your chosen frontend running and connecting to it
- Prove the connection works with a simple "hello" message in both directions

### Phase 2 — The Deck
- Implement a 32-card deck (7–A in 4 suits, no Jokers)
- Implement shuffle + deal
- Verify no duplicate cards ever appear

### Phase 3 — Game State
Define a clear game state object. Every property the frontend needs to react to must be tracked here. Key fields regardless of framework:

```
roundState         // what phase we're in (see State Machine below)
potValue           // current pot in cents
trumpSuit          // the trump suit for this hand
trumpCard          // the specific card that was flipped
dealerId           // which player is dealer
dealerKeptTrump    // boolean
dealerTrumpValue   // 'A', 'K', 'Q', 'J', '10', '9', '8', '7'
currentTurnPlayerId
currentKnockPlayerId
currentDiscardPlayerId
nextRoundPotBonus  // set penalties carried to next hand
specialHandWinner  // player with 3 Aces, 3 Sevens, etc.

Per player:
  hand (array of cards)
  knockedIn (boolean)
  hasKnockDecision (boolean)
  hasDiscardDecision (boolean)
  tricksWon (number)
  wentSet (boolean)
  setType ('single' | 'double')
  setAmount (number)
  money (number — running balance)
  isDealer (boolean)
  isBot (boolean)
```

### Phase 4 — Lobby & Room System
- Players can create or join rooms
- Room list shows available games with player count
- Minimum 3 players required to start
- Dealer sets ante before round starts; others can't ready up until ante is set

### Phase 5 — Dealing & Trump Selection
- Deal 3 cards face-down to each player
- Flip the next card as the trump card (visible to all)
- Dealer decides: keep trump card or leave it
- **Dealer must NOT see their 3 dealt cards until their discard phase**

### Phase 6 — Knock-In Phase
- Go clockwise from dealer's left
- Each player knocks (in) or passes (out)
- If dealer passes after keeping trump → dealer goes set single immediately
- If everyone passes → dealer wins pot automatically

### Phase 7 — Discard & Draw Phase
- Non-dealers go first (clockwise from dealer's left)
- Each player may discard 0–3 cards and draw replacements
- Dealer goes last — this is the first moment the dealer sees their cards
- If dealer kept trump: trump cannot be discarded; if they draw enough to have 4 cards, they must discard one non-trump to get back to 3

### Phase 8 — Trick-Taking
- 3 tricks total per hand
- Follow-suit rules enforced by server (see SWICK_RULES.md)
- Trump beats any non-trump; highest trump wins among trumps
- Trick winner leads next trick
- Track tricks won per player

### Phase 9 — Going Set Calculation
After all 3 tricks:
- Any knocked-in player with 0 tricks → set single (match pot)
- Dealer who kept a face trump (J/Q/K/A) and won < 2 tricks → set double (double pot)
- Dealer who kept a low trump (7–10) and won 0 tricks → set single
- Set amounts carry into `nextRoundPotBonus` for the next hand
- Players who went set get a free ride next hand (no ante owed)
- Trick winners split the pot (1/3 each)

### Phase 10 — Special Hands
Check for these **before trick-taking begins**:
1. Three Aces → instant pot win, no tricks played
2. Three 7s → wins if no Three Aces in the same hand
3. A-K-Q of Trump → wins if no Three Aces or Three 7s

### Phase 11 — Bot Players (AI)
Add bots so the game is playable without a full lobby. Each phase needs its own bot decision logic:
- **Trump selection:** Keep trump if it's a face card or you have supporting trump cards
- **Knock-in:** Knock if you have strong trump or a clear strategy; pass with weak hands
- **Discard:** Drop off-suit low cards; keep trump cards
- **Card play:** Follow optimal trick-taking strategy (lead high, follow high, trump when beneficial)

---

## Critical Game Rules to Get Right (Common Mistakes)

### Dealer Visibility
The dealer is **blind** until their discard phase. Don't reveal the dealer's hand during trump selection, knock-in, or while non-dealers are discarding. Only show the dealer their cards when it's their turn to discard.

### Ace of Trump Lead Rule
Only applies to the **very first trick of the entire game** (not every hand). If the player immediately left of the dealer holds the Ace of Trump, they must lead with it. Easy to forget.

### Pot Divisibility
The pot must always be divisible by 3. If set penalties push it off, something is wrong. Validate this after every state change that touches the pot.

### Going Set Trigger
Only **knocked-in** players can go set. Players who passed have zero further obligation. Passed players get a free ride next hand (no ante).

### Set Double vs Set Single
- Set double only applies when the **dealer** kept a **face trump** (J, Q, K, A) and wins fewer than 2 tricks
- All other set scenarios are single (match the pot once)
- If the dealer voluntarily declares "Set Single" before trick-taking starts, it's always single regardless of what trump they kept

### Free Ride Rule
When any player goes set, **all players who won tricks** get a free ride next hand — no ante required. Only the next dealer pays their standard 3¢ extra. Normal antes only resume when there's no set bonus carried over.

### Trump Cannot Be Discarded
If the dealer kept the trump card, they cannot discard it under any circumstances — even if they draw 3 new cards and temporarily hold 4. Enforce this in server-side discard validation.

### State Flags Prevent Duplicate Actions
Players (and especially bots) can trigger the same action twice through rapid clicking or timing issues. Use boolean flags like `hasKnockDecision`, `hasDiscardDecision`, etc. to gate every action — check the flag before processing, set it immediately after.

---

## State Machine

The `roundState` field drives the entire game. Here's the flow:

```
idle
  └─► dealing
        └─► trump-selection  (dealer decides keep/pass)
              └─► knock-in   (players go clockwise)
                    └─► discard-draw  (players go clockwise, dealer last)
                          ├─► turns          (trick-taking begins)
                          │     └─► trick-complete  (after each trick)
                          │           └─► turns (next trick, or...)
                          └─► end  (after 3 tricks + going set calc)
                                └─► idle (next hand starts)
```

Special case exits:
- Special hand detected during discard-draw → skip to `end`
- Everyone passes during knock-in → dealer auto-wins → `end`
- Dealer voluntarily goes Set Single → remaining players play tricks → `end`

---

## WebSocket Messages Reference

These are the actions the client sends to the server. Name them whatever makes sense for your framework — the important thing is the semantic meaning:

| Action | Data | When |
|--------|------|------|
| Set ante | amount (number) | Dealer sets ante before round |
| Ready / unready | boolean | Player joins/leaves the ready queue |
| Keep trump | boolean | Dealer's trump decision |
| Knock in | boolean | Player's knock-in decision |
| Select card (for discard) | card index | Player toggles a card for discard |
| Confirm discard | — | Player finalizes their discard selection |
| Play card | card index | Player plays a card during trick-taking |
| Dealer go set | boolean | Dealer voluntarily declares Set Single |

---

## Deployment Considerations

### If you're new to deployment, start simple
Services like **Railway**, **Render**, or **Fly.io** let you deploy a Node.js (or other) backend with minimal configuration — they handle SSL, auto-restarts, and logs automatically. For the frontend, **Vercel** or **Netlify** deploy from a GitHub repo with one click.

### If you want to self-host (like the reference implementation)
- You need a reverse proxy (Nginx, Caddy) to route HTTPS/WSS traffic to your app
- You need a process manager to keep the server running and restart it on crashes
- You need SSL certificates — Let's Encrypt is free; Caddy handles it automatically
- Make sure your server survives reboots

### What can go wrong in production
1. **WebSocket connections break silently** when SSL certificates expire — always verify auto-renewal is configured
2. **Server crashes lose all in-memory game state** — players get disconnected mid-game. Either use a process manager that auto-restarts, or persist state to a database
3. **Firewall/security group rules** may block WebSocket traffic — make sure port 443 (WSS) is open to the public

---

## Prompting Strategy for Claude Code

When working with Claude Code on this project:

- **Tell it exactly which file to edit** and which function/section to look in
- **Ask for incremental changes** — one feature or bug fix at a time
- **Describe bugs in terms of game rules** — e.g., "The dealer is seeing their cards during the knock-in phase, but per the rules they should be blind until their discard turn"
- **Request only the changed code** with clear instructions on where to insert or replace it
- **Log everything during development** — server-side logs are your best debugging tool for game state issues
- **After any bot-related bug**, describe what the bot did vs. what it should have done — bot timing issues are the trickiest to debug

---

## Useful Debug Logging Patterns

Add structured logging around every state transition. This is worth the extra code — game state bugs are very hard to track down without it:

```
=== STATE: knock-in ===
Current player: Alice | Has decision: false
Pot: 12¢ | Trump: K♥ | Dealer kept trump: true

=== BOT DECISION: Alice (Medium) ===
Hand: [A♥, 9♦, 7♥] | Trump cards: 2 | Deciding to knock...
Alice knocks in

=== STATE: discard-draw ===
Current discard player: Bob
```

Bot decisions especially need verbose logging since you can't see what they're "thinking" in the UI.

---

## Future Features (Planned But Not Yet Built)

These are features that were discussed and designed but not implemented in the reference version. They're good stretch goals once the core game is solid.

---

### User Accounts & Authentication

Right now players are anonymous — they pick a display name and play. A real account system would let players carry their history, wallet, and stats across sessions.

What to build:
- Register / login (email + password, or OAuth via Google/GitHub)
- Persistent player profile stored in a database
- Session tokens so the server knows who you are across connections
- Guest play still supported, but guests can't accumulate stats or wallet balance

Database fields to track per user:
```
userId
username / display name
email
passwordHash
createdAt
lastLoginAt
totalMoneyWon / totalMoneyLost   (lifetime net)
```

Tech note: Don't roll your own auth from scratch — use a library like Passport.js, Auth.js, Supabase Auth, or Firebase Auth. Auth is easy to get wrong.

---

### Persistent Wallet

The current version tracks a player's money balance only for the duration of a session — it resets when they leave. A real wallet would:

- Store each player's balance in the database
- Deduct antes and set penalties in real time, persisted immediately
- Credit trick winnings to the account after each hand
- Show a running lifetime balance / net win on the profile page
- Allow players to "top up" their balance (with fake money — this isn't real gambling)

Design consideration: since pots can grow large with set penalties, you need to handle the case where a player doesn't have enough money to cover a set penalty. Decide whether to cap it at $0, kick them from the game, or let them go negative.

---

### Player Stats & History

Track everything that happens so players can look back at their record.

Per-hand history to store:
```
handId
gameId
timestamp
players (who was in)
potSize
trumpSuit
dealerKeptTrump
who knocked in
who won which tricks
who went set (and how much)
special hand winner (if any)
```

Stats to surface on a profile page:
- Games played / hands played
- Hands won (at least one trick)
- Times gone set (single vs double)
- Special hands hit (3 Aces, 3 Sevens, A-K-Q of Trump) — these are rare, worth celebrating
- Net money won/lost lifetime
- Win rate as dealer vs non-dealer
- Favorite trump suit (just for fun)

---

### Leaderboard

A public ranking of all players, sortable by different metrics.

Columns to consider:
- Net money won (lifetime)
- Win rate (hands where they won at least one trick / total hands played)
- Special hands hit
- Lowest set rate (best at knowing when to pass)
- Games played (volume badge)

Design note: decide whether the leaderboard is global (all-time) or has time windows (this week, this month). Time windows keep it competitive for newer players and give people a reason to keep playing.

---

### Analytics Dashboard (Admin View)

A private page for the site owner (your dad) to see how the game is being used.

Useful metrics:
- Daily/weekly active players
- Average hands per session
- Average pot size
- How often players go set (signals if the bot difficulty is balanced)
- Most popular time of day to play
- Player retention (did they come back after their first session?)
- Rooms created vs rooms that actually completed a full hand

Tech note: you can build this with a simple charting library on a password-protected route. No need for a full analytics platform at this scale — just query your own database and render the results.

---

### Spectator Mode (Watch Only)

Let players join a room without playing — they see the game in real time but can't interact.

How it works:
- Spectator connects to the room like a normal player but is flagged as `isSpectator: true`
- Server sends them the full game state updates but filters out hidden information (other players' hands)
- Spectators see face-down cards as backs (same as opponents see each other)
- Spectators cannot send any game action messages — server ignores them
- Show spectator count in the room so players know they have an audience
- Optional: let spectators send chat messages visible to everyone

Design note: decide whether spectators can join mid-hand or only between hands. Mid-hand is more interesting but requires careful handling of what state you reveal when they first join.

---

### Join Existing Games (Mid-Game Join / Reconnect)

Two related but different problems:

**Reconnect:** A player disconnects mid-game (browser closed, lost connection) and wants to come back to the same seat. The reference implementation handles temporary disconnects but drops the player if they're gone too long. A full reconnect system would:
- Hold the player's seat for a configurable timeout (e.g., 60 seconds)
- Issue a reconnect token when they first join so they can reclaim their spot
- Resume exactly where they left off

**Mid-game join:** A new player joins a game that's already in progress. This is tricky because:
- They need to receive the full current game state when they connect
- They can't join mid-hand — only between hands makes sense
- They start with a fresh wallet balance (or a set starting amount)
- The dealer rotation needs to account for them

The reference implementation requires everyone to be present at the start. Mid-game join is a significant addition.

---

### Bot Players (AI) — Difficulty Levels

The reference implementation has Easy/Medium/Hard bots, but there's room to make them much smarter. Areas for improvement:

**Trump keeping decision:**
- Easy: keep trump randomly ~50% of the time
- Medium: keep face trumps, pass on low trumps unless holding multiple trump cards
- Hard: factor in how many trump cards are in hand, what other players likely hold based on deck size

**Knock-in decision:**
- Easy: knock in if holding any trump
- Medium: evaluate hand strength — count trumps, look for high off-suit cards
- Hard: consider the pot size vs risk of going set; sometimes passing is correct even with a decent hand

**Discard strategy:**
- Easy: discard lowest cards
- Medium: keep trump, discard single low off-suit cards, draw toward strength
- Hard: track what cards have been seen, adjust discard based on remaining deck composition

**Card play:**
- Easy: play highest card of lead suit, or random trump
- Medium: basic trick-taking strategy (lead high, save trump for when needed)
- Hard: count cards, track what's been played, know when opponents are out of a suit, time trump usage optimally

**Named bot personalities** (fun, not just difficulty levels): give bots names and maybe a "style" — an aggressive bot that always knocks in, a conservative one that rarely does, etc.

---

### Chat

Simple in-game text chat so players can trash talk or celebrate a good hand.

Basics:
- Text input in the game UI, messages broadcast to everyone in the room
- Display names shown with each message
- Auto-clear old messages (keep last 10–20)
- Spectators can chat too (optional)

Extras:
- Quick-reaction emoji buttons (👍 😂 😬) — faster than typing
- Mute button per player
- Profanity filter if the game is public-facing

---

### Private Tables / Invite Links

Let players create a private room and invite specific people via a link instead of having it show up in the public lobby.

How it works:
- Player creates a room and gets a unique join link (e.g., `play.swickcardgames.com/join/abc123`)
- Room is marked private and doesn't appear in the public lobby
- Anyone with the link can join
- Optional: set a room password for extra privacy

---

### Mobile App

The current site is mobile-responsive but it's a web app. A native or hybrid mobile app would feel better on phones, especially for card interactions (tap to select, swipe to play).

Options:
- Progressive Web App (PWA) — easiest, just add a manifest and service worker to the existing web app; users can "install" it from the browser
- React Native / Expo — if you want to rebuild the frontend in React
- Capacitor — wraps an existing web app in a native shell; easiest path to app store listing

---

## Reference

- Game rules: `SWICK_RULES.md` (in this repo)
- Reference implementation (your dad's version): https://github.com/bkoupal/swick-card-game
- Colyseus docs (if using Colyseus): https://docs.colyseus.io
- Socket.io docs (popular alternative): https://socket.io/docs
