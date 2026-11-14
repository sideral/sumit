/**
 * Tiny synthesized sound kit (Web Audio, no assets).
 * iOS only allows audio after a user gesture, so the context is unlocked on first touch.
 */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let enabled = true;

export function setSound(on: boolean) { enabled = on; }

function ac() {
  if (!ctx) {
    const C = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!C) return null;
    ctx = new C();
    master = ctx.createGain();
    master.gain.value = 0.55;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

export function unlockAudio() {
  const once = () => {
    const c = ac();
    if (c) { // play a silent buffer: required by older iOS to fully unlock
      const b = c.createBufferSource();
      b.buffer = c.createBuffer(1, 1, 22050);
      b.connect(c.destination);
      b.start(0);
    }
    window.removeEventListener('pointerdown', once, true);
    window.removeEventListener('keydown', once, true);
  };
  window.addEventListener('pointerdown', once, true);
  window.addEventListener('keydown', once, true);
}

interface Tone {
  f: number;          // start frequency
  to?: number;        // glide target
  t?: number;         // delay (s)
  d?: number;         // duration (s)
  v?: number;         // volume
  type?: OscillatorType;
  a?: number;         // attack (s)
}

function tone({ f, to, t = 0, d = 0.15, v = 0.3, type = 'sine', a = 0.005 }: Tone) {
  const c = ac();
  if (!c || !master || !enabled) return;
  const t0 = c.currentTime + t;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t0);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t0 + d);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(v, t0 + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
  o.connect(g).connect(master);
  o.start(t0);
  o.stop(t0 + d + 0.02);
}

/** Bell-ish: fundamental + soft inharmonic partial. */
function bell(f: number, t = 0, d = 0.6, v = 0.22) {
  tone({ f, t, d, v, type: 'sine', a: 0.004 });
  tone({ f: f * 2.76, t, d: d * 0.5, v: v * 0.25, type: 'sine', a: 0.002 });
}

// pentatonic-ish notes
const N = { C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99, A5: 880, C6: 1046.5, E6: 1318.5, G4: 392, C4: 261.63 };

export const sfx = {
  /** Home screen: airy rising chime. */
  enter() { bell(N.G4, 0, 0.7, 0.14); bell(N.C5, 0.09, 0.7, 0.14); bell(N.G5, 0.18, 0.9, 0.12); },
  /** Navigation / selection. */
  tap() { tone({ f: 1400, to: 900, d: 0.05, v: 0.08, type: 'triangle' }); },
  select() { tone({ f: 660, to: 990, d: 0.08, v: 0.12, type: 'triangle' }); },
  back() { tone({ f: 700, to: 420, d: 0.08, v: 0.1, type: 'triangle' }); },
  /** Keypad digit. */
  key() { tone({ f: 1800, to: 1200, d: 0.03, v: 0.05, type: 'square' }); },
  /** Start-lights beep and final "go". */
  light() { tone({ f: 440, d: 0.16, v: 0.16, type: 'triangle' }); },
  go() { tone({ f: 880, d: 0.32, v: 0.2, type: 'triangle' }); tone({ f: 1320, d: 0.3, v: 0.06, type: 'sine' }); },
  /** Correct: always the same gentle ping — no rising pitch, no tension. */
  correct() {
    tone({ f: N.C6, d: 0.12, v: 0.13, type: 'sine' });
    tone({ f: N.C6 * 1.5, t: 0.04, d: 0.12, v: 0.06, type: 'sine' });
  },
  miss() { tone({ f: 180, to: 120, d: 0.16, v: 0.22, type: 'triangle' }); },
  /** Time's up: low gong. */
  end() { bell(N.C4, 0, 1.4, 0.26); bell(N.G4, 0.02, 1.1, 0.1); },
  /** New best / summit. */
  record() { [N.C5, N.E5, N.G5, N.C6].forEach((f, i) => bell(f, i * 0.09, 0.8, 0.16)); },
  camp() { bell(N.E5, 0, 0.8, 0.15); bell(N.A5, 0.12, 1, 0.13); },
};
