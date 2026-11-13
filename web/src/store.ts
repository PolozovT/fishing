import { zeroAddress, type Address } from 'viem';
import { fishingGameAbi, fishNftAbi, marketplaceAbi, pearlTokenAbi, rodNftAbi } from './abi';
import { publicClient, type Wallet } from './clients';
import { deployment } from './config';
import { OFFLINE_BAITS, OFFLINE_CONFIG, OFFLINE_FEE_BPS, OFFLINE_SPECIES, OFFLINE_SPOTS } from './offlineCatalog';

/** False until the contracts are deployed on this network: the UI then shows the seed catalog and reads no game state. */
export const DEPLOYED = deployment !== undefined;
const dep = deployment ?? {
  chainId: 0,
  startBlock: 0,
  game: zeroAddress,
  fish: zeroAddress,
  rod: zeroAddress,
  pearl: zeroAddress,
  market: zeroAddress,
};
export const ADDR = dep;
const START = BigInt(dep.startBlock);
/** Public RPCs cap eth_getLogs ranges (Fluent: 100k blocks), so every scan walks the chain in chunks. */
const LOG_CHUNK = 50_000n;

async function forRanges(from: bigint, to: bigint, fn: (from: bigint, to: bigint) => Promise<void>): Promise<void> {
  for (let a = from; a <= to; a += LOG_CHUNK) {
    const b = a + LOG_CHUNK - 1n < to ? a + LOG_CHUNK - 1n : to;
    await fn(a, b);
  }
}

// ------------------------------------------------------------------ types

export interface Species {
  id: number;
  name: string;
  rarity: number;
  minWeight: number;
  maxWeight: number;
  basePrice: bigint;
  color: number;
}
export interface Spot {
  id: number;
  name: string;
  minRodLevel: number;
  energyCost: number;
  active: boolean;
  speciesIds: number[];
}
export interface Bait {
  id: number;
  name: string;
  price: bigint;
  catchBonusBps: number;
  rarityBonus: number;
}
export interface Rod {
  id: bigint;
  level: number;
  durability: number;
  maxDurability: number;
  locked: boolean;
  upgradeCost: bigint;
  repairCost: bigint;
}
export interface Fish {
  id: bigint;
  speciesId: number;
  weight: number;
  spotId: number;
  caughtAt: number;
  angler: Address;
  value: bigint;
}
export interface ActiveCast {
  targetBlock: bigint;
  spotId: number;
  baitId: number;
  rodId: bigint;
}
export interface Listing {
  collection: 'fish' | 'rod';
  address: Address;
  tokenId: bigint;
  seller: Address;
  price: bigint;
  fish?: Fish;
  rod?: Omit<Rod, 'upgradeCost' | 'repairCost'>;
}
export interface CatchRecord {
  player: Address;
  fishId: bigint;
  speciesId: number;
  weight: number;
  spotId: number;
  block: bigint;
}
export interface WeeklyRecord {
  week: bigint;
  angler: Address;
  fishId: bigint;
  weight: number;
  speciesId: number;
}
/** Every field of the onchain Config struct, keyed by name (read from the ABI, so new fields just appear). */
export type GameConfig = Record<string, bigint | number>;

export interface State {
  wallet: Wallet | null;
  /** Fluent Connect widget status ('off' when it is not configured). */
  fluentStatus: 'off' | 'restoring' | 'connecting' | 'connected' | 'disconnected';
  connecting: boolean;
  catalogLoaded: boolean;
  block: bigint;
  blockTs: number;
  blockSeenAt: number;
  config: GameConfig;
  species: Species[];
  spots: Spot[];
  baits: Bait[];
  feeBps: number;
  // player
  eth: bigint;
  pearl: bigint;
  energy: number;
  storedEnergy: number;
  energyUpdatedAt: number;
  starterClaimed: boolean;
  xp: bigint;
  catches: bigint;
  casts: bigint;
  bestWeight: number;
  refillPrice: bigint;
  baitBalance: bigint[];
  rods: Rod[];
  fish: Fish[];
  cast: ActiveCast | null;
  marketApproved: { fish: boolean; rod: boolean };
  // world
  listings: Listing[];
  leaderboard: CatchRecord[];
  weekly: WeeklyRecord | null;
  // ui selections
  sel: { spot: number; rod: bigint | null; bait: number };
  autoReel: boolean;
}

const AUTO_KEY = 'onchain-fishing:auto-reel';
const readAuto = (): boolean => {
  try {
    return localStorage.getItem(AUTO_KEY) !== '0';
  } catch {
    return true;
  }
};

export const state: State = {
  wallet: null,
  fluentStatus: 'off',
  connecting: false,
  catalogLoaded: false,
  block: 0n,
  blockTs: 0,
  blockSeenAt: Date.now(),
  config: {},
  species: [],
  spots: [],
  baits: [],
  feeBps: 0,
  eth: 0n,
  pearl: 0n,
  energy: 0,
  storedEnergy: 0,
  energyUpdatedAt: 0,
  starterClaimed: false,
  xp: 0n,
  catches: 0n,
  casts: 0n,
  bestWeight: 0,
  refillPrice: 0n,
  baitBalance: [],
  rods: [],
  fish: [],
  cast: null,
  marketApproved: { fish: false, rod: false },
  listings: [],
  leaderboard: [],
  weekly: null,
  sel: { spot: 0, rod: null, bait: 0 },
  autoReel: readAuto(),
};

export function setAutoReel(v: boolean): void {
  state.autoReel = v;
  try {
    localStorage.setItem(AUTO_KEY, v ? '1' : '0');
  } catch {
    /* ignore */
  }
  emit();
}

// ------------------------------------------------------------------ pub/sub

const listeners = new Set<() => void>();
export const subscribe = (f: () => void): void => void listeners.add(f);
let emitQueued = false;
export function emit(): void {
  if (emitQueued) return;
  emitQueued = true;
  queueMicrotask(() => {
    emitQueued = false;
    listeners.forEach((f) => f());
  });
}

// ------------------------------------------------------------------ helpers

export const cfg = (k: string): number => Number(state.config[k] ?? 0);
export const cfgBig = (k: string): bigint => BigInt(state.config[k] ?? 0);

/** Chain time estimate between blocks. */
export const chainNow = (): number => state.blockTs + Math.floor((Date.now() - state.blockSeenAt) / 1000);

export function catchChanceBps(level: number, baitId: number): number {
  const b = state.baits[baitId];
  const c = cfg('baseCatchBps') + cfg('catchBpsPerLevel') * (level - 1) + (b?.catchBonusBps ?? 0);
  return Math.min(c, cfg('maxCatchBps'));
}

export const selectedRod = (): Rod | undefined => state.rods.find((r) => r.id === state.sel.rod);

// ------------------------------------------------------------------ token metadata (immutable per id for fish)

const imageCache = new Map<string, string>();

export function decodeTokenURI(uri: string): { name?: string; image?: string } {
  const prefix = 'data:application/json;base64,';
  try {
    const json = uri.startsWith(prefix) ? atob(uri.slice(prefix.length)) : uri;
    return JSON.parse(json) as { name?: string; image?: string };
  } catch {
    return {};
  }
}

export async function tokenImage(kind: 'fish' | 'rod', id: bigint, fresh = false): Promise<string | undefined> {
  const key = `${kind}:${id}`;
  if (!fresh && imageCache.has(key)) return imageCache.get(key);
  if (!DEPLOYED) return undefined;
  try {
    const uri = await publicClient.readContract({
      address: kind === 'fish' ? dep.fish : dep.rod,
      abi: kind === 'fish' ? fishNftAbi : rodNftAbi,
      functionName: 'tokenURI',
      args: [id],
    });
    const img = decodeTokenURI(uri).image;
    if (img) imageCache.set(key, img);
    return img;
  } catch {
    return imageCache.get(key);
  }
}
export const cachedImage = (kind: 'fish' | 'rod', id: bigint): string | undefined => imageCache.get(`${kind}:${id}`);

// ------------------------------------------------------------------ catalog (rarely changes)

export async function loadCatalog(): Promise<void> {
  if (!DEPLOYED) {
    state.config = OFFLINE_CONFIG;
    state.feeBps = OFFLINE_FEE_BPS;
    state.spots = OFFLINE_SPOTS;
    state.baits = OFFLINE_BAITS;
    state.species = OFFLINE_SPECIES;
    state.catalogLoaded = true;
    emit();
    return;
  }
  const g = { address: dep.game, abi: fishingGameAbi } as const;
  const configItem = fishingGameAbi.find((i) => i.type === 'function' && i.name === 'config');
  const names = configItem && 'outputs' in configItem ? configItem.outputs.map((o) => o.name) : [];
  const [rawCfg, spotCount, baitCount, speciesCount, feeBps] = await Promise.all([
    publicClient.readContract({ ...g, functionName: 'config' }),
    publicClient.readContract({ ...g, functionName: 'spotCount' }),
    publicClient.readContract({ ...g, functionName: 'baitCount' }),
    publicClient.readContract({ address: dep.fish, abi: fishNftAbi, functionName: 'speciesCount' }),
    publicClient.readContract({ address: dep.market, abi: marketplaceAbi, functionName: 'feeBps' }),
  ]);
  const conf: GameConfig = {};
  (rawCfg as readonly (bigint | number | boolean)[]).forEach((v, i) => {
    conf[names[i] ?? String(i)] = typeof v === 'boolean' ? Number(v) : v;
  });
  state.config = conf;
  state.feeBps = Number(feeBps);

  const [spots, baits, species] = await Promise.all([
    Promise.all(
      Array.from({ length: Number(spotCount) }, (_, i) =>
        publicClient.readContract({ ...g, functionName: 'spot', args: [BigInt(i)] }),
      ),
    ),
    Promise.all(
      Array.from({ length: Number(baitCount) }, (_, i) =>
        publicClient.readContract({ ...g, functionName: 'bait', args: [BigInt(i)] }),
      ),
    ),
    Promise.all(
      Array.from({ length: Number(speciesCount) }, (_, i) =>
        publicClient.readContract({ address: dep.fish, abi: fishNftAbi, functionName: 'species', args: [BigInt(i)] }),
      ),
    ),
  ]);
  state.spots = spots.map((s, id) => ({
    id,
    name: s.name,
    minRodLevel: s.minRodLevel,
    energyCost: s.energyCost,
    active: s.active,
    speciesIds: s.speciesIds.map(Number),
  }));
  state.baits = baits.map((b, id) => ({
    id,
    name: b.name,
    price: b.price,
    catchBonusBps: b.catchBonusBps,
    rarityBonus: b.rarityBonus,
  }));
  state.species = species.map((s, id) => ({
    id,
    name: s.name,
    rarity: s.rarity,
    minWeight: s.minWeight,
    maxWeight: s.maxWeight,
    basePrice: s.basePrice,
    color: s.color,
  }));
  state.catalogLoaded = true;
  emit();
}

// ------------------------------------------------------------------ chain head

export async function loadHead(): Promise<void> {
  const b = await publicClient.getBlock();
  if (b.number !== state.block) {
    state.block = b.number;
    state.blockTs = Number(b.timestamp);
    state.blockSeenAt = Date.now();
    emit();
  }
}

// ------------------------------------------------------------------ owned token discovery via Transfer logs

interface OwnedScan {
  owner: Address | null;
  scanned: bigint;
  fish: Set<bigint>;
  rod: Set<bigint>;
}
const scan: OwnedScan = { owner: null, scanned: START - 1n, fish: new Set(), rod: new Set() };

async function scanOwned(owner: Address, to: bigint): Promise<void> {
  if (scan.owner !== owner) {
    scan.owner = owner;
    scan.scanned = START - 1n;
    scan.fish.clear();
    scan.rod.clear();
  }
  if (to <= scan.scanned) return;
  await forRanges(scan.scanned + 1n, to, (from, upTo) => scanOwnedRange(owner, from, upTo));
}

async function scanOwnedRange(owner: Address, from: bigint, to: bigint): Promise<void> {
  const [f, r] = await Promise.all([
    publicClient.getContractEvents({
      address: dep.fish,
      abi: fishNftAbi,
      eventName: 'Transfer',
      args: { to: owner },
      fromBlock: from,
      toBlock: to,
    }),
    publicClient.getContractEvents({
      address: dep.rod,
      abi: rodNftAbi,
      eventName: 'Transfer',
      args: { to: owner },
      fromBlock: from,
      toBlock: to,
    }),
  ]);
  f.forEach((l) => l.args.tokenId !== undefined && scan.fish.add(l.args.tokenId));
  r.forEach((l) => l.args.tokenId !== undefined && scan.rod.add(l.args.tokenId));
  scan.scanned = to;
}

async function ownerOf(kind: 'fish' | 'rod', id: bigint): Promise<Address> {
  try {
    return await publicClient.readContract({
      address: kind === 'fish' ? dep.fish : dep.rod,
      abi: kind === 'fish' ? fishNftAbi : rodNftAbi,
      functionName: 'ownerOf',
      args: [id],
    });
  } catch {
    return zeroAddress; // burned
  }
}

async function readFish(id: bigint): Promise<Fish> {
  const [f, value] = await Promise.all([
    publicClient.readContract({ address: dep.fish, abi: fishNftAbi, functionName: 'fish', args: [id] }),
    publicClient.readContract({ address: dep.game, abi: fishingGameAbi, functionName: 'quoteSell', args: [id] }),
  ]);
  return {
    id,
    speciesId: f.speciesId,
    weight: f.weight,
    spotId: f.spotId,
    caughtAt: Number(f.caughtAt),
    angler: f.angler,
    value,
  };
}

async function readRodBasic(id: bigint): Promise<Omit<Rod, 'upgradeCost' | 'repairCost'>> {
  const [r, locked] = await Promise.all([
    publicClient.readContract({ address: dep.rod, abi: rodNftAbi, functionName: 'rods', args: [id] }),
    publicClient.readContract({ address: dep.rod, abi: rodNftAbi, functionName: 'locked', args: [id] }),
  ]);
  return { id, level: r.level, durability: r.durability, maxDurability: r.maxDurability, locked };
}

// ------------------------------------------------------------------ player

export async function loadPlayer(): Promise<void> {
  const w = state.wallet;
  if (!w) return;
  const me = w.address;
  if (!DEPLOYED) {
    state.eth = await publicClient.getBalance({ address: me });
    state.energy = Number(OFFLINE_CONFIG.maxEnergy);
    emit();
    return;
  }
  const g = { address: dep.game, abi: fishingGameAbi } as const;
  const head = await publicClient.getBlockNumber({ cacheTime: 0 });
  await scanOwned(me, head);

  const [eth, pearl, energy, player, cast, refill, baitBal, apprFish, apprRod] = await Promise.all([
    publicClient.getBalance({ address: me }),
    publicClient.readContract({ address: dep.pearl, abi: pearlTokenAbi, functionName: 'balanceOf', args: [me] }),
    publicClient.readContract({ ...g, functionName: 'currentEnergy', args: [me] }),
    publicClient.readContract({ ...g, functionName: 'players', args: [me] }),
    publicClient.readContract({ ...g, functionName: 'casts', args: [me] }),
    publicClient.readContract({ ...g, functionName: 'refillPrice', args: [me] }),
    Promise.all(
      state.baits.map((b) =>
        b.id === 0
          ? Promise.resolve(0n)
          : publicClient.readContract({ ...g, functionName: 'baitBalance', args: [me, BigInt(b.id)] }),
      ),
    ),
    publicClient.readContract({
      address: dep.fish,
      abi: fishNftAbi,
      functionName: 'isApprovedForAll',
      args: [me, dep.market],
    }),
    publicClient.readContract({
      address: dep.rod,
      abi: rodNftAbi,
      functionName: 'isApprovedForAll',
      args: [me, dep.market],
    }),
  ]);

  const fishIds = [...scan.fish];
  const rodIds = [...scan.rod];
  const [fishOwners, rodOwners] = await Promise.all([
    Promise.all(fishIds.map((id) => ownerOf('fish', id))),
    Promise.all(rodIds.map((id) => ownerOf('rod', id))),
  ]);
  const myFish = fishIds.filter((_, i) => fishOwners[i].toLowerCase() === me.toLowerCase());
  const myRods = rodIds.filter((_, i) => rodOwners[i].toLowerCase() === me.toLowerCase());
  // forget tokens that left (they come back through a new Transfer log if they return)
  fishIds.forEach((id, i) => fishOwners[i].toLowerCase() !== me.toLowerCase() && scan.fish.delete(id));
  rodIds.forEach((id, i) => rodOwners[i].toLowerCase() !== me.toLowerCase() && scan.rod.delete(id));

  const [fish, rods] = await Promise.all([
    Promise.all(myFish.map(readFish)),
    Promise.all(
      myRods.map(async (id) => {
        const [basic, upgradeCost, repairCost] = await Promise.all([
          readRodBasic(id),
          publicClient.readContract({ ...g, functionName: 'upgradeCost', args: [id] }),
          publicClient.readContract({ ...g, functionName: 'repairCost', args: [id] }),
        ]);
        return { ...basic, upgradeCost, repairCost };
      }),
    ),
  ]);
  // warm image cache in the background
  myFish.forEach((id) => void tokenImage('fish', id).then(() => emit()));

  if (state.wallet?.address !== me) return; // switched account mid-load
  const [pEnergy, pUpdated, pStarter, pXp, pCatches, pCasts, pBest] = player;
  state.eth = eth;
  state.pearl = pearl;
  state.energy = Number(energy);
  state.storedEnergy = Number(pEnergy);
  state.energyUpdatedAt = Number(pUpdated);
  state.starterClaimed = pStarter;
  state.xp = pXp;
  state.catches = pCatches;
  state.casts = pCasts;
  state.bestWeight = Number(pBest);
  state.refillPrice = refill;
  state.baitBalance = baitBal;
  state.marketApproved = { fish: apprFish, rod: apprRod };
  state.fish = fish.sort((a, b) => Number(b.id - a.id));
  state.rods = rods.sort((a, b) => Number(a.id - b.id));
  const [targetBlock, , spotId, baitId, rodId] = cast;
  state.cast = targetBlock === 0n ? null : { targetBlock, spotId, baitId, rodId };

  // keep selections valid
  if (state.cast) state.sel.rod = state.cast.rodId;
  if (!state.rods.some((r) => r.id === state.sel.rod)) {
    const best = [...state.rods].filter((r) => r.durability > 0).sort((a, b) => b.level - a.level)[0];
    state.sel.rod = best?.id ?? state.rods[0]?.id ?? null;
  }
  if (state.sel.bait !== 0 && (state.baitBalance[state.sel.bait] ?? 0n) === 0n) state.sel.bait = 0;
  emit();
}

// ------------------------------------------------------------------ world: marketplace, leaderboard, weekly record

const marketScan = { scanned: START - 1n, keys: new Map<string, { collection: Address; tokenId: bigint }>() };
const catches: CatchRecord[] = [];
let catchesScanned = START - 1n;

async function scanMarketRange(from: bigint, to: bigint): Promise<void> {
  const listed = await publicClient.getContractEvents({
    address: dep.market,
    abi: marketplaceAbi,
    eventName: 'Listed',
    fromBlock: from,
    toBlock: to,
  });
  // Cancelled/Sold only remove entries; the `listings` view below is the source of truth anyway.
  for (const l of listed) {
    const { collection, tokenId } = l.args;
    if (!collection || tokenId === undefined) continue;
    marketScan.keys.set(`${collection.toLowerCase()}:${tokenId}`, { collection, tokenId });
  }
  const gone = await publicClient.getLogs({
    address: dep.market,
    events: marketplaceAbi.filter(
      (i): i is Extract<(typeof marketplaceAbi)[number], { type: 'event'; name: 'Cancelled' | 'Sold' }> =>
        i.type === 'event' && (i.name === 'Cancelled' || i.name === 'Sold'),
    ),
    fromBlock: from,
    toBlock: to,
  });
  // An entry whose last event is Cancelled/Sold is dropped; a later Listed re-adds it.
  const lastListed = new Map<string, bigint>();
  listed.forEach((l) => lastListed.set(`${l.args.collection?.toLowerCase()}:${l.args.tokenId}`, idx(l)));
  for (const l of gone) {
    const args = l.args as { collection?: Address; tokenId?: bigint };
    const k = `${args.collection?.toLowerCase()}:${args.tokenId}`;
    if ((lastListed.get(k) ?? -1n) < idx(l)) marketScan.keys.delete(k);
  }
  marketScan.scanned = to;
}

function scanCaught(from: bigint, to: bigint) {
  return publicClient.getContractEvents({
    address: dep.game,
    abi: fishingGameAbi,
    eventName: 'Caught',
    fromBlock: from,
    toBlock: to,
  });
}

export async function loadWorld(): Promise<void> {
  if (!DEPLOYED) return;
  const head = await publicClient.getBlockNumber({ cacheTime: 0 });
  const g = { address: dep.game, abi: fishingGameAbi } as const;

  if (head > marketScan.scanned) await forRanges(marketScan.scanned + 1n, head, scanMarketRange);

  const entries = [...marketScan.keys.values()];
  const raw = await Promise.all(
    entries.map((e) =>
      publicClient.readContract({
        address: dep.market,
        abi: marketplaceAbi,
        functionName: 'listings',
        args: [e.collection, e.tokenId],
      }),
    ),
  );
  const listings: Listing[] = [];
  await Promise.all(
    entries.map(async (e, i) => {
      const [seller, price] = raw[i];
      if (seller === zeroAddress) return;
      const isFish = e.collection.toLowerCase() === dep.fish.toLowerCase();
      const item: Listing = {
        collection: isFish ? 'fish' : 'rod',
        address: e.collection,
        tokenId: e.tokenId,
        seller,
        price,
      };
      try {
        if (isFish) item.fish = await readFish(e.tokenId);
        else item.rod = await readRodBasic(e.tokenId);
        await tokenImage(item.collection, e.tokenId, !isFish);
      } catch {
        return;
      }
      listings.push(item);
    }),
  );
  state.listings = listings.sort((a, b) => (a.price < b.price ? -1 : a.price > b.price ? 1 : 0));

  if (head > catchesScanned) {
    const logs: Awaited<ReturnType<typeof scanCaught>> = [];
    await forRanges(catchesScanned + 1n, head, async (from, to) => {
      logs.push(...(await scanCaught(from, to)));
    });
    for (const l of logs) {
      const a = l.args;
      if (!a.player || a.fishId === undefined) continue;
      catches.push({
        player: a.player,
        fishId: a.fishId,
        speciesId: Number(a.speciesId),
        weight: Number(a.weight),
        spotId: Number(a.spotId),
        block: l.blockNumber,
      });
    }
    catches.sort((a, b) => b.weight - a.weight);
    catches.length = Math.min(catches.length, 10);
    catchesScanned = head;
  }
  state.leaderboard = [...catches];

  const week = await publicClient.readContract({ ...g, functionName: 'currentWeek' });
  const [angler, fishId, weight, speciesId] = await publicClient.readContract({
    ...g,
    functionName: 'weeklyBest',
    args: [week],
  });
  state.weekly = angler === zeroAddress ? null : { week, angler, fishId, weight, speciesId };
  emit();
}

function idx(l: { blockNumber: bigint | null; logIndex: number | null }): bigint {
  return (l.blockNumber ?? 0n) * 100000n + BigInt(l.logIndex ?? 0);
}

