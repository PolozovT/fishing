/**
 * Tackle catalog: rods and reusable lures. The local game applies these effects (see game/equipment.ts); the
 * contracts do not know rod types or lures yet. Location ids follow game/content.ts:
 * 0 Village Pond, 1 Forest River, 2 Deep Lake, 3 Northern Sea, 4 Taimen Rapids, 5 Golden Lake, 6 Ancient Swamp,
 * 7 Phantom Waters.
 *
 * What each stat does: a rod's catch widens the green band of the reel's tension gauge, a lure's catch raises the bite chance; rarity is a
 * relative weighting of rarer species (not percentage points); weight scales the fish's weight.
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
  /** Rods: durability points (0 = never wears out). Lures: casts before the lure wears out. */
  wear: number;
  base: Effects;
  spot?: SpotEffect;
  /** Plain-language trade-offs, shown as +/− lines. */
  pros: string[];
  cons: string[];
  blurb: string;
  /** Multiplier on the rod's repair price (default 1). */
  repairFactor?: number;
}


export const RODS: TackleItem[] = [
  {
    id: 'willow',
    kind: 'rod',
    name: 'Willow Rod',
    tier: 0,
    price: 0,
    wear: 0,
    base: {},
    pros: ['Free: every angler starts with one', 'Never wears out'],
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
    spot: { spots: [0, 1], catch: 3, rarity: 15, label: 'on the pond and the river' },
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
    repairFactor: 0.7,
    base: { catch: 2, weight: 5 },
    spot: { spots: [5, 6], catch: 3, weight: 12, label: 'on Golden Lake and the swamp' },
    pros: ['Twice the durability of a carbon rod', 'Repairs cost 30% less', 'Hauls heavy fish out of weeds'],
    cons: ['Nothing for rare fish'],
    blurb: 'Dense northern wood. It outlasts its owner.',
  },
  {
    id: 'flyrod',
    kind: 'rod',
    name: 'Taiga Fly Rod',
    tier: 2,
    price: 2500,
    wear: 70,
    base: { rarity: 40 },
    spot: { spots: [1, 4], catch: 4, rarity: 60, weight: 10, label: 'on moving water' },
    pros: ['Rare fish come to it on rivers and rapids', 'Best partner for flies'],
    cons: ['−4 catch on still and deep water'],
    blurb: 'Long and whippy, made for reading a current.',
  },
  {
    id: 'troller',
    kind: 'rod',
    name: 'Deep Troller',
    tier: 2,
    price: 4000,
    wear: 50,
    base: { catch: 2, weight: 8 },
    spot: { spots: [2, 3, 7], catch: 5, rarity: 30, weight: 12, label: 'in deep water' },
    pros: ['+20% fish weight in deep water: heavier catches sell for more', 'Built for the lake and the sea'],
    cons: ['Wears out fast (50 durability)'],
    blurb: 'A short, thick boat rod with a reel the size of a fist.',
  },
  {
    id: 'pearlmaster',
    kind: 'rod',
    name: 'Pearl Master',
    tier: 3,
    price: 25000,
    wear: 120,
    base: { catch: 4, rarity: 50, weight: 6 },
    pros: ['Good at everything, everywhere', 'Durable for its power'],
    cons: ['A specialist rod beats it in its home water', 'Very expensive'],
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
    base: { catch: 3, rarity: 15 },
    spot: { spots: [1], catch: 3, rarity: 20, label: 'in Forest River' },
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
    spot: { spots: [1, 4], catch: 4, rarity: 70, label: 'on moving water' },
    pros: ['Grayling and taimen bait', 'Pairs with the Taiga Fly Rod'],
    cons: ['No extra bites off the current'],
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
    spot: { spots: [2, 3, 7], catch: 8, rarity: 15, label: 'in deep water' },
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
    spot: { spots: [0, 5, 6], catch: 5, label: 'on still shallows' },
    pros: ['+15% fish weight', 'Wakes up ponds, lakes and swamps'],
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

/** Catch penalty of the fly rod away from moving water, which a single SpotEffect cannot express. */
export const FLY_ROD_OFF_CURRENT = { rod: 'flyrod', catch: -4 };

export const rodById = (id: string): TackleItem | undefined => RODS.find((r) => r.id === id);
export const lureById = (id: string | null): TackleItem | undefined => (id ? LURES.find((l) => l.id === id) : undefined);
