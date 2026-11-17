/**
 * What a pending cast will turn out to be, computed exactly as FishingGame._reel computes it.
 *
 * Once the cast's target block exists, its outcome is fixed and public: it is a pure function of that block's
 * hash, the player, the cast and the catalog. The client uses this to play the bite, the hook and the fight
 * BEFORE the settlement transaction, instead of asking for a signature in the middle of the game.
 *
 * This is a prediction for presentation only. It decides nothing: the contract computes the same thing again
 * when it settles, and whatever it says is the result. fixtures/outcomes.json holds outcomes produced by the
 * contract itself (contracts/test/Vectors.t.sol), and the tests replay them through this module.
 */
import { encodeAbiParameters, keccak256, type Address, type Hex } from 'viem';

export interface ChainCatalog {
  config: { blendMaxWins: number; blendChancePpm: number; blendAmount: number; qualityPerCatch: number; qualityPerRarity: number };
  locations: { special: number; speciesIds: number[]; weights: number[] }[];
  species: { rarity: number; minWeight: number; maxWeight: number; hidden: boolean }[];
  specials: { speciesId: number; chancePpm: number; pity: number }[];
}

export interface CastInput {
  /** Hash of the cast's target block; null when it is more than 256 blocks old (the contract can no longer read it). */
  blockHash: Hex | null;
  player: Address;
  game: Address;
  nonce: bigint;
  locationId: number;
  /** FishingGame.loadout(rod, lure, special, location) for the tackle fixed at cast time. */
  loadout: { rodCatch: number; biteBps: number; rarity: number; weight: number; hiddenMult: number };
  blendWins: number;
  /** Bit per special id. */
  specialsFound: number;
  /** Dry-catch counters per special id. */
  dry: number[];
}

export type CastOutcome =
  | { kind: 'expired' }
  | { kind: 'missed' }
  | { kind: 'bottle'; amount: number }
  | { kind: 'caught'; speciesId: number; weight: number; /** 0 D … 4 S */ quality: number; special: boolean };

const MASK32 = 0xffffffffn;

export function castSeed(blockHash: Hex, player: Address, nonce: bigint, game: Address): bigint {
  return BigInt(keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'address' }, { type: 'uint64' }, { type: 'address' }], [blockHash, player, nonce, game])));
}

export function resolveCast(c: ChainCatalog, i: CastInput): CastOutcome {
  if (i.blockHash === null || /^0x0+$/.test(i.blockHash)) return { kind: 'expired' };
  const seed = castSeed(i.blockHash, i.player, i.nonce, i.game);
  if (seed % 10_000n >= BigInt(i.loadout.biteBps)) return { kind: 'missed' };

  if (i.blendWins < c.config.blendMaxWins && (seed >> 16n) % 1_000_000n < BigInt(c.config.blendChancePpm)) {
    return { kind: 'bottle', amount: c.config.blendAmount };
  }

  const loc = c.locations[i.locationId];
  let speciesId = -1;
  let special = false;
  if (loc.special !== 0) {
    const sid = loc.special - 1;
    const sp = c.specials[sid];
    const found = ((i.specialsFound >> sid) & 1) === 1;
    const dry = i.dry[sid] ?? 0;
    if ((!found && dry + 1 >= sp.pity) || (seed >> 40n) % 1_000_000n < BigInt(sp.chancePpm)) {
      special = true;
      speciesId = sp.speciesId;
    }
  }
  if (!special) speciesId = pickSpecies(c, loc, i.loadout.rarity, i.loadout.hiddenMult, seed >> 64n);

  const s = c.species[speciesId];
  return {
    kind: 'caught',
    speciesId,
    weight: rollWeight(s.minWeight, s.maxWeight, i.loadout.weight, seed >> 128n),
    quality: rollQuality(c, i.loadout.rodCatch, s.rarity, Number((seed >> 200n) % 10_000n)),
    special,
  };
}

export function pickSpecies(c: ChainCatalog, loc: ChainCatalog['locations'][number], rarityBonus: number, hiddenMult: number, rnd: bigint): number {
  const eff = loc.speciesIds.map((id, k) => {
    const s = c.species[id];
    return BigInt(loc.weights[k]) * BigInt(100 + s.rarity * rarityBonus) * BigInt(s.hidden ? hiddenMult : 1);
  });
  const total = eff.reduce((a, e) => a + e, 0n);
  let x = rnd % total;
  for (let k = 0; k < eff.length; k++) {
    if (x < eff[k]) return loc.speciesIds[k];
    x -= eff[k];
  }
  return loc.speciesIds[eff.length - 1];
}

export function rollWeight(minW: number, maxW: number, bonus: number, rnd: bigint): number {
  const u1 = rnd & MASK32;
  const u2 = (rnd >> 32n) & MASK32;
  const u = u1 < u2 ? u1 : u2;
  const w = ((BigInt(minW) + ((BigInt(maxW - minW) * u) >> 32n)) * BigInt(100 + bonus)) / 100n;
  return Number(w > BigInt(maxW) ? BigInt(maxW) : w);
}

export function rollQuality(c: ChainCatalog, rodCatch: number, rarity: number, roll: number): number {
  const x = roll + rodCatch * c.config.qualityPerCatch - rarity * c.config.qualityPerRarity;
  if (x < 1_500) return 0;
  if (x < 4_500) return 1;
  if (x < 7_500) return 2;
  if (x < 9_200) return 3;
  return 4;
}
