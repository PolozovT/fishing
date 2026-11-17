# Fishing flow: who decides what

This note covers one question: how far player skill can count in a game whose valuable outcomes are decided by a
contract, when the only client is a browser the player controls.

## The lifecycle

```
cast(location)            transaction   spends energy, rod wear and a lure cast; fixes the tackle;
                                        commits to the hash of block N+2
… the block is produced   ~2 s          from here the outcome is fixed and public
bite · hook · fight       in the client the client works the outcome out and plays it
reel()                    transaction   the contract computes the same outcome and applies it:
                                        mints the fish, XP, encyclopedia, records, weekly score
```

Two transactions per catch, and none in the middle of the game. A cast with nothing on the hook needs no
settlement transaction at all: the next `cast()` settles it.

### What decides the result

| | Local game | On the contracts |
|---|---|---|
| Does anything bite | client RNG | contract, from the block hash |
| Species, weight | client RNG | contract, from the block hash |
| Quality (D–S) | share of the fight spent in the green | contract; a better rod shifts the roll, a rarer fish lowers it |
| Hooking too late | the fish is lost | the fish bites again |
| Losing the fight | the fish is lost | another try, with an easier fight; after three the fish is hauled in |
| Price, tournament score | from the above | from the above |

Location, rod and lure matter in both modes. In the local game the hook and the fight decide whether the fish is
landed and how good it is. On the contracts they decide only how soon the player gets to settle, and they produce
the "your fight" line on the catch card, which is information for the player and worth nothing.

## Why skill does not change value on the contracts

The contract cannot see the fight, so skill could only reach it as a number the browser reports. Three ways to do
that were considered.

**A. The contract decides everything (chosen).** Nothing reported by the client is used. Nothing can be forged.
Skill cannot change value.

**B. A backend validates the fight and signs the result.** The contract would check the signature. This is the
only option where skill changes value and a casual forger is stopped. It needs a server that holds a signing key,
replays or re-simulates the input log, enforces nonces, expiry and rate limits, and stays online; and it still
cannot tell a person from a bot that plays the mini-game well. That is a project of its own, not a change to this
one. Not built.

**C. The client reports its result and the contract takes the lower of that and its own roll.** No forgery is
possible upward. But a modified client simply always reports the maximum, so in practice everyone who cheats gets
today's outcome and everyone who plays honestly gets less. It would add an unfairness to the weekly table that
does not exist now. Rejected.

A signature made in the browser adds nothing to C: the player holds the key.

So the fight was made real in the only way that needs no trust: the outcome of a cast is a pure function of public
data once its block exists, so the client computes it (`web/src/game/chainOutcome.ts`), shows a bite only when
there is one, sets the hook window and the fight to the fish that is actually there, and settles afterwards.
A player who bypasses the client gains nothing but time: they can call `reel()` directly and get exactly the fish
the contract would have given them anyway.

### Keeping the prediction honest

The prediction decides nothing, but a wrong one would show the player a fish that is not there. So:

- `contracts/test/Vectors.t.sol` writes 240 real outcomes with all their inputs to
  `web/src/game/fixtures/outcomes.json`; the client's tests replay every one through the prediction.
  Regenerate after changing `_reel`: `WRITE_VECTORS=true forge test --match-contract VectorsTest`.
- The prediction uses the contracts' own catalog and `loadout()` view, not the client's copy.
- At settlement the client compares what it predicted with what the contract emitted and logs any difference.
  The contract's answer is the one shown.
- If the prediction cannot be made (RPC trouble), the client falls back to settling first and showing the fight
  as a replay.

## Failure handling

- **Transaction rejected or failed at cast:** nothing was spent; back to "ready".
- **Transaction rejected or failed at settlement:** the fish waits "at the pier" with a *Land it* button. The fight
  is not replayed.
- **Reload or a second tab mid-cast:** the pending cast is read from the contract and the bite is staged again.
- **Double settlement:** the contract deletes the cast when it settles; a second `reel()` reverts `NoActiveCast`.
- **Expiry:** a block hash is readable for 256 blocks (about four minutes). If retries run long, the client settles
  with ~45 blocks to spare. Past that the cast is void, which is the contract's rule, not the client's.

## Randomness

Outcomes come from `blockhash(targetBlock)` of a block two after the cast, mixed with the player, a per-player
nonce and the contract address. This is **not** manipulation-resistant randomness.

- **Sequencer.** Fluent blocks are produced by a sequencer. Whoever builds block N+2 can choose its contents and
  so its hash, and can grind for an outcome on a cast it cares about. Players cannot; the sequencer can.
- **Selective settlement.** A player sees the outcome before settling. Tested: energy, rod wear and the lure cast
  are spent at cast time, no counter moves on a skipped cast, and the next cast gets fresh randomness, so letting
  a poor result expire only wastes the cast.
- **Delay.** Settling later changes nothing while the hash is readable (fuzz-tested: any settler, any block in
  the window, same result).
- **Value at stake.** Today: testnet tokens and NFTs with no market. That is why this is acceptable now.

Before anything with real value rides on a catch, the source should be a VRF or a randomness beacon.
**Consequences of switching:** the randomness source is compiled into `FishingGame`. The game runs behind an
upgradeable proxy, so a new source is an upgrade that keeps all player progress, not a new game. An oracle-based
source also changes the flow: the contract waits for a callback instead of reading a block hash, so `reel()`
becomes "claim when fulfilled". Not done here; it needs a decision first.

## Tournaments: where skill does decide

In free play the fight changes nothing onchain. Tournaments are the opposite by design, and they do it without a
server: the fight itself is verified by the contract.

1. `Tournaments.cast(id)` spends one of the player's casts and commits to block `N+2`.
2. Once that block exists the fish is fixed and public (`web/src/game/tournamentRoll.ts` mirrors
   `Tournaments._roll`), and so is the fight seed.
3. The browser runs the fight as an integer machine on a fixed 50 ms tick (`web/src/game/fight.ts`), driven by
   one bit per tick: is the player reeling. It records the bits.
4. `Tournaments.reel(id, inputs)` hands the recording to `FightVerifier.replay`, the same machine in Solidity, and
   scores what it reports: nothing for a lost fish, otherwise the fish's points × (50% + 50% × share of ticks in
   the green).

The two implementations are pinned together by vectors: `fixtures/fights.json` (fights recorded by the client,
replayed by the Solidity tests) and `fixtures/tournament.json` (draws made by the contract, replayed by the client
tests), plus `pnpm live`, which plays a tournament on the deployed contracts and compares every score.

What this does and does not prove: the contract never trusts a result from the browser, only an input, and it
computes the result itself. It cannot tell who produced the input. The seed is public, so a bot can search for a
perfect recording, and a person can retry a fight by reloading until the deadline (about two minutes from the
bite). Mitigations that need no server: the deadline, the cast limit, equal tackle, a rod that must be owned to enter. Mitigations that do:
an allow-list of entrants, or a referee that streams the fish live and co-signs the result (`setVerifier` and an
upgrade leave room for both).

## Contract changes that would help (none are deployed)

1. **`GameLens.previewCast(player)`**: the same prediction as a view function. It would replace the TypeScript
   mirror with code that can be fuzz-tested against the game in the same Foundry suite. The lens holds no state and
   no permissions, so deploying a new one touches no progress.
2. **Tackle passed to `cast(location, rod, lure)`** instead of separate `equipRod`/`equipLure` transactions:
   two fewer confirmation windows when changing gear. An upgrade of the game proxy; progress is kept.
3. **A session key or sponsored, review-free calls** for `cast`/`reel`, if the wallet supports it: the remaining
   friction is the confirmation window, not the gas.
4. **Verified skill (option B)**: a signer address in the contract and `reel(result, signature)`, plus the backend
   described above.
5. **VRF or beacon randomness**, as above.

## Limits

- In free play on the contracts, skill changes time and nothing else. In tournaments the fight is replayed by the
  contract and decides the score; see above for what that does not prove.
- The model players in `web/BALANCE.md` are models. The landing rates are estimates to check by hand.
- A bot can play the mini-game. On the contracts that buys nothing; in the local game nothing is at stake.
