// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/// @title Caught fish. Every fish is unique: species + exact weight + where/when/who caught it.
/// @notice Holds the species catalog too, so metadata (fully onchain SVG) needs no external calls.
contract FishNFT is ERC721, Ownable {
    using Strings for uint256;

    struct Species {
        string name;
        uint8 rarity; // 0 common, 1 uncommon, 2 rare, 3 epic, 4 legendary
        uint32 minWeight; // grams
        uint32 maxWeight; // grams
        uint96 basePrice; // PEARL wei for a fish of average weight
        uint24 color; // RGB for the SVG
    }

    struct Fish {
        uint16 speciesId;
        uint32 weight; // grams
        uint8 spotId;
        uint40 caughtAt;
        address angler; // original catcher, survives transfers
    }

    address public game;
    uint256 public nextId = 1;
    uint256 public totalSupply;
    Species[] internal _species;
    mapping(uint256 => Fish) internal _fish;

    error NotGame();
    error BadSpecies();

    event SpeciesAdded(uint256 indexed id, string name, uint8 rarity);

    constructor(address owner_) ERC721("Onchain Fishing Catch", "FISH") Ownable(owner_) {}

    modifier onlyGame() {
        if (msg.sender != game) revert NotGame();
        _;
    }

    function setGame(address game_) external onlyOwner {
        game = game_;
    }

    function addSpecies(Species calldata s) external onlyOwner returns (uint256 id) {
        if (s.minWeight == 0 || s.maxWeight < s.minWeight || s.rarity > 4) revert BadSpecies();
        id = _species.length;
        _species.push(s);
        emit SpeciesAdded(id, s.name, s.rarity);
    }

    function updateSpecies(uint256 id, Species calldata s) external onlyOwner {
        if (id >= _species.length || s.minWeight == 0 || s.maxWeight < s.minWeight || s.rarity > 4) {
            revert BadSpecies();
        }
        _species[id] = s;
    }

    function speciesCount() external view returns (uint256) {
        return _species.length;
    }

    function species(uint256 id) external view returns (Species memory) {
        return _species[id];
    }

    function fish(uint256 id) external view returns (Fish memory) {
        _requireOwned(id);
        return _fish[id];
    }

    function mint(address to, Fish calldata f) external onlyGame returns (uint256 id) {
        id = nextId++;
        _fish[id] = f;
        totalSupply++;
        _mint(to, id);
    }

    function burn(uint256 id) external onlyGame {
        _burn(id);
        delete _fish[id];
        totalSupply--;
    }

    // ---------------------------------------------------------------- metadata

    function tokenURI(uint256 id) public view override returns (string memory) {
        _requireOwned(id);
        Fish memory f = _fish[id];
        Species memory s = _species[f.speciesId];
        string[5] memory rarities = ["Common", "Uncommon", "Rare", "Epic", "Legendary"];
        string memory json = string.concat(
            '{"name":"', s.name, " #", id.toString(), '","description":"A ', _kg(f.weight), " kg ", s.name,
            ' caught onchain.","attributes":[{"trait_type":"Species","value":"', s.name,
            '"},{"trait_type":"Rarity","value":"', rarities[s.rarity], '"},{"trait_type":"Weight (g)","value":',
            uint256(f.weight).toString(), '},{"trait_type":"Spot","value":', uint256(f.spotId).toString(),
            '},{"display_type":"date","trait_type":"Caught","value":', uint256(f.caughtAt).toString(),
            '}],"image":"data:image/svg+xml;base64,', Base64.encode(bytes(_svg(f, s))), '"}'
        );
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }

    function _svg(Fish memory f, Species memory s) internal pure returns (string memory) {
        string memory c = _hex(s.color);
        // body size scales with weight relative to the species range (70..130 px wide)
        uint256 span = s.maxWeight - s.minWeight;
        uint256 rx = 35 + (span == 0 ? 15 : (uint256(f.weight - s.minWeight) * 30) / span);
        uint256 ry = (rx * 45) / 100;
        string[5] memory glow = ["#0b2239", "#0d3b2e", "#0d2a4f", "#2a0d4f", "#4f3a0d"];
        return string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><rect width="200" height="200" fill="',
            glow[s.rarity], '"/><ellipse cx="95" cy="100" rx="', rx.toString(), '" ry="', ry.toString(),
            '" fill="', c, '"/><polygon points="', (95 + rx - 5).toString(), ",100 ", (95 + rx + 30).toString(),
            ",", (100 - ry).toString(), " ", (95 + rx + 30).toString(), ",", (100 + ry).toString(), '" fill="', c,
            '"/><circle cx="', (95 - rx + 15).toString(), '" cy="92" r="5" fill="#fff"/><circle cx="',
            (95 - rx + 15).toString(), '" cy="92" r="2" fill="#000"/>',
            '<text x="10" y="185" fill="#fff" font-family="monospace" font-size="13">', s.name, " ",
            _kg(f.weight), "kg</text></svg>"
        );
    }

    function _kg(uint32 grams) internal pure returns (string memory) {
        uint256 frac = (grams % 1000) / 10;
        return string.concat(
            uint256(grams / 1000).toString(), ".", frac < 10 ? "0" : "", frac.toString()
        );
    }

    function _hex(uint24 rgb) internal pure returns (string memory) {
        bytes memory out = new bytes(7);
        bytes16 sym = "0123456789abcdef";
        out[0] = "#";
        for (uint256 i = 0; i < 6; i++) {
            out[6 - i] = sym[(rgb >> (4 * i)) & 0xf];
        }
        return string(out);
    }
}
