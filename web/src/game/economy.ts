/** Prices, XP and levels. */
import { QUALITY_MULT, TUNING, XP_BY_RARITY } from './content';
import type { Quality, SpeciesDef } from './types';

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/**
 * The species' mean weight. Weights are rolled as min + range·min(u1,u2) (same as the contract), whose mean is
 * a third of the way up the range.
 */
export const avgWeight = (s: SpeciesDef): number => s.minWeight + (s.maxWeight - s.minWeight) / 3;

export const weightRatio = (s: SpeciesDef, weight: number): number => weight / avgWeight(s);

/** price = basePrice × weightFactor × qualityMultiplier, at least 1 PEARL. */
export function fishPrice(s: SpeciesDef, weight: number, quality: Quality): number {
  const wf = clamp(weightRatio(s, weight), 0.4, 3);
  return Math.max(1, Math.round(s.basePrice * wf * QUALITY_MULT[quality]));
}

export const xpForCatch = (s: SpeciesDef): number => XP_BY_RARITY[s.rarity] ?? 10;

/** Total XP needed to reach `level` (level 1 = 0). */
export const xpForLevel = (level: number): number => 50 * level * (level - 1);

export function levelOf(xp: number): number {
  let l = 1;
  while (xpForLevel(l + 1) <= xp) l++;
  return l;
}

/** Full repair price of a rod from `durability`, in PEARL. `repairFactor` < 1 for rods that are cheap to mend. */
export function repairCost(price: number, max: number, durability: number, repairFactor = 1): number {
  if (max <= 0 || durability >= max) return 0;
  return Math.max(1, Math.ceil(price * TUNING.repairShare * repairFactor * ((max - durability) / max)));
}

export function refillCost(countToday: number): number {
  return TUNING.refillPrice * TUNING.refillGrowth ** countToday;
}
