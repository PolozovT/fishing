// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {GameSetup} from "./GameSetup.sol";
import {PearlToken} from "../src/PearlToken.sol";
import {FishNFT} from "../src/FishNFT.sol";
import {FishingGame} from "../src/FishingGame.sol";
import {GameLens} from "../src/GameLens.sol";

/// @notice Replaces the game and its lens, keeping PEARL, the fish NFTs, the market and the exchange.
///         Player progress (level, tackle, weekly scores) lives in the game and starts over; fish and PEARL stay.
///         forge script script/RedeployGame.s.sol --rpc-url <rpc> --broadcast --private-key <owner key>
contract RedeployGame is Script {
    using stdJson for string;

    function run() external {
        string memory path = string.concat(vm.projectRoot(), "/../deployments/", vm.toString(block.chainid), ".json");
        string memory json = vm.readFile(path);
        PearlToken pearl = PearlToken(json.readAddress(".pearl"));
        FishNFT fish = FishNFT(json.readAddress(".fish"));
        address oldGame = json.readAddress(".game");

        vm.startBroadcast();
        (, address sender,) = vm.readCallers();
        (FishingGame game, GameLens lens) = GameSetup.deployGame(sender, pearl, fish);
        pearl.setMinter(oldGame, false);
        vm.stopBroadcast();

        vm.writeJson(vm.toString(address(game)), path, ".game");
        vm.writeJson(vm.toString(address(lens)), path, ".lens");
        vm.writeJson(vm.toString(block.number), path, ".startBlock");
        console2.log("FishingGame", address(game));
        console2.log("GameLens", address(lens));
        console2.log("retired", oldGame);
    }
}
