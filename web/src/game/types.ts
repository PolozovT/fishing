/** Shared types of the local game. Pure data: nothing here knows about the DOM, storage or a chain. */

/** 0 Common, 1 Uncommon, 2 Rare, 3 Epic, 4 Legendary, 5 Mythic. */
export type Rarity = 0 | 1 | 2 | 3 | 4 | 5;
export type Quality = 'D' | 'C' | 'B' | 'A' | 'S';
export type Rng = () => number;

export interface SpeciesDef {
  id: number;
  name: string;
  rarity: Rarity;
  /** Grams. */
  minWeight: number;
  maxWeight: number;
  /** PEARL for an average-weight, B-quality fish. */
  basePrice: number;
  color: number;
  /** Hidden species sit in a pool with a tiny weight; the Ghost Fish bonus multiplies it. */
  hidden?: boolean;
  /** Id of the special collectible this species is (see SPECIALS). */
  special?: string;
}

export type Water = 'still' | 'moving' | 'deep';

export type Unlock =
  | { type: 'start' }
  | { type: 'level'; level: number }
  | { type: 'species'; count: number }
  | { type: 'special'; special: string };

export interface LocationDef {
  id: number;
  name: string;
  water: Water;
  energyCost: number;
  /** Index into the scene palettes. */
  palette: number;
  /** [speciesId, pool weight] */
  pool: [number, number][];
  unlock: Unlock;
  /** Special collectible that can be hooked here. */
  special?: string;
  /** Tackle ids that suit the place, shown as a hint. */
  recommended: string[];
  blurb: string;
  /**
   * Reserved for future exclusive waters: access that depends on currently HOLDING a collectible (later: owning
   * the NFT). Distinct from `unlock`, which is permanent once earned. No location uses it yet.
   */
  ownership?: { special: string };
}

export interface Effects {
  catch: number;
  rarity: number;
  weight: number;
}

export interface SpecialDef {
  id: string;
  speciesId: number;
  name: string;
  /** Chance per landed fish at a location that carries this special, 0..1. */
  chance: number;
  /** Until the first one is found, this many dry catches at eligible locations guarantee it. */
  pity: number;
  unlocksLocation: number;
  /** Passive bonus while this special sits in the active slot (and a specimen is still held). */
  bonus: { label: string; effects?: Partial<Effects>; locations?: number[]; hiddenMult?: number };
  lore: string;
}

export interface FishInstance {
  id: string;
  speciesId: number;
  rarity: Rarity;
  /** Grams. */
  weight: number;
  quality: Quality;
  locationId: number;
  /** ms since epoch */
  caughtAt: number;
  sellPrice: number;
  tournamentScore: number;
  isFavorite: boolean;
  isSpecial: boolean;
}

export interface CatchRecord {
  speciesId: number;
  weight: number;
  locationId: number;
  at: number;
}

export interface WeekEntry {
  score: number;
  speciesId: number;
  weight: number;
  quality: Quality;
  at: number;
}

export interface Save {
  version: number;
  seq: number;
  pearl: number;
  /** BLEND tokens fished out. A local counter for now: nothing is paid out. */
  blend: number;
  /** How many BLEND prizes this player has landed. */
  blendWins: number;
  xp: number;
  energy: number;
  /** When `energy` was last settled, ms. */
  energyAt: number;
  refills: { day: number; count: number };
  /** Owned rods and their durability left. */
  rods: Record<string, { durability: number }>;
  /** Owned lures and the casts they have left. */
  lures: Record<string, { casts: number }>;
  equipped: { rod: string; lure: string | null };
  location: number;
  fish: FishInstance[];
  /** Encyclopedia: permanent, survives selling every specimen. */
  dex: Record<number, { count: number; best: number; firstAt: number }>;
  /** Locations unlocked for good. Never revoked. */
  permanentUnlocks: number[];
  /** Specials ever landed (drives pity and the trophy shelf). */
  specialsFound: string[];
  /** Dry-catch counters per special, for pity. */
  dry: Record<string, number>;
  activeSpecial: string | null;
  records: { overall: CatchRecord | null; byLocation: Record<number, CatchRecord> };
  /** Weekly championship: the best ten catches of each week, by week id. Past weeks stay as the archive. */
  weeks: Record<number, WeekEntry[]>;
  /** Claimed achievement ids (rewards are granted once). */
  claimed: string[];
  stats: { casts: number; catches: number; escaped: number; sold: number; earned: number };
}
