// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title PEARL — the soft currency of the game.
/// @notice Minted only by game contracts (selling fish) and burned by them (bait, upgrades, repairs, energy).
contract PearlToken is ERC20, Ownable {
    mapping(address => bool) public isMinter;

    error NotMinter();

    event MinterSet(address indexed minter, bool allowed);

    constructor(address owner_) ERC20("Pearl", "PEARL") Ownable(owner_) {}

    modifier onlyMinter() {
        if (!isMinter[msg.sender]) revert NotMinter();
        _;
    }

    function setMinter(address minter, bool allowed) external onlyOwner {
        isMinter[minter] = allowed;
        emit MinterSet(minter, allowed);
    }

    function mint(address to, uint256 amount) external onlyMinter {
        _mint(to, amount);
    }

    /// @notice Game sinks burn directly from the acting player (the game only calls this with `from == msg.sender`
    ///         of the outer call), so players do not need an approval transaction for every action.
    function gameBurn(address from, uint256 amount) external onlyMinter {
        _burn(from, amount);
    }

    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }
}
