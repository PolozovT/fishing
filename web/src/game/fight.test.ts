import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { botInputs, fightParams, fightSeedOf, fightStart, fightTick, MAX_TICKS, packInputs, pointsFor, replayFight, unpackInputs, U } from './fight';

const PATH = fileURLToPath(new URL('./fixtures/fights.json', import.meta.url));

interface Vector {
  seed: string;
  difficulty: number;
  green: number;
  inputs: `0x${string}`;
  landed: boolean;
  ticks: number;
  good: number;
}

/** The same fights every run: seeds are hashes of small numbers, played by bots of different skill. */
function build(): Vector[] {
  const out: Vector[] = [];
  for (let i = 0; i < 96; i++) {
    const seed = fightSeedOf(BigInt(i + 1));
    const difficulty = i % 6;
    const green = [25_000, 31_250, 37_500, 62_000][i % 4];
    const lag = [0, 3, 5, 9][(i >> 2) % 4];
    // some recordings are cut short, some are all-hold or all-release
    const bits = i % 16 === 15 ? Array<boolean>(200).fill(true) : i % 16 === 14 ? Array<boolean>(300).fill(false) : botInputs(seed, difficulty, green, lag, i % 16 === 13 ? 64 : MAX_TICKS);
    const inputs = packInputs(bits);
    out.push({ seed: seed.toString(), difficulty, green, inputs, ...replayFight(seed, difficulty, green, inputs) });
  }
  return out;
}

describe('the tournament fight', () => {
  it('matches the vectors the Solidity verifier is tested against', () => {
    const built = build();
    if (process.env.WRITE_VECTORS || !existsSync(PATH)) writeFileSync(PATH, `${JSON.stringify(built, null, 1)}\n`);
    expect(built).toEqual(JSON.parse(readFileSync(PATH, 'utf8')));
  });

  it('covers every ending', () => {
    const v = build();
    expect(v.some((x) => x.landed)).toBe(true);
    expect(v.some((x) => !x.landed && x.ticks < unpackInputs(x.inputs).length)).toBe(true); // snapped or swam away
    expect(v.some((x) => !x.landed && x.ticks === 64)).toBe(true); // the recording ran out
    expect(new Set(v.filter((x) => x.landed).map((x) => x.difficulty)).size).toBe(6);
  });

  it('packs one bit per tick, least significant first', () => {
    expect(packInputs([true, false, false, false, false, false, false, false, true])).toBe('0x0101');
    const bits = [true, true, false, true, false, false, true, false, true, false, true];
    expect(unpackInputs(packInputs(bits)).slice(0, bits.length)).toEqual(bits);
  });

  it('snaps under a held line, drifts away on a slack one', () => {
    const p = fightParams(0, 31_250);
    const held = fightStart(1n << 230n);
    while (held.result === 'fighting') fightTick(held, true, p);
    expect(held.result).toBe('snapped');
    const loose = fightStart(1n << 230n);
    while (loose.result === 'fighting') fightTick(loose, false, p);
    expect(loose.result).toBe('slack');
    expect(loose.dist).toBeGreaterThanOrEqual(U);
  });

  it('rewards a quicker player with more of the fight in the green', () => {
    const share = (lag: number): number => {
      let good = 0;
      let ticks = 0;
      for (let i = 0; i < 200; i++) {
        const seed = fightSeedOf(BigInt(1000 + i));
        const r = replayFight(seed, 3, 31_250, packInputs(botInputs(seed, 3, 31_250, lag)));
        good += r.good;
        ticks += r.ticks;
      }
      return good / ticks;
    };
    expect(share(2)).toBeGreaterThan(share(8));
  });

  it('a decent player lands most fish, and harder fish get away more often', () => {
    const landed = (d: number): number => {
      let n = 0;
      for (let i = 0; i < 300; i++) {
        const seed = fightSeedOf(BigInt(5000 + i));
        if (replayFight(seed, d, 31_250, packInputs(botInputs(seed, d, 31_250, 4))).landed) n++;
      }
      return n / 300;
    };
    const easy = landed(0);
    const hard = landed(5);
    expect(easy).toBeGreaterThan(0.9);
    expect(hard).toBeLessThan(easy);
    expect(hard).toBeGreaterThan(0.2);
  });

  it('scores half for landing and half for the fight', () => {
    expect(pointsFor(400, 200, 200)).toBe(400);
    expect(pointsFor(400, 200, 0)).toBe(200);
    expect(pointsFor(400, 200, 100)).toBe(300);
    expect(pointsFor(1, 200, 0)).toBe(1);
  });
});
