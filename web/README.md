# Onchain Fishing — web client

Browser frontend for the contracts in `../contracts` (FishingGame, FishNFT, RodNFT, PearlToken, Marketplace).
Stack: Vite + TypeScript + viem, no UI framework (plain DOM + canvas).

## Two modes

- **Local game (default).** The whole game runs in the browser: cast, hook, reel, sell, buy tackle, collect,
  unlock waters, weekly cup. Progress is saved in `localStorage`. No contracts, no transactions, no RPC.
- **Onchain client.** `VITE_GAME_MODE=onchain` plus a deployment in `../deployments/<chainId>.json` switches to
  the contract client (`src/app.ts`), which reads everything from Fluent. The contracts do not know rod types,
  lures, quality or special fish yet, so that client has the older, smaller rule set.

```sh
pnpm install
pnpm dev          # http://localhost:5180
pnpm test         # unit tests of the game rules (vitest)
pnpm sim          # balance simulation, rewrites BALANCE.md
```

## Local game

Loop: pick a location → equip a rod and a lure → cast → wait for the float → **Hook!** → hold to keep the fish
inside the zone → the fish lands with a species, weight and quality grade (D–S) → keep it or sell it for PEARL →
buy tackle → rarer fish, new waters.

- **Rods** widen the reel zone (catch), **lures** raise the bite chance (catch); both add rarity and weight.
  Rarity is a relative weighting of rarer species, not percentage points. Location bonuses apply only at their
  locations. All of it is summed in `game/equipment.ts`.
- **Price** = base price × weight factor × quality. **Tournament score** = rarity points × weight factor (0.7–1.5)
  × quality, fixed when the fish lands; selling keeps the points.
- **Special fish** (Golden Koi, Ancient Catfish, Ghost Fish) are very rare, open a new water for good and carry a
  passive bonus (one active slot, needs a specimen in hand). They are local collectibles, not NFTs.
- **Weekly cup**: the ten best catches of the week. Weeks roll over Thursday 00:00 UTC, the same as the
  contract's `currentWeek()`. Opponents are generated and labelled DEMO; no rank rewards are paid.
- Numbers and the reasoning behind them: [BALANCE.md](BALANCE.md).

### Trust

The save is a JSON blob the player can edit. That is fine for a local game and worthless as evidence: nothing in
it may later count as proof of a catch, a reward or NFT eligibility. When the game goes onchain, catches and
rewards have to be decided by the contracts or a trusted server, and `play/state.ts` is the one module to replace.

## Wallets

- **Fluent Connect** ([`@fluent.xyz/connect`](https://www.npmjs.com/package/@fluent.xyz/connect)) — the
  "Connect with Fluent" button. The widget signs players in with a Fluent ID (a smart account, gas can be
  sponsored) or connects an External wallet through its own picker. Every game action is sent as a widget Batch
  operation (`src/fluent.tsx`, `src/tx.ts`). It needs, from the Fluent Dashboard:
  - `VITE_FLUENT_APP_ID` (`app_…`) and `VITE_FLUENT_PRIVY_CLIENT_ID` (`client-…`) in `web/.env.local`
    (see `.env.example`);
  - every page origin (e.g. `http://localhost:5180`) allow-listed for Direct login;
  - for sponsored gas: the app enabled for Sponsorship and Auth tokens.

  Players connect only through Fluent Connect; there is no other wallet option. In the local game signing in is optional and changes nothing yet.

## Scripts

| Command          | What it does                                                                                 |
| ---------------- | -------------------------------------------------------------------------------------------- |
| `pnpm sync`      | Copies ABIs from `../contracts/out/<Name>.sol/<Name>.json` and addresses from `../deployments/*.json` into `src/generated/` |
| `pnpm dev`       | `sync` + Vite dev server on port 5180                                                         |
| `pnpm build`     | `sync` + type check (`tsc`) + production build into `dist/`                                   |
| `pnpm typecheck` | type check only                                                                               |
| `pnpm test`      | unit tests of the game rules                                                                  |
| `pnpm sim`       | balance simulation (100k casts per loadout), writes `BALANCE.md`                              |

After changing the contracts: `forge build` (and redeploy if needed), then `pnpm sync`.
If `contracts/out` is missing, `sync` keeps the already generated files.

## Settings (Vite environment variables)

- `VITE_GAME_MODE` — `onchain` for the contract client; anything else (default) is the local game.
- `VITE_CHAIN_ID` — chainId (default `20994`, Fluent Testnet; `25363` is Fluent mainnet); addresses are taken from `deployments/<chainId>.json`.
- `VITE_RPC_URL` — node RPC (default: the network's public RPC).

## What's in the UI (onchain client)

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
src/game/              the rules, pure TypeScript, no DOM and no storage
  content.ts           species, locations, special fish, tuning numbers
  equipment.ts         rod + lure + location + special bonuses, capped
  generate.ts          species odds (normalised), weight roll, special roll
  economy.ts           prices, XP, levels, repair and refill costs
  minigame.ts          the reel fight as a step function, quality grades
  tournament.ts        score, week boundaries, top ten, demo standings
  progress.ts          unlocks (permanent vs ownership), encyclopedia, achievements
  actions.ts           every state change as (save, input) → new save
  save.ts              save shape, versioned migrations
  game.test.ts         unit tests
src/tackle/            rod and lure catalog, sprites, the shop page
src/play/              the local game's shell
  state.ts             persistence boundary (localStorage today)
  fishSprite.ts        pixel fish drawn from shape parameters
  ui/*.ts              pond, keepnet, collection, trophies, ranks, header
sim/balance.sim.ts     balance simulation
src/app.ts, store.ts, actions.ts, tx.ts, ui/*.ts   the onchain client
src/scene.ts           canvas water animation (both modes)
src/fluent.tsx         Fluent Connect widget (React island)
scripts/sync-abi.mjs   generates src/generated/* from ../contracts/out and ../deployments
```
