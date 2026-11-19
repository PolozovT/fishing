// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {FishingGame} from "../src/FishingGame.sol";
import {GameSetup} from "./GameSetup.sol";

/// @notice Brings the prices of a deployed game in line with GameSetup: rod and lure prices and the repair share.
///         Everything else in the game's config is left as it is. Rods already bought stay bought.
///         forge script script/Economy.s.sol --rpc-url <rpc> --broadcast --private-key <owner>
contract Economy is Script {
    uint256 internal constant E = 1e18;

    function run() external {
        string memory path = string.concat(vm.projectRoot(), "/../deployments/", vm.toString(block.chainid), ".json");
        FishingGame game = FishingGame(vm.parseJsonAddress(vm.readFile(path), ".game"));
        vm.startBroadcast();
        sync(game);
        vm.stopBroadcast();
    }

    /// @dev Must be called by the game's owner. Sends only the transactions that change something.
    function sync(FishingGame game) public {
        uint256[6] memory rod = GameSetup.rodPrices();
        uint256[6] memory lure = GameSetup.lurePrices();
        for (uint256 i; i < rod.length; i++) {
            if (game.rodItem(i).price != rod[i] * E) game.setPrice(false, i, uint96(rod[i] * E));
        }
        for (uint256 i; i < lure.length; i++) {
            if (game.lureItem(i).price != lure[i] * E) game.setPrice(true, i, uint96(lure[i] * E));
        }
        FishingGame.Config memory c = _config(game);
        uint16 share = GameSetup.defaultConfig().repairShareBps;
        if (c.repairShareBps != share) {
            c.repairShareBps = share;
            game.setConfig(c);
        }
        console2.log("prices and repair share set on", address(game));
    }

    function _config(FishingGame game) internal view returns (FishingGame.Config memory c) {
        (
            c.maxEnergy,
            c.energyRegenSeconds,
            c.revealDelay,
            c.baseBiteBps,
            c.maxBiteBps,
            c.maxRarityBonus,
            c.maxWeightBonus,
            c.repairShareBps,
            c.energyRefillPrice,
            c.refillPriceGrowthBps,
            c.emissionSoftCap,
            c.qualityPerCatch,
            c.qualityPerRarity,
            c.blendAmount,
            c.blendChancePpm,
            c.blendMaxWins
        ) = game.config();
    }
}
