// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {BaseTest} from "./Base.t.sol";
import {FishNFT} from "../src/FishNFT.sol";
import {RodNFT} from "../src/RodNFT.sol";
import {FishingGame} from "../src/FishingGame.sol";

contract FishingGameTest is BaseTest {
    // ------------------------------------------------------------- rods

    function test_starterRodOncePerAddress() public {
        uint256 id = _starter(alice);
        assertEq(rod.ownerOf(id), alice);
        RodNFT.Rod memory r = rod.rods(id);
        assertEq(r.level, 1);
        assertEq(r.durability, 60);

        vm.prank(alice);
        vm.expectRevert(FishingGame.StarterAlreadyClaimed.selector);
        game.claimStarterRod();
    }

    function test_starterRodFee() public {
        FishingGame.Config memory c = GameSetupConfig.get(game);
        c.starterRodFee = 0.001 ether;
        vm.prank(owner);
        game.setConfig(c);
        vm.deal(alice, 1 ether);
        vm.startPrank(alice);
        vm.expectRevert(FishingGame.WrongFee.selector);
        game.claimStarterRod();
        vm.expectRevert(FishingGame.WrongFee.selector);
        game.claimStarterRod{value: 0.002 ether}();
        game.claimStarterRod{value: 0.001 ether}();
        vm.stopPrank();
        assertEq(address(game).balance, 0.001 ether);

        vm.prank(alice);
        vm.expectRevert();
        game.withdraw(payable(alice));
        address treasury = makeAddr("treasury");
        vm.prank(owner);
        game.withdraw(payable(treasury));
        assertEq(treasury.balance, 0.001 ether);
    }

    function test_buyRodBurnsPearl() public {
        _fund(alice, 25e18);
        vm.prank(alice);
        game.buyRod();
        assertEq(pearl.balanceOf(alice), 0);
        assertEq(rod.balanceOf(alice), 1);
    }

    function test_buyRodWithoutPearlReverts() public {
        vm.prank(alice);
        vm.expectRevert();
        game.buyRod();
    }

    function test_upgradeRod() public {
        uint256 id = _starter(alice);
        _fund(alice, 80e18);
        vm.prank(alice);
        game.upgradeRod(id);
        RodNFT.Rod memory r = rod.rods(id);
        assertEq(r.level, 2);
        assertEq(r.maxDurability, 90);
        assertEq(r.durability, 90);
        assertEq(pearl.balanceOf(alice), 0);
    }

    function test_upgradeRodStopsAtMax() public {
        uint256 id = _starter(alice);
        _fund(alice, 10_000e18);
        vm.startPrank(alice);
        for (uint256 i; i < 4; i++) game.upgradeRod(id);
        assertEq(rod.rods(id).level, 5);
        vm.expectRevert(FishingGame.MaxLevel.selector);
        game.upgradeRod(id);
        vm.stopPrank();
        assertEq(pearl.balanceOf(alice), 10_000e18 - (80 + 450 + 1500 + 5000) * 1e18);
    }

    function test_onlyOwnerCanUpgrade() public {
        uint256 id = _starter(alice);
        _fund(bob, 100e18);
        vm.prank(bob);
        vm.expectRevert(FishingGame.NotRodOwner.selector);
        game.upgradeRod(id);
    }

    function test_repairRod() public {
        uint256 id = _starter(alice);
        for (uint256 i; i < 5; i++) {
            _fishOnce(alice, id, 0, 0, keccak256(abi.encode(i)));
        }
        assertEq(rod.rods(id).durability, 55);
        uint256 cost = game.repairCost(id);
        assertEq(cost, 5 * 1e17); // 5 points * 0.1 * level 1
        _fund(alice, cost);
        vm.prank(alice);
        game.repairRod(id);
        assertEq(rod.rods(id).durability, 60);

        vm.prank(alice);
        vm.expectRevert(FishingGame.NothingToRepair.selector);
        game.repairRod(id);
    }

    function test_brokenRodCannotCast() public {
        uint256 id = _starter(alice);
        RodNFT.Rod memory r = rod.rods(id);
        r.durability = 0;
        vm.prank(address(game));
        rod.setRod(id, r);
        vm.prank(alice);
        vm.expectRevert(FishingGame.RodBroken.selector);
        game.cast(id, 0, 0);
    }

    // ------------------------------------------------------------- cast / reel

    function test_castLocksRodAndSpendsEnergy() public {
        uint256 id = _starter(alice);
        vm.prank(alice);
        game.cast(id, 0, 0);
        assertTrue(rod.locked(id));
        assertEq(game.currentEnergy(alice), 19);

        vm.prank(alice);
        vm.expectRevert(RodNFT.RodLocked.selector);
        rod.transferFrom(alice, bob, id);
    }

    function test_reelTooEarlyReverts() public {
        uint256 id = _starter(alice);
        vm.prank(alice);
        game.cast(id, 0, 0);
        (uint64 target,,,,) = game.casts(alice);
        vm.roll(target);
        vm.prank(alice);
        vm.expectRevert(FishingGame.TooEarly.selector);
        game.reel();
    }

    function test_reelWithoutCastReverts() public {
        vm.prank(alice);
        vm.expectRevert(FishingGame.NoActiveCast.selector);
        game.reel();
    }

    function test_cannotDoubleCast() public {
        uint256 id = _starter(alice);
        vm.startPrank(alice);
        game.cast(id, 0, 0);
        vm.expectRevert(FishingGame.CastInProgress.selector);
        game.cast(id, 0, 0);
        vm.stopPrank();
    }

    function test_newCastAutoResolvesFinishedOne() public {
        uint256 id = _starter(alice);
        vm.prank(alice);
        game.cast(id, 0, 0);
        (uint64 target,,,,) = game.casts(alice);
        vm.roll(target + 1);
        vm.setBlockhash(target, bytes32(uint256(1)));
        vm.prank(alice);
        game.cast(id, 0, 0); // resolves the first one, starts a new one
        assertEq(rod.rods(id).durability, 59);
        (uint64 target2,,,,) = game.casts(alice);
        assertGt(target2, target);
    }

    function test_catchMintsFishWithValidStats() public {
        uint256 id = _starter(alice);
        // find an entropy that catches
        uint256 fishId;
        for (uint256 i; fishId == 0; i++) {
            fishId = _fishOnce(alice, id, 0, 0, keccak256(abi.encode("catch", i)));
        }
        FishNFT.Fish memory f = fish.fish(fishId);
        FishNFT.Species memory s = fish.species(f.speciesId);
        assertEq(fish.ownerOf(fishId), alice);
        assertEq(f.angler, alice);
        assertEq(f.spotId, 0);
        assertLe(f.speciesId, 4);
        assertGe(f.weight, s.minWeight);
        assertLe(f.weight, s.maxWeight);
        assertFalse(rod.locked(id));

        (,,, uint64 xp, uint64 catches,, uint32 best, uint256 bestId) = game.players(alice);
        assertEq(catches, 1);
        assertEq(xp, 10 * (uint64(s.rarity) + 1));
        assertEq(best, f.weight);
        assertEq(bestId, fishId);
    }

    function test_expiredCastLosesFish() public {
        uint256 id = _starter(alice);
        vm.prank(alice);
        game.cast(id, 0, 0);
        (uint64 target,,,,) = game.casts(alice);
        vm.roll(target + 300); // blockhash(target) == 0
        vm.expectEmit(true, false, false, true);
        emit FishingGame.CastExpired(alice, id);
        vm.prank(alice);
        game.reel();
        assertEq(fish.balanceOf(alice), 0);
        assertFalse(rod.locked(id));
        assertEq(rod.rods(id).durability, 59); // wear is charged: expiring a bad outcome is never free
        assertEq(game.currentEnergy(alice), 19); // energy stays spent
    }

    /// The core fairness property: the outcome is a pure function of a block that did not exist at cast time.
    /// Re-trying the reel (e.g. reverting it in a wrapper contract) can never change the result.
    function test_outcomeIsFixedOnceTargetBlockExists() public {
        uint256 id = _starter(alice);
        vm.prank(alice);
        game.cast(id, 0, 0);
        (uint64 target,,,,) = game.casts(alice);
        vm.roll(target + 1);
        vm.setBlockhash(target, keccak256("fixed"));

        uint256 snap = vm.snapshotState();
        vm.prank(alice);
        game.reel();
        uint256 n1 = fish.balanceOf(alice);
        uint256 w1 = n1 > 0 ? fish.fish(1).weight : 0;

        vm.revertToState(snap);
        vm.roll(target + 50); // reel later, different caller
        vm.prank(bob);
        game.reelFor(alice);
        uint256 n2 = fish.balanceOf(alice);
        uint256 w2 = n2 > 0 ? fish.fish(1).weight : 0;

        assertEq(n1, n2);
        assertEq(w1, w2);
    }

    function test_reelForGivesFishToPlayer() public {
        uint256 id = _starter(alice);
        uint256 caught;
        for (uint256 i; caught == 0 && i < 50; i++) {
            vm.prank(alice);
            game.cast(id, 0, 0);
            (uint64 target,,,,) = game.casts(alice);
            vm.roll(target + 1);
            vm.setBlockhash(target, keccak256(abi.encode("keeper", i)));
            vm.prank(bob);
            game.reelFor(alice);
            caught = fish.balanceOf(alice);
        }
        assertGt(caught, 0);
        assertEq(fish.balanceOf(bob), 0);
    }

    function test_spotRequiresRodLevel() public {
        uint256 id = _starter(alice);
        vm.prank(alice);
        vm.expectRevert(FishingGame.RodLevelTooLow.selector);
        game.cast(id, 1, 0);

        _setRodLevel(id, 2);
        vm.prank(alice);
        game.cast(id, 1, 0);
    }

    function test_cannotFishWithSomeoneElsesRod() public {
        uint256 id = _starter(alice);
        vm.prank(bob);
        vm.expectRevert(FishingGame.NotRodOwner.selector);
        game.cast(id, 0, 0);
    }

    function test_unknownSpotAndBait() public {
        uint256 id = _starter(alice);
        vm.startPrank(alice);
        vm.expectRevert(FishingGame.UnknownSpot.selector);
        game.cast(id, 99, 0);
        vm.expectRevert(FishingGame.UnknownBait.selector);
        game.cast(id, 0, 99);
        vm.stopPrank();
    }

    function test_inactiveSpot() public {
        uint256 id = _starter(alice);
        FishingGame.Spot memory s = game.spot(0);
        vm.prank(owner);
        game.updateSpot(0, s.minRodLevel, s.energyCost, false, s.speciesIds, s.weights);
        vm.prank(alice);
        vm.expectRevert(FishingGame.SpotInactive.selector);
        game.cast(id, 0, 0);
    }

    // ------------------------------------------------------------- bait

    function test_baitIsBoughtAndConsumed() public {
        uint256 id = _starter(alice);
        _fund(alice, 5e18);
        vm.prank(alice);
        game.buyBait(1, 10);
        assertEq(pearl.balanceOf(alice), 0);
        assertEq(game.baitBalance(alice, 1), 10);
        _fishOnce(alice, id, 0, 1, bytes32(uint256(7)));
        assertEq(game.baitBalance(alice, 1), 9);
    }

    function test_castWithoutBaitReverts() public {
        uint256 id = _starter(alice);
        vm.prank(alice);
        vm.expectRevert(FishingGame.NotEnoughBait.selector);
        game.cast(id, 0, 2);
    }

    function test_catchChance() public view {
        assertEq(game.catchChanceBps(1, 0), 5_500);
        assertEq(game.catchChanceBps(3, 0), 6_900);
        assertEq(game.catchChanceBps(1, 1), 7_000);
        assertEq(game.catchChanceBps(5, 3), 9_500); // capped
    }

    // ------------------------------------------------------------- energy

    function test_energyRunsOutAndRegenerates() public {
        uint256 id = _starter(alice);
        for (uint256 i; i < 20; i++) {
            _fishOnce(alice, id, 0, 0, keccak256(abi.encode(i)));
        }
        assertEq(game.currentEnergy(alice), 0);
        vm.prank(alice);
        vm.expectRevert(FishingGame.NotEnoughEnergy.selector);
        game.cast(id, 0, 0);

        vm.warp(block.timestamp + 15 minutes);
        assertEq(game.currentEnergy(alice), 1);
        vm.warp(block.timestamp + 100 days);
        assertEq(game.currentEnergy(alice), 20);
    }

    function test_energyKeepsPartialRegenProgress() public {
        uint256 id = _starter(alice);
        for (uint256 i; i < 20; i++) {
            _fishOnce(alice, id, 0, 0, keccak256(abi.encode(i)));
        }
        vm.warp(block.timestamp + 25 minutes); // 1 energy + 10 min progress
        _fishOnce(alice, id, 0, 0, bytes32(uint256(1)));
        assertEq(game.currentEnergy(alice), 0);
        vm.warp(block.timestamp + 5 minutes); // 10 + 5 = 15 min → 1 energy
        assertEq(game.currentEnergy(alice), 1);
    }

    function test_refillEnergy() public {
        uint256 id = _starter(alice);
        for (uint256 i; i < 5; i++) {
            _fishOnce(alice, id, 0, 0, keccak256(abi.encode(i)));
        }
        _fund(alice, 20e18);
        vm.prank(alice);
        game.refillEnergy();
        assertEq(game.currentEnergy(alice), 20);
        assertEq(pearl.balanceOf(alice), 0);
    }

    function test_refillPriceGrowsWithinDayAndResets() public {
        FishingGame.Config memory c = GameSetupConfig.get(game);
        _fund(alice, 1_000e18);
        uint256 base = c.energyRefillPrice;
        vm.startPrank(alice);
        assertEq(game.refillPrice(alice), base);
        game.refillEnergy();
        assertEq(game.refillPrice(alice), base * 2);
        game.refillEnergy();
        assertEq(game.refillPrice(alice), base * 4);
        vm.stopPrank();
        assertEq(pearl.balanceOf(alice), 1_000e18 - base * 3);
        vm.warp(block.timestamp + 1 days);
        assertEq(game.refillPrice(alice), base);
    }

    function test_repairBlockedBelowMinLevel() public {
        FishingGame.Config memory c = GameSetupConfig.get(game);
        c.minRepairLevel = 2;
        vm.prank(owner);
        game.setConfig(c);
        uint256 id = _starter(alice);
        _fishOnce(alice, id, 0, 0, bytes32(uint256(3)));
        _fund(alice, 100e18);
        vm.prank(alice);
        vm.expectRevert(FishingGame.RepairNotAllowed.selector);
        game.repairRod(id);
        vm.prank(alice);
        game.upgradeRod(id); // upgrading turns the consumable into a repairable rod
        _fishOnce(alice, id, 0, 0, bytes32(uint256(4)));
        vm.prank(alice);
        game.repairRod(id);
    }

    // ------------------------------------------------------------- selling

    function _catchOne(address who, uint256 rodId) internal returns (uint256 fishId) {
        for (uint256 i; fishId == 0; i++) {
            fishId = _fishOnce(who, rodId, 0, 0, keccak256(abi.encode(who, "sell", i, block.number)));
        }
    }

    function test_sellFishMintsValue() public {
        uint256 id = _starter(alice);
        uint256 f1 = _catchOne(alice, id);
        uint256 f2 = _catchOne(alice, id);
        uint256 expected = game.fishValue(f1) + game.fishValue(f2);
        uint256[] memory ids = new uint256[](2);
        ids[0] = f1;
        ids[1] = f2;
        vm.prank(alice);
        uint256 got = game.sellFish(ids);
        assertEq(got, expected);
        assertEq(pearl.balanceOf(alice), expected);
        assertEq(fish.balanceOf(alice), 0);
        assertEq(fish.totalSupply(), 0);
    }

    function test_cannotSellOthersFish() public {
        uint256 id = _starter(alice);
        uint256 f1 = _catchOne(alice, id);
        uint256[] memory ids = new uint256[](1);
        ids[0] = f1;
        vm.prank(bob);
        vm.expectRevert(FishingGame.NotFishOwner.selector);
        game.sellFish(ids);
    }

    function test_cannotSellSameFishTwiceInBatch() public {
        uint256 id = _starter(alice);
        uint256 f1 = _catchOne(alice, id);
        uint256[] memory ids = new uint256[](2);
        ids[0] = f1;
        ids[1] = f1;
        vm.prank(alice);
        vm.expectRevert();
        game.sellFish(ids);
    }

    function test_emissionSoftCapShrinksPayouts() public {
        FishingGame.Config memory c = GameSetupConfig.get(game);
        c.emissionSoftCap = 1e18;
        vm.prank(owner);
        game.setConfig(c);

        uint256 id = _starter(alice);
        uint256[] memory ids = new uint256[](1);
        uint256 lastRatio = type(uint256).max;
        for (uint256 k; k < 6; k++) {
            uint256 f = _catchOne(alice, id);
            uint256 full = game.fishValue(f);
            ids[0] = f;
            vm.prank(alice);
            uint256 got = game.sellFish(ids);
            assertLe(got, full);
            uint256 ratio = (got * 1e18) / full;
            assertLe(ratio, lastRatio);
            lastRatio = ratio;
        }
        assertLt(lastRatio, 1e18);
        // next day the cap resets
        vm.warp(block.timestamp + 1 days);
        uint256 f2 = _catchOne(alice, id);
        assertEq(game.quoteSell(f2), game.fishValue(f2));
    }

    // ------------------------------------------------------------- records & metadata

    function test_weeklyRecordTracksHeaviest() public {
        uint256 id = _starter(alice);
        uint256 maxW;
        for (uint256 i; i < 15; i++) {
            uint256 f = _fishOnce(alice, id, 0, 0, keccak256(abi.encode("rec", i)));
            if (f != 0 && fish.fish(f).weight > maxW) maxW = fish.fish(f).weight;
        }
        (address angler,, uint32 w,) = game.weeklyBest(game.currentWeek());
        assertEq(w, maxW);
        if (maxW > 0) assertEq(angler, alice);
    }

    function test_tokenURIs() public {
        uint256 id = _starter(alice);
        uint256 f = _catchOne(alice, id);
        string memory uri = fish.tokenURI(f);
        assertEq(_prefix(uri, 29), "data:application/json;base64,");
        assertEq(_prefix(rod.tokenURI(id), 29), "data:application/json;base64,");
    }

    function _prefix(string memory s, uint256 n) internal pure returns (string memory) {
        bytes memory b = bytes(s);
        bytes memory out = new bytes(n);
        for (uint256 i; i < n; i++) out[i] = b[i];
        return string(out);
    }

    // ------------------------------------------------------------- access control

    function test_onlyOwnerAdmin() public {
        FishingGame.Config memory c = GameSetupConfig.get(game);
        vm.startPrank(alice);
        vm.expectRevert();
        game.setConfig(c);
        vm.expectRevert();
        game.setUpgradePrices(new uint96[](0));
        vm.expectRevert(FishNFT.NotGame.selector);
        fish.burn(1);
        vm.expectRevert(RodNFT.NotGame.selector);
        rod.setLocked(1, false);
        vm.stopPrank();
    }

    function test_badConfigRejected() public {
        FishingGame.Config memory c = GameSetupConfig.get(game);
        c.maxCatchBps = 10_001;
        vm.prank(owner);
        vm.expectRevert(FishingGame.BadConfig.selector);
        game.setConfig(c);
    }

    // ------------------------------------------------------------- fuzz & statistics

    function testFuzz_catchStaysInSpeciesBounds(bytes32 entropy, uint8 level, uint8 baitId) public {
        level = uint8(bound(level, 1, 5));
        baitId = uint8(bound(baitId, 0, 3));
        uint256 id = _starter(alice);
        _setRodLevel(id, level);
        if (baitId != 0) {
            _fund(alice, 100e18);
            vm.prank(alice);
            game.buyBait(baitId, 1);
        }
        uint8 spotId = level - 1; // highest spot the rod can reach
        uint256 f = _fishOnce(alice, id, spotId, baitId, entropy);
        if (f == 0) return;
        FishNFT.Fish memory fi = fish.fish(f);
        FishNFT.Species memory s = fish.species(fi.speciesId);
        assertGe(fi.weight, s.minWeight);
        assertLe(fi.weight, s.maxWeight);
        FishingGame.Spot memory sp = game.spot(spotId);
        bool inTable;
        for (uint256 i; i < sp.speciesIds.length; i++) {
            if (sp.speciesIds[i] == fi.speciesId) inTable = true;
        }
        assertTrue(inTable);
    }

    /// Empirical catch rate over 1000 casts must match the configured 55% (± 4.5pp ≈ 3σ).
    function test_catchRateMatchesConfig() public {
        uint256 id = _starter(alice);
        _setRodLevel(id, 1);
        uint256 caught;
        uint256 n = 1000;
        uint256 t = block.timestamp;
        for (uint256 i; i < n; i++) {
            t += 1 days; // keep energy full (local var: via-ir caches block.timestamp after vm.warp)
            vm.warp(t);
            RodNFT.Rod memory r = rod.rods(id);
            if (r.durability < 2) {
                r.durability = r.maxDurability;
                vm.prank(address(game));
                rod.setRod(id, r);
            }
            if (_fishOnce(alice, id, 0, 0, keccak256(abi.encode("rate", i))) != 0) caught++;
        }
        assertApproxEqAbs(caught, 550, 45);
    }
}

library GameSetupConfig {
    function get(FishingGame g) internal view returns (FishingGame.Config memory c) {
        (
            c.maxEnergy,
            c.energyRegenSeconds,
            c.revealDelay,
            c.maxRodLevel,
            c.baseCatchBps,
            c.catchBpsPerLevel,
            c.maxCatchBps,
            c.rarityBoostPerLevel,
            c.starterDurability,
            c.durabilityPerLevel,
            c.energyRefillPrice,
            c.rodPrice,
            c.repairPricePerPoint,
            c.emissionSoftCap,
            c.refillPriceGrowthBps,
            c.minRepairLevel,
            c.starterRodFee
        ) = g.config();
    }
}
