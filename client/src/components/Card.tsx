import type { CardSlot, Suit } from "../types";

const SUIT_SYMBOL: Record<Suit, string> = {
  spades: "♠",
  hearts: "♥",
  diamonds: "♦",
  clubs: "♣",
};

const isRed = (suit: Suit) => suit === "hearts" || suit === "diamonds";

type Size = "sm" | "md" | "lg";

// All dimensions are multiples of --cu (the card unit, set on the table root),
// so cards scale with the screen. Proportions match the old fixed sizes:
// sm = 40×56, md = 56×80, lg = 144×192 at the base unit of 40px.
const SIZES: Record<Size, { w: number; h: number; rank: number; suit: number; round: number }> = {
  sm: { w: 1.0, h: 1.4, rank: 0.35, suit: 0.45, round: 0.15 },
  md: { w: 1.4, h: 2.0, rank: 0.4, suit: 0.45, round: 0.15 },
  lg: { w: 3.6, h: 4.8, rank: 1.2, suit: 1.8, round: 0.3 },
};

/** A length expressed as a multiple of the card unit (--cu, default 40px). */
const cu = (mult: number) => `calc(var(--cu, 40px) * ${mult})`;

interface CardProps {
  /** The card to show, or null for a face-down back. */
  card: CardSlot;
  /** Visually mark this card (e.g. the kept trump). */
  highlight?: boolean;
  size?: Size;
}

/** A single playing card, or a face-down back when card is null. */
export default function Card({ card, highlight, size = "md" }: CardProps) {
  const s = SIZES[size];
  const boxStyle = {
    width: cu(s.w),
    height: cu(s.h),
    borderRadius: cu(s.round),
    fontSize: cu(s.rank),
  };

  if (!card) {
    return (
      <div
        className="flex items-center justify-center border border-slate-600 bg-gradient-to-br from-indigo-800 to-slate-800"
        style={boxStyle}
        aria-label="face-down card"
      >
        <span className="text-indigo-300/60">★</span>
      </div>
    );
  }

  const red = isRed(card.suit);
  return (
    <div
      className={`flex flex-col items-center justify-center border bg-white font-semibold shadow ${
        highlight ? "border-amber-400 ring-2 ring-amber-400" : "border-slate-300"
      } ${red ? "text-red-600" : "text-slate-900"}`}
      style={boxStyle}
      aria-label={`${card.rank} of ${card.suit}`}
    >
      <span>{card.rank}</span>
      <span className="leading-none" style={{ fontSize: cu(s.suit) }}>
        {SUIT_SYMBOL[card.suit]}
      </span>
    </div>
  );
}
