/** Fish generation: which species, how heavy. Pure functions of content + bonuses + an injected RNG. */
import { SPECIES } from './content';
import type { LocationDef, Rng, SpecialDef, SpeciesDef } from './types';

export interface Odds {
  speciesId: number;
  p: number;
}

/**
 * Species probabilities at a location. Same shape as the contract's _pickSpecies: every pool weight is scaled by
 * (100 + rarity × bonus), then the lot is normalised. So `rarityBonus: 40` makes a Rare fish 1.8× as heavy in the
 * draw relative to a Common, not 40 points likelier.
 */
export function speciesOdds(loc: LocationDef, rarityBonus: number, hiddenMult = 1): Odds[] {
  const eff = loc.pool.map(([id, w]) => {
    const s = SPECIES[id];
    return { speciesId: id, p: w * (100 + s.rarity * rarityBonus) * (s.hidden ? hiddenMult : 1) };
  });
  const total = eff.reduce((a, e) => a + e.p, 0);
  return eff.map((e) => ({ speciesId: e.speciesId, p: e.p / total }));
}

export function pickSpecies(odds: Odds[], rng: Rng): SpeciesDef {
  let x = rng();
  for (const o of odds) {
    if (x < o.p) return SPECIES[o.speciesId];
    x -= o.p;
  }
  return SPECIES[odds[odds.length - 1].speciesId];
}

/** min of two uniforms: small fish are common, trophies rare. The weight bonus scales the roll, capped at the species maximum. */
export function rollWeight(s: SpeciesDef, weightBonus: number, rng: Rng): number {
  const u = Math.min(rng(), rng());
  const w = (s.minWeight + (s.maxWeight - s.minWeight) * u) * (1 + weightBonus / 100);
  return Math.round(Math.min(s.maxWeight, w));
}

/**
 * Does this landed fish turn out to be the location's special? `dry` is the number of catches at eligible
 * locations since the last one; pity applies only until the special has been found once.
 */
export function rollSpecial(sp: SpecialDef | undefined, found: boolean, dry: number, rng: Rng): boolean {
  if (!sp) return false;
  if (!found && dry + 1 >= sp.pity) return true;
  return rng() < sp.chance;
}
