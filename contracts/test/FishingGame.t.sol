// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Vm} from "forge-std/Vm.sol";
import {BaseTest} from "./Base.t.sol";
import {FishNFT} from "../src/FishNFT.sol";
import {FishingGame} from "../src/FishingGame.sol";
import {GameLens} from "../src/GameLens.sol";
import {BottlePool} from "../src/BottlePool.sol";
import {GameSetup} from "../script/GameSetup.sol";
import {Economy} from "../script/Economy.s.sol";

import {CatchMath} from "../src/CatchMath.sol";

contract FishingGameTest is BaseTest {
    // ------------------------------------------------------------------ catalog

    function test_catalogIsSeeded() public view {
        GameLens.Catalog memory c = lens.catalog();
        assertEq(c.rods.length, 6);
        assertEq(c.lures.length, 6);
        assertEq(c.locations.length, 8);
        assertEq(c.specials.length, 3);
        assertEq(c.achievements.length, 14);
        assertEq(c.species.length, 36);
        assertTrue(c.hidden[14] && c.hidden[34] && c.hidden[35]);
        assertEq(c.rods[5].price, 150_000 * E);
    }

    function test_legendAchievementMatchesTheCatalog() public view {
        GameLens.Catalog memory c = lens.catalog();
        uint256 legends;
        for (uint256 i; i < c.species.length; i++) if (c.species[i].rarity >= 4) legends++;
        assertEq(c.achievements[12].arg, legends, "the 'all legends' goal must equal the number of legendary+ species");
    }

    function test_everyUnlockFishLivesSomewhereReachable() public view {
        GameLens.Catalog memory c = lens.catalog();
        // walk the unlock graph: special-gated locations open once their special lives in an open location
        bool[] memory open = new bool[](c.locations.length);
        bool[] memory found = new bool[](c.specials.length);
        for (uint256 round; round < 10; round++) {
            for (uint256 i; i < open.length; i++) {
                FishingGame.Location memory l = c.locations[i];
                if (l.unlockType != 3 || found[l.unlockArg]) open[i] = true;
                if (open[i] && l.special != 0) found[l.special - 1] = true;
            }
        }
        for (uint256 i; i < open.length; i++) assertTrue(open[i], "location can never open");
    }

    // ------------------------------------------------------------------ bonuses

    function test_loadoutAddsRodLureAndLocationBonus() public view {
        // Deep Troller (4) + Glow Jig (3 → 4) at Northern Sea (3)
        (int256 rodCatch, uint256 bite, uint256 rarity, uint256 weight, uint256 hm) = game.loadout(4, 4, 0, 3);
        assertEq(rodCatch, 7);
        assertEq(bite, 6_500 + 1_000);
        assertEq(rarity, 45);
        assertEq(weight, 20);
        assertEq(hm, 1);
        // the same tackle on the pond gets no location bonus
        (rodCatch, bite, rarity, weight,) = game.loadout(4, 4, 0, 0);
        assertEq(rodCatch, 2);
        assertEq(bite, 6_500 + 200);
        assertEq(rarity, 0);
        assertEq(weight, 8);
    }

    function test_flyRodLosesCatchAwayFromMovingWater() public view {
        (int256 pond,,,,) = game.loadout(3, 0, 0, 0);
        (int256 rapids,, uint256 rarity,,) = game.loadout(3, 3, 0, 4);
        assertEq(pond, -4);
        assertEq(rapids, 4);
        assertEq(rarity, 40 + 60 + 40 + 70);
    }

    function test_specialBonusRespectsItsLocations() public view {
        (,, uint256 atGolden,,) = game.loadout(0, 0, 1, 5);
        (,, uint256 atPond,,) = game.loadout(0, 0, 1, 0);
        assertEq(atGolden, 25);
        assertEq(atPond, 0);
        (,,, uint256 weight,) = game.loadout(0, 0, 2, 0);
        assertEq(weight, 8);
        (,,,, uint256 hm) = game.loadout(0, 0, 3, 7);
        assertEq(hm, 3);
    }

    function test_loadoutIsCappedEverywhere() public view {
        for (uint256 r; r < 6; r++) {
            for (uint256 l; l <= 6; l++) {
                for (uint256 s; s <= 3; s++) {
                    for (uint256 loc; loc < 8; loc++) {
                        (, uint256 bite, uint256 rarity, uint256 weight,) = game.loadout(r, l, s, loc);
                        assertLe(bite, 9_500);
                        assertGe(bite, 500);
                        assertLe(rarity, 300);
                        assertLe(weight, 60);
                    }
                }
            }
        }
    }

    // ------------------------------------------------------------------ cast and reel

    function test_castSpendsEnergyAndCommitsToAFutureBlock() public {
        vm.prank(alice);
        game.cast(0);
        FishingGame.Cast memory c = game.castOf(alice);
        assertEq(c.targetBlock, block.number + 2);
        assertEq(game.currentEnergy(alice), 19);
        vm.prank(alice);
        vm.expectRevert(FishingGame.TooEarly.selector);
        game.reel();
        vm.prank(alice);
        vm.expectRevert(FishingGame.CastInProgress.selector);
        game.cast(0);
    }

    function test_reelNeedsACast() public {
        vm.expectRevert(FishingGame.NoActiveCast.selector);
        vm.prank(alice);
        game.reel();
    }

    function test_lockedLocationCannotBeFished() public {
        vm.prank(alice);
        vm.expectRevert(FishingGame.LocationLocked.selector);
        game.cast(7);
        vm.prank(alice);
        vm.expectRevert(FishingGame.UnknownLocation.selector);
        game.cast(8);
    }

    function test_notEnoughEnergy() public {
        for (uint256 i; i < 20; i++) _fishOnce(alice, 0, bytes32(i + 1));
        vm.prank(alice);
        vm.expectRevert(FishingGame.NotEnoughEnergy.selector);
        game.cast(0);
        vm.warp(block.timestamp + 2 minutes);
        assertEq(game.currentEnergy(alice), 1);
    }

    function test_anyoneCanReelForAPlayer() public {
        vm.prank(alice);
        game.cast(0);
        uint64 target = game.castOf(alice).targetBlock;
        vm.roll(target + 1);
        // find an entropy that lands a fish, then let bob finish the cast
        vm.setBlockhash(target, keccak256("some block"));
        vm.prank(bob);
        game.reelFor(alice);
        assertEq(fish.balanceOf(bob), 0);
        assertEq(game.castOf(alice).targetBlock, 0);
    }

    function test_expiredCastLosesTheFish() public {
        vm.prank(alice);
        game.cast(0);
        vm.roll(block.number + 300);
        vm.expectEmit(true, false, false, false);
        emit FishingGame.CastExpired(alice);
        vm.prank(alice);
        game.reel();
        assertEq(fish.balanceOf(alice), 0);
    }

    function test_newCastResolvesTheFinishedOne() public {
        vm.prank(alice);
        game.cast(0);
        vm.roll(block.number + 3);
        vm.prank(alice);
        game.cast(0);
        assertEq(game.playerOf(alice).casts, 2);
    }

    function testFuzz_catchIsAlwaysFromTheLocationPool(bytes32 entropy) public {
        uint256 id = _fishOnce(alice, 0, entropy);
        if (id == 0) return;
        FishNFT.Fish memory f = fish.fish(id);
        FishNFT.Species memory s = fish.species(f.speciesId);
        assertTrue(f.speciesId <= 4 || f.speciesId == 20, "not a Village Pond species");
        assertGe(f.weight, s.minWeight);
        assertLe(f.weight, s.maxWeight);
        assertLe(f.quality, 4);
        assertEq(f.angler, alice);
        assertEq(fish.ownerOf(id), alice);
    }

    function test_biteRateIsNearTheConfiguredChance() public {
        uint256 bites;
        uint256 n = 600;
        for (uint256 i; i < n; i++) {
            if (game.currentEnergy(alice) == 0) _rest();
            uint256 before = game.playerOf(alice).catches + game.playerOf(alice).blendWins;
            _fishOnce(alice, 0, keccak256(abi.encode("bite", i)));
            if (game.playerOf(alice).catches + game.playerOf(alice).blendWins > before) bites++;
        }
        assertApproxEqAbs(bites, (n * 65) / 100, 40);
    }

    // ------------------------------------------------------------------ settlement cannot be gamed

    function test_aCastSettlesExactlyOnce() public {
        vm.prank(alice);
        game.cast(0);
        uint64 target = game.castOf(alice).targetBlock;
        vm.roll(target + 1);
        vm.setBlockhash(target, keccak256("once"));
        vm.prank(alice);
        game.reel();
        uint256 fishAfter = fish.nextId();
        uint256 xpAfter = game.playerOf(alice).xp;
        vm.prank(alice);
        vm.expectRevert(FishingGame.NoActiveCast.selector);
        game.reel();
        vm.prank(bob);
        vm.expectRevert(FishingGame.NoActiveCast.selector);
        game.reelFor(alice);
        assertEq(fish.nextId(), fishAfter, "no second fish");
        assertEq(game.playerOf(alice).xp, xpAfter, "no second reward");
    }

    /// @dev The outcome is a function of the committed block only: who settles, and when, changes nothing.
    function testFuzz_outcomeDoesNotDependOnWhoSettlesOrWhen(bytes32 entropy, uint8 delay) public {
        uint256 snap = vm.snapshotState();
        (uint16 spA, uint32 wA, uint8 qA, uint256 blendA) = _settle(entropy, 1, alice);
        vm.revertToState(snap);
        (uint16 spB, uint32 wB, uint8 qB, uint256 blendB) = _settle(entropy, 1 + uint256(delay) % 200, bob);
        assertEq(spA, spB);
        assertEq(wA, wB);
        assertEq(qA, qB);
        assertEq(blendA, blendB);
    }

    function _settle(bytes32 entropy, uint256 blocksLater, address settler)
        internal
        returns (uint16 species, uint32 weight, uint8 quality, uint256 blend)
    {
        vm.prank(alice);
        game.cast(0);
        uint64 target = game.castOf(alice).targetBlock;
        vm.roll(target + blocksLater);
        vm.setBlockhash(target, entropy);
        uint256 next = fish.nextId();
        vm.prank(settler);
        game.reelFor(alice);
        blend = game.blendWon(alice);
        if (fish.nextId() > next) {
            FishNFT.Fish memory f = fish.fish(next);
            assertEq(fish.ownerOf(next), alice, "the catch always goes to the player who cast");
            return (f.speciesId, f.weight, f.quality, blend);
        }
    }

    /// @dev There is nothing a client can claim: reel takes no arguments, so the only inputs are the committed
    ///      block and the tackle fixed at cast time. Swapping tackle after the cast must not change the result.
    function test_changingTackleAfterTheCastChangesNothing() public {
        _fund(alice, 150_000 * E);
        vm.prank(alice);
        game.buyRod(5); // Pearl Master is bought and equipped
        vm.prank(alice);
        game.equipRod(0); // ...but the cast goes out on the starter rod
        uint256 snap = vm.snapshotState();
        (uint16 spA, uint32 wA, uint8 qA,) = _settleAfterSwap(false);
        vm.revertToState(snap);
        (uint16 spB, uint32 wB, uint8 qB,) = _settleAfterSwap(true);
        assertEq(spA, spB);
        assertEq(wA, wB);
        assertEq(qA, qB, "a better rod equipped after the cast must not lift the quality roll");
    }

    function _settleAfterSwap(bool swap) internal returns (uint16 species, uint32 weight, uint8 quality, uint256 x) {
        vm.prank(alice);
        game.cast(0);
        uint64 target = game.castOf(alice).targetBlock;
        if (swap) {
            vm.prank(alice);
            game.equipRod(5);
        }
        vm.roll(target + 1);
        vm.setBlockhash(target, keccak256("swap"));
        uint256 next = fish.nextId();
        vm.prank(alice);
        game.reel();
        if (fish.nextId() > next) {
            FishNFT.Fish memory f = fish.fish(next);
            return (f.speciesId, f.weight, f.quality, 0);
        }
        x = 0;
    }

    /// @dev Seeing a poor outcome and letting it expire buys nothing: energy, rod wear and the lure cast are
    ///      already spent, no counter moves, and the next cast gets fresh randomness.
    function test_lettingACastExpireGainsNothing() public {
        _fund(alice, 2_000 * E);
        vm.startPrank(alice);
        game.buyRod(1);
        game.buyLure(0);
        game.cast(0);
        vm.stopPrank();
        FishingGame.Player memory before = game.playerOf(alice);
        uint16 durability = game.rodDurability(alice, 1);
        uint32 casts = game.lureCasts(alice, 0);
        vm.roll(block.number + 300); // the player sits on the result until it expires
        vm.prank(alice);
        game.reel();
        FishingGame.Player memory afterIt = game.playerOf(alice);
        assertEq(fish.balanceOf(alice), 0);
        assertEq(afterIt.xp, before.xp);
        assertEq(afterIt.energy, before.energy, "energy is not refunded");
        assertEq(game.rodDurability(alice, 1), durability, "rod wear is not refunded");
        assertEq(game.lureCasts(alice, 0), casts, "the lure cast is not refunded");
        assertEq(game.dryCatches(alice, 0), 0, "pity does not advance on a skipped cast");
    }

    // ------------------------------------------------------------------ what a catch records

    function test_catchUpdatesProgress() public {
        uint256 id = _catch(alice, 0, 1);
        FishNFT.Fish memory f = fish.fish(id);
        FishNFT.Species memory s = fish.species(f.speciesId);
        FishingGame.Player memory p = game.playerOf(alice);
        assertEq(p.catches, 1);
        assertEq(p.dexCount, 1);
        assertEq(p.xp, s.rarity >= 5 ? 80 : 10 * (uint256(s.rarity) + 1));
        (uint32 count, uint32 best) = game.dex(alice, f.speciesId);
        assertEq(count, 1);
        assertEq(best, f.weight);
        (, uint32 w,) = game.bestCatch(alice);
        assertEq(w, f.weight);
        FishingGame.WeekEntry[] memory week = game.weekEntries(game.currentWeek(), alice);
        assertEq(week.length, 1);
        assertEq(week[0].score, CatchMath.score(s.rarity, s.minWeight, s.maxWeight, f.weight, f.quality));
        assertEq(game.weekTotal(game.currentWeek(), alice), week[0].score);
        assertEq(game.weekPlayerCount(game.currentWeek()), 1);
    }

    function test_scoreFormula() public view {
        FishNFT.Species memory taimen = fish.species(9);
        uint256 avg = uint256(8000) + uint256(50000 - 8000) / 3;
        assertEq(CatchMath.score(taimen.rarity, taimen.minWeight, taimen.maxWeight, avg, 2), 400);
        assertEq(CatchMath.score(taimen.rarity, taimen.minWeight, taimen.maxWeight, 50000, 4), 780); // 400 × 1.5 × 1.3
        assertEq(CatchMath.score(taimen.rarity, taimen.minWeight, taimen.maxWeight, 8000, 0), 224); // 400 × 0.7 × 0.8
        assertEq(CatchMath.score(5, 1000, 9000, uint256(1000) + uint256(8000) / 3, 2), 800);
    }

    function test_levelCurve() public view {
        assertEq(CatchMath.levelOf(0), 1);
        assertEq(CatchMath.levelOf(299), 2);
        assertEq(CatchMath.levelOf(300), 3);
        assertEq(CatchMath.levelOf(6600), 12);
    }

    function test_weekKeepsTheTenBestSortedAndSurvivesSelling() public {
        uint256[] memory ids = new uint256[](25);
        for (uint256 i; i < 25; i++) ids[i] = _catch(alice, 0, 100 + i);
        uint256 week = game.currentWeek();
        FishingGame.WeekEntry[] memory list = game.weekEntries(week, alice);
        assertEq(list.length, 10);
        uint256 sum;
        for (uint256 i; i < 10; i++) {
            sum += list[i].score;
            if (i > 0) assertGe(list[i - 1].score, list[i].score);
        }
        assertEq(game.weekTotal(week, alice), sum);
        vm.prank(alice);
        game.sellFish(ids);
        assertEq(game.weekTotal(week, alice), sum, "selling must not remove tournament points");
        assertEq(game.playerOf(alice).dexCount > 0, true);
    }

    function test_aNewWeekStartsEmptyAndKeepsTheOldOne() public {
        _catch(alice, 0, 7);
        uint256 week = game.currentWeek();
        uint32 total = game.weekTotal(week, alice);
        vm.warp((week + 1) * 1 weeks);
        assertEq(game.currentWeek(), week + 1);
        assertEq(game.weekEntries(week + 1, alice).length, 0);
        _catch(alice, 0, 8);
        assertEq(game.weekTotal(week, alice), total);
        assertEq(game.weekEntries(week + 1, alice).length, 1);
        (uint256[] memory ids, uint32[] memory totals) = lens.weekHistory(alice, 2);
        assertEq(ids[0], week);
        assertEq(totals[0], total);
    }

    function test_standingsListEveryAnglerOfTheWeek() public {
        _catch(alice, 0, 1);
        _catch(bob, 0, 2);
        (address[] memory anglers, uint32[] memory totals) = lens.weekStandings(game.currentWeek(), 0, 50);
        assertEq(anglers.length, 2);
        assertEq(anglers[0], alice);
        assertEq(totals[1], game.weekTotal(game.currentWeek(), bob));
    }

    // ------------------------------------------------------------------ selling

    function test_priceFormulaAndExactPayout() public {
        uint256 id = _catch(alice, 0, 3);
        FishNFT.Fish memory f = fish.fish(id);
        FishNFT.Species memory s = fish.species(f.speciesId);
        uint256 avg = uint256(s.minWeight) + (uint256(s.maxWeight) - s.minWeight) / 3;
        uint256 ratio = (uint256(f.weight) * 10_000) / avg;
        if (ratio < 4_000) ratio = 4_000;
        if (ratio > 30_000) ratio = 30_000;
        uint256[5] memory q = [uint256(8_000), 9_000, 10_000, 11_500, 13_000];
        uint256 expected = (uint256(s.basePrice) * ratio * q[f.quality]) / 1e8;
        assertEq(game.fishValue(id), expected);

        uint256[] memory ids = new uint256[](1);
        ids[0] = id;
        vm.warp(block.timestamp + 10 minutes + 1); // past the fresh-catch window: the plain price
        vm.prank(alice);
        game.sellFish(ids);
        assertEq(pearl.balanceOf(alice), expected);
        assertEq(fish.balanceOf(alice), 0);
        vm.prank(alice);
        vm.expectRevert(); // the fish is burned: it cannot be sold twice
        game.sellFish(ids);
        assertEq(pearl.balanceOf(alice), expected);
    }

    function test_freshCatchSellsForMore() public {
        uint256[] memory ids = new uint256[](1);
        ids[0] = _catch(alice, 0, 11);
        uint256 base = game.fishValue(ids[0]);
        vm.warp(block.timestamp + 10 minutes); // the last second of the window still counts
        vm.prank(alice);
        game.sellFish(ids);
        assertEq(pearl.balanceOf(alice), (base * 12_000) / 10_000);
    }

    function test_freshBonusIsOnlyForTheAngler() public {
        uint256[] memory ids = new uint256[](1);
        ids[0] = _catch(alice, 0, 12);
        uint256 base = game.fishValue(ids[0]);
        vm.prank(alice);
        fish.transferFrom(alice, bob, ids[0]);
        vm.prank(bob);
        game.sellFish(ids);
        assertEq(pearl.balanceOf(bob), base);
    }

    function test_sellIsAllOrNothing() public {
        uint256 mine = _catch(alice, 0, 4);
        uint256 theirs = _catch(bob, 0, 5);
        uint256[] memory ids = new uint256[](2);
        ids[0] = mine;
        ids[1] = theirs;
        vm.prank(alice);
        vm.expectRevert(FishingGame.NotFishOwner.selector);
        game.sellFish(ids);
        assertEq(fish.ownerOf(mine), alice);
        assertEq(pearl.balanceOf(alice), 0);
    }

    function test_emissionSoftCapShrinksPayouts() public {
        FishingGame.Config memory c = GameSetup.defaultConfig();
        c.emissionSoftCap = 1; // 1 wei a day: everything after the first sale is capped
        vm.prank(owner);
        game.setConfig(c);
        uint256[] memory a = new uint256[](1);
        a[0] = _catch(alice, 0, 6);
        uint256[] memory b = new uint256[](1);
        b[0] = _catch(alice, 0, 7);
        uint256 full = game.fishValue(b[0]);
        vm.startPrank(alice);
        game.sellFish(a);
        assertLt(game.quoteSell(b[0]), full);
        vm.stopPrank();
    }

    // ------------------------------------------------------------------ tackle

    function test_buyRodBurnsPearlAndEquips() public {
        _fund(alice, 1_550 * E);
        vm.prank(alice);
        game.buyRod(1);
        assertEq(pearl.balanceOf(alice), 50 * E);
        assertEq(game.playerOf(alice).rod, 1);
        assertEq(game.rodDurability(alice, 1), 80);
        vm.prank(alice);
        vm.expectRevert(FishingGame.AlreadyOwned.selector);
        game.buyRod(1);
        vm.prank(alice);
        vm.expectRevert(FishingGame.AlreadyOwned.selector);
        game.buyRod(0); // everyone owns the starter rod
    }

    function test_cannotBuyWithoutPearl() public {
        vm.prank(alice);
        vm.expectRevert();
        game.buyRod(1);
        vm.prank(alice);
        vm.expectRevert();
        game.buyLure(0);
        assertEq(game.playerOf(alice).rod, 0);
    }

    function test_cannotEquipWhatYouDoNotOwn() public {
        vm.startPrank(alice);
        vm.expectRevert(FishingGame.NotOwned.selector);
        game.equipRod(2);
        vm.expectRevert(FishingGame.NotOwned.selector);
        game.equipLure(1);
        vm.expectRevert(FishingGame.UnknownRod.selector);
        game.equipRod(6);
        vm.stopPrank();
    }

    function test_lureIsUsedUpAndTakenOff() public {
        _fund(alice, 6_000 * E);
        vm.startPrank(alice);
        game.buyLure(5); // Abyss Spoon: 25 casts
        game.buyLure(5);
        vm.stopPrank();
        assertEq(game.lureCasts(alice, 5), 50);
        assertEq(game.playerOf(alice).lure, 6);
        for (uint256 i; i < 50; i++) {
            if (game.currentEnergy(alice) == 0) _rest();
            _fishOnce(alice, 0, bytes32(i + 1));
        }
        assertEq(game.lureCasts(alice, 5), 0);
        assertEq(game.playerOf(alice).lure, 0);
    }

    function test_rodWearsOutAndIsRepaired() public {
        _fund(alice, 31_000 * E);
        vm.prank(alice);
        game.buyRod(4); // Deep Troller: 50 durability
        for (uint256 i; i < 50; i++) {
            if (game.currentEnergy(alice) == 0) _rest();
            _fishOnce(alice, 0, bytes32(i + 1));
        }
        assertEq(game.rodDurability(alice, 4), 0);
        vm.prank(alice);
        vm.expectRevert(FishingGame.RodBroken.selector);
        game.cast(0);

        uint256 cost = game.repairCost(alice, 4);
        assertEq(cost, (30_000 * E * 15) / 1_000); // 1.5% of the price for a full repair
        uint256 before = pearl.balanceOf(alice);
        vm.startPrank(alice);
        game.repairRod(4);
        assertEq(before - pearl.balanceOf(alice), cost);
        assertEq(game.rodDurability(alice, 4), 50);
        vm.expectRevert(FishingGame.NothingToRepair.selector);
        game.repairRod(4);
        // the starter rod never wears out
        game.equipRod(0);
        vm.expectRevert(FishingGame.NothingToRepair.selector);
        game.repairRod(0);
        vm.stopPrank();
    }

    function test_ironwoodRepairsCheaper() public {
        _fund(alice, 4_000 * E);
        vm.prank(alice);
        game.buyRod(2);
        _fishOnce(alice, 0, bytes32(uint256(1)));
        assertEq(game.repairCost(alice, 2), (4_000 * E * 150 * 7_000) / (160 * 1e8));
    }

    function test_ownerReprices() public {
        vm.prank(alice);
        vm.expectRevert();
        game.setPrice(false, 1, 0);
        _fund(alice, 5_000 * E);
        vm.prank(alice);
        game.buyRod(1); // at the old price
        vm.startPrank(owner);
        game.setPrice(false, 1, uint96(9_000 * E));
        game.setPrice(true, 0, uint96(7 * E));
        vm.expectRevert();
        game.setPrice(false, 6, 1); // no such rod
        vm.stopPrank();
        assertEq(game.rodItem(1).price, 9_000 * E);
        assertEq(game.rodItem(2).price, 4_000 * E);
        assertEq(game.lureItem(0).price, 7 * E);
        assertTrue(game.ownsRod(alice, 1)); // what is bought stays bought
        vm.prank(alice);
        game.buyLure(0);
        assertEq(pearl.balanceOf(alice), (5_000 - 1_500 - 7) * E);
    }

    /// @dev What script/Economy.s.sol does to a game seeded with other prices.
    function test_economyScriptSetsThePricesAndKeepsTheRest() public {
        Economy economy = new Economy();
        vm.startPrank(owner);
        game.setPrice(false, 5, uint96(25_000 * E));
        game.setPrice(true, 0, uint96(60 * E));
        FishingGame.Config memory c = GameSetup.defaultConfig();
        c.repairShareBps = 600;
        c.blendChancePpm = 4_000;
        game.setConfig(c);
        game.transferOwnership(address(economy));
        vm.stopPrank();
        economy.sync(game);
        assertEq(game.rodItem(5).price, 150_000 * E);
        assertEq(game.rodItem(1).price, 1_500 * E);
        assertEq(game.lureItem(0).price, 100 * E);
        (,,,,,,, uint16 repairShare,,,,,,, uint32 chance,) = game.config();
        assertEq(repairShare, 150);
        assertEq(chance, 4_000); // the rest of the config is left alone
    }

    function test_refillDoublesWithinADay() public {
        _fund(alice, 1_000 * E);
        vm.prank(alice);
        vm.expectRevert(FishingGame.EnergyFull.selector);
        game.refillEnergy();
        _fishOnce(alice, 0, bytes32(uint256(1)));
        vm.prank(alice);
        game.refillEnergy();
        assertEq(pearl.balanceOf(alice), 900 * E);
        assertEq(game.refillPrice(alice), 200 * E);
        vm.warp(block.timestamp + 1 days);
        assertEq(game.refillPrice(alice), 100 * E);
    }

    // ------------------------------------------------------------------ special fish and unlocks

    /// @dev Fishes the pond until the Golden Koi comes up. Pity bounds this at 120 catches.
    function _findKoi(address who) internal returns (uint256 koiId) {
        for (uint256 i; i < 200; i++) {
            uint256 id = _catch(who, 0, 5000 + i);
            if (fish.fish(id).speciesId == 20) return id;
        }
        revert("no koi within the pity window");
    }

    function test_pityGuaranteesTheSpecialAndItUnlocksForGood() public {
        assertFalse(game.isUnlocked(alice, 5));
        uint256 koi = _findKoi(alice);
        FishingGame.Player memory p = game.playerOf(alice);
        assertLe(p.catches, 120);
        assertEq(p.specialsFound & 1, 1);
        assertEq(p.activeSpecial, 1, "the first special takes the empty bonus slot");
        assertTrue(game.isUnlocked(alice, 5));
        assertEq(fish.heldOf(alice, 20), 1);

        // selling it keeps the location, but the bonus needs a specimen in hand
        uint256[] memory ids = new uint256[](1);
        ids[0] = koi;
        vm.prank(alice);
        game.sellFish(ids);
        assertTrue(game.isUnlocked(alice, 5));
        assertEq(fish.heldOf(alice, 20), 0);
        _rest();
        vm.prank(alice);
        game.cast(5);
        assertEq(game.castOf(alice).special, 0);
        vm.prank(alice);
        vm.expectRevert(FishingGame.SpecialNotHeld.selector);
        game.setActiveSpecial(1);
    }

    function test_activeSpecialIsFixedAtCastTime() public {
        _findKoi(alice);
        _rest();
        vm.prank(alice);
        game.cast(5);
        assertEq(game.castOf(alice).special, 1);
        vm.startPrank(alice);
        game.setActiveSpecial(0);
        vm.expectRevert(FishingGame.UnknownSpecial.selector);
        game.setActiveSpecial(4);
        vm.expectRevert(FishingGame.SpecialNotHeld.selector);
        game.setActiveSpecial(2);
        vm.stopPrank();
    }

    function test_levelAndSpeciesGatesOpenThroughPlay() public {
        assertFalse(game.isUnlocked(alice, 1));
        for (uint256 i; game.playerOf(alice).xp < 300; i++) _catch(alice, 0, 9000 + i);
        assertTrue(game.isUnlocked(alice, 1), "Forest River opens at level 3");
        for (uint256 i; game.playerOf(alice).dexCount < 8; i++) _catch(alice, 1, 12000 + i);
        assertTrue(game.isUnlocked(alice, 2), "Deep Lake opens at 8 species");
    }

    // ------------------------------------------------------------------ achievements

    function test_achievementPaysOnce() public {
        vm.prank(alice);
        vm.expectRevert(FishingGame.NotCompleted.selector);
        game.claimAchievement(11);
        _findKoi(alice); // a legendary species
        assertTrue(game.achievementDone(alice, 11));
        uint256 before = pearl.balanceOf(alice);
        vm.startPrank(alice);
        game.claimAchievement(11);
        assertEq(pearl.balanceOf(alice) - before, 500 * E);
        vm.expectRevert(FishingGame.AlreadyClaimed.selector);
        game.claimAchievement(11);
        vm.expectRevert(FishingGame.UnknownAchievement.selector);
        game.claimAchievement(14);
        vm.stopPrank();
    }

    // ------------------------------------------------------------------ the BLEND bottle

    uint256 internal constant BOTTLE = 1_000 * E;

    /// @dev Every bite is a bottle for whoever may have one; the pool's rules are the arguments.
    function _bottles(uint8 minLevel, uint8 dailyMax) internal {
        FishingGame.Config memory c = GameSetup.defaultConfig();
        c.blendChancePpm = 1_000_000;
        vm.startPrank(owner);
        game.setConfig(c);
        bottles.setRules(uint96(BOTTLE), minLevel, dailyMax);
        vm.stopPrank();
    }

    /// @dev What the client asks before it shows a bottle on the hook.
    function _open(address who) internal view returns (bool) {
        FishingGame.Player memory p = game.playerOf(who);
        return p.blendWins < 1 && bottles.open(p.xp);
    }

    /// @dev Casts until something bites; true when it was a bottle.
    function _bite(address who, uint256 salt) internal returns (bool bottle) {
        uint256 wins = game.playerOf(who).blendWins;
        uint256 catches = game.playerOf(who).catches;
        for (uint256 i; game.playerOf(who).blendWins == wins && game.playerOf(who).catches == catches; i++) {
            if (game.currentEnergy(who) == 0) vm.warp(block.timestamp + 40 minutes); // not a whole day: see the limit
            _fishOnce(who, 0, keccak256(abi.encode("bite", salt, i)));
        }
        return game.playerOf(who).blendWins > wins;
    }

    function test_bottlePaysFromThePoolOnce() public {
        _bottles(0, 0);
        blend.mint(address(bottles), 5 * BOTTLE);
        assertTrue(_open(alice));
        vm.recordLogs();
        assertTrue(_bite(alice, 1));
        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 found;
        for (uint256 k; k < logs.length; k++) {
            if (logs[k].emitter != address(game) || logs[k].topics[0] != FishingGame.BottleFound.selector) continue;
            assertEq(logs[k].topics[1], bytes32(uint256(uint160(alice))));
            assertEq(abi.decode(logs[k].data, (uint256)), BOTTLE);
            found++;
        }
        assertEq(found, 1, "one BottleFound event");
        assertEq(blend.balanceOf(alice), BOTTLE, "paid on the spot");
        assertEq(bottles.left(), 4);
        assertEq(game.blendWon(alice), BOTTLE);
        assertEq(game.totalBlendWon(), BOTTLE);
        assertEq(bottles.foundOnDay(block.timestamp / 1 days), 1);
        assertEq(bottles.totalFound(), 1);
        assertEq(fish.balanceOf(alice), 0, "a bottle is not a fish");
        assertEq(pearl.balanceOf(alice), 0);
        // the limit is one bottle per player: from now on bites are fish again
        assertFalse(_open(alice));
        assertFalse(_bite(alice, 2));
        assertEq(blend.balanceOf(alice), BOTTLE);
        assertEq(bottles.left(), 4);
    }

    function test_noBottleWithoutAWholeOneInThePool() public {
        _bottles(0, 0);
        assertFalse(_open(alice), "empty pool");
        assertFalse(_bite(alice, 1));
        blend.mint(address(bottles), BOTTLE - 1);
        assertFalse(_open(alice), "a part of a bottle is not a bottle");
        assertFalse(_bite(alice, 2));
        assertEq(game.totalBlendWon(), 0);
        assertEq(game.playerOf(alice).blendWins, 0, "a bite without a bottle does not use up the player's one");
        // anyone tops the pool up with a plain transfer
        blend.mint(bob, 1);
        vm.prank(bob);
        blend.transfer(address(bottles), 1);
        assertTrue(_open(alice));
        assertTrue(_bite(alice, 3));
        assertEq(blend.balanceOf(address(bottles)), 0);
        // the pool is dry again: the next player gets fish
        assertFalse(_open(bob));
        assertFalse(_bite(bob, 4));
    }

    function test_bottleNeedsTheLevel() public {
        _bottles(3, 0); // level 3 = 300 XP
        blend.mint(address(bottles), 5 * BOTTLE);
        assertFalse(bottles.open(299));
        assertTrue(bottles.open(300));
        uint256 n;
        while (game.playerOf(alice).xp < 300) {
            assertFalse(_bite(alice, ++n), "below the level every bite is a fish");
        }
        assertTrue(_open(alice));
        assertTrue(_bite(alice, ++n));
        assertEq(blend.balanceOf(alice), BOTTLE);
    }

    function test_bottleDailyLimitIsSharedAndResets() public {
        _bottles(0, 2);
        blend.mint(address(bottles), 10 * BOTTLE);
        address carol = makeAddr("carol");
        vm.warp((block.timestamp / 1 days + 1) * 1 days); // the start of a day
        assertTrue(_bite(alice, 1));
        assertTrue(_bite(bob, 2));
        assertFalse(_open(carol), "two today already");
        assertFalse(_bite(carol, 3));
        assertEq(blend.balanceOf(carol), 0);
        vm.warp(block.timestamp + 1 days);
        assertTrue(_open(carol));
        assertTrue(_bite(carol, 4));
        assertEq(bottles.left(), 7);
    }

    function test_reelForPaysThePlayerNotTheCaller() public {
        _bottles(0, 0);
        blend.mint(address(bottles), BOTTLE);
        uint256 i;
        while (blend.balanceOf(alice) == 0) {
            vm.prank(alice);
            game.cast(0);
            uint64 target = game.castOf(alice).targetBlock;
            vm.roll(target + 1);
            vm.setBlockhash(target, keccak256(abi.encode("for", ++i)));
            vm.prank(bob);
            game.reelFor(alice);
        }
        assertEq(blend.balanceOf(alice), BOTTLE);
        assertEq(blend.balanceOf(bob), 0);
    }

    function test_onlyTheGameTakesBottlesAndOnlyTheOwnerRunsThePool() public {
        blend.mint(address(bottles), 3 * BOTTLE);
        vm.prank(alice);
        vm.expectRevert(BottlePool.NotTheGame.selector);
        bottles.pay(alice, 1_000_000);
        vm.startPrank(alice);
        vm.expectRevert();
        bottles.withdraw(alice, BOTTLE);
        vm.expectRevert();
        bottles.setRules(1, 0, 0);
        vm.expectRevert();
        bottles.setGame(alice);
        vm.stopPrank();
        vm.prank(owner);
        bottles.withdraw(owner, 2 * BOTTLE);
        assertEq(blend.balanceOf(owner), 2 * BOTTLE);
        assertEq(bottles.left(), 1);
    }

    function test_defaultBottleSettings() public view {
        (,,,,,,,,,,,,,, uint32 chance, uint8 maxWins) = game.config();
        assertEq(chance, 1_000);
        assertEq(maxWins, 1);
        assertEq(bottles.amount(), BOTTLE);
        assertEq(bottles.minLevel(), 5);
        assertEq(bottles.dailyMax(), 2);
        assertEq(bottles.game(), address(game));
        assertEq(address(game.bottles()), address(bottles));
        assertEq(bottles.left(), 0, "the pool starts empty: no bottles until it is funded");
    }

    function test_bottleRateIsNearItsChance() public {
        FishingGame.Config memory c = GameSetup.defaultConfig();
        c.blendChancePpm = 200_000; // 20% of bites, so a short run is enough
        c.blendMaxWins = 255;
        vm.startPrank(owner);
        game.setConfig(c);
        bottles.setRules(uint96(BOTTLE), 0, 0);
        vm.stopPrank();
        blend.mint(address(bottles), 1_000 * BOTTLE);
        uint256 n = 500;
        for (uint256 i; i < n; i++) {
            if (game.currentEnergy(alice) == 0) _rest();
            _fishOnce(alice, 0, keccak256(abi.encode("bottle", i)));
        }
        FishingGame.Player memory p = game.playerOf(alice);
        uint256 bites = uint256(p.catches) + p.blendWins;
        assertApproxEqAbs(p.blendWins, bites / 5, 30);
    }

    // ------------------------------------------------------------------ admin

    function test_onlyOwnerConfigures() public {
        FishingGame.Config memory c = GameSetup.defaultConfig();
        vm.prank(alice);
        vm.expectRevert();
        game.setConfig(c);
        c.maxEnergy = 0;
        vm.prank(owner);
        vm.expectRevert(FishingGame.BadConfig.selector);
        game.setConfig(c);
        vm.prank(alice);
        vm.expectRevert();
        game.setHidden(1, true);
    }

    function test_onlyTheGameMintsFishAndPearl() public {
        vm.prank(alice);
        vm.expectRevert(FishNFT.NotGame.selector);
        fish.mint(alice, FishNFT.Fish(0, 100, 0, 2, 0, alice));
        vm.prank(alice);
        vm.expectRevert();
        pearl.mint(alice, 1);
    }

    // ------------------------------------------------------------------ lens

    function test_playerViewMatchesTheGame() public {
        _fund(alice, 2_000 * E);
        vm.startPrank(alice);
        game.buyRod(1);
        game.buyLure(0);
        vm.stopPrank();
        uint256 id = _catch(alice, 0, 42);
        GameLens.PlayerView memory v = lens.playerView(alice);
        assertEq(v.p.rod, 1);
        assertEq(v.p.lure, 1);
        assertEq(v.pearl, pearl.balanceOf(alice));
        assertEq(v.energyNow, game.currentEnergy(alice));
        assertEq(v.rodDurability[1], game.rodDurability(alice, 1));
        assertEq(v.lureCasts[0], game.lureCasts(alice, 0));
        assertEq(v.dex[fish.fish(id).speciesId].count, 1);
        assertEq(v.weekEntries.length, 1);
        assertEq(v.best.weight, fish.fish(id).weight);
        assertEq(v.bestByLocation[0].weight, fish.fish(id).weight);
        (uint256[] memory ids,, uint256[] memory values) = lens.keepnet(alice);
        assertEq(ids.length, 1);
        assertEq(ids[0], id);
        assertEq(values[0], game.fishValue(id));
    }

    function test_tokenUriBuilds() public {
        uint256 id = _catch(alice, 0, 1);
        assertGt(bytes(fish.tokenURI(id)).length, 200);
    }
}
