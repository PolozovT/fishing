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
  if (!src) return h('div', { class: `${cls} nft-img-placeholder`, text: '🐟' });
  return h('img', { class: cls, attrs: { src, alt, loading: 'lazy', decoding: 'async' } });
}

export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
