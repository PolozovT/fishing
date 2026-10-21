// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/// @title Fishing rods. Level drives catch chance, rare-fish odds and which spots are accessible.
/// @notice All state changes go through the game contract. A rod is locked (non-transferable) while it is in the water.
contract RodNFT is ERC721, Ownable {
    using Strings for uint256;

    struct Rod {
        uint8 level;
        uint16 durability;
        uint16 maxDurability;
    }

    address public game;
    uint256 public nextId = 1;
    mapping(uint256 => Rod) internal _rods;
    mapping(uint256 => bool) public locked;

    error NotGame();
    error RodLocked();

    constructor(address owner_) ERC721("Onchain Fishing Rod", "ROD") Ownable(owner_) {}

    modifier onlyGame() {
        if (msg.sender != game) revert NotGame();
        _;
    }

    function setGame(address game_) external onlyOwner {
        game = game_;
    }

    function rods(uint256 id) external view returns (Rod memory) {
        _requireOwned(id);
        return _rods[id];
    }

    function mint(address to, uint8 level, uint16 maxDurability) external onlyGame returns (uint256 id) {
        id = nextId++;
        _rods[id] = Rod(level, maxDurability, maxDurability);
        _mint(to, id);
    }

    function setRod(uint256 id, Rod calldata rod) external onlyGame {
        _requireOwned(id);
        _rods[id] = rod;
    }

    function setLocked(uint256 id, bool value) external onlyGame {
        locked[id] = value;
    }

    function _update(address to, uint256 tokenId, address auth) internal override returns (address from) {
        if (locked[tokenId]) revert RodLocked();
        from = super._update(to, tokenId, auth);
    }

    function tokenURI(uint256 id) public view override returns (string memory) {
        _requireOwned(id);
        Rod memory r = _rods[id];
        string memory lvl = uint256(r.level).toString();
        string[5] memory colors = ["#8d6e63", "#4caf50", "#2196f3", "#9c27b0", "#ff9800"];
        string memory c = colors[(r.level - 1) % 5];
        string memory svg = string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><rect width="200" height="200" fill="#0b2239"/>',
            '<line x1="30" y1="170" x2="170" y2="30" stroke="', c, '" stroke-width="8" stroke-linecap="round"/>',
            '<circle cx="60" cy="140" r="12" fill="none" stroke="#ddd" stroke-width="4"/>',
            '<path d="M170 30 Q185 100 175 150" stroke="#ddd" fill="none"/>',
            '<text x="12" y="28" fill="#fff" font-family="monospace" font-size="16">ROD Lv.', lvl, "</text></svg>"
        );
        string memory json = string.concat(
            '{"name":"Rod #', id.toString(), '","description":"Fishing rod from Onchain Fishing.",',
            '"attributes":[{"trait_type":"Level","value":', lvl, '},{"trait_type":"Durability","value":',
            uint256(r.durability).toString(), '},{"trait_type":"Max durability","value":',
            uint256(r.maxDurability).toString(), '}],"image":"data:image/svg+xml;base64,',
            Base64.encode(bytes(svg)), '"}'
        );
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }
}
