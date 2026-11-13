/**
 * The first 20 species and 5 spots, as the first version of the contracts seeded them (prices in the old 1×
 * scale). game/content.ts builds the current catalog on top of this; GameSetup.sol mirrors that one.
 */
export interface Species {
  id: number;
  name: string;
  rarity: number;
  minWeight: number;
  maxWeight: number;
  basePrice: bigint;
  color: number;
}
export interface Spot {
  id: number;
  name: string;
  minRodLevel: number;
  energyCost: number;
  active: boolean;
  speciesIds: number[];
}

const E = 10n ** 18n;

const SPECIES: [string, number, number, number, bigint, number][] = [
  ['Roach', 0, 50, 450, (E * 9n) / 10n, 0x9fb3c8],
  ['Crucian Carp', 0, 100, 900, (E * 12n) / 10n, 0xc9a227],
  ['Perch', 0, 60, 700, E, 0x6b8e23],
  ['Tench', 1, 300, 2500, 3n * E, 0x556b2f],
  ['Golden Carp', 3, 1000, 6000, 30n * E, 0xffd700],
  ['Pike', 1, 1000, 12000, 2n * E, 0x3c6e47],
  ['Trout', 1, 300, 4000, 2n * E, 0xd98c8c],
  ['Zander', 2, 1000, 9000, 5n * E, 0x8a9a5b],
  ['Grayling', 2, 200, 1500, (E * 45n) / 10n, 0x7d6fa8],
  ['Taimen', 4, 8000, 50000, 120n * E, 0xb5523b],
  ['Bream', 0, 500, 4000, (E * 12n) / 10n, 0xa89060],
  ['Burbot', 1, 500, 5000, (E * 26n) / 10n, 0x5d4e37],
  ['Whitefish', 2, 300, 3000, 6n * E, 0xdfe6ee],
  ['Wels Catfish', 3, 5000, 90000, 22n * E, 0x3b3b3b],
  ['Lake Spirit', 4, 3000, 30000, 120n * E, 0x7fffd4],
  ['Herring', 0, 100, 700, (E * 18n) / 10n, 0x9ab0c2],
  ['Cod', 1, 1000, 20000, (E * 54n) / 10n, 0x8b7d6b],
  ['Atlantic Salmon', 2, 2000, 20000, 15n * E, 0xfa8072],
  ['Halibut', 3, 5000, 150000, 40n * E, 0x6e6157],
  ['Bluefin Tuna', 4, 50000, 400000, 300n * E, 0x1e3f66],
];

export const OFFLINE_SPECIES: Species[] = SPECIES.map(([name, rarity, minWeight, maxWeight, basePrice, color], id) => ({
  id,
  name,
  rarity,
  minWeight,
  maxWeight,
  basePrice,
  color,
}));

export const OFFLINE_SPOTS: Spot[] = (
  [
    ['Village Pond', 1, 1, [0, 1, 2, 3, 4]],
    ['Forest River', 2, 1, [2, 5, 6, 7, 8]],
    ['Deep Lake', 3, 2, [10, 11, 12, 13, 14]],
    ['Northern Sea', 4, 3, [15, 16, 17, 18, 19]],
    ['Taimen Rapids', 5, 4, [9, 7, 13, 18, 4]],
  ] as [string, number, number, number[]][]
).map(([name, minRodLevel, energyCost, speciesIds], id) => ({ id, name, minRodLevel, energyCost, active: true, speciesIds }));
