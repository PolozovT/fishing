# Onchain Fishing 🎣

A fishing game that runs in smart contracts: casting, fair randomness, rods and lures, catches as NFTs with onchain art, the PEARL currency, a species collection, special fish that unlock new waters, and a weekly championship.

Hypothesis results for the first version are in **[REPORT.md](REPORT.md)**; the current balance is in [web/BALANCE.md](web/BALANCE.md).

## Layout

| Folder | Contents |
|---|---|
| `contracts/` | Foundry project: `FishingGame` and `Tournaments` (both behind upgradeable proxies), `FightVerifier`, `GameLens`, `FishNFT`, `PearlToken`, `PearlExchange`, `Marketplace` + 86 tests |
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

This is a complete, fresh deployment: tokens, market, lens, the BLEND → PEARL exchange, the game and the tournaments. `BLEND_TOKEN` picks the BLEND token (default: the testnet Mock Blend).

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

Short events with a BLEND prize where the fight decides the score. Each tournament is fished with one rod and only players who own that rod in the game may enter (everyone owns the first one), so everyone fishes the same water with the same tackle and the same number of casts; every cast hooks a fish (which one is the block-hash draw); the player gets one fight at it. The browser records the fight as one bit per 50 ms tick, and `Tournaments.reel(id, inputs)` replays the recording in `FightVerifier` and scores the catch: half the fish's points for landing it, up to all of them by the share of the fight spent in the green. The score of a tournament is the sum of the best `counted` catches; ties go to whoever got there first; the top three share the prize 50 / 30 / 20 and claim it themselves.

```bash
contracts/new-tournament.sh "Village Pond Open" 0 0 0 0 25000 60 30 30 10 100
```

(the arguments are documented in the script). `FightVerifier` is behind an interface, so the replay can be swapped for another implementation, for example a Rust contract on Fluent, with `Tournaments.setVerifier`.

> ⚠️ The fight seed is public once its block exists, so a program can compute a perfect recording, and a person can replay a fight by reloading within the two-minute deadline. The replay proves the input produces the score, not that a human produced the input. Fine for a testnet; an open event with real money needs an allow-list or a server that streams the fish live.

## Game loop (contracts)

1. `cast(locationId)` spends energy, one point of rod durability and one lure cast, and commits to target block `N+2`. The equipped rod, lure and active special-fish bonus are fixed at this moment.
2. `reel()` after the target block: the outcome comes from that block's `blockhash`. Does anything bite, is it the special fish of the location, which species, what weight, what quality (D–S). The catch is minted as an NFT. Anyone may call `reelFor(player)`.
3. `sellFish(ids)` burns the fish for PEARL: base price × weight factor × quality. Fish can also be kept or listed on the marketplace.
4. PEARL can also be bought for BLEND through `PearlExchange.buyPearl(blendAmount)` at a fixed rate (100 PEARL per BLEND on testnet); the BLEND goes to the treasury.
5. PEARL is burned on rods (`buyRod`), lures (`buyLure`), repairs and energy refills (each further refill on the same day costs ×2).
6. Progress is onchain: XP and level, the species encyclopedia, permanent location unlocks, personal records, the ten best catches of each week, and achievements that pay PEARL once.

What the contract decides, the client cannot. Once a cast's block exists its outcome is fixed and public, so the client computes it, plays the bite, the hook and the fight on it, and settles afterwards: skill there changes how soon you land the fish, never which fish it is. See [ARCHITECTURE.md](ARCHITECTURE.md). The BLEND bottle (a rare non-fish catch) is recorded by the game contract; no token is transferred.

Energy: max 20, regenerates 1 every 2 minutes. If a cast is not reeled in within 256 blocks, the fish gets away.
