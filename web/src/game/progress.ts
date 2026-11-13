/** Progression: location unlocks, the encyclopedia view and collection achievements. */
import { LOCATIONS, SPECIALS, SPECIES, special } from './content';
import { levelOf } from './economy';
import type { LocationDef, Save, Unlock } from './types';

export const discoveredCount = (s: Save): number => Object.keys(s.dex).length;

export function unlockMet(u: Unlock, s: Save): boolean {
  switch (u.type) {
    case 'start':
      return true;
    case 'level':
      return levelOf(s.xp) >= u.level;
    case 'species':
      return discoveredCount(s) >= u.count;
    case 'special':
      return s.specialsFound.includes(u.special);
  }
}

/** How to unlock a place, for the locked card. */
export function unlockText(u: Unlock, s: Save): string {
  switch (u.type) {
    case 'start':
      return 'Open from the start';
    case 'level':
      return `Reach level ${u.level} (you are level ${levelOf(s.xp)})`;
    case 'species':
      return `Discover ${u.count} species (${Math.min(discoveredCount(s), u.count)}/${u.count})`;
    case 'special': {
      const sp = special(u.special);
      const where = LOCATIONS.filter((l) => l.special === u.special && isUnlocked(s, l))
        .map((l) => l.name)
        .join(' or ');
      const all = LOCATIONS.filter((l) => l.special === u.special).map((l) => l.name);
      return `Catch the ${sp?.name ?? u.special}: it lives in ${where || all.join(' or ')}`;
    }
  }
}

export const isUnlocked = (s: Save, loc: LocationDef): boolean => s.permanentUnlocks.includes(loc.id);

/** Holding a specimen of a special right now (the future "owns the NFT" check). */
export const holdsSpecial = (s: Save, specialId: string): boolean => {
  const sp = special(specialId);
  return !!sp && s.fish.some((f) => f.speciesId === sp.speciesId);
};

/** Can the player fish here: the permanent unlock, plus the ownership requirement if the location has one. */
export function canEnter(s: Save, loc: LocationDef): boolean {
  if (!isUnlocked(s, loc)) return false;
  return !loc.ownership || holdsSpecial(s, loc.ownership.special);
}

/** Adds every location whose requirement is now met. Unlocks are never removed. Returns the new ids. */
export function grantUnlocks(s: Save): { save: Save; gained: number[] } {
  const gained = LOCATIONS.filter((l) => !s.permanentUnlocks.includes(l.id) && unlockMet(l.unlock, s)).map((l) => l.id);
  return gained.length ? { save: { ...s, permanentUnlocks: [...s.permanentUnlocks, ...gained] }, gained } : { save: s, gained };
}

/** Species that can be met at a location: its pool plus its special. */
export function locationSpecies(loc: LocationDef): number[] {
  const ids = loc.pool.map(([id]) => id);
  const sp = loc.special ? special(loc.special) : undefined;
  return sp ? [...ids, sp.speciesId] : ids;
}

export const speciesLocations = (speciesId: number): LocationDef[] => LOCATIONS.filter((l) => locationSpecies(l).includes(speciesId));

/** A location's collection is complete when every species of its pool is discovered (the special is a bonus). */
export function locationProgress(s: Save, loc: LocationDef): { have: number; of: number } {
  const ids = loc.pool.map(([id]) => id);
  return { have: ids.filter((id) => s.dex[id]).length, of: ids.length };
}

export interface Achievement {
  id: string;
  title: string;
  desc: string;
  have: number;
  goal: number;
  reward: number;
  done: boolean;
  claimed: boolean;
}

const LOCATION_REWARDS = [150, 300, 600, 1200, 2500, 1500, 2500, 5000];
const DEX_STEPS: [number, number][] = [
  [10, 300],
  [20, 1000],
  [30, 3000],
];

export function achievements(s: Save): Achievement[] {
  const out: Omit<Achievement, 'done' | 'claimed'>[] = [];
  for (const loc of LOCATIONS) {
    const p = locationProgress(s, loc);
    out.push({ id: `loc:${loc.id}`, title: `${loc.name} collection`, desc: `Discover every species of ${loc.name}`, have: p.have, goal: p.of, reward: LOCATION_REWARDS[loc.id] ?? 500 });
  }
  const dex = discoveredCount(s);
  for (const [goal, reward] of DEX_STEPS) out.push({ id: `dex:${goal}`, title: `${goal} species`, desc: `Discover ${goal} different species`, have: Math.min(dex, goal), goal, reward });
  const legends = SPECIES.filter((sp) => sp.rarity >= 4);
  const got = legends.filter((sp) => s.dex[sp.id]).length;
  out.push({ id: 'legend:1', title: 'Legend hunter', desc: 'Discover a Legendary or Mythic species', have: Math.min(got, 1), goal: 1, reward: 500 });
  out.push({ id: 'legend:all', title: 'Master of legends', desc: 'Discover every Legendary and Mythic species', have: got, goal: legends.length, reward: 10000 });
  out.push({ id: 'special:all', title: 'Keeper of the three', desc: 'Find all three special fish', have: s.specialsFound.length, goal: SPECIALS.length, reward: 3000 });
  return out.map((a) => ({ ...a, done: a.have >= a.goal, claimed: s.claimed.includes(a.id) }));
}

export interface CollectorStats {
  discovered: number;
  total: number;
  legendary: number;
  legendaryTotal: number;
  locationsComplete: number;
  locations: number;
  title: string;
}

const TITLES: [number, string][] = [
  [0, 'Novice'],
  [6, 'Angler'],
  [14, 'Naturalist'],
  [22, 'Curator'],
  [30, 'Master Collector'],
];

export function collectorStats(s: Save): CollectorStats {
  const discovered = discoveredCount(s);
  const legends = SPECIES.filter((sp) => sp.rarity >= 4);
  return {
    discovered,
    total: SPECIES.length,
    legendary: legends.filter((sp) => s.dex[sp.id]).length,
    legendaryTotal: legends.length,
    locationsComplete: LOCATIONS.filter((l) => {
      const p = locationProgress(s, l);
      return p.have === p.of;
    }).length,
    locations: LOCATIONS.length,
    title: [...TITLES].reverse().find(([n]) => discovered >= n)?.[1] ?? 'Novice',
  };
}
