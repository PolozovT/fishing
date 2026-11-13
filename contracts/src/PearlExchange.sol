// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {PearlToken} from "./PearlToken.sol";

/// @title Buy PEARL for BLEND.
/// @notice One way only: BLEND in, PEARL out at a fixed rate set by the owner. The BLEND goes straight to the
///         treasury; this contract never holds it. The PEARL is minted, so this contract must be a PEARL minter.
///         PEARL bought here spends like any other: rods, lures, repairs, energy.
contract PearlExchange is Ownable {
    using SafeERC20 for IERC20;

    PearlToken public immutable pearl;
    IERC20 public immutable blend;

    /// @notice PEARL wei minted per smallest unit of BLEND. With 18-decimal BLEND, 100 = "100 PEARL per BLEND".
    uint256 public pearlPerBlendUnit;
    address public treasury;
    bool public paused;
    uint256 public totalBlendIn;
    uint256 public totalPearlOut;

    error BadConfig();
    error Paused();
    error ZeroAmount();

    event PearlBought(address indexed player, uint256 blendPaid, uint256 pearlOut);
    event TermsSet(uint256 pearlPerBlendUnit, address treasury, bool paused);

    constructor(address owner_, PearlToken pearl_, IERC20 blend_, uint256 pearlPerBlendUnit_, address treasury_)
        Ownable(owner_)
    {
        if (address(blend_) == address(0)) revert BadConfig();
        pearl = pearl_;
        blend = blend_;
        _setTerms(pearlPerBlendUnit_, treasury_, false);
    }

    function setTerms(uint256 pearlPerBlendUnit_, address treasury_, bool paused_) external onlyOwner {
        _setTerms(pearlPerBlendUnit_, treasury_, paused_);
    }

    function _setTerms(uint256 rate, address treasury_, bool paused_) internal {
        if (rate == 0 || treasury_ == address(0)) revert BadConfig();
        pearlPerBlendUnit = rate;
        treasury = treasury_;
        paused = paused_;
        emit TermsSet(rate, treasury_, paused_);
    }

    function quote(uint256 blendAmount) public view returns (uint256) {
        return blendAmount * pearlPerBlendUnit;
    }

    /// @notice Pays `blendAmount` BLEND (approve this contract first) and receives PEARL.
    function buyPearl(uint256 blendAmount) external returns (uint256 pearlOut) {
        if (paused) revert Paused();
        if (blendAmount == 0) revert ZeroAmount();
        pearlOut = quote(blendAmount);
        totalBlendIn += blendAmount;
        totalPearlOut += pearlOut;
        // the token is pulled before anything is minted; a failed transfer reverts the whole purchase
        blend.safeTransferFrom(msg.sender, treasury, blendAmount);
        pearl.mint(msg.sender, pearlOut);
        emit PearlBought(msg.sender, blendAmount, pearlOut);
    }
}
