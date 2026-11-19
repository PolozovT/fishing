/**
 * What a tournament cast hooks, computed exactly as Tournaments._roll computes it: the species, its weight and
 * quality, what a perfect fight would score, and how hard the fish fights. A prediction for presentation: the
 * contract draws the same fish again when the recording is settled. fixtures/tournament.json holds draws made by
 * the contract itself (contracts/test/Tournaments.t.sol) and the tests replay them here.
 */
import { pickSpecies, rollQuality, rollWeight, type ChainCatalog } from './chainOutcome';
import { basePoints } from './fight';

export interface TournamentTackle {
  locationId: number;
  /** Extra difficulty of the water, added to the fish's rarity. */
  waterTier: number;
  /** FishingGame.loadout(rod, lure, 0, location) of the tournament's fixed tackle. */
  rodCatch: number;
  rarity: number;
  weightBonus: number;
}

export interface TournamentFish {
  speciesId: number;
  weight: number;
  /** 0 D … 4 S */
  quality: number;
  /** Points of a perfect fight. */
  base: number;
  /** 0 … 5 */
  difficulty: number;
}

/** The tournaments use the game's quality constants, fixed in the contract. */
const QUALITY = { qualityPerCatch: 150, qualityPerRarity: 300 };

export function tournamentFish(c: Pick<ChainCatalog, 'locations' | 'species'>, t: TournamentTackle, seed: bigint): TournamentFish {
  const catalog = { ...c, specials: [], config: { ...QUALITY, blendChancePpm: 0, blendMaxWins: 0 } };
  // no special fish and no hidden-species boost in a tournament: every pool weight counts as it is
  const speciesId = pickSpecies(catalog, c.locations[t.locationId], t.rarity, 1, seed >> 64n);
  const s = c.species[speciesId];
  const weight = rollWeight(s.minWeight, s.maxWeight, t.weightBonus, seed >> 128n);
  const quality = rollQuality(catalog, t.rodCatch, s.rarity, Number((seed >> 200n) % 10_000n));
  return { speciesId, weight, quality, base: basePoints(s.rarity, s.minWeight, s.maxWeight, weight, quality), difficulty: Math.min(5, s.rarity + t.waterTier) };
}
