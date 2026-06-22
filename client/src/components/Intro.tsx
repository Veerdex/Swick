interface IntroProps {
  /** Called when the player clicks Play to enter the lobby. */
  onPlay: () => void;
}

const LETTERS = ["S", "W", "I", "C", "K"];
// Alternate red/black like a real deck (W and C are red).
const RED = new Set([1, 3]);

// Play button fades in first, then the letters drop in one after another.
const PLAY_DELAY = 0.4;
const FIRST_CARD_DELAY = 1.3;
const CARD_STAGGER = 0.22;

/**
 * Opening title sequence: over the casino background, the Play button transitions
 * in, then five cards drop from the top on strings, swing, and settle spelling
 * "SWICK". Clicking Play dismisses the intro and shows the lobby.
 */
export default function Intro({ onPlay }: IntroProps) {
  return (
    <div className="flex min-h-[82vh] flex-col items-center justify-center gap-14 overflow-hidden">
      <div className="flex gap-3 sm:gap-4">
        {LETTERS.map((ch, i) => {
          const delay = `${FIRST_CARD_DELAY + i * CARD_STAGGER}s`;
          return (
            <div
              key={ch}
              className="intro-letter flex flex-col items-center"
              style={{ animationDelay: delay }}
            >
              {/* The string the card hangs from */}
              <div className="h-10 w-px bg-gradient-to-b from-transparent to-amber-200/70" />
              <div
                className="intro-card relative flex h-24 w-16 items-center justify-center rounded-xl bg-white text-5xl font-black shadow-2xl ring-1 ring-amber-300/50 sm:h-28 sm:w-20"
                style={{ animationDelay: delay }}
              >
                {/* the pin where the string attaches */}
                <span className="absolute -top-1.5 h-3 w-3 rounded-full bg-amber-300 shadow" />
                <span className={RED.has(i) ? "text-red-600" : "text-slate-900"}>
                  {ch}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <button
        onClick={onPlay}
        aria-label="Play"
        className="intro-play transition-transform hover:scale-105 active:scale-95"
        style={{ animationDelay: `${PLAY_DELAY}s` }}
      >
        <img
          src="/casino-play-button.png"
          alt="Play"
          className="w-44 drop-shadow-2xl sm:w-52"
        />
      </button>
    </div>
  );
}
