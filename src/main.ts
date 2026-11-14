import '@fontsource-variable/space-grotesk';
import '@fontsource-variable/fraunces/full-italic.css';
import './style.css';

import { Model } from './engine/model';
import { analyze, symbol, type Mode, type Op, type Problem } from './engine/problem';
import { EVEREST, finalScore, pointsFor } from './engine/score';
import {
  allAttempts, allRounds, exportAll, getSettings, importAll, persist, putAttempt, putRound,
  saveSettings, uid, wipe, type Attempt, type Round, type Settings, type Theme,
} from './db';
import { icon, logo, pie, ridges } from './ui/icons';

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

const configKey = (op: Op, mode: Mode, dur: number) => `${op}|${mode}|${dur}`;
const bestFor = (op: Op, mode: Mode, dur: number) =>
  rounds.reduce((m, r) => (configKey(r.op, r.mode, r.duration) === configKey(op, mode, dur) ? Math.max(m, r.score) : m), 0);
const fmtNum = (n: number) => n.toLocaleString('en-US').replace(/,/g, ' ');

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

/* ---------------- screens ---------------- */
function home() {
  const opBtn = (op: Op) =>
    h(`button.op.${op}`, {
      'aria-label': op === 'add' ? 'Addition' : 'Subtraction',
      onclick: (e: Event) => {
        (e.currentTarget as HTMLElement).querySelector('span')!.style.viewTransitionName = 'op-sym';
        save({ op });
        go(setup);
      },
    }, h('span', {}, symbol(op)));

  return h('section.screen.home', {},
    h('div.top', {}, h('span'), h('button.ibtn', { 'aria-label': 'Options', onclick: () => go(options) }, icon('sliders'))),
    h('div.hero', {}, logo(), h('div.wordmark', {}, 'Sum', h('b', {}, 'It'))),
    h('div.ops', {}, opBtn('add'), opBtn('sub')),
    ridges(),
  );
}

function setup() {
  const { op } = settings;
  const modes: [Mode, () => Node][] = [
    ['1', () => slots(1)], ['2', () => slots(2)], ['3', () => slots(3)], ['mix', () => icon('shuffle', 22)],
  ];
  function slots(n: number) { return h('span.slots', {}, ...Array.from({ length: n }, () => h('i'))); }

  const best = h('div.best');
  const updateBest = () => {
    const b = bestFor(op, settings.mode, settings.duration);
    best.replaceChildren(...(b ? [icon('flag', 16), fmtNum(b)] : []));
  };

  const group = <T,>(cls: string, items: [T, () => Node, string][], get: () => T, set: (v: T) => void) => {
    const g = h(`div.group.${cls}`, { role: 'radiogroup' });
    const btns = items.map(([v, render, label]) => {
      const b = h('button.chip', { role: 'radio', 'aria-label': label }, render());
      b.addEventListener('click', () => {
        set(v);
        btns.forEach((x, i) => { x.classList.toggle('on', items[i][0] === v); x.setAttribute('aria-checked', String(items[i][0] === v)); });
        updateBest();
      });
      if (get() === v) { b.classList.add('on'); b.setAttribute('aria-checked', 'true'); }
      return b;
    });
    g.append(...btns);
    return g;
  };

  updateBest();
  const sym = h('div.bigop', { style: 'view-transition-name: op-sym' }, symbol(op));
  return h(`section.screen.setup.${op}`, {},
    h('div.top', {}, h('button.ibtn', { 'aria-label': 'Back', onclick: () => go(home, 'back') }, icon('back')), h('span')),
    sym,
    group('g4', modes.map(([m, r]) => [m, r, m === 'mix' ? 'mixed' : `${m} digit`]), () => settings.mode, (mode) => save({ mode })),
    group('g3', [1, 2, 5].map((d) => [d, () => h('span', { style: 'display:contents' }, pie(d), h('span.mins', {}, d)), `${d} minutes`] as [number, () => Node, string]),
      () => settings.duration, (duration) => save({ duration })),
    h('div.spacer'),
    h('div.start-wrap', {},
      h('button.start', { 'aria-label': 'Start', onclick: () => go(() => game(op, settings.mode, settings.duration)) }, icon('play', 34)),
      best),
  );
}

function game(op: Op, mode: Mode, minutes: number) {
  const roundId = uid();
  const durMs = minutes * 60000;
  let endAt = 0;
  let cur: Problem | null = null;
  let shownAt = 0;
  let input = '';
  let locked = true;
  let streak = 0;
  let points = 0;
  let correct = 0;
  let total = 0;
  let raf = 0;
  let over = false;
  const recent: Problem[] = [];
  const timers: number[] = [];
  const later = (fn: () => void, ms: number) => timers.push(window.setTimeout(fn, ms));

  const chars = mode === '1' ? 5 : mode === '2' ? 7 : 9;
  const timeEl = h('span.timer', {}, fmtTime(durMs));
  const barFill = h('i');
  const probEl = h('div.prob');
  const valEl = h('span.v');
  const ansEl = h('div.ans', {}, valEl, h('i.caret'));
  const stage = h('div.stage', { style: `--fs: min(104px, 12.5dvh, calc((min(100vw, 480px) - 40px) / ${chars} / 0.6))` }, probEl, ansEl);

  const key = (label: Node | string, cls: string, fn: () => void, aria?: string) =>
    pressable(h(`button.key${cls}`, { 'aria-label': aria ?? String(label) }, label), fn);
  const pad = h('div.pad.off', {},
    ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => key(String(n), '', () => type(String(n)))),
    key(icon('del', 26), '.fn', erase, 'delete'),
    key('0', '', () => type('0')),
    key(icon('check', 28), '.go', submit, 'enter'),
  );

  const screen = h(`section.screen.game.${op}`, {},
    h('div.top', {}, h('button.ibtn', { 'aria-label': 'Quit', onclick: () => go(setup, 'back') }, icon('x')), timeEl),
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
    if (locked || input.length >= 4) return;
    if (input === '0') input = '';
    input += d;
    renderInput();
  }
  function erase() {
    if (locked || !input) return;
    input = input.slice(0, -1);
    renderInput();
  }

  function next() {
    cur = model.pick(op, mode, recent);
    recent.push(cur);
    if (recent.length > 6) recent.shift();
    probEl.replaceChildren(String(cur.a), h('span.o', {}, symbol(op)), String(cur.b));
    input = '';
    ansEl.className = 'ans';
    renderInput();
    stage.querySelector('.fix')?.remove();
    if (!reduced()) {
      probEl.animate([{ transform: 'translateY(18px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 240, easing: 'cubic-bezier(.2,.8,.2,1)' });
      ansEl.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200 });
    }
    shownAt = performance.now();
    locked = false;
  }

  function submit() {
    if (locked || !input || !cur) return;
    const ms = Math.round(performance.now() - shownAt);
    const given = Number(input);
    const ok = given === cur.answer;
    total++;
    if (ok) {
      points += pointsFor(analyze(cur).load, ms, streak);
      streak++;
      correct++;
    } else streak = 0;
    const at: Attempt = { id: uid(), ts: Date.now(), round: roundId, op, a: cur.a, b: cur.b, given, correct: ok, ms };
    model.observe(at);
    attemptCount++;
    void putAttempt(at);

    locked = true;
    if (ok) {
      ansEl.classList.add('ok');
      const sp = h('span.spark', {}, icon('check', 28));
      const r = ansEl.getBoundingClientRect();
      const sr = stage.getBoundingClientRect();
      sp.style.left = `${r.right - sr.left + 6}px`;
      sp.style.top = `${r.top - sr.top}px`;
      stage.append(sp);
      sp.addEventListener('animationend', () => sp.remove());
      later(() => !over && next(), 170);
    } else {
      ansEl.classList.add('bad');
      stage.classList.remove('shake');
      void stage.offsetWidth;
      stage.classList.add('shake');
      stage.append(h('div.fix', {}, icon('check', 22), String(cur.answer)));
      later(() => !over && next(), 950);
    }
  }

  function tick() {
    const left = endAt - performance.now();
    if (left <= 0) return finish();
    barFill.style.transform = `scaleX(${left / durMs})`;
    const t = fmtTime(left);
    if (timeEl.textContent !== t) timeEl.textContent = t;
    screen.classList.toggle('late', left <= 10000);
    raf = requestAnimationFrame(tick);
  }

  function finish() {
    over = true;
    locked = true;
    const score = finalScore(points, correct, total, durMs);
    const prev = bestFor(op, mode, minutes);
    if (total > 0) {
      const r: Round = { id: roundId, ts: Date.now(), op, mode, duration: minutes, score, count: total };
      rounds.push(r);
      void putRound(r);
    }
    go(() => result(op, score, score > prev && score > 0));
  }

  const onKey = (e: KeyboardEvent) => {
    if (/^[0-9]$/.test(e.key)) type(e.key);
    else if (e.key === 'Backspace') erase();
    else if (e.key === 'Enter') submit();
    else if (e.key === 'Escape') go(setup, 'back');
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

  // 3 · 2 · 1
  const counts = ['3', '2', '1'];
  counts.forEach((c, i) => later(() => {
    const el = h('div.count', {}, c);
    stage.append(el);
    el.addEventListener('animationend', () => el.remove());
  }, 250 + i * 520));
  later(() => {
    pad.classList.remove('off');
    endAt = performance.now() + durMs;
    next();
    tick();
  }, 250 + counts.length * 520);

  return screen;
}

function result(op: Op, score: number, record: boolean) {
  const climb = h('div.climb');
  climb.innerHTML = `<svg viewBox="0 0 320 184" aria-hidden="true">
    <path class="m-back" d="M0 182 92 96l40 34 62-70 126 122Z"/>
    <path class="m-peak" d="M30 182 170 22l130 160Z"/>
    <path class="m-snow" d="M170 22 196 52l-14-5-10 11-12-11-14 7Z"/>
    <path class="trail" d="M64 176 150 160 90 138 176 118 120 96 180 78 142 58 172 40 170 22"/>
    <path class="done" d="M64 176 150 160 90 138 176 118 120 96 180 78 142 58 172 40 170 22"/>
    <path d="M170 22V4" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="color:var(--muted)"/>
    <path class="top-flag" d="M170 4l14 5-14 5Z"/>
    <circle class="halo" r="7"/>
    <circle class="me" r="6"/>
  </svg>`;
  const done = climb.querySelector<SVGPathElement>('.done')!;
  const me = climb.querySelector<SVGCircleElement>('.me')!;
  const halo = climb.querySelector<SVGCircleElement>('.halo')!;

  const num = h('span', {}, '0');
  const scoreEl = h('div.score', {}, num, h('small', {}, 'm'));
  const rec = h(`div.record${record ? '' : '.hide'}`, { 'aria-label': record ? 'New best' : '' }, icon('flag', 22));

  const screen = h(`section.screen.result.${op}`, {},
    h('div.top'),
    h('div.mid', {}, climb, scoreEl, rec),
    h('div.actions', {},
      h('button.btn', { 'aria-label': 'Home', onclick: () => go(home, 'back') }, icon('home')),
      h('button.btn.primary', { 'aria-label': 'Again', onclick: () => go(() => game(op, settings.mode, settings.duration)) }, icon('again', 26)),
    ),
  );

  const frac = Math.min(score / EVEREST, 1);
  let raf = 0;
  requestAnimationFrame(() => {
    const len = done.getTotalLength();
    done.style.strokeDasharray = `${len}`;
    const t0 = performance.now();
    const D = reduced() ? 1 : 1400;
    const step = (now: number) => {
      const t = Math.min((now - t0) / D, 1);
      const e = 1 - Math.pow(1 - t, 3);
      num.textContent = fmtNum(Math.round(score * e));
      const L = len * frac * e;
      done.style.strokeDashoffset = `${len - L}`;
      const p = done.getPointAtLength(L);
      for (const c of [me, halo]) { c.setAttribute('cx', String(p.x)); c.setAttribute('cy', String(p.y)); }
      if (t < 1) raf = requestAnimationFrame(step);
      else if (score >= EVEREST) climb.classList.add('summit');
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
    h('div.top', {}, h('button.ibtn', { 'aria-label': 'Back', onclick: () => go(home, 'back') }, icon('back')), h('span')),
    h('div.body', {},
      h('div', {}, h('h2', {}, icon('auto', 15), 'theme'), tg),
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
  for (const a of atts) model.observe(a);
  attemptCount = atts.length;
  rounds = rs;
}

async function boot() {
  settings = await getSettings();
  applyTheme(settings.theme);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(settings.theme));
  await reload();
  void persist();
  app.replaceChildren(home());
}

void boot();
