# Onchain Fishing — web client

Browser frontend for the contracts in `../contracts` (FishingGame, FishNFT, RodNFT, PearlToken, Marketplace).
Stack: Vite + TypeScript + viem, no UI framework (plain DOM + canvas).

## Fluent Testnet

After deploying (`contracts/deploy-fluent.sh`, see the root README), start the client like this:

```bash
pnpm dev:fluent
```

The client reads addresses from `deployments/20994.json` and adds the Fluent Testnet network (chainId 20994) to MetaMask on its own. There is no burner wallet in this mode: use MetaMask with test ETH from https://portal.fluent.xyz/builder/faucet.

## Quick start (local, anvil)

1. Start anvil with one-second blocks and deploy the contracts:

   ```sh
   anvil --block-time 1
   cd ../contracts
   forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast --private-key <anvil-key>
   ```

   The deploy script writes the addresses to `../deployments/31337.json`.

2. Install dependencies and start the frontend:

   ```sh
   cd web
   pnpm install
   pnpm dev          # http://localhost:5173 (runs pnpm sync before starting)
   ```

3. Open http://localhost:5173 and click **"Local burner (anvil)"**.

## Wallets

- **Browser wallet** (`window.ethereum`, e.g. MetaMask) — the "Connect wallet" button. The client will ask you to
  switch to the right network (or add it).
- **Local burner** — chainId 31337 (anvil) only. A random private key is generated and stored in this browser's
  `localStorage`, and 10 ETH is credited via `anvil_setBalance`. **Do not use this mode
  with real funds.** To start over with a new address, delete the `onchain-fishing:burner-key` key from localStorage.

## Scripts

| Command          | What it does                                                                                 |
| ---------------- | -------------------------------------------------------------------------------------------- |
| `pnpm sync`      | Copies ABIs from `../contracts/out/<Name>.sol/<Name>.json` and addresses from `../deployments/*.json` into `src/generated/` |
| `pnpm dev`       | `sync` + Vite dev server on port 5173                                                         |
| `pnpm build`     | `sync` + type check (`tsc`) + production build into `dist/`                                   |
| `pnpm typecheck` | type check only                                                                               |

After changing the contracts: `forge build` (and redeploy if needed), then `pnpm sync`.
If `contracts/out` is missing, `sync` keeps the already generated files.

## Settings (Vite environment variables)

- `VITE_RPC_URL` — node RPC (default `http://127.0.0.1:8545`).
- `VITE_CHAIN_ID` — chainId (default `31337`); addresses are taken from `deployments/<chainId>.json`.

## What's in the UI

- **Header**: address, ETH, PEARL, energy with a regen timer, XP, number of catches.
- **Water** (canvas): cast, the float bobs while we wait for blocks (`block N/M`), bite, auto reel
  (toggle) or the "Reel in!" button, a splash and a catch card with the fish SVG from `tokenURI`, "It got away!" on a miss.
- **Spot picker** (locked spots are greyed out and show the required rod level), **rods** (level/durability), **bait** (remaining stock).
- **Keepnet**: fish with images, weight and sell price (`quoteSell`), multi-select and selling (`sellFish`).
- **Shop**: bait, energy refill (`refillPrice`), new rod, upgrade/repair of the selected rod
  (`upgradeCost` / `repairCost`, repair unavailable below `minRepairLevel`). All prices are read from the contract.
- **Market**: list a fish/rod (with `setApprovalForAll`), cancel your own listing, buy someone else's (with PEARL `approve`).
  The listing index is built from `Listed`/`Cancelled`/`Sold` events starting at `startBlock` and checked against `listings()`.
- **Records**: weekly record (`weeklyBest(currentWeek())`) and the top 10 heaviest fish from `Caught` events.
- Contract errors (custom errors) are decoded using the ABIs of all contracts and shown as readable messages.

## Structure

```
scripts/sync-abi.mjs   generates src/generated/* from ../contracts/out and ../deployments
src/generated/         ABIs (as const) and addresses — generated, do not edit by hand
src/abi/index.ts       ABI re-exports
src/config.ts          network, RPC, addresses
src/clients.ts         publicClient, burner and injected wallets
src/store.ts           state and loading data from the chain (logs, view functions)
src/actions.ts         game and market transactions
src/tx.ts              simulate → send → receipt, toasts
src/errors.ts          custom error decoding
src/i18n.ts            rarity labels and contract error messages
src/scene.ts           canvas water animation
src/ui/*.ts            UI panels
```
