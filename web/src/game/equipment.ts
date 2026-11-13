/** Combined tackle bonuses: one place where rod + lure + location + special-fish bonuses are added and capped. */
import { FLY_ROD_OFF_CURRENT, type TackleItem } from '../tackle/catalog';
import { TUNING } from './content';
import type { Effects, LocationDef, SpecialDef } from './types';

const ZERO: Effects = { catch: 0, rarity: 0, weight: 0 };
const sum = (a: Effects, b: Partial<Effects> | undefined): Effects =>
  b ? { catch: a.catch + (b.catch ?? 0), rarity: a.rarity + (b.rarity ?? 0), weight: a.weight + (b.weight ?? 0) } : a;

/** An item's own effects at a location: base, plus its location bonus where that applies. */
export function itemEffects(item: TackleItem | null | undefined, loc: LocationDef): Effects {
  if (!item) return ZERO;
  let e = sum(ZERO, item.base);
  if (item.spot?.spots.includes(loc.id)) e = sum(e, item.spot);
  if (item.id === FLY_ROD_OFF_CURRENT.rod && loc.water !== 'moving') e = sum(e, { catch: FLY_ROD_OFF_CURRENT.catch });
  return e;
}

export function specialEffects(sp: SpecialDef | null | undefined, loc: LocationDef): Effects {
  if (!sp?.bonus.effects) return ZERO;
  if (sp.bonus.locations && !sp.bonus.locations.includes(loc.id)) return ZERO;
  return sum(ZERO, sp.bonus.effects);
}

export interface Totals {
  rod: Effects;
  lure: Effects;
  special: Effects;
  /** rod + lure + special, capped. `catch` here is informational; see biteChance and zone for what it does. */
  total: Effects;
  /** Chance that a fish bites, %: base + the lure's catch. */
  biteChance: number;
  /** Reel catch-zone width, share of the bar: base + the rod's catch. */
  zone: number;
  /** Multiplier on hidden species' pool weights. */
  hiddenMult: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export function totals(rod: TackleItem, lure: TackleItem | null | undefined, loc: LocationDef, active?: SpecialDef | null): Totals {
  const r = itemEffects(rod, loc);
  const l = itemEffects(lure, loc);
  const s = specialEffects(active, loc);
  const raw = sum(sum(r, l), s);
  return {
    rod: r,
    lure: l,
    special: s,
    total: {
      catch: raw.catch,
      rarity: clamp(raw.rarity, 0, TUNING.maxRarityBonus),
      weight: clamp(raw.weight, 0, TUNING.maxWeightBonus),
    },
    biteChance: clamp(TUNING.baseBite + l.catch + s.catch, 5, TUNING.maxBite),
    zone: clamp(TUNING.baseZone + r.catch * TUNING.zonePerCatch, 0.12, TUNING.maxZone),
    hiddenMult: active?.bonus.hiddenMult ?? 1,
  };
}
