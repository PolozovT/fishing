// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {BaseTest} from "./Base.t.sol";
import {Marketplace} from "../src/Marketplace.sol";
import {RodNFT} from "../src/RodNFT.sol";

contract MarketplaceTest is BaseTest {
    function test_listAndBuyRodBurnsFee() public {
        uint256 id = _starter(alice);
        vm.startPrank(alice);
        rod.approve(address(market), id);
        market.list(address(rod), id, 100e18);
        vm.stopPrank();
        assertEq(rod.ownerOf(id), address(market));

        _fund(bob, 100e18);
        uint256 supplyBefore = pearl.totalSupply();
        vm.startPrank(bob);
        pearl.approve(address(market), 100e18);
        market.buy(address(rod), id);
        vm.stopPrank();

        assertEq(rod.ownerOf(id), bob);
        assertEq(pearl.balanceOf(alice), 95e18);
        assertEq(pearl.balanceOf(bob), 0);
        assertEq(pearl.totalSupply(), supplyBefore - 5e18);
    }

    function test_cancel() public {
        uint256 id = _starter(alice);
        vm.startPrank(alice);
        rod.approve(address(market), id);
        market.list(address(rod), id, 1e18);
        market.cancel(address(rod), id);
        vm.stopPrank();
        assertEq(rod.ownerOf(id), alice);

        vm.prank(bob);
        vm.expectRevert(Marketplace.NotListed.selector);
        market.buy(address(rod), id);
    }

    function test_onlySellerCancels() public {
        uint256 id = _starter(alice);
        vm.startPrank(alice);
        rod.approve(address(market), id);
        market.list(address(rod), id, 1e18);
        vm.stopPrank();
        vm.prank(bob);
        vm.expectRevert(Marketplace.NotSeller.selector);
        market.cancel(address(rod), id);
    }

    function test_cannotListRodInWater() public {
        uint256 id = _starter(alice);
        vm.startPrank(alice);
        game.cast(id, 0, 0);
        rod.approve(address(market), id);
        vm.expectRevert(RodNFT.RodLocked.selector);
        market.list(address(rod), id, 1e18);
        vm.stopPrank();
    }

    function test_cannotListOthersNft() public {
        uint256 id = _starter(alice);
        vm.prank(bob);
        vm.expectRevert();
        market.list(address(rod), id, 1e18);
    }

    function test_unknownCollectionRejected() public {
        vm.prank(alice);
        vm.expectRevert(Marketplace.CollectionNotAllowed.selector);
        market.list(address(pearl), 1, 1e18);
    }

    function test_listedRodCannotFish() public {
        uint256 id = _starter(alice);
        vm.startPrank(alice);
        rod.approve(address(market), id);
        market.list(address(rod), id, 1e18);
        vm.expectRevert();
        game.cast(id, 0, 0);
        vm.stopPrank();
    }
}
