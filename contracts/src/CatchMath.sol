// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title The arithmetic of a catch: weight, quality, points, levels.
/// @notice Shared by the game and the tournaments so a fish is worth the same in both. Pure functions only.
library CatchMath {
    /// @dev min of two uniforms: small fish are common, trophies are rare. The bonus (percent) scales the roll,
    ///      capped at the species maximum.
    function rollWeight(uint32 minW, uint32 maxW, uint256 bonus, uint256 rnd) internal pure returns (uint32) {
        uint256 u1 = rnd & 0xffffffff;
        uint256 u2 = (rnd >> 32) & 0xffffffff;
        uint256 u = u1 < u2 ? u1 : u2;
        uint256 w = ((minW + ((uint256(maxW - minW) * u) >> 32)) * (100 + bonus)) / 100;
        return uint32(w > maxW ? maxW : w);
    }

    /// @dev 0 D … 4 S. A better rod shifts the roll (0..9999) up, a rarer fish shifts it down.
    function rollQuality(int256 rodCatch, uint256 rarity, uint256 roll, uint256 perCatch, uint256 perRarity)
        internal
        pure
        returns (uint8)
    {
        int256 x = int256(roll) + rodCatch * int256(perCatch) - int256(rarity * perRarity);
        if (x < 1_500) return 0;
        if (x < 4_500) return 1;
        if (x < 7_500) return 2;
        if (x < 9_200) return 3;
        return 4;
    }

    function qualityBps(uint256 q) internal pure returns (uint256) {
        if (q == 0) return 8_000;
        if (q == 1) return 9_000;
        if (q == 2) return 10_000;
        if (q == 3) return 11_500;
        return 13_000;
    }

    /// @dev weight / species mean, in bps. The mean of min(u1,u2) is a third of the way up the range.
    function weightRatioBps(uint256 minW, uint256 maxW, uint256 weight) internal pure returns (uint256) {
        return (weight * 10_000) / (minW + (maxW - minW) / 3);
    }

    function clamp(uint256 v, uint256 lo, uint256 hi) internal pure returns (uint256) {
        return v < lo ? lo : v > hi ? hi : v;
    }

    /// @notice Points of a catch = rarity points × weight factor (0.7–1.5) × quality factor.
    function score(uint256 rarity, uint256 minW, uint256 maxW, uint256 weight, uint256 quality)
        internal
        pure
        returns (uint256)
    {
        uint256[6] memory points = [uint256(10), 25, 60, 150, 400, 800];
        uint256 raw = points[rarity] * clamp(weightRatioBps(minW, maxW, weight), 7_000, 15_000) * qualityBps(quality);
        return (raw + 5e7) / 1e8;
    }

    /// @notice Level n needs 50·n·(n−1) XP.
    function levelOf(uint256 xp) internal pure returns (uint256 level) {
        level = 1;
        while (50 * (level + 1) * level <= xp) level++;
    }
}
