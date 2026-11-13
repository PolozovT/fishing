/**
 * Everything the UI can ask the game to do, with one implementation per backend: the local save (pure reducers
 * from game/actions.ts) or the contracts (a transaction, then a fresh read). Every operation resolves to whether
 * it happened; failures are already reported to the player.
 */
import { LOCAL_GAME } from '../config';
import * as A from '../game/actions';
import { SPECIALS } from '../game/content';
import { achievements } from '../game/progress';
import type { Save } from '../game/types';
import { emit, state } from '../store';
import { LURES, RODS } from '../tackle/catalog';
import { buyPearlOnChain, loadChainSave, loadStandings, rememberLocation, toggleFavouriteLocal, tx, type GameCall } from './chain';
import { toast } from '../ui/toast';
import { act, apply, getSave, replaceSave } from './state';

export const CHAIN = !LOCAL_GAME;

let refreshing: Promise<void> | null = null;
/** Re-reads the player's state from the contracts (chain mode only). Concurrent calls share one read. */
export function refresh(): Promise<void> {
  if (!CHAIN) return Promise.resolve();
  refreshing ??= (async () => {
    try {
      const s = await loadChainSave();
      if (s) replaceSave(s);
    } catch (e) {
      console.warn('refresh failed', e);
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

export async function refreshStandings(): Promise<void> {
  if (!CHAIN) return;
  try {
    await loadStandings();
    emit();
  } catch (e) {
    console.warn('standings failed', e);
  }
}

/** A transaction followed by a fresh read. */
async function send(label: string, request: GameCall): Promise<boolean> {
  const ok = !!(await tx(label, request));
  if (ok) await refresh();
  return ok;
}

const rodIndex = (id: string): number => RODS.findIndex((r) => r.id === id);
const lureIndex = (id: string): number => LURES.findIndex((l) => l.id === id);
const local = (fn: (s: Save) => Save): Promise<boolean> => Promise.resolve(apply(fn));

export const ops = {
  buyRod: (id: string): Promise<boolean> => (CHAIN ? send('Buy rod', { functionName: 'buyRod', args: [rodIndex(id)] }) : local((s) => A.buyRod(s, id))),

  /** Buys the lure; an empty lure slot takes it. */
  buyLure: (id: string): Promise<boolean> =>
    CHAIN ? send('Buy lure', { functionName: 'buyLure', args: [lureIndex(id)] }) : local((s) => (s.lures[id] ? A.buyLure(s, id) : A.equipLure(A.buyLure(s, id), id))),

  equipRod: (id: string): Promise<boolean> => (CHAIN ? send('Equip rod', { functionName: 'equipRod', args: [rodIndex(id)] }) : local((s) => A.equipRod(s, id))),

  equipLure: (id: string | null): Promise<boolean> =>
    CHAIN ? send(id ? 'Equip lure' : 'Take the lure off', { functionName: 'equipLure', args: [id ? lureIndex(id) + 1 : 0] }) : local((s) => A.equipLure(s, id)),

  repairRod: (id: string): Promise<boolean> => (CHAIN ? send('Repair rod', { functionName: 'repairRod', args: [rodIndex(id)] }) : local((s) => A.repairRod(s, id))),

  /** Buys PEARL for BLEND. `blendAmount` is what the player typed. */
  async buyPearl(blendAmount: string): Promise<boolean> {
    if (!CHAIN) return apply((s) => A.buyPearl(s, Number(blendAmount.replace(',', '.'))).save);
    if (!state.wallet) {
      toast('Connect with Fluent to play', 'info');
      return false;
    }
    const ok = await buyPearlOnChain(blendAmount);
    if (ok) await refresh();
    return ok;
  },

  refillEnergy: (): Promise<boolean> => (CHAIN ? send('Refill energy', { functionName: 'refillEnergy', args: [] }) : local((s) => A.refillEnergy(s, Date.now()))),

  /** Resolves to the PEARL earned, or undefined if nothing was sold. */
  async sellFish(ids: string[]): Promise<number | undefined> {
    if (!CHAIN) {
      return act(
        (s) => A.sellFish(s, ids),
        (r) => r.save,
      )?.earned;
    }
    const s = getSave();
    const sold = s.fish.filter((f) => ids.includes(f.id));
    // the same protections the local rules enforce; the contract itself only checks ownership
    try {
      A.sellFish(s, ids);
    } catch (e) {
      if (e instanceof A.GameError) {
        toast(e.message, 'err');
        return undefined;
      }
      throw e;
    }
    const ok = await send(`Sell ${ids.length} fish`, { functionName: 'sellFish', args: [ids.map((id) => BigInt(id))] });
    return ok ? sold.reduce((a, f) => a + f.sellPrice, 0) : undefined;
  },

  /** Favourites are a client-side convenience in both modes: they only guard the Sell buttons. */
  async toggleFavorite(id: string): Promise<boolean> {
    if (!CHAIN) return apply((s) => A.toggleFavorite(s, id));
    const me = state.wallet?.address;
    if (!me) return false;
    toggleFavouriteLocal(me, id);
    replaceSave(A.toggleFavorite(getSave(), id));
    return true;
  },

  setActiveSpecial: (id: string | null): Promise<boolean> =>
    CHAIN
      ? send(id ? 'Use bonus' : 'Turn bonus off', { functionName: 'setActiveSpecial', args: [id ? SPECIALS.findIndex((x) => x.id === id) + 1 : 0] })
      : local((s) => A.setActiveSpecial(s, id)),

  /** Resolves to the PEARL reward, or undefined. */
  async claimAchievement(id: string): Promise<number | undefined> {
    if (!CHAIN) {
      return act(
        (s) => A.claimAchievement(s, id),
        (r) => r.save,
      )?.reward;
    }
    const list = achievements(getSave());
    const index = list.findIndex((a) => a.id === id);
    if (index < 0) return undefined;
    const ok = await send('Claim reward', { functionName: 'claimAchievement', args: [BigInt(index)] });
    return ok ? list[index].reward : undefined;
  },

  /** Picking a location is free: on the contracts it is only sent with the cast. */
  setLocation(id: number): boolean {
    if (!CHAIN) return apply((s) => A.setLocation(s, id));
    try {
      replaceSave(A.setLocation(getSave(), id));
      rememberLocation(id);
      return true;
    } catch {
      return false;
    }
  },
};
