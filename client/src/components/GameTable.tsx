import { Fragment, useEffect, useRef, useState, type CSSProperties } from "react";
import { socket } from "../lib/socket";
import Card from "./Card";
import type {
  Card as CardT,
  CardSlot,
  PlayerView,
  Rank,
  RoomView,
  Suit,
} from "../types";

// --- Layout ---------------------------------------------------------------
type Pos = { x: number; y: number }; // seat center, in % of the screen

// You're always at the bottom (with larger cards). The deck + trump form one
// cluster centered on screen: the deck sits a FIXED pixel distance left of
// center, the trump the same distance to its right — so the gap between them
// stays constant regardless of screen width (it would grow if measured in vw).
const USER_POS: Pos = { x: 50, y: 80 };
const CENTER: Pos = { x: 50, y: 46 }; // center of the deck/trump cluster, in %
// Deck/trump each sit this far left/right of center. Expressed in card units
// (--cu) so the gap shrinks with the cards on narrow screens — at the max card
// size (--cu = 100px) this is 65px, matching the original fixed offset.
const HALF_GAP = "var(--cu, 40px) * 0.65";
const deckLeft = `calc(${CENTER.x}% - ${HALF_GAP})`;
const trumpLeft = `calc(${CENTER.x}% + ${HALF_GAP})`;

// Fly-delta from a seat to the deck: the seat→center span scales with the
// viewport (vw/vh), and the deck's offset from center scales with the cards.
const deckFly = (pos: Pos): CSSProperties =>
  ({
    "--fx": `calc(${CENTER.x - pos.x}vw - ${HALF_GAP})`,
    "--fy": `${CENTER.y - pos.y}vh`,
  }) as CSSProperties;

// Positions for the OTHER players, ordered clockwise from the user so the deal
// travels around the table. Keyed by total player count.
const OTHER_SLOTS: Record<number, Pos[]> = {
  3: [{ x: 84, y: 42 }, { x: 50, y: 11 }], // right, top
  4: [{ x: 84, y: 42 }, { x: 50, y: 11 }, { x: 16, y: 42 }], // right, top, left
  5: [
    { x: 85, y: 56 }, { x: 85, y: 30 }, { x: 50, y: 11 }, { x: 16, y: 42 },
  ], // 2 right, top, left
  6: [
    { x: 85, y: 56 }, { x: 85, y: 30 }, { x: 50, y: 11 },
    { x: 16, y: 30 }, { x: 16, y: 56 },
  ], // 2 right, top, 2 left
};

// --- Dealer-selection cinematic + deal timing -----------------------------
const WAITING_MS = 1800;
const PRE_REVEAL_MS = 1000;
const REVEAL_INTERVAL_MS = 600;
const DEALER_POPUP_MS = 3000;
const DEAL_START_MS = 3300; // after the dealer is announced (and the notice clears)
const DEAL_INTERVAL_MS = 200; // 5 cards/second
const CARDS_EACH = 3;
const TRUMP_PAUSE_MS = 1000; // pause after the last card before the trump flip
const DECISION_TIMEOUT_S = 10; // dealer's trump keep/pass auto-decides after this
const KNOCK_TIMEOUT_S = 15; // knock-in / pass auto-passes after this long
const DISCARD_TIMEOUT_S = 30; // auto-accept the swap after this long (all players)
const TRIM_TIMEOUT_S = 15; // the kept-trump dealer's second step (trim to 3)
const PLAY_TIMEOUT_S = 30; // auto-play a legal card after this long on your turn
const END_KICK_S = 30; // auto-leave the end screen if idle this long

// Countdown ring geometry.
const RING_R = 28;
const RING_CIRC = 2 * Math.PI * RING_R;

const SUITS: Suit[] = ["spades", "hearts", "diamonds", "clubs"];
const NON_ACE: Rank[] = ["7", "8", "9", "10", "J", "Q", "K"];
const RANK_ORDER: Rank[] = ["7", "8", "9", "10", "J", "Q", "K", "A"];
const money = (cents: number) => `${cents}¢`;
// Per-player colours (Red, Orange, Yellow, Green, Blue, Purple), assigned by
// seat order. Each player's cards and name badge wear their colour so it's easy
// to track who's who around the table.
const PLAYER_COLORS = [
  "#ef4444", // red
  "#f97316", // orange
  "#facc15", // yellow
  "#4ade80", // green
  "#3b82f6", // blue
  "#a855f7", // purple
];
const rankValue = (r: Rank) => RANK_ORDER.indexOf(r);
const sameCard = (a: CardSlot, b: CardSlot) =>
  !!a && !!b && a.rank === b.rank && a.suit === b.suit;
const SUIT_SYMBOL: Record<Suit, string> = {
  spades: "♠",
  hearts: "♥",
  diamonds: "♦",
  clubs: "♣",
};
const rnd = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];

function buildRevealSequence(): CardT[] {
  const count = 2 + Math.floor(Math.random() * 3);
  const seq: CardT[] = Array.from({ length: count }, () => ({
    rank: rnd(NON_ACE),
    suit: rnd(SUITS),
  }));
  seq.push({ rank: "A", suit: rnd(SUITS) });
  return seq;
}

type Phase =
  | "waiting"
  | "selecting"
  | "revealing"
  | "dealerFound"
  | "dealing"
  | "trump"
  | "live"; // intro done — render from the live game state

/** A countdown ring with the seconds in the center (ring depletes over `total`s). */
function CountdownRing({ seconds, total = 10 }: { seconds: number; total?: number }) {
  return (
    <svg width="72" height="72" viewBox="0 0 72 72" className="drop-shadow">
      <circle
        cx="36"
        cy="36"
        r={RING_R}
        fill="rgba(0,0,0,0.4)"
        stroke="rgba(255,255,255,0.18)"
        strokeWidth="6"
      />
      <circle
        cx="36"
        cy="36"
        r={RING_R}
        fill="none"
        stroke="#fbbf24"
        strokeWidth="6"
        strokeLinecap="round"
        strokeDasharray={RING_CIRC}
        className="countdown-ring"
        style={
          { "--circ": RING_CIRC, animationDuration: `${total}s` } as CSSProperties
        }
        transform="rotate(-90 36 36)"
      />
      <text
        x="36"
        y="36"
        textAnchor="middle"
        dominantBaseline="central"
        fontSize="24"
        fontWeight="700"
        fill="#fff"
      >
        {seconds}
      </text>
    </svg>
  );
}

/** A small stack of face-down cards. */
function Deck() {
  return (
    <div
      className="relative"
      style={{ width: "calc(var(--cu, 40px) * 1.4)", height: "calc(var(--cu, 40px) * 2)" }}
    >
      {[0, 1, 2].map((i) => (
        <div key={i} className="absolute" style={{ left: i * 2, top: i * -2 }}>
          <Card card={null} />
        </div>
      ))}
    </div>
  );
}

/** One player's seat: name above a fanned hand (face-down, or face-up for you). */
function Seat({
  player,
  pos,
  isUser,
  hand,
  anim,
  dimmed,
  selecting = false,
  selected,
  lockedIndex = -1,
  onToggle,
  swapInCount = 0,
  isTurn = false,
  playable = false,
  legalPlays,
  onPlay,
  color,
  showDealer = true,
}: {
  player: PlayerView;
  pos: Pos;
  isUser: boolean;
  hand: CardSlot[];
  anim: "deal" | "flip" | "none";
  dimmed: boolean;
  /** The player's tracking colour (name outline + card borders). */
  color: string;
  /** Whether to show the DEALER label (hidden until the dealer is revealed). */
  showDealer?: boolean;
  /** When true the cards are tappable for the discard/swap selection. */
  selecting?: boolean;
  selected?: Set<number>;
  /** A card index that can't be selected (the dealer's kept trump). */
  lockedIndex?: number;
  onToggle?: (i: number) => void;
  /** The last N cards just drawn — deal them in from the deck (swap animation). */
  swapInCount?: number;
  /** Highlight this seat as the one whose turn it is (trick-taking). */
  isTurn?: boolean;
  /** When true the cards are tappable to play a card (your turn in a trick). */
  playable?: boolean;
  /** Hand indices that are legal plays right now (others are dimmed). */
  legalPlays?: Set<number>;
  onPlay?: (i: number) => void;
}) {
  const size = isUser ? "md" : "sm";
  // Your hand is spread out (at most 4 cards); opponents' cards overlap. Spacing
  // scales with the card unit so the fan looks the same at any size.
  const spacing = isUser
    ? "calc(var(--cu, 40px) * 0.2)"
    : "calc(var(--cu, 40px) * -0.4)";
  // Where this seat sits relative to the deck, so cards fly in from the deck.
  const flyStyle = deckFly(pos);
  const animClass =
    anim === "deal" ? "deal-in" : anim === "flip" ? "flip-reveal" : "";

  return (
    <div
      className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1"
      style={{ left: `${pos.x}%`, top: `${pos.y}%`, ...flyStyle }}
    >
      {showDealer && player.isDealer && (
        <span
          className="font-bold uppercase tracking-widest text-amber-300 drop-shadow"
          style={{ fontSize: "calc(var(--cu, 40px) * 0.25)" }}
        >
          Dealer
        </span>
      )}
      <span
        className="rounded px-2 py-0.5 font-semibold drop-shadow"
        style={{
          fontSize: `calc(var(--cu, 40px) * ${isUser ? 0.35 : 0.3})`,
          border: `2px solid ${color}`,
          // On their turn the badge fills with their colour and glows; otherwise
          // it's a dark badge outlined in their colour.
          backgroundColor: isTurn ? color : "rgba(0,0,0,0.4)",
          color: isTurn ? "#15130c" : "#fff",
          boxShadow: isTurn ? `0 0 12px ${color}` : undefined,
        }}
      >
        {player.name}
      </span>
      <div
        className={`flex transition-opacity ${dimmed ? "opacity-40" : ""}`}
      >
        {hand.map((c, i) => {
          // Discard-selection visuals only apply while selecting.
          const locked = selecting && i === lockedIndex;
          const isSel = selecting && (selected?.has(i) ?? false);
          // Trick-play visuals only apply when it's your turn to play.
          const legal = playable && (legalPlays?.has(i) ?? false);
          const illegalPlay = playable && !legal;
          const tappable = selecting ? !locked : legal;
          // The last `swapInCount` cards just arrived — fly them in from the
          // deck, after the discards have flown out (5/sec).
          const swapInIdx = i - (hand.length - swapInCount);
          const isSwapIn = swapInCount > 0 && swapInIdx >= 0;
          const cls = isSwapIn ? "deal-in" : animClass;
          const delay = isSwapIn
            ? `${0.35 + swapInIdx * 0.2}s`
            : anim === "flip"
              ? `${i * 0.08}s`
              : undefined;
          return (
            <button
              key={i}
              type="button"
              disabled={!tappable}
              onClick={() =>
                tappable && (selecting ? onToggle?.(i) : onPlay?.(i))
              }
              className={`${cls} block p-0 transition ${
                tappable ? "cursor-pointer" : "cursor-default"
              } ${isSel ? "-translate-y-3" : ""} ${
                legal ? "hover:-translate-y-2" : ""
              } ${locked || illegalPlay ? "opacity-40" : ""}`}
              style={{ marginLeft: i === 0 ? 0 : spacing, animationDelay: delay }}
            >
              <Card card={c} size={size} highlight={isSel} color={color} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function GameTable({
  room,
  onLeave,
}: {
  room: RoomView;
  onLeave?: () => void;
}) {
  const { state, youId } = room;
  const players = state.players;
  const n = players.length;
  const dealer = players.find((p) => p.id === state.dealerId);
  const me = players.find((p) => p.id === youId);
  const iAmDealer = state.dealerId === youId;

  // Spectators skip the deal cinematic and watch the live state immediately.
  const [phase, setPhase] = useState<Phase>(() =>
    room.isSpectator ? "live" : "waiting",
  );
  const [sequence, setSequence] = useState<CardT[]>([]);
  const [revealCount, setRevealCount] = useState(0);
  const [showDealerPopup, setShowDealerPopup] = useState(false);
  const [dealtCount, setDealtCount] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(DECISION_TIMEOUT_S);
  // Comic "KNOCK IN!" / "PASS" text shown over a seat when a player decides.
  const prevDecided = useRef<Record<string, boolean>>({});
  // What to do if the active decision's countdown expires (kept fresh each render).
  const autoActionRef = useRef<() => void>(() => {});
  const [decisionFx, setDecisionFx] = useState<
    Record<string, { knockedIn: boolean; key: number }>
  >({});
  // Discard/swap selection (hand indices the user has tapped).
  const [selectedDiscards, setSelectedDiscards] = useState<Set<number>>(
    new Set(),
  );
  // The swap animation currently playing (cards out to deck, replacements back).
  const lastSwapSeq = useRef<number | null>(null);
  const [swapFx, setSwapFx] = useState<{
    playerId: string;
    out: number;
    in: number;
  } | null>(null);
  // Where the turn-spotlight sits. Holds its last position so it can fade out
  // in place (rather than vanish) when no one is on the clock.
  const [spotPos, setSpotPos] = useState<Pos | null>(null);
  // Post-decision reveal (info text + card to dealer + flip your hand).
  const [decisionRevealed, setDecisionRevealed] = useState(false);
  const [trumpLanded, setTrumpLanded] = useState(false);
  // Tracks the round state so we can detect a brand-new hand starting.
  const prevRoundState = useRef(state.roundState);
  // Cards flying back to the deck when a player passes (folds out of the hand).
  const [passFx, setPassFx] = useState<Record<string, { count: number; key: number }>>(
    {},
  );
  // Your own discarded cards flying (face-up) to the deck during a swap.
  const [outFx, setOutFx] = useState<{ cards: CardT[]; key: number } | null>(null);
  // End-of-hand money change per player (floats over their cards). Fades out
  // when the next hand starts.
  const [endDeltas, setEndDeltas] = useState<Record<string, number> | null>(null);
  const [moneyFadeOut, setMoneyFadeOut] = useState(false);
  // Seconds left before an idle player is auto-kicked from the end screen.
  const [endSeconds, setEndSeconds] = useState(END_KICK_S);
  const onLeaveRef = useRef(onLeave);
  onLeaveRef.current = onLeave;
  const revealed = sequence.slice(0, revealCount);

  // --- Seat layout (you at the bottom, others clockwise) ---
  // A spectator has no seat, so anchor the bottom on the first player instead;
  // every hand is already hidden for them, so it reads as a neutral watcher view.
  const isSpectator = room.isSpectator;
  const anchorId = isSpectator ? (players[0]?.id ?? "") : youId;
  const userIdx = players.findIndex((p) => p.id === anchorId);
  const others = [
    ...players.slice(userIdx + 1),
    ...players.slice(0, userIdx),
  ];
  const slots = OTHER_SLOTS[n] ?? OTHER_SLOTS[6];
  const posOf = (id: string): Pos =>
    id === anchorId
      ? USER_POS
      : slots[others.findIndex((p) => p.id === id)] ?? { x: 50, y: 50 };

  // Each player's tracking colour, assigned by seat order.
  const colorOf = (id: string) =>
    PLAYER_COLORS[players.findIndex((p) => p.id === id) % PLAYER_COLORS.length] ??
    "#cbd5e1";

  // Whose cards the turn-spotlight should sit on right now (live phases only).
  const activeSeatId =
    phase !== "live"
      ? null
      : state.roundState === "knock-in"
        ? state.currentKnockPlayerId
        : state.roundState === "discard-draw"
          ? state.currentDiscardPlayerId
          : state.roundState === "turns"
            ? state.currentTurnPlayerId
            : null;

  // Glide the spotlight onto the active player's cards. It keeps its last spot
  // when activeSeatId clears, so it fades out in place instead of jumping.
  useEffect(() => {
    if (activeSeatId) setSpotPos(posOf(activeSeatId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSeatId]);

  // --- Deal order: dealer's left first, going clockwise ---
  const dealerIdx = players.findIndex((p) => p.id === state.dealerId);
  const dealStart = dealerIdx >= 0 ? (dealerIdx + 1) % n : 0;
  const dealOrder = [...players.slice(dealStart), ...players.slice(0, dealStart)];
  const cardsDealtTo = (id: string) => {
    const j = dealOrder.findIndex((p) => p.id === id);
    if (j < 0) return 0;
    return Math.max(0, Math.min(CARDS_EACH, Math.ceil((dealtCount - j) / n)));
  };

  // The dealer's keep/pass decision: only once the intro is done and the server
  // is actually waiting on this (human) dealer.
  const showTrumpDecision =
    phase === "live" &&
    iAmDealer &&
    state.roundState === "trump-selection" &&
    state.currentTurnPlayerId === youId &&
    !!state.trumpCard;

  const decideTrump = (keep: boolean) =>
    socket.emit("room:keepTrump", { keep }, () => {});

  // The knock-in decision: shown to whoever's turn it is.
  const showKnockDecision =
    phase === "live" &&
    state.roundState === "knock-in" &&
    state.currentKnockPlayerId === youId;

  const decideKnock = (knock: boolean) =>
    socket.emit("room:knock", { knock }, () => {});

  // The discard/swap decision (and the dealer's follow-up trim).
  const myTurnToDiscard =
    phase === "live" &&
    state.roundState === "discard-draw" &&
    state.currentDiscardPlayerId === youId;
  const trimming = myTurnToDiscard && iAmDealer && state.dealerTrimPending;
  // The dealer's kept trump can't be selected for discard.
  const trumpIndex =
    iAmDealer && state.dealerKeptTrump
      ? (me?.hand.findIndex((c) => sameCard(c, state.trumpCard)) ?? -1)
      : -1;

  const toggleDiscard = (i: number) => {
    if (!myTurnToDiscard || i === trumpIndex) return;
    if (trimming) {
      setSelectedDiscards((prev) => (prev.has(i) ? new Set() : new Set([i])));
      return;
    }
    setSelectedDiscards((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else if (next.size < 3) next.add(i);
      return next;
    });
  };
  const acceptDiscard = () => {
    // Fly the actual cards you're discarding (face-up) to the deck, right away.
    const cards = [...selectedDiscards]
      .map((i) => me?.hand[i])
      .filter((c): c is CardT => !!c);
    if (cards.length) {
      setOutFx({ cards, key: Date.now() });
      setTimeout(() => setOutFx(null), 700);
    }
    socket.emit("room:discard", { indices: [...selectedDiscards] }, () => {});
  };

  // --- Trick-taking ---
  const inTricks =
    phase === "live" &&
    (state.roundState === "turns" || state.roundState === "trick-complete");
  const myTurnToPlay =
    phase === "live" &&
    state.roundState === "turns" &&
    state.currentTurnPlayerId === youId;
  const legalPlaySet = new Set(state.yourLegalPlays);
  const playCard = (index: number) => {
    if (!myTurnToPlay || !legalPlaySet.has(index)) return;
    socket.emit("room:playCard", { index }, () => {});
  };
  const isHost = room.hostId === youId;
  const nextHand = () => socket.emit("room:nextHand", () => {});

  // A player passed (folded): fly their cards back to the deck, then drop them.
  const flyPassCards = (pid: string, count: number) => {
    if (count <= 0) return;
    setPassFx((prev) => ({
      ...prev,
      [pid]: { count, key: Date.now() + Math.random() },
    }));
    setTimeout(() => {
      setPassFx((prev) => {
        const next = { ...prev };
        delete next[pid];
        return next;
      });
    }, 700);
  };

  // Any moment it's your turn to act — drives the pulsing gold screen-edge glow.
  const myTurn =
    showTrumpDecision || showKnockDecision || myTurnToDiscard || myTurnToPlay;

  const lowestNonTrumpIndex = () => {
    let best = -1;
    let bestRank = Infinity;
    (me?.hand ?? []).forEach((c, i) => {
      if (!c || i === trumpIndex) return;
      const r = rankValue(c.rank);
      if (r < bestRank) {
        bestRank = r;
        best = i;
      }
    });
    return best;
  };

  // The lowest-ranked card among your legal plays (the auto-play on timeout).
  const lowestLegalPlayIndex = () => {
    let best = -1;
    let bestRank = Infinity;
    for (const i of state.yourLegalPlays) {
      const c = me?.hand[i];
      if (c && rankValue(c.rank) < bestRank) {
        bestRank = rankValue(c.rank);
        best = i;
      }
    }
    return best;
  };

  // Whichever decision is currently demanding a countdown.
  const activeDecision: "trump" | "knock" | "discard" | "play" | null =
    showTrumpDecision
      ? "trump"
      : showKnockDecision
        ? "knock"
        : myTurnToDiscard
          ? "discard"
          : myTurnToPlay
            ? "play"
            : null;
  const decisionTotal =
    activeDecision === "discard"
      ? trimming
        ? TRIM_TIMEOUT_S // dealer's forced trim-to-3 step: 15s
        : DISCARD_TIMEOUT_S // swap step: a flat 30s for everyone, dealer included
      : activeDecision === "knock"
        ? KNOCK_TIMEOUT_S // knock-in / pass: a flat 15s for everyone
        : activeDecision === "play"
          ? PLAY_TIMEOUT_S // playing a card in a trick: a flat 30s
          : DECISION_TIMEOUT_S + (iAmDealer ? 5 : 0); // dealer's trump decision

  // On timeout: dealer keeps the trump, players pass, swappers keep their cards
  // (a kept-trump dealer's forced trim drops their lowest non-trump), and a
  // player on the clock to play auto-plays their lowest legal card.
  autoActionRef.current = () => {
    if (activeDecision === "trump") {
      socket.emit("room:keepTrump", { keep: true }, () => {});
    } else if (activeDecision === "knock") {
      socket.emit("room:knock", { knock: false }, () => {});
    } else if (activeDecision === "discard") {
      const indices = trimming
        ? [lowestNonTrumpIndex()].filter((i) => i >= 0)
        : [];
      socket.emit("room:discard", { indices }, () => {});
    } else if (activeDecision === "play") {
      const i = lowestLegalPlayIndex();
      if (i >= 0) socket.emit("room:playCard", { index: i }, () => {});
    }
  };

  // --- Timeline ---
  useEffect(() => {
    if (isSpectator) return; // watchers stay on the live state, no cinematic
    const t = setTimeout(() => setPhase("selecting"), WAITING_MS);
    return () => clearTimeout(t);
  }, [isSpectator]);

  useEffect(() => {
    if (phase !== "selecting") return;
    const t = setTimeout(() => setPhase("revealing"), PRE_REVEAL_MS);
    return () => clearTimeout(t);
  }, [phase]);

  useEffect(() => {
    if (phase !== "revealing") return;
    setSequence(buildRevealSequence());
    setRevealCount(0);
  }, [phase]);

  useEffect(() => {
    if (phase !== "revealing" || sequence.length === 0) return;
    if (revealCount >= sequence.length) {
      setPhase("dealerFound");
      return;
    }
    const t = setTimeout(() => setRevealCount((c) => c + 1), REVEAL_INTERVAL_MS);
    return () => clearTimeout(t);
  }, [phase, sequence, revealCount]);

  // Show the dealer notice once the dealer is announced.
  useEffect(() => {
    if (phase === "dealerFound" && iAmDealer) setShowDealerPopup(true);
  }, [phase, iAmDealer]);

  // Auto-hide it after 3s, or instantly on a tap (independent of phase so the
  // timer isn't cleared when dealing begins).
  useEffect(() => {
    if (!showDealerPopup) return;
    const hide = () => setShowDealerPopup(false);
    const t = setTimeout(hide, DEALER_POPUP_MS);
    const onTap = () => {
      clearTimeout(t);
      hide();
    };
    window.addEventListener("pointerdown", onTap);
    return () => {
      clearTimeout(t);
      window.removeEventListener("pointerdown", onTap);
    };
  }, [showDealerPopup]);

  // After the dealer is announced, start dealing.
  useEffect(() => {
    if (phase !== "dealerFound") return;
    const t = setTimeout(() => {
      setDealtCount(0);
      setPhase("dealing");
    }, DEAL_START_MS);
    return () => clearTimeout(t);
  }, [phase]);

  // Deal one card every 200ms (5/sec) until everyone has 3.
  useEffect(() => {
    if (phase !== "dealing") return;
    if (dealtCount >= n * CARDS_EACH) {
      const t = setTimeout(() => setPhase("trump"), TRUMP_PAUSE_MS);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setDealtCount((c) => c + 1), DEAL_INTERVAL_MS);
    return () => clearTimeout(t);
  }, [phase, dealtCount, n]);

  // After the trump flip, hand off to the live game state.
  useEffect(() => {
    if (phase !== "trump") return;
    const t = setTimeout(() => setPhase("live"), 1300);
    return () => clearTimeout(t);
  }, [phase]);

  // A new hand has started (the previous one ended and the table is dealing
  // again): replay the deal animation so the cards visibly go back out. The
  // dealer is already known here, so we skip straight to dealing.
  useEffect(() => {
    const prev = prevRoundState.current;
    prevRoundState.current = state.roundState;
    if (prev === "end" && state.roundState !== "end" && state.roundState !== "idle") {
      setDecisionRevealed(false);
      setTrumpLanded(false);
      setPassFx({});
      setDealtCount(0);
      setPhase("dealing");
      // Fade the end-of-hand money floats out as the new hand begins.
      setMoneyFadeOut(true);
      setTimeout(() => setEndDeltas(null), 700);
    }
  }, [state.roundState]);

  // At the end of a hand, compute each player's money change to float over their
  // cards: trick winnings (+pot/3 per trick), a set penalty (−), or the whole
  // pot for an instant special-hand win.
  useEffect(() => {
    if (phase !== "live" || state.roundState !== "end") return;
    const share = state.potValue / 3;
    // No tricks played and no special hand means everyone passed and the dealer
    // took the pot automatically.
    const totalTricks = players.reduce((sum, p) => sum + p.tricksWon, 0);
    const autoWin = !state.specialHandWinner && totalTricks === 0;
    const d: Record<string, number> = {};
    for (const p of players) {
      const delta =
        state.specialHandWinner === p.id || (autoWin && p.id === state.dealerId)
          ? state.potValue
          : p.tricksWon * share - (p.wentSet ? p.setAmount : 0);
      if (delta !== 0) d[p.id] = delta;
    }
    setEndDeltas(d);
    setMoneyFadeOut(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, state.roundState]);

  // End-screen idle timeout: count down and kick the player if they don't act.
  // Cancels automatically when the next hand starts (roundState leaves "end").
  useEffect(() => {
    // Spectators aren't on the clock, so they're never auto-kicked.
    if (phase !== "live" || state.roundState !== "end" || isSpectator) return;
    setEndSeconds(END_KICK_S);
    const start = Date.now();
    const id = setInterval(() => {
      const left = Math.max(0, END_KICK_S - Math.floor((Date.now() - start) / 1000));
      setEndSeconds(left);
      if (left <= 0) {
        clearInterval(id);
        onLeaveRef.current?.();
      }
    }, 250);
    return () => clearInterval(id);
  }, [phase, state.roundState, isSpectator]);

  // Decision countdown: tick the number, then auto-act at zero.
  useEffect(() => {
    if (!activeDecision) return;
    setSecondsLeft(decisionTotal);
    const start = Date.now();
    const tick = setInterval(() => {
      setSecondsLeft(
        Math.max(0, Math.ceil(decisionTotal - (Date.now() - start) / 1000)),
      );
    }, 200);
    const timeout = setTimeout(
      () => autoActionRef.current(),
      decisionTotal * 1000,
    );
    return () => {
      clearInterval(tick);
      clearTimeout(timeout);
    };
  }, [activeDecision, decisionTotal]);

  // Clear the discard selection when the turn or trim step changes.
  useEffect(() => {
    setSelectedDiscards(new Set());
  }, [state.currentDiscardPlayerId, state.dealerTrimPending]);

  // Pop the comic decision text when another player newly knocks in / passes.
  // It stays until everyone has chosen (see the clear-on-complete effect).
  useEffect(() => {
    const newly: Record<string, { knockedIn: boolean; key: number }> = {};
    for (const p of players) {
      const was = prevDecided.current[p.id] ?? false;
      const newlyDecided =
        phase === "live" &&
        state.roundState === "knock-in" &&
        !was &&
        p.hasKnockDecision;
      if (newlyDecided && p.id !== youId) {
        newly[p.id] = { knockedIn: p.knockedIn, key: Date.now() + Math.random() };
      }
      // Anyone who passes (you included) sends their cards back to the deck.
      if (newlyDecided && !p.knockedIn) flyPassCards(p.id, p.handCount);
      prevDecided.current[p.id] = p.hasKnockDecision;
    }
    if (Object.keys(newly).length) {
      setDecisionFx((prev) => ({ ...prev, ...newly }));
    }
  }, [players, youId, phase, state.roundState]);

  // Catch up on knock decisions made during the deal cinematic. Bots that go
  // before us decide server-side while we're still watching cards deal, so the
  // per-render detector above never sees their transition (it only pops while
  // live). When we finally reach the live knock-in, reveal those already-made
  // decisions one at a time, in knock order, so we see what happened before us.
  const knockCatchupDone = useRef(false);
  useEffect(() => {
    if (phase !== "live" || state.roundState !== "knock-in") return;
    if (knockCatchupDone.current) return;
    knockCatchupDone.current = true;
    const dealerIdx = players.findIndex((p) => p.id === state.dealerId);
    const order =
      dealerIdx < 0
        ? players
        : Array.from(
            { length: players.length },
            (_, i) => players[(dealerIdx + 1 + i) % players.length],
          ); // dealer's left first, dealer last
    const already = order.filter((p) => p.id !== youId && p.hasKnockDecision);
    const timers = already.map((p, i) =>
      setTimeout(() => {
        setDecisionFx((prev) =>
          prev[p.id]
            ? prev
            : {
                ...prev,
                [p.id]: { knockedIn: p.knockedIn, key: Date.now() + Math.random() },
              },
        );
        if (!p.knockedIn) flyPassCards(p.id, p.handCount);
      }, i * 500),
    );
    return () => timers.forEach(clearTimeout);
    // Intentionally keyed only on the live/knock-in transition; the player
    // snapshot is read from the closure at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, state.roundState]);

  // Once knock-in is over (everyone has chosen), clear the decision text and
  // re-arm the catch-up for the next hand.
  useEffect(() => {
    if (state.roundState !== "knock-in") {
      setDecisionFx({});
      knockCatchupDone.current = false;
    }
  }, [state.roundState]);

  // Baseline on entering live, so swaps from the intro cinematic don't replay.
  useEffect(() => {
    if (phase === "live" && lastSwapSeq.current === null) {
      lastSwapSeq.current = state.lastDiscard?.seq ?? 0;
    }
  }, [phase, state.lastDiscard]);

  // Animate a swap when a player discards/draws (cards out to deck, then back).
  useEffect(() => {
    const ld = state.lastDiscard;
    if (!ld || lastSwapSeq.current === null) return;
    if (ld.seq <= lastSwapSeq.current) return;
    lastSwapSeq.current = ld.seq;
    if (phase !== "live" || (ld.out === 0 && ld.in === 0)) return;
    setSwapFx({ playerId: ld.playerId, out: ld.out, in: ld.in });
    const t = setTimeout(() => setSwapFx(null), 1200);
    return () => clearTimeout(t);
  }, [state.lastDiscard, phase]);

  // Detect that the dealer has decided (in live mode).
  useEffect(() => {
    if (phase === "live" && state.roundState !== "trump-selection") {
      setDecisionRevealed(true);
    }
  }, [phase, state.roundState]);

  // Once the dealer keeps the trump, land the flying card after a beat.
  useEffect(() => {
    if (!decisionRevealed || !state.dealerKeptTrump) return;
    const land = setTimeout(() => setTrumpLanded(true), 800);
    return () => clearTimeout(land);
  }, [decisionRevealed, state.dealerKeptTrump]);

  const statusText =
    phase === "waiting"
      ? "Waiting for all players..."
      : phase === "selecting" || phase === "revealing"
        ? "Selecting Dealer..."
        : phase === "dealerFound"
          ? `${dealer?.name ?? "Someone"} is the dealer`
          : "";

  // The "kept/denied the trump" note only belongs to the knock-in / discard
  // phases; once tricks start it's stale, so drop it.
  const liveInfo =
    phase === "live" &&
    decisionRevealed &&
    (state.roundState === "knock-in" || state.roundState === "discard-draw")
      ? `${dealer?.name ?? "Dealer"} ${
          state.dealerKeptTrump ? "kept" : "denied"
        } the trump`
      : "";
  const displayText = statusText || liveInfo;

  // Cards are out (and the dealer is known) from "dealing" on.
  const dealtPhase =
    phase === "dealing" || phase === "trump" || phase === "live";
  // Seats (player names) show from the very start; cards and the DEALER label
  // only appear once dealing begins, so the dealer reveal isn't spoiled.
  const showSeats = true;
  const showSelection =
    phase === "selecting" || phase === "revealing" || phase === "dealerFound";

  return (
    // .game-table defines --cu (the card unit) in index.css, including a
    // portrait-screen boost; everything on the table sizes off that one knob.
    <div className="game-table relative min-h-[100dvh] w-full">
      {/* Pulsing gold glow around the screen edge while it's your turn to act. */}
      {myTurn && (
        <div className="turn-glow pointer-events-none fixed inset-0 z-40" />
      )}

      {/* Current pot — pot of gold in the top-left, value below it in gold. */}
      {state.potValue > 0 && (
        <div className="pointer-events-none absolute left-3 top-3 z-30 flex flex-col items-center">
          <img
            src="/pot-of-gold.png"
            alt="Pot"
            className="drop-shadow-[0_4px_6px_rgba(0,0,0,0.5)]"
            style={{ width: "clamp(136px, 18vw, 264px)" }}
          />
          <span
            className="-mt-2 font-black drop-shadow-[0_2px_3px_rgba(0,0,0,0.85)]"
            style={{ color: "#FFD700", fontSize: "clamp(36px, 5.2vw, 72px)" }}
          >
            {money(state.potValue)}
          </span>
        </div>
      )}

      {/* Spectator banner — watchers can leave at any time. A sitting-out
          gamble player gets a distinct message: they auto-rejoin when they can
          afford the pot again. */}
      {isSpectator && (
        <div className="fixed left-1/2 top-3 z-40 flex -translate-x-1/2 items-center gap-3 rounded-full bg-black/55 px-4 py-1.5">
          <span className="text-sm font-bold uppercase tracking-wide text-amber-300">
            {room.isSittingOut ? "Sitting out — can't cover the pot" : "Spectating"}
          </span>
          <button
            onClick={() => onLeave?.()}
            className="rounded bg-slate-700 px-3 py-1 text-xs font-semibold hover:bg-slate-600"
          >
            Leave
          </button>
        </div>
      )}

      {/* Turn spotlight: a soft glow that glides onto the active player's cards
          so everyone can follow whose turn it is. It sits behind the cards and
          transitions its position when the turn moves on. */}
      {spotPos && (
        <div
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 transition-all duration-700 ease-in-out"
          style={{
            left: `${spotPos.x}%`,
            top: `calc(${spotPos.y}% + var(--cu) * 0.55)`,
            width: "calc(var(--cu) * 8)",
            height: "calc(var(--cu) * 5.4)",
            background:
              "radial-gradient(ellipse closest-side at center, rgba(255,244,205,0.80) 0%, rgba(255,238,180,0.50) 32%, rgba(255,237,175,0.22) 58%, rgba(255,237,175,0.06) 80%, rgba(255,237,175,0) 100%)",
            opacity: activeSeatId ? 1 : 0,
          }}
        />
      )}

      {/* "Trump" + trump suit symbol, to the right of your hand. Shown only once
          the trump card has actually flipped (the suit is known server-side from
          the start, but stays hidden until the on-screen reveal). Red suits are
          drawn red, black suits dark — like the cards. */}
      {(phase === "trump" || phase === "live") && state.trumpSuit && (
        <div
          className="pointer-events-none absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center leading-none"
          style={{
            left: `calc(${USER_POS.x}% + var(--cu) * 4.6)`,
            top: `calc(${USER_POS.y}% + var(--cu) * 0.4)`,
          }}
        >
          <span
            className="font-bold uppercase tracking-[0.3em] text-white/90 drop-shadow"
            style={{ fontSize: "calc(var(--cu, 40px) * 0.3)" }}
          >
            Trump
          </span>
          <span
            className={`leading-none drop-shadow-[0_2px_4px_rgba(0,0,0,0.6)] ${
              state.trumpSuit === "hearts" || state.trumpSuit === "diamonds"
                ? "text-red-500"
                : "text-slate-900"
            }`}
            style={{ fontSize: "calc(var(--cu, 40px) * 1.7)" }}
          >
            {SUIT_SYMBOL[state.trumpSuit]}
          </span>
        </div>
      )}

      {/* Status / info text, just above the deck (above the cards) */}
      {displayText && (
        <p
          className="absolute left-1/2 z-20 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap text-center text-2xl font-semibold text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.85)] sm:text-3xl"
          style={{ top: `calc(${CENTER.y}% - var(--cu) - 40px)` }}
        >
          {displayText}
        </p>
      )}

      {/* The deck (hidden once trick-taking starts — the trick takes the center) */}
      {phase !== "waiting" && !inTricks && state.roundState !== "end" && (
        <div
          className="absolute -translate-x-1/2 -translate-y-1/2"
          style={{ left: deckLeft, top: `${CENTER.y}%` }}
        >
          <Deck />
        </div>
      )}

      {/* Dealer-selection: revealed cards stacked on top of each other (a small
          offset shows the pile growing, so it never runs off the screen). */}
      {showSelection && revealed.length > 0 && (
        <div
          className="absolute -translate-y-1/2"
          style={{ left: `calc(${CENTER.x}% - ${HALF_GAP} + var(--cu, 40px))`, top: `${CENTER.y}%` }}
        >
          <div
            className="relative"
            style={{ width: "calc(var(--cu, 40px) * 1.4)", height: "calc(var(--cu, 40px) * 2)" }}
          >
            {revealed.map((c, i) => (
              <div
                key={i}
                className="reveal-pop absolute"
                style={{ left: i * 1.5, top: i * -1.5, zIndex: i }}
              >
                <Card card={c} size="sm" highlight={c.rank === "A"} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Seats with hands (face-down, or face-up for you once revealed) */}
      {showSeats &&
        players.map((p) => {
          const isUserSeat = p.id === youId;
          const keptFlying =
            state.dealerKeptTrump && decisionRevealed && !trumpLanded;
          let hand: CardSlot[];
          let anim: "deal" | "flip" | "none" = "none";

          if (!dealtPhase) {
            // Before the deal: show the name only, no cards yet.
            hand = [];
          } else if (phase === "dealing") {
            const dealt = cardsDealtTo(p.id);
            // Your own cards are dealt face-up — unless you're the blind dealer.
            hand =
              isUserSeat && !iAmDealer
                ? (me?.hand ?? []).slice(0, dealt)
                : Array(dealt).fill(null);
            anim = "deal";
          } else if (isUserSeat && iAmDealer) {
            // You're the dealer: stay blind to your dealt cards. Only a kept
            // trump shows (face-up) once it lands; your hand becomes visible at
            // your discard turn (the server reveals it then).
            if (decisionRevealed && !keptFlying) {
              hand = me?.hand ?? [];
            } else {
              hand = Array(
                Math.max(0, (me?.handCount ?? 0) - (keptFlying ? 1 : 0)),
              ).fill(null);
            }
          } else if (isUserSeat) {
            // Non-dealer: your hand is face-up the whole time.
            hand = me?.hand ?? [];
          } else {
            // Other seats: face-down by count; a kept-trump dealer shows one
            // fewer until the flying trump card lands.
            let count = p.handCount;
            if (p.isDealer && keptFlying) count = Math.max(0, count - 1);
            hand = Array(count).fill(null);
          }

          // A player who passed has sent their cards back to the deck, so they
          // hold none for the rest of the hand (the fly-out plays separately).
          if (phase === "live" && p.hasKnockDecision && !p.knockedIn) hand = [];

          return (
            <Seat
              key={p.id}
              player={p}
              pos={posOf(p.id)}
              isUser={isUserSeat}
              hand={hand}
              anim={anim}
              // Only fade passed players once the deal cinematic is over —
              // otherwise stale/ahead-of-cinematic knock flags fade cards mid-deal.
              dimmed={phase === "live" && p.hasKnockDecision && !p.knockedIn}
              selecting={isUserSeat && myTurnToDiscard}
              selected={selectedDiscards}
              lockedIndex={isUserSeat ? trumpIndex : -1}
              onToggle={toggleDiscard}
              swapInCount={swapFx?.playerId === p.id ? swapFx.in : 0}
              isTurn={inTricks && state.currentTurnPlayerId === p.id}
              playable={isUserSeat && myTurnToPlay}
              legalPlays={isUserSeat ? legalPlaySet : undefined}
              onPlay={playCard}
              color={colorOf(p.id)}
              showDealer={dealtPhase}
            />
          );
        })}

      {/* In-play HUD per player, from the start of trick-taking until the next
          hand deals: their money above them, and a gold star below their cards
          for every trick they've won. */}
      {phase === "live" &&
        (state.roundState === "turns" ||
          state.roundState === "trick-complete" ||
          state.roundState === "end") &&
        players.map((p) => {
          const pos = posOf(p.id);
          const isUserSeat = p.id === youId;
          return (
            <Fragment key={`hud-${p.id}`}>
              {/* Money — above the player (sits above the "DEALER" label). */}
              <div
                className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-1/2"
                style={{
                  left: `${pos.x}%`,
                  top: `calc(${pos.y}% - var(--cu) * ${isUserSeat ? 1.85 : 1.45})`,
                }}
              >
                <span
                  className="block font-black text-white drop-shadow-[0_2px_3px_rgba(0,0,0,0.85)]"
                  style={{ fontSize: "calc(var(--cu, 40px) * 0.34)" }}
                >
                  {money(p.money)}
                </span>
              </div>

              {/* Gold stars — one per trick won, below the cards. Hidden on the
                  end screen, where the payout float owns that spot. */}
              {p.tricksWon > 0 && state.roundState !== "end" && (
                <div
                  className="pointer-events-none absolute z-20 flex -translate-x-1/2 -translate-y-1/2 gap-px"
                  style={{
                    left: `${pos.x}%`,
                    top: `calc(${pos.y}% + var(--cu) * ${isUserSeat ? 1.6 : 1.2})`,
                  }}
                >
                  {Array.from({ length: p.tricksWon }).map((_, i) => (
                    <span
                      key={i}
                      className="star-pop block text-amber-400 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]"
                      style={{ fontSize: "calc(var(--cu, 40px) * 0.45)" }}
                    >
                      ★
                    </span>
                  ))}
                </div>
              )}
            </Fragment>
          );
        })}

      {/* Cards played into the current trick, drawn between each seat and the
          center; each slides in from its player's seat as it's played, and the
          winner's card is highlighted during the trick-complete pause. */}
      {inTricks &&
        state.currentTrick.map(({ playerId, card }) => {
          const seat = posOf(playerId);
          const f = 0.62; // fraction of the way from the seat to the center
          const x = seat.x + (CENTER.x - seat.x) * f;
          const y = seat.y + (CENTER.y - seat.y) * f;
          const won =
            state.roundState === "trick-complete" &&
            state.trickWinnerId === playerId;
          return (
            <div
              key={playerId}
              className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${x}%`, top: `${y}%` }}
            >
              <div
                className="play-card"
                style={
                  { "--px": `${seat.x - x}vw`, "--py": `${seat.y - y}vh` } as CSSProperties
                }
              >
                <Card card={card} highlight={won} color={colorOf(playerId)} />
              </div>
            </div>
          );
        })}

      {/* Your own discard flies face-up to the deck (the actual cards). */}
      {outFx && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-1/2"
          style={{
            left: `${USER_POS.x}%`,
            top: `${USER_POS.y}%`,
            ...deckFly(USER_POS),
          }}
        >
          {outFx.cards.map((c, i) => (
            <div
              key={i}
              className="fly-to-deck absolute -translate-x-1/2 -translate-y-1/2"
              style={{ left: i * 10 }}
            >
              <Card card={c} size="md" />
            </div>
          ))}
        </div>
      )}

      {/* Swap: opponents' discarded cards fly (face-down) from the seat to the
          deck. Your own swap is handled face-up by outFx above. */}
      {swapFx &&
        swapFx.out > 0 &&
        swapFx.playerId !== youId &&
        (() => {
          const pos = posOf(swapFx.playerId);
          const big = swapFx.playerId === youId;
          const flyStyle = deckFly(pos);
          return (
            <div
              className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${pos.x}%`, top: `${pos.y}%`, ...flyStyle }}
            >
              {Array.from({ length: swapFx.out }).map((_, i) => (
                <div
                  key={i}
                  className="fly-to-deck absolute -translate-x-1/2 -translate-y-1/2"
                  style={{ left: i * 6 }}
                >
                  <Card card={null} size={big ? "md" : "sm"} />
                </div>
              ))}
            </div>
          );
        })()}

      {/* Pass: a folded player's whole hand flies back to the deck */}
      {Object.entries(passFx).map(([pid, fx]) => {
        const pos = posOf(pid);
        const big = pid === youId;
        return (
          <div
            key={fx.key}
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${pos.x}%`, top: `${pos.y}%`, ...deckFly(pos) }}
          >
            {Array.from({ length: fx.count }).map((_, i) => (
              <div
                key={i}
                className="fly-to-deck absolute -translate-x-1/2 -translate-y-1/2"
                style={{ left: i * 6 }}
              >
                <Card card={null} size={big ? "md" : "sm"} />
              </div>
            ))}
          </div>
        );
      })}

      {/* Trump card on the table (before the decision, or after a pass).
          Cleared once trick-taking starts so it doesn't clutter the trick. */}
      {(phase === "trump" || phase === "live") &&
        !inTricks &&
        state.roundState !== "end" &&
        state.trumpCard &&
        !(decisionRevealed && state.dealerKeptTrump) && (
          <div
            className="trump-flip absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: trumpLeft, top: `${CENTER.y}%` }}
          >
            <Card card={state.trumpCard} highlight />
          </div>
        )}

      {/* Trump card flying into the dealer's hand (kept) */}
      {phase === "live" &&
        decisionRevealed &&
        state.dealerKeptTrump &&
        !trumpLanded &&
        state.trumpCard && (
          <div
            className="fly-to-dealer absolute -translate-x-1/2 -translate-y-1/2"
            style={
              {
                left: trumpLeft,
                top: `${CENTER.y}%`,
                "--tx": `calc(${posOf(state.dealerId ?? "").x - CENTER.x}vw - ${HALF_GAP})`,
                "--ty": `${posOf(state.dealerId ?? "").y - CENTER.y}vh`,
              } as CSSProperties
            }
          >
            <Card card={state.trumpCard} highlight />
          </div>
        )}

      {/* Dealer's keep/pass decision — big glowing trump card, centered */}
      {showTrumpDecision && (
        <div className="fixed inset-0 z-30 flex flex-col items-center justify-center gap-6 bg-black/35">
          <CountdownRing seconds={secondsLeft} total={decisionTotal} />
          <p className="text-2xl font-semibold text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.85)] sm:text-3xl">
            Keep the trump card?
          </p>
          <div className="trump-glow pop-in">
            <Card card={state.trumpCard} size="lg" />
          </div>
          <div className="flex gap-4">
            <button
              onClick={() => decideTrump(true)}
              className="rounded-lg bg-gradient-to-b from-amber-300 to-amber-600 px-8 py-3 text-lg font-bold text-red-950 shadow-lg hover:from-amber-200 hover:to-amber-500"
            >
              Keep
            </button>
            <button
              onClick={() => decideTrump(false)}
              className="rounded-lg border border-amber-400/40 bg-red-950/80 px-8 py-3 text-lg font-bold text-amber-100 shadow-lg hover:bg-red-900/80"
            >
              Pass
            </button>
          </div>
        </div>
      )}

      {/* Your knock-in decision */}
      {showKnockDecision && (
        <div className="fixed inset-0 z-30 flex flex-col items-center justify-center gap-7 bg-black/35">
          <CountdownRing seconds={secondsLeft} total={decisionTotal} />
          <p className="text-2xl font-semibold text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.85)] sm:text-3xl">
            Knock in or pass?
          </p>
          <div className="flex gap-4">
            <button
              onClick={() => decideKnock(true)}
              className="rounded-lg bg-gradient-to-b from-orange-400 to-orange-600 px-8 py-3 text-lg font-bold text-white shadow-lg hover:from-orange-300 hover:to-orange-500"
            >
              Knock in
            </button>
            <button
              onClick={() => decideKnock(false)}
              className="rounded-lg bg-gradient-to-b from-cyan-300 to-cyan-500 px-8 py-3 text-lg font-bold text-slate-900 shadow-lg hover:from-cyan-200 hover:to-cyan-400"
            >
              Pass
            </button>
          </div>
        </div>
      )}

      {/* Discard / swap controls (your hand stays tappable below) */}
      {myTurnToDiscard && (
        <div className="absolute left-1/2 top-[60%] z-20 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-3">
          <CountdownRing seconds={secondsLeft} total={decisionTotal} />
          <p className="rounded bg-black/40 px-3 py-1 text-center text-sm font-semibold text-white drop-shadow sm:text-base">
            {trimming
              ? "You kept the trump — discard 1 card"
              : "Select up to 3 cards to swap"}
          </p>
          <button
            onClick={acceptDiscard}
            disabled={trimming && selectedDiscards.size !== 1}
            className="rounded-lg bg-gradient-to-b from-amber-300 to-amber-600 px-8 py-2.5 text-base font-bold text-red-950 shadow-lg hover:from-amber-200 hover:to-amber-500 disabled:opacity-50"
          >
            {trimming
              ? "Discard"
              : selectedDiscards.size === 0
                ? "Keep all"
                : `Swap ${selectedDiscards.size}`}
          </button>
        </div>
      )}

      {/* Comic decision text over other players' seats */}
      {Object.entries(decisionFx).map(([pid, fx]) => {
        const pos = posOf(pid);
        return (
          <div
            key={fx.key}
            className="comic-pop pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-1/2"
            // Sit over where the player's cards are (below the name), not on it.
            style={{ left: `${pos.x}%`, top: `calc(${pos.y}% + var(--cu) * 0.7)` }}
          >
            <span
              className={`comic-text text-[1.3125rem] sm:text-[1.575rem] ${
                fx.knockedIn ? "text-orange-500" : "text-cyan-300"
              }`}
            >
              {fx.knockedIn ? "Knock in!" : "Pass"}
            </span>
          </div>
        );
      })}

      {/* Dealer notice (only the dealer sees this) */}
      {showDealerPopup && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40">
          <div className="pop-in rounded-2xl border-4 border-amber-400 bg-red-950/95 px-12 py-9 text-center shadow-2xl">
            <p className="text-sm uppercase tracking-widest text-amber-300/80">
              You are the
            </p>
            <p className="mt-1 text-4xl font-black text-amber-300">DEALER</p>
            <p className="mt-3 text-xs text-amber-100/60">(tap to dismiss)</p>
          </div>
        </div>
      )}

      {/* Your-turn prompt + countdown during trick-taking */}
      {myTurnToPlay && (
        <div className="absolute left-1/2 top-[62%] z-20 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-2">
          <CountdownRing seconds={secondsLeft} total={PLAY_TIMEOUT_S} />
          <p className="animate-pulse whitespace-nowrap rounded bg-black/45 px-3 py-1 text-center text-sm font-semibold text-white drop-shadow sm:text-base">
            Your turn — play a card
          </p>
        </div>
      )}

      {/* End-of-hand summary */}
      {/* End-of-hand money change floating over each player's cards */}
      {endDeltas &&
        Object.entries(endDeltas).map(([pid, delta]) => {
          const pos = posOf(pid);
          const gain = delta > 0;
          return (
            <div
              key={pid}
              className="pointer-events-none absolute z-30 -translate-x-1/2 -translate-y-1/2"
              style={{
                left: `${pos.x}%`,
                // Anchor low over the card area so the value never rises onto the
                // name; the user's own (bigger) cards sit lower, so nudge further.
                top: `calc(${pos.y}% + var(--cu) * ${pid === youId ? 1.5 : 1.15})`,
                opacity: moneyFadeOut ? 0 : 1,
                transition: "opacity 0.6s ease-out",
              }}
            >
              <span
                className={`money-float block whitespace-nowrap font-black drop-shadow-[0_2px_3px_rgba(0,0,0,0.8)] ${
                  gain ? "text-green-400" : "text-red-500"
                }`}
                style={{ fontSize: "calc(var(--cu, 40px) * 0.55)" }}
              >
                {gain ? "+" : "−"}
                {money(Math.abs(delta))}
              </span>
            </div>
          );
        })}

      {/* End-of-hand: just Leave / Next, centered */}
      {phase === "live" && state.roundState === "end" && (
        <div className="absolute left-1/2 top-[46%] z-40 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-4">
          <button
            onClick={() => onLeave?.()}
            className="rounded-xl border border-amber-400/40 bg-red-950/85 px-14 py-5 text-3xl font-bold text-amber-100 shadow-lg hover:bg-red-900/85"
          >
            Leave
          </button>
          <button
            onClick={nextHand}
            disabled={!isHost}
            className="rounded-xl bg-gradient-to-b from-amber-300 to-amber-600 px-14 py-5 text-3xl font-bold text-red-950 shadow-lg hover:from-amber-200 hover:to-amber-500 disabled:opacity-60"
          >
            {isHost ? "Play Again?" : "Waiting…"}
          </button>
          {!isSpectator && (
            <p className="mt-1 text-sm font-semibold text-amber-100/70 drop-shadow">
              Leaving in {endSeconds}s
            </p>
          )}
        </div>
      )}
    </div>
  );
}
