// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {PearlToken} from "../src/PearlToken.sol";
import {FishNFT} from "../src/FishNFT.sol";
import {RodNFT} from "../src/RodNFT.sol";
import {FishingGame} from "../src/FishingGame.sol";
import {Marketplace} from "../src/Marketplace.sol";

/// @notice Deploys and seeds the whole game. Shared by the deploy script and the tests so both use the same catalog.
/// @dev Must be called by (or on behalf of) `owner`, which ends up owning every contract.
library GameSetup {
    struct Deployment {
        PearlToken pearl;
        FishNFT fish;
        RodNFT rod;
        FishingGame game;
        Marketplace market;
    }

    uint256 internal constant E = 1e18;

    function defaultConfig() internal pure returns (FishingGame.Config memory) {
        return FishingGame.Config({
            maxEnergy: 20,
            energyRegenSeconds: 15 minutes,
            revealDelay: 2,
            maxRodLevel: 5,
            baseCatchBps: 5_500,
            catchBpsPerLevel: 700,
            maxCatchBps: 9_500,
            rarityBoostPerLevel: 35,
            starterDurability: 60,
            durabilityPerLevel: 30,
            energyRefillPrice: uint96(12 * E),
            rodPrice: uint96(25 * E),
            repairPricePerPoint: uint96(E / 10),
            emissionSoftCap: 0
        });
    }

    function deploy(address owner) internal returns (Deployment memory d) {
        d.pearl = new PearlToken(owner);
        d.fish = new FishNFT(owner);
        d.rod = new RodNFT(owner);
        d.game = new FishingGame(owner, d.pearl, d.fish, d.rod, defaultConfig());
        d.market = new Marketplace(owner, d.pearl, 500);

        d.pearl.setMinter(address(d.game), true);
        d.fish.setGame(address(d.game));
        d.rod.setGame(address(d.game));
        d.market.setCollection(address(d.fish), true);
        d.market.setCollection(address(d.rod), true);

        _seedSpecies(d.fish);
        _seedSpots(d.game);
        _seedBaits(d.game);

        uint96[] memory up = new uint96[](4);
        up[0] = uint96(60 * E);
        up[1] = uint96(220 * E);
        up[2] = uint96(700 * E);
        up[3] = uint96(2000 * E);
        d.game.setUpgradePrices(up);
    }

    function _sp(FishNFT f, string memory name, uint8 rarity, uint32 minW, uint32 maxW, uint256 price, uint24 color)
        private
    {
        f.addSpecies(FishNFT.Species(name, rarity, minW, maxW, uint96(price), color));
    }

    function _seedSpecies(FishNFT f) private {
        // Village Pond
        _sp(f, "Roach", 0, 50, 450, E / 2, 0x9fb3c8); //                 0
        _sp(f, "Crucian Carp", 0, 100, 900, E * 7 / 10, 0xc9a227); //    1
        _sp(f, "Perch", 0, 60, 700, E * 6 / 10, 0x6b8e23); //            2
        _sp(f, "Tench", 1, 300, 2500, 2 * E, 0x556b2f); //               3
        _sp(f, "Golden Carp", 3, 1000, 6000, 25 * E, 0xffd700); //       4
        // Forest River
        _sp(f, "Pike", 1, 1000, 12000, 3 * E, 0x3c6e47); //              5
        _sp(f, "Trout", 1, 300, 4000, 3 * E, 0xd98c8c); //               6
        _sp(f, "Zander", 2, 1000, 9000, 8 * E, 0x8a9a5b); //             7
        _sp(f, "Grayling", 2, 200, 1500, 7 * E, 0x7d6fa8); //            8
        _sp(f, "Taimen", 4, 8000, 50000, 120 * E, 0xb5523b); //          9
        // Deep Lake
        _sp(f, "Bream", 0, 500, 4000, 2 * E, 0xa89060); //               10
        _sp(f, "Burbot", 1, 500, 5000, 5 * E, 0x5d4e37); //              11
        _sp(f, "Whitefish", 2, 300, 3000, 12 * E, 0xdfe6ee); //          12
        _sp(f, "Wels Catfish", 3, 5000, 90000, 45 * E, 0x3b3b3b); //     13
        _sp(f, "Lake Spirit", 4, 3000, 30000, 250 * E, 0x7fffd4); //     14
        // Northern Sea
        _sp(f, "Herring", 0, 100, 700, 3 * E, 0x9ab0c2); //              15
        _sp(f, "Cod", 1, 1000, 20000, 9 * E, 0x8b7d6b); //               16
        _sp(f, "Atlantic Salmon", 2, 2000, 20000, 25 * E, 0xfa8072); //  17
        _sp(f, "Halibut", 3, 5000, 150000, 70 * E, 0x6e6157); //         18
        _sp(f, "Bluefin Tuna", 4, 50000, 400000, 500 * E, 0x1e3f66); //  19
    }

    function _table(uint16[5] memory ids, uint16[5] memory w)
        private
        pure
        returns (uint16[] memory a, uint16[] memory b)
    {
        a = new uint16[](5);
        b = new uint16[](5);
        for (uint256 i; i < 5; i++) {
            a[i] = ids[i];
            b[i] = w[i];
        }
    }

    function _seedSpots(FishingGame g) private {
        (uint16[] memory a, uint16[] memory b) = _table([uint16(0), 1, 2, 3, 4], [uint16(400), 350, 300, 100, 8]);
        g.addSpot("Village Pond", 1, 1, a, b);
        (a, b) = _table([uint16(2), 5, 6, 7, 8], [uint16(300), 250, 250, 80, 70]);
        g.addSpot("Forest River", 2, 1, a, b);
        (a, b) = _table([uint16(10), 11, 12, 13, 14], [uint16(400), 250, 120, 30, 5]);
        g.addSpot("Deep Lake", 3, 2, a, b);
        (a, b) = _table([uint16(15), 16, 17, 18, 19], [uint16(400), 300, 120, 30, 4]);
        g.addSpot("Northern Sea", 4, 3, a, b);
        (a, b) = _table([uint16(9), 7, 13, 18, 4], [uint16(10), 200, 100, 60, 40]);
        g.addSpot("Taimen Rapids", 5, 4, a, b);
    }

    function _seedBaits(FishingGame g) private {
        g.addBait(FishingGame.Bait("Worm", uint96(E / 2), 1_500, 0));
        g.addBait(FishingGame.Bait("Shiny Lure", uint96(3 * E), 500, 60));
        g.addBait(FishingGame.Bait("Golden Fly", uint96(12 * E), 2_000, 150));
    }
}
