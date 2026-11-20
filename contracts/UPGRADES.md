# Upgrading the contracts

`FishingGame` and `Tournaments` run behind OpenZeppelin transparent proxies. Their addresses and everything players
own or have done are permanent; an upgrade is new code behind the same address. The other contracts (`PearlToken`,
`FishNFT`, `BottlePool`, `PearlExchange`, `Marketplace`, `FightVerifier`, `GameLens`) are plain contracts and are
never replaced in place.

This file is the procedure and the tooling around it. Nothing here needs a private key until the upgrade
transaction itself.

## What an upgrade must keep

Strict guarantees, checked by the tests on every change: XP, PEARL balances, owned rods and their durability, lures,
unlocked locations, special fish found, the encyclopedia and records, claimed achievements, who holds which fish and
the fish's attributes and metadata, weekly scores, tournament entries, standings and prizes, a cast that is in the
water.

Not guaranteed, because it is game balance and changes on purpose: prices, energy, bite chance, pools, rewards. A
code upgrade never touches any of it (see "The upgrade script"); balance is changed by its own, explicit transaction
(`script/Economy.s.sol`).

## The tools

| Command | What it does | Needs |
|---|---|---|
| `./preflight.sh` | everything below that works offline, in order; this is what CI runs | forge, python3, node |
| `./preflight.sh fluent_testnet` | the same, then the releases against the chain and the upgrade rehearsed on a fork | + RPC |
| `./check-layout.sh` | storage layout of the current code against the released code | forge, python3 |
| `./check-layout.sh --selftest` | proves the layout rules reject each kind of incompatible change | python3 |
| `./validate-upgrade.sh` | OpenZeppelin's upgrade validation against the build of the released source | forge, node, git history |
| `./release.sh record <rpc>` | snapshots what the proxies run now into `releases/` | RPC |
| `./release.sh verify <rpc> [--source]` | checks the snapshots against the chain; `--source` rebuilds them from their commits | RPC |
| `./release.sh check-impl <Contract> <address> <rpc>` | is a deployed implementation this build, with the proxy's dependencies? | RPC |
| `forge script script/Upgrade.s.sol --sig "check()"` | prints what a proxy runs; sends nothing | RPC |

### Release snapshots (`releases/`)

`releases/<chainId>/<Contract>/<NNN>/` is what runs behind a proxy, recorded from the chain:

| File | Content |
|---|---|
| `release.json` | network, chain id, proxy, proxy admin, implementation, runtime code hash and size, the addresses fixed in the bytecode and where they sit in it, compiler settings, the source commit |
| `abi.json` | the implementation's ABI |
| `storage-layout.json` | its storage layout without build-specific ids |
| `runtime.hex` | the runtime bytecode as it is on the chain |

`releases/<chainId>/index.json` names the latest release of each contract.

A release is only recorded when a commit rebuilds the on-chain bytecode byte for byte (the immutables aside): the
tool tries the working tree, then walks back through the commits of `contracts/src`. That commit goes into
`release.json`, and `./release.sh verify <rpc> --source` repeats the proof at any time: it checks out the commit,
builds it and compares. There are no timestamps in a release, so recording the same chain state at the same commit
gives the same files. `release.json` also carries a SHA-256 of the other three files.

A release holds public chain data and build output only. The tools never read `.env` or a key.

The first releases were recorded from Fluent Testnet: `FishingGame` 001 (implementation `0xDF73…dC1`, commit
`00ae715`) and `Tournaments` 001 (implementation `0x795E…171`, commit `b252c37`).

### Storage layout check (`check-layout.sh`, `tools/layout.py`)

Compares the layout of the current build with `storage-layout.json` of the latest release of every chain. Unlike the
first version of this script, it looks inside every struct, wherever it is stored:

- state variables: the released list must be an exact prefix of the new one;
- every struct: its released fields must be an exact prefix of its new fields;
- a struct stored inline (a state variable such as `config`, an array element such as `Item`, `Location`,
  `Tournament`, a field of another struct) must keep its size. Only a struct that is a mapping value (`Player`,
  `Cast`, `Entry`, `Terms`) may grow at its end;
- every other stored type keeps its size, key, value and base type.

What a layout cannot show and no tool here checks: a change of meaning of a field that keeps its type (a unit, a bit
mask), new members of an enum, immutables, and ERC-7201 namespaces. Those are for review.

### OpenZeppelin validation (`validate-upgrade.sh`)

Runs `@openzeppelin/upgrades-core validate` (pinned version) with `--requireReference`: each contract is compared
with the build of its release's source commit, checked out into a throwaway worktree and cached under `cache/`. It
covers the storage layout again, independently of our own check, plus `delegatecall`, `selfdestruct`, initializer
problems and the validator's other rules.

Two findings are allowed by name in the script, and the validator still prints a warning for each on every run:

| Finding | Why it is allowed |
|---|---|
| `constructor` | The constructors fix the token addresses in the bytecode and lock the bare implementation (`initialize` reverts on it). Proxy state is set by `initialize`. OpenZeppelin's non-upgradeable `Ownable` has a constructor too; it writes the implementation's own owner, never the proxy's. |
| `state-variable-immutable` | The token addresses are immutables. A new implementation must be built with the same ones; the upgrade script and `release.sh check-impl` verify that. |

Nothing else is allowed, and the storage check is never skipped. A new finding fails the script; do not add it to
the list without a written reason here.

### Tests

`test/Upgrade.t.sol` does not upgrade the current source to itself. The proxies are created on `runtime.hex` of the
latest release (the token addresses in it swapped for the test's own tokens), and the whole world is played on that
code: players of different levels, PEARL balances, a bought and worn rod, lures, the Golden Koi and the Golden Lake
it opens, claimed achievements, a fish listed on the marketplace, catches in several weeks, a finished paid
tournament with one prize claimed, a running one with a fish on the line, an upcoming one, and a cast in the water.
Then the proxies are pointed at the current source and the tests compare:

- every storage slot the world wrote, in the game, the tournaments, PEARL and the fish (all but the implementation slot);
- everything about every player, every fish (owner, attributes, `tokenURI`, sale value) and every tournament,
  through the public functions;
- gameplay: the same stretch of play (landing the pending cast and fight, new casts, selling, buying, repairing, a
  prize) on the released code and on the new code must emit the same events and leave the same state. When a release
  changes a rule on purpose, this is the test that says so, and it is updated with the reason.

`test/UpgradeFork.t.sol` is the rehearsal on the real thing: a fork of a live network, upgraded by the real
`script/Upgrade.s.sol` with all its checks, as the proxy admin's owner. Every player the chain can name (holders and
catchers of fish, weekly boards, tournament leaders, the owner), every fish and every tournament must read the same
after it, and the game is played on. It is skipped unless `FORK_RPC` is set:

```bash
FORK_RPC=fluent_testnet forge test --match-contract UpgradeForkTest -vv
```

### The upgrade script (`script/Upgrade.s.sol`)

It changes the code and nothing else. The earlier version also re-applied prices, repairs, energy and the bottle
chance from `GameSetup` after every upgrade; that is gone, so an upgrade cannot reset the balance. Before it sends
anything it reverts unless:

- the proxy runs exactly the implementation the latest release records;
- the token addresses read from the proxy are the ones in `deployments/<chainId>.json`, and the new implementation
  is built with them;
- the new implementation's bytecode is this build (`out/`), and it is within the 24,576-byte limit;
- the sender owns the proxy's `ProxyAdmin`;
- after the upgrade the proxy runs the new code, and its owner, config and counters read as before.

It prints the proxy, the old and new implementation, the code size and hash, and what to do next.

## The procedure

1. **Freeze the code.** Commit; the build inputs (`src`, `lib`, `foundry.toml`) must be clean.
2. **Preflight, with the network.** It must end with `preflight passed`.

   ```bash
   cd contracts && ./preflight.sh fluent_testnet
   ```

3. **Mind what is in flight.** A cast is settled with the rules in force when it is reeled, and it lives at most 256
   blocks; a tournament reads the game's catalog for as long as it runs. Until the contracts enforce it (planned,
   see "Remaining risks"), do not change the code of `_reel`, the config, pools or species while it matters: upgrade
   when no rule changes, or settle open casts first (`reelFor` is open to anyone) and wait for running tournaments.
4. **Upgrade.** One contract per run.

   ```bash
   TARGET=game forge script script/Upgrade.s.sol --rpc-url fluent_testnet --broadcast --private-key <owner key>
   ```

   To look at the implementation on the chain before anything depends on it, do it in two steps: `--sig
   "deployOnly()"`, then `./release.sh check-impl FishingGame <address> fluent_testnet`, then `IMPL=<address>` with
   `--sig "switchTo()"`.
5. **Record and verify the release**, and commit `contracts/releases`.

   ```bash
   ./release.sh record fluent_testnet
   ```

   ```bash
   ./release.sh verify fluent_testnet --source
   ```

6. **Balance, if the release needs it**, as its own step: `forge script script/Economy.s.sol …`.
7. **Client.** If the ABI changed: deploy a new `GameLens`, put its address in `deployments/`, and publish the web
   client together with the upgrade (`pnpm build` syncs the ABI). The client warns when its catalog differs from
   the chain's.

### Rollback

Rolling back is an upgrade to the previous implementation, whose address is in its release. It is safe only while
the new code has not written anything the old code cannot read (a new `unlockType`, a rod id beyond the old count, a
new bit). So new features ship switched off and are switched on by a separate transaction; after that the fix is
forward only. Minted and burned PEARL and fish, and paid BLEND, are never rolled back.

## Contract size

`FishingGame` is 24,336 bytes: 240 under the limit. **Fluent enforces EIP-170.** Checked on Fluent Testnet by
simulating a contract creation (`eth_estimateGas`, no transaction): a runtime of 24,576 bytes is accepted, 24,577
is refused with `CreateContractSizeLimit`.

Measured on the current source (each in a throwaway checkout, nothing of it is in the repository):

| Change | `FishingGame` size | Free |
|---|---|---|
| as it is (`optimizer_runs = 100`, `via_ir`) | 24,336 | 240 |
| `optimizer_runs = 1` | 24,246 | 330 |
| `optimizer_runs = 1000` | 26,078 | over by 1,502 |
| no metadata trailer | 24,282 | 294 |
| `CatchMath` as a linked (external) library | 24,634 | over by 58 |
| without the content setters (`addRod` … `setHidden`; `setPrice` and `setConfig` kept) | 20,944 | 3,632 |
| without the shop, repair, refill and claim | 21,402 | 3,174 |
| without the struct-returning views | 21,646 | 2,930 |
| paid location unlocks added (`buyLocation`, `setLocationOffer`, one mapping) | 25,173 | over by 597 |

So the next feature does not fit, and build settings alone do not make it fit.

| | 1. Reduce the contract | 2. Libraries or narrow modules | 3. Delegatecall extension |
|---|---|---|---|
| What it is | Build settings; and removing the owner-only content setters, adding content through an upgrade instead | A separate contract per feature that calls the game through a small hook; or linked libraries | The implementation forwards unknown selectors to a second contract that shares its storage |
| Room gained | 90–150 bytes from settings; 3,392 from the content setters | A module costs the game only its hook (a few hundred bytes); a linked library of small functions costs more than it saves (measured: +298) | 6,418 measured for setup and shop together, for a fallback of under 100 bytes |
| Security | No new trust | A new privilege per module: a shop must be able to set unlock bits and burn PEARL, and a PEARL minter can mint and burn for anyone | Same trust as the implementation, but two contracts must agree on one storage layout, and a selector present in both is silently served by the first |
| Gas | Slightly higher with `optimizer_runs = 1` | One more external call on the module's paths | One more delegatecall on the extension's paths; `cast` and `reel` unchanged |
| Storage | Untouched | The module has its own storage; the game appends at most a module address | Shared; both contracts need the layout check, new state belongs in ERC-7201 namespaces |
| Upgrades | As now; every new rod, location or species becomes a code upgrade | Modules are deployed and wired separately; more addresses in every release | Two implementations per release; the OpenZeppelin validator reports `delegatecall` and needs a reviewed exception at that one line |
| Migration risk | None | None for players; a wrongly wired hook can unlock for free | None if the layouts match; a mismatch corrupts state |

**Recommendation.** Do not build the extension now. For paid location unlocks, remove the owner-only content setters
from `FishingGame` (3,392 bytes, no new mechanism, no new trust) and add content in the `initializer` of an upgrade,
which the tooling in this file now makes a checked, rehearsed operation. That leaves about 2,800 bytes after the
feature. Keep `optimizer_runs` as it is: 90 bytes are not worth higher gas for players. Revisit the extension only
when the player-facing code itself no longer fits; modules are the better choice for features that are optional and
hold their own state.

## Secrets

Checked on this repository: `contracts/.env` and `web/.env.local` are ignored and were never committed; the deployer
key does not occur in any commit; `web/.env.example` holds placeholders. `contracts/broadcast/` is tracked for
public networks and holds public transaction data only.

One exposure to know about: the deployer key is a plain-text key on a developer machine, and that one address owns
both proxy admins, the game, the tournaments, `PearlToken`, `FishNFT` and `BottlePool`. It is a testnet-only key. A
network with real value needs the owner to be a multisig behind a timelock before launch.

## Remaining risks

- **Rules in flight.** A cast in the water and a running tournament read the live config and catalog. Today this is
  a rule of the procedure (step 3), not something the contracts enforce.
- **Fish metadata.** `FishNFT.updateSpecies` rewrites the name, rarity and weight range of every fish of a species,
  and a raised minimum weight makes `tokenURI` revert for lighter fish. Do not call it; add a new species instead.
- **One key** owns everything (see "Secrets").
- **Players the chain cannot name.** The fork rehearsal compares every player it can find through fish, boards and
  tournaments. A player who cast and never landed anything is not found; their state is covered by the slot
  comparison of the local test only in kind, not individually.
- **`GameLens` and the client** are bound to the ABI: a struct returned by a view may only gain fields at its end,
  and a release that changes the ABI needs a new lens and a client release.
- **The two layout checks agree on storage only.** Neither sees a field whose meaning changed while its type stayed.
