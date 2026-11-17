import { formatEther, type Address } from 'viem';

type Child = Node | string | number | null | undefined | false;
type Props = {
  class?: string;
  text?: string;
  title?: string;
  disabled?: boolean;
  onclick?: (e: MouseEvent) => void;
  oninput?: (e: Event) => void;
  onchange?: (e: Event) => void;
  attrs?: Record<string, string>;
  style?: string;
};

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props | null = null,
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    if (props.class) el.className = props.class;
    if (props.text !== undefined) el.textContent = props.text;
    if (props.title) el.title = props.title;
    if (props.style) el.setAttribute('style', props.style);
    if (props.disabled !== undefined && 'disabled' in el) (el as HTMLButtonElement).disabled = props.disabled;
    if (props.onclick) el.addEventListener('click', props.onclick as EventListener);
    if (props.oninput) el.addEventListener('input', props.oninput);
    if (props.onchange) el.addEventListener('change', props.onchange);
    if (props.attrs) for (const [k, v] of Object.entries(props.attrs)) el.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

/** Re-render `el` only when the signature changes (keeps focus/inputs stable across block ticks). */
export function mount(el: HTMLElement, sig: () => string, render: () => Child | Child[]): () => void {
  let last = '\u0000';
  return () => {
    const s = sig();
    if (s === last) return;
    last = s;
    const out = render();
    el.replaceChildren(...(Array.isArray(out) ? out : [out]).filter((c): c is Node | string => !!c || c === '').map((c) => (typeof c === 'number' ? String(c) : c)));
  };
}

export const big = (_k: string, v: unknown): unknown => (typeof v === 'bigint' ? v.toString() : v);
export const sigOf = (...parts: unknown[]): string => JSON.stringify(parts, big);

export const shortAddr = (a: Address | string): string => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function fmtToken(v: bigint, digits = 2): string {
  const n = Number(formatEther(v));
  if (n !== 0 && Math.abs(n) < 0.01) return n.toPrecision(2);
  return n.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

export function fmtWeight(grams: number): string {
  if (grams < 1000) return `${grams} g`;
  return `${(grams / 1000).toLocaleString('en-US', { maximumFractionDigits: 2 })} kg`;
}

export function fmtCountdown(sec: number): string {
  sec = Math.max(0, Math.floor(sec));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function img(src: string | undefined, alt: string, cls = 'nft-img'): HTMLElement {
  if (!src) {
    const ph = h('div', { class: `${cls} nft-img-placeholder` });
    ph.append(icon('fish', 'Fish'));
    return ph;
  }
  return h('img', { class: cls, attrs: { src, alt, loading: 'lazy', decoding: 'async' } });
}

export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

/** Segmented pixel bar: `segs` blocks, lit in proportion to value/max (at least one lit while value > 0). */
export function segBar(value: number, max: number, segs: number, cls = ''): HTMLElement {
  const on = value <= 0 ? 0 : Math.max(1, Math.min(segs, Math.round((value / Math.max(1, max)) * segs)));
  return h(
    'span',
    { class: `segbar ${cls}`, attrs: { role: 'meter', 'aria-valuemin': '0', 'aria-valuemax': String(max), 'aria-valuenow': String(value) } },
    Array.from({ length: segs }, (_, i) => h('span', { class: i < on ? 'seg on' : 'seg' })),
  );
}

// Tiny pixel icons drawn as rects (crispEdges). Each entry: [viewBox w, h, rects "x,y,w,h,color;..."]
// A colour is a hex value or the name of a theme variable ("--muted"), so icons follow the time of day.
const ICONS: Record<string, [number, number, string]> = {
  lock: [7, 8, '2,0,3,1,--muted;1,1,1,3,--muted;5,1,1,3,--muted;0,3,7,5,--accent;3,5,1,2,--ink'],
  bolt: [5, 8, '2,0,3,1,--en;1,1,3,1,--en;0,2,3,1,--en;0,3,5,1,--en;2,4,2,1,--en;1,5,2,1,--en;1,6,1,1,--en;0,7,1,1,--en'],
  fish: [10, 6, '3,0,4,1,--dim;1,1,7,1,--dim;0,2,9,2,--dim;1,4,7,1,--dim;3,5,4,1,--dim;7,1,1,1,--panel;9,1,1,4,--dim'],
  // a fish hook lying on its side: eye on the left, shank along the line, bend on the right, point and barb below
  hook: [8, 5, '0,1,7,1,--text;7,2,1,2,--text;4,4,3,1,--text;4,3,1,1,--text'],
  bobber: [5, 9, '2,0,1,2,--muted;1,2,3,1,#c2453b;0,3,5,2,#c2453b;1,3,1,1,#e7766a;0,5,5,2,#e6e4dc;1,7,3,1,#e6e4dc;2,8,1,1,--muted'],
  // time of day (9×9): the sun on the horizon, high sun, low red sun, crescent moon
  morning: [9, 9, '4,0,1,1,#e9b949;1,2,1,1,#e9b949;7,2,1,1,#e9b949;3,3,3,1,#f2cf6b;2,4,5,2,#f2cf6b;0,6,9,1,--muted;2,8,5,1,--dim'],
  day: [9, 9, '4,0,1,1,#e3a92b;4,8,1,1,#e3a92b;0,4,1,1,#e3a92b;8,4,1,1,#e3a92b;1,1,1,1,#e3a92b;7,1,1,1,#e3a92b;1,7,1,1,#e3a92b;7,7,1,1,#e3a92b;3,2,3,1,#f0bd3a;2,3,5,3,#f0bd3a;3,6,3,1,#f0bd3a'],
  evening: [9, 9, '3,3,3,1,#e2703f;2,4,5,2,#e2703f;0,6,9,1,--muted;1,8,3,1,#e2703f;5,8,3,1,#e2703f'],
  night: [9, 9, '3,0,3,1,--text-2;2,1,2,1,--text-2;1,2,2,5,--text-2;2,7,2,1,--text-2;3,8,3,1,--text-2;6,7,1,1,--text-2;7,1,1,1,--dim;6,3,1,1,--dim'],
};

export function icon(name: keyof typeof ICONS, label?: string): SVGSVGElement {
  const [w, hgt, rects] = ICONS[name];
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${hgt}`);
  svg.setAttribute('width', String(w * 2));
  svg.setAttribute('height', String(hgt * 2));
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.setAttribute('class', `pxi pxi-${name}`);
  if (label) svg.setAttribute('aria-label', label);
  else svg.setAttribute('aria-hidden', 'true');
  for (const r of rects.split(';')) {
    const [x, y, rw, rh, fill] = r.split(',');
    const el = document.createElementNS(ns, 'rect');
    el.setAttribute('x', x);
    el.setAttribute('y', y);
    el.setAttribute('width', rw);
    el.setAttribute('height', rh);
    if (fill.startsWith('--')) el.style.fill = `var(${fill})`;
    else el.setAttribute('fill', fill);
    svg.append(el);
  }
  return svg;
}
