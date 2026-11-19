// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {GameSetup} from "../script/GameSetup.sol";
import {PearlToken} from "../src/PearlToken.sol";
import {FishNFT} from "../src/FishNFT.sol";
import {FishingGame} from "../src/FishingGame.sol";
import {Marketplace} from "../src/Marketplace.sol";
import {GameLens} from "../src/GameLens.sol";
import {BottlePool} from "../src/BottlePool.sol";

contract MockBlend is ERC20 {
    constructor() ERC20("Mock Blend", "BLEND") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

abstract contract BaseTest is Test {
    uint256 internal constant E = 1e18;

    address internal owner = makeAddr("owner");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    MockBlend internal blend;
    PearlToken internal pearl;
    FishNFT internal fish;
    FishingGame internal game;
    Marketplace internal market;
    GameLens internal lens;
    BottlePool internal bottles;

    function setUp() public virtual {
        vm.warp(1_750_000_000);
        vm.roll(1_000);
        blend = new MockBlend();
        vm.startPrank(owner);
        GameSetup.Deployment memory d = GameSetup.deploy(owner, IERC20(address(blend)));
        // the test contract can mint PEARL to fund players
        d.pearl.setMinter(address(this), true);
        vm.stopPrank();
        pearl = d.pearl;
        fish = d.fish;
        game = d.game;
        market = d.market;
        lens = d.lens;
        bottles = d.bottles;
    }

    function _fund(address who, uint256 amount) internal {
        pearl.mint(who, amount);
    }

    /// @dev Keeps energy from running out in long loops.
    function _rest() internal {
        vm.warp(block.timestamp + 1 days);
    }

    /// @dev Casts, sets the randomness block's hash to `entropy` and reels. Returns the fish id or 0.
    function _fishOnce(address who, uint8 locationId, bytes32 entropy) internal returns (uint256 fishId) {
        vm.prank(who);
        game.cast(locationId);
        uint64 target = game.castOf(who).targetBlock;
        vm.roll(target + 1);
        vm.setBlockhash(target, entropy);
        uint256 before = fish.nextId();
        vm.prank(who);
        game.reel();
        fishId = fish.nextId() > before ? before : 0;
    }

    /// @dev Fishes until something is landed.
    function _catch(address who, uint8 locationId, uint256 salt) internal returns (uint256 fishId) {
        for (uint256 i; fishId == 0; i++) {
            if (game.currentEnergy(who) < 4) _rest();
            fishId = _fishOnce(who, locationId, keccak256(abi.encode(salt, i)));
        }
    }

    function _player(address who) internal view returns (FishingGame.Player memory) {
        return game.playerOf(who);
    }
}
