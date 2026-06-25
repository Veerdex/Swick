// Procedural sound-effect generator. Writes 16-bit mono WAV files to
// client/public/sfx/ using basic synthesis (tones, noise, sweeps, chimes) — no
// external tools/deps. Run from client/:  node scripts/gen-sfx.mjs
//
// These are a complete starter set; the "musical/foley" ones (payout,
// special-hand, set) are approximations meant to be swapped for hand-made audio.
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SR = 44100;
const OUT = fileURLToPath(new URL("../public/sfx/", import.meta.url));
mkdirSync(OUT, { recursive: true });

const buf = (sec) => new Float32Array(Math.max(1, Math.round(sec * SR)));

/** Add a (optionally pitch-swept) oscillator with an attack + decay/release. */
function tone(b, f0, t0, len, o = {}) {
  const { amp = 0.4, type = "sine", f1 = null, attack = 0.004, decay = null } = o;
  const n0 = Math.round(t0 * SR), n = Math.round(len * SR);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const k = n0 + i; if (k >= b.length) break;
    const f = f1 == null ? f0 : f0 * Math.pow(f1 / f0, i / n);
    phase += (2 * Math.PI * f) / SR;
    let w;
    if (type === "square") w = Math.sin(phase) >= 0 ? 1 : -1;
    else if (type === "triangle") w = Math.asin(Math.sin(phase)) * (2 / Math.PI);
    else if (type === "saw") w = 2 * (((phase / (2 * Math.PI)) % 1)) - 1;
    else w = Math.sin(phase);
    const t = i / SR, a = Math.min(attack, len * 0.5);
    const e = t < a ? t / a : decay ? Math.exp(-(t - a) / decay) : Math.max(0, 1 - (t - a) / (len - a));
    b[k] += amp * e * w;
  }
}

/** Add a filtered noise burst (lp/hp one-pole), optional cutoff sweep + decay. */
function noise(b, t0, len, o = {}) {
  const { amp = 0.4, lp = 4000, hp = 0, decay = null, attack = 0.002, lpEnd = null } = o;
  const n0 = Math.round(t0 * SR), n = Math.round(len * SR);
  let ylp = 0, yhp = 0;
  for (let i = 0; i < n; i++) {
    const k = n0 + i; if (k >= b.length) break;
    const cut = lpEnd == null ? lp : lp * Math.pow(lpEnd / lp, i / n);
    const al = 1 - Math.exp((-2 * Math.PI * cut) / SR);
    ylp += al * (Math.random() * 2 - 1 - ylp);
    let sig = ylp;
    if (hp > 0) { const ah = 1 - Math.exp((-2 * Math.PI * hp) / SR); yhp += ah * (ylp - yhp); sig = ylp - yhp; }
    const t = i / SR, a = Math.min(attack, len * 0.5);
    const e = t < a ? t / a : decay ? Math.exp(-(t - a) / decay) : Math.max(0, 1 - (t - a) / (len - a));
    b[k] += amp * e * sig;
  }
}

/** A short metallic "clink" (inharmonic partials) for coins. */
function clink(b, t0, f, amp) {
  for (const [m, g] of [[1, 1], [2.76, 0.5], [5.4, 0.25]]) tone(b, f * m, t0, 0.08, { amp: amp * g, decay: 0.05 });
}

function save(name, b, peak = 0.8) {
  let m = 0; for (const v of b) m = Math.max(m, Math.abs(v));
  const g = m > 0 ? peak / m : 1;
  const fade = Math.round(0.003 * SR);
  const out = Buffer.alloc(44 + b.length * 2);
  out.write("RIFF", 0); out.writeUInt32LE(36 + b.length * 2, 4); out.write("WAVE", 8);
  out.write("fmt ", 12); out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22);
  out.writeUInt32LE(SR, 24); out.writeUInt32LE(SR * 2, 28); out.writeUInt16LE(2, 32); out.writeUInt16LE(16, 34);
  out.write("data", 36); out.writeUInt32LE(b.length * 2, 40);
  for (let i = 0; i < b.length; i++) {
    let s = b[i] * g;
    if (i < fade) s *= i / fade;                       // de-click attack
    if (i > b.length - fade) s *= (b.length - i) / fade; // de-click tail
    s = Math.max(-1, Math.min(1, s));
    out.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }
  writeFileSync(OUT + name, out);
  console.log("  " + name.padEnd(20), (out.length / 1024).toFixed(1) + " KB");
}

// ---- the sounds -----------------------------------------------------------
const S = {};

S["ui-enter.wav"] = () => { const b = buf(0.75); noise(b, 0, 0.6, { amp: 0.5, lp: 400, lpEnd: 4000, decay: 0.4, attack: 0.1 }); tone(b, 392, 0.1, 0.6, { amp: 0.3, decay: 0.45 }); tone(b, 587, 0.15, 0.55, { amp: 0.25, decay: 0.42 }); tone(b, 784, 0.2, 0.5, { amp: 0.16, decay: 0.4 }); return [b, 0.7]; };
S["ui-click.wav"] = () => { const b = buf(0.08); noise(b, 0, 0.06, { amp: 1, lp: 1800, hp: 300, decay: 0.022 }); tone(b, 300, 0, 0.04, { amp: 0.3, decay: 0.03 }); return [b, 0.5]; };
S["ui-ready.wav"] = () => { const b = buf(0.2); tone(b, 660, 0, 0.08, { amp: 0.5, decay: 0.06 }); tone(b, 990, 0.07, 0.12, { amp: 0.5, decay: 0.08 }); return [b, 0.6]; };
S["error.wav"] = () => { const b = buf(0.32); tone(b, 300, 0, 0.12, { type: "square", amp: 0.35, decay: 0.1 }); tone(b, 196, 0.12, 0.18, { type: "square", amp: 0.35, decay: 0.13 }); return [b, 0.55]; };
S["game-start.wav"] = () => { const b = buf(1.0); tone(b, 300, 0, 0.6, { amp: 0.35, f1: 900, decay: 0.45 }); noise(b, 0, 0.6, { amp: 0.25, lp: 600, lpEnd: 5000, decay: 0.45, attack: 0.05 }); tone(b, 523, 0.32, 0.65, { amp: 0.3, decay: 0.45 }); tone(b, 784, 0.32, 0.65, { amp: 0.22, decay: 0.45 }); return [b, 0.75]; };
S["card-deal.wav"] = () => { const b = buf(0.18); noise(b, 0, 0.16, { amp: 1, lp: 6500, lpEnd: 1500, hp: 800, decay: 0.05, attack: 0.001 }); return [b, 0.6]; };
S["dealer.wav"] = () => { const b = buf(0.6); tone(b, 880, 0, 0.5, { amp: 0.5, decay: 0.35 }); tone(b, 1760, 0, 0.4, { amp: 0.15, decay: 0.22 }); tone(b, 2640, 0, 0.3, { amp: 0.07, decay: 0.18 }); return [b, 0.7]; };
S["card-flip.wav"] = () => { const b = buf(0.5); noise(b, 0, 0.12, { amp: 0.8, lp: 5000, hp: 600, decay: 0.055 }); tone(b, 1320, 0.1, 0.4, { amp: 0.28, decay: 0.3 }); tone(b, 1980, 0.1, 0.35, { amp: 0.14, decay: 0.25 }); return [b, 0.7]; };
S["your-turn.wav"] = () => { const b = buf(0.45); tone(b, 587, 0, 0.4, { amp: 0.45, decay: 0.32 }); tone(b, 880, 0.04, 0.42, { amp: 0.4, decay: 0.34 }); tone(b, 1174, 0.04, 0.4, { amp: 0.12, decay: 0.3 }); return [b, 0.7]; };
S["commit.wav"] = () => { const b = buf(0.3); tone(b, 150, 0, 0.25, { amp: 0.6, f1: 90, decay: 0.12 }); noise(b, 0, 0.03, { amp: 0.4, lp: 2000, decay: 0.02 }); return [b, 0.7]; };
S["fold.wav"] = () => { const b = buf(0.42); noise(b, 0, 0.4, { amp: 0.8, lp: 3000, lpEnd: 400, decay: 0.2, attack: 0.02 }); return [b, 0.55]; };
S["card-select.wav"] = () => { const b = buf(0.07); noise(b, 0, 0.05, { amp: 1, lp: 4500, hp: 1500, decay: 0.018 }); return [b, 0.45]; };
S["card-shuffle.wav"] = () => { const b = buf(0.75); for (let i = 0; i < 7; i++) noise(b, Math.random() * 0.6, 0.045, { amp: 0.7, lp: 3500, hp: 700, decay: 0.03 }); return [b, 0.6]; };
S["card-play.wav"] = () => { const b = buf(0.25); noise(b, 0, 0.12, { amp: 0.8, lp: 4000, hp: 500, decay: 0.05 }); tone(b, 120, 0, 0.12, { amp: 0.5, f1: 80, decay: 0.07 }); return [b, 0.65]; };
S["trick-win.wav"] = () => { const b = buf(0.6); noise(b, 0, 0.18, { amp: 0.5, lp: 1500, lpEnd: 5000, decay: 0.12, attack: 0.02 }); tone(b, 784, 0.18, 0.32, { amp: 0.4, decay: 0.26 }); tone(b, 1176, 0.2, 0.3, { amp: 0.28, decay: 0.24 }); return [b, 0.7]; };
S["payout.wav"] = () => { const b = buf(1.3); for (let i = 0; i < 16; i++) clink(b, Math.random() * 0.9, 1200 + Math.random() * 1400, 0.18 + Math.random() * 0.1); tone(b, 330, 0.6, 0.6, { amp: 0.3, decay: 0.4 }); tone(b, 440, 0.62, 0.58, { amp: 0.22, decay: 0.4 }); tone(b, 660, 0.62, 0.55, { amp: 0.14, decay: 0.4 }); return [b, 0.85]; };
S["set.wav"] = () => { const b = buf(0.8); tone(b, 440, 0, 0.7, { type: "triangle", amp: 0.5, f1: 150, decay: 0.55 }); tone(b, 220, 0.02, 0.7, { type: "triangle", amp: 0.3, f1: 80, decay: 0.55 }); return [b, 0.6]; };
S["special-hand.wav"] = () => { const b = buf(1.5); const arp = [523, 659, 784, 1046]; arp.forEach((f, i) => tone(b, f, i * 0.1, 0.6, { amp: 0.4, decay: 0.45 })); [523, 659, 784, 1046].forEach((f) => tone(b, f, 0.45, 0.9, { amp: 0.22, decay: 0.6 })); for (let i = 0; i < 8; i++) tone(b, 1800 + Math.random() * 1200, 0.45 + Math.random() * 0.6, 0.12, { amp: 0.1, decay: 0.08 }); return [b, 0.85]; };
S["swipe.wav"] = () => { const b = buf(0.2); noise(b, 0, 0.18, { amp: 0.6, lp: 2500, lpEnd: 1000, decay: 0.1, attack: 0.02 }); return [b, 0.5]; };
S["timer-tick.wav"] = () => { const b = buf(0.08); noise(b, 0, 0.04, { amp: 0.8, lp: 2500, hp: 800, decay: 0.018 }); tone(b, 1000, 0, 0.03, { amp: 0.25, decay: 0.02 }); return [b, 0.55]; };
S["money-tick.wav"] = () => { const b = buf(0.05); tone(b, 1200, 0, 0.04, { amp: 0.5, decay: 0.028 }); tone(b, 2400, 0, 0.03, { amp: 0.2, decay: 0.02 }); return [b, 0.5]; };
S["player-join.wav"] = () => { const b = buf(0.32); tone(b, 523, 0, 0.12, { amp: 0.45, decay: 0.1 }); tone(b, 784, 0.1, 0.18, { amp: 0.45, decay: 0.14 }); return [b, 0.6]; };
S["player-leave.wav"] = () => { const b = buf(0.34); tone(b, 587, 0, 0.12, { amp: 0.4, decay: 0.1 }); tone(b, 392, 0.1, 0.2, { amp: 0.4, decay: 0.16 }); return [b, 0.55]; };
S["reconnect.wav"] = () => { const b = buf(0.34); tone(b, 660, 0, 0.1, { amp: 0.45, decay: 0.08 }); tone(b, 990, 0.08, 0.14, { amp: 0.45, decay: 0.11 }); tone(b, 1320, 0.14, 0.16, { amp: 0.3, decay: 0.12 }); return [b, 0.6]; };

console.log("Writing SFX to", OUT);
for (const [name, fn] of Object.entries(S)) { const [b, peak] = fn(); save(name, b, peak); }
console.log(`Done — ${Object.keys(S).length} files.`);
