/**
 * The contract backend of the game. Reads the player's whole state through GameLens and maps it onto the same
 * `Save` shape the local game uses, so the UI does not care where the state lives; writes go out as transactions.
 * Here the chain is the source of truth: nothing in localStorage decides a catch, a balance or an unlock.
 */
import { erc20Abi, formatEther, parseEther, parseEventLogs, type Address, type TransactionReceipt } from 'viem';
import { fishingGameAbi, gameLensAbi, pearlExchangeAbi } from '../abi';
import { publicClient } from '../clients';
import { deployment } from '../config';
import { LOCATIONS, QUALITIES, SPECIALS, SPECIES, TUNING, BLEND_PRIZE } from '../game/content';
import { achievements } from '../game/progress';
import { freshSave } from '../game/save';
import { tournamentScore } from '../game/tournament';
import type { FishInstance, Rarity, Save } from '../game/types';
import { state } from '../store';
import { LURES, RODS } from '../tackle/catalog';
import { fluentSend } from '../fluent';
import { friendlyError } from '../errors';
import { sendTx, TxError } from '../tx';
import { toast } from '../ui/toast';

const zero = '0x0000000000000000000000000000000000000000' as Address;
const game = { address: deployment?.game ?? zero, abi: fishingGameAbi } as const;
const lens = { address: deployment?.lens ?? zero, abi: gameLensAbi } as const;

const num = (wei: bigint): number => Number(formatEther(wei));

export interface Standing {
  address: Address;
  total: number;
}

/** Chain facts that do not fit the Save shape. */
export interface World {
  /** The player's unresolved cast, if any. */
  cast: { targetBlock: bigint; locationId: number } | null;
  week: number;
  standings: Standing[];
  /** The player's past weeks, newest first. */
  history: { week: number; total: number }[];
  loaded: boolean;
  /** The BLEND → PEARL exchange, when one is deployed. Balances are of the BLEND token in the player's wallet. */
  blend: { balance: number; allowance: bigint; pearlPerBlend: number; paused: boolean } | null;
}

export const world: World = { cast: null, week: 0, standings: [], history: [], loaded: false, blend: null };

// ------------------------------------------------------------------ client-side preferences (not game state)

const favKey = (a: Address): string => `onchain-fishing:favs:${a.toLowerCase()}`;
function favourites(a: Address): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(favKey(a)) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}
export function toggleFavouriteLocal(a: Address, id: string): void {
  const set = favourites(a);
  if (set.has(id)) set.delete(id);
  else set.add(id);
  try {
    localStorage.setItem(favKey(a), JSON.stringify([...set]));
  } catch {
    /* a convenience only */
  }
}
const LOC_KEY = 'onchain-fishing:location';
export function rememberLocation(id: number): void {
  try {
    localStorage.setItem(LOC_KEY, String(id));
  } catch {
    /* a convenience only */
  }
}
function recalledLocation(): number {
  try {
    return Number(localStorage.getItem(LOC_KEY) ?? 0) || 0;
  } catch {
    return 0;
  }
}

// ------------------------------------------------------------------ reads

/** Loads the connected player's state from the chain as a Save. Returns null when no wallet is connected. */
export async function loadChainSave(): Promise<Save | null> {
  const me = state.wallet?.address;
  if (!me) return null;
  const [v, keep, blend] = await Promise.all([
    publicClient.readContract({ ...lens, functionName: 'playerView', args: [me] }),
    publicClient.readContract({ ...lens, functionName: 'keepnet', args: [me] }),
    loadBlend(me),
  ]);
  world.blend = blend;
  const now = Date.now();
  const skew = now - Number(v.timestamp) * 1000;
  const p = v.p;
  const favs = favourites(me);
  const [ids, list, values] = keep;

  const fish: FishInstance[] = ids
    .map((id, i) => {
      const f = list[i];
      const sp = SPECIES[f.speciesId];
      const quality = QUALITIES[f.quality] ?? 'B';
      return {
        id: id.toString(),
        speciesId: f.speciesId,
        rarity: (sp?.rarity ?? 0) as Rarity,
        weight: f.weight,
        quality,
        locationId: f.spotId,
        caughtAt: Number(f.caughtAt) * 1000 + skew,
        sellPrice: num(values[i]),
        tournamentScore: sp ? tournamentScore(sp, f.weight, quality) : 0,
        isFavorite: favs.has(id.toString()),
        isSpecial: !!sp?.special,
      };
    })
    .sort((a, b) => b.caughtAt - a.caughtAt);

  const s = freshSave(now);
  s.pearl = num(v.pearl);
  s.blend = num(v.blendWon);
  s.blendWins = p.blendWins;
  s.xp = Number(p.xp);
  if (p.energyUpdatedAt === 0) {
    s.energy = TUNING.maxEnergy;
    s.energyAt = now;
  } else {
    s.energy = p.energy;
    s.energyAt = p.energyUpdatedAt * 1000 + skew;
  }
  // the header derives the next refill price from the number of refills today
  const refills = Math.max(0, Math.round(Math.log2(num(v.refillPrice) / TUNING.refillPrice)));
  s.refills = { day: Math.floor(now / 86_400_000), count: refills };
  s.rods = {};
  RODS.forEach((r, i) => {
    if (i === 0 || (p.rods >> i) & 1) s.rods[r.id] = { durability: v.rodDurability[i] ?? 0 };
  });
  s.lures = {};
  LURES.forEach((l, i) => {
    if ((v.lureCasts[i] ?? 0) > 0) s.lures[l.id] = { casts: v.lureCasts[i] };
  });
  s.equipped = { rod: RODS[p.rod]?.id ?? 'willow', lure: p.lure === 0 ? null : (LURES[p.lure - 1]?.id ?? null) };
  if (s.equipped.lure && !s.lures[s.equipped.lure]) s.equipped.lure = null;
  s.fish = fish;
  s.dex = {};
  v.dex.forEach((d, i) => {
    if (d.count > 0) s.dex[i] = { count: d.count, best: d.best, firstAt: 0 };
  });
  s.permanentUnlocks = LOCATIONS.filter((l) => l.unlock.type === 'start' || (p.unlocks >> l.id) & 1).map((l) => l.id);
  s.specialsFound = SPECIALS.filter((_, i) => (p.specialsFound >> i) & 1).map((x) => x.id);
  SPECIALS.forEach((x, i) => (s.dry[x.id] = v.dry[i] ?? 0));
  s.activeSpecial = p.activeSpecial === 0 ? null : (SPECIALS[p.activeSpecial - 1]?.id ?? null);
  const byLocation: Save['records']['byLocation'] = {};
  v.bestByLocation.forEach((r, i) => {
    if (r.weight > 0) byLocation[i] = { speciesId: r.speciesId, weight: r.weight, locationId: i, at: r.at * 1000 + skew };
  });
  const where = Object.values(byLocation).find((r) => r.weight === v.best.weight && r.speciesId === v.best.speciesId);
  s.records = {
    overall: v.best.weight > 0 ? { speciesId: v.best.speciesId, weight: v.best.weight, locationId: where?.locationId ?? 0, at: v.best.at * 1000 + skew } : null,
    byLocation,
  };
  const week = Number(v.week);
  s.weeks = {
    [week]: v.weekEntries.map((e) => ({ score: e.score, speciesId: e.speciesId, weight: e.weight, quality: QUALITIES[e.quality] ?? 'B', at: e.at * 1000 + skew })),
  };
  s.stats = { casts: p.casts, catches: p.catches, escaped: 0, sold: 0, earned: 0 };
  // claimed achievements: the contract's indices follow the order of achievements()
  const order = achievements(s).map((a) => a.id);
  s.claimed = order.filter((_, i) => (p.claimed >> i) & 1);
  const wanted = recalledLocation();
  s.location = s.permanentUnlocks.includes(wanted) ? wanted : 0;

  world.cast = v.cast.targetBlock === 0n ? null : { targetBlock: v.cast.targetBlock, locationId: v.cast.locationId };
  world.week = week;
  world.loaded = true;
  return s;
}

const exchange = deployment?.exchange && deployment.blend ? { address: deployment.exchange, token: deployment.blend } : null;
export const EXCHANGE_DEPLOYED = exchange !== null;

async function loadBlend(me: Address): Promise<World['blend']> {
  if (!exchange) return null;
  const token = { address: exchange.token, abi: erc20Abi } as const;
  const ex = { address: exchange.address, abi: pearlExchangeAbi } as const;
  const [balance, allowance, rate, paused] = await Promise.all([
    publicClient.readContract({ ...token, functionName: 'balanceOf', args: [me] }),
    publicClient.readContract({ ...token, functionName: 'allowance', args: [me, exchange.address] }),
    publicClient.readContract({ ...ex, functionName: 'pearlPerBlendUnit' }),
    publicClient.readContract({ ...ex, functionName: 'paused' }),
  ]);
  // both tokens have 18 decimals, so the unit rate is also "PEARL per BLEND"
  return { balance: num(balance), allowance, pearlPerBlend: Number(rate), paused };
}

/**
 * Buys PEARL for `blendAmount` BLEND: an approval for exactly that amount (when the current one is too small)
 * and the purchase, as one batch. Returns true when it went through.
 */
export async function buyPearlOnChain(blendAmount: string): Promise<boolean> {
  const w = state.wallet;
  if (!w || !exchange) return false;
  let amount: bigint;
  try {
    amount = parseEther(blendAmount.replace(',', '.').trim());
  } catch {
    toast('Enter an amount of BLEND', 'err');
    return false;
  }
  if (amount <= 0n) {
    toast('Enter an amount of BLEND', 'err');
    return false;
  }
  const label = 'Buy PEARL';
  try {
    const calls = [];
    if ((world.blend?.allowance ?? 0n) < amount) calls.push({ to: exchange.token, abi: erc20Abi, method: 'approve', args: [exchange.address, amount] });
    calls.push({ to: exchange.address, abi: pearlExchangeAbi, method: 'buyPearl', args: [amount] });
    const hash = await fluentSend(calls, label);
    const receipt = await publicClient.waitForTransactionReceipt({ hash, pollingInterval: 300 });
    if (receipt.status !== 'success') throw new Error('Transaction reverted');
    toast(`${label}: done`, 'ok');
    return true;
  } catch (e) {
    console.warn('[tx] buy pearl failed', e);
    toast(`${label}: ${friendlyError(e)}`, 'err');
    return false;
  }
}

/** This week's table of real anglers and the player's own past weeks. */
export async function loadStandings(): Promise<void> {
  const week = BigInt(Math.floor(Date.now() / (7 * 86_400_000)));
  const me = state.wallet?.address;
  const [table, history] = await Promise.all([
    publicClient.readContract({ ...lens, functionName: 'weekStandings', args: [week, 0n, 200n] }),
    me ? publicClient.readContract({ ...lens, functionName: 'weekHistory', args: [me, 8n] }) : Promise.resolve(null),
  ]);
  world.standings = table[0].map((address, i) => ({ address, total: table[1][i] })).sort((a, b) => b.total - a.total);
  world.history = history ? history[0].map((w, i) => ({ week: Number(w), total: history[1][i] })).filter((h) => h.total > 0) : [];
}

/** Resolves once the chain head is past `target` (the cast's randomness block exists). */
export async function waitPastBlock(target: bigint, alive: () => boolean): Promise<void> {
  while (alive()) {
    try {
      if ((await publicClient.getBlockNumber({ cacheTime: 0 })) > target) return;
    } catch {
      /* a flaky RPC read: try again */
    }
    await new Promise((r) => setTimeout(r, 700));
  }
}

// ------------------------------------------------------------------ writes

/** A write to the game contract. Argument types are checked by the simulation before anything is sent. */
export interface GameCall {
  functionName: string;
  args: readonly unknown[];
}

/** Sends one game transaction. Returns the receipt, or undefined when it failed (the error is already toasted). */
export async function tx(label: string, request: GameCall, quiet = false): Promise<TransactionReceipt | undefined> {
  const w = state.wallet;
  if (!w) {
    toast('Connect with Fluent to play', 'info');
    return undefined;
  }
  try {
    return await sendTx(w, label, { ...game, ...request } as never, { quiet });
  } catch (e) {
    if (!(e instanceof TxError)) throw e;
    if (quiet) toast(`${label}: ${e.message}`, 'err');
    return undefined;
  }
}

export type ReelOutcome =
  | { kind: 'missed' }
  | { kind: 'expired' }
  | { kind: 'bottle'; amount: number }
  | { kind: 'caught'; fishId: string; speciesId: number; weight: number; quality: number; locationId: number; score: number; special: boolean; unlocked: number[]; counted: boolean };

/** What a receipt says happened to the player's cast, if it resolved one. */
export function outcomeOf(receipt: TransactionReceipt, me: Address): ReelOutcome | null {
  const logs = parseEventLogs({ abi: fishingGameAbi, logs: receipt.logs }).filter((l) => 'player' in l.args && (l.args.player as string).toLowerCase() === me.toLowerCase());
  const unlocked: number[] = [];
  let counted = false;
  let out: ReelOutcome | null = null;
  for (const l of logs) {
    if (l.eventName === 'LocationUnlocked') unlocked.push(l.args.locationId);
    else if (l.eventName === 'WeekScore') counted = true;
    else if (l.eventName === 'Missed') out = { kind: 'missed' };
    else if (l.eventName === 'CastExpired') out = { kind: 'expired' };
    else if (l.eventName === 'BottleFound') out = { kind: 'bottle', amount: num(l.args.amount) };
    else if (l.eventName === 'Caught') {
      const a = l.args;
      out = { kind: 'caught', fishId: a.fishId.toString(), speciesId: a.speciesId, weight: a.weight, quality: a.quality, locationId: a.locationId, score: a.score, special: a.special, unlocked, counted };
    }
  }
  if (out?.kind === 'caught') out.counted = counted;
  return out;
}

// ------------------------------------------------------------------ catalog check

/**
 * The client shows names, art and numbers from its own catalog, and the contract plays by its own copy.
 * This compares the two and returns what differs, so a drifted number is noticed instead of quietly lying.
 */
export async function catalogMismatches(): Promise<string[]> {
  const c = await publicClient.readContract({ ...lens, functionName: 'catalog' });
  const out: string[] = [];
  const check = (what: string, chain: number | bigint | boolean, local: number | boolean): void => {
    if (Number(chain) !== Number(local)) out.push(`${what}: chain ${chain}, client ${local}`);
  };
  check('rods', c.rods.length, RODS.length);
  check('lures', c.lures.length, LURES.length);
  check('locations', c.locations.length, LOCATIONS.length);
  check('species', c.species.length, SPECIES.length);
  check('specials', c.specials.length, SPECIALS.length);
  [...RODS.map((r, i) => [r, c.rods[i]] as const), ...LURES.map((l, i) => [l, c.lures[i]] as const)].forEach(([item, on]) => {
    if (!on) return;
    check(`${item.name} price`, num(on.price), item.price);
    check(`${item.name} wear`, on.wear, item.wear);
    check(`${item.name} catch`, on.catchPts, item.base.catch ?? 0);
    check(`${item.name} rarity`, on.rarity, item.base.rarity ?? 0);
    check(`${item.name} weight`, on.weight, item.base.weight ?? 0);
    const mask = (item.spot?.spots ?? []).reduce((m, i) => m | (1 << i), 0);
    check(`${item.name} bonus locations`, on.a.mask, mask);
    check(`${item.name} bonus catch`, on.a.catchPts, item.spot?.catch ?? 0);
    check(`${item.name} bonus rarity`, on.a.rarity, item.spot?.rarity ?? 0);
    check(`${item.name} bonus weight`, on.a.weight, item.spot?.weight ?? 0);
  });
  SPECIES.forEach((sp, i) => {
    const on = c.species[i];
    if (!on) return;
    if (on.name !== sp.name) out.push(`species ${i}: chain ${on.name}, client ${sp.name}`);
    check(`${sp.name} rarity`, on.rarity, sp.rarity);
    check(`${sp.name} min weight`, on.minWeight, sp.minWeight);
    check(`${sp.name} max weight`, on.maxWeight, sp.maxWeight);
    check(`${sp.name} price`, num(on.basePrice), sp.basePrice);
    check(`${sp.name} hidden`, c.hidden[i], !!sp.hidden);
  });
  LOCATIONS.forEach((loc, i) => {
    const on = c.locations[i];
    if (!on) return;
    check(`${loc.name} energy`, on.energyCost, loc.energyCost);
    check(`${loc.name} pool size`, on.speciesIds.length, loc.pool.length);
    loc.pool.forEach(([id, w], k) => {
      check(`${loc.name} pool[${k}] species`, on.speciesIds[k] ?? -1, id);
      check(`${loc.name} pool[${k}] weight`, on.weights[k] ?? -1, w);
    });
    const special = loc.special ? SPECIALS.findIndex((x) => x.id === loc.special) + 1 : 0;
    check(`${loc.name} special`, on.special, special);
  });
  SPECIALS.forEach((sp, i) => {
    const on = c.specials[i];
    if (!on) return;
    check(`${sp.name} species`, on.speciesId, sp.speciesId);
    check(`${sp.name} chance`, on.chancePpm, Math.round(sp.chance * 1_000_000));
    check(`${sp.name} pity`, on.pity, sp.pity);
  });
  const cfg = await publicClient.readContract({ ...game, functionName: 'config' });
  // [maxEnergy, energyRegenSeconds, revealDelay, baseBiteBps, maxBiteBps, …, blendAmount, blendChancePpm, blendMaxWins]
  check('max energy', cfg[0], TUNING.maxEnergy);
  check('energy regen seconds', cfg[1], TUNING.energyRegenSeconds);
  check('base bite', cfg[3], TUNING.baseBite * 100);
  check('refill price', num(cfg[8]), TUNING.refillPrice);
  check('BLEND amount', num(cfg[13]), BLEND_PRIZE.amount);
  check('BLEND chance', cfg[14], Math.round(BLEND_PRIZE.chance * 1_000_000));
  return out;
}
