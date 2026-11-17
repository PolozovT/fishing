import { describe, expect, it } from 'vitest';
import { LOCATIONS, SPECIES } from './content';
import { fightSeedOf, pointsFor, tournamentCastSeed } from './fight';
import vectors from './fixtures/tournament.json';
import { tournamentFish } from './tournamentRoll';

const catalog = {
  locations: LOCATIONS.map((l) => ({ special: 0, speciesIds: l.pool.map(([id]) => id), weights: l.pool.map(([, w]) => w) })),
  species: SPECIES.map((s) => ({ rarity: s.rarity, minWeight: s.minWeight, maxWeight: s.maxWeight, hidden: !!s.hidden })),
};

describe('predicting a tournament cast', () => {
  it('covers every location and several rarities', () => {
    expect(new Set(vectors.map((v) => v.locationId)).size).toBe(LOCATIONS.length);
    expect(new Set(vectors.map((v) => SPECIES[v.speciesId].rarity)).size).toBeGreaterThanOrEqual(3);
  });

  it('derives the same seeds as the contract', () => {
    for (const v of vectors) {
      const seed = tournamentCastSeed(v.blockHash as `0x${string}`, v.player as `0x${string}`, BigInt(v.id), BigInt(v.castNo), v.tournaments as `0x${string}`);
      expect(seed).toBe(BigInt(v.seed));
      expect(fightSeedOf(seed)).toBe(BigInt(v.fightSeed));
    }
  });

  it('draws the same fish and scores it the same as the contract', () => {
    vectors.forEach((v, i) => {
      const got = tournamentFish(catalog, { locationId: v.locationId, waterTier: i % 3, rodCatch: v.rodCatch, rarity: v.rarity, weightBonus: v.weightBonus }, BigInt(v.seed));
      expect({ speciesId: got.speciesId, weight: got.weight, quality: got.quality, base: got.base }, `vector ${i}`).toEqual({ speciesId: v.speciesId, weight: v.weight, quality: v.quality, base: v.base });
      expect(got.difficulty).toBe(Math.min(5, SPECIES[v.speciesId].rarity + (i % 3)));
      // the vectors were settled with a fight of 200 ticks, 137 of them in the green
      expect(pointsFor(got.base, 200, 137)).toBe(v.points);
    });
  });
});
