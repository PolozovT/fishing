// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PearlToken} from "../src/PearlToken.sol";
import {PearlExchange} from "../src/PearlExchange.sol";

/// @notice Adds the BLEND → PEARL exchange to an existing deployment. Run by the owner of PearlToken:
///         BLEND_TOKEN=0x… forge script script/DeployExchange.s.sol --rpc-url <rpc> --broadcast --private-key <key>
///         Optional: PEARL_PER_BLEND (default 100, for an 18-decimal BLEND), BLEND_TREASURY (default: the sender).
///         Adds `blend` and `exchange` to ../deployments/<chainId>.json.
contract DeployExchange is Script {
    function run() external returns (PearlExchange exchange) {
        string memory path = string.concat(vm.projectRoot(), "/../deployments/", vm.toString(block.chainid), ".json");
        PearlToken pearl = PearlToken(vm.parseJsonAddress(vm.readFile(path), ".pearl"));
        address blend = vm.envAddress("BLEND_TOKEN");
        uint256 rate = vm.envOr("PEARL_PER_BLEND", uint256(100));

        vm.startBroadcast();
        (, address sender,) = vm.readCallers();
        address treasury = vm.envOr("BLEND_TREASURY", sender);
        exchange = new PearlExchange(sender, pearl, IERC20(blend), rate, treasury);
        pearl.setMinter(address(exchange), true);
        vm.stopBroadcast();

        vm.writeJson(vm.toString(blend), path, ".blend");
        vm.writeJson(vm.toString(address(exchange)), path, ".exchange");
        console2.log("PearlExchange", address(exchange));
        console2.log("treasury", treasury);
    }
}
