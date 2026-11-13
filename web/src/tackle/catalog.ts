/**
 * Tackle catalog for the Tackle page. A design preview: nothing here is onchain yet, and none of these
 * effects reach a catch until the contracts grow rod types and lures. Spot ids follow GameSetup.sol:
 * 0 Village Pond, 1 Forest River, 2 Deep Lake, 3 Northern Sea, 4 Taimen Rapids.
 */

/** Effects in the units the game already uses: catch in percentage points, rarity in % per rarity tier, weight in %. */
export interface Effects {
  catch?: number;
  rarity?: number;
  weight?: number;
}

export interface SpotEffect extends Effects {
  spots: number[];
  /** How the condition reads on the card, e.g. "on moving water". */
  label: string;
}

export interface TackleItem {
  id: string;
  kind: 'rod' | 'lure';
  name: string;
  /** 0 Common … 4 Legendary, same tiers as fish. */
  tier: number;
  /** PEARL; 0 for the free starter rod. */
  price: number;
  /** Rods: durability points. Lures: casts before the lure wears out. */
  wear: number;
  base: Effects;
  spot?: SpotEffect;
  /** Plain-language trade-offs, shown as +/− lines. */
  pros: string[];
  cons: string[];
  blurb: string;
}

export const SPOT_NAMES = ['Village Pond', 'Forest River', 'Deep Lake', 'Northern Sea', 'Taimen Rapids'];

export const BASE_CATCH = 55;
export const MAX_CATCH = 95;

export const RODS: TackleItem[] = [
  {
    id: 'willow',
    kind: 'rod',
    name: 'Willow Rod',
    tier: 0,
    price: 0,
    wear: 60,
    base: {},
    pros: ['Free: every angler starts with one', 'Cheapest rod to repair'],
    cons: ['No bonuses of its own'],
    blurb: 'A bent willow branch with a line tied on. Honest and forgiving.',
  },
  {
    id: 'carbon',
    kind: 'rod',
    name: 'Carbon Spinner',
    tier: 1,
    price: 450,
    wear: 80,
    base: { catch: 6, rarity: 20 },
    spot: { spots: [0, 1], catch: 3, label: 'on the pond and the river' },
    pros: ['Light and quick: more bites everywhere', 'Shines with spoons and spinners on calm water'],
    cons: ['Nothing extra for heavy fish'],
    blurb: 'Stiff, light carbon. Feels every touch on the line.',
  },
  {
    id: 'ironwood',
    kind: 'rod',
    name: 'Ironwood Rod',
    tier: 1,
    price: 900,
    wear: 160,
    base: { catch: 2 },
    pros: ['Twice the durability of a carbon rod', 'Repairs cost 30% less'],
    cons: ['Heavy: small catch bonus only'],
    blurb: 'Dense northern wood. It outlasts its owner.',
  },
  {
    id: 'flyrod',
    kind: 'rod',
    name: 'Taiga Fly Rod',
    tier: 2,
    price: 1500,
    wear: 70,
    base: { rarity: 40 },
    spot: { spots: [1, 4], rarity: 60, label: 'on moving water' },
    pros: ['Rare fish come to it on rivers and rapids', 'Best partner for flies'],
    cons: ['−4% catch on still water (pond, lake)'],
    blurb: 'Long and whippy, made for reading a current.',
  },
  {
    id: 'troller',
    kind: 'rod',
    name: 'Deep Troller',
    tier: 2,
    price: 1800,
    wear: 50,
    base: { catch: 2, weight: 20 },
    spot: { spots: [2, 3], catch: 5, label: 'in deep water' },
    pros: ['+20% fish weight: heavier catches sell for more', 'Built for the lake and the sea'],
    cons: ['Wears out fast (50 durability)'],
    blurb: 'A short, thick boat rod with a reel the size of a fist.',
  },
  {
    id: 'pearlmaster',
    kind: 'rod',
    name: 'Pearl Master',
    tier: 3,
    price: 5000,
    wear: 120,
    base: { catch: 8, rarity: 90, weight: 10 },
    pros: ['Strong at everything, everywhere', 'Durable for its power'],
    cons: ['Costs as much as a max rod upgrade'],
    blurb: 'Inlaid with river pearl. Fish seem to notice it.',
  },
];

export const LURES: TackleItem[] = [
  {
    id: 'spoon',
    kind: 'lure',
    name: 'Silver Spoon',
    tier: 0,
    price: 60,
    wear: 80,
    base: { catch: 5 },
    spot: { spots: [2], catch: 2, label: 'in Deep Lake' },
    pros: ['Cheap, steady extra bites', 'Lasts 80 casts'],
    cons: ['Does nothing for rarity'],
    blurb: 'A wobbling spoon that flashes in any water.',
  },
  {
    id: 'spinner',
    kind: 'lure',
    name: 'Copper Spinner',
    tier: 0,
    price: 90,
    wear: 60,
    base: { catch: 3, rarity: 30 },
    spot: { spots: [1], catch: 3, label: 'in Forest River' },
    pros: ['A little of everything', 'Pike and zander love the blade'],
    cons: ['The blade bends: 60 casts'],
    blurb: 'A copper blade spinning round a lead body.',
  },
  {
    id: 'fly',
    kind: 'lure',
    name: 'Feather Fly',
    tier: 1,
    price: 240,
    wear: 50,
    base: { rarity: 40 },
    spot: { spots: [1, 4], rarity: 70, label: 'on moving water' },
    pros: ['Grayling and taimen bait', 'Pairs with the Taiga Fly Rod'],
    cons: ['No extra bites on its own'],
    blurb: 'Hand-tied from capercaillie feathers.',
  },
  {
    id: 'jig',
    kind: 'lure',
    name: 'Glow Jig',
    tier: 1,
    price: 300,
    wear: 50,
    base: { catch: 2 },
    spot: { spots: [2, 3], catch: 8, label: 'in deep water' },
    pros: ['Seen in the dark deep: many more bites there', 'Pairs with the Deep Troller'],
    cons: ['Little use in shallow water'],
    blurb: 'A lead head painted with phosphor and a soft tail.',
  },
  {
    id: 'popper',
    kind: 'lure',
    name: 'Topwater Popper',
    tier: 2,
    price: 600,
    wear: 40,
    base: { weight: 15 },
    spot: { spots: [0], catch: 5, label: 'in Village Pond' },
    pros: ['+15% fish weight', 'Wakes up the pond'],
    cons: ['Wears out in 40 casts'],
    blurb: 'Chugs across the surface. Big fish hate it.',
  },
  {
    id: 'abyss',
    kind: 'lure',
    name: 'Abyss Spoon',
    tier: 3,
    price: 1500,
    wear: 25,
    base: { rarity: 150, weight: 10 },
    pros: ['The best rare-fish odds in the shop', 'Heavier catches too'],
    cons: ['Fragile: 25 casts'],
    blurb: 'Black enamel that glows violet a fathom down.',
  },
];

/** Still-water catch penalty of the fly rod, which a single SpotEffect cannot express. */
export const FLY_ROD_STILL_WATER = { rod: 'flyrod', spots: [0, 2], catch: -4 };

export interface Loadout {
  catch: number;
  rarity: number;
  weight: number;
  rodWear: number;
  lureCasts: number;
}

function add(into: Effects, e: Effects | undefined): void {
  if (!e) return;
  into.catch = (into.catch ?? 0) + (e.catch ?? 0);
  into.rarity = (into.rarity ?? 0) + (e.rarity ?? 0);
  into.weight = (into.weight ?? 0) + (e.weight ?? 0);
}

/** What a rod + lure would give on a spot, by the numbers above (an estimate: nothing here is onchain yet). */
export function loadout(rod: TackleItem, lure: TackleItem | null, spot: number): Loadout {
  const e: Effects = {};
  for (const item of lure ? [rod, lure] : [rod]) {
    add(e, item.base);
    if (item.spot?.spots.includes(spot)) add(e, item.spot);
  }
  if (rod.id === FLY_ROD_STILL_WATER.rod && FLY_ROD_STILL_WATER.spots.includes(spot)) add(e, { catch: FLY_ROD_STILL_WATER.catch });
  return {
    catch: Math.max(0, Math.min(MAX_CATCH, BASE_CATCH + (e.catch ?? 0))),
    rarity: e.rarity ?? 0,
    weight: e.weight ?? 0,
    rodWear: rod.wear,
    lureCasts: lure?.wear ?? 0,
  };
}
