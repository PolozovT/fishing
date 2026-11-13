# Onchain Fishing 🎣

A fishing game that runs in smart contracts: casting, fair randomness, rods and lures, catches as NFTs with onchain art, the PEARL currency, a species collection, special fish that unlock new waters, and a weekly championship.

Hypothesis results for the first version are in **[REPORT.md](REPORT.md)**; the current balance is in [web/BALANCE.md](web/BALANCE.md).

## Layout

| Folder | Contents |
|---|---|
| `contracts/` | Foundry project: `FishingGame`, `GameLens`, `FishNFT`, `PearlToken`, `PearlExchange`, `Marketplace` + 51 tests |
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

The BLEND → PEARL exchange is a separate, optional contract added to an existing deployment (the sender must own `PearlToken`):

```bash
BLEND_TOKEN=0x… forge script script/DeployExchange.s.sol --rpc-url fluent_testnet --broadcast --private-key <key>
```

To deploy from your own wallet (a key in the Foundry keystore) instead:

```bash
contracts/deploy-fluent.sh --account <key-name>
```

3. Client (players connect with Fluent Connect — set the widget ids in `web/.env.local`, see `web/.env.example`):

```bash
cd web && pnpm dev
```

> ⚠️ Randomness comes from `blockhash`. It works on Fluent (verified on testnet: the value matches the real block hash), but blocks are produced by a sequencer, which could in theory influence outcomes. Anything with real value needs VRF (see REPORT.md). The code is not audited.

## Game loop (contracts)

1. `cast(locationId)` spends energy, one point of rod durability and one lure cast, and commits to target block `N+2`. The equipped rod, lure and active special-fish bonus are fixed at this moment.
2. `reel()` after the target block: the outcome comes from that block's `blockhash`. Does anything bite, is it the special fish of the location, which species, what weight, what quality (D–S). The catch is minted as an NFT. Anyone may call `reelFor(player)`.
3. `sellFish(ids)` burns the fish for PEARL: base price × weight factor × quality. Fish can also be kept or listed on the marketplace.
4. PEARL can also be bought for BLEND through `PearlExchange.buyPearl(blendAmount)` at a fixed rate (100 PEARL per BLEND on testnet); the BLEND goes to the treasury.
5. PEARL is burned on rods (`buyRod`), lures (`buyLure`), repairs and energy refills (each further refill on the same day costs ×2).
6. Progress is onchain: XP and level, the species encyclopedia, permanent location unlocks, personal records, the ten best catches of each week, and achievements that pay PEARL once.

What the contract decides, the client cannot: the reel fight in the browser is an animation of a result that is already final. The BLEND bottle (a rare non-fish catch) is recorded by the game contract; no token is transferred.

Energy: max 20, regenerates 1 every 2 minutes. If a cast is not reeled in within 256 blocks, the fish gets away.
