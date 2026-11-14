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
const ICONS: Record<string, [number, number, string]> = {
  lock: [7, 8, '2,0,3,1,#afb4b5;1,1,1,3,#afb4b5;5,1,1,3,#afb4b5;0,3,7,5,#b8a071;3,5,1,2,#15171a'],
  bolt: [5, 8, '2,0,3,1,#e2c47a;1,1,3,1,#e2c47a;0,2,3,1,#e2c47a;0,3,5,1,#e2c47a;2,4,2,1,#e2c47a;1,5,2,1,#e2c47a;1,6,1,1,#e2c47a;0,7,1,1,#e2c47a'],
  fish: [10, 6, '3,0,4,1,#5a6670;1,1,7,1,#5a6670;0,2,9,2,#5a6670;1,4,7,1,#5a6670;3,5,4,1,#5a6670;7,1,1,1,#afb4b5;9,1,1,4,#5a6670'],
  // a fish hook lying on its side: eye on the left, shank along the line, bend on the right, point and barb below
  hook: [8, 5, '0,1,7,1,#ecebe4;7,2,1,2,#ecebe4;4,4,3,1,#ecebe4;4,3,1,1,#ecebe4'],
  bobber: [5, 9, '2,0,1,2,#c9c6bc;1,2,3,1,#c2453b;0,3,5,2,#c2453b;1,3,1,1,#e7766a;0,5,5,2,#e6e4dc;1,7,3,1,#e6e4dc;2,8,1,1,#afb4b5'],
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
    el.setAttribute('fill', fill);
    svg.append(el);
  }
  return svg;
}
