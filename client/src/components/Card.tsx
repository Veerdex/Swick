import type { CardSlot, Suit } from "../types";

const SUIT_SYMBOL: Record<Suit, string> = {
  spades: "♠",
  hearts: "♥",
  diamonds: "♦",
  clubs: "♣",
};

const isRed = (suit: Suit) => suit === "hearts" || suit === "diamonds";

interface CardProps {
  /** The card to show, or null for a face-down back. */
  card: CardSlot;
  /** Visually mark this card (e.g. the kept trump). */
  highlight?: boolean;
  size?: "sm" | "md";
}

/** A single playing card, or a face-down back when card is null. */
export default function Card({ card, highlight, size = "md" }: CardProps) {
  const dims = size === "sm" ? "h-14 w-10 text-sm" : "h-20 w-14 text-base";

  if (!card) {
    return (
      <div
        className={`${dims} flex items-center justify-center rounded-md border border-slate-600 bg-gradient-to-br from-indigo-800 to-slate-800`}
        aria-label="face-down card"
      >
        <span className="text-indigo-300/60">★</span>
      </div>
    );
  }

  const red = isRed(card.suit);
  return (
    <div
      className={`${dims} flex flex-col items-center justify-center rounded-md border bg-white font-semibold shadow ${
        highlight ? "border-amber-400 ring-2 ring-amber-400" : "border-slate-300"
      } ${red ? "text-red-600" : "text-slate-900"}`}
      aria-label={`${card.rank} of ${card.suit}`}
    >
      <span>{card.rank}</span>
      <span className="text-lg leading-none">{SUIT_SYMBOL[card.suit]}</span>
    </div>
  );
}
