// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ProxyAdmin} from "@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol";
import {ITransparentUpgradeableProxy} from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import {PearlToken} from "../src/PearlToken.sol";
import {FishNFT} from "../src/FishNFT.sol";
import {FishingGame} from "../src/FishingGame.sol";
import {Tournaments} from "../src/Tournaments.sol";

/// @notice Points a proxy at the current code, keeping its address and every player's state.
///         Run ./check-layout.sh first: a new version may only append state variables.
///         TARGET=game|tournaments forge script script/Upgrade.s.sol --rpc-url <rpc> --broadcast --private-key <owner>
contract Upgrade is Script {
    /// @dev ERC-1967 admin slot: the ProxyAdmin contract created together with the proxy.
    bytes32 internal constant ADMIN_SLOT = 0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103;

    function run() external {
        string memory path = string.concat(vm.projectRoot(), "/../deployments/", vm.toString(block.chainid), ".json");
        string memory json = vm.readFile(path);
        bool isGame = keccak256(bytes(vm.envString("TARGET"))) == keccak256("game");
        address proxy = vm.parseJsonAddress(json, isGame ? ".game" : ".tournaments");
        PearlToken pearl = PearlToken(vm.parseJsonAddress(json, ".pearl"));
        FishNFT fish = FishNFT(vm.parseJsonAddress(json, ".fish"));
        ProxyAdmin admin = ProxyAdmin(address(uint160(uint256(vm.load(proxy, ADMIN_SLOT)))));

        vm.startBroadcast();
        address impl = isGame
            ? address(new FishingGame(pearl, fish))
            : address(new Tournaments(FishingGame(vm.parseJsonAddress(json, ".game")), fish, IERC20(vm.parseJsonAddress(json, ".blend"))));
        admin.upgradeAndCall(ITransparentUpgradeableProxy(proxy), impl, "");
        vm.stopBroadcast();

        console2.log("proxy", proxy);
        console2.log("new implementation", impl);
    }
}
