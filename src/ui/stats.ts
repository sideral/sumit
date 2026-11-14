import type { Attempt, Round } from '../db';
import type { Mode, Op } from '../engine/problem';
import { symbol } from '../engine/problem';
import { EVEREST } from '../engine/score';
import { h } from './dom';
import { icon } from './icons';

/**
 * Stats: per-operation totals, altitude history, raw time per problem by mode
 * (the long-term progress view), and a practice calendar.
 * Deliberately shows nothing about which digits/patterns are hard.
 */

export interface StatsDeps {
  op: Op;
  rounds: Round[];
  attempts: () => Promise<Attempt[]>;
  paceText: (ratio: number | undefined) => string;
  back: () => void;
  select: () => void;
}

const SVG = 'http://www.w3.org/2000/svg';
const DAY = 86_400_000;
const fmtNum = (n: number) => Math.round(n).toLocaleString('en-US').replace(/,/g, ' ');
const fmtSigned = (n: number) => (n > 0 ? '+' : n < 0 ? '−' : '') + fmtNum(Math.abs(n));
const fmtDate = (ts: number) => new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
const fmtSec = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const dayKey = (ts: number) => { const d = new Date(ts); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };

function svg(w: number, ht: number, inner: string) {
  const s = document.createElementNS(SVG, 'svg');
  s.setAttribute('viewBox', `0 0 ${w} ${ht}`);
  s.setAttribute('width', String(w));
  s.setAttribute('height', String(ht));
  s.classList.add('chart');
  s.innerHTML = inner;
  return s;
}

/** Bar path with 4px rounded data end, flat on the baseline. */
function bar(x: number, base: number, end: number, w: number) {
  const up = end < base;
  const len = Math.abs(end - base);
  const r = Math.min(4, w / 2, len);
  if (len < 0.5) return '';
  return up
    ? `M${x} ${base}V${end + r}Q${x} ${end} ${x + r} ${end}H${x + w - r}Q${x + w} ${end} ${x + w} ${end + r}V${base}Z`
    : `M${x} ${base}V${end - r}Q${x} ${end} ${x + r} ${end}H${x + w - r}Q${x + w} ${end} ${x + w} ${end - r}V${base}Z`;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

export function statsScreen(d: StatsDeps) {
  let op = d.op;
  let mode: Mode | null = null;
  let atts: Attempt[] | null = null;

  const body = h('div.body');
  const tip = h('div.tip', { role: 'tooltip' });

  const opBtns = (['add', 'sub'] as Op[]).map((o) => {
    const b = h(`button.opt.${o}${o === op ? '.on' : ''}`, { 'aria-label': o === 'add' ? 'Addition' : 'Subtraction' }, symbol(o));
    b.addEventListener('click', () => {
      if (op === o) return;
      d.select();
      op = o;
      mode = null;
      opBtns.forEach((x, i) => x.classList.toggle('on', (['add', 'sub'] as Op[])[i] === o));
      screen.classList.toggle('sub', o === 'sub');
      render();
    });
    return b;
  });

  const screen = h(`section.screen.stats${op === 'sub' ? '.sub' : ''}`, {},
    h('div.top', {},
      h('button.ibtn', { 'aria-label': 'Back', onclick: d.back }, icon('back', 28)),
      h('div.optoggle', { role: 'tablist' }, ...opBtns),
      h('span.spacer-44')),
    body,
    tip,
  );

  // one tooltip for every chart: anything with data-tip
  const showTip = (e: PointerEvent) => {
    const t = (e.target as Element).closest('[data-tip]');
    if (!t) { tip.classList.remove('on'); return; }
    tip.textContent = t.getAttribute('data-tip');
    tip.classList.add('on');
    const sr = screen.getBoundingClientRect();
    const tw = tip.offsetWidth;
    const x = Math.min(Math.max(e.clientX - sr.left - tw / 2, 8), sr.width - tw - 8);
    const y = e.clientY - sr.top - tip.offsetHeight - 14;
    tip.style.transform = `translate(${x}px, ${Math.max(8, y)}px)`;
  };
  body.addEventListener('pointermove', showTip);
  body.addEventListener('pointerdown', showTip);
  body.addEventListener('pointerleave', () => tip.classList.remove('on'));
  body.addEventListener('scroll', () => tip.classList.remove('on'), { passive: true });

  function render() {
    tip.classList.remove('on');
    const rs = d.rounds.filter((r) => r.op === op && r.speed).sort((a, b) => a.ts - b.ts);
    if (!rs.length) {
      body.replaceChildren(h('div.empty', {}, icon('tent', 40), h('span', {}, 'no rounds yet')));
      return;
    }
    if (!atts) { body.replaceChildren(); return; }
    const mine = atts.filter((a) => a.op === op);
    const W = Math.round(Math.min(body.clientWidth || window.innerWidth - 40, 600) - 32);

    body.replaceChildren(
      tiles(rs, mine),
      card('flag', 'altitude', altitudeChart(rs, W)),
      card('clock', 'seconds per problem', timeChart(rs, mine, W)),
      card('calendar', 'practice', calendar(mine, W)),
    );
  }

  function card(ic: string, title: string, content: Node) {
    return h('section.card', {}, h('h2', {}, icon(ic, 15), title), content);
  }

  function tiles(rs: Round[], mine: Attempt[]) {
    const solved = mine.filter((a) => a.correct).length;
    const minutes = mine.reduce((s, a) => s + a.ms, 0) / 60000;
    const best = Math.max(...rs.map((r) => r.score));
    const time = minutes >= 60 ? `${Math.floor(minutes / 60)}h ${Math.round(minutes % 60)}m` : `${Math.max(1, Math.round(minutes))}m`;
    const tile = (ic: string, value: string, label: string) =>
      h('div.tile', {}, h('div.v', {}, value), h('div.l', {}, icon(ic, 14), label));
    return h('div.tiles', {},
      tile('flag', `${fmtSigned(best)}`, 'best, m'),
      tile('again', fmtNum(rs.length), 'rounds'),
      tile('check', fmtNum(solved), 'solved'),
      tile('clock', time, 'practice'),
    );
  }

  function altitudeChart(all: Round[], W: number) {
    const rs = all.slice(-40);
    const H = 168;
    const top = 14;
    const bottom = 22;
    const left = 4;
    const hiV = Math.max(1500, ...rs.map((r) => r.score));
    const loV = Math.min(-1500, ...rs.map((r) => r.score));
    const span = hiV - loV || 1;
    const y = (v: number) => top + ((hiV - v) / span) * (H - top - bottom);
    const step = (W - left) / Math.max(rs.length, 12);
    const bw = Math.max(3, Math.min(14, step - 2));
    let g = '';
    // camp line + summit line when relevant
    g += `<line class="zero" x1="0" x2="${W}" y1="${y(0)}" y2="${y(0)}"/>`;
    g += `<text class="ax" x="${W}" y="${y(0) - 5}" text-anchor="end">0</text>`;
    if (hiV >= EVEREST * 0.7) {
      g += `<line class="summit" x1="0" x2="${W}" y1="${y(EVEREST)}" y2="${y(EVEREST)}"/>`;
      g += `<text class="ax" x="${W}" y="${y(EVEREST) - 5}" text-anchor="end">${fmtNum(EVEREST)}</text>`;
    }
    rs.forEach((r, i) => {
      const x = left + i * step + (step - bw) / 2;
      g += `<path class="${r.score >= 0 ? 'up' : 'down'}" d="${bar(x, y(0), y(r.score), bw)}"/>`;
      const tipText = `${fmtDate(r.ts)} · ${fmtSigned(r.score)} m · ${d.paceText(r.ratio)}`;
      g += `<rect class="hit" x="${left + i * step}" y="0" width="${step}" height="${H - bottom}" data-tip="${esc(tipText)}"/>`;
    });
    g += `<text class="ax" x="${left}" y="${H - 6}">${fmtDate(rs[0].ts)}</text>`;
    if (rs.length > 1) g += `<text class="ax" x="${left + (rs.length - 1) * step + step / 2}" y="${H - 6}" text-anchor="${rs.length > 6 ? 'end' : 'middle'}">${fmtDate(rs.at(-1)!.ts)}</text>`;
    return svg(W, H, g);
  }

  function timeChart(rs: Round[], mine: Attempt[], W: number) {
    const byRound = new Map<string, number[]>();
    for (const a of mine) if (a.correct) {
      let l = byRound.get(a.round);
      if (!l) byRound.set(a.round, (l = []));
      l.push(a.ms);
    }
    const modes: Mode[] = ['1', '2', '3', 'mix'];
    const counts = new Map(modes.map((m) => [m, rs.filter((r) => r.mode === m && byRound.has(r.id)).length]));
    if (!mode || !counts.get(mode)) mode = modes.reduce((a, b) => ((counts.get(b) ?? 0) > (counts.get(a) ?? 0) ? b : a));

    const slots = (n: number, mix = false) => h(`span.slots${mix ? '.mix' : ''}`, {}, ...Array.from({ length: n }, () => h('i')));
    const filter = h('div.modes', { role: 'radiogroup' }, ...modes.map((m) => {
      const b = h(`button.mchip${m === mode ? '.on' : ''}`, { role: 'radio', 'aria-label': m === 'mix' ? 'mixed' : `${m} digit`, disabled: !counts.get(m) },
        m === 'mix' ? slots(3, true) : slots(Number(m)));
      b.addEventListener('click', () => { if (mode !== m) { d.select(); mode = m; render(); } });
      return b;
    }));

    const pts = rs.filter((r) => r.mode === mode && byRound.has(r.id)).slice(-40)
      .map((r) => ({ ts: r.ts, ms: median(byRound.get(r.id)!), n: byRound.get(r.id)!.length }));

    const wrap = h('div', {}, filter);
    if (pts.length < 2) {
      wrap.append(h('div.note', {}, pts.length ? `${fmtSec(pts[0].ms)} · one round so far` : '—'));
      return wrap;
    }

    // headline: recent vs. early (median of up to 5 rounds each)
    const k = Math.min(5, Math.floor(pts.length / 2));
    const early = median(pts.slice(0, k).map((p) => p.ms));
    const late = median(pts.slice(-k).map((p) => p.ms));
    const change = (late / early - 1) * 100;
    wrap.append(h('div.hero', {},
      h('span.v', {}, fmtSec(late)),
      h('span.d', {}, `${change <= 0 ? '−' : '+'}${Math.abs(change).toFixed(1)}% since you started`)));

    const H = 150;
    const top = 12;
    const bottom = 22;
    const left = 34;
    const lo = Math.min(...pts.map((p) => p.ms)) * 0.9;
    const hi = Math.max(...pts.map((p) => p.ms)) * 1.08;
    const y = (v: number) => top + ((hi - v) / (hi - lo)) * (H - top - bottom);
    const step = (W - left - 8) / (pts.length - 1);
    const x = (i: number) => left + i * step;
    let g = '';
    for (const v of [lo + (hi - lo) * 0.15, (lo + hi) / 2, hi - (hi - lo) * 0.1]) {
      g += `<line class="grid" x1="${left}" x2="${W}" y1="${y(v)}" y2="${y(v)}"/>`;
      g += `<text class="ax" x="${left - 6}" y="${y(v) + 4}" text-anchor="end">${(v / 1000).toFixed(1)}</text>`;
    }
    g += `<path class="line" d="${pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.ms).toFixed(1)}`).join('')}"/>`;
    pts.forEach((p, i) => {
      g += `<circle class="dot" cx="${x(i)}" cy="${y(p.ms)}" r="4"/>`;
      const x0 = i ? (x(i - 1) + x(i)) / 2 : left - 8;
      const x1 = i < pts.length - 1 ? (x(i) + x(i + 1)) / 2 : W;
      g += `<rect class="hit" x="${x0}" y="0" width="${x1 - x0}" height="${H - bottom}" data-tip="${esc(`${fmtDate(p.ts)} · ${fmtSec(p.ms)} per problem · ${p.n} solved`)}"/>`;
    });
    g += `<text class="ax" x="${left}" y="${H - 6}">${fmtDate(pts[0].ts)}</text>`;
    g += `<text class="ax" x="${W - 8}" y="${H - 6}" text-anchor="end">${fmtDate(pts.at(-1)!.ts)}</text>`;
    wrap.append(svg(W, H, g));
    return wrap;
  }

  function calendar(mine: Attempt[], W: number) {
    const mins = new Map<string, number>();
    for (const a of mine) mins.set(dayKey(a.ts), (mins.get(dayKey(a.ts)) ?? 0) + a.ms / 60000);
    const gap = 3;
    const labelW = 0;
    // as many whole weeks as fit at ~22px cells, so the grid fills the card
    const weeks = Math.max(8, Math.floor((W - labelW + gap) / (22 + gap)));
    const cell = Math.floor((W - labelW - gap * (weeks - 1)) / weeks);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dow = (today.getDay() + 6) % 7; // Monday = 0
    const start = today.getTime() - (dow + (weeks - 1) * 7) * DAY;
    const levels = [0.5, 3, 8, 15]; // minutes thresholds
    let g = '';
    for (let w = 0; w < weeks; w++) for (let r = 0; r < 7; r++) {
      const ts = start + (w * 7 + r) * DAY;
      if (ts > today.getTime()) continue;
      const m = mins.get(dayKey(ts)) ?? 0;
      const lvl = m < levels[0] ? 0 : m < levels[1] ? 1 : m < levels[2] ? 2 : m < levels[3] ? 3 : 4;
      const x = labelW + w * (cell + gap);
      const yy = r * (cell + gap);
      const label = `${fmtDate(ts)} · ${m < 0.5 ? 'no practice' : `${Math.round(m)} min`}`;
      g += `<rect class="cell l${lvl}" x="${x}" y="${yy}" width="${cell}" height="${cell}" rx="4" data-tip="${esc(label)}"/>`;
    }
    const H = 7 * (cell + gap) - gap;
    const used = labelW + weeks * (cell + gap) - gap;
    const s = svg(used, H, g);
    const legend = h('div.legend', {}, h('span', {}, 'less'), ...[0, 1, 2, 3, 4].map((l) => h(`i.l${l}`)), h('span', {}, 'more'));
    return h('div', {}, s, legend);
  }

  render();
  let alive = true;
  void d.attempts().then((a) => { if (alive) { atts = a; render(); } });
  return { screen, cleanup: () => { alive = false; } };
}
