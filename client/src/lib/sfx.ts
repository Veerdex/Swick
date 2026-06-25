// Sound-effect engine. Uses the Web Audio API so effects can overlap (rapid
// card deals, coin ticks) with low latency. Files live in /public/sfx/<name>.wav
// — missing files are simply skipped, so the game is fine before audio is added.

const NAMES = [
  "ui-enter", "ui-click", "ui-ready", "game-start", "error",
  "card-deal", "dealer", "card-flip", "your-turn", "commit", "fold",
  "card-select", "card-shuffle", "card-play", "trick-win", "payout", "set",
  "special-hand", "swipe", "timer-tick", "money-tick",
  "player-join", "player-leave", "reconnect",
] as const;
export type SfxName = (typeof NAMES)[number];

const LS_VOL = "swick.sfxVolume";
const LS_MUTE = "swick.sfxMuted";

let ctx: AudioContext | null = null;
const buffers = new Map<string, AudioBuffer>();
let volume = readVolume();
let muted = localStorage.getItem(LS_MUTE) === "1";
let unlocked = false;

function readVolume(): number {
  const v = parseFloat(localStorage.getItem(LS_VOL) ?? "");
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.6;
}

function ensureCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === "suspended") void ctx.resume().catch(() => {});
  return ctx;
}

async function loadOne(name: string): Promise<void> {
  const c = ensureCtx();
  if (!c || buffers.has(name)) return;
  buffers.set(name, undefined as unknown as AudioBuffer); // mark in-flight
  try {
    const res = await fetch(`/sfx/${name}.wav`);
    if (!res.ok) return;
    buffers.set(name, await c.decodeAudioData(await res.arrayBuffer()));
  } catch {
    buffers.delete(name); // allow a retry later
  }
}

/** Create the audio context (suspended until a gesture), preload, and unlock. */
export function initSfx(): void {
  ensureCtx();
  for (const n of NAMES) void loadOne(n);
  if (unlocked || typeof window === "undefined") return;
  const unlock = () => {
    unlocked = true;
    ensureCtx();
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
  };
  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);
}

/** Play a sound. `volume` is a per-call 0–1 scale; `rate` shifts pitch/speed. */
export function playSfx(name: SfxName, opts: { volume?: number; rate?: number } = {}): void {
  if (muted || volume <= 0) return;
  const c = ensureCtx();
  if (!c) return;
  const buf = buffers.get(name);
  if (!buf) {
    void loadOne(name); // not ready yet — it'll be there next time
    return;
  }
  const src = c.createBufferSource();
  src.buffer = buf;
  if (opts.rate) src.playbackRate.value = opts.rate;
  const g = c.createGain();
  g.gain.value = volume * (opts.volume ?? 1);
  src.connect(g).connect(c.destination);
  src.start();
}

export const getSfxVolume = (): number => volume;
export function setSfxVolume(v: number): void {
  volume = Math.min(1, Math.max(0, v));
  localStorage.setItem(LS_VOL, String(volume));
}
export const isSfxMuted = (): boolean => muted;
export function setSfxMuted(m: boolean): void {
  muted = m;
  localStorage.setItem(LS_MUTE, m ? "1" : "0");
}
