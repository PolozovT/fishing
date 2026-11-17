// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {FishingGame} from "./FishingGame.sol";
import {FishNFT} from "./FishNFT.sol";
import {CatchMath} from "./CatchMath.sol";
import {IFightVerifier} from "./FightVerifier.sol";

/// @title Fishing tournaments: short events with a BLEND prize, where the fight decides the score.
/// @notice Everyone in a tournament fishes the same water with the same tackle and has the same number of casts,
///         so tackle and time spent do not decide it. Every cast hooks a fish; which fish is the luck of the
///         draw (the hash of a future block, as in the game). What the player adds is the fight: the browser
///         records it, `reel` replays the recording (see FightVerifier) and scores the catch by how well it was
///         fought. A fish that gets away scores nothing and the cast is spent.
///
///         Score of a tournament = the sum of the player's best `counted` catches. Ties go to whoever got there
///         first. The top three share the prize 50 / 30 / 20.
///
///         Every tournament is fished with one rod, and only players who own that rod in the game may enter:
///         different tournaments for different rods, equal tackle inside each.
///
///         Tournament catches are points only: no fish NFT, no PEARL, no XP. The game is only read (catalog and
///         who owns which rod).
/// @dev Runs behind a proxy (see GameSetup.proxied): append state variables only. Randomness is a blockhash and
///      the fight seed is public, so a bot can play perfectly: fine for a testnet, not for an open event with
///      real money. Not audited.
contract Tournaments is Ownable {
    using SafeERC20 for IERC20;

    struct Tournament {
        uint40 start;
        uint40 end;
        uint8 locationId;
        uint8 rod; // everyone fishes with it, and must own it in the game to enter
        uint8 lure; // 0 = none, else lure id + 1
        uint8 waterTier; // added to the fish's rarity to get the difficulty of the fight
        uint32 green; // width of the green band of the tension gauge, 100_000 = the whole gauge
        uint16 castLimit;
        uint8 counted; // best catches that make up the score
        bool unused; // storage kept from the first version (an optional rod requirement); do not reuse
        bool reclaimed; // the sponsor took back the shares nobody won
        uint32 players;
        uint96 prize; // BLEND, held by this contract
        address sponsor;
        string name;
    }

    struct Entry {
        bool entered;
        bool claimed;
        uint16 castsUsed;
        uint32 total;
        uint64 seq; // order in which `total` was reached: lower wins a tie
        uint64 targetBlock; // pending cast: the randomness block, 0 = none
        uint32[] best; // best catches, highest first, at most `counted`
    }

    struct NewTournament {
        string name;
        uint40 start;
        uint40 end;
        uint8 locationId;
        uint8 rod;
        uint8 lure;
        uint8 waterTier;
        uint32 green;
        uint16 castLimit;
        uint8 counted;
        uint96 prize;
    }

    uint256 internal constant TOP = 10;
    uint256 internal constant REVEAL_DELAY = 2;
    /// @notice After the tournament ends, fights already hooked may still be reeled in for this long.
    uint256 public constant GRACE = 5 minutes;
    uint256 internal constant QUALITY_PER_CATCH = 150; // as in the game's config
    uint256 internal constant QUALITY_PER_RARITY = 300;

    FishingGame public immutable game;
    FishNFT public immutable fishNft;
    IERC20 public immutable blend;

    IFightVerifier public verifier;
    /// @notice Blocks a player has, counted from the randomness block, to fight the fish and send the recording.
    uint64 public fightBlocks;

    Tournament[] internal _tournaments;
    mapping(uint256 => mapping(address => Entry)) internal _entries;
    mapping(uint256 => address[]) internal _top; // best first, at most TOP
    uint64 internal _seq;

    error BadTournament();
    error NotOpen();
    error NotEntered();
    error AlreadyEntered();
    error RodRequired();
    error OutOfCasts();
    error NoFight();
    error TooEarly();
    error NotOver();
    error NothingToClaim();

    event TournamentCreated(uint256 indexed id, string name, uint40 start, uint40 end, uint96 prize);
    event Entered(uint256 indexed id, address indexed player);
    event TournamentCast(uint256 indexed id, address indexed player, uint16 castNo, uint64 targetBlock);
    /// @param points 0 when the fish got away. @param base what a perfect fight would have scored.
    event TournamentCatch(
        uint256 indexed id,
        address indexed player,
        uint16 speciesId,
        uint32 weight,
        uint8 quality,
        uint32 base,
        uint32 points,
        bool landed,
        uint32 ticks,
        uint32 good,
        uint32 total
    );
    event FightForfeited(uint256 indexed id, address indexed player);
    event PrizeClaimed(uint256 indexed id, address indexed player, uint256 place, uint256 amount);
    event PrizeReclaimed(uint256 indexed id, uint256 amount);

    constructor(FishingGame game_, FishNFT fish_, IERC20 blend_) Ownable(msg.sender) {
        game = game_;
        fishNft = fish_;
        blend = blend_;
        fightBlocks = 1; // the bare implementation can never be initialized
    }

    /// @notice One-time setup, called through the proxy when it is created.
    function initialize(address owner_, IFightVerifier verifier_) external {
        if (fightBlocks != 0) revert BadTournament();
        _transferOwnership(owner_);
        verifier = verifier_;
        fightBlocks = 120;
    }

    function setVerifier(IFightVerifier verifier_) external onlyOwner {
        verifier = verifier_;
    }

    function setFightBlocks(uint64 blocks) external onlyOwner {
        if (blocks < 10 || blocks > 250) revert BadTournament(); // the blockhash must still be readable
        fightBlocks = blocks;
    }

    // ------------------------------------------------------------------ organising

    /// @notice Opens a tournament and takes its prize from the caller (approve BLEND first).
    function create(NewTournament calldata t) external onlyOwner returns (uint256 id) {
        if (
            t.end <= t.start || t.end <= block.timestamp || t.counted == 0 || t.counted > TOP
                || t.castLimit < t.counted || t.green == 0 || t.locationId >= game.locationCount()
                || t.rod >= game.rodCount() || t.lure > game.lureCount()
        ) revert BadTournament();
        id = _tournaments.length;
        Tournament storage n = _tournaments.push();
        n.name = t.name;
        n.start = t.start;
        n.end = t.end;
        n.locationId = t.locationId;
        n.rod = t.rod;
        n.lure = t.lure;
        n.waterTier = t.waterTier;
        n.green = t.green;
        n.castLimit = t.castLimit;
        n.counted = t.counted;
        n.prize = t.prize;
        n.sponsor = msg.sender;
        if (t.prize != 0) blend.safeTransferFrom(msg.sender, address(this), t.prize);
        emit TournamentCreated(id, t.name, t.start, t.end, t.prize);
    }

    // ------------------------------------------------------------------ playing

    /// @notice Free. Possible until the tournament ends; needs the tournament's rod owned in the game
    ///         (everyone owns the first rod).
    function enter(uint256 id) external {
        Tournament storage t = _get(id);
        if (block.timestamp >= t.end) revert NotOpen();
        Entry storage e = _entries[id][msg.sender];
        if (e.entered) revert AlreadyEntered();
        if (!game.ownsRod(msg.sender, t.rod)) revert RodRequired();
        e.entered = true;
        t.players += 1;
        emit Entered(id, msg.sender);
    }

    /// @notice Spends one of the player's casts and commits to a future block. Casting again with a fish still on
    ///         the line lets that fish go: the earlier cast stays spent and scores nothing.
    function cast(uint256 id) external {
        Tournament storage t = _get(id);
        if (block.timestamp < t.start || block.timestamp >= t.end) revert NotOpen();
        Entry storage e = _entries[id][msg.sender];
        if (!e.entered) revert NotEntered();
        if (e.targetBlock != 0) emit FightForfeited(id, msg.sender);
        if (e.castsUsed >= t.castLimit) revert OutOfCasts();
        e.castsUsed += 1;
        e.targetBlock = uint64(block.number + REVEAL_DELAY);
        emit TournamentCast(id, msg.sender, e.castsUsed, e.targetBlock);
    }

    /// @notice Settles the pending cast with the recording of the fight (one bit per 50 ms tick, 1 = reeling).
    ///         Late recordings forfeit the fish instead of reverting, so the player is never stuck.
    function reel(uint256 id, bytes calldata inputs) external {
        Tournament storage t = _get(id);
        Entry storage e = _entries[id][msg.sender];
        uint64 target = e.targetBlock;
        if (target == 0) revert NoFight();
        if (block.number <= target) revert TooEarly();
        e.targetBlock = 0;
        if (block.number > target + fightBlocks || block.timestamp > t.end + GRACE) {
            emit FightForfeited(id, msg.sender);
            return;
        }

        uint256 seed = castSeed(id, msg.sender, e.castsUsed, blockhash(target));
        (uint16 speciesId, uint32 weight, uint8 quality, uint32 base, uint256 difficulty) = _roll(t, seed);
        (bool landed, uint256 ticks, uint256 good) = verifier.replay(fightSeed(seed), difficulty, t.green, inputs);

        uint32 points;
        if (landed) {
            points = pointsFor(base, ticks, good);
            _record(id, t.counted, e, points);
        }
        emit TournamentCatch(
            id, msg.sender, speciesId, weight, quality, base, points, landed, uint32(ticks), uint32(good), e.total
        );
    }

    /// @notice The randomness of a cast: `castNo` is the player's cast count in this tournament, starting at 1.
    function castSeed(uint256 id, address player, uint256 castNo, bytes32 blockHash) public view returns (uint256) {
        return uint256(keccak256(abi.encode(blockHash, player, id, castNo, address(this))));
    }

    function fightSeed(uint256 seed) public pure returns (uint256) {
        return uint256(keccak256(abi.encode(seed)));
    }

    /// @notice A landed fish scores half its points for landing it and the rest by the share of the fight spent in
    ///         the green.
    function pointsFor(uint256 base, uint256 ticks, uint256 good) public pure returns (uint32) {
        uint256 p = (base * (5_000 + (5_000 * good) / ticks) + 5_000) / 10_000;
        return uint32(p == 0 ? 1 : p);
    }

    /// @dev The same draw as the game's, with the tournament's fixed tackle and without bites, bottles or specials.
    function _roll(Tournament storage t, uint256 seed)
        internal
        view
        returns (uint16 speciesId, uint32 weight, uint8 quality, uint32 base, uint256 difficulty)
    {
        (int256 rodCatch,, uint256 rarityBonus, uint256 weightBonus,) = game.loadout(t.rod, t.lure, 0, t.locationId);
        FishingGame.Location memory l = game.location(t.locationId);
        uint256 n = l.speciesIds.length;
        uint256[] memory eff = new uint256[](n);
        uint256 total;
        for (uint256 i; i < n; i++) {
            eff[i] = uint256(l.weights[i]) * (100 + uint256(fishNft.species(l.speciesIds[i]).rarity) * rarityBonus);
            total += eff[i];
        }
        uint256 x = (seed >> 64) % total;
        speciesId = l.speciesIds[n - 1];
        for (uint256 i; i < n; i++) {
            if (x < eff[i]) {
                speciesId = l.speciesIds[i];
                break;
            }
            x -= eff[i];
        }
        FishNFT.Species memory s = fishNft.species(speciesId);
        weight = CatchMath.rollWeight(s.minWeight, s.maxWeight, weightBonus, seed >> 128);
        quality = CatchMath.rollQuality(rodCatch, s.rarity, (seed >> 200) % 10_000, QUALITY_PER_CATCH, QUALITY_PER_RARITY);
        base = uint32(CatchMath.score(s.rarity, s.minWeight, s.maxWeight, weight, quality));
        difficulty = uint256(s.rarity) + t.waterTier;
        if (difficulty > 5) difficulty = 5;
    }

    /// @dev Keeps the best `counted` catches sorted, then moves the player up the leaderboard.
    function _record(uint256 id, uint256 counted, Entry storage e, uint32 points) internal {
        uint32[] storage best = e.best;
        uint256 n = best.length;
        if (n < counted) {
            best.push(points);
            n++;
            e.total += points;
        } else if (points > best[n - 1]) {
            e.total = e.total - best[n - 1] + points;
            best[n - 1] = points;
        } else {
            return;
        }
        for (uint256 i = n - 1; i > 0 && best[i] > best[i - 1]; i--) {
            (best[i], best[i - 1]) = (best[i - 1], best[i]);
        }
        e.seq = ++_seq;

        address[] storage top = _top[id];
        uint256 len = top.length;
        uint256 at = len;
        for (uint256 i; i < len; i++) {
            if (top[i] == msg.sender) {
                at = i;
                break;
            }
        }
        if (at == len) {
            if (len < TOP) {
                top.push(msg.sender);
            } else {
                if (!_ahead(id, e, top[len - 1])) return;
                at = len - 1;
            }
        }
        for (; at > 0 && _ahead(id, e, top[at - 1]); at--) {
            top[at] = top[at - 1];
        }
        top[at] = msg.sender;
    }

    function _ahead(uint256 id, Entry storage e, address other) internal view returns (bool) {
        Entry storage o = _entries[id][other];
        return e.total > o.total || (e.total == o.total && e.seq < o.seq);
    }

    // ------------------------------------------------------------------ prizes

    function prizeShareBps(uint256 place) public pure returns (uint256) {
        return place == 0 ? 5_000 : place == 1 ? 3_000 : place == 2 ? 2_000 : 0;
    }

    function isOver(uint256 id) public view returns (bool) {
        return block.timestamp > uint256(_get(id).end) + GRACE;
    }

    /// @notice The top three collect their share once the tournament and its grace period are over.
    function claim(uint256 id) external returns (uint256 amount) {
        if (!isOver(id)) revert NotOver();
        Entry storage e = _entries[id][msg.sender];
        address[] storage top = _top[id];
        uint256 place = 3;
        for (uint256 i; i < top.length && i < 3; i++) {
            if (top[i] == msg.sender) place = i;
        }
        amount = (uint256(_tournaments[id].prize) * prizeShareBps(place)) / 10_000;
        if (e.claimed || amount == 0) revert NothingToClaim();
        e.claimed = true;
        blend.safeTransfer(msg.sender, amount);
        emit PrizeClaimed(id, msg.sender, place, amount);
    }

    /// @notice Places nobody took (fewer than three players scored) go back to the sponsor.
    function reclaim(uint256 id) external returns (uint256 amount) {
        if (!isOver(id)) revert NotOver();
        Tournament storage t = _tournaments[id];
        for (uint256 place = _top[id].length; place < 3; place++) {
            amount += (uint256(t.prize) * prizeShareBps(place)) / 10_000;
        }
        if (t.reclaimed || amount == 0) revert NothingToClaim();
        t.reclaimed = true;
        blend.safeTransfer(t.sponsor, amount);
        emit PrizeReclaimed(id, amount);
    }

    // ------------------------------------------------------------------ views

    function _get(uint256 id) internal view returns (Tournament storage) {
        if (id >= _tournaments.length) revert BadTournament();
        return _tournaments[id];
    }

    function count() external view returns (uint256) {
        return _tournaments.length;
    }

    function tournament(uint256 id) external view returns (Tournament memory) {
        return _get(id);
    }

    function entryOf(uint256 id, address player) external view returns (Entry memory) {
        return _entries[id][player];
    }

    /// @notice The newest `limit` tournaments (newest first) with `player`'s entry in each, in one call.
    function list(address player, uint256 limit)
        external
        view
        returns (uint256[] memory ids, Tournament[] memory ts, Entry[] memory entries, uint64 blockNumber)
    {
        uint256 n = _tournaments.length;
        if (limit > n) limit = n;
        ids = new uint256[](limit);
        ts = new Tournament[](limit);
        entries = new Entry[](limit);
        for (uint256 i; i < limit; i++) {
            uint256 id = n - 1 - i;
            ids[i] = id;
            ts[i] = _tournaments[id];
            entries[i] = _entries[id][player];
        }
        blockNumber = uint64(block.number);
    }

    /// @notice The leaderboard: up to ten players, best first.
    function standings(uint256 id) external view returns (address[] memory players, uint32[] memory totals) {
        players = _top[id];
        totals = new uint32[](players.length);
        for (uint256 i; i < players.length; i++) totals[i] = _entries[id][players[i]].total;
    }
}
