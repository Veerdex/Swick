import { useSfxControls } from "../lib/useSfx";
import { playSfx } from "../lib/sfx";

// Sits just under the music toggle: a mute button plus a volume slider for
// sound effects (independent of the background music).
export default function SfxControl() {
  const { volume, muted, setVolume, toggleMuted } = useSfxControls();
  return (
    <div className="fixed right-7 top-[4.75rem] z-20 flex items-center gap-2 rounded-xl bg-slate-900/70 px-3 py-2">
      <button
        onClick={toggleMuted}
        aria-label={muted ? "Unmute sound effects" : "Mute sound effects"}
        title={muted ? "Unmute sound effects" : "Mute sound effects"}
        className="text-2xl leading-none"
      >
        {muted ? "🔕" : "🔔"}
      </button>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={muted ? 0 : volume}
        onChange={(e) => {
          const v = Number(e.target.value);
          setVolume(v);
          if (muted && v > 0) toggleMuted();
        }}
        onPointerUp={() => playSfx("ui-ready")} // preview the level
        aria-label="Sound effects volume"
        className="w-20 accent-amber-400"
      />
    </div>
  );
}
