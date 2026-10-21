// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {PearlToken} from "./PearlToken.sol";

/// @title Player-to-player market for fish and rods, priced in PEARL.
/// @notice NFTs are escrowed on listing. A fee is burned on every sale — an extra PEARL sink.
contract Marketplace is Ownable, ReentrancyGuard {
    struct Listing {
        address seller;
        uint96 price;
    }

    PearlToken public immutable pearl;
    uint16 public feeBps;
    mapping(address => bool) public allowedCollection;
    mapping(address => mapping(uint256 => Listing)) public listings;

    error CollectionNotAllowed();
    error NotListed();
    error NotSeller();
    error ZeroPrice();
    error FeeTooHigh();

    event Listed(address indexed collection, uint256 indexed tokenId, address indexed seller, uint256 price);
    event Cancelled(address indexed collection, uint256 indexed tokenId);
    event Sold(address indexed collection, uint256 indexed tokenId, address seller, address buyer, uint256 price);

    constructor(address owner_, PearlToken pearl_, uint16 feeBps_) Ownable(owner_) {
        pearl = pearl_;
        _setFee(feeBps_);
    }

    function setFee(uint16 feeBps_) external onlyOwner {
        _setFee(feeBps_);
    }

    function _setFee(uint16 f) internal {
        if (f > 2_000) revert FeeTooHigh();
        feeBps = f;
    }

    function setCollection(address collection, bool allowed) external onlyOwner {
        allowedCollection[collection] = allowed;
    }

    function list(address collection, uint256 tokenId, uint96 price) external nonReentrant {
        if (!allowedCollection[collection]) revert CollectionNotAllowed();
        if (price == 0) revert ZeroPrice();
        listings[collection][tokenId] = Listing(msg.sender, price);
        IERC721(collection).transferFrom(msg.sender, address(this), tokenId);
        emit Listed(collection, tokenId, msg.sender, price);
    }

    function cancel(address collection, uint256 tokenId) external nonReentrant {
        Listing memory l = listings[collection][tokenId];
        if (l.seller == address(0)) revert NotListed();
        if (l.seller != msg.sender) revert NotSeller();
        delete listings[collection][tokenId];
        IERC721(collection).transferFrom(address(this), msg.sender, tokenId);
        emit Cancelled(collection, tokenId);
    }

    function buy(address collection, uint256 tokenId) external nonReentrant {
        Listing memory l = listings[collection][tokenId];
        if (l.seller == address(0)) revert NotListed();
        delete listings[collection][tokenId];
        uint256 fee = (uint256(l.price) * feeBps) / 10_000;
        pearl.transferFrom(msg.sender, l.seller, l.price - fee);
        if (fee > 0) {
            pearl.transferFrom(msg.sender, address(this), fee);
            pearl.burn(fee);
        }
        IERC721(collection).transferFrom(address(this), msg.sender, tokenId);
        emit Sold(collection, tokenId, l.seller, msg.sender, l.price);
    }
}
