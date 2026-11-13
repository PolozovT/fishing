// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {BaseTest} from "./Base.t.sol";
import {PearlExchange} from "../src/PearlExchange.sol";
import {PearlToken} from "../src/PearlToken.sol";

contract MockBlend is ERC20 {
    constructor() ERC20("Mock Blend", "BLEND") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract PearlExchangeTest is BaseTest {
    MockBlend internal blend;
    PearlExchange internal exchange;
    address internal treasury = makeAddr("treasury");

    function setUp() public override {
        super.setUp();
        blend = new MockBlend();
        vm.startPrank(owner);
        exchange = new PearlExchange(owner, pearl, IERC20(address(blend)), 100, treasury); // 100 PEARL per BLEND
        pearl.setMinter(address(exchange), true);
        vm.stopPrank();
    }

    function test_buyPearlPaysTheTreasury() public {
        blend.mint(alice, 10 * E);
        vm.startPrank(alice);
        blend.approve(address(exchange), 5 * E);
        uint256 out = exchange.buyPearl(5 * E);
        assertEq(out, 500 * E);
        assertEq(pearl.balanceOf(alice), 500 * E);
        assertEq(blend.balanceOf(treasury), 5 * E);
        assertEq(blend.balanceOf(alice), 5 * E);
        assertEq(blend.balanceOf(address(exchange)), 0, "the exchange never holds BLEND");
        vm.stopPrank();
    }

    function test_boughtPearlSpendsLikeAnyOther() public {
        blend.mint(alice, 10 * E);
        vm.startPrank(alice);
        blend.approve(address(exchange), 10 * E);
        exchange.buyPearl(10 * E);
        game.buyRod(1);
        game.buyLure(0);
        vm.stopPrank();
        assertEq(pearl.balanceOf(alice), (1000 - 450 - 60) * E);
        assertEq(game.playerOf(alice).rod, 1);
        assertEq(exchange.totalBlendIn(), 10 * E);
        assertEq(exchange.totalPearlOut(), 1000 * E);
    }

    function test_needsApprovalAndBalance() public {
        vm.prank(alice);
        vm.expectRevert(); // no approval
        exchange.buyPearl(E);
        vm.startPrank(alice);
        blend.approve(address(exchange), E);
        vm.expectRevert(); // no balance
        exchange.buyPearl(E);
        vm.expectRevert(PearlExchange.ZeroAmount.selector);
        exchange.buyPearl(0);
        vm.stopPrank();
        assertEq(pearl.balanceOf(alice), 0);
        assertEq(pearl.totalSupply(), 0);
    }

    function test_ownerSetsTermsAndPauses() public {
        vm.prank(alice);
        vm.expectRevert();
        exchange.setTerms(1, alice, false);
        vm.startPrank(owner);
        vm.expectRevert(PearlExchange.BadConfig.selector);
        exchange.setTerms(0, treasury, false);
        vm.expectRevert(PearlExchange.BadConfig.selector);
        exchange.setTerms(100, address(0), false);
        exchange.setTerms(250, treasury, true);
        vm.stopPrank();
        assertEq(exchange.quote(E), 250 * E);
        blend.mint(alice, E);
        vm.startPrank(alice);
        blend.approve(address(exchange), E);
        vm.expectRevert(PearlExchange.Paused.selector);
        exchange.buyPearl(E);
        vm.stopPrank();
    }

    function test_withoutTheMinterRoleNothingIsTaken() public {
        vm.prank(owner);
        pearl.setMinter(address(exchange), false);
        blend.mint(alice, E);
        vm.startPrank(alice);
        blend.approve(address(exchange), E);
        vm.expectRevert(PearlToken.NotMinter.selector);
        exchange.buyPearl(E);
        vm.stopPrank();
        assertEq(blend.balanceOf(alice), E, "a failed mint must not cost the player BLEND");
    }

    function testFuzz_rateIsExact(uint96 amount, uint32 rate) public {
        vm.assume(amount > 0 && rate > 0);
        vm.prank(owner);
        exchange.setTerms(rate, treasury, false);
        blend.mint(alice, amount);
        vm.startPrank(alice);
        blend.approve(address(exchange), amount);
        exchange.buyPearl(amount);
        vm.stopPrank();
        assertEq(pearl.balanceOf(alice), uint256(amount) * rate);
        assertEq(blend.balanceOf(treasury), amount);
    }
}
