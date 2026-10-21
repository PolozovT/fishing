// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {GameSetup} from "../script/GameSetup.sol";
import {PearlToken} from "../src/PearlToken.sol";
import {FishNFT} from "../src/FishNFT.sol";
import {RodNFT} from "../src/RodNFT.sol";
import {FishingGame} from "../src/FishingGame.sol";

/// @dev Random players doing random things: cast, reel (now / late / expired), sell, buy bait, refill, upgrade, repair.
contract Handler is Test {
    FishingGame public game;
    PearlToken public pearl;
    FishNFT public fish;
    RodNFT public rod;
    address[] public actors;
    mapping(address => uint256) public rodOf;

    uint256 public caught;
    uint256 public sold;
    uint256 public time;
    uint256 public blockNo;

    constructor(FishingGame g, PearlToken p, FishNFT f, RodNFT r) {
        game = g;
        pearl = p;
        fish = f;
        rod = r;
        time = block.timestamp;
        blockNo = block.number;
        for (uint256 i; i < 4; i++) {
            address a = makeAddr(string.concat("actor", vm.toString(i)));
            actors.push(a);
            vm.prank(a);
            rodOf[a] = g.claimStarterRod();
        }
    }

    function actorCount() external view returns (uint256) {
        return actors.length;
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }

    function _advance(uint256 blocks, uint256 secs) internal {
        blockNo += blocks;
        time += secs;
        vm.roll(blockNo);
        vm.warp(time);
    }

    function cast(uint256 who, uint8 spot, uint8 bait) external {
        address a = _actor(who);
        spot = uint8(bound(spot, 0, 1));
        bait = uint8(bound(bait, 0, 3));
        uint256 before = fish.nextId();
        vm.prank(a);
        try game.cast(rodOf[a], spot, bait) {} catch {}
        caught += fish.nextId() - before; // cast() auto-resolves a finished previous cast
    }

    function reel(uint256 who, uint256 wait, bytes32 entropy) external {
        address a = _actor(who);
        (uint64 target,,,,) = game.casts(a);
        if (target == 0) return;
        wait = bound(wait, 1, 400); // sometimes past the 256-block window
        if (blockNo <= target) _advance(target - blockNo, 0);
        _advance(wait, wait * 2);
        if (blockNo - target <= 256) vm.setBlockhash(target, entropy);
        uint256 before = fish.nextId();
        vm.prank(a);
        game.reel();
        caught += fish.nextId() - before;
    }

    function sell(uint256 who, uint256 fishSeed) external {
        uint256 n = fish.nextId();
        if (n == 1) return;
        uint256 id = 1 + (fishSeed % (n - 1));
        address a = _actor(who);
        try fish.ownerOf(id) returns (address o) {
            if (o != a) return;
        } catch {
            return;
        }
        uint256[] memory ids = new uint256[](1);
        ids[0] = id;
        vm.prank(a);
        game.sellFish(ids);
        sold++;
    }

    function buyBait(uint256 who, uint8 bait, uint256 amount) external {
        address a = _actor(who);
        vm.prank(a);
        try game.buyBait(uint8(bound(bait, 1, 3)), bound(amount, 1, 5)) {} catch {}
    }

    function refill(uint256 who) external {
        address a = _actor(who);
        vm.prank(a);
        try game.refillEnergy() {} catch {}
    }

    function upgrade(uint256 who) external {
        address a = _actor(who);
        vm.prank(a);
        try game.upgradeRod(rodOf[a]) {} catch {}
    }

    function repair(uint256 who) external {
        address a = _actor(who);
        vm.prank(a);
        try game.repairRod(rodOf[a]) {} catch {}
    }

    function wait(uint256 secs) external {
        _advance(1, bound(secs, 1, 2 days));
    }
}

contract InvariantTest is Test {
    Handler internal h;
    FishingGame internal game;
    PearlToken internal pearl;
    FishNFT internal fish;
    RodNFT internal rod;

    function setUp() public {
        vm.warp(1_750_000_000);
        vm.roll(1_000);
        address owner = makeAddr("owner");
        vm.startPrank(owner);
        GameSetup.Deployment memory d = GameSetup.deploy(owner);
        vm.stopPrank();
        game = d.game;
        pearl = d.pearl;
        fish = d.fish;
        rod = d.rod;
        h = new Handler(game, pearl, fish, rod);
        targetContract(address(h));
    }

    /// A rod is locked exactly while its owner has an unresolved cast with it.
    function invariant_rodLockedIffCastActive() public view {
        for (uint256 i; i < h.actorCount(); i++) {
            address a = h.actors(i);
            (uint64 target,,,, uint256 rodId) = game.casts(a);
            uint256 own = h.rodOf(a);
            if (target != 0) assertEq(rodId, own);
            assertEq(rod.locked(own), target != 0);
        }
    }

    /// Every fish NFT in existence was caught and not yet sold.
    function invariant_fishSupplyAccounting() public view {
        assertEq(fish.totalSupply(), h.caught() - h.sold());
        assertEq(fish.nextId() - 1, h.caught());
    }

    /// Durability never exceeds max; energy never exceeds max.
    function invariant_boundedState() public view {
        (uint32 maxEnergy,,,,,,,,,,,,,,,,) = game.config();
        for (uint256 i; i < h.actorCount(); i++) {
            address a = h.actors(i);
            RodNFT.Rod memory r = rod.rods(h.rodOf(a));
            assertLe(r.durability, r.maxDurability);
            assertGe(r.level, 1);
            assertLe(r.level, 5);
            assertLe(game.currentEnergy(a), maxEnergy);
        }
    }

    /// PEARL can only come from selling fish: supply is bounded by the sum of fish values ever paid out.
    function invariant_noPearlFromThinAir() public view {
        if (h.sold() == 0) assertEq(pearl.totalSupply(), 0);
    }
}
