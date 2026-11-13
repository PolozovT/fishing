// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {BaseTest} from "./Base.t.sol";
import {Marketplace} from "../src/Marketplace.sol";

contract MarketplaceTest is BaseTest {
    function test_listAndBuyFishBurnsFeeAndMovesTheSpecimenCount() public {
        uint256 id = _catch(alice, 0, 1);
        uint16 species = fish.fish(id).speciesId;
        vm.startPrank(alice);
        fish.approve(address(market), id);
        market.list(address(fish), id, 100e18);
        vm.stopPrank();
        assertEq(fish.ownerOf(id), address(market));
        assertEq(fish.heldOf(alice, species), 0);

        _fund(bob, 100e18);
        uint256 supplyBefore = pearl.totalSupply();
        vm.startPrank(bob);
        pearl.approve(address(market), 100e18);
        market.buy(address(fish), id);
        vm.stopPrank();

        assertEq(fish.ownerOf(id), bob);
        assertEq(fish.heldOf(bob, species), 1);
        assertEq(pearl.balanceOf(alice), 95e18);
        assertEq(pearl.balanceOf(bob), 0);
        assertEq(pearl.totalSupply(), supplyBefore - 5e18);
        // a bought fish is in the buyer's keepnet and can be sold to the game
        (uint256[] memory ids,,) = lens.keepnet(bob);
        assertEq(ids[0], id);
    }

    function test_cancel() public {
        uint256 id = _catch(alice, 0, 2);
        vm.startPrank(alice);
        fish.approve(address(market), id);
        market.list(address(fish), id, 1e18);
        market.cancel(address(fish), id);
        vm.stopPrank();
        assertEq(fish.ownerOf(id), alice);
        vm.prank(bob);
        vm.expectRevert(Marketplace.NotListed.selector);
        market.buy(address(fish), id);
    }

    function test_onlySellerCancelsAndOnlyAllowedCollections() public {
        uint256 id = _catch(alice, 0, 3);
        vm.startPrank(alice);
        fish.approve(address(market), id);
        market.list(address(fish), id, 1e18);
        vm.stopPrank();
        vm.prank(bob);
        vm.expectRevert(Marketplace.NotSeller.selector);
        market.cancel(address(fish), id);
        vm.prank(alice);
        vm.expectRevert(Marketplace.CollectionNotAllowed.selector);
        market.list(address(pearl), 1, 1e18);
    }
}
