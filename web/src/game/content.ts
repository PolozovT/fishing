/**
 * Game content: species, locations, special collectibles and tuning numbers. All configuration lives here and in
 * tackle/catalog.ts; the rules in the other game/ modules read it and hard-code nothing.
 *
 * The first 20 species and 5 locations mirror contracts/script/GameSetup.sol (same ids, weights, pools).
 * Local PEARL is 10× finer than the contract's: a Roach is 9 PEARL here and 0.9 there, so whole numbers work.
 */
import { OFFLINE_SPECIES, OFFLINE_SPOTS } from '../offlineCatalog';
import type { LocationDef, Quality, Rarity, SpecialDef, SpeciesDef } from './types';

export const PRICE_SCALE = 10;
const TENTH = 10n ** 17n;

const BASE: SpeciesDef[] = OFFLINE_SPECIES.map((s) => ({
  id: s.id,
  name: s.name,
  rarity: s.rarity as Rarity,
  minWeight: s.minWeight,
  maxWeight: s.maxWeight,
  basePrice: Number(s.basePrice / TENTH),
  color: s.color,
}));
BASE[14].hidden = true; // Lake Spirit

const EXTRA: Omit<SpeciesDef, 'id'>[] = [
  { name: 'Golden Koi', rarity: 4, minWeight: 800, maxWeight: 6000, basePrice: 1500, color: 0xf2b632, special: 'koi' }, // 20
  { name: 'Ancient Catfish', rarity: 4, minWeight: 20000, maxWeight: 120000, basePrice: 2000, color: 0x4a4032, special: 'catfish' }, // 21
  { name: 'Ghost Fish', rarity: 5, minWeight: 1000, maxWeight: 9000, basePrice: 5000, color: 0xcfe8ff, special: 'ghost' }, // 22
  { name: 'Gilded Rudd', rarity: 0, minWeight: 80, maxWeight: 600, basePrice: 14, color: 0xd9a441 }, // 23
  { name: 'Mirror Carp', rarity: 1, minWeight: 1500, maxWeight: 12000, basePrice: 30, color: 0xb08d57 }, // 24
  { name: 'Sun Perch', rarity: 2, minWeight: 200, maxWeight: 1800, basePrice: 70, color: 0xe8a23a }, // 25
  { name: 'Amber Sturgeon', rarity: 3, minWeight: 8000, maxWeight: 60000, basePrice: 300, color: 0xc47a2c }, // 26
  { name: 'Bowfin', rarity: 0, minWeight: 500, maxWeight: 4000, basePrice: 30, color: 0x5b6b3a }, // 27
  { name: 'Snakehead', rarity: 1, minWeight: 800, maxWeight: 7000, basePrice: 60, color: 0x4f5d3a }, // 28
  { name: 'Swamp Eel', rarity: 2, minWeight: 300, maxWeight: 3500, basePrice: 130, color: 0x3d4a3a }, // 29
  { name: 'Alligator Gar', rarity: 3, minWeight: 10000, maxWeight: 100000, basePrice: 450, color: 0x6b7a4a }, // 30
  { name: 'Moon Eel', rarity: 1, minWeight: 400, maxWeight: 3000, basePrice: 90, color: 0x9fb8e0 }, // 31
  { name: 'Lantern Pike', rarity: 2, minWeight: 1500, maxWeight: 14000, basePrice: 180, color: 0x7fd4c9 }, // 32
  { name: 'Wraith Salmon', rarity: 3, minWeight: 3000, maxWeight: 22000, basePrice: 500, color: 0xb9a6e8 }, // 33
  { name: 'Spectral Sturgeon', rarity: 4, minWeight: 20000, maxWeight: 150000, basePrice: 2500, color: 0xe6e9ff, hidden: true }, // 34
  { name: 'Albino Pike', rarity: 3, minWeight: 1500, maxWeight: 13000, basePrice: 250, color: 0xf0ece0, hidden: true }, // 35
];

export const SPECIES: SpeciesDef[] = [...BASE, ...EXTRA.map((s, i) => ({ ...s, id: BASE.length + i }))];

/** Pool weights of the five original spots, as seeded by GameSetup.sol. */
const CONTRACT_WEIGHTS = [
  [400, 350, 300, 100, 8],
  [300, 250, 250, 80, 70],
  [400, 250, 120, 30, 5],
  [400, 300, 120, 30, 4],
  [10, 200, 100, 60, 40],
];
const pool = (i: number): [number, number][] => OFFLINE_SPOTS[i].speciesIds.map((id, k) => [id, CONTRACT_WEIGHTS[i][k]]);

export const LOCATIONS: LocationDef[] = [
  {
    id: 0,
    name: 'Village Pond',
    water: 'still',
    energyCost: 1,
    palette: 0,
    pool: pool(0),
    unlock: { type: 'start' },
    special: 'koi',
    recommended: ['carbon', 'popper'],
    blurb: 'Calm, shallow and forgiving. Somewhere under the lilies a golden koi circles.',
  },
  {
    id: 1,
    name: 'Forest River',
    water: 'moving',
    energyCost: 1,
    palette: 1,
    pool: [...pool(1), [35, 6]],
    unlock: { type: 'level', level: 3 },
    special: 'koi',
    recommended: ['flyrod', 'fly', 'spinner'],
    blurb: 'Cold moving water: pike, trout and grayling. Fly tackle shines here.',
  },
  {
    id: 2,
    name: 'Deep Lake',
    water: 'deep',
    energyCost: 2,
    palette: 2,
    pool: pool(2),
    unlock: { type: 'species', count: 8 },
    special: 'catfish',
    recommended: ['troller', 'jig', 'spoon'],
    blurb: 'Heavier fish and darker water. Something very old lives on the bottom.',
  },
  {
    id: 3,
    name: 'Northern Sea',
    water: 'deep',
    energyCost: 3,
    palette: 3,
    pool: pool(3),
    unlock: { type: 'level', level: 8 },
    special: 'ghost',
    recommended: ['troller', 'jig'],
    blurb: 'Cod, salmon, halibut, and on a lucky day a bluefin tuna.',
  },
  {
    id: 4,
    name: 'Taimen Rapids',
    water: 'moving',
    energyCost: 4,
    palette: 4,
    pool: pool(4),
    unlock: { type: 'level', level: 12 },
    special: 'ghost',
    recommended: ['flyrod', 'fly', 'abyss'],
    blurb: 'White water where the taimen hunts. Every cast here is a gamble worth taking.',
  },
  {
    id: 5,
    name: 'Golden Lake',
    water: 'still',
    energyCost: 2,
    palette: 0,
    pool: [
      [23, 400],
      [24, 300],
      [25, 150],
      [26, 40],
      [4, 60],
    ],
    unlock: { type: 'special', special: 'koi' },
    special: 'catfish',
    recommended: ['carbon', 'popper'],
    blurb: 'A lake that glows at dusk. Only those who have met the Golden Koi find the path.',
  },
  {
    id: 6,
    name: 'Ancient Swamp',
    water: 'still',
    energyCost: 3,
    palette: 2,
    pool: [
      [27, 400],
      [28, 300],
      [29, 140],
      [30, 40],
      [13, 80],
    ],
    unlock: { type: 'special', special: 'catfish' },
    special: 'ghost',
    recommended: ['ironwood', 'popper', 'abyss'],
    blurb: 'Black water and drowned trees. Big, armoured, patient fish.',
  },
  {
    id: 7,
    name: 'Phantom Waters',
    water: 'deep',
    energyCost: 4,
    palette: 5,
    pool: [
      [31, 380],
      [32, 250],
      [33, 80],
      [14, 20],
      [34, 5],
    ],
    unlock: { type: 'special', special: 'ghost' },
    recommended: ['troller', 'jig', 'abyss'],
    blurb: 'Mist that never lifts. The fish here are half memory.',
  },
];

export const SPECIALS: SpecialDef[] = [
  {
    id: 'koi',
    speciesId: 20,
    name: 'Golden Koi',
    chance: 0.012,
    pity: 120,
    unlocksLocation: 5,
    bonus: { label: '+25% rarity at Golden Lake', effects: { rarity: 25 }, locations: [5] },
    lore: 'They say it has circled the village pond for a hundred years, and that it shows the way to a lake of gold.',
  },
  {
    id: 'catfish',
    speciesId: 21,
    name: 'Ancient Catfish',
    chance: 0.008,
    pity: 160,
    unlocksLocation: 6,
    bonus: { label: '+8% fish weight everywhere', effects: { weight: 8 } },
    lore: 'Older than the lake it sleeps in. Its whiskers point toward the swamp it came from.',
  },
  {
    id: 'ghost',
    speciesId: 22,
    name: 'Ghost Fish',
    chance: 0.005,
    pity: 220,
    unlocksLocation: 7,
    bonus: { label: 'Hidden species bite 3× more often', hiddenMult: 3 },
    lore: 'You can see the far bank through it. Follow it and the mist opens.',
  },
];

export const special = (id: string): SpecialDef | undefined => SPECIALS.find((s) => s.id === id);

/**
 * The BLEND prize: now and then the thing on the hook is not a fish but a sealed bottle with tokens in it.
 * Frontend only for now: the balance is a local counter and no tokens are paid out. A real payout must be
 * decided by a contract or a trusted server, never by this client.
 */
/** PEARL that one BLEND buys. On the contracts the PearlExchange rate is the truth; this mirrors it for local play. */
export const PEARL_PER_BLEND = 100;

export const BLEND_PRIZE = {
  amount: 100,
  /** Chance per bite, at any location. */
  chance: 0.004,
  /** Prizes one player can land in total. */
  maxWins: 1,
  /** The bottle fights like a fish of this rarity. */
  fightRarity: 2 as Rarity,
};

// ------------------------------------------------------------------ tuning

export const TUNING = {
  maxEnergy: 20,
  /** Local play regenerates faster than the contract's 15 minutes: nothing is at stake yet. */
  energyRegenSeconds: 120,
  refillPrice: 100,
  /** Each further refill on the same UTC day costs this many times more. */
  refillGrowth: 2,
  /** Chance that anything bites at all, before lure bonuses, in %. */
  baseBite: 65,
  maxBite: 95,
  /** Width of the reel catch zone as a share of the bar, before rod bonuses. */
  baseZone: 0.2,
  zonePerCatch: 0.006,
  maxZone: 0.3,
  maxRarityBonus: 300,
  maxWeightBonus: 60,
  /** Fish at or above this price ask for a confirmation before they are sold. */
  valuablePrice: 400,
  /** Full repair of a rod costs this share of its price. */
  repairShare: 0.06,
};

export const QUALITIES: Quality[] = ['D', 'C', 'B', 'A', 'S'];
export const QUALITY_MULT: Record<Quality, number> = { D: 0.8, C: 0.9, B: 1, A: 1.15, S: 1.3 };
/** Tournament points by rarity, Common … Mythic. */
export const RARITY_POINTS = [10, 25, 60, 150, 400, 800];
export const XP_BY_RARITY = [10, 20, 30, 40, 50, 80];
