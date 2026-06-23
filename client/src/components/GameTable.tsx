import { useEffect, useRef, useState, type CSSProperties } from "react";
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

// You're always at the bottom (with larger cards). The deck sits just left of
// center; the trump flips to its right.
const USER_POS: Pos = { x: 50, y: 80 };
const DECK_POS: Pos = { x: 44, y: 46 };
const TRUMP_POS: Pos = { x: 57, y: 46 };

// Positions for the OTHER players, ordered clockwise from the user so the deal
// travels around the table. Keyed by total player count.
const OTHER_SLOTS: Record<number, Pos[]> = {
  3: [{ x: 84, y: 42 }, { x: 50, y: 15 }], // right, top
  4: [{ x: 84, y: 42 }, { x: 50, y: 15 }, { x: 16, y: 42 }], // right, top, left
  5: [
    { x: 85, y: 56 }, { x: 85, y: 30 }, { x: 50, y: 15 }, { x: 16, y: 42 },
  ], // 2 right, top, left
  6: [
    { x: 85, y: 56 }, { x: 85, y: 30 }, { x: 50, y: 15 },
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
const DECISION_TIMEOUT_S = 10; // auto-keep / auto-pass after this long
const DISCARD_TIMEOUT_S = 20; // auto-accept the swap after this long

// Countdown ring geometry.
const RING_R = 28;
const RING_CIRC = 2 * Math.PI * RING_R;

const SUITS: Suit[] = ["spades", "hearts", "diamonds", "clubs"];
const NON_ACE: Rank[] = ["7", "8", "9", "10", "J", "Q", "K"];
const RANK_ORDER: Rank[] = ["7", "8", "9", "10", "J", "Q", "K", "A"];
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
    <div className="relative h-20 w-14">
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
}: {
  player: PlayerView;
  pos: Pos;
  isUser: boolean;
  hand: CardSlot[];
  anim: "deal" | "flip" | "none";
  dimmed: boolean;
  /** When true the cards are tappable for the discard/swap selection. */
  selecting?: boolean;
  selected?: Set<number>;
  /** A card index that can't be selected (the dealer's kept trump). */
  lockedIndex?: number;
  onToggle?: (i: number) => void;
  /** The last N cards just drawn — deal them in from the deck (swap animation). */
  swapInCount?: number;
}) {
  const size = isUser ? "md" : "sm";
  // Your hand is spread out (at most 4 cards); opponents' cards overlap.
  const spacing = isUser ? 8 : -16;
  // Where this seat sits relative to the deck, so cards fly in from the deck.
  const flyStyle = {
    "--fx": `${DECK_POS.x - pos.x}vw`,
    "--fy": `${DECK_POS.y - pos.y}vh`,
  } as CSSProperties;
  const animClass =
    anim === "deal" ? "deal-in" : anim === "flip" ? "flip-reveal" : "";

  return (
    <div
      className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1"
      style={{ left: `${pos.x}%`, top: `${pos.y}%`, ...flyStyle }}
    >
      {player.isDealer && (
        <span className="text-[10px] font-bold uppercase tracking-widest text-amber-300 drop-shadow">
          Dealer
        </span>
      )}
      <span
        className={`rounded bg-black/35 px-2 py-0.5 font-semibold drop-shadow ${
          isUser ? "text-sm" : "text-xs"
        } ${player.isDealer ? "text-amber-300" : "text-white"}`}
      >
        {player.name}
      </span>
      <div
        className={`flex transition-opacity ${dimmed ? "opacity-40 grayscale" : ""}`}
      >
        {hand.map((c, i) => {
          // Selection visuals only apply to the seat that's actually selecting.
          const locked = selecting && i === lockedIndex;
          const isSel = selecting && (selected?.has(i) ?? false);
          const tappable = selecting && !locked;
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
              onClick={() => onToggle?.(i)}
              className={`${cls} block p-0 ${
                tappable ? "cursor-pointer transition" : "cursor-default"
              } ${isSel ? "-translate-y-3" : ""} ${
                locked ? "opacity-40 grayscale" : ""
              }`}
              style={{ marginLeft: i === 0 ? 0 : spacing, animationDelay: delay }}
            >
              <Card card={c} size={size} highlight={isSel} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function GameTable({ room }: { room: RoomView }) {
  const { state, youId } = room;
  const players = state.players;
  const n = players.length;
  const dealer = players.find((p) => p.id === state.dealerId);
  const me = players.find((p) => p.id === youId);
  const iAmDealer = state.dealerId === youId;

  const [phase, setPhase] = useState<Phase>("waiting");
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
  // Post-decision reveal (info text + card to dealer + flip your hand).
  const [decisionRevealed, setDecisionRevealed] = useState(false);
  const [trumpLanded, setTrumpLanded] = useState(false);
  const revealed = sequence.slice(0, revealCount);

  // --- Seat layout (you at the bottom, others clockwise) ---
  const userIdx = players.findIndex((p) => p.id === youId);
  const others = [
    ...players.slice(userIdx + 1),
    ...players.slice(0, userIdx),
  ];
  const slots = OTHER_SLOTS[n] ?? OTHER_SLOTS[6];
  const posOf = (id: string): Pos =>
    id === youId
      ? USER_POS
      : slots[others.findIndex((p) => p.id === id)] ?? { x: 50, y: 50 };

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
  const acceptDiscard = () =>
    socket.emit("room:discard", { indices: [...selectedDiscards] }, () => {});

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

  // Whichever decision is currently demanding a countdown.
  const activeDecision: "trump" | "knock" | "discard" | null = showTrumpDecision
    ? "trump"
    : showKnockDecision
      ? "knock"
      : myTurnToDiscard
        ? "discard"
        : null;
  const decisionTotal =
    (activeDecision === "discard" ? DISCARD_TIMEOUT_S : DECISION_TIMEOUT_S) +
    (iAmDealer ? 5 : 0); // the dealer gets 5 extra seconds

  // On timeout: dealer keeps the trump, players pass, swappers keep their cards
  // (a kept-trump dealer's forced trim drops their lowest non-trump).
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
    }
  };

  // --- Timeline ---
  useEffect(() => {
    const t = setTimeout(() => setPhase("selecting"), WAITING_MS);
    return () => clearTimeout(t);
  }, []);

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
      if (
        phase === "live" &&
        state.roundState === "knock-in" &&
        !was &&
        p.hasKnockDecision &&
        p.id !== youId
      ) {
        newly[p.id] = { knockedIn: p.knockedIn, key: Date.now() + Math.random() };
      }
      prevDecided.current[p.id] = p.hasKnockDecision;
    }
    if (Object.keys(newly).length) {
      setDecisionFx((prev) => ({ ...prev, ...newly }));
    }
  }, [players, youId, phase, state.roundState]);

  // Once knock-in is over (everyone has chosen), clear the decision text.
  useEffect(() => {
    if (state.roundState !== "knock-in") setDecisionFx({});
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

  const liveInfo =
    phase === "live" && decisionRevealed
      ? `${dealer?.name ?? "Dealer"} ${
          state.dealerKeptTrump ? "kept" : "denied"
        } the trump`
      : "";
  const displayText = statusText || liveInfo;

  const showSeats =
    phase === "dealing" || phase === "trump" || phase === "live";
  const showSelection = !showSeats;

  return (
    <div className="relative min-h-[100dvh] w-full">
      {/* Faint "Trump" + trump suit symbol, above the status text */}
      {phase !== "waiting" && state.trumpSuit && (
        <div className="pointer-events-none absolute left-1/2 top-[31%] flex -translate-x-1/2 -translate-y-1/2 flex-col items-center leading-none">
          <span className="text-sm font-semibold uppercase tracking-[0.3em] text-black/35">
            Trump
          </span>
          <span className="text-7xl text-black/20">
            {SUIT_SYMBOL[state.trumpSuit]}
          </span>
        </div>
      )}

      {/* Status / info text, just above the deck (above the cards) */}
      {displayText && (
        <p className="absolute left-1/2 top-[38%] z-20 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap text-center text-2xl font-semibold text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.85)] sm:text-3xl">
          {displayText}
        </p>
      )}

      {/* The deck */}
      {phase !== "waiting" && (
        <div
          className="absolute -translate-x-1/2 -translate-y-1/2"
          style={{ left: `${DECK_POS.x}%`, top: `${DECK_POS.y}%` }}
        >
          <Deck />
        </div>
      )}

      {/* Dealer-selection: revealed cards stacked on top of each other (a small
          offset shows the pile growing, so it never runs off the screen). */}
      {showSelection && revealed.length > 0 && (
        <div
          className="absolute -translate-y-1/2"
          style={{ left: `${DECK_POS.x + 10}%`, top: `${DECK_POS.y}%` }}
        >
          <div className="relative h-20 w-14">
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

          if (phase === "dealing") {
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

          return (
            <Seat
              key={p.id}
              player={p}
              pos={posOf(p.id)}
              isUser={isUserSeat}
              hand={hand}
              anim={anim}
              dimmed={p.hasKnockDecision && !p.knockedIn}
              selecting={isUserSeat && myTurnToDiscard}
              selected={selectedDiscards}
              lockedIndex={isUserSeat ? trumpIndex : -1}
              onToggle={toggleDiscard}
              swapInCount={swapFx?.playerId === p.id ? swapFx.in : 0}
            />
          );
        })}

      {/* Swap: discarded cards fly from the seat to the deck */}
      {swapFx &&
        swapFx.out > 0 &&
        (() => {
          const pos = posOf(swapFx.playerId);
          const big = swapFx.playerId === youId;
          const flyStyle = {
            "--fx": `${DECK_POS.x - pos.x}vw`,
            "--fy": `${DECK_POS.y - pos.y}vh`,
          } as CSSProperties;
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

      {/* Trump card on the table (before the decision, or after a pass) */}
      {(phase === "trump" || phase === "live") &&
        state.trumpCard &&
        !(decisionRevealed && state.dealerKeptTrump) && (
          <div
            className="trump-flip absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${TRUMP_POS.x}%`, top: `${TRUMP_POS.y}%` }}
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
                left: `${TRUMP_POS.x}%`,
                top: `${TRUMP_POS.y}%`,
                "--tx": `${posOf(state.dealerId ?? "").x - TRUMP_POS.x}vw`,
                "--ty": `${posOf(state.dealerId ?? "").y - TRUMP_POS.y}vh`,
              } as CSSProperties
            }
          >
            <Card card={state.trumpCard} highlight />
          </div>
        )}

      {/* Dealer's keep/pass decision — big glowing trump card, centered */}
      {showTrumpDecision && (
        <div className="fixed inset-0 z-30 flex flex-col items-center justify-center gap-6 bg-black/35">
          <CountdownRing seconds={secondsLeft} />
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
          <CountdownRing seconds={secondsLeft} />
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
          <CountdownRing seconds={secondsLeft} total={DISCARD_TIMEOUT_S} />
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
            style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
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
    </div>
  );
}
