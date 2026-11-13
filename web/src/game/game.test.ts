import { describe, expect, it } from 'vitest';
import { LURES, RODS, lureById, rodById } from '../tackle/catalog';
import {
  GameError,
  buyLure,
  buyRod,
  claimAchievement,
  energyNow,
  hookFish,
  landFish,
  landPrize,
  refillEnergy,
  repairRod,
  sellFish,
  setActiveSpecial,
  setLocation,
  startCast,
  toggleFavorite,
  type CastTicket,
} from './actions';
import { BLEND_PRIZE, LOCATIONS, SPECIALS, SPECIES, TUNING } from './content';
import { avgWeight, fishPrice, levelOf, xpForLevel } from './economy';
import { totals } from './equipment';
import { rollSpecial, rollWeight, speciesOdds } from './generate';
import { qualityOf, reelParams, reelStart, reelStep } from './minigame';
import { achievements, canEnter, grantUnlocks, isUnlocked, unlockMet } from './progress';
import { SAVE_VERSION, freshSave, loadSave } from './save';
import { WEEK_MS, addEntry, demoStandings, standings, tournamentScore, weekId, weekStart, weekTotal } from './tournament';
import type { FishInstance, Save } from './types';

const NOW = Date.UTC(2026, 10, 13, 12);
const seeded = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
const rod = (id: string) => rodById(id)!;
const lure = (id: string) => lureById(id)!;
const fishOf = (over: Partial<FishInstance> = {}): FishInstance => ({
  id: 'x1',
  speciesId: 0,
  rarity: 0,
  weight: 200,
  quality: 'B',
  locationId: 0,
  caughtAt: NOW,
  sellPrice: 10,
  tournamentScore: 10,
  isFavorite: false,
  isSpecial: false,
  ...over,
});
const withFish = (s: Save, ...fish: FishInstance[]): Save => ({ ...s, fish });
/** Lands one fish of a given species through the real path. */
function land(s: Save, speciesId: number, locationId = 0, now = NOW, quality: 'B' | 'S' = 'B') {
  const ticket: CastTicket = { locationId, totals: totals(rod('willow'), null, LOCATIONS[locationId]) };
  const sp = SPECIES[speciesId];
  return landFish(s, ticket, { speciesId, weight: Math.round(avgWeight(sp)), isSpecial: !!sp.special }, quality, now);
}

describe('equipment bonuses', () => {
  it('adds rod + lure + location bonus', () => {
    const t = totals(rod('troller'), lure('jig'), LOCATIONS[3]);
    expect(t.rod).toEqual({ catch: 7, rarity: 30, weight: 20 });
    expect(t.lure).toEqual({ catch: 10, rarity: 15, weight: 0 });
    expect(t.total).toEqual({ catch: 17, rarity: 45, weight: 20 });
    expect(t.biteChance).toBe(TUNING.baseBite + 10);
    expect(t.zone).toBeCloseTo(TUNING.baseZone + 7 * TUNING.zonePerCatch);
  });
  it('applies location bonuses only at their locations', () => {
    expect(totals(rod('troller'), lure('jig'), LOCATIONS[0]).total).toEqual({ catch: 4, rarity: 0, weight: 8 });
    expect(totals(rod('flyrod'), lure('fly'), LOCATIONS[1]).total.rarity).toBe(40 + 60 + 40 + 70);
    expect(totals(rod('flyrod'), lure('fly'), LOCATIONS[0]).total.rarity).toBe(80);
  });
  it('penalises the fly rod away from moving water', () => {
    expect(totals(rod('flyrod'), null, LOCATIONS[0]).rod.catch).toBe(-4);
    expect(totals(rod('flyrod'), null, LOCATIONS[4]).rod.catch).toBe(4);
  });
  it('caps bite chance, zone, rarity and weight', () => {
    for (const r of RODS)
      for (const l of [null, ...LURES])
        for (const loc of LOCATIONS)
          for (const sp of [null, ...SPECIALS]) {
            const t = totals(r, l, loc, sp);
            expect(t.biteChance).toBeLessThanOrEqual(TUNING.maxBite);
            expect(t.zone).toBeLessThanOrEqual(TUNING.maxZone);
            expect(t.total.rarity).toBeLessThanOrEqual(TUNING.maxRarityBonus);
            expect(t.total.weight).toBeLessThanOrEqual(TUNING.maxWeightBonus);
          }
  });
  it('special bonus respects its location list', () => {
    const koi = SPECIALS[0];
    expect(totals(rod('willow'), null, LOCATIONS[5], koi).total.rarity).toBe(25);
    expect(totals(rod('willow'), null, LOCATIONS[0], koi).total.rarity).toBe(0);
  });
});

describe('rarity distribution', () => {
  it('is normalised for every location and bonus', () => {
    for (const loc of LOCATIONS)
      for (const bonus of [0, 40, 150, 300])
        for (const hm of [1, 3]) {
          const odds = speciesOdds(loc, bonus, hm);
          expect(odds.reduce((a, o) => a + o.p, 0)).toBeCloseTo(1, 10);
          odds.forEach((o) => expect(o.p).toBeGreaterThan(0));
        }
  });
  it('treats rarityBonus as a relative weighting, not percentage points', () => {
    const p = (bonus: number) => speciesOdds(LOCATIONS[0], bonus).find((o) => o.speciesId === 4)!.p; // Golden Carp, epic
    expect(p(0)).toBeCloseTo(8 / 1158, 6);
    expect(p(40)).toBeLessThan(0.02); // nowhere near +40 points
    expect(p(40)).toBeGreaterThan(p(0));
    expect(p(300)).toBeLessThan(0.06);
  });
  it('shifts mass toward rarer species monotonically', () => {
    const common = (bonus: number) => speciesOdds(LOCATIONS[3], bonus).find((o) => o.speciesId === 15)!.p;
    expect(common(150)).toBeLessThan(common(40));
    expect(common(40)).toBeLessThan(common(0));
  });
  it('hidden multiplier only lifts hidden species', () => {
    const a = speciesOdds(LOCATIONS[7], 0, 1);
    const b = speciesOdds(LOCATIONS[7], 0, 3);
    const hidden = (o: typeof a) => o.filter((x) => SPECIES[x.speciesId].hidden).reduce((s, x) => s + x.p, 0);
    expect(hidden(b)).toBeGreaterThan(hidden(a) * 2.5);
  });
});

describe('weight and price', () => {
  it('keeps weights inside the species range, bonus included', () => {
    const rng = seeded(1);
    for (const sp of SPECIES)
      for (let i = 0; i < 200; i++) {
        const w = rollWeight(sp, 60, rng);
        expect(w).toBeGreaterThanOrEqual(sp.minWeight);
        expect(w).toBeLessThanOrEqual(sp.maxWeight);
      }
  });
  it('price = base × weight factor × quality', () => {
    const pike = SPECIES[5];
    expect(fishPrice(pike, avgWeight(pike), 'B')).toBe(pike.basePrice);
    expect(fishPrice(pike, avgWeight(pike), 'S')).toBe(Math.round(pike.basePrice * 1.3));
    expect(fishPrice(pike, avgWeight(pike) * 2, 'B')).toBe(pike.basePrice * 2);
    expect(fishPrice(pike, avgWeight(pike) * 2, 'D')).toBe(Math.round(pike.basePrice * 2 * 0.8));
  });
  it('clamps the weight factor and never pays less than 1', () => {
    const tuna = SPECIES[19];
    expect(fishPrice(tuna, tuna.maxWeight * 10, 'B')).toBe(tuna.basePrice * 3);
    expect(fishPrice(SPECIES[0], 1, 'D')).toBeGreaterThanOrEqual(1);
  });
  it('levels follow the XP curve', () => {
    expect(levelOf(0)).toBe(1);
    expect(levelOf(xpForLevel(3) - 1)).toBe(2);
    expect(levelOf(xpForLevel(3))).toBe(3);
    expect(levelOf(xpForLevel(12))).toBe(12);
  });
});

describe('casting', () => {
  it('spends energy and fixes the bonuses on the ticket', () => {
    const s = freshSave(NOW);
    const { save, ticket } = startCast(s, NOW);
    expect(save.energy).toBe(TUNING.maxEnergy - 1);
    expect(save.stats.casts).toBe(1);
    expect(ticket.totals.biteChance).toBe(TUNING.baseBite);
  });
  it('refuses without energy and changes nothing', () => {
    const s = { ...freshSave(NOW), energy: 0 };
    expect(() => startCast(s, NOW)).toThrow(GameError);
  });
  it('regenerates energy over time, up to the cap', () => {
    const s = { ...freshSave(NOW), energy: 3, energyAt: NOW };
    expect(energyNow(s, NOW + TUNING.energyRegenSeconds * 1000 * 2 + 5)).toBe(5);
    expect(energyNow(s, NOW + 1e10)).toBe(TUNING.maxEnergy);
  });
  it('wears the rod and uses up the lure', () => {
    let s: Save = { ...freshSave(NOW), pearl: 10_000 };
    s = buyRod(s, 'carbon');
    s = buyLure(s, 'abyss');
    const casts = lure('abyss').wear;
    for (let i = 0; i < casts; i++) s = startCast({ ...s, energy: 20 }, NOW).save;
    expect(s.rods.carbon.durability).toBe(rod('carbon').wear - casts);
    expect(s.lures.abyss).toBeUndefined();
    expect(s.equipped.lure).toBeNull();
  });
  it('a worn-out rod cannot cast, the starter rod never wears out', () => {
    let s: Save = { ...freshSave(NOW), rods: { willow: { durability: 0 }, carbon: { durability: 0 } }, equipped: { rod: 'carbon', lure: null } };
    expect(() => startCast(s, NOW)).toThrow(/worn out/);
    s = { ...s, equipped: { rod: 'willow', lure: null } };
    expect(startCast(s, NOW).save.rods.willow.durability).toBe(0);
  });
});

describe('special fish and location unlocks', () => {
  it('pity guarantees the special before it is found, and only then', () => {
    const koi = SPECIALS[0];
    const never = () => 0.999;
    expect(rollSpecial(koi, false, koi.pity - 1, never)).toBe(true);
    expect(rollSpecial(koi, false, koi.pity - 2, never)).toBe(false);
    expect(rollSpecial(koi, true, koi.pity * 5, never)).toBe(false);
    expect(rollSpecial(undefined, false, 999, () => 0)).toBe(false);
  });
  it('catching the Golden Koi unlocks Golden Lake for good', () => {
    const s = freshSave(NOW);
    expect(isUnlocked(s, LOCATIONS[5])).toBe(false);
    const l = land(s, 20);
    expect(l.unlocked).toContain(5);
    expect(l.fish.isSpecial).toBe(true);
    expect(l.save.activeSpecial).toBe('koi');
    // selling it keeps the unlock but drops the passive bonus
    const sold = sellFish(l.save, [l.fish.id]).save;
    expect(isUnlocked(sold, LOCATIONS[5])).toBe(true);
    expect(canEnter(sold, LOCATIONS[5])).toBe(true);
    expect(sold.activeSpecial).toBeNull();
    expect(setLocation(sold, 5).location).toBe(5);
  });
  it('locked locations cannot be entered', () => {
    expect(() => setLocation(freshSave(NOW), 7)).toThrow(GameError);
  });
  it('an ownership requirement is checked separately from the permanent unlock', () => {
    const loc = { ...LOCATIONS[5], ownership: { special: 'koi' } };
    const l = land(freshSave(NOW), 20);
    expect(canEnter(l.save, loc)).toBe(true);
    const sold = sellFish(l.save, [l.fish.id]).save;
    expect(isUnlocked(sold, loc)).toBe(true);
    expect(canEnter(sold, loc)).toBe(false);
  });
  it('only one special bonus is active, and it needs a specimen in hand', () => {
    let s = land(freshSave(NOW), 20).save;
    s = land(s, 21, 2).save;
    expect(s.activeSpecial).toBe('koi');
    s = setActiveSpecial(s, 'catfish');
    expect(s.activeSpecial).toBe('catfish');
    expect(() => setActiveSpecial(s, 'ghost')).toThrow(GameError);
  });
  it('no progression deadlocks: every unlock fish lives somewhere reachable first', () => {
    // walk the unlock graph assuming levels/species counts come with play
    const open = new Set<number>([0]);
    const found = new Set<string>();
    for (let round = 0; round < 10; round++) {
      for (const l of LOCATIONS) if (open.has(l.id) && l.special) found.add(l.special);
      for (const l of LOCATIONS) {
        const u = l.unlock;
        if (u.type !== 'special' || found.has(u.special)) open.add(l.id);
      }
    }
    expect(open.size).toBe(LOCATIONS.length);
    // species-count gates are satisfiable from locations that open without them
    const deepLake = LOCATIONS[2].unlock;
    if (deepLake.type === 'species') {
      const reachable = new Set([...LOCATIONS[0].pool, ...LOCATIONS[1].pool].map(([id]) => id).filter((id) => !SPECIES[id].hidden));
      expect(reachable.size).toBeGreaterThanOrEqual(deepLake.count);
    }
  });
  it('level and species gates open through grantUnlocks', () => {
    let s: Save = { ...freshSave(NOW), xp: xpForLevel(3) };
    expect(unlockMet(LOCATIONS[1].unlock, s)).toBe(true);
    s = grantUnlocks(s).save;
    expect(s.permanentUnlocks).toContain(1);
    expect(grantUnlocks(s).gained).toEqual([]);
  });
  it('counts dry catches for pity and resets on the special', () => {
    let s = land(freshSave(NOW), 0).save;
    s = land(s, 1).save;
    expect(s.dry.koi).toBe(2);
    s = land(s, 20).save;
    expect(s.dry.koi).toBe(0);
  });
});

describe('landing a fish', () => {
  it('adds the fish, XP, encyclopedia entry, record and weekly score', () => {
    const l = land(freshSave(NOW), 5, 0, NOW, 'S');
    expect(l.save.fish).toHaveLength(1);
    expect(l.save.xp).toBe(20);
    expect(l.newSpecies).toBe(true);
    expect(l.save.dex[5]).toMatchObject({ count: 1, best: l.fish.weight });
    expect(l.save.records.overall?.weight).toBe(l.fish.weight);
    expect(l.save.weeks[weekId(NOW)]).toHaveLength(1);
    expect(l.fish.tournamentScore).toBe(Math.round(25 * 1.3));
  });
  it('hooks only species of the location', () => {
    const rng = seeded(7);
    const s = { ...freshSave(NOW), blendWins: BLEND_PRIZE.maxWins };
    for (const loc of LOCATIONS) {
      const ticket: CastTicket = { locationId: loc.id, totals: totals(rod('pearlmaster'), lure('abyss'), loc) };
      const allowed = new Set([...loc.pool.map(([id]) => id), ...SPECIALS.filter((x) => x.id === loc.special).map((x) => x.speciesId)]);
      for (let i = 0; i < 500; i++) expect(allowed.has(hookFish(s, ticket, rng).speciesId)).toBe(true);
    }
  });
  it('gives every fish a unique id', () => {
    let s = freshSave(NOW);
    for (let i = 0; i < 50; i++) s = land(s, i % 5).save;
    expect(new Set(s.fish.map((f) => f.id)).size).toBe(50);
  });
});

describe('BLEND prize', () => {
  const ticket: CastTicket = { locationId: 0, totals: totals(rod('willow'), null, LOCATIONS[0]) };
  it('turns up at its configured rate and never after the limit', () => {
    const rng = seeded(11);
    const s = freshSave(NOW);
    let hits = 0;
    const n = 200_000;
    for (let i = 0; i < n; i++) if (hookFish(s, ticket, rng).prize) hits++;
    expect(hits / n).toBeGreaterThan(BLEND_PRIZE.chance * 0.8);
    expect(hits / n).toBeLessThan(BLEND_PRIZE.chance * 1.2);
    const done = { ...s, blendWins: BLEND_PRIZE.maxWins };
    for (let i = 0; i < 20_000; i++) expect(hookFish(done, ticket, rng).prize).toBeUndefined();
  });
  it('credits the amount exactly once', () => {
    const hooked = hookFish(freshSave(NOW), ticket, () => 0);
    expect(hooked.prize).toBe(BLEND_PRIZE.amount);
    const s = landPrize(freshSave(NOW), hooked);
    expect(s.blend).toBe(BLEND_PRIZE.amount);
    expect(s.fish).toHaveLength(0);
    expect(() => landPrize(s, hooked)).toThrow(/already claimed/);
    expect(() => landFish(freshSave(NOW), ticket, hooked, 'B', NOW)).toThrow(GameError);
    expect(() => landPrize(freshSave(NOW), { speciesId: 0, weight: 100, isSpecial: false })).toThrow(GameError);
  });
  it('older saves without the BLEND fields load with a zero balance', () => {
    const old = freshSave(NOW) as unknown as Record<string, unknown>;
    delete old.blend;
    delete old.blendWins;
    const l = loadSave(JSON.stringify(old), NOW);
    expect(l.save.blend).toBe(0);
    expect(l.save.blendWins).toBe(0);
  });
});

describe('selling', () => {
  it('removes exactly the sold fish and pays once', () => {
    const s = withFish({ ...freshSave(NOW), pearl: 5 }, fishOf({ id: 'a', sellPrice: 10 }), fishOf({ id: 'b', sellPrice: 7 }), fishOf({ id: 'c', sellPrice: 3 }));
    const r = sellFish(s, ['a', 'c']);
    expect(r.earned).toBe(13);
    expect(r.save.pearl).toBe(18);
    expect(r.save.fish.map((f) => f.id)).toEqual(['b']);
    expect(() => sellFish(r.save, ['a'])).toThrow(GameError); // cannot be sold twice
    expect(s.pearl).toBe(5); // the input save is untouched
  });
  it('is all-or-nothing', () => {
    const s = withFish(freshSave(NOW), fishOf({ id: 'a' }));
    expect(() => sellFish(s, ['a', 'ghost'])).toThrow(GameError);
    expect(() => sellFish(s, ['a', 'a'])).toThrow(GameError);
    expect(() => sellFish(s, [])).toThrow(GameError);
    expect(s.fish).toHaveLength(1);
  });
  it('protects favourites and bulk-sold specials', () => {
    let s = withFish(freshSave(NOW), fishOf({ id: 'a' }), fishOf({ id: 'k', isSpecial: true, speciesId: 20 }));
    s = toggleFavorite(s, 'a');
    expect(() => sellFish(s, ['a'])).toThrow(/protected/);
    expect(() => sellFish(toggleFavorite(s, 'a'), ['a', 'k'])).toThrow(/one at a time/);
    expect(sellFish(s, ['k']).save.fish.map((f) => f.id)).toEqual(['a']);
  });
  it('keeps tournament points and the encyclopedia after a sale', () => {
    const l = land(freshSave(NOW), 5);
    const sold = sellFish(l.save, [l.fish.id]).save;
    expect(sold.fish).toHaveLength(0);
    expect(weekTotal(sold.weeks[weekId(NOW)])).toBe(l.fish.tournamentScore);
    expect(sold.dex[5].count).toBe(1);
  });
});

describe('purchases', () => {
  it('buying a rod subtracts the price once and equips it', () => {
    const s = buyRod({ ...freshSave(NOW), pearl: 500 }, 'carbon');
    expect(s.pearl).toBe(500 - rod('carbon').price);
    expect(s.equipped.rod).toBe('carbon');
    expect(() => buyRod(s, 'carbon')).toThrow(/already own/);
  });
  it('refuses when PEARL is short', () => {
    const s = { ...freshSave(NOW), pearl: 10 };
    expect(() => buyRod(s, 'carbon')).toThrow(/Not enough/);
    expect(() => buyLure(s, 'spoon')).toThrow(/Not enough/);
    expect(s.pearl).toBe(10);
  });
  it('buying a lure again tops up its casts', () => {
    let s: Save = { ...freshSave(NOW), pearl: 1000 };
    s = buyLure(s, 'spoon');
    s = buyLure(s, 'spoon');
    expect(s.lures.spoon.casts).toBe(lure('spoon').wear * 2);
    expect(s.pearl).toBe(1000 - lure('spoon').price * 2);
    expect(s.equipped.lure).toBe('spoon');
  });
  it('repair restores durability for a proportional price', () => {
    let s: Save = { ...freshSave(NOW), pearl: 1000, rods: { willow: { durability: 0 }, carbon: { durability: 40 } } };
    const before = s.pearl;
    s = repairRod(s, 'carbon');
    expect(s.rods.carbon.durability).toBe(80);
    expect(before - s.pearl).toBe(Math.ceil(450 * TUNING.repairShare * 0.5));
    expect(() => repairRod(s, 'carbon')).toThrow(GameError);
  });
  it('energy refill doubles in price within a day and resets the next day', () => {
    let s: Save = { ...freshSave(NOW), pearl: 10_000, energy: 0 };
    s = refillEnergy(s, NOW);
    expect(s.pearl).toBe(10_000 - 100);
    expect(() => refillEnergy(s, NOW)).toThrow(/full/);
    s = refillEnergy({ ...s, energy: 0 }, NOW + 1000);
    expect(s.pearl).toBe(10_000 - 300);
    s = refillEnergy({ ...s, energy: 0, energyAt: NOW + 86_400_000 }, NOW + 86_400_000);
    expect(s.pearl).toBe(10_000 - 400);
  });
  it('achievement rewards are paid once', () => {
    let s = freshSave(NOW);
    for (const [id] of LOCATIONS[0].pool) s = land(s, id).save;
    const a = achievements(s).find((x) => x.id === 'loc:0')!;
    expect(a.done).toBe(true);
    const r = claimAchievement(s, 'loc:0');
    expect(r.save.pearl).toBe(a.reward);
    expect(() => claimAchievement(r.save, 'loc:0')).toThrow(/Already/);
    expect(() => claimAchievement(s, 'loc:7')).toThrow(/Not completed/);
  });
});

describe('tournament', () => {
  it('score = rarity points × clamped weight factor × quality', () => {
    const taimen = SPECIES[9];
    expect(tournamentScore(taimen, avgWeight(taimen), 'B')).toBe(400);
    expect(tournamentScore(taimen, taimen.maxWeight, 'S')).toBe(Math.round(400 * 1.5 * 1.3));
    expect(tournamentScore(taimen, taimen.minWeight, 'D')).toBe(Math.round(400 * 0.7 * 0.8));
    expect(tournamentScore(SPECIES[22], avgWeight(SPECIES[22]), 'B')).toBe(800);
  });
  it('counts only the ten best catches of the week', () => {
    let list = undefined as ReturnType<typeof addEntry> | undefined;
    for (let i = 1; i <= 25; i++) list = addEntry(list, { score: i, speciesId: 0, weight: 1, quality: 'B', at: i });
    expect(list).toHaveLength(10);
    expect(weekTotal(list)).toBe(16 + 17 + 18 + 19 + 20 + 21 + 22 + 23 + 24 + 25);
  });
  it('weeks roll over on a fixed UTC boundary (Thursday 00:00, as in the contract)', () => {
    const thu = Date.UTC(2026, 10, 12, 0, 0, 0);
    expect(new Date(thu).getUTCDay()).toBe(4);
    expect(weekId(thu)).toBe(weekId(thu - 1) + 1);
    expect(weekId(thu + WEEK_MS - 1)).toBe(weekId(thu));
    expect(weekStart(weekId(thu))).toBe(thu);
  });
  it('a new week starts empty and the old one is kept', () => {
    let s = land(freshSave(NOW), 5).save;
    s = land(s, 5, 0, NOW + WEEK_MS).save;
    expect(Object.keys(s.weeks)).toHaveLength(2);
    expect(s.weeks[weekId(NOW)]).toHaveLength(1);
    expect(s.weeks[weekId(NOW + WEEK_MS)]).toHaveLength(1);
  });
  it('demo standings are deterministic, labelled, and grow through the week', () => {
    const w = weekId(NOW);
    expect(demoStandings(w, NOW)).toEqual(demoStandings(w, NOW));
    expect(demoStandings(w, NOW).every((r) => r.demo)).toBe(true);
    const early = demoStandings(w, weekStart(w) + 3600_000).reduce((a, r) => a + r.total, 0);
    const late = demoStandings(w, weekStart(w) + WEEK_MS - 1).reduce((a, r) => a + r.total, 0);
    expect(late).toBeGreaterThan(early);
    const table = standings(w, NOW, 1e9);
    expect(table[0]).toMatchObject({ you: true, demo: false });
  });
});

describe('reel mini-game', () => {
  it('lands when tension is kept in the green, and loses the fish on a slack line', () => {
    const p = reelParams(0, 0.2);
    const rng = seeded(3);
    let s = reelStart(rng);
    while (s.result === 'fighting') s = reelStep(s, s.tension < (p.green[0] + p.green[1]) / 2, 1 / 60, p, rng);
    expect(s.result).toBe('landed');
    let idle = reelStart(seeded(4));
    const r2 = seeded(4);
    for (let i = 0; i < 60 * 120 && idle.result === 'fighting'; i++) idle = reelStep(idle, false, 1 / 60, p, r2);
    expect(idle).toMatchObject({ result: 'escaped', lost: 'slack' });
  });
  it('snaps the line when the player never lets go', () => {
    const p = reelParams(2, 0.2);
    const rng = seeded(5);
    let s = reelStart(rng);
    for (let i = 0; i < 60 * 120 && s.result === 'fighting'; i++) s = reelStep(s, true, 1 / 60, p, rng);
    expect(s).toMatchObject({ result: 'escaped', lost: 'snapped' });
  });
  it('a better rod widens the green band', () => {
    const a = reelParams(0, 0.2).green;
    const b = reelParams(0, 0.3).green;
    expect(b[1] - b[0]).toBeGreaterThan(a[1] - a[0]);
  });
  it('grades quality by accuracy', () => {
    expect(qualityOf(0.95)).toBe('S');
    expect(qualityOf(0.8)).toBe('A');
    expect(qualityOf(0.7)).toBe('B');
    expect(qualityOf(0.55)).toBe('C');
    expect(qualityOf(0.2)).toBe('D');
  });
});

describe('save and migrations', () => {
  it('starts fresh when nothing is stored', () => {
    const l = loadSave(null, NOW);
    expect(l.status).toBe('fresh');
    expect(l.save.version).toBe(SAVE_VERSION);
    expect(l.save.rods.willow).toBeDefined();
  });
  it('round-trips a save', () => {
    const s = land({ ...freshSave(NOW), pearl: 77 }, 5).save;
    const l = loadSave(JSON.stringify(s), NOW + 5);
    expect(l.status).toBe('ok');
    expect(l.save).toEqual(s);
  });
  it('runs migrations in order and keeps progress', () => {
    const v1 = JSON.stringify({ version: 1, coins: 40, xp: 300, fish: [] });
    const migrations = {
      1: (o: Record<string, unknown>) => ({ ...o, pearl: (o.coins as number) * 10, coins: undefined }),
      2: (o: Record<string, unknown>) => ({ ...o, pearl: (o.pearl as number) + 1 }),
    };
    const l = loadSave(v1, NOW, migrations, 3);
    expect(l.status).toBe('migrated');
    expect(l.save.version).toBe(3);
    expect(l.save.pearl).toBe(401);
    expect(l.save.xp).toBe(300);
    expect(l.save.stats.casts).toBe(0); // missing fields are filled from the fresh shape
  });
  it('never overwrites saves it cannot read', () => {
    expect(loadSave('{not json', NOW).status).toBe('corrupt');
    expect(loadSave('[]', NOW).status).toBe('corrupt');
    expect(loadSave(JSON.stringify({ version: SAVE_VERSION + 1 }), NOW).status).toBe('newer');
    expect(loadSave(JSON.stringify({ version: 1 }), NOW, {}, 2).status).toBe('corrupt'); // a missing step
  });
});
