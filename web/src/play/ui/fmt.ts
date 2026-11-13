import { RARITY_CLASS, RARITY_NAMES } from '../../i18n';
import { h } from '../../ui/dom';
import type { Quality } from '../../game/types';

export const pearl = (n: number): string => Math.round(n).toLocaleString('en-US');

export const rarityTag = (r: number): HTMLElement => h('span', { class: `rarity ${RARITY_CLASS[r]}`, text: RARITY_NAMES[r] ?? '' });

const QUALITY_TITLE: Record<Quality, string> = {
  S: 'Perfect fight: ×1.3 price and score',
  A: 'Great fight: ×1.15 price and score',
  B: 'Good fight: base price and score',
  C: 'Rough fight: ×0.9 price and score',
  D: 'Barely landed: ×0.8 price and score',
};
export const qualityTag = (q: Quality): HTMLElement => h('span', { class: `qual q-${q}`, text: q, title: `Quality ${q}. ${QUALITY_TITLE[q]}` });

export function ago(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.floor((now - ms) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86_400)} d ago`;
}

export function duration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86_400);
  const hh = Math.floor((s % 86_400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${hh}h`;
  if (hh > 0) return `${hh}h ${m}m`;
  return `${m}m ${s % 60}s`;
}
