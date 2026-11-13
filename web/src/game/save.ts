/**
 * Save data: the fresh save, validation and versioned migrations. Storage itself (localStorage today, a backend
 * later) lives in play/state.ts; this module only turns raw JSON into a valid current Save.
 *
 * Trust note: a local save is player-editable. Nothing in it may later be taken as proof of a legitimate catch,
 * reward or NFT eligibility; that has to come from a trusted backend or the chain.
 */
import { TUNING } from './content';
import type { Save } from './types';

export const SAVE_VERSION = 1;

export function freshSave(now: number): Save {
  return {
    version: SAVE_VERSION,
    seq: 0,
    pearl: 0,
    blend: 0,
    blendWins: 0,
    xp: 0,
    energy: TUNING.maxEnergy,
    energyAt: now,
    refills: { day: 0, count: 0 },
    rods: { willow: { durability: 0 } },
    lures: {},
    equipped: { rod: 'willow', lure: null },
    location: 0,
    fish: [],
    dex: {},
    permanentUnlocks: [0],
    specialsFound: [],
    dry: {},
    activeSpecial: null,
    records: { overall: null, byLocation: {} },
    weeks: {},
    claimed: [],
    stats: { casts: 0, catches: 0, escaped: 0, sold: 0, earned: 0 },
  };
}

type Raw = Record<string, unknown>;
/** migrations[n] upgrades a save from version n to n + 1. */
export type Migration = (old: Raw) => Raw;

/** No schema changes yet. When Save changes: bump SAVE_VERSION and add the step from the previous version here. */
export const MIGRATIONS: Record<number, Migration> = {};

export interface Loaded {
  save: Save;
  /** 'fresh': nothing stored. 'ok': loaded as is. 'migrated': upgraded. 'newer': written by a newer client; kept untouched. 'corrupt': unreadable; kept untouched. */
  status: 'fresh' | 'ok' | 'migrated' | 'newer' | 'corrupt';
}

const isObj = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Turns stored JSON into a current Save. Never throws. A save that cannot be read or comes from a newer version
 * is reported, and the caller keeps the original bytes as a backup instead of overwriting them.
 */
export function loadSave(json: string | null, now: number, migrations = MIGRATIONS, current = SAVE_VERSION): Loaded {
  if (json === null || json === '') return { save: freshSave(now), status: 'fresh' };
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { save: freshSave(now), status: 'corrupt' };
  }
  if (!isObj(raw) || typeof raw.version !== 'number' || !Number.isInteger(raw.version) || raw.version < 1) {
    return { save: freshSave(now), status: 'corrupt' };
  }
  if (raw.version > current) return { save: freshSave(now), status: 'newer' };
  let data = raw;
  const from = raw.version;
  for (let v = from; v < current; v++) {
    const step = migrations[v];
    if (!step) return { save: freshSave(now), status: 'corrupt' };
    try {
      data = { ...step(data), version: v + 1 };
    } catch {
      return { save: freshSave(now), status: 'corrupt' };
    }
  }
  // Fill anything missing from the fresh shape, so a field added without a migration cannot crash the game.
  const base = freshSave(now) as unknown as Raw;
  const merged: Raw = { ...base, ...data, version: current };
  for (const k of ['equipped', 'records', 'stats', 'refills']) {
    merged[k] = { ...(base[k] as Raw), ...(isObj(data[k]) ? (data[k] as Raw) : {}) };
  }
  return { save: merged as unknown as Save, status: from === current ? 'ok' : 'migrated' };
}
