# Onchain Fishing 🎣

A fishing game that runs in smart contracts: casting, fair randomness, rods and lures, catches as NFTs with onchain art, the PEARL currency, a species collection, special fish that unlock new waters, and a weekly championship.

Hypothesis results for the first version are in **[REPORT.md](REPORT.md)**; the current balance is in [web/BALANCE.md](web/BALANCE.md).

## Layout

| Folder | Contents |
|---|---|
| `contracts/` | Foundry project: `FishingGame` and `Tournaments` (both behind upgradeable proxies), `FightVerifier`, `BottlePool`, `GameLens`, `FishNFT`, `PearlToken`, `PearlExchange`, `Marketplace` + 102 tests |
| `contracts/script/GameSetup.sol` | catalog: species, locations, rods, lures, special fish, achievements, config |
| `sim/` | model of the first version's formulas and an agent-based economy simulation (Python) |
| `web/` | browser client (Vite + TypeScript + viem), see [web/README.md](web/README.md) |
| `deployments/` | contract addresses per chainId (written by the deploy script) |

## Quick start

You need Node 20+ and pnpm (and [Foundry](https://getfoundry.sh) for the contracts).

```bash
cd web && pnpm install && pnpm dev
```

Open http://localhost:5180. With a deployment in `deployments/20994.json` the client plays on the contracts on **Fluent Testnet** (sign in with **Connect with Fluent**). Without one it runs the same rules locally in the browser.

## Tests and simulation

```bash
cd contracts && forge test
```

```bash
python3 sim/sim.py && python3 sim/report.py
```

## Deploying to Fluent Testnet

| | |
|---|---|
| Network | Fluent Testnet |
| chainId | 20994 |
| RPC | https://rpc.testnet.fluent.xyz |
| Explorer | https://testnet.fluentscan.xyz |
| Faucet | https://portal.fluent.xyz/builder/faucet |

Blocks come about once per second and gas is ~0.001 gwei. The full deployment (~25M gas) costs about 0.00003 ETH. One attempt (cast + reel) is about 0.5M gas, roughly 5·10⁻⁷ ETH.

1. `contracts/.env` already holds a dedicated **testnet-only** deployer key (the file is git-ignored). Fund its address from the faucet:

```bash
grep DEPLOYER_ADDRESS contracts/.env
```

2. Deploy and verify the sources on fluentscan:

```bash
contracts/deploy-fluent.sh
```

This is a complete, fresh deployment: tokens, market, lens, the BLEND → PEARL exchange, the game, the bottle pool and the tournaments. `BLEND_TOKEN` picks the BLEND token (default: the testnet Mock Blend).

To deploy from your own wallet (a key in the Foundry keystore) instead:

```bash
contracts/deploy-fluent.sh --account <key-name>
```

3. Client (players connect with Fluent Connect — set the widget ids in `web/.env.local`, see `web/.env.example`):

```bash
cd web && pnpm dev
```

> ⚠️ Randomness comes from `blockhash`. It works on Fluent (verified on testnet: the value matches the real block hash), but blocks are produced by a sequencer, which could in theory influence outcomes. Anything with real value needs VRF (see REPORT.md). The code is not audited.

## Upgrading without losing progress

`FishingGame` and `Tournaments` sit behind transparent proxies (OpenZeppelin). Their addresses and all player state are permanent; a new version is new code behind the same address:

```bash
cd contracts && ./check-layout.sh
```

```bash
TARGET=game forge script script/Upgrade.s.sol --rpc-url fluent_testnet --broadcast --private-key <owner key>
```

`TARGET=tournaments` upgrades the tournaments. `check-layout.sh` compares the storage layout with the one recorded at the last deployment (`contracts/storage/`): a new version may only **append** state variables, anything else would corrupt player state and the script says so. `PearlToken`, `FishNFT`, the market and the exchange are plain contracts and are never replaced. Whoever owns the proxies can change the rules, so on a mainnet the owner should be a multisig with a delay.

## Tournaments

Short events with a BLEND prize pool where the fight decides the score. Each tournament is fished with one rod and only players who own that rod in the game may enter (everyone owns the first one), so everyone fishes the same water with the same tackle and the same number of casts; every cast hooks a fish (which one is the block-hash draw); the player gets one fight at it. The browser records the fight as one bit per 50 ms tick, and `Tournaments.reel(id, inputs)` replays the recording in `FightVerifier` and scores the catch: half the fish's points for landing it, up to all of them by the share of the fight spent in the green. The score of a tournament is the sum of the best `counted` catches; ties go to whoever got there first; the top three share the prize pool 50 / 30 / 20 and claim it themselves.

A tournament may ask an **entry fee** in BLEND (`enter` takes it; the client signs the approval and the entry as one batch). Its prize pool is the larger of two numbers: the guarantee the organiser put up when opening it, and the fees less the organiser's share (the rake). A small field plays for the guarantee, a large one for its own fees, and `reclaim` sends the organiser whatever the contract holds above the pool once the tournament is over.

| Entries at 5 BLEND, guarantee 300, rake 15% | Prize pool | Organiser |
|---|---|---|
| 10 | 300 | −250 |
| 60 | 300 | 0 |
| 71 | 301.75 | +53.25 |
| 200 | 850 | +150 |

So the organiser breaks even at guarantee ÷ fee entries and earns the rake from guarantee ÷ (fee × (1 − rake)) on; below that the guarantee is the cost of a prize worth entering for. Free tournaments (fee 0) work as before and are where a new player's first BLEND comes from.

```bash
contracts/new-tournament.sh "Pond Cup" 0 0 0 0 25000 60 10080 30 10 300 5 15
```

(the arguments are documented in the script; the last three are the guarantee, the fee and the rake in percent). `FightVerifier` is behind an interface, so the replay can be swapped for another implementation, for example a Rust contract on Fluent, with `Tournaments.setVerifier`.

> ⚠️ The fight seed is public once its block exists, so a program can compute a perfect recording, and a person can replay a fight by reloading within the two-minute deadline. The replay proves the input produces the score, not that a human produced the input. Fine for a testnet; an open event with real money needs an allow-list or a server that streams the fish live.

## The BLEND bottle

Now and then a bite is not a fish but a sealed bottle with BLEND in it, paid to the player's wallet in the same transaction that settles the cast. The game rolls for it (0.1% of bites, one bottle per player ever); `BottlePool` holds the money and says whether there is a bottle to give:

| Rule | Value | Where |
|---|---|---|
| Prize | 1,000 BLEND | `BottlePool.amount` |
| Player level | 5 or higher (1,000 XP, about 140 casts at the pond) | `BottlePool.minLevel` |
| Found per UTC day, all players together | 2 | `BottlePool.dailyMax` |
| Chance per bite / bottles per player | 0.1% / 1 | `FishingGame.config` |

The pool is the BLEND balance of the `bottles` address in `deployments/<chainId>.json`: send BLEND there to fund it, and the bottles can never cost more than was sent. With less than one whole bottle in the pool, a "bottle" roll lands a fish as usual. The owner changes the rules with `BottlePool.setRules(amount, minLevel, dailyMax)` and takes unspent BLEND back with `withdraw`.

> ⚠️ Free play has no skill onchain, so a script can level up many wallets and fish for the bottle. The level and the daily limit only slow that down; the pool size is the real cap on what it can take.

## Economy

Two currencies. **PEARL** is earned by selling fish and by achievements, and burned on rods, lures, repairs and energy refills; it never leaves the game. **BLEND** is the outside token: it comes in when a player pays a tournament entry fee or buys PEARL at the exchange (100 PEARL per BLEND, one way, to the treasury), and goes out as tournament prizes and bottles.

| Rod | PEARL | Bought on day (about six energy bars a day) |
|---|---|---|
| Willow Rod | free | 1 |
| Carbon Spinner | 1,500 | 1 |
| Ironwood Rod | 4,000 | |
| Taiga Fly Rod | 12,000 | 4 |
| Deep Troller | 30,000 | 11 |
| Pearl Master | 150,000 | 29 |

Lures are 100 to 900 PEARL for 40 to 80 casts (Abyss Spoon 3,000 for 25). A full repair is 1.5% of the rod's price. The days are from the balance simulation ([web/BALANCE.md](web/BALANCE.md), "Progression in days") for a player who lands nearly every fish; a script that never lets the energy bar fill gets there about six times sooner, a beginner about three times later. A rod opens the tournaments fished with it (equal tackle inside each), so better rods mean richer leagues, not better odds.

The prices live in `GameSetup.rodPrices()` / `lurePrices()` and in `web/src/tackle/catalog.ts` (the client warns when the two differ). To change them on a deployed game, edit both and run:

```bash
forge script script/Economy.s.sol --rpc-url fluent_testnet --broadcast --private-key <owner key>
```

Rods already bought stay bought.

## Game loop (contracts)

1. `cast(locationId)` spends energy, one point of rod durability and one lure cast, and commits to target block `N+2`. The equipped rod, lure and active special-fish bonus are fixed at this moment.
2. `reel()` after the target block: the outcome comes from that block's `blockhash`. Does anything bite, is it the special fish of the location, which species, what weight, what quality (D–S). The catch is minted as an NFT. Anyone may call `reelFor(player)`.
3. `sellFish(ids)` burns the fish for PEARL: base price × weight factor × quality. Fish can also be kept or listed on the marketplace.
4. PEARL can also be bought for BLEND through `PearlExchange.buyPearl(blendAmount)` at a fixed rate (100 PEARL per BLEND on testnet); the BLEND goes to the treasury.
5. PEARL is burned on rods (`buyRod`), lures (`buyLure`), repairs and energy refills (each further refill on the same day costs ×2).
6. Progress is onchain: XP and level, the species encyclopedia, permanent location unlocks, personal records, the ten best catches of each week, and achievements that pay PEARL once.

What the contract decides, the client cannot. Once a cast's block exists its outcome is fixed and public, so the client computes it, plays the bite, the hook and the fight on it, and settles afterwards: skill there changes how soon you land the fish, never which fish it is. See [ARCHITECTURE.md](ARCHITECTURE.md).

Energy: max 20, regenerates 1 every 2 minutes. If a cast is not reeled in within 256 blocks, the fish gets away.
