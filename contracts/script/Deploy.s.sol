// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {GameSetup} from "./GameSetup.sol";

/// @notice forge script script/Deploy.s.sol --rpc-url <rpc> --broadcast --private-key <key>
///         Writes addresses to ../deployments/<chainId>.json for the frontend and the simulator.
contract Deploy is Script {
    function run() external returns (GameSetup.Deployment memory d) {
        vm.startBroadcast();
        (, address sender,) = vm.readCallers();
        d = GameSetup.deploy(sender);
        vm.stopBroadcast();

        string memory k = "deployment";
        vm.serializeUint(k, "chainId", block.chainid);
        vm.serializeUint(k, "startBlock", block.number);
        vm.serializeAddress(k, "pearl", address(d.pearl));
        vm.serializeAddress(k, "fish", address(d.fish));
        vm.serializeAddress(k, "market", address(d.market));
        vm.serializeAddress(k, "lens", address(d.lens));
        string memory json = vm.serializeAddress(k, "game", address(d.game));
        string memory path = string.concat(vm.projectRoot(), "/../deployments/", vm.toString(block.chainid), ".json");
        vm.writeJson(json, path);

        console2.log("FishingGame", address(d.game));
        console2.log("written", path);
    }
}
