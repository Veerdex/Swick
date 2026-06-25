import SwickCards from "./SwickCards";
import { useMenuScale } from "./ScaledMenu";

interface IntroProps {
  /** Called when the player clicks Play to enter the lobby. */
  onPlay: () => void;
}

// The Play button fades in first, then the letters drop in (SwickCards "drop").
const PLAY_DELAY = 0.4;

/**
 * Opening title sequence: over the casino background, the Play button transitions
 * in (centered), then five cards drop from the top on strings, swing, and settle
 * spelling "SWICK" near the top quarter. Clicking Play shows the lobby.
 *
 * The title and the button are positioned independently so the title can sit
 * high while the button stays centered in the viewport.
 */
export default function Intro({ onPlay }: IntroProps) {
  // Scale the title + button up on larger screens, matching the menus.
  const scale = useMenuScale();
  return (
    <div className="relative min-h-[100dvh] w-full overflow-hidden">
      {/* SWICK cards — anchored near the top quarter */}
      <div
        className="absolute left-1/2 top-[12vh]"
        style={{ transform: `translateX(-50%) scale(${scale})`, transformOrigin: "top center" }}
      >
        <SwickCards variant="drop" />
      </div>

      {/* Play button — centered in the viewport (outer div centers, inner div
          runs the fade-in so the two transforms don't collide) */}
      <div
        className="absolute left-1/2 top-1/2"
        style={{ transform: `translate(-50%, -50%) scale(${scale})` }}
      >
        <div
          className="intro-play relative flex items-center justify-center"
          style={{ animationDelay: `${PLAY_DELAY}s` }}
        >
          {/* rotating gold sunburst + soft halo behind the button */}
          <span
            aria-hidden
            className="play-glow pointer-events-none absolute h-72 w-72 rounded-full sm:h-80 sm:w-80"
          />
          <span
            aria-hidden
            className="pointer-events-none absolute h-56 w-56 rounded-full bg-amber-300/15 blur-2xl sm:h-64 sm:w-64"
          />
          <button
            onClick={onPlay}
            aria-label="Play"
            className="relative z-10 transition-transform hover:scale-105 active:scale-95"
          >
            <img
              src="/casino-play-button.png"
              alt="Play"
              className="w-44 drop-shadow-2xl sm:w-52"
            />
          </button>
        </div>
      </div>
    </div>
  );
}
