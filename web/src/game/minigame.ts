/**
 * The hook and the reel fight, as pure simulations. No DOM, no timers, no randomness of their own: the caller
 * supplies the clock (dt) and the RNG, so the same code runs the game, the tests and the balance simulation.
 *
 * The fight has one gauge: line tension. Holding reels in and raises tension, letting go lowers it. While tension
 * sits in the green band the fish comes closer; too slack and it swims away; at the top of the gauge the line
 * snaps. Every so often the fish jerks: a short warning, then a burst that drives tension up by itself, so the
 * player has to let go in time. Quality is the share of the fight spent in the green.
 */
import type { Quality, Rarity, Rng } from './types';

// ------------------------------------------------------------------ difficulty

/** How hard a fish fights: its rarity plus how rough the water is, 0 (a pond roach) … 5 (a legend in white water). */
export type Difficulty = 0 | 1 | 2 | 3 | 4 | 5;

export const difficultyOf = (rarity: Rarity, waterTier: number): Difficulty => Math.max(0, Math.min(5, rarity + waterTier)) as Difficulty;

/** Seconds the player has to hook after the float dips. */
const HOOK_WINDOW = [1.6, 1.5, 1.35, 1.2, 1.0, 0.85];
export const hookWindow = (d: Difficulty): number => HOOK_WINDOW[d];

/** Seconds of waiting before the float dips: [min, max]. A lure's catch shortens it (`quick` 0.6 … 1). */
export function biteDelay(waterTier: number, quick: number, rng: Rng): number {
  const [lo, hi] = waterTier >= 2 ? [3, 7] : [2, 5];
  return (lo + rng() * (hi - lo)) * quick;
}

/** A hook set in the first part of the window is "clean": the fight starts with the fish a little closer. */
export const CLEAN_HOOK_SHARE = 0.45;
export const CLEAN_HOOK_HEAD_START = 0.1;
export const isCleanHook = (reaction: number, d: Difficulty): boolean => reaction <= hookWindow(d) * CLEAN_HOOK_SHARE;

// ------------------------------------------------------------------ the fight

export interface ReelParams {
  /** Green band of the tension gauge: [from, to], 0..1. */
  green: [number, number];
  /** Tension per second while holding / while released. */
  rise: number;
  fall: number;
  /** Extra tension per second during a jerk. */
  surge: number;
  /** Distance reeled in per second in the green (the fight starts at START_DIST). */
  reel: number;
  /** Distance the fish gains per second while the line is slack. */
  drift: number;
  /** Seconds of calm between jerks, the warning before one, and how long a jerk lasts: [min, max]. */
  calm: [number, number];
  tell: number;
  pull: [number, number];
}

export type Mood = 'calm' | 'warn' | 'pull';

export interface ReelState {
  tension: number;
  /** 0 = at the pier (landed), 1 = gone. */
  dist: number;
  mood: Mood;
  /** Strength of the current (or coming) jerk, as a multiple of the fish's usual one: some jerks are vicious. */
  power: number;
  /** Time of the next mood change. */
  next: number;
  t: number;
  /** Seconds spent in the green. */
  good: number;
  result: 'fighting' | 'landed' | 'escaped';
  /** Why it escaped. */
  lost?: 'snapped' | 'slack';
}

export const START_DIST = 0.7;
const GREEN_CENTRE = 0.56;
/** The rod's zone stat (0.20 starter … 0.30 cap) is the width of the green band, times this. */
const GREEN_PER_ZONE = 1.25;

export const greenWidth = (zone: number): number => zone * GREEN_PER_ZONE;

const REEL = [0.14, 0.128, 0.118, 0.108, 0.1, 0.094];
/** Each jerk is this many times the fish's base strength, picked at random. */
const JERK_MIN = 0.6;
const JERK_MAX = 1.6;
const SURGE = [0.5, 0.56, 0.62, 0.67, 0.71, 0.75];
const DRIFT = [0.05, 0.065, 0.08, 0.095, 0.11, 0.125];
const TELL = [0.5, 0.46, 0.42, 0.38, 0.34, 0.3];
const CALM: [number, number][] = [
  [2.6, 4.0],
  [2.2, 3.5],
  [1.9, 3.0],
  [1.6, 2.6],
  [1.3, 2.2],
  [1.1, 1.9],
];
const PULL: [number, number][] = [
  [0.35, 0.6],
  [0.42, 0.75],
  [0.5, 0.9],
  [0.58, 1.05],
  [0.66, 1.2],
  [0.74, 1.35],
];

/**
 * Fight parameters. Harder fish jerk harder, more often and with less warning, and come in slower.
 * `zone` is the rod's stat: a better rod widens the green band. `ease` (0, 1, 2 …) widens it further and softens
 * the jerks: used when a player retries the same fish, so nobody is stuck on one fight.
 */
export function reelParams(d: Difficulty, zone: number, ease = 0): ReelParams {
  const w = Math.min(0.62, greenWidth(zone) * (1 + 0.3 * ease));
  return {
    green: [GREEN_CENTRE - w / 2, GREEN_CENTRE + w / 2],
    rise: 0.5,
    fall: 0.8,
    surge: SURGE[d] / (1 + 0.25 * ease),
    reel: REEL[d],
    drift: DRIFT[d],
    calm: CALM[d],
    tell: TELL[d],
    pull: PULL[d],
  };
}

/** `headStart` shortens the starting distance (a clean hook). */
export function reelStart(rng: Rng, headStart = 0): ReelState {
  return { tension: 0.25, dist: Math.max(0.3, START_DIST - headStart), mood: 'calm', power: 1, next: 1.5 + rng() * 0.8, t: 0, good: 0, result: 'fighting' };
}

export type Band = 'slack' | 'green' | 'red';
export const bandOf = (tension: number, p: ReelParams): Band => (tension < p.green[0] ? 'slack' : tension <= p.green[1] ? 'green' : 'red');

/** Advances the fight by `dt` seconds. `hold` is whether the player is reeling right now. Returns a new state. */
export function reelStep(s: ReelState, hold: boolean, dt: number, p: ReelParams, rng: Rng): ReelState {
  if (s.result !== 'fighting') return s;
  const n = { ...s };
  n.t += dt;
  if (n.t >= n.next) {
    if (n.mood === 'calm') {
      n.mood = 'warn';
      n.power = JERK_MIN + rng() * (JERK_MAX - JERK_MIN);
      n.next = n.t + p.tell;
    } else if (n.mood === 'warn') {
      n.mood = 'pull';
      n.next = n.t + p.pull[0] + rng() * (p.pull[1] - p.pull[0]);
    } else {
      n.mood = 'calm';
      n.next = n.t + p.calm[0] + rng() * (p.calm[1] - p.calm[0]);
    }
  }
  n.tension = Math.max(0, n.tension + ((hold ? p.rise : -p.fall) + (n.mood === 'pull' ? p.surge * n.power : 0)) * dt);
  if (n.tension >= 1) {
    n.tension = 1;
    n.result = 'escaped';
    n.lost = 'snapped';
    return n;
  }
  const band = bandOf(n.tension, p);
  if (band === 'green') n.good += dt;
  // the fish comes in while the line is tight (green or red) and gains ground while it is slack
  n.dist += (band === 'slack' ? p.drift * (n.mood === 'pull' ? 2 : 1) : -p.reel) * dt;
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
  if (acc >= 0.86) return 'S';
  if (acc >= 0.76) return 'A';
  if (acc >= 0.64) return 'B';
  if (acc >= 0.5) return 'C';
  return 'D';
}

// ------------------------------------------------------------------ a stand-in player, for simulations

export interface Skill {
  /** Seconds between seeing something and acting on it. */
  lag: number;
  /** Error reading the gauge, in gauge units. */
  noise: number;
  /** Chance of not noticing a warning at all (then the jerk itself is the cue, one lag later). */
  miss: number;
}
export const SKILLS = {
  experienced: { lag: 0.18, noise: 0.04, miss: 0.04 },
  novice: { lag: 0.32, noise: 0.08, miss: 0.2 },
} satisfies Record<string, Skill>;

/**
 * Plays one fight the way a person roughly would: keeps tension near the middle of the green, lets go when it
 * notices a warning or a jerk, and takes up slack carefully while the fish pulls. A model, not a measurement.
 */
export function simulateFight(p: ReelParams, rng: Rng, skill: Skill = SKILLS.experienced, headStart = 0): { landed: boolean; quality: Quality; seconds: number; lost?: 'snapped' | 'slack' } {
  const dt = 1 / 30;
  let s = reelStart(rng, headStart);
  const seen: { tension: number; mood: Mood }[] = [];
  const lagSteps = Math.round(skill.lag / dt);
  const aimAt = (p.green[0] + p.green[1]) / 2;
  let err = 0;
  let missedThisWarning = false;
  let lastMood: Mood = 'calm';
  for (let i = 0; i < 30 * 120 && s.result === 'fighting'; i++) {
    if (s.mood === 'warn' && lastMood !== 'warn') missedThisWarning = rng() < skill.miss;
    lastMood = s.mood;
    seen.push({ tension: s.tension, mood: s.mood });
    if (i % 6 === 0) err = (rng() - 0.5) * 2 * skill.noise;
    const was = seen[Math.max(0, seen.length - 1 - lagSteps)];
    const tension = was.tension + err;
    const alarmed = was.mood === 'pull' || (was.mood === 'warn' && !missedThisWarning);
    // during a jerk: only take up slack; otherwise hold the middle of the green
    const hold = alarmed ? tension < p.green[0] : tension < aimAt;
    s = reelStep(s, hold, dt, p, rng);
  }
  return { landed: s.result === 'landed', quality: qualityOf(accuracy(s)), seconds: s.t, lost: s.lost };
}
