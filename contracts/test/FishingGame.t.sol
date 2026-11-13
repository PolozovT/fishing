// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {BaseTest} from "./Base.t.sol";
import {FishNFT} from "../src/FishNFT.sol";
import {FishingGame} from "../src/FishingGame.sol";
import {GameLens} from "../src/GameLens.sol";
import {GameSetup} from "../script/GameSetup.sol";

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
        assertEq(c.rods[5].price, 25_000 * E);
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
        assertEq(week[0].score, game.scoreOf(s, f.weight, f.quality));
        assertEq(game.weekTotal(game.currentWeek(), alice), week[0].score);
        assertEq(game.weekPlayerCount(game.currentWeek()), 1);
    }

    function test_scoreFormula() public view {
        FishNFT.Species memory taimen = fish.species(9);
        uint256 avg = uint256(8000) + uint256(50000 - 8000) / 3;
        assertEq(game.scoreOf(taimen, avg, 2), 400);
        assertEq(game.scoreOf(taimen, 50000, 4), 780); // 400 × 1.5 × 1.3
        assertEq(game.scoreOf(taimen, 8000, 0), 224); // 400 × 0.7 × 0.8
        assertEq(game.scoreOf(fish.species(22), uint256(1000) + uint256(8000) / 3, 2), 800);
    }

    function test_levelCurve() public view {
        assertEq(game.levelOf(0), 1);
        assertEq(game.levelOf(299), 2);
        assertEq(game.levelOf(300), 3);
        assertEq(game.levelOf(6600), 12);
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
        vm.prank(alice);
        game.sellFish(ids);
        assertEq(pearl.balanceOf(alice), expected);
        assertEq(fish.balanceOf(alice), 0);
        vm.prank(alice);
        vm.expectRevert(); // the fish is burned: it cannot be sold twice
        game.sellFish(ids);
        assertEq(pearl.balanceOf(alice), expected);
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
        _fund(alice, 500 * E);
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
        _fund(alice, 3_000 * E);
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
        _fund(alice, 10_000 * E);
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
        assertEq(cost, (4_000 * E * 6) / 100); // 6% of the price for a full repair
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
        _fund(alice, 1_000 * E);
        vm.prank(alice);
        game.buyRod(2);
        _fishOnce(alice, 0, bytes32(uint256(1)));
        assertEq(game.repairCost(alice, 2), (900 * E * 600 * 7_000) / (160 * 1e8));
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

    function test_bottleIsRecordedOnceAndNothingIsTransferred() public {
        FishingGame.Config memory c = GameSetup.defaultConfig();
        c.blendChancePpm = 1_000_000; // every bite is a bottle
        vm.prank(owner);
        game.setConfig(c);
        uint256 i;
        while (game.playerOf(alice).blendWins == 0) _fishOnce(alice, 0, bytes32(++i));
        assertEq(game.blendWon(alice), 100 * E);
        assertEq(game.totalBlendWon(), 100 * E);
        assertEq(fish.balanceOf(alice), 0, "a bottle is not a fish");
        assertEq(pearl.balanceOf(alice), 0);
        // the limit is one bottle: from now on bites are fish again
        _catch(alice, 0, 77);
        assertEq(game.playerOf(alice).blendWins, 1);
        assertEq(game.blendWon(alice), 100 * E);
    }

    function test_bottleRateIsNearItsChance() public {
        FishingGame.Config memory c = GameSetup.defaultConfig();
        c.blendChancePpm = 200_000; // 20% of bites, so a short run is enough
        c.blendMaxWins = 255;
        vm.prank(owner);
        game.setConfig(c);
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
        _fund(alice, 1_000 * E);
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
