// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title The BLEND in the bottles.
/// @notice Now and then a bite in the game is not a fish but a sealed bottle. The game rolls for it and keeps the
///         one-per-player count; this contract holds the prize money and says whether there is a bottle to give:
///         the player has the level, today's limit is not reached and a whole bottle is left in the pool. If so it
///         pays the player on the spot; if not, the bite is a fish as usual.
///
///         The pool is this contract's BLEND balance. Anyone tops it up by sending BLEND here, so the most the
///         bottles can ever cost is what was sent.
contract BottlePool is Ownable {
    using SafeERC20 for IERC20;

    IERC20 public immutable blend;
    /// @notice The only caller of `pay`.
    address public game;

    uint96 public amount; // BLEND per bottle
    uint8 public minLevel; // a player below this level never hooks a bottle
    uint8 public dailyMax; // bottles per UTC day over all players; 0 = no limit

    mapping(uint256 => uint256) public foundOnDay;
    uint256 public totalFound;

    error NotTheGame();

    event BottlePaid(address indexed player, uint256 amount);
    event RulesSet(uint96 amount, uint8 minLevel, uint8 dailyMax);
    event GameSet(address game);

    constructor(address owner_, IERC20 blend_, uint96 amount_, uint8 minLevel_, uint8 dailyMax_) Ownable(owner_) {
        blend = blend_;
        _setRules(amount_, minLevel_, dailyMax_);
    }

    function setGame(address game_) external onlyOwner {
        game = game_;
        emit GameSet(game_);
    }

    function setRules(uint96 amount_, uint8 minLevel_, uint8 dailyMax_) external onlyOwner {
        _setRules(amount_, minLevel_, dailyMax_);
    }

    function _setRules(uint96 amount_, uint8 minLevel_, uint8 dailyMax_) internal {
        (amount, minLevel, dailyMax) = (amount_, minLevel_, dailyMax_);
        emit RulesSet(amount_, minLevel_, dailyMax_);
    }

    /// @notice Whole bottles left in the pool.
    function left() public view returns (uint256) {
        return amount == 0 ? 0 : blend.balanceOf(address(this)) / amount;
    }

    /// @notice Whether a player with `xp` experience can hook a bottle right now. The level curve is the game's:
    ///         level L starts at 50·L·(L−1) XP.
    function open(uint256 xp) public view returns (bool) {
        uint256 level = minLevel;
        if (level > 1 && xp < 50 * level * (level - 1)) return false;
        if (dailyMax != 0 && foundOnDay[block.timestamp / 1 days] >= dailyMax) return false;
        return left() != 0;
    }

    /// @notice Called by the game when its roll says "bottle". Pays `player` and returns the amount, or returns 0
    ///         when no bottle is open for them (the game then lands a fish instead).
    function pay(address player, uint256 xp) external returns (uint256 paid) {
        if (msg.sender != game) revert NotTheGame();
        if (!open(xp)) return 0;
        paid = amount;
        foundOnDay[block.timestamp / 1 days] += 1;
        totalFound += 1;
        emit BottlePaid(player, paid);
        blend.safeTransfer(player, paid);
    }

    /// @notice Takes BLEND back out of the pool.
    function withdraw(address to, uint256 value) external onlyOwner {
        blend.safeTransfer(to, value);
    }
}
