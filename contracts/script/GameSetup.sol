// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {PearlToken} from "../src/PearlToken.sol";
import {FishNFT} from "../src/FishNFT.sol";
import {FishingGame, IBottlePool} from "../src/FishingGame.sol";
import {BottlePool} from "../src/BottlePool.sol";
import {Marketplace} from "../src/Marketplace.sol";
import {GameLens} from "../src/GameLens.sol";
import {Tournaments} from "../src/Tournaments.sol";
import {FightVerifier, IFightVerifier} from "../src/FightVerifier.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {TransparentUpgradeableProxy} from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";

/// @notice Deploys and seeds the whole game. Shared by the deploy script and the tests so both use the same catalog.
///         The numbers mirror the web client's catalog (web/src/game/content.ts and web/src/tackle/catalog.ts);
///         the client compares the two at start-up and warns on a mismatch.
/// @dev Must be called by (or on behalf of) `owner`, which ends up owning every contract.
library GameSetup {
    struct Deployment {
        PearlToken pearl;
        FishNFT fish;
        FishingGame game;
        Marketplace market;
        GameLens lens;
        BottlePool bottles;
    }

    // the BLEND bottle: the prize, the level it asks for and how many all players together can find in a UTC day
    uint96 internal constant BOTTLE_AMOUNT = uint96(1_000 * E);
    uint8 internal constant BOTTLE_MIN_LEVEL = 5;
    uint8 internal constant BOTTLE_DAILY_MAX = 2;

    uint256 internal constant E = 1e18;

    // location bit masks
    uint16 internal constant POND = 1 << 0;
    uint16 internal constant RIVER = 1 << 1;
    uint16 internal constant LAKE = 1 << 2;
    uint16 internal constant SEA = 1 << 3;
    uint16 internal constant RAPIDS = 1 << 4;
    uint16 internal constant GOLDEN = 1 << 5;
    uint16 internal constant SWAMP = 1 << 6;
    uint16 internal constant PHANTOM = 1 << 7;
    uint16 internal constant MOVING = RIVER | RAPIDS;
    uint16 internal constant DEEP = LAKE | SEA | PHANTOM;

    function defaultConfig() internal pure returns (FishingGame.Config memory) {
        return FishingGame.Config({
            maxEnergy: 20,
            energyRegenSeconds: 2 minutes,
            revealDelay: 2,
            baseBiteBps: 6_500,
            maxBiteBps: 9_500,
            maxRarityBonus: 300,
            maxWeightBonus: 60,
            repairShareBps: 150,
            energyRefillPrice: uint96(100 * E),
            refillPriceGrowthBps: 20_000,
            emissionSoftCap: 0,
            qualityPerCatch: 150,
            qualityPerRarity: 300,
            blendAmount: 0, // not used: the prize is BottlePool.amount
            blendChancePpm: 1_000,
            blendMaxWins: 1
        });
    }

    /// @param blend the token in the bottles
    function deploy(address owner, IERC20 blend) internal returns (Deployment memory d) {
        d.pearl = new PearlToken(owner);
        d.fish = new FishNFT(owner);
        d.market = new Marketplace(owner, d.pearl, 500);
        d.market.setCollection(address(d.fish), true);
        _seedSpecies(d.fish);
        (d.game, d.lens, d.bottles) = deployGame(owner, d.pearl, d.fish, blend);
    }

    /// @notice Puts `implementation` behind an upgradeable proxy and runs `init` on it. The proxy's address and state
    ///         are permanent; `owner` can later point it at new code through the proxy's ProxyAdmin.
    function proxied(address implementation, address owner, bytes memory init) internal returns (address) {
        return address(new TransparentUpgradeableProxy(implementation, owner, init));
    }

    /// @notice A fresh, fully seeded game (and its lens) on top of existing PEARL and fish contracts.
    ///         The game sits behind a proxy: later versions are upgrades of it (script/Upgrade.s.sol), not new
    ///         deployments, so player progress is kept. The bottle pool starts empty: send it BLEND to switch the
    ///         bottles on.
    function deployGame(address owner, PearlToken pearl, FishNFT fish, IERC20 blend)
        internal
        returns (FishingGame game, GameLens lens, BottlePool bottles)
    {
        bottles = new BottlePool(owner, blend, BOTTLE_AMOUNT, BOTTLE_MIN_LEVEL, BOTTLE_DAILY_MAX);
        game = FishingGame(
            proxied(
                address(new FishingGame(pearl, fish, IBottlePool(address(bottles)))),
                owner,
                abi.encodeCall(FishingGame.initialize, (owner))
            )
        );
        bottles.setGame(address(game));
        game.setConfig(defaultConfig());
        lens = new GameLens(game);
        pearl.setMinter(address(game), true);
        fish.setGame(address(game));
        _seedTackle(game);
        _seedSpecials(game);
        _seedLocations(game);
        _seedAchievements(game);
        game.setHidden(14, true); // Lake Spirit
        game.setHidden(34, true); // Spectral Sturgeon
        game.setHidden(35, true); // Albino Pike
    }

    /// @notice The tournaments, behind their own proxy, with the Solidity fight verifier. `blend` pays the prizes.
    function deployTournaments(address owner, FishingGame game, FishNFT fish, IERC20 blend)
        internal
        returns (Tournaments tournaments, FightVerifier verifier)
    {
        verifier = new FightVerifier();
        tournaments = Tournaments(
            proxied(
                address(new Tournaments(game, fish, blend)),
                owner,
                abi.encodeCall(Tournaments.initialize, (owner, IFightVerifier(address(verifier))))
            )
        );
    }

    function _sp(FishNFT f, string memory name, uint8 rarity, uint32 minW, uint32 maxW, uint256 price, uint24 color)
        private
    {
        f.addSpecies(FishNFT.Species(name, rarity, minW, maxW, uint96(price * E), color));
    }

    function _seedSpecies(FishNFT f) private {
        _sp(f, "Roach", 0, 50, 450, 9, 0x9fb3c8); //             0
        _sp(f, "Crucian Carp", 0, 100, 900, 12, 0xc9a227); //    1
        _sp(f, "Perch", 0, 60, 700, 10, 0x6b8e23); //            2
        _sp(f, "Tench", 1, 300, 2500, 30, 0x556b2f); //          3
        _sp(f, "Golden Carp", 3, 1000, 6000, 300, 0xffd700); //  4
        _sp(f, "Pike", 1, 1000, 12000, 20, 0x3c6e47); //         5
        _sp(f, "Trout", 1, 300, 4000, 20, 0xd98c8c); //          6
        _sp(f, "Zander", 2, 1000, 9000, 50, 0x8a9a5b); //        7
        _sp(f, "Grayling", 2, 200, 1500, 45, 0x7d6fa8); //       8
        _sp(f, "Taimen", 4, 8000, 50000, 1200, 0xb5523b); //     9
        _sp(f, "Bream", 0, 500, 4000, 12, 0xa89060); //         10
        _sp(f, "Burbot", 1, 500, 5000, 26, 0x5d4e37); //        11
        _sp(f, "Whitefish", 2, 300, 3000, 60, 0xdfe6ee); //     12
        _sp(f, "Wels Catfish", 3, 5000, 90000, 220, 0x3b3b3b); // 13
        _sp(f, "Lake Spirit", 4, 3000, 30000, 1200, 0x7fffd4); // 14
        _sp(f, "Herring", 0, 100, 700, 18, 0x9ab0c2); //        15
        _sp(f, "Cod", 1, 1000, 20000, 54, 0x8b7d6b); //         16
        _sp(f, "Atlantic Salmon", 2, 2000, 20000, 150, 0xfa8072); // 17
        _sp(f, "Halibut", 3, 5000, 150000, 400, 0x6e6157); //   18
        _sp(f, "Bluefin Tuna", 4, 50000, 400000, 3000, 0x1e3f66); // 19
        _sp(f, "Golden Koi", 4, 800, 6000, 1500, 0xf2b632); //  20
        _sp(f, "Ancient Catfish", 4, 20000, 120000, 2000, 0x4a4032); // 21
        _sp(f, "Ghost Fish", 5, 1000, 9000, 5000, 0xcfe8ff); // 22
        _sp(f, "Gilded Rudd", 0, 80, 600, 14, 0xd9a441); //     23
        _sp(f, "Mirror Carp", 1, 1500, 12000, 30, 0xb08d57); // 24
        _sp(f, "Sun Perch", 2, 200, 1800, 70, 0xe8a23a); //     25
        _sp(f, "Amber Sturgeon", 3, 8000, 60000, 300, 0xc47a2c); // 26
        _sp(f, "Bowfin", 0, 500, 4000, 30, 0x5b6b3a); //        27
        _sp(f, "Snakehead", 1, 800, 7000, 60, 0x4f5d3a); //     28
        _sp(f, "Swamp Eel", 2, 300, 3500, 130, 0x3d4a3a); //    29
        _sp(f, "Alligator Gar", 3, 10000, 100000, 450, 0x6b7a4a); // 30
        _sp(f, "Moon Eel", 1, 400, 3000, 90, 0x9fb8e0); //      31
        _sp(f, "Lantern Pike", 2, 1500, 14000, 180, 0x7fd4c9); // 32
        _sp(f, "Wraith Salmon", 3, 3000, 22000, 500, 0xb9a6e8); // 33
        _sp(f, "Spectral Sturgeon", 4, 20000, 150000, 2500, 0xe6e9ff); // 34
        _sp(f, "Albino Pike", 3, 1500, 13000, 250, 0xf0ece0); // 35
    }

    function _fx(uint16 mask, int8 c, uint16 r, uint8 w) private pure returns (FishingGame.Effect memory) {
        return FishingGame.Effect(mask, c, r, w);
    }

    function _item(
        uint256 price,
        uint16 wear,
        int8 c,
        uint16 r,
        uint8 w,
        uint16 repairBps,
        FishingGame.Effect memory a,
        FishingGame.Effect memory b
    ) private pure returns (FishingGame.Item memory) {
        return FishingGame.Item(uint96(price * E), wear, c, r, w, repairBps, a, b);
    }

    /// @notice Rod prices in whole PEARL, by rod id. The first rod is a first-day purchase, every later one a goal
    ///         of days or weeks (web/BALANCE.md, "Progression in days"). Also what script/Economy.s.sol sets on a
    ///         game that is already deployed.
    function rodPrices() internal pure returns (uint256[6] memory) {
        return [uint256(0), 1_500, 4_000, 12_000, 30_000, 150_000];
    }

    /// @notice Lure prices in whole PEARL, by lure id.
    function lurePrices() internal pure returns (uint256[6] memory) {
        return [uint256(100), 150, 400, 500, 900, 3_000];
    }

    function _seedTackle(FishingGame g) private {
        FishingGame.Effect memory none = _fx(0, 0, 0, 0);
        uint256[6] memory rod = rodPrices();
        uint256[6] memory lure = lurePrices();
        // rods: price, durability, catch, rarity, weight, repair factor, location effects
        g.addRod(_item(rod[0], 0, 0, 0, 0, 10_000, none, none)); //                              0 Willow Rod
        g.addRod(_item(rod[1], 80, 6, 20, 0, 10_000, _fx(POND | RIVER, 3, 15, 0), none)); //     1 Carbon Spinner
        g.addRod(_item(rod[2], 160, 2, 0, 5, 7_000, _fx(GOLDEN | SWAMP, 3, 0, 12), none)); //    2 Ironwood Rod
        // the fly rod loses 4 catch away from moving water
        g.addRod(_item(rod[3], 70, 0, 40, 0, 10_000, _fx(MOVING, 4, 60, 10), _fx(~MOVING & 0xff, -4, 0, 0))); // 3 Taiga Fly Rod
        g.addRod(_item(rod[4], 50, 2, 0, 8, 10_000, _fx(DEEP, 5, 30, 12), none)); //             4 Deep Troller
        g.addRod(_item(rod[5], 120, 4, 50, 6, 10_000, none, none)); //                           5 Pearl Master
        // lures: price, casts, catch, rarity, weight
        g.addLure(_item(lure[0], 80, 5, 0, 0, 10_000, _fx(LAKE, 2, 0, 0), none)); //             0 Silver Spoon
        g.addLure(_item(lure[1], 60, 3, 15, 0, 10_000, _fx(RIVER, 3, 20, 0), none)); //          1 Copper Spinner
        g.addLure(_item(lure[2], 50, 0, 40, 0, 10_000, _fx(MOVING, 4, 70, 0), none)); //         2 Feather Fly
        g.addLure(_item(lure[3], 50, 2, 0, 0, 10_000, _fx(DEEP, 8, 15, 0), none)); //            3 Glow Jig
        g.addLure(_item(lure[4], 40, 0, 0, 15, 10_000, _fx(POND | GOLDEN | SWAMP, 5, 0, 0), none)); // 4 Topwater Popper
        g.addLure(_item(lure[5], 25, 0, 150, 10, 10_000, none, none)); //                        5 Abyss Spoon
    }

    function _seedSpecials(FishingGame g) private {
        // species, chance ppm, pity, bonus mask, catch, rarity, weight, hidden multiplier
        g.addSpecial(FishingGame.Special(20, 12_000, 120, GOLDEN, 0, 25, 0, 1)); // 0 Golden Koi: +25 rarity at Golden Lake
        g.addSpecial(FishingGame.Special(21, 8_000, 160, 0, 0, 0, 8, 1)); //       1 Ancient Catfish: +8% weight
        g.addSpecial(FishingGame.Special(22, 5_000, 220, 0, 0, 0, 0, 3)); //       2 Ghost Fish: hidden species ×3
    }

    function _arr(uint16 a, uint16 b, uint16 c, uint16 d, uint16 e) private pure returns (uint16[] memory r) {
        r = new uint16[](5);
        (r[0], r[1], r[2], r[3], r[4]) = (a, b, c, d, e);
    }

    function _loc(
        FishingGame g,
        uint8 energy,
        uint8 unlockType,
        uint16 unlockArg,
        uint8 special,
        uint16[] memory ids,
        uint16[] memory weights
    ) private {
        g.addLocation(FishingGame.Location(energy, unlockType, unlockArg, special, true, ids, weights));
    }

    function _seedLocations(FishingGame g) private {
        // energy, unlock (0 open, 1 level, 2 species, 3 special id), special here (id + 1), pool, weights
        _loc(g, 1, 0, 0, 1, _arr(0, 1, 2, 3, 4), _arr(400, 350, 300, 100, 8)); //        0 Village Pond
        uint16[] memory ids = new uint16[](6);
        uint16[] memory w = new uint16[](6);
        (ids[0], ids[1], ids[2], ids[3], ids[4], ids[5]) = (2, 5, 6, 7, 8, 35);
        (w[0], w[1], w[2], w[3], w[4], w[5]) = (300, 250, 250, 80, 70, 6);
        _loc(g, 1, 1, 3, 1, ids, w); //                                                  1 Forest River
        _loc(g, 2, 2, 8, 2, _arr(10, 11, 12, 13, 14), _arr(400, 250, 120, 30, 5)); //    2 Deep Lake
        _loc(g, 3, 1, 8, 3, _arr(15, 16, 17, 18, 19), _arr(400, 300, 120, 30, 4)); //    3 Northern Sea
        _loc(g, 4, 1, 12, 3, _arr(9, 7, 13, 18, 4), _arr(10, 200, 100, 60, 40)); //      4 Taimen Rapids
        _loc(g, 2, 3, 0, 2, _arr(23, 24, 25, 26, 4), _arr(400, 300, 150, 40, 60)); //    5 Golden Lake
        _loc(g, 3, 3, 1, 3, _arr(27, 28, 29, 30, 13), _arr(400, 300, 140, 40, 80)); //   6 Ancient Swamp
        _loc(g, 4, 3, 2, 0, _arr(31, 32, 33, 14, 34), _arr(380, 250, 80, 20, 5)); //     7 Phantom Waters
    }

    function _seedAchievements(FishingGame g) private {
        uint16[8] memory locRewards = [uint16(150), 300, 600, 1200, 2500, 1500, 2500, 5000];
        for (uint16 i; i < 8; i++) {
            g.addAchievement(FishingGame.Achievement(0, i, uint96(locRewards[i] * E))); // 0–7 location collections
        }
        g.addAchievement(FishingGame.Achievement(1, 10, uint96(300 * E))); //   8 discover 10 species
        g.addAchievement(FishingGame.Achievement(1, 20, uint96(1000 * E))); //  9 discover 20
        g.addAchievement(FishingGame.Achievement(1, 30, uint96(3000 * E))); // 10 discover 30
        g.addAchievement(FishingGame.Achievement(2, 1, uint96(500 * E))); //   11 a legendary or mythic species
        g.addAchievement(FishingGame.Achievement(2, 7, uint96(10000 * E))); // 12 all seven of them
        g.addAchievement(FishingGame.Achievement(3, 3, uint96(3000 * E))); //  13 all three special fish
    }
}
