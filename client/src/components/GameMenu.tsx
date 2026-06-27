import { useState } from "react";
import { useBackgroundMusic } from "../lib/useBackgroundMusic";
import SfxControl from "./SfxControl";
import { playSfx } from "../lib/sfx";

// Hamburger menu popup for the game screen with sound controls.
export default function GameMenu() {
  const [isOpen, setIsOpen] = useState(false);
  const { musicOn, toggleMusic } = useBackgroundMusic();

  const handleToggleMusic = () => {
    playSfx("ui-click");
    toggleMusic();
  };

  return (
    <div className="fixed bottom-7 right-7 z-20">
      {/* Hamburger button */}
      <button
        onClick={() => {
          playSfx("ui-click");
          setIsOpen(!isOpen);
        }}
        aria-label="Game menu"
        title="Game menu"
        className="rounded-xl bg-slate-900/70 px-4 py-2 text-2xl leading-none hover:bg-slate-800 transition-colors"
      >
        ☰
      </button>

      {/* Popup menu */}
      {isOpen && (
        <div className="absolute bottom-16 right-0 rounded-xl bg-slate-900/95 p-4 shadow-lg space-y-3 min-w-56 border border-slate-700/50">
          {/* Music toggle */}
          <div className="flex items-center gap-3">
            <button
              onClick={handleToggleMusic}
              aria-label={musicOn ? "Mute music" : "Unmute music"}
              title={musicOn ? "Mute music" : "Play music"}
              className="text-2xl leading-none"
            >
              {musicOn ? "🔊" : "🔇"}
            </button>
            <span className="text-sm text-amber-100/80">
              {musicOn ? "Music On" : "Music Off"}
            </span>
          </div>

          {/* Sound effects control */}
          <div className="border-t border-slate-700/50 pt-3">
            <p className="text-xs uppercase tracking-wide text-amber-200/80 mb-2">
              Sound Effects
            </p>
            <SfxControl variant="inline" />
          </div>
        </div>
      )}

      {/* Backdrop to close menu */}
      {isOpen && (
        <div
          className="fixed inset-0 z-10"
          onClick={() => setIsOpen(false)}
          aria-hidden
        />
      )}
    </div>
  );
}
