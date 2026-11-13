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
import { reelParams, simulateFight } from '../src/game/minigame';
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
function fightStats(rarity: Rarity, zone: number, lag: number, noise: number): FightStats {
  const key = `${rarity}:${zone.toFixed(3)}:${lag}:${noise}`;
  const hit = fightCache.get(key);
  if (hit) return hit;
  const rng = mulberry32(rarity * 1000 + Math.round(zone * 1000) + Math.round(lag * 100));
  const q: Record<Quality, number> = { D: 0, C: 0, B: 0, A: 0, S: 0 };
  let land = 0;
  let seconds = 0;
  const n = 2000;
  for (let i = 0; i < n; i++) {
    const f = simulateFight(reelParams(rarity, zone), rng, lag, noise);
    seconds += f.seconds;
    if (f.landed) {
      land++;
      q[f.quality]++;
    }
  }
  for (const k of QUALITIES) q[k] /= Math.max(1, land);
  const out = { land: land / n, q, seconds: seconds / n };
  fightCache.set(key, out);
  return out;
}
const SKILL = { decent: [0.18, 0.04], novice: [0.3, 0.08] } as const;
function sampleFight(rarity: Rarity, zone: number, rng: () => number, skill: keyof typeof SKILL = 'decent'): Quality | null {
  const st = fightStats(rarity, zone, SKILL[skill][0], SKILL[skill][1]);
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
    const q = sampleFight(sp.rarity, ticket.totals.zone, rng);
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
function career(seed: number, skill: keyof typeof SKILL, maxCasts: number) {
  const rng = mulberry32(seed);
  let s: Save = { ...freshSave(0), blendWins: 99 };
  const now = 1000;
  const marks: Record<string, number> = {};
  const mark = (k: string): void => void (marks[k] ??= s.stats.casts);
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
    if (rollBite(c.ticket, rng)) {
      const h = hookFish(s, c.ticket, rng);
      const q = sampleFight(SPECIES[h.speciesId].rarity, c.ticket.totals.zone, rng, skill);
      if (q) {
        const l = landFish(s, c.ticket, h, q, now + s.stats.casts);
        s = l.save;
        if (!l.fish.isSpecial) s = sellFish(s, [l.fish.id]).save;
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
  return { marks, save: s, earnedAt1000 };
}

const FINDINGS = `## Findings

What the first runs showed, and what was changed because of it. The tables below are the state after those changes.

- **Rarity odds hold up.** Bonuses are a relative weighting, so even the strongest rarity build (+250) moves Legendary fish from 2.4% to 3.7% at Taimen Rapids and from 0.5% to 1.7% at sea. No loadout makes rare fish common.
- **Late game was far too fast.** With the first numbers a player bought the best rod after ~170 casts and earned 360k PEARL in 1,000 casts. Fixes: XP curve doubled (50·L·(L−1)), the new waters' fish repriced, Fly Rod 1,500 → 2,500, Deep Troller 1,800 → 4,000, Pearl Master 5,000 → 25,000. It now takes ~500 casts to the last rod.
- **Pearl Master was the best rod everywhere.** It is now a generalist (catch 4, rarity 50, weight 6): close to the top in every water but beaten by the specialist at home. Carbon Spinner wins the pond and river, Taiga Fly Rod the rapids, Deep Troller deep water, Ironwood the lake and swamp. Six different best loadouts across eight locations.
- **Rod upkeep punished expensive rods.** Repair at 20% of the price per full bar made the Fly Rod lose money against the free starter. Repair is now 6% of the price.
- **Copper Spinner was the best lure everywhere** (rarity 30 for 1.5 PEARL a cast). Its base rarity is 15 now, with the extra moved into its Forest River bonus.
- **The reel.** The first version (a catch zone chasing a darting fish) tested fine with a bot but players could not read it, so it became a line-tension gauge: hold to reel, keep the needle in the green, let go when the fish pulls. A pull never raises tension faster than letting go lowers it, so a snapped line is always the player's own doing. The bot below lands everything; for it the rod's wider green band shows up as quality (Legendary on the starter rod is mostly B and C, on the best rod mostly S and A). Real players will lose fish to snaps the bot never makes, so treat the landing rates as an upper bound.
- **Progression has no dead ends.** All 40 simulated careers of both skill levels opened all eight locations. Pity (120 / 160 / 220 dry catches) caps the worst case for each special fish.
- **Tournament.** Ten counted catches blunt raw volume: with mid and late tackle, 20× the casts give 3–5× the score. A beginner on the pond gains more from volume (12×), because their top ten starts out all Common. After 200 casts a new player on the starter rod is 9th of 13 against the demo field. Where you can fish matters more than what you hold: at Taimen Rapids the best tackle scores about 30% more than the starter rod. An equipment-restricted Starter Cup would only need a second scoring list filtered by rod tier; the score function takes no equipment input.

Known soft spots: Abyss Spoon never pays for itself in PEARL (it is the tournament and collection lure by design), and Golden Lake pays better per energy than Deep Lake although it can open earlier, as a reward for finding the Koi.`;

it('balance simulation', () => {
  const out: string[] = ['# Balance simulation', '', FINDINGS, '', `Generated by \`pnpm sim\` from the real game rules (src/game). ${N.toLocaleString('en-US')} casts per row unless noted. The reel is played by a bot: "decent" reacts in 0.18 s, "novice" in 0.30 s with twice the aim error.`, ''];

  // 1. the reel
  out.push('## Reel mini-game: landing rate and quality', '', 'Starter rod, the widest zone a rod reaches, and the cap; decent bot.', '');
  const zones = [TUNING.baseZone, Math.max(...RODS.flatMap((r) => LOCATIONS.map((l) => totals(r, null, l).zone))), TUNING.maxZone];
  out.push(
    table(
      ['Rarity', ...zones.flatMap((z) => [`land @${pct(z, 0)}`, `S/A/B/C/D @${pct(z, 0)}`]), 'novice land, starter', 'avg seconds'],
      RARITY.map((name, r) => {
        const cells = zones.flatMap((z) => {
          const f = fightStats(r as Rarity, z, 0.18, 0.04);
          return [pct(f.land, 0), ['S', 'A', 'B', 'C', 'D'].map((k) => Math.round(f.q[k as Quality] * 100)).join('/')];
        });
        return [name, ...cells, pct(fightStats(r as Rarity, TUNING.baseZone, 0.3, 0.08).land, 0), fightStats(r as Rarity, TUNING.baseZone, 0.18, 0.04).seconds.toFixed(1)];
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
  const runs = { decent: [] as ReturnType<typeof career>[], novice: [] as ReturnType<typeof career>[] };
  for (let i = 0; i < 40; i++) {
    runs.decent.push(career(5000 + i, 'decent', 20_000));
    runs.novice.push(career(7000 + i, 'novice', 20_000));
  }
  const cell = (rs: ReturnType<typeof career>[], k: string): string => {
    const got = rs.map((r) => r.marks[k]).filter((x) => x !== undefined);
    if (got.length < rs.length / 2) return `never in ${rs.length - got.length}/${rs.length}`;
    return `${med(got)} (worst ${Math.max(...got)})`;
  };
  out.push(table(['Milestone', 'Decent player', 'Novice'], keys.map((k) => [k, cell(runs.decent, k), cell(runs.novice, k)])), '');
  out.push(`PEARL earned in the first 1,000 casts (median): decent ${med(runs.decent.map((r) => r.earnedAt1000))}, novice ${med(runs.novice.map((r) => r.earnedAt1000))}.`, '');
  out.push(`All 8 locations open after 20,000 casts: decent ${runs.decent.filter((r) => r.save.permanentUnlocks.length === 8).length}/40, novice ${runs.novice.filter((r) => r.save.permanentUnlocks.length === 8).length}/40.`, '');

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
        const q = sampleFight(SPECIES[h.speciesId].rarity, ticket.totals.zone, rng);
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
