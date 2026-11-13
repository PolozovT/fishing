# Onchain Fishing — web client

Browser frontend for the contracts in `../contracts` (FishingGame, FishNFT, RodNFT, PearlToken, Marketplace).
Stack: Vite + TypeScript + viem, no UI framework (plain DOM + canvas).

## Two modes, one set of rules

- **On the contracts.** With a deployment in `../deployments/<chainId>.json` the game plays on Fluent: every
  action is a transaction, and the player's state is read from the chain through `GameLens` and shown with the
  same UI. Sign-in is Fluent Connect.
- **Local.** Without a deployment (or with `VITE_GAME_MODE=local`) the same rules run in the browser on a
  `localStorage` save: no transactions, no RPC. Useful for trying the game and for balance work.

`src/play/ops.ts` is the seam: each operation has a local implementation (a pure reducer) and a contract one
(a transaction, then a fresh read). `src/play/chain.ts` maps chain state onto the local `Save` shape and, at
start-up, compares the client's catalog with the contracts' and warns if a number has drifted.

One difference is deliberate. Locally the reel fight decides quality and can lose the fish. On the contracts the
fish, its weight and its quality are rolled by the contract (a client-reported result could be forged), so there
the fight is an animation of a catch that is already final; a better rod shifts the quality roll instead.

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

The local save is a JSON blob the player can edit: fine for a local game, worthless as evidence. On the contracts
nothing in the browser decides a catch, a balance or an unlock; the only client-side state there is cosmetic
(favourite stars, the last location picked).

## Wallets

- **Fluent Connect** ([`@fluent.xyz/connect`](https://www.npmjs.com/package/@fluent.xyz/connect)) — the
  "Connect with Fluent" button. The widget signs players in with a Fluent ID (a smart account, gas can be
  sponsored) or connects an External wallet through its own picker. Every game action is sent as a widget Batch
  operation (`src/fluent.tsx`, `src/tx.ts`). It needs, from the Fluent Dashboard:
  - `VITE_FLUENT_APP_ID` (`app_…`) and `VITE_FLUENT_PRIVY_CLIENT_ID` (`client-…`) in `web/.env.local`
    (see `.env.example`);
  - every page origin (e.g. `http://localhost:5180`) allow-listed for Direct login;
  - for sponsored gas: the app enabled for Sponsorship and Auth tokens.

  Players connect only through Fluent Connect; there is no other wallet option. On the contracts the connected account is the player; in the local game signing in is optional.

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

- `VITE_GAME_MODE` — `local` forces the local game even when a deployment exists.
- `VITE_CHAIN_ID` — chainId (default `20994`, Fluent Testnet; `25363` is Fluent mainnet); addresses are taken from `deployments/<chainId>.json`.
- `VITE_RPC_URL` — node RPC (default: the network's public RPC).

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
  ops.ts               every operation, local or contract
  chain.ts             contract backend: reads via GameLens, transactions, catalog check
  state.ts             the current Save (localStorage in local mode, a view of chain state otherwise)
  fishSprite.ts        pixel fish drawn from shape parameters
  ui/*.ts              pond, keepnet, collection, trophies, ranks, header
sim/balance.sim.ts     balance simulation
src/tx.ts, errors.ts   simulate → send through Fluent Connect → receipt, readable revert messages
src/scene.ts           canvas water animation (both modes)
src/fluent.tsx         Fluent Connect widget (React island)
scripts/sync-abi.mjs   generates src/generated/* from ../contracts/out and ../deployments
```
