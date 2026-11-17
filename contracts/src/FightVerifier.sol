// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Replays a fight from the player's recorded input. Kept behind an interface so the replay can be swapped
///         for another implementation (for example a Rust contract on Fluent) without touching the tournaments.
interface IFightVerifier {
    /// @param seed       randomness of the fight: decides when the fish jerks and how hard
    /// @param difficulty 0 (a pond roach) … 5 (a legend in white water)
    /// @param green      width of the green band of the tension gauge, in gauge units (100_000 = the whole gauge)
    /// @param inputs     one bit per tick (50 ms), least significant bit first: 1 = the player was reeling
    /// @return landed whether the fish reached the pier
    /// @return ticks  how long the fight lasted
    /// @return good   ticks spent with the tension in the green
    function replay(uint256 seed, uint256 difficulty, uint256 green, bytes calldata inputs)
        external
        view
        returns (bool landed, uint256 ticks, uint256 good);
}

/// @title The reel fight, in integers.
/// @notice One gauge: line tension. Reeling raises it, letting go lowers it. In the green band the fish comes
///         closer; slack and it swims away; at the top the line snaps. Every so often the fish jerks: a short
///         warning, then a burst that drives the tension up by itself. The web client runs exactly this code
///         (web/src/game/fight.ts) tick by tick while the player plays, records the input and submits it; this
///         contract plays the recording back and reports what really happened.
/// @dev The seed is public once its block exists, so a program can compute a perfect recording. The replay proves
///      that the input produces the result, not that a person produced the input.
contract FightVerifier is IFightVerifier {
    uint256 internal constant U = 100_000; // the whole gauge, and the whole distance to the horizon
    uint256 internal constant MAX_TICKS = 1_200; // 60 seconds
    uint256 internal constant RISE = 2_500; // tension per tick while reeling
    uint256 internal constant FALL = 4_000; // tension per tick while released
    uint256 internal constant GREEN_CENTRE = 56_000;
    uint256 internal constant MAX_GREEN = 62_000;
    uint256 internal constant START_TENSION = 25_000;
    uint256 internal constant START_DIST = 70_000;

    // phases of the fish
    uint256 internal constant CALM = 0;
    uint256 internal constant WARN = 1;
    uint256 internal constant PULL = 2;

    struct Params {
        uint256 lo; // green band
        uint256 hi;
        uint256 reel; // distance per tick while the line is tight
        uint256 drift; // distance the fish gains per tick while it is slack
        uint256 surge; // extra tension per tick during a jerk of power 1000
        uint256 tell; // ticks of warning
        uint256 calmLo; // ticks of calm between jerks
        uint256 calmHi;
        uint256 pullLo; // ticks a jerk lasts
        uint256 pullHi;
    }

    function params(uint256 d, uint256 green) public pure returns (Params memory p) {
        if (d > 5) d = 5;
        if (green > MAX_GREEN) green = MAX_GREEN;
        p.lo = GREEN_CENTRE - green / 2;
        p.hi = GREEN_CENTRE + green / 2;
        p.reel = [uint256(700), 640, 590, 540, 500, 470][d];
        p.drift = [uint256(250), 325, 400, 475, 550, 625][d];
        p.surge = [uint256(2_500), 2_800, 3_100, 3_350, 3_550, 3_750][d];
        p.tell = [uint256(10), 9, 8, 8, 7, 6][d];
        p.calmLo = [uint256(52), 44, 38, 32, 26, 22][d];
        p.calmHi = [uint256(80), 70, 60, 52, 44, 38][d];
        p.pullLo = [uint256(7), 8, 10, 12, 13, 15][d];
        p.pullHi = [uint256(12), 15, 18, 21, 24, 27][d];
    }

    /// @dev xorshift32
    function _next(uint256 x) internal pure returns (uint256) {
        x ^= (x << 13) & 0xffffffff;
        x ^= x >> 17;
        x ^= (x << 5) & 0xffffffff;
        return x;
    }

    function replay(uint256 seed, uint256 difficulty, uint256 green, bytes calldata inputs)
        external
        pure
        returns (bool landed, uint256 ticks, uint256 good)
    {
        Params memory p = params(difficulty, green);
        uint256 rng = seed >> 224;
        if (rng == 0) rng = 1;
        uint256 tension = START_TENSION;
        uint256 dist = START_DIST;
        uint256 mood = CALM;
        uint256 power = 1_000;
        rng = _next(rng);
        uint256 next = 30 + (rng % 17);
        uint256 n = inputs.length * 8;
        if (n > MAX_TICKS) n = MAX_TICKS;

        for (uint256 i; i < n; i++) {
            ticks = i + 1;
            if (ticks >= next) {
                rng = _next(rng);
                if (mood == CALM) {
                    mood = WARN;
                    power = 600 + (rng % 1_001);
                    next = ticks + p.tell;
                } else if (mood == WARN) {
                    mood = PULL;
                    next = ticks + p.pullLo + (rng % (p.pullHi - p.pullLo + 1));
                } else {
                    mood = CALM;
                    next = ticks + p.calmLo + (rng % (p.calmHi - p.calmLo + 1));
                }
            }
            bool hold = (uint8(inputs[i >> 3]) >> (i & 7)) & 1 == 1;
            uint256 up = (hold ? RISE : 0) + (mood == PULL ? (p.surge * power) / 1_000 : 0);
            uint256 down = hold ? 0 : FALL;
            tension = tension + up > down ? tension + up - down : 0;
            if (tension >= U) return (false, ticks, good); // the line snapped

            if (tension < p.lo) {
                dist += mood == PULL ? p.drift * 2 : p.drift;
                if (dist >= U) return (false, ticks, good); // it swam away
            } else {
                if (tension <= p.hi) good++;
                if (dist <= p.reel) return (true, ticks, good);
                dist -= p.reel;
            }
        }
        return (false, ticks, good); // the recording ends with the fish still in the water
    }
}
