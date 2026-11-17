// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {GameSetup} from "./GameSetup.sol";
import {PearlExchange} from "../src/PearlExchange.sol";
import {Tournaments} from "../src/Tournaments.sol";
import {FightVerifier} from "../src/FightVerifier.sol";

/// @notice A complete, fresh deployment: tokens, market, the game and the tournaments (both behind proxies), the
///         lens and the BLEND exchange. Everything starts empty. Later versions of the game or the tournaments are
///         upgrades of the proxies (script/Upgrade.s.sol), which keep all player state.
///         BLEND_TOKEN=0x… forge script script/Deploy.s.sol --rpc-url <rpc> --broadcast --private-key <key>
///         Optional: PEARL_PER_BLEND (default 100, for an 18-decimal BLEND), BLEND_TREASURY (default: the sender).
///         Writes addresses to ../deployments/<chainId>.json for the frontend.
contract Deploy is Script {
    function run() external returns (GameSetup.Deployment memory d) {
        IERC20 blend = IERC20(vm.envAddress("BLEND_TOKEN"));
        uint256 rate = vm.envOr("PEARL_PER_BLEND", uint256(100));

        vm.startBroadcast();
        (, address sender,) = vm.readCallers();
        d = GameSetup.deploy(sender);
        PearlExchange exchange = new PearlExchange(sender, d.pearl, blend, rate, vm.envOr("BLEND_TREASURY", sender));
        d.pearl.setMinter(address(exchange), true);
        (Tournaments tournaments, FightVerifier verifier) = GameSetup.deployTournaments(sender, d.game, d.fish, blend);
        vm.stopBroadcast();

        string memory k = "deployment";
        vm.serializeUint(k, "chainId", block.chainid);
        vm.serializeUint(k, "startBlock", block.number);
        vm.serializeAddress(k, "pearl", address(d.pearl));
        vm.serializeAddress(k, "fish", address(d.fish));
        vm.serializeAddress(k, "market", address(d.market));
        vm.serializeAddress(k, "lens", address(d.lens));
        vm.serializeAddress(k, "blend", address(blend));
        vm.serializeAddress(k, "exchange", address(exchange));
        vm.serializeAddress(k, "tournaments", address(tournaments));
        vm.serializeAddress(k, "fightVerifier", address(verifier));
        string memory json = vm.serializeAddress(k, "game", address(d.game));
        string memory path = string.concat(vm.projectRoot(), "/../deployments/", vm.toString(block.chainid), ".json");
        vm.writeJson(json, path);

        console2.log("FishingGame (proxy)", address(d.game));
        console2.log("Tournaments (proxy)", address(tournaments));
        console2.log("written", path);
    }
}
