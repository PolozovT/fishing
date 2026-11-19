/**
 * Balance simulation: `pnpm sim`. Plays the real game rules (same functions the UI calls) with a bot at the reel,
 * and writes BALANCE.md. Not part of `pnpm test`.
 */
import { writeFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { LURES, RODS, type TackleItem } from '../src/tackle/catalog';
import { buyLure, buyRod, hookFish, landFish, rodRepairPrice, repairRod, sellFish, startCast, rollBite, type CastTicket } from '../src/game/actions';
import { LOCATIONS, QUALITIES, SPECIALS, SPECIES, TUNING } from '../src/game/content';
import { fishPrice, levelOf } from '../src/game/economy';
import { totals } from '../src/game/equipment';
import { speciesOdds } from '../src/game/generate';
import { SKILLS, difficultyOf, reelParams, simulateFight, type Difficulty } from '../src/game/minigame';
import { canEnter } from '../src/game/progress';
import { freshSave } from '../src/game/save';
import { demoStandings, tournamentScore, weekId, weekStart, weekTotal, WEEK_MS } from '../src/game/tournament';
import type { Quality, Rarity, Save } from '../src/game/types';

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

const N = 100_000;
/** Energy a day of somebody who plays six full bars. */
const CASUAL_ENERGY = 120;
const RARITY = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Mythic'];
const pct = (x: number, d = 1): string => `${(x * 100).toFixed(d)}%`;
const table = (head: string[], rows: (string | number)[][]): string =>
  [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');

interface FightStats {
  land: number;
  q: Record<Quality, number>;
  seconds: number;
}
const fightCache = new Map<string, FightStats>();
/** Landing rate and quality mix of the bot for a rarity and zone width (2,000 fights, cached). */
type SkillName = keyof typeof SKILLS;
/** Landing rate and quality mix of a model player for a difficulty and zone width (2,000 fights, cached). */
function fightStats(d: Difficulty, zone: number, skill: SkillName): FightStats {
  const key = `${d}:${zone.toFixed(3)}:${skill}`;
  const hit = fightCache.get(key);
  if (hit) return hit;
  const rng = mulberry32(d * 1000 + Math.round(zone * 1000) + skill.length);
  const q: Record<Quality, number> = { D: 0, C: 0, B: 0, A: 0, S: 0 };
  let land = 0;
  let seconds = 0;
  const n = 2000;
  for (let i = 0; i < n; i++) {
    const f = simulateFight(reelParams(d, zone), rng, SKILLS[skill]);
    if (f.landed) seconds += f.seconds;
    if (f.landed) {
      land++;
      q[f.quality]++;
    }
  }
  for (const k of QUALITIES) q[k] /= Math.max(1, land);
  const out = { land: land / n, q, seconds: seconds / Math.max(1, land) };
  fightCache.set(key, out);
  return out;
}
function sampleFight(rarity: Rarity, tier: number, zone: number, rng: () => number, skill: SkillName = 'experienced'): Quality | null {
  const st = fightStats(difficultyOf(rarity, tier), zone, skill);
  if (rng() >= st.land) return null;
  let x = rng();
  for (const k of QUALITIES) {
    if (x < st.q[k]) return k;
    x -= st.q[k];
  }
  return 'B';
}

interface Combo {
  pearlPerCast: number;
  pearlPerEnergy: number;
  scorePerCatch: number;
  rarity: number[];
  special: number;
  landRate: number;
}
/** N casts with one loadout at one location. Specials roll at their base chance (no pity). */
function runCombo(rod: TackleItem, lure: TackleItem | null, locId: number, seed: number, n = N): Combo {
  const rng = mulberry32(seed);
  const loc = LOCATIONS[locId];
  const ticket: CastTicket = { locationId: locId, totals: totals(rod, lure, loc) };
  const s: Save = { ...freshSave(0), blendWins: 99, specialsFound: SPECIALS.map((x) => x.id) };
  let pearl = 0;
  let score = 0;
  let landed = 0;
  let special = 0;
  const rarity = [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < n; i++) {
    if (!rollBite(ticket, rng)) continue;
    const h = hookFish(s, ticket, rng);
    const sp = SPECIES[h.speciesId];
    const q = sampleFight(sp.rarity, loc.tier, ticket.totals.zone, rng);
    if (!q) continue;
    landed++;
    rarity[sp.rarity]++;
    if (h.isSpecial) special++;
    pearl += fishPrice(sp, h.weight, q);
    score += tournamentScore(sp, h.weight, q);
  }
  const wearCost = (lure ? lure.price / lure.wear : 0) + (rod.wear ? (rod.price * TUNING.repairShare * (rod.repairFactor ?? 1)) / rod.wear : 0);
  const net = pearl / n - wearCost;
  return { pearlPerCast: net, pearlPerEnergy: net / loc.energyCost, scorePerCatch: score / Math.max(1, landed), rarity: rarity.map((r) => r / Math.max(1, landed)), special: special / Math.max(1, landed), landRate: landed / n };
}

/** A whole career: a bot that fishes the best open water, sells everything but specials, and buys upgrades. */
function career(seed: number, skill: SkillName, maxCasts: number) {
  const rng = mulberry32(seed);
  let s: Save = { ...freshSave(0), blendWins: 99 };
  const now = 1000;
  const marks: Record<string, number> = {};
  /** Energy spent when each milestone was reached: energy, not casts, is what a day of play is made of. */
  const energyAt: Record<string, number> = {};
  let energy = 0;
  const mark = (k: string): void => {
    marks[k] ??= s.stats.casts;
    energyAt[k] ??= energy;
  };
  const wishlist: [string, 'rod' | 'lure'][] = [
    ['spoon', 'lure'],
    ['carbon', 'rod'],
    ['spinner', 'lure'],
    ['flyrod', 'rod'],
    ['fly', 'lure'],
    ['troller', 'rod'],
    ['jig', 'lure'],
    ['pearlmaster', 'rod'],
    ['abyss', 'lure'],
  ];
  const evOf = (id: number): number => LOCATIONS[id].pool.reduce((a, [sid, w]) => a + SPECIES[sid].basePrice * w, 0) / LOCATIONS[id].pool.reduce((a, [, w]) => a + w, 0) / LOCATIONS[id].energyCost;
  let earnedAt1000 = 0;
  while (s.stats.casts < maxCasts) {
    // pick the open location with the best value per energy; hunt a missing special where it lives
    const open = LOCATIONS.filter((l) => canEnter(s, l));
    const hunting = open.filter((l) => l.special && !s.specialsFound.includes(l.special));
    const best = [...open].sort((a, b) => evOf(b.id) - evOf(a.id))[0];
    const target = hunting.length && rng() < 0.5 ? hunting.sort((a, b) => evOf(b.id) - evOf(a.id))[0] : best;
    s = { ...s, location: target.id, energy: TUNING.maxEnergy };
    if (rodRepairPrice(s, s.equipped.rod) > 0 && s.rods[s.equipped.rod].durability <= 0) {
      if (s.pearl >= rodRepairPrice(s, s.equipped.rod)) s = repairRod(s, s.equipped.rod);
      else s = { ...s, equipped: { ...s.equipped, rod: 'willow' } };
    }
    const c = startCast(s, now);
    s = c.save;
    energy += target.energyCost;
    if (rollBite(c.ticket, rng)) {
      const h = hookFish(s, c.ticket, rng);
      const q = sampleFight(SPECIES[h.speciesId].rarity, LOCATIONS[c.ticket.locationId].tier, c.ticket.totals.zone, rng, skill);
      if (q) {
        const l = landFish(s, c.ticket, h, q, now + s.stats.casts);
        s = l.save;
        if (!l.fish.isSpecial) s = sellFish(s, [l.fish.id], now + s.stats.casts).save;
        for (const id of l.unlocked) mark(`unlock:${LOCATIONS[id].name}`);
        if (l.fish.isSpecial) mark(`special:${SPECIES[l.fish.speciesId].name}`);
        for (const lv of [3, 8, 12]) if (levelOf(s.xp) >= lv) mark(`level ${lv}`);
      }
    }
    for (const [id, kind] of wishlist) {
      if (kind === 'rod' && !s.rods[id] && s.pearl >= RODS.find((r) => r.id === id)!.price) {
        s = buyRod(s, id);
        mark(`buy:${id}`);
      }
      if (kind === 'lure' && !s.lures[id] && !s.equipped.lure && s.pearl >= LURES.find((r) => r.id === id)!.price * 2) {
        s = buyLure(s, id);
        mark(`buy:${id}`);
      }
    }
    if (s.stats.casts === 1000) earnedAt1000 = s.stats.earned;
  }
  return { marks, energyAt, save: s, earnedAt1000 };
}

const FINDINGS = `## Findings

What the first runs showed, and what was changed because of it. The tables below are the state after those changes.

- **Rarity odds hold up.** Bonuses are a relative weighting, so even the strongest rarity build (+250) moves Legendary fish from 2.4% to 3.7% at Taimen Rapids and from 0.5% to 1.7% at sea. No loadout makes rare fish common.
- **Tackle was bought in a day.** With the first numbers a player bought the best rod after ~170 casts; the second pass (XP curve doubled to 50·L·(L−1), the new waters' fish repriced, Pearl Master at 25,000) made it ~500 casts, which is still one day of energy for somebody who never lets the bar fill up. The third pass raised the prices alone, what fish pay is unchanged: Carbon Spinner 450 → 1,500, Ironwood 900 → 4,000, Taiga Fly Rod 2,500 → 12,000, Deep Troller 4,000 → 30,000, Pearl Master 25,000 → 150,000, lures about 1.6× (Abyss Spoon 2×). The first rod is still a first-day purchase; every later one is a goal of days or weeks (see "Progression in days"). A full set is 197,500 PEARL, or 1,975 BLEND at the exchange for somebody who would rather not wait.
- **Pearl Master was the best rod everywhere.** It is now a generalist (catch 4, rarity 50, weight 6): close to the top in every water but beaten by the specialist at home. Carbon Spinner wins the pond and river, Taiga Fly Rod the rapids, Deep Troller deep water, Ironwood the lake and swamp. Six different best loadouts across eight locations.
- **Rod upkeep punished expensive rods.** Repair at 20% of the price per full bar made the Fly Rod lose money against the free starter. Repair went to 6% of the price, and to 1.5% when the prices went up, so upkeep per cast stayed about where it was (2.6 PEARL a cast for the Fly Rod, 9 for the Deep Troller, 19 for the Pearl Master).
- **Copper Spinner was the best lure everywhere** (rarity 30 for 1.5 PEARL a cast). Its base rarity is 15 now, with the extra moved into its Forest River bonus.
- **The reel fight.** A bot could not lose the first two versions, so skill meant nothing. The current fight has jerks: a short warning, then a burst that raises tension by itself. A line that is let go at the warning never snaps (tested for every difficulty), so every loss is a missed reaction, not bad luck. How hard a fish fights is its rarity plus how rough the water is. The players below are models (reaction lag, aim error, chance of missing a warning), not measurements: read the rates as estimates to check by hand. Against the targets, calm water is a little easier than asked for the novice (97–99% vs 85–95%), rough water is in range for the novice except Taimen Rapids (too hard) and easier than asked for the experienced player. On the contracts a lost fight is a retry, not a lost fish, so these rates there mean time, not value.
- **Progression has no dead ends.** All 40 simulated careers of both skill levels opened all eight locations. Pity (120 / 160 / 220 dry catches) caps the worst case for each special fish.
- **Tournament.** Ten counted catches blunt raw volume: with mid and late tackle, 20× the casts give 3–5× the score. A beginner on the pond gains more from volume (12×), because their top ten starts out all Common. After 200 casts a new player on the starter rod is 9th of 13 against the demo field. Where you can fish matters more than what you hold: at Taimen Rapids the best tackle scores about 30% more than the starter rod. An equipment-restricted Starter Cup would only need a second scoring list filtered by rod tier; the score function takes no equipment input.

Known soft spots: Abyss Spoon never pays for itself in PEARL (it is the tournament and collection lure by design), and Golden Lake pays better per energy than Deep Lake although it can open earlier, as a reward for finding the Koi.`;

it('balance simulation', () => {
  const out: string[] = ['# Balance simulation', '', FINDINGS, '', `Generated by \`pnpm sim\` from the real game rules (src/game). ${N.toLocaleString('en-US')} casts per row unless noted. The reel is played by two model players: "experienced" reacts in 0.18 s and misses 4% of the warnings, "novice" reacts in 0.32 s with twice the aim error and misses 20%.`, ''];

  // 1. the reel
  out.push('## Reel fight: landing rate, quality and length', '', 'By difficulty level (fish rarity + water roughness, 0–5), starter rod. Quality is S/A/B/C/D share of landed fish.', '');
  const widest = Math.max(...RODS.flatMap((r) => LOCATIONS.map((l) => totals(r, null, l).zone)));
  const qmix = (f: FightStats): string => ['S', 'A', 'B', 'C', 'D'].map((k) => Math.round(f.q[k as Quality] * 100)).join('/');
  out.push(
    table(
      ['Difficulty', 'Experienced lands', 'Novice lands', 'Experienced quality', 'Seconds', `Novice with the best rod zone (${pct(widest, 0)})`],
      [0, 1, 2, 3, 4, 5].map((d) => {
        const e = fightStats(d as Difficulty, TUNING.baseZone, 'experienced');
        const nv = fightStats(d as Difficulty, TUNING.baseZone, 'novice');
        return [d, pct(e.land, 0), pct(nv.land, 0), qmix(e), e.seconds.toFixed(1), pct(fightStats(d as Difficulty, widest, 'novice').land, 0)];
      }),
    ),
    '',
  );
  out.push('By location (species mix with no rarity bonus), starter rod, against the targets set for manual testing.', '');
  out.push(
    table(
      ['Location', 'Water', 'Experienced lands', 'Novice lands', 'Seconds', 'Target (novice / experienced / seconds)'],
      LOCATIONS.map((loc) => {
        let e = 0;
        let nv = 0;
        let sec = 0;
        for (const o of speciesOdds(loc, 0)) {
          const d = difficultyOf(SPECIES[o.speciesId].rarity, loc.tier);
          e += o.p * fightStats(d, TUNING.baseZone, 'experienced').land;
          nv += o.p * fightStats(d, TUNING.baseZone, 'novice').land;
          sec += o.p * fightStats(d, TUNING.baseZone, 'experienced').seconds;
        }
        return [loc.name, ['calm', 'choppy', 'rough'][loc.tier], pct(e, 0), pct(nv, 0), sec.toFixed(1), loc.tier >= 2 ? '45–65% / 75–90% / 8–15 s' : loc.tier === 0 ? '85–95% / 95–99% / 5–8 s' : 'in between'];
      }),
    ),
    '',
  );

  // 2. rarity odds
  out.push('## Species odds: starter tackle vs the strongest rarity build', '', 'Share of landed fish by rarity (analytic, before the reel). "Max" is the highest rarity bonus any rod + lure reaches at that location.', '');
  const rows: (string | number)[][] = [];
  for (const loc of LOCATIONS) {
    let maxBonus = 0;
    for (const r of RODS) for (const l of [null, ...LURES]) maxBonus = Math.max(maxBonus, totals(r, l, loc).total.rarity);
    const by = (bonus: number): string => {
      const acc = [0, 0, 0, 0, 0, 0];
      for (const o of speciesOdds(loc, bonus)) acc[SPECIES[o.speciesId].rarity] += o.p;
      return acc.slice(0, 5).map((x) => pct(x)).join(' / ');
    };
    rows.push([loc.name, by(0), `+${maxBonus}`, by(maxBonus)]);
  }
  out.push(table(['Location', 'C / U / R / E / L, no bonus', 'max bonus', 'C / U / R / E / L, max'], rows), '');

  // 3. every loadout at every location
  out.push('## Net PEARL per cast by loadout', '', 'After lure wear and rod repair costs. Best rod + lure per location, the starter rod alone, and where each rod ranks.', '');
  const bestRows: (string | number)[][] = [];
  const wins = new Map<string, number>();
  let seed = 1;
  const allNets: { loc: number; rod: string; lure: string; net: number; score: number }[] = [];
  for (const loc of LOCATIONS) {
    const res: { rod: TackleItem; lure: TackleItem | null; c: Combo }[] = [];
    for (const r of RODS) for (const l of [null, ...LURES]) res.push({ rod: r, lure: l, c: runCombo(r, l, loc.id, seed++, 20_000) });
    res.sort((a, b) => b.c.pearlPerCast - a.c.pearlPerCast);
    res.forEach((x) => allNets.push({ loc: loc.id, rod: x.rod.id, lure: x.lure?.id ?? '-', net: x.c.pearlPerCast, score: x.c.scorePerCatch }));
    const base = res.find((x) => x.rod.id === 'willow' && !x.lure)!;
    const top = res[0];
    const k = `${top.rod.name} + ${top.lure?.name ?? 'no lure'}`;
    wins.set(k, (wins.get(k) ?? 0) + 1);
    const byScore = [...res].sort((a, b) => b.c.scorePerCatch - a.c.scorePerCatch)[0];
    bestRows.push([
      loc.name,
      loc.energyCost,
      base.c.pearlPerCast.toFixed(1),
      k,
      top.c.pearlPerCast.toFixed(1),
      `${(top.c.pearlPerCast / Math.max(0.01, base.c.pearlPerCast)).toFixed(1)}×`,
      `${res[1].rod.name} + ${res[1].lure?.name ?? 'no lure'} (${res[1].c.pearlPerCast.toFixed(1)})`,
      `${byScore.rod.name} + ${byScore.lure?.name ?? 'no lure'}`,
    ]);
  }
  out.push(table(['Location', 'Energy', 'Starter', 'Best for PEARL', 'Net/cast', 'vs starter', 'Runner-up', 'Best tournament score per catch'], bestRows), '');
  out.push(`Distinct best loadouts across ${LOCATIONS.length} locations: ${wins.size}.`, '');

  // 4. 100k catches for headline loadouts
  out.push('## 100,000 casts with headline loadouts', '');
  const headline: [string, string | null, number][] = [
    ['willow', null, 0],
    ['carbon', 'spoon', 0],
    ['flyrod', 'fly', 1],
    ['troller', 'jig', 3],
    ['pearlmaster', 'abyss', 4],
    ['pearlmaster', 'abyss', 7],
  ];
  out.push(
    table(
      ['Loadout', 'Location', 'Landed', 'C / U / R / E / L / M', 'Special', 'Net PEARL/cast', 'Score/catch'],
      headline.map(([r, l, loc], i) => {
        const rod = RODS.find((x) => x.id === r)!;
        const lure = LURES.find((x) => x.id === l) ?? null;
        const c = runCombo(rod, lure, loc, 900 + i);
        return [`${rod.name} + ${lure?.name ?? 'no lure'}`, LOCATIONS[loc].name, pct(c.landRate, 0), c.rarity.map((x) => pct(x)).join(' / '), pct(c.special, 2), c.pearlPerCast.toFixed(1), c.scorePerCatch.toFixed(0)];
      }),
    ),
    '',
  );

  // 5. careers
  out.push('## Progression: casts until each milestone', '', 'Median of 40 simulated careers (20,000 casts each). The bot sells every ordinary fish and buys tackle in a fixed order.', '');
  const keys = ['buy:spoon', 'level 3', 'buy:carbon', 'unlock:Deep Lake', 'special:Golden Koi', 'level 8', 'buy:flyrod', 'buy:troller', 'special:Ancient Catfish', 'level 12', 'buy:pearlmaster', 'special:Ghost Fish'];
  const med = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const runs = { experienced: [] as ReturnType<typeof career>[], novice: [] as ReturnType<typeof career>[] };
  for (let i = 0; i < 40; i++) {
    runs.experienced.push(career(5000 + i, 'experienced', 20_000));
    runs.novice.push(career(7000 + i, 'novice', 20_000));
  }
  const cell = (rs: ReturnType<typeof career>[], k: string): string => {
    const got = rs.map((r) => r.marks[k]).filter((x) => x !== undefined);
    if (got.length < rs.length / 2) return `never in ${rs.length - got.length}/${rs.length}`;
    return `${med(got)} (worst ${Math.max(...got)})`;
  };
  out.push(table(['Milestone', 'Experienced player', 'Novice'], keys.map((k) => [k, cell(runs.experienced, k), cell(runs.novice, k)])), '');
  // the same careers in days: a cast costs 1–4 energy, and energy is what a day gives
  const buys = ['buy:carbon', 'buy:flyrod', 'buy:troller', 'buy:pearlmaster'];
  const perDay = Math.round(86_400 / TUNING.energyRegenSeconds);
  const energyCell = (rs: ReturnType<typeof career>[], k: string): number | null => {
    const got = rs.map((r) => r.energyAt[k]).filter((x) => x !== undefined);
    return got.length < rs.length / 2 ? null : med(got);
  };
  const days = (e: number | null, daily: number): string => (e === null ? 'never' : e / daily < 1 ? 'day 1' : `day ${Math.floor(e / daily) + 1}`);
  out.push(
    '## Progression in days',
    '',
    `Energy comes back at one point per ${TUNING.energyRegenSeconds / 60} minutes: ${perDay} a day for somebody who never lets the bar fill up (a script, or a player who also buys refills), and about ${CASUAL_ENERGY} for somebody who empties the bar of ${TUNING.maxEnergy} six times a day. Median day on which each rod is bought, experienced player / novice. The bot does not buy the Ironwood Rod, so a full set is later still.`,
    '',
  );
  out.push(
    table(
      ['Rod', 'Price', 'Energy spent (experienced)', `At ${CASUAL_ENERGY} energy a day`, `At ${perDay} energy a day`],
      buys.map((k) => {
        const rod = RODS.find((r) => `buy:${r.id}` === k)!;
        const e = energyCell(runs.experienced, k);
        const nv = energyCell(runs.novice, k);
        return [rod.name, rod.price.toLocaleString('en-US'), e ?? 'never', `${days(e, CASUAL_ENERGY)} / ${days(nv, CASUAL_ENERGY)}`, `${days(e, perDay)} / ${days(nv, perDay)}`];
      }),
    ),
    '',
  );
  out.push(`PEARL earned in the first 1,000 casts (median): experienced ${med(runs.experienced.map((r) => r.earnedAt1000))}, novice ${med(runs.novice.map((r) => r.earnedAt1000))}.`, '');
  out.push(`All 8 locations open after 20,000 casts: experienced ${runs.experienced.filter((r) => r.save.permanentUnlocks.length === 8).length}/40, novice ${runs.novice.filter((r) => r.save.permanentUnlocks.length === 8).length}/40.`, '');

  // 6. tournament
  out.push('## Weekly championship: who can place', '', 'Total of the ten best catches after a week of N casts, median of 200 weeks, against the demo table at the end of the week.', '');
  const w = weekId(Date.UTC(2026, 10, 13));
  const demo = demoStandings(w, weekStart(w) + WEEK_MS - 1)
    .map((d) => d.total)
    .sort((a, b) => b - a);
  const weekRun = (rod: string, lure: string | null, loc: number, casts: number): number => {
    const totalsList: number[] = [];
    for (let k = 0; k < 200; k++) {
      const rng = mulberry32(31337 + k * 17 + casts);
      const ticket: CastTicket = { locationId: loc, totals: totals(RODS.find((x) => x.id === rod)!, LURES.find((x) => x.id === lure) ?? null, LOCATIONS[loc]) };
      const s: Save = { ...freshSave(0), blendWins: 99, specialsFound: SPECIALS.map((x) => x.id) };
      const scores: number[] = [];
      for (let i = 0; i < casts; i++) {
        if (!rollBite(ticket, rng)) continue;
        const h = hookFish(s, ticket, rng);
        const q = sampleFight(SPECIES[h.speciesId].rarity, LOCATIONS[loc].tier, ticket.totals.zone, rng);
        if (q) scores.push(tournamentScore(SPECIES[h.speciesId], h.weight, q));
      }
      totalsList.push(weekTotal(scores.sort((a, b) => b - a).slice(0, 10).map((score) => ({ score, speciesId: 0, weight: 0, quality: 'B' as Quality, at: 0 }))));
    }
    return med(totalsList);
  };
  const profiles: [string, string, string | null, number][] = [
    ['New player, starter rod, Village Pond', 'willow', null, 0],
    ['Mid game, Carbon + Spinner, Forest River', 'carbon', 'spinner', 1],
    ['Deep Troller + Glow Jig, Northern Sea', 'troller', 'jig', 3],
    ['Pearl Master + Abyss Spoon, Taimen Rapids', 'pearlmaster', 'abyss', 4],
    ['Starter rod, Taimen Rapids', 'willow', null, 4],
  ];
  const rank = (t: number): number => demo.filter((d) => d > t).length + 1;
  out.push(
    table(
      ['Profile', '50 casts', '200 casts', '1,000 casts', 'Rank at 200 (of 13)'],
      profiles.map(([name, r, l, loc]) => {
        const a = weekRun(r, l, loc, 50);
        const b = weekRun(r, l, loc, 200);
        const c = weekRun(r, l, loc, 1000);
        return [name, a, b, c, rank(b)];
      }),
    ),
    '',
  );

  writeFileSync(new URL('../BALANCE.md', import.meta.url), out.join('\n'));
  expect(allNets.length).toBe(LOCATIONS.length * RODS.length * (LURES.length + 1));
}, 600_000);
