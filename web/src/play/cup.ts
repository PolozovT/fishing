/**
 * The tournaments contract, as the client sees it: what is on, the player's entry in each, the leaderboards, and
 * the transactions (enter, cast, send the recording of a fight, claim a prize).
 *
 * A tournament scores a catch by how it was fought, and the contract replays the fight itself (FightVerifier), so
 * nothing here decides a score: the client only predicts the fish to stage the fight and records the input.
 */
import { formatEther, parseEventLogs, type Address, type Hex, type TransactionReceipt } from 'viem';
import { fishingGameAbi, tournamentsAbi } from '../abi';
import { publicClient } from '../clients';
import { deployment } from '../config';
import { LOCATIONS, SPECIES } from '../game/content';
import { fightSeedOf, tournamentCastSeed } from '../game/fight';
import { tournamentFish, type TournamentFish, type TournamentTackle } from '../game/tournamentRoll';
import { emit, state } from '../store';
import { sendTx, TxError } from '../tx';
import { toast } from '../ui/toast';

const zero = '0x0000000000000000000000000000000000000000' as Address;
export const CUP_DEPLOYED = !!deployment?.tournaments;
const cupContract = { address: deployment?.tournaments ?? zero, abi: tournamentsAbi } as const;
const game = { address: deployment?.game ?? zero, abi: fishingGameAbi } as const;

export interface CupEntry {
  entered: boolean;
  claimed: boolean;
  castsUsed: number;
  total: number;
  /** The randomness block of the fish on the line; 0n = nothing is on the line. */
  targetBlock: bigint;
  /** Best catches, highest first. */
  best: number[];
}

export interface Cup {
  id: number;
  name: string;
  /** Unix seconds. */
  start: number;
  end: number;
  locationId: number;
  /** Rod id and lure (0 = none, else id + 1) everyone fishes with. */
  rod: number;
  lure: number;
  waterTier: number;
  green: number;
  castLimit: number;
  counted: number;
  /** The connected player owns the tournament's rod in the game (needed to enter). */
  ownsRod: boolean;
  reclaimed: boolean;
  players: number;
  /** BLEND */
  prize: number;
  sponsor: Address;
  entry: CupEntry;
}

export interface CupStanding {
  address: Address;
  total: number;
}

export const cups = {
  list: [] as Cup[],
  standings: {} as Record<number, CupStanding[]>,
  /** Seconds after the end during which hooked fish may still be landed; prizes open after it. */
  grace: 300,
  /** Blocks from the randomness block to the deadline for sending the recording. */
  fightBlocks: 120,
  loaded: false,
  /** Bumped on every reload, for render signatures. */
  rev: 0,
};

export const PRIZE_SHARES = [0.5, 0.3, 0.2];

export type CupStage = 'soon' | 'live' | 'closing' | 'over';
export function cupStage(c: Cup, nowMs: number): CupStage {
  const now = nowMs / 1000;
  return now < c.start ? 'soon' : now < c.end ? 'live' : now <= c.end + cups.grace ? 'closing' : 'over';
}

let constantsRead = false;
export async function loadCups(): Promise<void> {
  if (!CUP_DEPLOYED) return;
  const me = state.wallet?.address ?? zero;
  if (!constantsRead) {
    const [grace, blocks] = await Promise.all([publicClient.readContract({ ...cupContract, functionName: 'GRACE' }), publicClient.readContract({ ...cupContract, functionName: 'fightBlocks' })]);
    cups.grace = Number(grace);
    cups.fightBlocks = Number(blocks);
    constantsRead = true;
  }
  const [ids, ts, entries] = await publicClient.readContract({ ...cupContract, functionName: 'list', args: [me, 24n] });
  // rod 0 is everyone's; the rest are a bitmask in the game
  const rodIds = [...new Set(ts.map((t) => t.rod))].filter((r) => r !== 0);
  const owned = new Set<number>([0]);
  if (me !== zero) {
    const has = await Promise.all(rodIds.map((r) => publicClient.readContract({ ...game, functionName: 'ownsRod', args: [me, BigInt(r)] })));
    rodIds.forEach((r, i) => has[i] && owned.add(r));
  }
  cups.list = ids.map((id, i) => {
    const t = ts[i];
    const e = entries[i];
    return {
      id: Number(id),
      name: t.name,
      start: t.start,
      end: t.end,
      locationId: t.locationId,
      rod: t.rod,
      lure: t.lure,
      waterTier: t.waterTier,
      green: t.green,
      castLimit: t.castLimit,
      counted: t.counted,
      ownsRod: owned.has(t.rod),
      reclaimed: t.reclaimed,
      players: t.players,
      prize: Number(formatEther(t.prize)),
      sponsor: t.sponsor,
      entry: { entered: e.entered, claimed: e.claimed, castsUsed: e.castsUsed, total: e.total, targetBlock: e.targetBlock, best: [...e.best] },
    };
  });
  cups.loaded = true;
  cups.rev++;
  emit();
}

export async function loadCupStandings(id: number): Promise<void> {
  if (!CUP_DEPLOYED) return;
  const [players, totals] = await publicClient.readContract({ ...cupContract, functionName: 'standings', args: [BigInt(id)] });
  cups.standings[id] = players.map((address, i) => ({ address, total: totals[i] }));
  cups.rev++;
  emit();
}

const tackleCache = new Map<number, TournamentTackle>();
/** The bonuses of the tournament's fixed tackle at its location, as the contract computes them. */
async function tackleOf(c: Cup): Promise<TournamentTackle> {
  let t = tackleCache.get(c.id);
  if (!t) {
    const lo = await publicClient.readContract({ ...game, functionName: 'loadout', args: [BigInt(c.rod), BigInt(c.lure), 0n, BigInt(c.locationId)] });
    t = { locationId: c.locationId, waterTier: c.waterTier, rodCatch: Number(lo[0]), rarity: Number(lo[2]), weightBonus: Number(lo[3]) };
    tackleCache.set(c.id, t);
  }
  return t;
}

const catalog = {
  locations: LOCATIONS.map((l) => ({ special: 0, speciesIds: l.pool.map(([id]) => id), weights: l.pool.map(([, w]) => w) })),
  species: SPECIES.map((s) => ({ rarity: s.rarity, minWeight: s.minWeight, maxWeight: s.maxWeight, hidden: !!s.hidden })),
};

export interface HookedCupFish {
  fish: TournamentFish;
  fightSeed: bigint;
  /** Blocks left to fight and send the recording, counted from now. */
  blocksLeft: number;
}

/**
 * The fish on the player's line in `c`, or null while its block is not there yet. `castNo` is the player's cast
 * count in this tournament (the pending cast is the latest one).
 */
export async function hookedFish(c: Cup, targetBlock: bigint, castNo: number): Promise<HookedCupFish | null> {
  const me = state.wallet?.address;
  if (!me) return null;
  const head = await publicClient.getBlockNumber({ cacheTime: 0 });
  if (head <= targetBlock) return null;
  const [block, tackle] = await Promise.all([publicClient.getBlock({ blockNumber: targetBlock }), tackleOf(c)]);
  const seed = tournamentCastSeed(block.hash as Hex, me, BigInt(c.id), BigInt(castNo), cupContract.address);
  return { fish: tournamentFish(catalog, tackle, seed), fightSeed: fightSeedOf(seed), blocksLeft: Number(targetBlock + BigInt(cups.fightBlocks) - head) };
}

/** Sends one tournaments transaction. Returns the receipt, or undefined when it failed (the error is toasted). */
async function write(label: string, functionName: 'enter' | 'cast' | 'reel' | 'claim' | 'reclaim', args: readonly unknown[]): Promise<TransactionReceipt | undefined> {
  const w = state.wallet;
  if (!w) {
    toast('Connect with Fluent to play', 'info');
    return undefined;
  }
  try {
    return await sendTx(w, label, { ...cupContract, functionName, args } as never, { quiet: true });
  } catch (e) {
    if (!(e instanceof TxError)) throw e;
    toast(`${label}: ${e.message}`, 'err');
    return undefined;
  }
}

export const cupOps = {
  enter: (id: number) => write('Enter the tournament', 'enter', [BigInt(id)]),
  cast: (id: number) => write('Tournament cast', 'cast', [BigInt(id)]),
  reel: (id: number, inputs: Hex) => write('Send the fight', 'reel', [BigInt(id), inputs]),
  claim: (id: number) => write('Claim the prize', 'claim', [BigInt(id)]),
  reclaim: (id: number) => write('Take back unwon prizes', 'reclaim', [BigInt(id)]),
};

export type CupResult =
  | { kind: 'forfeited' }
  | { kind: 'scored'; speciesId: number; weight: number; quality: number; base: number; points: number; landed: boolean; ticks: number; good: number; total: number };

/** What the contract made of the recording. */
export function cupResultOf(receipt: TransactionReceipt, me: Address): CupResult | null {
  const logs = parseEventLogs({ abi: tournamentsAbi, logs: receipt.logs }).filter((l) => 'player' in l.args && (l.args.player as string).toLowerCase() === me.toLowerCase());
  for (const l of logs) {
    if (l.eventName === 'TournamentCatch') {
      const a = l.args;
      return { kind: 'scored', speciesId: a.speciesId, weight: a.weight, quality: a.quality, base: a.base, points: a.points, landed: a.landed, ticks: a.ticks, good: a.good, total: a.total };
    }
    if (l.eventName === 'FightForfeited') return { kind: 'forfeited' };
  }
  return null;
}

/** The target block of the cast a `cast` receipt made. */
export function castTargetOf(receipt: TransactionReceipt): { targetBlock: bigint; castNo: number } | null {
  const [ev] = parseEventLogs({ abi: tournamentsAbi, logs: receipt.logs, eventName: 'TournamentCast' });
  return ev ? { targetBlock: ev.args.targetBlock, castNo: ev.args.castNo } : null;
}
