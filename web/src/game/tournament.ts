/** Weekly Angler Championship: scoring, week boundaries, the best-ten rule and clearly labelled demo standings. */
import { QUALITY_MULT, RARITY_POINTS } from './content';
import { weightRatio } from './economy';
import type { Quality, SpeciesDef, WeekEntry } from './types';

export const WEEK_MS = 7 * 24 * 3600 * 1000;
export const COUNTED_CATCHES = 10;

/**
 * Week id: whole weeks since the Unix epoch, so weeks roll over on Thursday 00:00 UTC. This is the contract's
 * `currentWeek()` (block.timestamp / 1 weeks), so local weeks and onchain weeks will line up.
 */
export const weekId = (ms: number): number => Math.floor(ms / WEEK_MS);
export const weekStart = (id: number): number => id * WEEK_MS;
export const weekEnd = (id: number): number => (id + 1) * WEEK_MS;

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** score = rarityPoints × weightFactor (0.7–1.5) × qualityFactor. Fixed at the moment of the catch. */
export function tournamentScore(s: SpeciesDef, weight: number, quality: Quality): number {
  return Math.round(RARITY_POINTS[s.rarity] * clamp(weightRatio(s, weight), 0.7, 1.5) * QUALITY_MULT[quality]);
}

/** Adds a catch to a week's list and keeps the best ten. Returns a new array. */
export function addEntry(entries: WeekEntry[] | undefined, e: WeekEntry): WeekEntry[] {
  return [...(entries ?? []), e].sort((a, b) => b.score - a.score || a.at - b.at).slice(0, COUNTED_CATCHES);
}

export const weekTotal = (entries: WeekEntry[] | undefined): number => (entries ?? []).reduce((a, e) => a + e.score, 0);

// ------------------------------------------------------------------ demo standings

export interface Standing {
  name: string;
  total: number;
  /** True for generated opponents. They are a presentation aid, never real players. */
  demo: boolean;
  you?: boolean;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DEMO_NAMES = ['Old Pike', 'Mira', 'Reedwalker', 'Kolya', 'Saltbeard', 'Juniper', 'Tolya', 'Heron', 'Nessa', 'Bobber Bob', 'Yara', 'Quiet Ivan'];
/** Final weekly totals the demo anglers trend toward: from a first-week beginner to a late-game regular. */
const DEMO_FINALS = [5200, 3900, 3000, 2300, 1750, 1300, 950, 700, 500, 340, 220, 130];

/**
 * Generated opponents for the week, deterministic per week id. Their totals grow through the week, so the table
 * moves while you play. For presentation only: no rewards are settled against them.
 */
export function demoStandings(week: number, now: number): Standing[] {
  const rng = mulberry32(week * 7919 + 13);
  const progress = clamp((now - weekStart(week)) / WEEK_MS, 0, 1);
  return DEMO_NAMES.map((name, i) => {
    const final = DEMO_FINALS[i] * (0.85 + rng() * 0.3);
    const pace = 0.55 + rng() * 0.6; // some start fast, some finish late
    return { name, total: Math.round(final * progress ** pace), demo: true };
  });
}

/** Demo opponents plus you, sorted. Ties go to the player. */
export function standings(week: number, now: number, yourTotal: number): Standing[] {
  const rows: Standing[] = [...demoStandings(week, now), { name: 'You', total: yourTotal, demo: false, you: true }];
  return rows.sort((a, b) => b.total - a.total || (a.you ? -1 : 1));
}

export interface RewardTier {
  from: number;
  to: number;
  pearl: number;
  trophy?: boolean;
}

/** The planned prize table. Shown in the UI; not paid out while standings are local (see SETTLEMENT_ENABLED). */
export const WEEKLY_REWARDS: RewardTier[] = [
  { from: 1, to: 1, pearl: 1000, trophy: true },
  { from: 2, to: 3, pearl: 500 },
  { from: 4, to: 10, pearl: 200 },
  { from: 11, to: 50, pearl: 50 },
];

/** Cross-player rewards need a trusted backend. Until one exists nothing is paid for ranks. */
export const SETTLEMENT_ENABLED = false;

export const rewardFor = (rank: number): RewardTier | undefined => WEEKLY_REWARDS.find((t) => rank >= t.from && rank <= t.to);
