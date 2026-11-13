// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {FishNFT} from "./FishNFT.sol";
import {FishingGame} from "./FishingGame.sol";

/// @title Read-only helper: batches the game's views so a client needs a handful of calls, not hundreds.
/// @notice Holds no state and no permissions. It can be redeployed at any time.
contract GameLens {
    FishingGame public immutable game;
    FishNFT public immutable fishNft;

    /// @dev Everything a client needs about one player, in one call.
    struct PlayerView {
        FishingGame.Player p;
        uint256 energyNow;
        uint256 refillPrice;
        uint256 pearl;
        uint256 blendWon;
        uint256 week;
        uint256 timestamp;
        uint256 blockNumber;
        uint16[] rodDurability;
        uint256[] repairCost;
        uint32[] lureCasts;
        uint16[] dry;
        uint256[] specialsHeld;
        bool[] achievementDone;
        FishingGame.Cast cast;
        FishingGame.Record best;
        FishingGame.Record[] bestByLocation;
        FishingGame.DexEntry[] dex;
        FishingGame.WeekEntry[] weekEntries;
    }

    struct Catalog {
        FishingGame.Item[] rods;
        FishingGame.Item[] lures;
        FishingGame.Location[] locations;
        FishingGame.Special[] specials;
        FishingGame.Achievement[] achievements;
        FishNFT.Species[] species;
        bool[] hidden;
    }

    constructor(FishingGame game_) {
        game = game_;
        fishNft = game_.fishNft();
    }

    function catalog() external view returns (Catalog memory c) {
        uint256 n = game.rodCount();
        c.rods = new FishingGame.Item[](n);
        for (uint256 i; i < n; i++) c.rods[i] = game.rodItem(i);
        n = game.lureCount();
        c.lures = new FishingGame.Item[](n);
        for (uint256 i; i < n; i++) c.lures[i] = game.lureItem(i);
        n = game.locationCount();
        c.locations = new FishingGame.Location[](n);
        for (uint256 i; i < n; i++) c.locations[i] = game.location(i);
        n = game.specialCount();
        c.specials = new FishingGame.Special[](n);
        for (uint256 i; i < n; i++) c.specials[i] = game.specialInfo(i);
        n = game.achievementCount();
        c.achievements = new FishingGame.Achievement[](n);
        for (uint256 i; i < n; i++) c.achievements[i] = game.achievement(i);
        n = fishNft.speciesCount();
        c.species = new FishNFT.Species[](n);
        c.hidden = new bool[](n);
        for (uint256 i; i < n; i++) {
            c.species[i] = fishNft.species(i);
            c.hidden[i] = game.hiddenSpecies(i);
        }
    }

    function playerView(address who) external view returns (PlayerView memory v) {
        v.p = game.playerOf(who);
        v.energyNow = game.currentEnergy(who);
        v.refillPrice = game.refillPrice(who);
        v.pearl = game.pearl().balanceOf(who);
        v.blendWon = game.blendWon(who);
        v.week = game.currentWeek();
        v.timestamp = block.timestamp;
        v.blockNumber = block.number;
        v.cast = game.castOf(who);
        (v.best.speciesId, v.best.weight, v.best.at) = game.bestCatch(who);
        v.weekEntries = game.weekEntries(v.week, who);

        uint256 n = game.rodCount();
        v.rodDurability = new uint16[](n);
        v.repairCost = new uint256[](n);
        for (uint256 i; i < n; i++) {
            v.rodDurability[i] = game.rodDurability(who, i);
            v.repairCost[i] = game.repairCost(who, i);
        }
        n = game.lureCount();
        v.lureCasts = new uint32[](n);
        for (uint256 i; i < n; i++) v.lureCasts[i] = game.lureCasts(who, i);
        n = game.specialCount();
        v.dry = new uint16[](n);
        v.specialsHeld = new uint256[](n);
        for (uint256 i; i < n; i++) {
            v.dry[i] = game.dryCatches(who, i);
            v.specialsHeld[i] = fishNft.heldOf(who, game.specialInfo(i).speciesId);
        }
        n = game.locationCount();
        v.bestByLocation = new FishingGame.Record[](n);
        for (uint256 i; i < n; i++) {
            (v.bestByLocation[i].speciesId, v.bestByLocation[i].weight, v.bestByLocation[i].at) = game.bestAt(who, i);
        }
        n = game.achievementCount();
        v.achievementDone = new bool[](n);
        for (uint256 i; i < n; i++) v.achievementDone[i] = game.achievementDone(who, i);
        n = fishNft.speciesCount();
        v.dex = new FishingGame.DexEntry[](n);
        for (uint256 i; i < n; i++) (v.dex[i].count, v.dex[i].best) = game.dex(who, i);
    }

    /// @notice The player's fish with what each would sell for right now.
    function keepnet(address who)
        external
        view
        returns (uint256[] memory ids, FishNFT.Fish[] memory list, uint256[] memory values)
    {
        (ids, list) = fishNft.fishOf(who);
        values = new uint256[](ids.length);
        for (uint256 i; i < ids.length; i++) values[i] = game.quoteSell(ids[i]);
    }

    /// @notice A page of a week's anglers with their totals, unsorted (clients sort).
    function weekStandings(uint256 week, uint256 offset, uint256 limit)
        external
        view
        returns (address[] memory anglers, uint32[] memory totals)
    {
        uint256 count = game.weekPlayerCount(week);
        uint256 end = offset + limit > count ? count : offset + limit;
        uint256 n = end > offset ? end - offset : 0;
        anglers = new address[](n);
        totals = new uint32[](n);
        for (uint256 i; i < n; i++) {
            anglers[i] = game.weekPlayer(week, offset + i);
            totals[i] = game.weekTotal(week, anglers[i]);
        }
    }

    /// @notice Past weeks' totals of one player, newest first, for the archive.
    function weekHistory(address who, uint256 weeks_) external view returns (uint256[] memory ids, uint32[] memory totals) {
        uint256 current = game.currentWeek();
        ids = new uint256[](weeks_);
        totals = new uint32[](weeks_);
        for (uint256 i; i < weeks_; i++) {
            ids[i] = current - i - 1;
            totals[i] = game.weekTotal(ids[i], who);
        }
    }
}
