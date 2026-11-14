const P: Record<string, string> = {
  sliders: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  back: '<path d="M15 18l-6-6 6-6"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  del: '<path d="M20 5H9l-7 7 7 7h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Z"/><path d="m18 9-6 6M12 9l6 6"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  play: '<path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5Z" fill="currentColor" stroke="none"/>',
  shuffle: '<path d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22"/><path d="m18 2 4 4-4 4"/><path d="M2 6h1.9c1.5 0 2.9.9 3.6 2.2"/><path d="M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8"/><path d="m18 14 4 4-4 4"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  auto: '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18Z" fill="currentColor"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5M12 15V3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5M12 3v12"/>',
  trash: '<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  again: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1Z"/>',
  flag: '<path d="M5 22V4"/><path d="M5 4h13l-2.5 4.5L18 13H5" fill="currentColor" fill-opacity=".9"/>',
  tent: '<path d="M3.5 21 14 3"/><path d="M20.5 21 10 3"/><path d="M15.5 21 12 15l-3.5 6"/><path d="M2 21h20"/>',
  vol: '<path d="M11 4.7a.7.7 0 0 0-1.2-.5L6.4 7.6A1.4 1.4 0 0 1 5.4 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.4a1.4 1.4 0 0 1 1 .4l3.4 3.4a.7.7 0 0 0 1.2-.5Z"/><path d="M16 9a5 5 0 0 1 0 6"/><path d="M19.4 18.4a9 9 0 0 0 0-12.8"/>',
  mute: '<path d="M11 4.7a.7.7 0 0 0-1.2-.5L6.4 7.6A1.4 1.4 0 0 1 5.4 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.4a1.4 1.4 0 0 1 1 .4l3.4 3.4a.7.7 0 0 0 1.2-.5Z"/><path d="m22 9-6 6M16 9l6 6"/>',
  stats: '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M8 17v-5M13 17V8M18 17v-3"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  data: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.66 3.58 3 8 3s8-1.34 8-3V5"/><path d="M4 12c0 1.66 3.58 3 8 3s8-1.34 8-3"/>',
};

export function icon(name: keyof typeof P | string, size = 24) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('width', String(size));
  s.setAttribute('height', String(size));
  s.setAttribute('fill', 'none');
  s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '2');
  s.setAttribute('stroke-linecap', 'round');
  s.setAttribute('stroke-linejoin', 'round');
  s.setAttribute('aria-hidden', 'true');
  s.classList.add('i');
  s.innerHTML = P[name] ?? '';
  return s;
}

/** Pie showing minutes as a fraction of 5. */
export function pie(min: number, size = 22) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('width', String(size));
  s.setAttribute('height', String(size));
  s.classList.add('i');
  const f = Math.min(min / 5, 1);
  let inner: string;
  if (f >= 1) inner = '<circle cx="12" cy="12" r="8" fill="currentColor"/>';
  else {
    const ang = f * 2 * Math.PI - Math.PI / 2;
    const x = 12 + 8 * Math.cos(ang);
    const y = 12 + 8 * Math.sin(ang);
    inner = `<path d="M12 12V4A8 8 0 ${f > 0.5 ? 1 : 0} 1 ${x.toFixed(2)} ${y.toFixed(2)}Z" fill="currentColor"/>`;
  }
  s.innerHTML = `<circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2" opacity=".35"/>${inner}`;
  return s;
}

/** The SumIt peak. */
export function logo(cls = 'logo') {
  const d = document.createElement('div');
  d.className = cls;
  d.innerHTML = `<svg viewBox="0 -12 160 120" aria-hidden="true">
    <path class="l-back" d="M4 106 54 44l22 26 26-38 54 74Z"/>
    <path class="l-peak" d="M22 106 84 12l62 94Z"/>
    <path class="l-snow" d="M84 12 101 38l-10-4-7 8-8-9-9 5Z"/>
    <path class="l-shade" d="M84 12 146 106H108L96 70l-6 10Z"/>
    <g class="l-flag"><path d="M84 13V-6" class="l-pole"/><path d="M84 -6l15 5-15 5Z" class="l-cloth"/></g>
  </svg>`;
  return d;
}

/** Layered ridge silhouettes for backgrounds. */
export function ridges() {
  const d = document.createElement('div');
  d.className = 'ridges';
  d.innerHTML = `<svg viewBox="0 0 400 140" preserveAspectRatio="none" aria-hidden="true">
    <path class="r1" d="M0 70 40 46l30 18 46-40 38 30 30-14 44 34 40-46 52 38 34-20 46 30v84H0Z"/>
    <path class="r2" d="M0 96l52-30 34 20 40-24 54 36 36-18 40 22 48-34 42 26 54-22v88H0Z"/>
    <path class="r3" d="M0 120l66-24 44 14 52-20 48 26 42-12 56 18 50-20 42 14v44H0Z"/>
  </svg>`;
  return d;
}
