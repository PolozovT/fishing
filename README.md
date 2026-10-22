# Onchain Fishing 🎣

A fishing game that runs entirely in smart contracts: casting, fair randomness, catches as NFTs with onchain art, the PEARL currency, upgradable rods, a marketplace and a weekly record.

Hypothesis results are in **[REPORT.md](REPORT.md)**; economy charts are in [sim/out/report.html](sim/out/report.html).

## Layout

| Folder | Contents |
|---|---|
| `contracts/` | Foundry project: `FishingGame`, `FishNFT`, `RodNFT`, `PearlToken`, `Marketplace` + 51 tests |
| `contracts/script/GameSetup.sol` | catalog: fish species, fishing spots, bait, prices, config |
| `sim/` | exact model of the contract formulas and an agent-based economy simulation (Python, no dependencies) |
| `web/` | browser client (Vite + TypeScript + viem), see [web/README.md](web/README.md) |
| `deployments/` | contract addresses per chainId (written by the deploy script) |

## Quick start (local)

You need [Foundry](https://getfoundry.sh), Node 20+ and pnpm.

1. A local chain with one block per second (without it `reel` would wait forever):

```bash
anvil --block-time 1
```

2. Deploy from another terminal. `0xf39F…` is anvil's public test account:

```bash
cd contracts && forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast --unlocked --sender 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
```

3. Client:

```bash
cd web && pnpm install && pnpm sync && pnpm dev
```

Open http://localhost:5173 and choose the local burner wallet: it creates a throwaway key and funds it on anvil.

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

Blocks come about once per second and gas is ~0.001 gwei. The full deployment (39 transactions, ~16.7M gas) costs about 0.00002 ETH. One attempt (cast + reel) costs about 3·10⁻⁷ ETH.

1. `contracts/.env` already holds a dedicated **testnet-only** deployer key (the file is git-ignored). Fund its address from the faucet:

```bash
grep DEPLOYER_ADDRESS contracts/.env
```

2. Deploy and verify the sources on fluentscan:

```bash
contracts/deploy-fluent.sh
```

To deploy from your own wallet (a key in the Foundry keystore) instead:

```bash
contracts/deploy-fluent.sh --account <key-name>
```

3. Client for Fluent (connects through MetaMask; the network is added automatically):

```bash
cd web && pnpm dev:fluent
```

> ⚠️ Randomness comes from `blockhash`. It works on Fluent (verified on testnet: the value matches the real block hash), but blocks are produced by a sequencer, which could in theory influence outcomes. Anything with real value needs VRF (see REPORT.md). The code is not audited.

## Game loop

1. `claimStarterRod()` — a free level-1 rod (or one priced at `starterRodFee` in ETH).
2. `cast(rodId, spotId, baitId)` — spends energy and bait, locks the rod and commits to target block `N+2`.
3. `reel()` — after the target block, the outcome comes from its `blockhash`: catch or miss, which species, what weight. The catch is minted as an NFT.
4. `sellFish(ids)` — sell fish for PEARL. You can also keep them or list them on the marketplace.
5. PEARL is spent on bait, energy refills (each further refill on the same day costs ×2), repairs, new rods and upgrades. Upgrades unlock new spots and raise the odds of rare fish.

Energy: max 20, regenerates 1 every 15 minutes. If a catch is not reeled in within 256 blocks, the fish gets away.
