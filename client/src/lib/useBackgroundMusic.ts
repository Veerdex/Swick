import { useEffect, useRef, useState } from "react";

const MUSIC_KEY = "swick:music";

/**
 * Loops a background track. Browsers block audio autoplay until the user
 * interacts, so playback is (re)attempted on the first pointer/key event.
 * Returns the on/off state and a toggle, plus a ref to attach to an <audio>.
 */
export function useBackgroundMusic(volume = 0.35) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [musicOn, setMusicOn] = useState(
    () => localStorage.getItem(MUSIC_KEY) !== "off",
  );

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = volume;

    if (!musicOn) {
      audio.pause();
      return;
    }

    const tryPlay = () => audio.play().catch(() => {});
    tryPlay(); // works if the page already has audio permission

    // Otherwise, kick it off on the first user gesture.
    const onGesture = () => tryPlay();
    window.addEventListener("pointerdown", onGesture);
    window.addEventListener("keydown", onGesture);
    return () => {
      window.removeEventListener("pointerdown", onGesture);
      window.removeEventListener("keydown", onGesture);
    };
  }, [musicOn, volume]);

  const toggleMusic = () =>
    setMusicOn((on) => {
      const next = !on;
      localStorage.setItem(MUSIC_KEY, next ? "on" : "off");
      return next;
    });

  return { audioRef, musicOn, toggleMusic };
}
