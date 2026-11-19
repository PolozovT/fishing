/**
 * End to end on the deployed contracts: opens a small tournament, enters it, casts, predicts the fish with the
 * client code, fights it with the stand-in player, sends the recording and checks that the contract scored
 * exactly what the client predicted. The tournament has an entry fee, so that is paid too. Spends testnet gas and a
 * little Mock Blend from the deployer.
 *
 * Run: pnpm live   (needs DEPLOYER_KEY in ../contracts/.env)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createPublicClient, createWalletClient, erc20Abi, http, parseEther, parseEventLogs, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it } from 'vitest';
import { LOCATIONS, SPECIES } from '../src/game/content';
import { botInputs, fightSeedOf, packInputs, pointsFor, replayFight, tournamentCastSeed } from '../src/game/fight';
import { tournamentFish } from '../src/game/tournamentRoll';
import { fishingGameAbi } from '../src/generated/FishingGame';
import { tournamentsAbi } from '../src/generated/Tournaments';

const dep = JSON.parse(readFileSync(fileURLToPath(new URL('../../deployments/20994.json', import.meta.url)), 'utf8')) as Record<string, Hex>;
const env = readFileSync(fileURLToPath(new URL('../../contracts/.env', import.meta.url)), 'utf8');
const key = /^DEPLOYER_KEY=(\S+)/m.exec(env)?.[1] as Hex;
const transport = http('https://rpc.testnet.fluent.xyz');
const chain = { id: 20994, name: 'Fluent Testnet', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: ['https://rpc.testnet.fluent.xyz'] } } } as const;
const pub = createPublicClient({ chain, transport });
const account = privateKeyToAccount(key);
const wallet = createWalletClient({ account, chain, transport });
const cup = { address: dep.tournaments, abi: tournamentsAbi } as const;
const game = { address: dep.game, abi: fishingGameAbi } as const;

const send = async (hash: Hex) => {
  const r = await pub.waitForTransactionReceipt({ hash, pollingInterval: 500 });
  expect(r.status).toBe('success');
  return r;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const catalog = {
  locations: LOCATIONS.map((l) => ({ special: 0, speciesIds: l.pool.map(([id]) => id), weights: l.pool.map(([, w]) => w) })),
  species: SPECIES.map((s) => ({ rarity: s.rarity, minWeight: s.minWeight, maxWeight: s.maxWeight, hidden: !!s.hidden })),
};

describe('a tournament on the deployed contracts', () => {
  it('scores recorded fights exactly as the client predicts', async () => {
    const prize = parseEther('3');
    const fee = parseEther('1');
    if ((await pub.readContract({ address: dep.blend, abi: erc20Abi, functionName: 'allowance', args: [account.address, cup.address] })) < prize + fee) {
      await send(await wallet.writeContract({ address: dep.blend, abi: erc20Abi, functionName: 'approve', args: [cup.address, parseEther('1000000')] }));
    }
    const now = Number((await pub.getBlock()).timestamp);
    const t = { locationId: 3, rod: 0, lure: 4, waterTier: 2, green: 31_250 }; // the starter rod: every account may enter
    const id = await pub.readContract({ ...cup, functionName: 'count' });
    await send(
      await wallet.writeContract({
        ...cup,
        functionName: 'create',
        args: [{ name: 'Self-test (ignore)', start: now, end: now + 240, ...t, castLimit: 6, counted: 3, prize, fee, rakeBps: 1500 }],
      }),
    );
    const blendBefore = await pub.readContract({ address: dep.blend, abi: erc20Abi, functionName: 'balanceOf', args: [account.address] });
    await send(await wallet.writeContract({ ...cup, functionName: 'enter', args: [id] }));
    // the entry fee is taken, and one fee is far below the guarantee, so the pool is the guarantee
    expect(blendBefore - (await pub.readContract({ address: dep.blend, abi: erc20Abi, functionName: 'balanceOf', args: [account.address] }))).toBe(fee);
    expect((await pub.readContract({ ...cup, functionName: 'termsOf', args: [id] })).collected).toBe(fee);
    expect(await pub.readContract({ ...cup, functionName: 'pool', args: [id] })).toBe(prize);
    const lo = await pub.readContract({ ...game, functionName: 'loadout', args: [BigInt(t.rod), BigInt(t.lure), 0n, BigInt(t.locationId)] });
    const tackle = { locationId: t.locationId, waterTier: t.waterTier, rodCatch: Number(lo[0]), rarity: Number(lo[2]), weightBonus: Number(lo[3]) };

    let expectedTotal: number[] = [];
    for (let castNo = 1; castNo <= 4; castNo++) {
      await send(await wallet.writeContract({ ...cup, functionName: 'cast', args: [id] }));
      const target = (await pub.readContract({ ...cup, functionName: 'entryOf', args: [id, account.address] })).targetBlock;
      while ((await pub.getBlockNumber({ cacheTime: 0 })) <= target) await sleep(500);
      const hash = (await pub.getBlock({ blockNumber: target })).hash;
      const seed = tournamentCastSeed(hash, account.address, id, BigInt(castNo), cup.address);
      const fish = tournamentFish(catalog, tackle, seed);
      // the last fight is thrown on purpose: a held line snaps
      const bits = castNo === 4 ? Array<boolean>(160).fill(true) : botInputs(fightSeedOf(seed), fish.difficulty, t.green, castNo);
      const inputs = packInputs(bits);
      const mine = replayFight(fightSeedOf(seed), fish.difficulty, t.green, inputs);
      const receipt = await send(await wallet.writeContract({ ...cup, functionName: 'reel', args: [id, inputs] }));
      const [ev] = parseEventLogs({ abi: tournamentsAbi, logs: receipt.logs, eventName: 'TournamentCatch' });
      const points = mine.landed ? pointsFor(fish.base, mine.ticks, mine.good) : 0;
      console.log(`cast ${castNo}: ${SPECIES[fish.speciesId].name} ${fish.weight} g, base ${fish.base}, d${fish.difficulty} → ${mine.landed ? 'landed' : 'lost'} in ${mine.ticks} ticks, ${mine.good} good → ${points} pts (gas ${receipt.gasUsed})`);
      expect({ ...ev.args, id: undefined, player: undefined, total: undefined }).toEqual({
        speciesId: fish.speciesId,
        weight: fish.weight,
        quality: fish.quality,
        base: fish.base,
        points,
        landed: mine.landed,
        ticks: mine.ticks,
        good: mine.good,
        id: undefined,
        player: undefined,
        total: undefined,
      });
      if (points) expectedTotal = [...expectedTotal, points].sort((a, b) => b - a).slice(0, 3);
      expect(ev.args.total).toBe(expectedTotal.reduce((a, b) => a + b, 0));
    }
    const [players, totals] = await pub.readContract({ ...cup, functionName: 'standings', args: [id] });
    if (expectedTotal.length) {
      expect(players[0].toLowerCase()).toBe(account.address.toLowerCase());
      expect(totals[0]).toBe(expectedTotal.reduce((a, b) => a + b, 0));
    }
    console.log(`tournament ${id}: total ${totals[0] ?? 0}. Prize is claimable ${240 + 300}s after it opened (claim/reclaim not exercised here).`);
  });
});
