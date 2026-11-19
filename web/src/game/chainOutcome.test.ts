import { describe, expect, it } from 'vitest';
import { resolveCast, type CastInput, type ChainCatalog } from './chainOutcome';
import { BLEND_PRIZE, LOCATIONS, SPECIALS, SPECIES } from './content';
import vectors from './fixtures/outcomes.json';

/** The catalog as the client knows it (play/chain.ts checks it against the contracts at start-up). */
function catalog(blendChancePpm: number): ChainCatalog {
  return {
    config: { blendChancePpm, blendMaxWins: 1, qualityPerCatch: 150, qualityPerRarity: 300 },
    locations: LOCATIONS.map((l) => ({
      special: l.special ? SPECIALS.findIndex((s) => s.id === l.special) + 1 : 0,
      speciesIds: l.pool.map(([id]) => id),
      weights: l.pool.map(([, w]) => w),
    })),
    species: SPECIES.map((s) => ({ rarity: s.rarity, minWeight: s.minWeight, maxWeight: s.maxWeight, hidden: !!s.hidden })),
    specials: SPECIALS.map((s) => ({ speciesId: s.speciesId, chancePpm: Math.round(s.chance * 1_000_000), pity: s.pity })),
  };
}

interface Vector extends Omit<CastInput, 'nonce' | 'blockHash' | 'player' | 'game' | 'bottleAmount'> {
  blockHash: string;
  player: string;
  game: string;
  nonce: number;
  blendChancePpm: number;
  expected: { kind: string; speciesId?: number; weight?: number; quality?: number; amountWei?: string };
}

describe('predicting a cast outcome', () => {
  /** The vectors were written with the default prize; the amount is an input of the prediction, read from the pool. */
  const list = (vectors as Vector[]).map((v) => ({ ...v, bottleAmount: BLEND_PRIZE.amount }));

  it('has vectors for every branch', () => {
    const kinds = new Set(list.map((v) => v.expected.kind));
    expect(kinds).toEqual(new Set(['caught', 'missed', 'bottle']));
    expect(list.some((v) => v.expected.kind === 'caught' && SPECIES[v.expected.speciesId!].special)).toBe(true);
    expect(new Set(list.map((v) => v.locationId)).size).toBe(LOCATIONS.length);
    expect(list.some((v) => v.loadout.rodCatch < 0)).toBe(true);
    expect(list.some((v) => v.bottleOpen)).toBe(true);
  });

  it('never predicts a bottle while none is open for the player', () => {
    const open = list.find((v) => v.expected.kind === 'bottle')!;
    const input = { ...open, blockHash: open.blockHash as `0x${string}`, player: open.player as `0x${string}`, game: open.game as `0x${string}`, nonce: BigInt(open.nonce) };
    expect(resolveCast(catalog(open.blendChancePpm), input).kind).toBe('bottle');
    expect(resolveCast(catalog(open.blendChancePpm), { ...input, bottleOpen: false }).kind).toBe('caught');
    // and the vectors hold bites the roll would have made a bottle, landed as fish because none was open
    const shut = list.filter((v) => !v.bottleOpen && v.expected.kind === 'caught');
    const wouldBe = shut.filter((v) => resolveCast(catalog(v.blendChancePpm), { ...v, bottleOpen: true, blockHash: v.blockHash as `0x${string}`, player: v.player as `0x${string}`, game: v.game as `0x${string}`, nonce: BigInt(v.nonce) }).kind === 'bottle');
    expect(wouldBe.length).toBeGreaterThan(0);
  });

  it('matches every outcome the contract produced', () => {
    for (const v of list) {
      const got = resolveCast(catalog(v.blendChancePpm), {
        ...v,
        blockHash: v.blockHash as `0x${string}`,
        player: v.player as `0x${string}`,
        game: v.game as `0x${string}`,
        nonce: BigInt(v.nonce),
      });
      const e = v.expected;
      if (e.kind === 'caught') {
        expect(got, `nonce ${v.nonce}`).toEqual({ kind: 'caught', speciesId: e.speciesId, weight: e.weight, quality: e.quality, special: !!SPECIES[e.speciesId!].special });
      } else if (e.kind === 'bottle') {
        expect(got, `nonce ${v.nonce}`).toEqual({ kind: 'bottle', amount: Number(BigInt(e.amountWei!) / 10n ** 18n) });
      } else {
        expect(got, `nonce ${v.nonce}`).toEqual({ kind: 'missed' });
      }
    }
  });

  it('reports an unreadable block as expired', () => {
    const v = list[0];
    const base = { ...v, player: v.player as `0x${string}`, game: v.game as `0x${string}`, nonce: BigInt(v.nonce) };
    expect(resolveCast(catalog(1000), { ...base, blockHash: null })).toEqual({ kind: 'expired' });
    expect(resolveCast(catalog(1000), { ...base, blockHash: `0x${'0'.repeat(64)}` })).toEqual({ kind: 'expired' });
  });

  it('depends on the player and the nonce, so outcomes cannot be shared or replayed', () => {
    const v = list.find((x) => x.expected.kind === 'caught')!;
    const base = { ...v, blockHash: v.blockHash as `0x${string}`, player: v.player as `0x${string}`, game: v.game as `0x${string}`, nonce: BigInt(v.nonce) };
    const c = catalog(v.blendChancePpm);
    const same = resolveCast(c, base);
    const outcomes = new Set<string>();
    for (let k = 1; k <= 20; k++) outcomes.add(JSON.stringify(resolveCast(c, { ...base, nonce: base.nonce + BigInt(k) })));
    expect(outcomes.size).toBeGreaterThan(5);
    expect(resolveCast(c, base)).toEqual(same);
  });
});
