import type { CardSlot, Suit } from "../types";

const SUIT_SYMBOL: Record<Suit, string> = {
  spades: "♠",
  hearts: "♥",
  diamonds: "♦",
  clubs: "♣",
};

const isRed = (suit: Suit) => suit === "hearts" || suit === "diamonds";

type Size = "sm" | "md" | "lg";

const SIZES: Record<Size, { box: string; rank: string; suit: string; round: string }> = {
  sm: { box: "h-14 w-10", rank: "text-sm", suit: "text-lg", round: "rounded-md" },
  md: { box: "h-20 w-14", rank: "text-base", suit: "text-lg", round: "rounded-md" },
  lg: { box: "h-48 w-36", rank: "text-5xl", suit: "text-7xl", round: "rounded-xl" },
};

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

  if (!card) {
    return (
      <div
        className={`${s.box} ${s.round} flex items-center justify-center border border-slate-600 bg-gradient-to-br from-indigo-800 to-slate-800`}
        aria-label="face-down card"
      >
        <span className="text-indigo-300/60">★</span>
      </div>
    );
  }

  const red = isRed(card.suit);
  return (
    <div
      className={`${s.box} ${s.round} ${s.rank} flex flex-col items-center justify-center border bg-white font-semibold shadow ${
        highlight ? "border-amber-400 ring-2 ring-amber-400" : "border-slate-300"
      } ${red ? "text-red-600" : "text-slate-900"}`}
      aria-label={`${card.rank} of ${card.suit}`}
    >
      <span>{card.rank}</span>
      <span className={`${s.suit} leading-none`}>{SUIT_SYMBOL[card.suit]}</span>
    </div>
  );
}
