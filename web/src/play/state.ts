/**
 * The persistence boundary of the local game: holds the current Save, writes it to localStorage and notifies the
 * UI. Game rules live in game/ and never touch storage. A backend (or the chain) replaces this module later.
 *
 * Everything stored here is player-editable and therefore untrusted: fine for a local game, never a proof of
 * a real catch, reward or NFT eligibility.
 */
import { LOCAL_GAME } from '../config';
import { GameError } from '../game/actions';
import { grantUnlocks } from '../game/progress';
import { freshSave, loadSave } from '../game/save';
import type { Save } from '../game/types';
import { emit } from '../store';
import { toast } from '../ui/toast';

const KEY = 'onchain-fishing:save';

function read(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** False when the stored save is unreadable or from a newer client: we then play in memory and leave it alone. */
let writable = true;

function boot(): Save {
  // On the contracts the save is a view of chain state: it starts empty and play/chain.ts fills it in.
  if (!LOCAL_GAME) return freshSave(Date.now());
  const raw = read();
  const loaded = loadSave(raw, Date.now());
  if (loaded.status === 'corrupt' || loaded.status === 'newer') {
    writable = false;
    try {
      // keep the original bytes, so nothing is lost if a later version can read them
      if (raw !== null) localStorage.setItem(`${KEY}:backup-${Date.now()}`, raw);
      writable = true;
    } catch {
      /* storage is full or blocked: stay read-only */
    }
    queueMicrotask(() =>
      toast(loaded.status === 'newer' ? 'This save was made by a newer version of the game. A backup was kept; starting fresh here.' : 'The saved game could not be read. A backup was kept; starting fresh.', 'err'),
    );
  }
  // requirements may have been lowered between versions: open what is already earned
  return grantUnlocks(loaded.save).save;
}

let save: Save = boot();
let revision = 0;

export const getSave = (): Save => save;
/** Changes on every commit: a cheap render signature. */
export const rev = (): number => revision;

function persist(): void {
  if (!writable || !LOCAL_GAME) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(save));
  } catch (e) {
    console.warn('save failed', e);
  }
}

/** Swaps in a new save in one step, then persists and re-renders. */
export function commit(next: Save): void {
  save = next;
  revision++;
  persist();
  emit();
}

/** Chain mode: swaps in the state just read from the contracts. Nothing is persisted. */
export function replaceSave(next: Save): void {
  save = next;
  revision++;
  emit();
}

/** Runs a game action; a GameError becomes a toast and nothing changes. Returns the action's result or undefined. */
export function act<T>(fn: (s: Save) => T, pick: (r: T) => Save): T | undefined {
  try {
    const r = fn(save);
    commit(pick(r));
    return r;
  } catch (e) {
    if (e instanceof GameError) toast(e.message, 'err');
    else throw e;
    return undefined;
  }
}

/** Shorthand for actions that return the save itself. */
export const apply = (fn: (s: Save) => Save): boolean => act(fn, (s) => s) !== undefined;

// another tab saved: follow it, so two tabs cannot pay out the same fish twice
window.addEventListener('storage', (e) => {
  if (!LOCAL_GAME || e.key !== KEY || e.newValue === null) return;
  const loaded = loadSave(e.newValue, Date.now());
  if (loaded.status === 'ok' || loaded.status === 'migrated') {
    save = loaded.save;
    revision++;
    emit();
  }
});
