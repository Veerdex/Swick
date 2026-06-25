import { useState } from "react";
import {
  getSfxVolume,
  setSfxVolume,
  isSfxMuted,
  setSfxMuted,
} from "./sfx";

/** Local state for the SFX volume/mute control, synced to the sfx engine. */
export function useSfxControls() {
  const [volume, setVol] = useState(getSfxVolume);
  const [muted, setMutedState] = useState(isSfxMuted);
  return {
    volume,
    muted,
    setVolume: (v: number) => {
      setSfxVolume(v);
      setVol(v);
    },
    toggleMuted: () => {
      const next = !muted;
      setSfxMuted(next);
      setMutedState(next);
    },
  };
}
