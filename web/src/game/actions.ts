/**
 * Every change to a Save, as pure functions: (save, input) → new save. They validate first and throw GameError
 * without touching anything, so a sale or a purchase either happens completely or not at all. The caller swaps
 * the whole save in one assignment (play/state.ts), which is what makes PEARL move exactly once.
 */
import { LURES, RODS, lureById, rodById } from '../tackle/catalog';
import { BLEND_PRIZE, LOCATIONS, PEARL_PER_BLEND, SPECIES, TUNING, special } from './content';
import { fishPrice, levelOf, refillCost, repairCost, xpForCatch } from './economy';
import { totals, type Totals } from './equipment';
import { pickSpecies, rollSpecial, rollWeight, speciesOdds } from './generate';
import { achievements, canEnter, grantUnlocks, holdsSpecial } from './progress';
import { addEntry, tournamentScore, weekId } from './tournament';
import type { CatchRecord, FishInstance, Quality, Rng, Save } from './types';

export class GameError extends Error {}
const fail = (m: string): never => {
  throw new GameError(m);
};

// ------------------------------------------------------------------ energy

export function energyNow(s: Save, now: number): number {
  if (s.energy >= TUNING.maxEnergy) return s.energy;
  const gained = Math.floor(Math.max(0, now - s.energyAt) / 1000 / TUNING.energyRegenSeconds);
  return Math.min(TUNING.maxEnergy, s.energy + gained);
}

/** Seconds until the next point of energy, or 0 when full. */
export function energyCountdown(s: Save, now: number): number {
  if (energyNow(s, now) >= TUNING.maxEnergy) return 0;
  const period = TUNING.energyRegenSeconds * 1000;
  return Math.ceil((period - ((now - s.energyAt) % period)) / 1000);
}

function settleEnergy(s: Save, now: number): Save {
  const e = energyNow(s, now);
  if (e >= TUNING.maxEnergy) return { ...s, energy: e, energyAt: now };
  const period = TUNING.energyRegenSeconds * 1000;
  // keep the partial progress toward the next point
  return { ...s, energy: e, energyAt: now - ((now - s.energyAt) % period) };
}

const utcDay = (now: number): number => Math.floor(now / 86_400_000);
export const refillsToday = (s: Save, now: number): number => (s.refills.day === utcDay(now) ? s.refills.count : 0);
export const refillPrice = (s: Save, now: number): number => refillCost(refillsToday(s, now));

export function refillEnergy(s: Save, now: number): Save {
  if (energyNow(s, now) >= TUNING.maxEnergy) fail('Energy is already full');
  const price = refillPrice(s, now);
  if (s.pearl < price) fail('Not enough PEARL');
  return { ...s, pearl: s.pearl - price, energy: TUNING.maxEnergy, energyAt: now, refills: { day: utcDay(now), count: refillsToday(s, now) + 1 } };
}

// ------------------------------------------------------------------ BLEND → PEARL

/** Buys PEARL for BLEND at the fixed rate. One way only; the PEARL spends like any other. */
export function buyPearl(s: Save, blendAmount: number): { save: Save; pearl: number } {
  if (!Number.isFinite(blendAmount) || blendAmount <= 0) fail('Enter an amount of BLEND');
  if (s.blend < blendAmount) fail('Not enough BLEND');
  const out = blendAmount * PEARL_PER_BLEND;
  return { save: { ...s, blend: s.blend - blendAmount, pearl: s.pearl + out }, pearl: out };
}

// ------------------------------------------------------------------ tackle

export const activeSpecialOf = (s: Save) => (s.activeSpecial && holdsSpecial(s, s.activeSpecial) ? special(s.activeSpecial) ?? null : null);

export function currentTotals(s: Save, locationId = s.location): Totals {
  const rod = rodById(s.equipped.rod) ?? RODS[0];
  return totals(rod, lureById(s.equipped.lure), LOCATIONS[locationId], activeSpecialOf(s));
}

export function buyRod(s: Save, id: string): Save {
  const rod = rodById(id) ?? fail('Unknown rod');
  if (s.rods[id]) fail('You already own this rod');
  if (s.pearl < rod.price) fail('Not enough PEARL');
  return { ...s, pearl: s.pearl - rod.price, rods: { ...s.rods, [id]: { durability: rod.wear } }, equipped: { ...s.equipped, rod: id } };
}

/** Buying a lure you already carry tops its casts up. */
export function buyLure(s: Save, id: string): Save {
  const lure = lureById(id) ?? fail('Unknown lure');
  if (s.pearl < lure.price) fail('Not enough PEARL');
  const casts = (s.lures[id]?.casts ?? 0) + lure.wear;
  return { ...s, pearl: s.pearl - lure.price, lures: { ...s.lures, [id]: { casts } }, equipped: { ...s.equipped, lure: s.equipped.lure ?? id } };
}

export function equipRod(s: Save, id: string): Save {
  if (!s.rods[id]) fail('You do not own this rod');
  return { ...s, equipped: { ...s.equipped, rod: id } };
}

export function equipLure(s: Save, id: string | null): Save {
  if (id !== null && !s.lures[id]) fail('You do not own this lure');
  return { ...s, equipped: { ...s.equipped, lure: id } };
}

export function rodRepairPrice(s: Save, id: string): number {
  const rod = rodById(id);
  const own = s.rods[id];
  if (!rod || !own) return 0;
  return repairCost(rod.price, rod.wear, own.durability, rod.repairFactor);
}

export function repairRod(s: Save, id: string): Save {
  const rod = rodById(id) ?? fail('Unknown rod');
  if (!s.rods[id]) fail('You do not own this rod');
  const price = rodRepairPrice(s, id);
  if (price === 0) fail('Rod is already in full condition');
  if (s.pearl < price) fail('Not enough PEARL');
  return { ...s, pearl: s.pearl - price, rods: { ...s.rods, [id]: { durability: rod.wear } } };
}

export const rodBroken = (s: Save, id: string): boolean => {
  const rod = rodById(id);
  return !!rod && rod.wear > 0 && (s.rods[id]?.durability ?? 0) <= 0;
};

// ------------------------------------------------------------------ fishing

export function setLocation(s: Save, id: number): Save {
  const loc = LOCATIONS[id] ?? fail('Unknown location');
  if (!canEnter(s, loc)) fail('This location is locked');
  return { ...s, location: id };
}

/** Why a cast cannot start right now, or null. */
export function castBlocker(s: Save, now: number): string | null {
  const loc = LOCATIONS[s.location];
  if (!loc || !canEnter(s, loc)) return 'This location is locked';
  if (!s.rods[s.equipped.rod]) return 'No rod equipped';
  if (rodBroken(s, s.equipped.rod)) return 'Rod is worn out: repair it or switch rods';
  if (energyNow(s, now) < loc.energyCost) return 'Not enough energy';
  return null;
}

export interface CastTicket {
  locationId: number;
  totals: Totals;
}

/**
 * Starts a cast: spends energy, one point of rod durability and one lure cast. The bonuses are fixed here, so
 * changing tackle mid-cast cannot affect the fish already on its way. A worn-out lure still works for this cast.
 */
export function startCast(s: Save, now: number): { save: Save; ticket: CastTicket } {
  const why = castBlocker(s, now);
  if (why) fail(why);
  const loc = LOCATIONS[s.location];
  const ticket: CastTicket = { locationId: loc.id, totals: currentTotals(s) };
  let n = settleEnergy(s, now);
  n = { ...n, energy: n.energy - loc.energyCost, stats: { ...n.stats, casts: n.stats.casts + 1 } };
  if (n.energy + loc.energyCost >= TUNING.maxEnergy) n.energyAt = now; // regen clock starts when we drop below max
  const rod = rodById(n.equipped.rod)!;
  if (rod.wear > 0) n.rods = { ...n.rods, [rod.id]: { durability: n.rods[rod.id].durability - 1 } };
  const lureId = n.equipped.lure;
  if (lureId && n.lures[lureId]) {
    const left = n.lures[lureId].casts - 1;
    const lures = { ...n.lures };
    if (left <= 0) {
      delete lures[lureId];
      n.equipped = { ...n.equipped, lure: null };
    } else lures[lureId] = { casts: left };
    n.lures = lures;
  }
  return { save: n, ticket };
}

export const rollBite = (t: CastTicket, rng: Rng): boolean => rng() * 100 < t.totals.biteChance;

export function recordEscape(s: Save): Save {
  return { ...s, stats: { ...s.stats, escaped: s.stats.escaped + 1 } };
}

export interface Landing {
  save: Save;
  fish: FishInstance;
  newSpecies: boolean;
  newBest: boolean;
  newOverallRecord: boolean;
  levelUp: number | null;
  unlocked: number[];
  countedThisWeek: boolean;
}

/** The fish that was hooked: decided when it bites, so the fight can match it (rarer fish fight harder). */
export interface Hooked {
  speciesId: number;
  weight: number;
  isSpecial: boolean;
  /** Set when the hook holds the BLEND bottle instead of a fish: the amount inside. */
  prize?: number;
}

export const blendPrizeAvailable = (s: Save): boolean => s.blendWins < BLEND_PRIZE.maxWins;

export function hookFish(s: Save, t: CastTicket, rng: Rng): Hooked {
  const loc = LOCATIONS[t.locationId];
  if (blendPrizeAvailable(s) && rng() < BLEND_PRIZE.chance) return { speciesId: -1, weight: 0, isSpecial: false, prize: BLEND_PRIZE.amount };
  const sp = loc.special ? special(loc.special) : undefined;
  if (sp && rollSpecial(sp, s.specialsFound.includes(sp.id), s.dry[sp.id] ?? 0, rng)) {
    return { speciesId: sp.speciesId, weight: rollWeight(SPECIES[sp.speciesId], t.totals.total.weight, rng), isSpecial: true };
  }
  const species = pickSpecies(speciesOdds(loc, t.totals.total.rarity, t.totals.hiddenMult), rng);
  return { speciesId: species.id, weight: rollWeight(species, t.totals.total.weight, rng), isSpecial: false };
}

/** Lands the BLEND bottle: credits the amount once. Throws if this hook holds no prize or the limit is reached. */
export function landPrize(s: Save, hooked: Hooked): Save {
  if (!hooked.prize) fail('No prize on the hook');
  if (!blendPrizeAvailable(s)) fail('The BLEND prize was already claimed');
  return { ...s, blend: s.blend + hooked.prize!, blendWins: s.blendWins + 1 };
}

/** Lands a hooked fish: creates the instance and applies XP, encyclopedia, records, weekly score and unlocks. */
export function landFish(s: Save, t: CastTicket, hooked: Hooked, quality: Quality, now: number): Landing {
  if (hooked.prize) fail('This is a prize, not a fish');
  const species = SPECIES[hooked.speciesId];
  const fish: FishInstance = {
    id: `f${s.seq + 1}-${now.toString(36)}`,
    speciesId: species.id,
    rarity: species.rarity,
    weight: hooked.weight,
    quality,
    locationId: t.locationId,
    caughtAt: now,
    sellPrice: fishPrice(species, hooked.weight, quality),
    tournamentScore: tournamentScore(species, hooked.weight, quality),
    isFavorite: false,
    isSpecial: hooked.isSpecial,
  };
  const levelBefore = levelOf(s.xp);
  const prev = s.dex[species.id];
  const rec: CatchRecord = { speciesId: species.id, weight: fish.weight, locationId: t.locationId, at: now };
  const overall = !s.records.overall || fish.weight > s.records.overall.weight;
  const locBest = s.records.byLocation[t.locationId];
  const week = weekId(now);
  const weekList = addEntry(s.weeks[week], { score: fish.tournamentScore, speciesId: species.id, weight: fish.weight, quality, at: now });

  // pity counters: every landed fish at a location carrying a special is a dry catch for it, unless it is the special
  const dry = { ...s.dry };
  const locSpecial = LOCATIONS[t.locationId].special;
  if (locSpecial) dry[locSpecial] = hooked.isSpecial ? 0 : (dry[locSpecial] ?? 0) + 1;

  let n: Save = {
    ...s,
    seq: s.seq + 1,
    xp: s.xp + xpForCatch(species),
    fish: [fish, ...s.fish],
    dex: { ...s.dex, [species.id]: { count: (prev?.count ?? 0) + 1, best: Math.max(prev?.best ?? 0, fish.weight), firstAt: prev?.firstAt ?? now } },
    dry,
    specialsFound: species.special && !s.specialsFound.includes(species.special) ? [...s.specialsFound, species.special] : s.specialsFound,
    records: {
      overall: overall ? rec : s.records.overall,
      byLocation: !locBest || fish.weight > locBest.weight ? { ...s.records.byLocation, [t.locationId]: rec } : s.records.byLocation,
    },
    weeks: { ...s.weeks, [week]: weekList },
    stats: { ...s.stats, catches: s.stats.catches + 1 },
  };
  // the first special found takes the empty bonus slot
  if (species.special && !n.activeSpecial) n.activeSpecial = species.special;
  const g = grantUnlocks(n);
  n = g.save;
  const levelAfter = levelOf(n.xp);
  return {
    save: n,
    fish,
    newSpecies: !prev,
    newBest: !!prev && fish.weight > prev.best,
    newOverallRecord: overall && !!s.records.overall,
    levelUp: levelAfter > levelBefore ? levelAfter : null,
    unlocked: g.gained,
    countedThisWeek: weekList.some((e) => e.at === now && e.score === fish.tournamentScore),
  };
}

// ------------------------------------------------------------------ keepnet

export const isValuable = (f: FishInstance): boolean => f.sellPrice >= TUNING.valuablePrice || f.rarity >= 3;
/** Bulk selling skips favourites and specials. */
export const bulkSellable = (f: FishInstance): boolean => !f.isFavorite && !f.isSpecial;

/**
 * Sells exactly the given fish. All-or-nothing: an unknown id, a duplicate, or a favourite aborts the whole sale.
 * Tournament points and encyclopedia entries stay. Specials can be sold only one at a time (`ids.length === 1`).
 */
export function sellFish(s: Save, ids: string[]): { save: Save; earned: number } {
  if (ids.length === 0) fail('Nothing selected');
  const set = new Set(ids);
  if (set.size !== ids.length) fail('Duplicate fish in the sale');
  const sold = s.fish.filter((f) => set.has(f.id));
  if (sold.length !== ids.length) fail('Some of these fish are no longer in the keepnet');
  if (sold.some((f) => f.isFavorite)) fail('Favourites are protected: remove the star first');
  if (ids.length > 1 && sold.some((f) => f.isSpecial)) fail('Special fish can only be sold one at a time');
  const earned = sold.reduce((a, f) => a + f.sellPrice, 0);
  let n: Save = {
    ...s,
    pearl: s.pearl + earned,
    fish: s.fish.filter((f) => !set.has(f.id)),
    stats: { ...s.stats, sold: s.stats.sold + sold.length, earned: s.stats.earned + earned },
  };
  // the passive bonus needs a specimen in hand; the location unlock does not
  if (n.activeSpecial && !holdsSpecial(n, n.activeSpecial)) n = { ...n, activeSpecial: null };
  return { save: n, earned };
}

export function toggleFavorite(s: Save, id: string): Save {
  if (!s.fish.some((f) => f.id === id)) fail('Fish not found');
  return { ...s, fish: s.fish.map((f) => (f.id === id ? { ...f, isFavorite: !f.isFavorite } : f)) };
}

/** One bonus slot: picking another special replaces the current one. */
export function setActiveSpecial(s: Save, id: string | null): Save {
  if (id !== null && !holdsSpecial(s, id)) fail('You need to hold this fish to use its bonus');
  return { ...s, activeSpecial: id };
}

/** Pays an achievement reward once. Claiming twice, or early, throws and changes nothing. */
export function claimAchievement(s: Save, id: string): { save: Save; reward: number } {
  const a = achievements(s).find((x) => x.id === id) ?? fail('Unknown achievement');
  if (!a.done) fail('Not completed yet');
  if (a.claimed) fail('Already claimed');
  return { save: { ...s, pearl: s.pearl + a.reward, claimed: [...s.claimed, id] }, reward: a.reward };
}

export { LURES, RODS };
