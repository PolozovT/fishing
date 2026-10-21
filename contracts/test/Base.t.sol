// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {GameSetup} from "../script/GameSetup.sol";
import {PearlToken} from "../src/PearlToken.sol";
import {FishNFT} from "../src/FishNFT.sol";
import {RodNFT} from "../src/RodNFT.sol";
import {FishingGame} from "../src/FishingGame.sol";
import {Marketplace} from "../src/Marketplace.sol";

abstract contract BaseTest is Test {
    address internal owner = makeAddr("owner");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    PearlToken internal pearl;
    FishNFT internal fish;
    RodNFT internal rod;
    FishingGame internal game;
    Marketplace internal market;

    function setUp() public virtual {
        vm.warp(1_750_000_000);
        vm.roll(1_000);
        vm.startPrank(owner);
        GameSetup.Deployment memory d = GameSetup.deploy(owner);
        // the test contract can mint PEARL to fund players
        d.pearl.setMinter(address(this), true);
        vm.stopPrank();
        pearl = d.pearl;
        fish = d.fish;
        rod = d.rod;
        game = d.game;
        market = d.market;
    }

    function _starter(address who) internal returns (uint256 id) {
        vm.prank(who);
        id = game.claimStarterRod();
    }

    function _fund(address who, uint256 amount) internal {
        pearl.mint(who, amount);
    }

    /// @dev Casts, then sets the randomness block's hash to `entropy` and reels. Returns the fish id or 0 on miss.
    function _fishOnce(address who, uint256 rodId, uint8 spotId, uint8 baitId, bytes32 entropy)
        internal
        returns (uint256 fishId)
    {
        vm.prank(who);
        game.cast(rodId, spotId, baitId);
        (uint64 target,,,,) = game.casts(who);
        vm.roll(target + 1);
        vm.setBlockhash(target, entropy);
        uint256 before = fish.nextId();
        vm.prank(who);
        game.reel();
        fishId = fish.nextId() > before ? before : 0;
    }

    function _setRodLevel(uint256 rodId, uint8 level) internal {
        RodNFT.Rod memory r = rod.rods(rodId);
        r.level = level;
        vm.prank(address(game));
        rod.setRod(rodId, r);
    }
}
