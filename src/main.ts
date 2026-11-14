import '@fontsource-variable/space-grotesk';
import '@fontsource-variable/fraunces/full-italic.css';
import './style.css';

import { Model } from './engine/model';
import { analyze, randomProblem, symbol, type Mode, type Op, type Problem } from './engine/problem';
import { altitude, BASE_CAMP, EVEREST, speedIndex, type Solve } from './engine/score';
import {
  allAttempts, allRounds, exportAll, getSettings, importAll, persist, putAttempt, putRound,
  saveSettings, uid, wipe, type Attempt, type Round, type Settings, type Theme,
} from './db';
import { icon, logo, pie, ridges } from './ui/icons';
import { setSound, sfx, unlockAudio } from './sound';

/* ---------------- tiny DOM helper ---------------- */
type Child = Node | string | number | false | null | undefined;
function h<K extends keyof HTMLElementTagNameMap>(sel: K | `${K}.${string}`, props: Record<string, unknown> = {}, ...kids: Child[]) {
  const [tag, ...cls] = sel.split('.') as [K, ...string[]];
  const el = document.createElement(tag);
  if (cls.length) el.className = cls.join(' ');
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'class') el.className += ' ' + v;
    else if (k === 'style') el.setAttribute('style', String(v));
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of kids) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

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
const bestFor = (op: Op) => scored().reduce((m, r) => (r.op === op ? Math.max(m, r.score) : m), 0);
/** Speed of your first round with this operation: your personal base camp. */
const baseCamp = (op: Op) => scored().filter((r) => r.op === op).sort((a, b) => a.ts - b.ts)[0]?.speed ?? 0;
const fmtNum = (n: number) => n.toLocaleString('en-US').replace(/,/g, ' ');

/** Altitudes are always relative to the earliest round of each operation. */
function rescore() {
  const base = new Map<string, number>();
  for (const r of [...rounds].sort((a, b) => a.ts - b.ts)) {
    if (!r.speed) continue;
    if (!base.has(r.op)) base.set(r.op, r.speed);
    r.score = altitude(r.speed, base.get(r.op)!);
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
    h('div.top', {}, h('span'), h('button.ibtn', { 'aria-label': 'Options', onclick: () => { sfx.tap(); go(options); } }, icon('sliders'))),
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
  let target = '';
  let shownAt = 0;
  let input = '';
  let misses = 0;
  let locked = true;
  let raf = 0;
  let over = false;
  let streak = 0;
  let lastSec = -1;
  const solves: Solve[] = [];
  const recent: Problem[] = [];
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
    streak = 0;
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
    const ms = Math.round(performance.now() - shownAt);
    solves.push({ load: analyze(cur!).load, ms, solved: solvedIt });
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
    sfx.correct(streak++);
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
    cur = model.pick(op, mode, recent);
    target = String(cur.answer);
    recent.push(cur);
    if (recent.length > 6) recent.shift();
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
    locked = false;
  }

  function tick() {
    const left = endAt - performance.now();
    if (left <= 0) return finish();
    barFill.style.transform = `scaleX(${left / durMs})`;
    const t = fmtTime(left);
    if (timeEl.textContent !== t) timeEl.textContent = t;
    screen.classList.toggle('late', left <= 10000);
    const sec = Math.ceil(left / 1000);
    if (sec !== lastSec) { if (sec <= 10 && lastSec !== -1) sfx.tick(); lastSec = sec; }
    raf = requestAnimationFrame(tick);
  }

  function finish() {
    over = true;
    locked = true;
    sfx.end();
    const speed = speedIndex(solves);
    if (!solves.length || !speed) return go(() => result(op, 0, null));
    const camp = baseCamp(op);
    const score = camp ? altitude(speed, camp) : BASE_CAMP;
    const prev = bestFor(op);
    const r: Round = { id: roundId, ts: Date.now(), op, mode, duration: minutes, score, count: solves.length, speed };
    rounds.push(r);
    void putRound(r);
    go(() => result(op, score, !camp ? 'camp' : score > prev ? 'best' : null));
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

function result(op: Op, score: number, badge: Badge) {
  const climb = h('div.climb');
  const trail = 'M64 176 150 160 90 138 176 118 120 96 180 78 142 58 172 40 170 22';
  climb.innerHTML = `<svg viewBox="0 0 320 184" aria-hidden="true">
    <path class="m-back" d="M0 182 92 96l40 34 62-70 126 122Z"/>
    <path class="m-peak" d="M30 182 170 22l130 160Z"/>
    <path class="m-snow" d="M170 22 196 52l-14-5-10 11-12-11-14 7Z"/>
    <path class="trail" d="${trail}"/>
    <path class="done" d="${trail}"/>
    <path class="camp" d="M-7 0 0-10 7 0Z"/>
    <path d="M170 22V4" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="color:var(--muted)"/>
    <path class="top-flag" d="M170 4l14 5-14 5Z"/>
    <circle class="halo" r="7"/>
    <circle class="me" r="6"/>
  </svg>`;
  const done = climb.querySelector<SVGPathElement>('.done')!;
  const camp = climb.querySelector<SVGPathElement>('.camp')!;
  const me = climb.querySelector<SVGCircleElement>('.me')!;
  const halo = climb.querySelector<SVGCircleElement>('.halo')!;

  const num = h('span', {}, '0');
  const scoreEl = h('div.score', {}, num, h('small', {}, 'm'));
  const rec = h(`div.record${badge ? '' : '.hide'}`, { 'aria-label': badge === 'camp' ? 'Base camp set' : badge ? 'New best' : '' },
    icon(badge === 'camp' ? 'tent' : 'flag', 22));

  const screen = h(`section.screen.result.${op}`, {},
    h('div.top'),
    h('div.mid', {}, climb, scoreEl, rec),
    h('div.actions', {},
      h('button.btn', { 'aria-label': 'Home', onclick: () => { sfx.back(); go(home, 'back'); } }, icon('home')),
      h('button.btn.primary', { 'aria-label': 'Again', onclick: () => { sfx.tap(); go(() => game(op, settings.mode, settings.duration)); } }, icon('again', 26)),
    ),
  );

  const frac = Math.min(score / EVEREST, 1);
  let raf = 0;
  requestAnimationFrame(() => {
    const len = done.getTotalLength();
    const c = done.getPointAtLength(len * (BASE_CAMP / EVEREST));
    camp.setAttribute('transform', `translate(${c.x} ${c.y + 1})`);
    done.style.strokeDasharray = `${len}`;
    const t0 = performance.now();
    const D = reduced() ? 1 : 1500;
    if (score) setTimeout(() => sfx.climb(D / 1000), 500);
    const step = (now: number) => {
      const t = Math.min((now - t0) / D, 1);
      const e = 1 - Math.pow(1 - t, 3);
      num.textContent = fmtNum(Math.round(score * e));
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

  const file = h('input', { type: 'file', accept: 'application/json,.json', hidden: true }) as HTMLInputElement;
  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    file.value = '';
    if (!f) return;
    try {
      const res = await importAll(JSON.parse(await f.text()));
      await reload();
      renderStat();
      toast(icon('check', 18), `${fmtNum(res.attempts)} · ${fmtNum(res.rounds)}`);
    } catch {
      toast(icon('x', 18), 'invalid file');
    }
  });

  const exp = async () => {
    const dump = await exportAll();
    const blob = new Blob([JSON.stringify(dump)], { type: 'application/json' });
    const name = `sumit-${new Date().toISOString().slice(0, 10)}.json`;
    const fileObj = new File([blob], name, { type: 'application/json' });
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    // On iOS a share sheet is the most useful way to get the file out (Files, AirDrop...).
    if (matchMedia('(pointer: coarse)').matches && nav.canShare?.({ files: [fileObj] })) {
      try { await navigator.share({ files: [fileObj] }); return; } catch (e) { if ((e as Error).name === 'AbortError') return; }
    }
    const a = h('a', { href: URL.createObjectURL(blob), download: name });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  let armed = 0;
  const reset = h('button.chip.warn', { 'aria-label': 'Erase all data' }, icon('trash'));
  reset.addEventListener('click', async () => {
    if (!armed) {
      reset.classList.add('arm');
      reset.replaceChildren(icon('check'));
      armed = window.setTimeout(() => { armed = 0; reset.classList.remove('arm'); reset.replaceChildren(icon('trash')); }, 3000);
      return;
    }
    clearTimeout(armed);
    armed = 0;
    await wipe();
    await reload();
    renderStat();
    reset.classList.remove('arm');
    reset.replaceChildren(icon('trash'));
    toast(icon('trash', 18), '0');
  });

  return h('section.screen.opts', {},
    h('div.top', {}, h('button.ibtn', { 'aria-label': 'Back', onclick: () => { sfx.back(); go(home, 'back'); } }, icon('back', 28)), h('span')),
    h('div.body', {},
      h('div', {}, h('h2', {}, icon('auto', 15), 'theme'), tg),
      h('div', {}, h('h2', {}, icon('vol', 15), 'sound'), sg),
      h('div', {},
        h('h2', {}, icon('data', 15), 'data'),
        h('div.group.g3', {},
          h('button.chip', { 'aria-label': 'Export', onclick: exp }, icon('download')),
          h('button.chip', { 'aria-label': 'Import', onclick: () => file.click() }, icon('upload')),
          reset),
        stat,
        file),
    ),
  );
}

/* ---------------- boot ---------------- */
async function reload() {
  const [atts, rs] = await Promise.all([allAttempts(), allRounds()]);
  model.reset();
  const byRound = new Map<string, Solve[]>();
  for (const a of atts) {
    model.observe(a);
    let list = byRound.get(a.round);
    if (!list) byRound.set(a.round, (list = []));
    list.push({ load: analyze({ op: a.op, a: a.a, b: a.b, answer: 0 }).load, ms: a.ms, solved: a.correct });
  }
  // Rounds stored before the speed index existed: derive it from their attempts.
  for (const r of rs) if (r.speed == null) r.speed = speedIndex(byRound.get(r.id) ?? []);
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
