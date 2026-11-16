// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {BaseTest} from "./Base.t.sol";
import {FishNFT} from "../src/FishNFT.sol";
import {FishingGame} from "../src/FishingGame.sol";
import {GameSetup} from "../script/GameSetup.sol";

/// @notice Writes real cast outcomes, with everything that went into them, to a JSON file. The web client
///         predicts a cast's outcome from the same inputs (web/src/game/chainOutcome.ts) and its tests replay
///         these vectors, so the prediction cannot drift from the contract unnoticed.
///         Regenerate after changing `_reel`: WRITE_VECTORS=true forge test --match-contract VectorsTest
contract VectorsTest is BaseTest {
    string internal constant PATH = "../web/src/game/fixtures/outcomes.json";

    function test_writeOutcomeVectors() public {
        if (!vm.envOr("WRITE_VECTORS", false)) return;

        // open every location so the vectors cover all pools
        vm.startPrank(owner);
        for (uint256 i; i < game.locationCount(); i++) {
            FishingGame.Location memory l = game.location(i);
            l.unlockType = 0;
            game.updateLocation(i, l);
        }
        vm.stopPrank();
        _fund(alice, 10_000_000 * E);
        vm.startPrank(alice);
        for (uint8 r = 1; r < 6; r++) game.buyRod(r);
        vm.stopPrank();

        string memory out = "[";
        uint256 n = 240;
        for (uint256 i; i < n; i++) {
            if (i == n / 2) {
                // second half: bottles are common, so that branch is covered too
                FishingGame.Config memory c = GameSetup.defaultConfig();
                c.blendChancePpm = 150_000;
                c.blendMaxWins = 255;
                vm.prank(owner);
                game.setConfig(c);
            }
            out = string.concat(out, i == 0 ? "" : ",", _vector(i));
        }
        vm.writeFile(PATH, string.concat(out, "]\n"));
    }

    function _vector(uint256 i) internal returns (string memory) {
        uint8 loc = uint8(i % 8);
        uint8 rod = uint8((i / 8) % 6);
        uint8 lure = uint8((i / 3) % 7); // 0 = none
        if (game.currentEnergy(alice) < 4) _rest();
        vm.startPrank(alice);
        if (game.repairCost(alice, rod) > 0 && game.rodDurability(alice, rod) == 0) game.repairRod(rod);
        game.equipRod(rod);
        if (lure != 0 && game.lureCasts(alice, lure - 1) == 0) game.buyLure(lure - 1);
        game.equipLure(lure);
        game.cast(loc);
        vm.stopPrank();

        FishingGame.Cast memory c = game.castOf(alice);
        FishingGame.Player memory p = game.playerOf(alice);
        bytes32 entropy = keccak256(abi.encode("vector", i));
        string memory inputs = _inputs(c, p, entropy);

        vm.roll(c.targetBlock + 1);
        vm.setBlockhash(c.targetBlock, entropy);
        uint256 nextFish = fish.nextId();
        uint256 blendBefore = game.blendWon(alice);
        vm.prank(alice);
        game.reel();

        string memory result;
        if (fish.nextId() > nextFish) {
            FishNFT.Fish memory f = fish.fish(nextFish);
            result = string.concat(
                '"kind":"caught","speciesId":', vm.toString(f.speciesId), ',"weight":', vm.toString(f.weight),
                ',"quality":', vm.toString(f.quality)
            );
            // sell so the keepnet does not grow without bound (does not change later outcomes)
            uint256[] memory ids = new uint256[](1);
            ids[0] = nextFish;
            vm.prank(alice);
            game.sellFish(ids);
        } else if (game.blendWon(alice) > blendBefore) {
            result = string.concat('"kind":"bottle","amountWei":"', vm.toString(game.blendWon(alice) - blendBefore), '"');
        } else {
            result = '"kind":"missed"';
        }
        return string.concat("{", inputs, ',"expected":{', result, "}}");
    }

    function _inputs(FishingGame.Cast memory c, FishingGame.Player memory p, bytes32 entropy)
        internal
        view
        returns (string memory)
    {
        (int256 rodCatch, uint256 bite, uint256 rarity, uint256 weight, uint256 hiddenMult) =
            game.loadout(c.rod, c.lure, c.special, c.locationId);
        (,,,,,,,,,,,,,, uint32 blendChance, uint8 blendMax) = game.config();
        string memory a = string.concat(
            '"blockHash":"', vm.toString(entropy), '","player":"', vm.toString(alice), '","game":"',
            vm.toString(address(game)), '","nonce":', vm.toString(c.nonce), ',"locationId":', vm.toString(c.locationId)
        );
        string memory b = string.concat(
            ',"loadout":{"rodCatch":', vm.toString(rodCatch), ',"biteBps":', vm.toString(bite), ',"rarity":',
            vm.toString(rarity), ',"weight":', vm.toString(weight), ',"hiddenMult":', vm.toString(hiddenMult), "}"
        );
        string memory d = string.concat(
            ',"blendWins":', vm.toString(p.blendWins), ',"specialsFound":', vm.toString(p.specialsFound), ',"dry":[',
            vm.toString(game.dryCatches(alice, 0)), ",", vm.toString(game.dryCatches(alice, 1)), ",",
            vm.toString(game.dryCatches(alice, 2)), "]"
        );
        string memory e = string.concat(
            ',"blendChancePpm":', vm.toString(blendChance), ',"blendMaxWins":', vm.toString(blendMax)
        );
        return string.concat(a, b, d, e);
    }
}
