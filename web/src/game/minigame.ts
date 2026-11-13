/**
 * The reel fight, as a pure simulation. One gauge: line tension. Holding reels in and raises tension, letting go
 * lowers it. While tension sits in the green band the fish comes closer; too slack and it swims away; at the top
 * of the gauge the line snaps. Now and then the fish pulls hard, tension climbs by itself and the player has to
 * let go. Quality is the share of the fight spent in the green.
 */
import type { Quality, Rarity, Rng } from './types';

export interface ReelParams {
  /** Green band of the tension gauge: [from, to], 0..1. */
  green: [number, number];
  /** Tension per second while holding / while released. */
  rise: number;
  fall: number;
  /** Extra tension per second while the fish pulls. */
  surge: number;
  /** Distance reeled in per second in the green (the fight starts at distance START_DIST). */
  reel: number;
  /** Distance the fish gains per second while the line is slack. */
  drift: number;
  /** Seconds of calm between pulls, and how long a pull lasts: [min, max]. */
  calm: [number, number];
  pull: [number, number];
}

export interface ReelState {
  tension: number;
  /** 0 = at the pier (landed), 1 = gone. */
  dist: number;
  /** The fish is pulling right now. */
  pulling: boolean;
  /** Time of the next change between calm and pulling. */
  next: number;
  t: number;
  /** Seconds spent in the green. */
  good: number;
  result: 'fighting' | 'landed' | 'escaped';
  /** Why it escaped. */
  lost?: 'snapped' | 'slack';
}

export const START_DIST = 0.7;
const GREEN_CENTRE = 0.58;
/** The rod's zone stat (0.20 starter … 0.30 cap) is the width of the green band, times this. */
const GREEN_PER_ZONE = 1.1;

export const greenWidth = (zone: number): number => zone * GREEN_PER_ZONE;

const REEL = [0.16, 0.15, 0.135, 0.12, 0.105, 0.095];
const SURGE = [0.28, 0.34, 0.4, 0.46, 0.52, 0.56];
const CALM: [number, number][] = [
  [2.2, 3.6],
  [1.9, 3.2],
  [1.6, 2.8],
  [1.3, 2.4],
  [1.1, 2.0],
  [0.9, 1.7],
];
const PULL: [number, number][] = [
  [0.6, 1.0],
  [0.7, 1.1],
  [0.8, 1.3],
  [0.9, 1.5],
  [1.0, 1.7],
  [1.1, 1.9],
];

/** Rarer fish pull harder, more often, and come in slower. The rod's catch bonus arrives as a wider green band. */
export function reelParams(rarity: Rarity, zone: number): ReelParams {
  const w = greenWidth(zone);
  return { green: [GREEN_CENTRE - w / 2, GREEN_CENTRE + w / 2], rise: 0.5, fall: 0.6, surge: SURGE[rarity], reel: REEL[rarity], drift: 0.06, calm: CALM[rarity], pull: PULL[rarity] };
}

export function reelStart(rng: Rng): ReelState {
  return { tension: 0.25, dist: START_DIST, pulling: false, next: 1.4 + rng() * 0.8, t: 0, good: 0, result: 'fighting' };
}

export type Band = 'slack' | 'green' | 'red';
export const bandOf = (tension: number, p: ReelParams): Band => (tension < p.green[0] ? 'slack' : tension <= p.green[1] ? 'green' : 'red');

/** Advances the fight by `dt` seconds. `hold` is whether the player is reeling right now. Returns a new state. */
export function reelStep(s: ReelState, hold: boolean, dt: number, p: ReelParams, rng: Rng): ReelState {
  if (s.result !== 'fighting') return s;
  const n = { ...s };
  n.t += dt;
  if (n.t >= n.next) {
    n.pulling = !n.pulling;
    const [a, b] = n.pulling ? p.pull : p.calm;
    n.next = n.t + a + rng() * (b - a);
  }
  n.tension = Math.max(0, n.tension + ((hold ? p.rise : -p.fall) + (n.pulling ? p.surge : 0)) * dt);
  if (n.tension >= 1) {
    n.tension = 1;
    n.result = 'escaped';
    n.lost = 'snapped';
    return n;
  }
  const band = bandOf(n.tension, p);
  if (band === 'green') n.good += dt;
  // the fish comes in while the line is tight (green or red) and gains ground while it is slack
  n.dist += (band === 'slack' ? p.drift * (n.pulling ? 2 : 1) : -p.reel) * dt;
  if (n.dist <= 0) {
    n.dist = 0;
    n.result = 'landed';
  } else if (n.dist >= 1) {
    n.dist = 1;
    n.result = 'escaped';
    n.lost = 'slack';
  }
  return n;
}

export const accuracy = (s: ReelState): number => (s.t > 0 ? s.good / s.t : 0);

/** Quality grade from the share of the fight spent in the green. */
export function qualityOf(acc: number): Quality {
  if (acc >= 0.88) return 'S';
  if (acc >= 0.78) return 'A';
  if (acc >= 0.66) return 'B';
  if (acc >= 0.52) return 'C';
  return 'D';
}

/**
 * A simple controller for simulations: reels while the tension it saw `lag` seconds ago (plus some reading
 * error) is below the middle of the green. `lag` 0.18 and noise 0.04 is a decent player; 0.3 and 0.08 a novice.
 */
export function simulateFight(p: ReelParams, rng: Rng, lag = 0.18, noise = 0.04): { landed: boolean; quality: Quality; seconds: number } {
  const dt = 1 / 30;
  let s = reelStart(rng);
  const seen: number[] = [];
  const lagSteps = Math.round(lag / dt);
  const aimAt = (p.green[0] + p.green[1]) / 2;
  let err = 0;
  for (let i = 0; i < 30 * 90 && s.result === 'fighting'; i++) {
    seen.push(s.tension);
    if (i % 6 === 0) err = (rng() - 0.5) * 2 * noise;
    const tensionSeen = seen[Math.max(0, seen.length - 1 - lagSteps)] + err;
    s = reelStep(s, tensionSeen < aimAt, dt, p, rng);
  }
  return { landed: s.result === 'landed', quality: qualityOf(accuracy(s)), seconds: s.t };
}
