// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {PearlToken} from "./PearlToken.sol";
import {FishNFT} from "./FishNFT.sol";

/// @title Onchain Fishing: the whole game.
/// @notice Flow: `cast` (spend energy, wear the rod and the lure, commit to a future block) → wait `revealDelay`
///         blocks → `reel` (the outcome is derived from that block's hash). The block did not exist at cast time,
///         so a player cannot re-roll by reverting; skipping the reel only forfeits the catch. Anyone may `reelFor`
///         a player, the catch always goes to that player.
///
///         Everything that decides value is rolled here: whether anything bites, the species, the weight and the
///         quality grade. A client may animate the fight any way it likes; it cannot influence the result.
/// @dev Randomness = blockhash of a future block. On an L2 the sequencer controls blockhashes, so anything with
///      real value at stake should swap in a VRF or a randomness beacon. Not audited.
contract FishingGame is Ownable {
    // ------------------------------------------------------------------ types

    /// @dev A bonus that applies only at the locations in `mask` (bit i = location i).
    struct Effect {
        uint16 mask;
        int8 catchPts;
        uint16 rarity;
        uint8 weight;
    }

    /// @dev A rod or a lure. `wear`: durability points of a rod (0 = never wears out) or casts of a lure.
    ///      A rod's catch improves the quality roll, a lure's catch raises the bite chance; `rarity` is a relative
    ///      weighting of rarer species; `weight` is a percentage on the fish's weight.
    struct Item {
        uint96 price;
        uint16 wear;
        int8 catchPts;
        uint16 rarity;
        uint8 weight;
        uint16 repairBps; // multiplier on the repair price, 10_000 = 1x
        Effect a;
        Effect b;
    }

    struct Location {
        uint8 energyCost;
        uint8 unlockType; // 0 open, 1 player level >= arg, 2 discovered species >= arg, 3 special fish `arg` found
        uint16 unlockArg;
        uint8 special; // special fish that can be hooked here: 0 = none, else id + 1
        bool active;
        uint16[] speciesIds;
        uint16[] weights;
    }

    struct Special {
        uint16 speciesId;
        uint32 chancePpm; // chance per landed fish at a location that carries it
        uint16 pity; // until first found: this many dry catches guarantee it
        // passive bonus while it is the active special and the player holds a specimen
        uint16 mask; // locations where the bonus applies, 0 = everywhere
        int8 catchPts;
        uint16 rarity;
        uint8 weight;
        uint8 hiddenMult; // multiplier on hidden species' pool weights, >= 1
    }

    /// @dev kind 0: every species of location `arg` discovered; 1: discovered species >= arg;
    ///      2: legendary+ species discovered >= arg; 3: special fish found >= arg.
    struct Achievement {
        uint8 kind;
        uint16 arg;
        uint96 reward;
    }

    struct Player {
        uint32 energy;
        uint40 energyUpdatedAt; // 0 = never played (treated as full energy)
        uint64 xp;
        uint32 catches;
        uint32 casts;
        uint16 rods; // owned rods, bit per id; rod 0 is the starter and is always owned
        uint8 rod; // equipped rod id
        uint8 lure; // equipped lure: 0 = none, else id + 1
        uint16 unlocks; // locations unlocked for good, bit per id
        uint8 specialsFound; // bit per special id
        uint8 activeSpecial; // 0 = none, else id + 1
        uint16 dexCount; // species discovered
        uint16 legends; // of them legendary or mythic
        uint32 claimed; // achievements paid, bit per index
        uint8 blendWins;
    }

    struct Cast {
        uint64 targetBlock; // 0 = no active cast
        uint64 nonce;
        uint8 locationId;
        uint8 rod;
        uint8 lure; // 0 = none, else id + 1
        uint8 special; // active special bonus fixed at cast time: 0 = none, else id + 1
    }

    struct Config {
        uint32 maxEnergy;
        uint32 energyRegenSeconds;
        uint8 revealDelay; // blocks between cast and the randomness block
        uint16 baseBiteBps;
        uint16 maxBiteBps;
        uint16 maxRarityBonus;
        uint8 maxWeightBonus;
        uint16 repairShareBps; // a full repair costs this share of the rod's price
        uint96 energyRefillPrice;
        uint32 refillPriceGrowthBps; // each further refill on the same UTC day costs this much more (20000 = x2)
        uint256 emissionSoftCap; // PEARL per UTC day from selling fish; above it payouts shrink. 0 = off
        uint16 qualityPerCatch; // quality roll shift per point of rod catch, bps
        uint16 qualityPerRarity; // quality roll penalty per rarity tier of the fish, bps
        uint96 blendAmount; // BLEND recorded per bottle (a record only: no token is transferred)
        uint32 blendChancePpm; // chance per bite
        uint8 blendMaxWins; // bottles one player can land
    }

    struct RefillState {
        uint32 day;
        uint32 count;
    }

    struct Record {
        uint16 speciesId;
        uint32 weight;
        uint40 at;
    }

    struct WeekEntry {
        uint16 score;
        uint16 speciesId;
        uint32 weight;
        uint8 quality;
        uint40 at;
    }

    struct DexEntry {
        uint32 count;
        uint32 best;
    }

    uint256 internal constant WEEK_SLOTS = 10;

    // ------------------------------------------------------------------ storage

    PearlToken public immutable pearl;
    FishNFT public immutable fishNft;

    Config public config;
    Item[] internal _rods;
    Item[] internal _lures;
    Location[] internal _locations;
    Special[] internal _specials;
    Achievement[] internal _achievements;
    mapping(uint256 => bool) public hiddenSpecies;

    mapping(address => Player) internal players;
    mapping(address => Cast) internal casts;
    mapping(address => mapping(uint256 => uint16)) public rodDurability;
    mapping(address => mapping(uint256 => uint32)) public lureCasts;
    mapping(address => mapping(uint256 => DexEntry)) public dex;
    mapping(address => mapping(uint256 => uint16)) public dryCatches;
    mapping(address => Record) public bestCatch;
    mapping(address => mapping(uint256 => Record)) public bestAt;
    mapping(address => uint256) public blendWon;
    mapping(address => RefillState) internal refillState;
    mapping(uint256 => uint256) public mintedOnDay;

    mapping(uint256 => mapping(address => WeekEntry[])) internal _week;
    mapping(uint256 => mapping(address => uint32)) public weekTotal;
    mapping(uint256 => address[]) internal _weekPlayers;

    uint256 public totalCasts;
    uint256 public totalBlendWon;

    // ------------------------------------------------------------------ errors & events

    error UnknownRod();
    error UnknownLure();
    error UnknownLocation();
    error UnknownSpecial();
    error UnknownAchievement();
    error AlreadyOwned();
    error NotOwned();
    error RodBroken();
    error NothingToRepair();
    error LocationInactive();
    error LocationLocked();
    error NotEnoughEnergy();
    error EnergyFull();
    error CastInProgress();
    error NoActiveCast();
    error TooEarly();
    error NotFishOwner();
    error SpecialNotHeld();
    error NotCompleted();
    error AlreadyClaimed();
    error BadConfig();

    event Casted(address indexed player, uint8 locationId, uint8 rod, uint8 lure, uint64 targetBlock);
    event Caught(
        address indexed player,
        uint256 indexed fishId,
        uint16 speciesId,
        uint32 weight,
        uint8 quality,
        uint8 locationId,
        uint16 score,
        bool special
    );
    event Missed(address indexed player, uint8 locationId);
    event CastExpired(address indexed player);
    event BottleFound(address indexed player, uint256 amount);
    event LocationUnlocked(address indexed player, uint8 locationId);
    event FishSold(address indexed player, uint256 indexed fishId, uint256 payout);
    event RodBought(address indexed player, uint8 rod, uint256 cost);
    event LureBought(address indexed player, uint8 lure, uint256 cost);
    event RodRepaired(address indexed player, uint8 rod, uint256 cost);
    event EnergyRefilled(address indexed player, uint256 cost);
    event AchievementClaimed(address indexed player, uint256 indexed index, uint256 reward);
    event WeekScore(uint256 indexed week, address indexed player, uint32 total);

    // ------------------------------------------------------------------ setup

    constructor(address owner_, PearlToken pearl_, FishNFT fish_, Config memory config_) Ownable(owner_) {
        pearl = pearl_;
        fishNft = fish_;
        _setConfig(config_);
    }

    function setConfig(Config calldata c) external onlyOwner {
        _setConfig(c);
    }

    function _setConfig(Config memory c) internal {
        if (
            c.maxEnergy == 0 || c.energyRegenSeconds == 0 || c.revealDelay == 0 || c.maxBiteBps > 10_000
                || c.baseBiteBps > c.maxBiteBps || c.refillPriceGrowthBps < 10_000 || c.repairShareBps > 10_000
        ) revert BadConfig();
        config = c;
    }

    function addRod(Item calldata it) external onlyOwner returns (uint256 id) {
        id = _rods.length;
        if (id >= 16) revert BadConfig();
        _rods.push(it);
    }

    function addLure(Item calldata it) external onlyOwner returns (uint256 id) {
        id = _lures.length;
        if (id >= 255 || it.wear == 0) revert BadConfig();
        _lures.push(it);
    }

    function updateRod(uint256 id, Item calldata it) external onlyOwner {
        if (id >= _rods.length) revert UnknownRod();
        _rods[id] = it;
    }

    function updateLure(uint256 id, Item calldata it) external onlyOwner {
        if (id >= _lures.length || it.wear == 0) revert UnknownLure();
        _lures[id] = it;
    }

    function addLocation(Location calldata l) external onlyOwner returns (uint256 id) {
        id = _locations.length;
        if (id >= 16) revert BadConfig();
        _validateLocation(l);
        _locations.push(l);
    }

    function updateLocation(uint256 id, Location calldata l) external onlyOwner {
        if (id >= _locations.length) revert UnknownLocation();
        _validateLocation(l);
        _locations[id] = l;
    }

    function _validateLocation(Location calldata l) internal view {
        if (l.speciesIds.length == 0 || l.speciesIds.length != l.weights.length || l.unlockType > 3) revert BadConfig();
        uint256 n = fishNft.speciesCount();
        for (uint256 i; i < l.speciesIds.length; i++) {
            if (l.speciesIds[i] >= n || l.weights[i] == 0) revert BadConfig();
        }
    }

    function addSpecial(Special calldata s) external onlyOwner returns (uint256 id) {
        id = _specials.length;
        if (id >= 8 || s.hiddenMult == 0 || s.speciesId >= fishNft.speciesCount()) revert BadConfig();
        _specials.push(s);
    }

    function addAchievement(Achievement calldata a) external onlyOwner returns (uint256 id) {
        id = _achievements.length;
        if (id >= 32 || a.kind > 3) revert BadConfig();
        _achievements.push(a);
    }

    function setHidden(uint256 speciesId, bool hidden) external onlyOwner {
        hiddenSpecies[speciesId] = hidden;
    }

    // ------------------------------------------------------------------ tackle

    function ownsRod(address player, uint256 id) public view returns (bool) {
        return id == 0 || (players[player].rods >> id) & 1 == 1;
    }

    function buyRod(uint8 id) external {
        if (id >= _rods.length) revert UnknownRod();
        if (ownsRod(msg.sender, id)) revert AlreadyOwned();
        Item storage it = _rods[id];
        pearl.gameBurn(msg.sender, it.price);
        Player storage p = players[msg.sender];
        p.rods |= uint16(1 << id);
        p.rod = id;
        rodDurability[msg.sender][id] = it.wear;
        emit RodBought(msg.sender, id, it.price);
    }

    /// @notice Buying a lure you already carry adds its casts. An empty lure slot is filled with the new lure.
    function buyLure(uint8 id) external {
        if (id >= _lures.length) revert UnknownLure();
        Item storage it = _lures[id];
        pearl.gameBurn(msg.sender, it.price);
        lureCasts[msg.sender][id] += it.wear;
        Player storage p = players[msg.sender];
        if (p.lure == 0) p.lure = id + 1;
        emit LureBought(msg.sender, id, it.price);
    }

    function equipRod(uint8 id) external {
        if (id >= _rods.length) revert UnknownRod();
        if (!ownsRod(msg.sender, id)) revert NotOwned();
        players[msg.sender].rod = id;
    }

    /// @param lure 0 takes the lure off, otherwise lure id + 1.
    function equipLure(uint8 lure) external {
        if (lure != 0) {
            if (lure > _lures.length) revert UnknownLure();
            if (lureCasts[msg.sender][lure - 1] == 0) revert NotOwned();
        }
        players[msg.sender].lure = lure;
    }

    function repairCost(address player, uint256 id) public view returns (uint256) {
        if (id >= _rods.length || !ownsRod(player, id)) return 0;
        Item storage it = _rods[id];
        uint256 left = rodDurability[player][id];
        if (it.wear == 0 || left >= it.wear) return 0;
        // price * share * repairFactor * missing / wear
        return (uint256(it.price) * config.repairShareBps * it.repairBps * (it.wear - left)) / (uint256(it.wear) * 1e8);
    }

    function repairRod(uint8 id) external {
        uint256 cost = repairCost(msg.sender, id);
        if (cost == 0) revert NothingToRepair();
        pearl.gameBurn(msg.sender, cost);
        rodDurability[msg.sender][id] = _rods[id].wear;
        emit RodRepaired(msg.sender, id, cost);
    }

    /// @notice One passive-bonus slot. The special must have been found, and a specimen must be in hand.
    /// @param special 0 turns the bonus off, otherwise special id + 1.
    function setActiveSpecial(uint8 special) external {
        if (special != 0) {
            if (special > _specials.length) revert UnknownSpecial();
            if (fishNft.heldOf(msg.sender, _specials[special - 1].speciesId) == 0) revert SpecialNotHeld();
        }
        players[msg.sender].activeSpecial = special;
    }

    // ------------------------------------------------------------------ energy

    /// @notice Price of the next refill today: base * growth^(refills already bought today).
    function refillPrice(address player) public view returns (uint256 price) {
        RefillState memory st = refillState[player];
        uint256 n = st.day == block.timestamp / 1 days ? st.count : 0;
        price = config.energyRefillPrice;
        uint256 g = config.refillPriceGrowthBps;
        for (uint256 i; i < n && price < type(uint128).max; i++) {
            price = (price * g) / 10_000;
        }
    }

    function refillEnergy() external {
        if (currentEnergy(msg.sender) >= config.maxEnergy) revert EnergyFull();
        uint256 cost = refillPrice(msg.sender);
        uint32 today = uint32(block.timestamp / 1 days);
        RefillState storage st = refillState[msg.sender];
        if (st.day != today) {
            st.day = today;
            st.count = 0;
        }
        st.count += 1;
        pearl.gameBurn(msg.sender, cost);
        Player storage p = players[msg.sender];
        p.energy = config.maxEnergy;
        p.energyUpdatedAt = uint40(block.timestamp);
        emit EnergyRefilled(msg.sender, cost);
    }

    function currentEnergy(address player) public view returns (uint256) {
        Player storage p = players[player];
        if (p.energyUpdatedAt == 0) return config.maxEnergy;
        if (p.energy >= config.maxEnergy) return p.energy;
        uint256 e = p.energy + (block.timestamp - p.energyUpdatedAt) / config.energyRegenSeconds;
        return e > config.maxEnergy ? config.maxEnergy : e;
    }

    function _syncEnergy(Player storage p) internal {
        uint32 maxE = config.maxEnergy;
        if (p.energyUpdatedAt == 0) {
            p.energy = maxE;
            p.energyUpdatedAt = uint40(block.timestamp);
            return;
        }
        if (p.energy >= maxE) {
            p.energyUpdatedAt = uint40(block.timestamp);
            return;
        }
        uint256 gained = (block.timestamp - p.energyUpdatedAt) / config.energyRegenSeconds;
        if (gained == 0) return;
        uint256 e = p.energy + gained;
        if (e >= maxE) {
            p.energy = maxE;
            p.energyUpdatedAt = uint40(block.timestamp);
        } else {
            p.energy = uint32(e);
            p.energyUpdatedAt += uint40(gained * config.energyRegenSeconds); // keep partial progress
        }
    }

    // ------------------------------------------------------------------ progression

    /// @notice Level n needs 50·n·(n−1) XP.
    function levelOf(uint256 xp) public pure returns (uint256 level) {
        level = 1;
        while (50 * (level + 1) * level <= xp) level++;
    }

    function isUnlocked(address player, uint256 locationId) public view returns (bool) {
        if (locationId >= _locations.length) return false;
        return _locations[locationId].unlockType == 0 || (players[player].unlocks >> locationId) & 1 == 1;
    }

    function _unlockMet(Player storage p, Location storage l) internal view returns (bool) {
        if (l.unlockType == 0) return true;
        if (l.unlockType == 1) return p.xp >= 50 * uint256(l.unlockArg) * (uint256(l.unlockArg) - 1);
        if (l.unlockType == 2) return p.dexCount >= l.unlockArg;
        return (p.specialsFound >> l.unlockArg) & 1 == 1;
    }

    /// @dev Unlocks are permanent: bits are only ever set.
    function _grantUnlocks(address player, Player storage p) internal {
        uint256 n = _locations.length;
        for (uint256 i; i < n; i++) {
            if ((p.unlocks >> i) & 1 == 1) continue;
            Location storage l = _locations[i];
            if (l.unlockType != 0 && _unlockMet(p, l)) {
                p.unlocks |= uint16(1 << i);
                emit LocationUnlocked(player, uint8(i));
            }
        }
    }

    /// @notice Opens whatever the player has already earned (e.g. after a requirement was lowered).
    function syncUnlocks(address player) external {
        _grantUnlocks(player, players[player]);
    }

    function achievementDone(address player, uint256 index) public view returns (bool) {
        if (index >= _achievements.length) revert UnknownAchievement();
        Achievement storage a = _achievements[index];
        Player storage p = players[player];
        if (a.kind == 0) {
            Location storage l = _locations[a.arg];
            for (uint256 i; i < l.speciesIds.length; i++) {
                if (dex[player][l.speciesIds[i]].count == 0) return false;
            }
            return true;
        }
        if (a.kind == 1) return p.dexCount >= a.arg;
        if (a.kind == 2) return p.legends >= a.arg;
        return _popcount(p.specialsFound) >= a.arg;
    }

    function claimAchievement(uint256 index) external {
        if (!achievementDone(msg.sender, index)) revert NotCompleted();
        Player storage p = players[msg.sender];
        if ((p.claimed >> index) & 1 == 1) revert AlreadyClaimed();
        p.claimed |= uint32(1 << index);
        uint256 reward = _achievements[index].reward;
        pearl.mint(msg.sender, reward);
        emit AchievementClaimed(msg.sender, index, reward);
    }

    function _popcount(uint256 x) internal pure returns (uint256 n) {
        while (x != 0) {
            n += x & 1;
            x >>= 1;
        }
    }

    // ------------------------------------------------------------------ bonuses

    function _add(Effect storage e, uint256 loc, int256 c, uint256 r, uint256 w)
        internal
        view
        returns (int256, uint256, uint256)
    {
        if ((e.mask >> loc) & 1 == 1) return (c + e.catchPts, r + e.rarity, w + e.weight);
        return (c, r, w);
    }

    function _itemEffects(Item storage it, uint256 loc) internal view returns (int256 c, uint256 r, uint256 w) {
        (c, r, w) = (it.catchPts, it.rarity, it.weight);
        (c, r, w) = _add(it.a, loc, c, r, w);
        (c, r, w) = _add(it.b, loc, c, r, w);
    }

    /// @notice Combined bonuses of a loadout at a location: rod + lure + active special, capped.
    /// @param lure 0 = none, else lure id + 1. @param special 0 = none, else special id + 1.
    /// @return rodCatch quality-roll bonus, biteBps chance that anything bites, rarity relative weighting,
    ///         weight percent, hiddenMult multiplier on hidden species.
    function loadout(uint256 rod, uint256 lure, uint256 special, uint256 loc)
        public
        view
        returns (int256 rodCatch, uint256 biteBps, uint256 rarity, uint256 weight, uint256 hiddenMult)
    {
        uint256 r;
        uint256 w;
        (rodCatch, r, w) = _itemEffects(_rods[rod], loc);
        int256 bite = int256(uint256(config.baseBiteBps));
        if (lure != 0) {
            (int256 lc, uint256 lr, uint256 lw) = _itemEffects(_lures[lure - 1], loc);
            bite += lc * 100;
            r += lr;
            w += lw;
        }
        hiddenMult = 1;
        if (special != 0) {
            Special storage s = _specials[special - 1];
            hiddenMult = s.hiddenMult;
            if (s.mask == 0 || (s.mask >> loc) & 1 == 1) {
                bite += int256(s.catchPts) * 100;
                r += s.rarity;
                w += s.weight;
            }
        }
        rarity = r > config.maxRarityBonus ? config.maxRarityBonus : r;
        weight = w > config.maxWeightBonus ? config.maxWeightBonus : w;
        if (bite < 500) bite = 500;
        biteBps = uint256(bite) > config.maxBiteBps ? config.maxBiteBps : uint256(bite);
    }

    // ------------------------------------------------------------------ fishing

    function cast(uint8 locationId) external {
        Cast storage active = casts[msg.sender];
        if (active.targetBlock != 0) {
            // Convenience: a finished cast is resolved automatically before the new one.
            if (block.number <= active.targetBlock) revert CastInProgress();
            _reel(msg.sender);
        }
        if (locationId >= _locations.length) revert UnknownLocation();
        Location storage l = _locations[locationId];
        if (!l.active) revert LocationInactive();
        if (!isUnlocked(msg.sender, locationId)) revert LocationLocked();

        Player storage p = players[msg.sender];
        uint8 rod = p.rod;
        uint16 rodWear = _rods[rod].wear;
        if (rodWear != 0) {
            uint16 left = rodDurability[msg.sender][rod];
            if (left == 0) revert RodBroken();
            rodDurability[msg.sender][rod] = left - 1;
        }

        _syncEnergy(p);
        if (p.energy < l.energyCost) revert NotEnoughEnergy();
        p.energy -= l.energyCost;

        // The lure works for this cast even if it is its last one.
        uint8 lure = p.lure;
        if (lure != 0) {
            uint32 left = lureCasts[msg.sender][lure - 1];
            if (left == 0) {
                lure = 0;
                p.lure = 0;
            } else {
                lureCasts[msg.sender][lure - 1] = left - 1;
                if (left == 1) p.lure = 0;
            }
        }

        // The passive bonus needs a specimen in hand; selling the last one switches it off.
        uint8 special = p.activeSpecial;
        if (special != 0 && fishNft.heldOf(msg.sender, _specials[special - 1].speciesId) == 0) special = 0;

        uint64 target = uint64(block.number) + config.revealDelay;
        casts[msg.sender] = Cast(target, p.casts, locationId, rod, lure, special);
        p.casts += 1;
        totalCasts += 1;
        emit Casted(msg.sender, locationId, rod, lure, target);
    }

    function reel() external {
        _reel(msg.sender);
    }

    /// @notice Anyone can finish someone else's cast; the catch always goes to that player.
    function reelFor(address player) external {
        _reel(player);
    }

    function _reel(address player) internal {
        Cast memory c = casts[player];
        if (c.targetBlock == 0) revert NoActiveCast();
        if (block.number <= c.targetBlock) revert TooEarly();
        delete casts[player];

        bytes32 bh = blockhash(c.targetBlock);
        if (bh == bytes32(0)) {
            // older than 256 blocks: the randomness is gone, so is the fish
            emit CastExpired(player);
            return;
        }
        uint256 seed = uint256(keccak256(abi.encode(bh, player, c.nonce, address(this))));
        (int256 rodCatch, uint256 biteBps, uint256 rarityBonus, uint256 weightBonus, uint256 hiddenMult) =
            loadout(c.rod, c.lure, c.special, c.locationId);

        if (seed % 10_000 >= biteBps) {
            emit Missed(player, c.locationId);
            return;
        }

        Player storage p = players[player];
        if (p.blendWins < config.blendMaxWins && (seed >> 16) % 1_000_000 < config.blendChancePpm) {
            p.blendWins += 1;
            blendWon[player] += config.blendAmount;
            totalBlendWon += config.blendAmount;
            emit BottleFound(player, config.blendAmount);
            return;
        }

        Location storage l = _locations[c.locationId];
        uint16 speciesId;
        bool isSpecial;
        if (l.special != 0) {
            uint256 sid = l.special - 1;
            Special storage sp = _specials[sid];
            bool found = (p.specialsFound >> sid) & 1 == 1;
            uint16 dry = dryCatches[player][sid];
            if ((!found && uint256(dry) + 1 >= sp.pity) || (seed >> 40) % 1_000_000 < sp.chancePpm) {
                isSpecial = true;
                speciesId = sp.speciesId;
                dryCatches[player][sid] = 0;
                if (!found) p.specialsFound |= uint8(1 << sid);
                if (p.activeSpecial == 0) p.activeSpecial = uint8(sid + 1);
            } else if (dry < type(uint16).max) {
                dryCatches[player][sid] = dry + 1;
            }
        }
        if (!isSpecial) speciesId = _pickSpecies(l, rarityBonus, hiddenMult, seed >> 64);

        _land(player, p, c.locationId, speciesId, isSpecial, weightBonus, rodCatch, seed);
    }

    function _land(
        address player,
        Player storage p,
        uint8 locationId,
        uint16 speciesId,
        bool isSpecial,
        uint256 weightBonus,
        int256 rodCatch,
        uint256 seed
    ) internal {
        FishNFT.Species memory s = fishNft.species(speciesId);
        uint32 weight = _rollWeight(s.minWeight, s.maxWeight, weightBonus, seed >> 128);
        uint8 quality = _rollQuality(rodCatch, s.rarity, (seed >> 200) % 10_000);
        uint16 score = uint16(scoreOf(s, weight, quality));

        uint256 fishId = fishNft.mint(
            player, FishNFT.Fish(speciesId, weight, locationId, quality, uint40(block.timestamp), player)
        );

        p.catches += 1;
        p.xp += _xpFor(s.rarity);
        DexEntry storage d = dex[player][speciesId];
        if (d.count == 0) {
            p.dexCount += 1;
            if (s.rarity >= 4) p.legends += 1;
        }
        d.count += 1;
        if (weight > d.best) d.best = weight;
        if (weight > bestCatch[player].weight) bestCatch[player] = Record(speciesId, weight, uint40(block.timestamp));
        if (weight > bestAt[player][locationId].weight) {
            bestAt[player][locationId] = Record(speciesId, weight, uint40(block.timestamp));
        }
        _addWeekScore(player, WeekEntry(score, speciesId, weight, quality, uint40(block.timestamp)));
        _grantUnlocks(player, p);
        emit Caught(player, fishId, speciesId, weight, quality, locationId, score, isSpecial);
    }

    /// @dev Weighted pick. Every pool weight is scaled by (100 + rarity × bonus), so the bonus is a relative
    ///      weighting toward rarer species, not percentage points.
    function _pickSpecies(Location storage pool, uint256 rarityBonus, uint256 hiddenMult, uint256 rnd)
        internal
        view
        returns (uint16)
    {
        uint256 n = pool.speciesIds.length;
        uint256[] memory eff = new uint256[](n);
        uint256 total;
        for (uint256 i; i < n; i++) {
            uint16 id = pool.speciesIds[i];
            uint256 rarity = fishNft.species(id).rarity;
            eff[i] = uint256(pool.weights[i]) * (100 + rarity * rarityBonus) * (hiddenSpecies[id] ? hiddenMult : 1);
            total += eff[i];
        }
        uint256 x = rnd % total;
        for (uint256 i; i < n; i++) {
            if (x < eff[i]) return pool.speciesIds[i];
            x -= eff[i];
        }
        return pool.speciesIds[n - 1]; // unreachable
    }

    /// @dev min of two uniforms → small fish are common, trophies are rare. The bonus scales the roll, capped at
    ///      the species maximum.
    function _rollWeight(uint32 minW, uint32 maxW, uint256 bonus, uint256 rnd) internal pure returns (uint32) {
        uint256 u1 = rnd & 0xffffffff;
        uint256 u2 = (rnd >> 32) & 0xffffffff;
        uint256 u = u1 < u2 ? u1 : u2;
        uint256 w = ((minW + ((uint256(maxW - minW) * u) >> 32)) * (100 + bonus)) / 100;
        return uint32(w > maxW ? maxW : w);
    }

    /// @dev 0 D … 4 S. A better rod shifts the roll up, a rarer fish shifts it down.
    function _rollQuality(int256 rodCatch, uint256 rarity, uint256 roll) internal view returns (uint8) {
        int256 x = int256(roll) + rodCatch * int256(uint256(config.qualityPerCatch))
            - int256(rarity * config.qualityPerRarity);
        if (x < 1_500) return 0;
        if (x < 4_500) return 1;
        if (x < 7_500) return 2;
        if (x < 9_200) return 3;
        return 4;
    }

    function _xpFor(uint256 rarity) internal pure returns (uint64) {
        return rarity >= 5 ? 80 : uint64(10 * (rarity + 1));
    }

    function _qualityBps(uint256 q) internal pure returns (uint256) {
        if (q == 0) return 8_000;
        if (q == 1) return 9_000;
        if (q == 2) return 10_000;
        if (q == 3) return 11_500;
        return 13_000;
    }

    /// @dev weight / species mean, in bps. The mean of min(u1,u2) is a third of the way up the range.
    function _weightRatioBps(FishNFT.Species memory s, uint256 weight) internal pure returns (uint256) {
        uint256 avg = uint256(s.minWeight) + (uint256(s.maxWeight) - s.minWeight) / 3;
        return (weight * 10_000) / avg;
    }

    function _clamp(uint256 v, uint256 lo, uint256 hi) internal pure returns (uint256) {
        return v < lo ? lo : v > hi ? hi : v;
    }

    /// @notice Tournament score = rarity points × weight factor (0.7–1.5) × quality factor, fixed at the catch.
    function scoreOf(FishNFT.Species memory s, uint256 weight, uint256 quality) public pure returns (uint256) {
        uint256[6] memory points = [uint256(10), 25, 60, 150, 400, 800];
        uint256 raw = points[s.rarity] * _clamp(_weightRatioBps(s, weight), 7_000, 15_000) * _qualityBps(quality);
        return (raw + 5e7) / 1e8;
    }

    // ------------------------------------------------------------------ weekly championship

    function currentWeek() public view returns (uint256) {
        return block.timestamp / 1 weeks;
    }

    /// @dev Keeps the ten best catches of the week, sorted best first. Selling the fish later changes nothing.
    function _addWeekScore(address player, WeekEntry memory e) internal {
        uint256 week = currentWeek();
        WeekEntry[] storage list = _week[week][player];
        uint256 n = list.length;
        uint32 total = weekTotal[week][player];
        if (n == 0) _weekPlayers[week].push(player);
        if (n < WEEK_SLOTS) {
            list.push(e);
            n += 1;
            total += e.score;
        } else if (e.score > list[n - 1].score) {
            total = total - list[n - 1].score + e.score;
            list[n - 1] = e;
        } else {
            return;
        }
        for (uint256 i = n - 1; i > 0 && list[i].score > list[i - 1].score; i--) {
            WeekEntry memory lower = list[i - 1];
            list[i - 1] = list[i];
            list[i] = lower;
        }
        weekTotal[week][player] = total;
        emit WeekScore(week, player, total);
    }

    function weekEntries(uint256 week, address player) external view returns (WeekEntry[] memory) {
        return _week[week][player];
    }

    function weekPlayerCount(uint256 week) external view returns (uint256) {
        return _weekPlayers[week].length;
    }

    function weekPlayer(uint256 week, uint256 index) external view returns (address) {
        return _weekPlayers[week][index];
    }

    // ------------------------------------------------------------------ selling fish to the game

    /// @notice price = basePrice × weight factor (0.4–3 of the species mean) × quality factor.
    function fishValue(uint256 fishId) public view returns (uint256) {
        FishNFT.Fish memory f = fishNft.fish(fishId);
        FishNFT.Species memory s = fishNft.species(f.speciesId);
        return (uint256(s.basePrice) * _clamp(_weightRatioBps(s, f.weight), 4_000, 30_000) * _qualityBps(f.quality)) / 1e8;
    }

    /// @notice Payout after the daily emission soft cap is applied.
    function quoteSell(uint256 fishId) public view returns (uint256) {
        return _applyCap(fishValue(fishId), mintedOnDay[block.timestamp / 1 days]);
    }

    function _applyCap(uint256 value, uint256 mintedToday) internal view returns (uint256) {
        uint256 cap = config.emissionSoftCap;
        if (cap == 0 || mintedToday < cap) return value;
        return (value * cap) / mintedToday; // the more is minted today, the less each fish pays
    }

    function sellFish(uint256[] calldata fishIds) external returns (uint256 total) {
        uint256 day = block.timestamp / 1 days;
        uint256 minted = mintedOnDay[day];
        for (uint256 i; i < fishIds.length; i++) {
            uint256 id = fishIds[i];
            if (fishNft.ownerOf(id) != msg.sender) revert NotFishOwner();
            uint256 payout = _applyCap(fishValue(id), minted);
            fishNft.burn(id);
            minted += payout;
            total += payout;
            emit FishSold(msg.sender, id, payout);
        }
        mintedOnDay[day] = minted;
        pearl.mint(msg.sender, total);
    }

    // ------------------------------------------------------------------ views (GameLens batches these for clients)

    function rodCount() external view returns (uint256) {
        return _rods.length;
    }

    function rodItem(uint256 id) external view returns (Item memory) {
        return _rods[id];
    }

    function lureCount() external view returns (uint256) {
        return _lures.length;
    }

    function lureItem(uint256 id) external view returns (Item memory) {
        return _lures[id];
    }

    function locationCount() external view returns (uint256) {
        return _locations.length;
    }

    function location(uint256 id) external view returns (Location memory) {
        return _locations[id];
    }

    function specialCount() external view returns (uint256) {
        return _specials.length;
    }

    function specialInfo(uint256 id) external view returns (Special memory) {
        return _specials[id];
    }

    function achievementCount() external view returns (uint256) {
        return _achievements.length;
    }

    function achievement(uint256 id) external view returns (Achievement memory) {
        return _achievements[id];
    }

    function playerOf(address who) external view returns (Player memory) {
        return players[who];
    }

    function castOf(address who) external view returns (Cast memory) {
        return casts[who];
    }
}
