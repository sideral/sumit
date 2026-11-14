/* Tiny DOM helper: h('div.a.b', {props}, ...children) */
export type Child = Node | string | number | false | null | undefined;
export function h<K extends keyof HTMLElementTagNameMap>(sel: K | `${K}.${string}`, props: Record<string, unknown> = {}, ...kids: Child[]) {
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

