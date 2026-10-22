# Onchain Fishing: hypothesis report

**Hypothesis.** A fishing game can run fully onchain: logic, randomness, items and the economy live in contracts, not on a server. Randomness stays fair and the economy doesn't fall apart.

**Short answer.**
- **The technical part holds.** The whole game loop is in contracts. Outcomes can't be re-rolled, and all metadata (SVG) is stored onchain. One attempt costs about 320k gas, which on Fluent (~0.001 gwei) is about 3·10⁻⁷ ETH.
- **The economy holds only because it is tuned, not by itself.** Tuning works against real players and refill bots. It cannot hold against sybil farms by onchain means alone. That is not an implementation bug but a property of any P2E model whose rewards are transferable while limits are per address.

Charts and tables: [`sim/out/report.html`](sim/out/report.html). Rebuild it with `python3 sim/sim.py && python3 sim/report.py`.

---

## 1. Comparable projects

| Project | Chain | What is onchain |
|---|---|---|
| Fishing Frenzy (Uncharted) | Ronin | rods, fish and chests are NFTs; game loop and points are offchain |
| MetaFish | BSC | NFTs and marketplace, P2E token |
| AceFishing (Com2uS) | — | fish and gear NFTs, rewards through contracts |
| FishVerse | mobile | fish NFTs, breeding and trading |

None of the projects found keeps the **fishing itself** onchain. Usually a server decides what was caught and the chain only records ownership. In this project everything is onchain.

## 2. What was built

```
contracts/   Foundry, Solidity 0.8.28, OpenZeppelin 5.4
  FishingGame.sol  — cast → reel loop, energy, bait, upgrades/repairs, selling, weekly record
  FishNFT.sol      — fish: species, exact weight, spot, time, catcher; onchain SVG image
  RodNFT.sol       — rods: level, durability; locked while in the water
  PearlToken.sol   — PEARL, the soft currency (minted by selling fish, burned by everything else)
  Marketplace.sol  — P2P trading of fish and rods for PEARL, 5% fee is burned
sim/         exact model of the contract formulas and an agent-based economy simulation
web/         browser client (Vite + viem)
```

**Catalog:** 20 fish species (from roach to bluefin tuna), 5 fishing spots gated by rod level, 3 bait types, 5 rod levels.

**Tests:** 51 tests — unit tests, fuzzing with 512 runs, a statistical catch-rate test over 1000 casts, and 4 invariants over 4096 random actions each. All pass (`forge test`).

### Fair randomness

`cast()` commits to block `N + 2`, and `reel()` uses that block's `blockhash`. At cast time the block doesn't exist yet. Once it exists the outcome is fixed and can't be replayed through a revert (checked by `test_outcomeIsFixedOnceTargetBlockExists`). Failing to reel in time only loses the catch: energy and bait are already spent. After 256 blocks the hash is no longer available and the fish gets away. Anyone can reel (`reelFor`), but the catch always goes to the player, which makes a keeper possible.

**Verified on Fluent Testnet** (chainId 20994): `blockhash(n-1)` read from a contract matches the real block hash, blocks older than 256 return 0, and `prevrandao` is non-zero. So the cast → reel mechanic works on Fluent as designed. The full deployment, rod claim, cast and `tokenURI` were run through `eth_call` on the Fluent executor, and gas matched anvil (9.52M vs 9.45M).

**Limitation.** On Fluent, as on any L2, blocks are produced by a sequencer, which could in theory influence `blockhash`. A game with real value needs VRF (Chainlink, Gelato, Pyth Entropy). Randomness is isolated in `_reel`, so swapping it is a local change.

### Gas (measured with `forge test --gas-report`)

| Action | Gas (median) |
|---|---|
| `claimStarterRod` | 130k |
| `cast` | 130k |
| `reel` with a catch (NFT mint) | 190k |
| `reel` with a miss | ~52k |
| `buyBait` | 68k |

One attempt costs about 320k gas. On Fluent Testnet gas is ~0.001 gwei and blocks are ~1 s, so an attempt costs ~3·10⁻⁷ ETH and `cast` to `reel` takes ~3 seconds.

## 3. Economy: what the simulation showed

The model (`sim/model.py`) reads the catalog straight from `GameSetup.sol` and mirrors the contract formulas. Agents (`sim/sim.py`) track every rod separately, with durability, repairs, bait, refills and upgrades. Every cast is rolled randomly.

**Archetypes:**
- casual: uses 35% of energy;
- regular: 70% of energy and 1 refill a day;
- grinder: 100% of energy and up to 4 refills;
- bot: up to 48 refills, buys only what pays back;
- farm: 50 addresses sharing one wallet.

### Draft v1 was broken

1. **A PEARL printer.** An energy refill cost 12 PEARL, while 20 energy on a level-5 rod earns about 112 PEARL. A bot refilling nonstop earned 6× a grinder and 120× a casual player. Its only limit was gas.
2. **Progression ends, emission doesn't.** A grinder reached level 5 by day 22, and by day 90 all 195 players were there. Upgrades were the only significant sink, so afterwards burning fell to 12% of minting. The first upgrade multiplied income ×5, and later growth was barely noticeable.

### v2: what changed and the result

**Contract changes:**
- energy refills cost ×2 for each further purchase within a day (`refillPriceGrowthBps`);
- an ETH fee for the starter rod (`starterRodFee`, 0 by default);
- an optional repair ban for low-level rods (`minRepairLevel`, off by default — see below).

**Parameter changes:**
- refill 20 PEARL;
- upgrades 80 / 450 / 1500 / 5000 PEARL;
- fish prices rescaled so income grows about 1.6× per level: 0.47 → 0.85 → 1.49 → 2.66 → 3.59 PEARL per energy. In v1 it was 0.26 → 1.31 (×5 on the very first upgrade).

| Metric (90 days, 195 real players) | v1 | v2 |
|---|---|---|
| PEARL in circulation | 2.5M | 0.54M |
| Burn / mint, last week | 0.12 | 0.77 |
| Bot income / grinder income | 6.1× | 1.0× |
| Casual: level 2 / 3 | day 14 / 25 | day 10 / 30 |
| Regular: level 5 | day 28 | day 81 |
| Grinder: level 5 | day 22 | day 43 |
| Everyone's level on day 90 | all at 5 | casuals 3, regulars ~5 |

### What tuning can't fix: farms

In v2 each farm address earns exactly like a bot grinder, so a 50-address farm earns 48× a single grinder. Onchain they are indistinguishable. What we tried:

- **Banning repairs on starter rods** (`minRepairLevel = 2`) hurt people, not farms. In 60 casts a newcomer collects ~20 PEARL, which is not enough for a new rod or an upgrade, so they get stuck. A farm pools PEARL from 50 addresses into one wallet and keeps growing. **Conclusion: any per-address limit favors multi-accounting.** That's why it is off by default.
- **A soft emission cap** (`emissionSoftCap`, 25k PEARL a day) holds supply down: 1.4M instead of 10.8M. But the pie is fixed and farms share it with people, so casual income halves. Without bots the cap never triggers: the `v2_cap` scenario matches `v2`.
- **An entry fee in ETH** (`starterRodFee`) is the only lever that makes every extra address expensive. A farm adds an address as long as expected per-address income × PEARL price exceeds fee + gas. A bot profits once the PEARL price exceeds "gas per PEARL × gas price". For a farm that is ~38,500 gas per PEARL. On Fluent at 0.001 gwei that's ~4·10⁻⁸ ETH per PEARL: farming pays at almost any non-zero PEARL price.

### Verdict

| Part | Verdict |
|---|---|
| Fully onchain loop, NFTs, metadata | ✅ works, verified on the Fluent Testnet executor |
| Fair randomness without a server | ✅ `blockhash` is correct on Fluent; ⚠️ real value needs VRF (sequencer) |
| Economy vs regular players and bots | ✅ after the v2 rebalance |
| Economy vs sybil farms | ❌ not solvable by onchain means |

**Next steps if this continues:**
1. **Make PEARL non-transferable** (soulbound) and keep real-value trading to NFTs only. Farms would then earn "points" they can't cash out, and farming becomes pointless. It's a small change in `PearlToken._update`, but the marketplace would then have to move to ETH.
2. **Sell the starter rod for ETH** and keep `emissionSoftCap` at a level derived from real activity. This is both a monetization model and a sybil barrier.
3. **Add skill.** Outcomes are pure randomness now, so a bot plays as well as a human. Onchain skill checks aren't possible without a trusted party. One option: competitive tournaments (the weekly record already exists) with prizes paid from a pool rather than from emission.
4. **Replace `blockhash` with VRF** before mainnet.
5. **Get an audit.** This is a one-night prototype.

## Known prototype limitations

- **Expired casts.** A player who sees a bad outcome can let the cast expire (256 blocks). This is never better than reeling: energy, bait and durability are charged regardless. The durability part was fixed overnight after the frontend review.
- **The weekly record compares raw weight across species.** Tuna and catfish will always win. A "trophy score" — weight relative to the species maximum — would be fairer.
- **Newcomers start with no PEARL**, so their first casts are without bait. A starter pack of worms would help.
- **A sold fish's metadata is burned with the NFT**, so the top list can't show images of sold fish.
- **The client builds market listings and the top list from logs** starting at the deploy block. That works locally, but a long-lived network needs an indexer (The Graph, Ponder).
- **`Marketplace.list`** returns an ERC721 error when listing someone else's NFT instead of a clear "not the owner".
