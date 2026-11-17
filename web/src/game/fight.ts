/**
 * The tournament fight, in integers: the exact twin of contracts/src/FightVerifier.sol.
 *
 * A tournament scores a catch by how well it was fought, and the contract will not take the browser's word for
 * it. So the fight is a deterministic machine driven by one bit per tick ("is the player reeling?"): the browser
 * runs it live and records the bits, the contract runs it again on the recording. Everything here is integer
 * arithmetic on a fixed 50 ms tick so both sides compute the same thing; fixtures/fights.json pins that down
 * (the Solidity tests replay the same vectors).
 *
 * The free-play fight (minigame.ts) is a separate, floating-point model with retries; it decides nothing onchain.
 */
import { encodeAbiParameters, keccak256, type Address, type Hex } from 'viem';

/** The whole gauge, and the whole distance to the horizon. */
export const U = 100_000;
export const TICK_MS = 50;
export const MAX_TICKS = 1_200;
const RISE = 2_500;
const FALL = 4_000;
const GREEN_CENTRE = 56_000;
const MAX_GREEN = 62_000;

export const CALM = 0;
export const WARN = 1;
export const PULL = 2;
export type FightMood = typeof CALM | typeof WARN | typeof PULL;

export interface FightParams {
  lo: number;
  hi: number;
  reel: number;
  drift: number;
  surge: number;
  tell: number;
  calm: [number, number];
  pull: [number, number];
}

const REEL = [700, 640, 590, 540, 500, 470];
const DRIFT = [250, 325, 400, 475, 550, 625];
const SURGE = [2_500, 2_800, 3_100, 3_350, 3_550, 3_750];
const TELL = [10, 9, 8, 8, 7, 6];
const CALM_T: [number, number][] = [
  [52, 80],
  [44, 70],
  [38, 60],
  [32, 52],
  [26, 44],
  [22, 38],
];
const PULL_T: [number, number][] = [
  [7, 12],
  [8, 15],
  [10, 18],
  [12, 21],
  [13, 24],
  [15, 27],
];

/** `difficulty` 0 … 5 (rarity of the fish + how rough the water is); `green` is the width of the green band. */
export function fightParams(difficulty: number, green: number): FightParams {
  const d = Math.min(5, difficulty);
  const g = Math.min(MAX_GREEN, green);
  return {
    lo: GREEN_CENTRE - Math.floor(g / 2),
    hi: GREEN_CENTRE + Math.floor(g / 2),
    reel: REEL[d],
    drift: DRIFT[d],
    surge: SURGE[d],
    tell: TELL[d],
    calm: CALM_T[d],
    pull: PULL_T[d],
  };
}

export interface FightState {
  rng: number;
  tension: number;
  /** U = on the horizon, 0 = at the pier. */
  dist: number;
  mood: FightMood;
  /** Strength of the current (or coming) jerk, per mille of the fish's usual one. */
  power: number;
  /** Tick of the next mood change. */
  next: number;
  ticks: number;
  /** Ticks spent in the green. */
  good: number;
  result: 'fighting' | 'landed' | 'snapped' | 'slack';
}

/** xorshift32 */
function next(x: number): number {
  x ^= x << 13;
  x >>>= 0;
  x ^= x >>> 17;
  x ^= x << 5;
  return x >>> 0;
}

/** `seed` is Tournaments.fightSeed(castSeed): a uint256. */
export function fightStart(seed: bigint): FightState {
  let rng = Number(seed >> 224n);
  if (rng === 0) rng = 1;
  rng = next(rng);
  return { rng, tension: 25_000, dist: 70_000, mood: CALM, power: 1_000, next: 30 + (rng % 17), ticks: 0, good: 0, result: 'fighting' };
}

/** Advances the fight by one tick, in place. */
export function fightTick(s: FightState, hold: boolean, p: FightParams): void {
  if (s.result !== 'fighting') return;
  s.ticks += 1;
  if (s.ticks >= s.next) {
    s.rng = next(s.rng);
    if (s.mood === CALM) {
      s.mood = WARN;
      s.power = 600 + (s.rng % 1_001);
      s.next = s.ticks + p.tell;
    } else if (s.mood === WARN) {
      s.mood = PULL;
      s.next = s.ticks + p.pull[0] + (s.rng % (p.pull[1] - p.pull[0] + 1));
    } else {
      s.mood = CALM;
      s.next = s.ticks + p.calm[0] + (s.rng % (p.calm[1] - p.calm[0] + 1));
    }
  }
  const up = (hold ? RISE : 0) + (s.mood === PULL ? Math.floor((p.surge * s.power) / 1_000) : 0);
  const down = hold ? 0 : FALL;
  s.tension = Math.max(0, s.tension + up - down);
  if (s.tension >= U) {
    s.result = 'snapped';
    return;
  }
  if (s.tension < p.lo) {
    s.dist += s.mood === PULL ? p.drift * 2 : p.drift;
    if (s.dist >= U) s.result = 'slack';
  } else {
    if (s.tension <= p.hi) s.good += 1;
    if (s.dist <= p.reel) {
      s.dist = 0;
      s.result = 'landed';
    } else {
      s.dist -= p.reel;
    }
  }
}

export type FightBand = 'slack' | 'green' | 'red';
export const fightBand = (tension: number, p: FightParams): FightBand => (tension < p.lo ? 'slack' : tension <= p.hi ? 'green' : 'red');

/** One bit per tick, least significant bit first: the format FightVerifier.replay reads. */
export function packInputs(bits: boolean[]): Hex {
  const bytes = new Uint8Array(Math.ceil(bits.length / 8));
  bits.forEach((b, i) => {
    if (b) bytes[i >> 3] |= 1 << (i & 7);
  });
  return `0x${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

export function unpackInputs(hex: Hex): boolean[] {
  const out: boolean[] = [];
  for (let i = 2; i < hex.length; i += 2) {
    const byte = parseInt(hex.slice(i, i + 2), 16);
    for (let b = 0; b < 8; b++) out.push(((byte >> b) & 1) === 1);
  }
  return out;
}

/** What the contract will make of a recording. */
export function replayFight(seed: bigint, difficulty: number, green: number, inputs: Hex): { landed: boolean; ticks: number; good: number } {
  const p = fightParams(difficulty, green);
  const s = fightStart(seed);
  const bits = unpackInputs(inputs);
  const n = Math.min(bits.length, MAX_TICKS);
  for (let i = 0; i < n && s.result === 'fighting'; i++) fightTick(s, bits[i], p);
  return { landed: s.result === 'landed', ticks: s.ticks, good: s.good };
}

/** Tournaments.pointsFor: half the points for landing the fish, the rest by the share of the fight in the green. */
export const pointsFor = (base: number, ticks: number, good: number): number => Math.max(1, Math.floor((base * (5_000 + Math.floor((5_000 * good) / ticks)) + 5_000) / 10_000));

export function tournamentCastSeed(blockHash: Hex, player: Address, id: bigint, castNo: bigint, tournaments: Address): bigint {
  return BigInt(
    keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'address' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'address' }], [blockHash, player, id, castNo, tournaments])),
  );
}

export const fightSeedOf = (castSeed: bigint): bigint => BigInt(keccak256(encodeAbiParameters([{ type: 'uint256' }], [castSeed])));

// ------------------------------------------------------------------ a stand-in player, for tests and vectors

/**
 * Plays a fight roughly like a person: holds the middle of the green, lets go when it notices a warning or a jerk
 * (`lag` ticks late), and only takes up slack while the fish pulls. Returns the recording.
 */
export function botInputs(seed: bigint, difficulty: number, green: number, lag = 4, maxTicks = MAX_TICKS): boolean[] {
  const p = fightParams(difficulty, green);
  const s = fightStart(seed);
  const seen: { tension: number; mood: FightMood }[] = [];
  const aim = (p.lo + p.hi) / 2;
  const bits: boolean[] = [];
  while (s.result === 'fighting' && bits.length < maxTicks) {
    seen.push({ tension: s.tension, mood: s.mood });
    const was = seen[Math.max(0, seen.length - 1 - lag)];
    const hold = was.mood === CALM ? was.tension < aim : was.tension < p.lo;
    bits.push(hold);
    fightTick(s, hold, p);
  }
  return bits;
}

// ------------------------------------------------------------------ what a tournament cast hooks

/** Rarity points of a species, as CatchMath.score has them. */
const RARITY_POINTS = [10, 25, 60, 150, 400, 800];
const QUALITY_BPS = [8_000, 9_000, 10_000, 11_500, 13_000];

/** CatchMath.score: rarity points × weight factor (0.7–1.5) × quality factor, in integers. */
export function basePoints(rarity: number, minWeight: number, maxWeight: number, weight: number, quality: number): number {
  const ratio = Math.floor((weight * 10_000) / (minWeight + Math.floor((maxWeight - minWeight) / 3)));
  const raw = RARITY_POINTS[rarity] * Math.min(15_000, Math.max(7_000, ratio)) * QUALITY_BPS[quality];
  return Math.floor((raw + 5e7) / 1e8);
}
