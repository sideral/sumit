import '@fontsource-variable/space-grotesk';
import '@fontsource-variable/fraunces/full-italic.css';
import './style.css';

import { Model } from './engine/model';
import { randomProblem, symbol, type Mode, type Op, type Problem } from './engine/problem';
import { altitude, EVEREST, speedIndex, usual, vsUsual, type Past, type Solve } from './engine/score';
import {
  allAttempts, allRounds, exportAll, getSettings, importAll, persist, putAttempt, putRound,
  saveSettings, uid, wipe, type Attempt, type Round, type Settings, type Theme,
} from './db';
import { h, type Child } from './ui/dom';
import { icon, logo, pie, ridges } from './ui/icons';
import { statsScreen } from './ui/stats';
import { setSound, sfx, unlockAudio } from './sound';

/* ---------------- state ---------------- */
const app = document.getElementById('app')!;
let settings: Settings;
let rounds: Round[] = [];
let attemptCount = 0;
const model = new Model();
let cleanup: (() => void) | null = null;

// One score per operation, across all modes and durations. The speed index is already
// normalised for problem difficulty, so rounds in different modes are comparable.
const scored = () => rounds.filter((r) => r.speed);
const bestFor = (op: Op) => scored().reduce((m, r) => (r.op === op ? Math.max(m, r.score) : m), -Infinity);
/** Your usual performance (Camp, 0 m) for this operation, from previous rounds. */
const usualFor = (op: Op) => usual(scored().filter((r) => r.op === op).map((r) => ({ speed: r.speed!, ts: r.ts })), Date.now());
const fmtNum = (n: number) => n.toLocaleString('en-US').replace(/,/g, ' ');
const fmtSigned = (n: number) => (n > 0 ? '+' : n < 0 ? '−' : '') + fmtNum(Math.abs(n));

/** Each round's altitude is relative to your usual performance *before* that round. */
function rescore() {
  const prev = new Map<Op, Past[]>();
  for (const r of [...rounds].sort((a, b) => a.ts - b.ts)) {
    if (!r.speed) continue;
    const list = prev.get(r.op) ?? [];
    const u = usual(list, r.ts);
    r.score = altitude(r.speed, u);
    r.ratio = vsUsual(r.speed, u) ?? undefined;
    list.push({ speed: r.speed, ts: r.ts });
    prev.set(r.op, list);
  }
}

function applyTheme(t: Theme) {
  if (t === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelectorAll('meta[name=theme-color]').forEach((m) => {
    m.setAttribute('content', dark ? '#0e131c' : '#f4f2ed');
    if (t !== 'system') m.removeAttribute('media');
  });
}

function save(patch: Partial<Settings>) {
  settings = { ...settings, ...patch };
  void saveSettings(settings);
}

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function go(next: () => HTMLElement, dir: 'fwd' | 'back' = 'fwd') {
  cleanup?.();
  cleanup = null;
  document.documentElement.dataset.dir = dir;
  const swap = () => app.replaceChildren(next());
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  if (doc.startViewTransition && !reduced()) doc.startViewTransition(swap);
  else {
    swap();
    app.firstElementChild?.classList.add('enter');
  }
}

function toast(...kids: Child[]) {
  const t = h('div.toast', {}, ...kids);
  document.body.append(t);
  t.addEventListener('animationend', () => t.remove());
}

/** Press feedback: instant on pointerdown, with ripple. */
function pressable(el: HTMLElement, action: () => void) {
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    el.classList.add('down');
    const r = el.getBoundingClientRect();
    const rip = h('i.rip', { style: `left:${e.clientX - r.left}px;top:${e.clientY - r.top}px` });
    el.append(rip);
    rip.addEventListener('animationend', () => rip.remove());
    action();
  });
  const up = () => el.classList.remove('down');
  el.addEventListener('pointerup', up);
  el.addEventListener('pointerleave', up);
  el.addEventListener('pointercancel', up);
  return el;
}

function shake(el: HTMLElement) {
  el.classList.remove('shake');
  void el.offsetWidth;
  el.classList.add('shake');
}

/**
 * A slot-machine reel that never stops: numbers scroll continuously, and the speed
 * drifts to a new random value every second or two, so the two reels never sync up.
 */
function reel(gen: () => number, side: 'l' | 'r', width: () => number) {
  const strip = h('span.strip');
  const el = h(`span.reel.${side}`, {}, strip);
  const item = () => h('span', {}, gen());
  let off = 0;
  let raf = 0;
  let timer = 0;
  let last = 0;
  let retarget = 0;
  const pick = () => 1.5 + Math.random() * 8; // numbers per second
  let v = pick();
  let target = v;

  function fill() {
    el.style.minWidth = `${width()}ch`;
    strip.replaceChildren(item(), item(), item(), item());
  }

  function step(now: number) {
    const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
    last = now;
    if (now > retarget) { target = pick(); retarget = now + 900 + Math.random() * 1800; }
    v += (target - v) * Math.min(1, dt * 1.8); // ease toward the new speed
    const H = (strip.firstElementChild as HTMLElement | null)?.offsetHeight || 1;
    off += v * H * dt;
    while (off >= H) {
      off -= H;
      strip.firstElementChild?.remove();
      strip.append(item());
    }
    strip.style.transform = `translateY(${-off}px)`;
    raf = requestAnimationFrame(step);
  }

  fill();
  if (reduced()) timer = window.setInterval(() => strip.replaceChildren(item(), item(), item(), item()), 900);
  else raf = requestAnimationFrame(step);
  return { el, spin: fill, stop: () => { cancelAnimationFrame(raf); clearInterval(timer); } };
}

/* ---------------- screens ---------------- */
function home() {
  const opBtn = (op: Op) =>
    h(`button.op.${op}`, {
      'aria-label': op === 'add' ? 'Addition' : 'Subtraction',
      onclick: (e: Event) => {
        (e.currentTarget as HTMLElement).querySelector('span')!.style.viewTransitionName = 'op-sym';
        save({ op });
        sfx.select();
        go(setup);
      },
    }, h('span', {}, symbol(op)));

  setTimeout(() => sfx.enter(), 120);
  return h('section.screen.home', {},
    h('div.top', {}, h('span'), h('div.tools', {},
      h('button.ibtn', { 'aria-label': 'Stats', onclick: () => { sfx.tap(); go(stats); } }, icon('stats')),
      h('button.ibtn', { 'aria-label': 'Options', onclick: () => { sfx.tap(); go(options); } }, icon('sliders')))),
    h('div.hero', {}, logo(), h('div.wordmark', {}, 'Sum', h('b', {}, 'It'))),
    h('div.ops', {}, opBtn('add'), opBtn('sub')),
    ridges(),
  );
}

function setup() {
  const { op } = settings;

  // Sample display: two slot-machine reels around a big operator. Each reel scrolls
  // nonstop at its own drifting speed, showing numbers the selected mode can produce.
  const digits = () => (settings.mode === '1' ? 1 : settings.mode === '2' ? 2 : 3);
  const reelA = reel(() => randomProblem(op, settings.mode).a, 'l', digits);
  const reelB = reel(() => randomProblem(op, settings.mode).b, 'r', digits);
  const display = h('div.display', { 'aria-hidden': 'true' },
    reelA.el, h('span.o', { style: 'view-transition-name: op-sym' }, symbol(op)), reelB.el);
  const roll = () => { reelA.spin(); reelB.spin(); };
  cleanup = () => { reelA.stop(); reelB.stop(); };


  const group = <T,>(cls: string, items: [T, () => Node, string][], get: () => T, set: (v: T) => void) => {
    const g = h(`div.group.${cls}`, { role: 'radiogroup' });
    const btns = items.map(([v, render, label]) => {
      const b = h('button.chip', { role: 'radio', 'aria-label': label }, render());
      b.addEventListener('click', () => {
        if (get() === v) return;
        sfx.select();
        set(v);
        btns.forEach((x, i) => { x.classList.toggle('on', items[i][0] === v); x.setAttribute('aria-checked', String(items[i][0] === v)); });
      });
      if (get() === v) { b.classList.add('on'); b.setAttribute('aria-checked', 'true'); }
      return b;
    });
    g.append(...btns);
    return g;
  };
  const slots = (n: number) => h('span.slots', {}, ...Array.from({ length: n }, () => h('i')));

  return h(`section.screen.setup.${op}`, {},
    h('div.top', {}, h('button.ibtn', { 'aria-label': 'Back', onclick: () => { sfx.back(); go(home, 'back'); } }, icon('back', 28)), h('span')),
    display,
    h('div.choices', {},
      group('g4', [
        ['1', () => slots(1), '1 digit'], ['2', () => slots(2), '2 digits'], ['3', () => slots(3), '3 digits'],
        ['mix', () => { const m = slots(3); m.classList.add('mix'); return m; }, 'mixed'],
      ] as [Mode, () => Node, string][], () => settings.mode, (mode) => { save({ mode }); roll(); }),
      group('g3', [1, 2, 5].map((d) => [d, () => h('span.dur', {}, pie(d, 23), h('span.mins', {}, d)), `${d} minutes`] as [number, () => Node, string]),
        () => settings.duration, (duration) => save({ duration })),
    ),
    h('div.start-wrap', {},
      h('button.start', { 'aria-label': 'Start', onclick: () => { sfx.tap(); go(() => game(op, settings.mode, settings.duration)); } }, icon('play', 40))),
  );
}

function game(op: Op, mode: Mode, minutes: number) {
  const roundId = uid();
  const durMs = minutes * 60000;
  let endAt = 0;
  let cur: Problem | null = null;
  let pending = false; // a problem is on screen and not yet answered
  let target = '';
  let shownAt = 0;
  let input = '';
  let misses = 0;
  let locked = true;
  let raf = 0;
  let over = false;
  const solves: Solve[] = [];
  // Fixed for the whole round: enough problems for ~0.6 s each, drawn from the model as it
  // is now. What the round teaches the model only affects the next round.
  const plan = model.plan(op, mode, Math.ceil((minutes * 60) / 0.6));
  let planIdx = 0;
  let curPred = 0;
  const timers: number[] = [];
  const later = (fn: () => void, ms: number) => timers.push(window.setTimeout(fn, ms));

  const chars = mode === '1' ? 5 : mode === '2' ? 7 : 9;
  const timeEl = h('span.timer', {}, fmtTime(durMs));
  const barFill = h('i');
  const probEl = h('div.prob');
  const valEl = h('span.v');
  const ansEl = h('div.ans.hidden', {}, valEl, h('i.caret'));
  const stage = h('div.stage', { style: `--fs: min(150px, 13dvh, calc(var(--col) / ${chars} / 0.6))` }, probEl, ansEl);

  const key = (label: Node | string, cls: string, fn: () => void, aria?: string) =>
    pressable(h(`button.key${cls}`, { 'aria-label': aria ?? String(label) }, label), fn);
  const pad = h('div.pad.off', {},
    ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => key(String(n), '', () => type(String(n)))),
    h('span'),
    key('0', '', () => type('0')),
    key(icon('del', 26), '.fn', erase, 'delete'),
  );

  const screen = h(`section.screen.game.${op}`, {},
    h('div.top', {}, h('button.ibtn', { 'aria-label': 'Quit', onclick: () => { sfx.back(); go(setup, 'back'); } }, icon('x')), timeEl),
    h('div.bar', {}, barFill),
    stage,
    pad,
  );

  function fmtTime(ms: number) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  function renderInput() {
    valEl.replaceChildren(...[...input].map((d, i) => (i === input.length - 1 ? h('span', {}, d) : d)));
  }

  function type(d: string) {
    if (locked || !cur || input.length >= target.length) return;
    input += d;
    sfx.key();
    renderInput();
    if (input === target) solved();
    else if (input.length === target.length) miss();
  }

  function erase() {
    if (locked || !input) return;
    input = input.slice(0, -1);
    sfx.key();
    renderInput();
  }

  /** Full-length but wrong: shake, clear, keep going. Costs only time. */
  function miss() {
    misses++;
    sfx.miss();
    locked = true;
    ansEl.classList.add('bad');
    shake(ansEl);
    later(() => {
      if (over) return;
      input = '';
      renderInput();
      ansEl.classList.remove('bad');
      locked = false;
    }, 300);
  }

  function record(solvedIt: boolean) {
    pending = false;
    const ms = Math.round(performance.now() - shownAt);
    solves.push({ pred: curPred, ms, solved: solvedIt }); // prediction frozen at round start
    const at: Attempt = {
      id: uid(), ts: Date.now(), round: roundId, op, a: cur!.a, b: cur!.b,
      given: solvedIt ? cur!.answer : null, correct: solvedIt, ms, misses, skipped: !solvedIt,
    };
    model.observe(at);
    attemptCount++;
    void putAttempt(at);
  }

  function solved() {
    record(true);
    sfx.correct();
    locked = true;
    ansEl.classList.add('ok');
    const sp = h('span.spark', {}, icon('check', 28));
    const r = ansEl.getBoundingClientRect();
    const sr = stage.getBoundingClientRect();
    sp.style.left = `${r.right - sr.left + 6}px`;
    sp.style.top = `${r.top - sr.top}px`;
    stage.append(sp);
    sp.addEventListener('animationend', () => sp.remove());
    later(() => !over && next(), 140);
  }

  function next() {
    const item = plan[planIdx++ % plan.length];
    cur = item.problem;
    curPred = item.pred;
    target = String(cur.answer);
    probEl.replaceChildren(String(cur.a), h('span.o', {}, symbol(op)), String(cur.b));
    input = '';
    misses = 0;
    ansEl.className = 'ans';
    renderInput();
    if (!reduced()) {
      probEl.animate([{ transform: 'translateY(18px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 220, easing: 'cubic-bezier(.2,.8,.2,1)' });
      ansEl.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180 });
    }
    shownAt = performance.now();
    pending = true;
    locked = false;
  }

  function tick() {
    const left = endAt - performance.now();
    if (left <= 0) return finish();
    barFill.style.transform = `scaleX(${left / durMs})`;
    const t = fmtTime(left);
    if (timeEl.textContent !== t) timeEl.textContent = t;
    raf = requestAnimationFrame(tick);
  }

  function finish() {
    over = true;
    locked = true;
    sfx.end();
    // The unanswered problem's time still counts, so one quick answer and then waiting out
    // the clock can't produce a great pace.
    const openMs = cur && pending ? Math.max(0, Math.round(performance.now() - shownAt)) : 0;
    const open = openMs ? { a: cur!.a, b: cur!.b, ms: openMs } : undefined;
    const speed = speedIndex(solves, open && { pred: curPred, ms: openMs });
    if (!solves.length || !speed) return go(() => result(op, 0, null, null));
    const u = usualFor(op);
    const score = altitude(speed, u);
    const ratio = vsUsual(speed, u);
    const prev = bestFor(op);
    const r: Round = { id: roundId, ts: Date.now(), op, mode, duration: minutes, score, count: solves.length, speed, ratio: ratio ?? undefined, open };
    rounds.push(r);
    void putRound(r);
    go(() => result(op, score, !u ? 'camp' : score > prev ? 'best' : null, ratio));
  }

  const onKey = (e: KeyboardEvent) => {
    if (/^[0-9]$/.test(e.key)) type(e.key);
    else if (e.key === 'Backspace') erase();
    else if (e.key === 'Escape') { sfx.back(); go(setup, 'back'); }
    else return;
    e.preventDefault();
  };
  window.addEventListener('keydown', onKey);
  cleanup = () => {
    over = true;
    cancelAnimationFrame(raf);
    timers.forEach(clearTimeout);
    window.removeEventListener('keydown', onKey);
  };

  // Start lights: three dots fill one by one, flash, and the first problem drops in.
  const lights = h('div.lights', { 'aria-hidden': 'true' }, h('i'), h('i'), h('i'));
  stage.append(lights);
  const STEP = 480;
  [0, 1, 2].forEach((i) => later(() => { lights.children[i].classList.add('on'); sfx.light(); }, 300 + i * STEP));
  later(() => { lights.classList.add('go'); sfx.go(); }, 300 + 3 * STEP);
  later(() => {
    lights.remove();
    pad.classList.remove('off');
    endAt = performance.now() + durMs;
    next();
    tick();
  }, 300 + 3 * STEP + 220);

  return screen;
}

type Badge = 'camp' | 'best' | null;

/** Plain-language reading of the score: pace vs. your usual, difficulty-adjusted. */
function paceText(ratio: number | null, badge: Badge) {
  if (badge === 'camp' || ratio == null) return 'first climb — this sets your usual pace';
  const faster = ratio > 1;
  const r = faster ? ratio : 1 / ratio;
  const pct = (r - 1) * 100;
  if (pct < 0.05) return 'right at your usual pace';
  // percentages with one decimal; past +50% a multiplier with two decimals reads better
  const amount = r >= 1.5 ? `${r.toFixed(2)}×` : `${pct.toFixed(1)}%`;
  return `${amount} ${faster ? 'faster' : 'slower'} than usual`;
}

function result(op: Op, score: number, badge: Badge, ratio: number | null) {
  // Camp (0 m) sits on the ground line. Better than usual climbs the mountain;
  // worse than usual descends into the crevasse below.
  const up = 'M70 150 150 134 96 116 176 98 124 80 178 64 144 48 172 34 170 22';
  const down = 'M70 150 58 160 46 172 52 188 42 206 48 224 44 242';
  const climb = h('div.climb');
  climb.innerHTML = `<svg viewBox="0 0 320 250" aria-hidden="true">
    <defs>
      <linearGradient id="abyss" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="var(--crevasse)"/><stop offset="1" stop-color="var(--abyss)"/>
      </linearGradient>
      <linearGradient id="soil" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="var(--r2)"/><stop offset="1" stop-color="var(--r2)" stop-opacity="0"/>
      </linearGradient>
      <linearGradient id="hfade" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".15" stop-color="#fff"/>
        <stop offset=".85" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
      </linearGradient>
      <mask id="edges"><rect x="-20" y="0" width="360" height="250" fill="url(#hfade)"/></mask>
    </defs>
    <path class="m-back" d="M0 150 70 92l34 26 50-56 166 88Z" mask="url(#edges)"/>
    <path class="m-peak" d="M40 150 170 20l130 130Z"/>
    <path class="m-snow" d="M170 20 192 46l-12-5-9 10-10-10-12 6Z"/>
    <path d="M-20 150H340V250H-20Z" fill="url(#soil)" mask="url(#edges)"/>
    <path class="horizon" d="M-20 150H340" mask="url(#edges)"/>
    <path class="crevasse" d="M24 150H62L56 170 50 196 44 250H40L36 200 30 176Z" fill="url(#abyss)"/>
    <path class="trail" d="${up}"/>
    <path class="trail" d="${down}"/>
    <path class="done" d="${score < 0 ? down : up}"/>
    <path class="camp" d="M62 150 70 139l8 11Z"/>
    <path d="M170 20V3" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="color:var(--muted)"/>
    <path class="top-flag" d="M170 3l14 5-14 5Z"/>
    <circle class="halo" r="7" cx="70" cy="150"/>
    <circle class="me" r="6" cx="70" cy="150"/>
  </svg>`;
  const done = climb.querySelector<SVGPathElement>('.done')!;
  const me = climb.querySelector<SVGCircleElement>('.me')!;
  const halo = climb.querySelector<SVGCircleElement>('.halo')!;

  const num = h('span', {}, '0');
  const rec = badge && h('div.record', { 'aria-label': badge === 'camp' ? 'Camp set' : 'New best' },
    icon(badge === 'camp' ? 'tent' : 'flag', 18));
  const scoreEl = h(`div.score${score < 0 ? '.neg' : ''}`, {}, num, h('small', {}, 'm'), rec);

  const screen = h(`section.screen.result.${op}`, {},
    h('div.top'),
    h('div.mid', {}, climb, scoreEl, h('div.pace', {}, paceText(ratio, badge))),
    h('div.actions', {},
      h('button.btn', { 'aria-label': 'Home', onclick: () => { sfx.back(); go(home, 'back'); } }, icon('home')),
      h('button.btn.primary', { 'aria-label': 'Again', onclick: () => { sfx.tap(); go(() => game(op, settings.mode, settings.duration)); } }, icon('again', 26)),
    ),
  );

  const frac = Math.min(Math.abs(score) / EVEREST, 1);
  let raf = 0;
  requestAnimationFrame(() => {
    const len = done.getTotalLength();
    done.style.strokeDasharray = `${len}`;
    done.style.strokeDashoffset = `${len}`;
    let t0 = 0;
    const D = reduced() || !score ? 1 : 1500;
    const step = (now: number) => {
      t0 ||= now;
      const t = Math.min(Math.max((now - t0) / D, 0), 1);
      const e = 1 - Math.pow(1 - t, 3);
      num.textContent = fmtSigned(Math.round(score * e));
      const L = len * frac * e;
      done.style.strokeDashoffset = `${len - L}`;
      const p = done.getPointAtLength(L);
      for (const el of [me, halo]) { el.setAttribute('cx', String(p.x)); el.setAttribute('cy', String(p.y)); }
      if (t < 1) raf = requestAnimationFrame(step);
      else {
        if (score >= EVEREST) climb.classList.add('summit');
        if (badge === 'camp') sfx.camp();
        else if (badge === 'best' || score >= EVEREST) sfx.record();
      }
    };
    raf = requestAnimationFrame(step);
  });
  cleanup = () => cancelAnimationFrame(raf);
  return screen;
}

/** Modal confirmation. Resolves true only on the explicit destructive button. */
function confirmDialog(text: string, yes: string): Promise<boolean> {
  return new Promise((resolve) => {
    const close = (v: boolean) => {
      overlay.classList.add('out');
      overlay.addEventListener('animationend', () => overlay.remove(), { once: true });
      window.removeEventListener('keydown', onKey);
      resolve(v);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(false); };
    const cancel = h('button.btn', { onclick: () => { sfx.back(); close(false); } }, 'cancel');
    const sheet = h('div.sheet', { role: 'alertdialog', 'aria-modal': 'true' },
      h('div.danger', {}, icon('trash', 26)),
      h('p', {}, text),
      h('div.sheet-actions', {},
        cancel,
        h('button.btn.destroy', { onclick: () => close(true) }, yes)));
    const overlay = h('div.overlay', { onclick: (e: Event) => { if (e.target === overlay) close(false); } }, sheet);
    window.addEventListener('keydown', onKey);
    document.body.append(overlay);
    cancel.focus();
  });
}

/** Save a JSON backup. On phones a share sheet is the most useful way out (Files, AirDrop...). */
async function exportData() {
  sfx.tap();
  const dump = await exportAll();
  const blob = new Blob([JSON.stringify(dump)], { type: 'application/json' });
  const name = `sumit-${new Date().toISOString().slice(0, 10)}.json`;
  const fileObj = new File([blob], name, { type: 'application/json' });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (matchMedia('(pointer: coarse)').matches && nav.canShare?.({ files: [fileObj] })) {
    try { await navigator.share({ files: [fileObj] }); return; } catch (e) { if ((e as Error).name === 'AbortError') return; }
  }
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/** Merge a JSON backup into the database. Resolves true if something was imported. */
function importData(): Promise<boolean> {
  sfx.tap();
  return new Promise((resolve) => {
    const file = h('input', { type: 'file', accept: 'application/json,.json' }) as HTMLInputElement;
    file.addEventListener('change', async () => {
      const f = file.files?.[0];
      if (!f) return resolve(false);
      try {
        const res = await importAll(JSON.parse(await f.text()));
        await reload();
        toast(icon('check', 18), `${fmtNum(res.rounds)} rounds · ${fmtNum(res.attempts)} answers`);
        resolve(true);
      } catch {
        toast(icon('x', 18), 'invalid file');
        resolve(false);
      }
    });
    file.addEventListener('cancel', () => resolve(false));
    file.click();
  });
}

/** Erase every round and attempt (settings are kept), after confirmation. */
async function eraseAll() {
  sfx.tap();
  if (!(await confirmDialog('Erase all rounds and practice history? This can’t be undone.', 'erase all'))) return false;
  await wipe();
  await reload();
  toast(icon('trash', 18), 'erased');
  return true;
}

function stats() {
  const el = statsScreen({
    op: settings.op,
    rounds,
    attempts: allAttempts,
    paceText: (r) => paceText(r ?? null, r == null ? 'camp' : null),
    back: () => { sfx.back(); go(home, 'back'); },
    select: () => sfx.select(),
  });
  cleanup = el.cleanup;
  return el.screen;
}

function options() {
  const themeBtns: [Theme, string][] = [['system', 'auto'], ['light', 'sun'], ['dark', 'moon']];
  const tg = h('div.group.g3', { role: 'radiogroup' });
  const tbs = themeBtns.map(([t, ic]) => {
    const b = h(`button.chip${settings.theme === t ? '.on' : ''}`, { role: 'radio', 'aria-label': t }, icon(ic));
    b.addEventListener('click', () => {
      save({ theme: t });
      applyTheme(t);
      tbs.forEach((x, i) => x.classList.toggle('on', themeBtns[i][0] === t));
    });
    return b;
  });
  tg.append(...tbs);

  const sg = h('div.group.g3', { role: 'radiogroup' });
  const sbs = ([[true, 'vol'], [false, 'mute']] as [boolean, string][]).map(([on, ic]) => {
    const b = h(`button.chip${settings.sound === on ? '.on' : ''}`, { role: 'radio', 'aria-label': on ? 'sound on' : 'sound off' }, icon(ic));
    b.addEventListener('click', () => {
      save({ sound: on });
      setSound(on);
      if (on) sfx.select();
      sbs.forEach((x, i) => x.classList.toggle('on', i === (on ? 0 : 1)));
    });
    return b;
  });
  sg.append(...sbs);

  const stat = h('div.stat');
  const renderStat = () => stat.replaceChildren(
    h('span', {}, icon('check', 15), fmtNum(attemptCount)),
    h('span', {}, icon('flag', 15), fmtNum(rounds.length)),
  );
  renderStat();

  return h('section.screen.opts', {},
    h('div.top', {}, h('button.ibtn', { 'aria-label': 'Back', onclick: () => { sfx.back(); go(home, 'back'); } }, icon('back', 28)), h('span')),
    h('div.body', {},
      h('div', {}, h('h2', {}, icon('auto', 15), 'theme'), tg),
      h('div', {}, h('h2', {}, icon('vol', 15), 'sound'), sg),
      h('div', {},
        h('h2', {}, icon('data', 15), 'data'),
        h('div.group.g3', {},
          h('button.chip', { 'aria-label': 'Export', onclick: exportData }, icon('download')),
          h('button.chip', { 'aria-label': 'Import', onclick: async () => { if (await importData()) renderStat(); } }, icon('upload')),
          h('button.chip.warn', { 'aria-label': 'Erase all data', onclick: async () => { if (await eraseAll()) renderStat(); } }, icon('trash'))),
        stat),
    ),
  );
}

/* ---------------- boot ---------------- */
async function reload() {
  const [atts, rs] = await Promise.all([allAttempts(), allRounds()]);
  model.reset();
  const byRound = new Map<string, Solve[]>();
  const openPred = new Map<string, number>();
  const roundById = new Map(rs.map((r) => [r.id, r]));
  // Replay history round by round, exactly as it happened live: every answer in a round is
  // predicted with what the model knew when the round started, then the round is learned.
  for (let i = 0; i < atts.length;) {
    let j = i;
    while (j < atts.length && atts[j].round === atts[i].round) j++;
    const chunk = atts.slice(i, j);
    const preds = chunk.map((a) => model.predictMs({ op: a.op, a: a.a, b: a.b, answer: 0 }));
    const o = roundById.get(atts[i].round)?.open;
    if (o) openPred.set(atts[i].round, model.predictMs({ op: atts[i].op, a: o.a, b: o.b, answer: 0 }));
    let list = byRound.get(atts[i].round);
    if (!list) byRound.set(atts[i].round, (list = []));
    chunk.forEach((a, k) => { model.observe(a); list!.push({ pred: preds[k], ms: a.ms, solved: a.correct }); });
    i = j;
  }
  // Pace is always derived from attempts, so it stays consistent if the model changes.
  for (const r of rs) {
    const list = byRound.get(r.id);
    const p = openPred.get(r.id);
    if (list?.length) r.speed = speedIndex(list, r.open && p !== undefined ? { pred: p, ms: r.open.ms } : null);
  }
  attemptCount = atts.length;
  rounds = rs;
  rescore();
}

async function boot() {
  settings = await getSettings();
  applyTheme(settings.theme);
  setSound(settings.sound);
  unlockAudio();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(settings.theme));
  await reload();
  void persist();
  app.replaceChildren(home());
}

void boot();
