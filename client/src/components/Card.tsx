import type { CSSProperties } from "react";
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
  /** Visually emphasise this card (selected, trick winner, the kept trump). */
  highlight?: boolean;
  size?: Size;
  /** The owning player's colour — drawn as the card's border (for tracking). */
  color?: string;
}

/** A single playing card, or a face-down back when card is null. */
export default function Card({ card, highlight, size = "md", color }: CardProps) {
  const s = SIZES[size];
  const boxStyle: CSSProperties = {
    width: cu(s.w),
    height: cu(s.h),
    borderRadius: cu(s.round),
    fontSize: cu(s.rank),
  };
  // When the owner's colour is given it drives the border; a highlight makes it
  // thicker and adds a matching glow. Otherwise fall back to the neutral look.
  if (color) {
    boxStyle.borderColor = color;
    boxStyle.borderWidth = highlight ? "3px" : "2px";
    if (highlight) boxStyle.boxShadow = `0 0 0 2px ${color}, 0 0 14px ${color}`;
  }

  if (!card) {
    return (
      <div
        className={`flex items-center justify-center border bg-gradient-to-br from-indigo-800 to-slate-800 ${
          color ? "" : "border-slate-600"
        }`}
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
        color
          ? ""
          : highlight
            ? "border-amber-400 ring-2 ring-amber-400"
            : "border-slate-300"
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
