import type { CSSProperties } from "react";

const LETTERS = ["S", "W", "I", "C", "K"];
// Alternate red/black like a real deck (W and C are red).
const RED = new Set([1, 3]);

// Drop timing (intro variant).
const FIRST_CARD_DELAY = 1.3;
const CARD_STAGGER = 0.22;
// Per-card phase offset for the floating ripple (lobby variant).
const FLOAT_STAGGER = 0.2;

/** The white playing-card face with the gold pin and the letter. */
function CardFace({
  letter,
  red,
  animClass = "",
  style,
}: {
  letter: string;
  red: boolean;
  animClass?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      className={`relative flex h-24 w-16 items-center justify-center rounded-xl bg-white text-5xl font-black shadow-2xl ring-1 ring-amber-300/50 sm:h-28 sm:w-20 ${animClass}`}
      style={style}
    >
      <span className="absolute -top-1.5 h-3 w-3 rounded-full bg-amber-300 shadow" />
      <span className={red ? "text-red-600" : "text-slate-900"}>{letter}</span>
    </div>
  );
}

/**
 * The SWICK title spelled in cards.
 *   - "drop": each card falls from the top on a string, swings, and settles (intro).
 *   - "float": cards are already in place, gently bobbing on a sine wave with a
 *     per-card phase offset so the motion ripples across (lobby).
 */
export default function SwickCards({ variant }: { variant: "drop" | "float" }) {
  return (
    <div className="flex gap-3 sm:gap-4">
      {LETTERS.map((ch, i) => {
        const red = RED.has(i);

        if (variant === "drop") {
          const delay = `${FIRST_CARD_DELAY + i * CARD_STAGGER}s`;
          return (
            <div
              key={ch}
              className="intro-letter flex flex-col items-center"
              style={{ animationDelay: delay }}
            >
              <div className="h-10 w-px bg-gradient-to-b from-transparent to-amber-200/70" />
              <CardFace
                letter={ch}
                red={red}
                animClass="intro-card"
                style={{ animationDelay: delay }}
              />
            </div>
          );
        }

        // Negative delay starts each card already mid-cycle -> instant ripple.
        return (
          <div
            key={ch}
            className="float-sine"
            style={{ animationDelay: `${-i * FLOAT_STAGGER}s` }}
          >
            <CardFace letter={ch} red={red} />
          </div>
        );
      })}
    </div>
  );
}
