# Onchain Fishing — web client

Browser frontend for the contracts in `../contracts` (FishingGame, FishNFT, RodNFT, PearlToken, Marketplace).
Stack: Vite + TypeScript + viem, no UI framework (plain DOM + canvas).

## Quick start

The client runs against **Fluent Testnet** (chainId 20994) and reads the contract addresses from
`../deployments/20994.json`, which `contracts/deploy-fluent.sh` writes (see the root README). Until the
contracts are deployed there, the page says so instead of loading the game.

```sh
pnpm install
pnpm dev          # http://localhost:5180 (runs pnpm sync before starting)
```

## Wallets

- **Fluent Connect** ([`@fluent.xyz/connect`](https://www.npmjs.com/package/@fluent.xyz/connect)) — the
  "Connect with Fluent" button. The widget signs players in with a Fluent ID (a smart account, gas can be
  sponsored) or connects an External wallet through its own picker. Every game action is sent as a widget Batch
  operation (`src/fluent.tsx`, `src/tx.ts`). It needs, from the Fluent Dashboard:
  - `VITE_FLUENT_APP_ID` (`app_…`) and `VITE_FLUENT_PRIVY_CLIENT_ID` (`client-…`) in `web/.env.local`
    (see `.env.example`);
  - every page origin (e.g. `http://localhost:5180`) allow-listed for Direct login;
  - for sponsored gas: the app enabled for Sponsorship and Auth tokens.

  Players connect only through Fluent Connect; there is no other wallet option.

## Scripts

| Command          | What it does                                                                                 |
| ---------------- | -------------------------------------------------------------------------------------------- |
| `pnpm sync`      | Copies ABIs from `../contracts/out/<Name>.sol/<Name>.json` and addresses from `../deployments/*.json` into `src/generated/` |
| `pnpm dev`       | `sync` + Vite dev server on port 5180                                                         |
| `pnpm build`     | `sync` + type check (`tsc`) + production build into `dist/`                                   |
| `pnpm typecheck` | type check only                                                                               |

After changing the contracts: `forge build` (and redeploy if needed), then `pnpm sync`.
If `contracts/out` is missing, `sync` keeps the already generated files.

## Settings (Vite environment variables)

- `VITE_CHAIN_ID` — chainId (default `20994`, Fluent Testnet; `25363` is Fluent mainnet); addresses are taken from `deployments/<chainId>.json`.
- `VITE_RPC_URL` — node RPC (default: the network's public RPC).

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
src/clients.ts         publicClient and the connected-account record
src/fluent.tsx         Fluent Connect widget (React island) and the Batch-operation sender
src/store.ts           state and loading data from the chain (logs, view functions)
src/actions.ts         game and market transactions
src/tx.ts              simulate → send → receipt, toasts
src/errors.ts          custom error decoding
src/i18n.ts            rarity labels and contract error messages
src/scene.ts           canvas water animation
src/ui/*.ts            UI panels
```
