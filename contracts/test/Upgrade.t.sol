// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ProxyAdmin} from "@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol";
import {ITransparentUpgradeableProxy} from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import {BaseTest} from "./Base.t.sol";
import {GameSetup} from "../script/GameSetup.sol";
import {FishingGame, IBottlePool} from "../src/FishingGame.sol";
import {PearlToken} from "../src/PearlToken.sol";
import {FishNFT} from "../src/FishNFT.sol";

/// @dev A later version of the game: new code and one more state variable, appended.
contract FishingGameV2 is FishingGame {
    uint256 public seasons;

    constructor(PearlToken p, FishNFT f, IBottlePool b) FishingGame(p, f, b) {}

    function startSeason() external onlyOwner {
        seasons += 1;
    }
}

/// @notice The promise behind the proxies: a new version of the game keeps everybody's progress.
contract UpgradeTest is BaseTest {
    bytes32 internal constant ADMIN_SLOT = 0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103;

    function _admin() internal view returns (ProxyAdmin) {
        return ProxyAdmin(address(uint160(uint256(vm.load(address(game), ADMIN_SLOT)))));
    }

    function test_upgradeKeepsProgressAndAddress() public {
        uint256 fishId = _catch(alice, 0, 1);
        _fund(alice, 2_000 * E);
        vm.prank(alice);
        game.buyRod(1);
        FishingGame.Player memory before = game.playerOf(alice);
        uint32 weekBefore = game.weekTotal(game.currentWeek(), alice);
        assertGt(before.xp, 0);

        FishingGameV2 next = new FishingGameV2(pearl, fish, IBottlePool(address(bottles)));
        ProxyAdmin admin = _admin();
        vm.prank(owner);
        admin.upgradeAndCall(ITransparentUpgradeableProxy(address(game)), address(next), "");

        FishingGame.Player memory p = game.playerOf(alice);
        assertEq(p.xp, before.xp);
        assertEq(p.catches, before.catches);
        assertEq(p.rods, before.rods);
        assertEq(p.rod, before.rod);
        assertEq(game.weekTotal(game.currentWeek(), alice), weekBefore);
        assertEq(game.owner(), owner);
        assertEq(game.rodCount(), 6);
        assertEq(fish.ownerOf(fishId), alice);

        // the new code runs on the old state, and the game still mints fish and PEARL
        vm.prank(owner);
        FishingGameV2(address(game)).startSeason();
        assertEq(FishingGameV2(address(game)).seasons(), 1);
        uint256[] memory ids = new uint256[](1);
        ids[0] = _catch(alice, 0, 2);
        vm.prank(alice);
        game.sellFish(ids);
        assertGt(game.playerOf(alice).catches, before.catches);
    }

    function test_onlyTheOwnerUpgrades() public {
        FishingGameV2 next = new FishingGameV2(pearl, fish, IBottlePool(address(bottles)));
        ProxyAdmin admin = _admin();
        assertEq(admin.owner(), owner);
        vm.prank(alice);
        vm.expectRevert();
        admin.upgradeAndCall(ITransparentUpgradeableProxy(address(game)), address(next), "");
    }

    function test_cannotBeInitializedAgain() public {
        vm.prank(alice);
        vm.expectRevert(FishingGame.BadConfig.selector);
        game.initialize(alice);
        // nor after the owner walks away
        vm.prank(owner);
        game.renounceOwnership();
        vm.prank(alice);
        vm.expectRevert(FishingGame.BadConfig.selector);
        game.initialize(alice);
    }

    function test_bareImplementationIsInert() public {
        FishingGame impl = new FishingGame(pearl, fish, IBottlePool(address(bottles)));
        vm.prank(alice);
        vm.expectRevert(FishingGame.BadConfig.selector);
        impl.initialize(alice);
    }
}
