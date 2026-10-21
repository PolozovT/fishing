// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {PearlToken} from "./PearlToken.sol";
import {FishNFT} from "./FishNFT.sol";
import {RodNFT} from "./RodNFT.sol";

/// @title Onchain Fishing — core game loop.
/// @notice Flow: `cast` (spend energy + bait, lock rod, commit to a future block) → wait `revealDelay` blocks →
///         `reel` (outcome derived from the future blockhash). Because the outcome is fixed by a block that did not
///         exist at cast time, a player cannot re-roll by reverting; skipping the reel only forfeits the catch.
///         Anyone may `reelFor` a player (rewards always go to the player), so a keeper/relayer can finish casts.
/// @dev Randomness = blockhash of a future block. Good enough for a game on L1 / for testing the hypothesis; on L2s
///      the sequencer controls blockhashes, so production should swap in VRF or a randomness beacon (see README).
contract FishingGame is Ownable {
    // ------------------------------------------------------------------ types

    struct Spot {
        string name;
        uint8 minRodLevel;
        uint8 energyCost;
        bool active;
        uint16[] speciesIds;
        uint16[] weights; // base drop weights, same length as speciesIds
    }

    struct Bait {
        string name;
        uint96 price; // PEARL wei per unit
        uint16 catchBonusBps; // added to catch chance
        uint16 rarityBonus; // percent boost per rarity tier
    }

    struct Player {
        uint32 energy;
        uint40 energyUpdatedAt; // 0 = never played (treated as full energy)
        bool starterClaimed;
        uint64 xp;
        uint64 catches;
        uint64 casts;
        uint32 bestWeight;
        uint256 bestFishId;
    }

    struct Cast {
        uint64 targetBlock; // 0 = no active cast
        uint64 nonce;
        uint8 spotId;
        uint8 baitId;
        uint256 rodId;
    }

    struct Config {
        uint32 maxEnergy;
        uint32 energyRegenSeconds; // seconds per 1 energy
        uint8 revealDelay; // blocks between cast and the randomness block
        uint8 maxRodLevel;
        uint16 baseCatchBps;
        uint16 catchBpsPerLevel;
        uint16 maxCatchBps;
        uint16 rarityBoostPerLevel; // percent per rarity tier per rod level above 1
        uint16 starterDurability;
        uint16 durabilityPerLevel;
        uint96 energyRefillPrice;
        uint96 rodPrice;
        uint96 repairPricePerPoint; // per missing durability point, multiplied by rod level
        uint256 emissionSoftCap; // PEARL per UTC day from selling fish; above it payouts shrink. 0 = off
    }

    struct WeeklyRecord {
        address angler;
        uint256 fishId;
        uint32 weight;
        uint16 speciesId;
    }

    // ------------------------------------------------------------------ storage

    PearlToken public immutable pearl;
    FishNFT public immutable fishNft;
    RodNFT public immutable rodNft;

    Config public config;
    Spot[] internal _spots;
    Bait[] internal _baits; // id 0 = "no bait"
    uint96[] public upgradePrices; // upgradePrices[level-1] = cost to go from `level` to `level+1`

    mapping(address => Player) public players;
    mapping(address => Cast) public casts;
    mapping(address => mapping(uint256 => uint256)) public baitBalance;
    mapping(uint256 => uint256) public mintedOnDay;
    mapping(uint256 => WeeklyRecord) public weeklyBest; // week index => heaviest fish (any species)
    uint256 public totalCasts;

    // ------------------------------------------------------------------ errors & events

    error NotRodOwner();
    error RodLevelTooLow();
    error RodBroken();
    error SpotInactive();
    error UnknownSpot();
    error UnknownBait();
    error NotEnoughEnergy();
    error NotEnoughBait();
    error CastInProgress();
    error NoActiveCast();
    error TooEarly();
    error StarterAlreadyClaimed();
    error MaxLevel();
    error NothingToRepair();
    error NotFishOwner();
    error BadConfig();
    error RodInUse();

    event Casted(address indexed player, uint256 indexed rodId, uint8 spotId, uint8 baitId, uint64 targetBlock);
    event Caught(
        address indexed player, uint256 indexed fishId, uint16 speciesId, uint32 weight, uint8 spotId, uint256 rodId
    );
    event Missed(address indexed player, uint8 spotId, uint256 rodId);
    event CastExpired(address indexed player, uint256 rodId);
    event FishSold(address indexed player, uint256 indexed fishId, uint256 payout);
    event RodMinted(address indexed player, uint256 indexed rodId, bool starter);
    event RodUpgraded(address indexed player, uint256 indexed rodId, uint8 newLevel, uint256 cost);
    event RodRepaired(address indexed player, uint256 indexed rodId, uint256 cost);
    event BaitBought(address indexed player, uint8 indexed baitId, uint256 amount, uint256 cost);
    event EnergyRefilled(address indexed player, uint256 cost);
    event WeeklyRecordSet(uint256 indexed week, address indexed angler, uint256 fishId, uint32 weight);

    // ------------------------------------------------------------------ setup

    constructor(address owner_, PearlToken pearl_, FishNFT fish_, RodNFT rod_, Config memory config_)
        Ownable(owner_)
    {
        pearl = pearl_;
        fishNft = fish_;
        rodNft = rod_;
        _setConfig(config_);
        _baits.push(Bait("None", 0, 0, 0));
    }

    function setConfig(Config calldata c) external onlyOwner {
        _setConfig(c);
    }

    function _setConfig(Config memory c) internal {
        if (
            c.maxEnergy == 0 || c.energyRegenSeconds == 0 || c.revealDelay == 0 || c.maxRodLevel == 0
                || c.maxCatchBps > 10_000 || c.baseCatchBps > c.maxCatchBps
        ) revert BadConfig();
        config = c;
    }

    function setUpgradePrices(uint96[] calldata prices) external onlyOwner {
        upgradePrices = prices;
    }

    function addSpot(
        string calldata name,
        uint8 minRodLevel,
        uint8 energyCost,
        uint16[] calldata speciesIds,
        uint16[] calldata weights
    ) external onlyOwner returns (uint256 id) {
        _validateTable(speciesIds, weights);
        id = _spots.length;
        _spots.push(Spot(name, minRodLevel, energyCost, true, speciesIds, weights));
    }

    function updateSpot(
        uint256 id,
        uint8 minRodLevel,
        uint8 energyCost,
        bool active,
        uint16[] calldata speciesIds,
        uint16[] calldata weights
    ) external onlyOwner {
        if (id >= _spots.length) revert UnknownSpot();
        _validateTable(speciesIds, weights);
        Spot storage s = _spots[id];
        s.minRodLevel = minRodLevel;
        s.energyCost = energyCost;
        s.active = active;
        s.speciesIds = speciesIds;
        s.weights = weights;
    }

    function _validateTable(uint16[] calldata speciesIds, uint16[] calldata weights) internal view {
        if (speciesIds.length == 0 || speciesIds.length != weights.length) revert BadConfig();
        uint256 n = fishNft.speciesCount();
        for (uint256 i; i < speciesIds.length; i++) {
            if (speciesIds[i] >= n || weights[i] == 0) revert BadConfig();
        }
    }

    function addBait(Bait calldata b) external onlyOwner returns (uint256 id) {
        id = _baits.length;
        _baits.push(b);
    }

    function updateBait(uint256 id, Bait calldata b) external onlyOwner {
        if (id == 0 || id >= _baits.length) revert UnknownBait();
        _baits[id] = b;
    }

    // ------------------------------------------------------------------ rods

    function claimStarterRod() external returns (uint256 rodId) {
        Player storage p = players[msg.sender];
        if (p.starterClaimed) revert StarterAlreadyClaimed();
        p.starterClaimed = true;
        rodId = rodNft.mint(msg.sender, 1, config.starterDurability);
        emit RodMinted(msg.sender, rodId, true);
    }

    function buyRod() external returns (uint256 rodId) {
        uint256 cost = config.rodPrice;
        pearl.gameBurn(msg.sender, cost);
        rodId = rodNft.mint(msg.sender, 1, config.starterDurability);
        emit RodMinted(msg.sender, rodId, false);
    }

    function upgradeRod(uint256 rodId) external {
        RodNFT.Rod memory r = _ownedIdleRod(rodId);
        if (r.level >= config.maxRodLevel || r.level > upgradePrices.length) revert MaxLevel();
        uint256 cost = upgradePrices[r.level - 1];
        pearl.gameBurn(msg.sender, cost);
        r.level += 1;
        r.maxDurability += config.durabilityPerLevel;
        r.durability = r.maxDurability; // an upgrade also fully repairs
        rodNft.setRod(rodId, r);
        emit RodUpgraded(msg.sender, rodId, r.level, cost);
    }

    function repairCost(uint256 rodId) public view returns (uint256) {
        RodNFT.Rod memory r = rodNft.rods(rodId);
        return uint256(r.maxDurability - r.durability) * config.repairPricePerPoint * r.level;
    }

    function repairRod(uint256 rodId) external {
        RodNFT.Rod memory r = _ownedIdleRod(rodId);
        if (r.durability == r.maxDurability) revert NothingToRepair();
        uint256 cost = repairCost(rodId);
        pearl.gameBurn(msg.sender, cost);
        r.durability = r.maxDurability;
        rodNft.setRod(rodId, r);
        emit RodRepaired(msg.sender, rodId, cost);
    }

    function _ownedIdleRod(uint256 rodId) internal view returns (RodNFT.Rod memory r) {
        if (rodNft.ownerOf(rodId) != msg.sender) revert NotRodOwner();
        if (rodNft.locked(rodId)) revert RodInUse();
        r = rodNft.rods(rodId);
    }

    // ------------------------------------------------------------------ consumables

    function buyBait(uint8 baitId, uint256 amount) external {
        if (baitId == 0 || baitId >= _baits.length) revert UnknownBait();
        uint256 cost = uint256(_baits[baitId].price) * amount;
        pearl.gameBurn(msg.sender, cost);
        baitBalance[msg.sender][baitId] += amount;
        emit BaitBought(msg.sender, baitId, amount, cost);
    }

    function refillEnergy() external {
        uint256 cost = config.energyRefillPrice;
        pearl.gameBurn(msg.sender, cost);
        Player storage p = players[msg.sender];
        p.energy = config.maxEnergy;
        p.energyUpdatedAt = uint40(block.timestamp);
        emit EnergyRefilled(msg.sender, cost);
    }

    // ------------------------------------------------------------------ fishing

    function cast(uint256 rodId, uint8 spotId, uint8 baitId) external {
        Cast storage active = casts[msg.sender];
        if (active.targetBlock != 0) {
            // Convenience: a finished cast is resolved automatically before the new one.
            if (block.number <= active.targetBlock) revert CastInProgress();
            _reel(msg.sender);
        }
        if (spotId >= _spots.length) revert UnknownSpot();
        Spot storage sp = _spots[spotId];
        if (!sp.active) revert SpotInactive();
        if (baitId >= _baits.length) revert UnknownBait();

        if (rodNft.ownerOf(rodId) != msg.sender) revert NotRodOwner();
        RodNFT.Rod memory r = rodNft.rods(rodId);
        if (r.level < sp.minRodLevel) revert RodLevelTooLow();
        if (r.durability == 0) revert RodBroken();

        Player storage p = players[msg.sender];
        _syncEnergy(p);
        if (p.energy < sp.energyCost) revert NotEnoughEnergy();
        p.energy -= sp.energyCost;

        if (baitId != 0) {
            if (baitBalance[msg.sender][baitId] == 0) revert NotEnoughBait();
            baitBalance[msg.sender][baitId] -= 1;
        }

        rodNft.setLocked(rodId, true);
        uint64 target = uint64(block.number) + config.revealDelay;
        casts[msg.sender] = Cast(target, p.casts, spotId, baitId, rodId);
        p.casts += 1;
        totalCasts += 1;
        emit Casted(msg.sender, rodId, spotId, baitId, target);
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
        rodNft.setLocked(c.rodId, false);

        bytes32 bh = blockhash(c.targetBlock);
        if (bh == bytes32(0)) {
            // older than 256 blocks: the randomness is gone, so is the fish
            emit CastExpired(player, c.rodId);
            return;
        }
        uint256 seed = uint256(keccak256(abi.encode(bh, player, c.nonce, address(this))));

        RodNFT.Rod memory r = rodNft.rods(c.rodId);
        r.durability -= 1; // checked > 0 at cast, and the rod was locked since
        rodNft.setRod(c.rodId, r);

        Bait memory usedBait = _baits[c.baitId];
        if (seed % 10_000 >= catchChanceBps(r.level, c.baitId)) {
            emit Missed(player, c.spotId, c.rodId);
            return;
        }

        uint16 speciesId = _pickSpecies(_spots[c.spotId], r.level, usedBait.rarityBonus, seed >> 16);
        FishNFT.Species memory s = fishNft.species(speciesId);
        uint32 weight = _rollWeight(s.minWeight, s.maxWeight, seed >> 128);

        uint256 fishId =
            fishNft.mint(player, FishNFT.Fish(speciesId, weight, c.spotId, uint40(block.timestamp), player));

        Player storage p = players[player];
        p.catches += 1;
        p.xp += uint64(10) * (uint64(s.rarity) + 1);
        if (weight > p.bestWeight) {
            p.bestWeight = weight;
            p.bestFishId = fishId;
        }
        uint256 week = block.timestamp / 1 weeks;
        if (weight > weeklyBest[week].weight) {
            weeklyBest[week] = WeeklyRecord(player, fishId, weight, speciesId);
            emit WeeklyRecordSet(week, player, fishId, weight);
        }
        emit Caught(player, fishId, speciesId, weight, c.spotId, c.rodId);
    }

    function catchChanceBps(uint8 rodLevel, uint8 baitId) public view returns (uint256 chance) {
        chance = uint256(config.baseCatchBps) + uint256(config.catchBpsPerLevel) * (rodLevel - 1)
            + _baits[baitId].catchBonusBps;
        if (chance > config.maxCatchBps) chance = config.maxCatchBps;
    }

    /// @dev Weighted pick; rarer species get boosted by rod level and bait.
    function _pickSpecies(Spot storage pool, uint8 rodLevel, uint16 baitRarityBonus, uint256 rnd)
        internal
        view
        returns (uint16)
    {
        uint256 n = pool.speciesIds.length;
        uint256[] memory eff = new uint256[](n);
        uint256 total;
        uint256 boost = uint256(config.rarityBoostPerLevel) * (rodLevel - 1) + baitRarityBonus;
        for (uint256 i; i < n; i++) {
            uint8 rarity = fishNft.species(pool.speciesIds[i]).rarity;
            eff[i] = uint256(pool.weights[i]) * (100 + rarity * boost);
            total += eff[i];
        }
        uint256 x = rnd % total;
        for (uint256 i; i < n; i++) {
            if (x < eff[i]) return pool.speciesIds[i];
            x -= eff[i];
        }
        return pool.speciesIds[n - 1]; // unreachable
    }

    /// @dev min of two uniforms → small fish are common, trophies are rare.
    function _rollWeight(uint32 minW, uint32 maxW, uint256 rnd) internal pure returns (uint32) {
        uint256 u1 = rnd & 0xffffffff;
        uint256 u2 = (rnd >> 32) & 0xffffffff;
        uint256 u = u1 < u2 ? u1 : u2;
        return minW + uint32((uint256(maxW - minW) * u) >> 32);
    }

    // ------------------------------------------------------------------ market (sell to the game)

    function fishValue(uint256 fishId) public view returns (uint256) {
        FishNFT.Fish memory f = fishNft.fish(fishId);
        FishNFT.Species memory s = fishNft.species(f.speciesId);
        uint256 avg = (uint256(s.minWeight) + s.maxWeight) / 2;
        return (uint256(s.basePrice) * f.weight) / avg;
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

    // ------------------------------------------------------------------ energy

    function currentEnergy(address player) public view returns (uint256) {
        Player memory p = players[player];
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

    // ------------------------------------------------------------------ views

    function spotCount() external view returns (uint256) {
        return _spots.length;
    }

    function spot(uint256 id) external view returns (Spot memory) {
        return _spots[id];
    }

    function baitCount() external view returns (uint256) {
        return _baits.length;
    }

    function bait(uint256 id) external view returns (Bait memory) {
        return _baits[id];
    }

    function upgradeCost(uint256 rodId) external view returns (uint256) {
        RodNFT.Rod memory r = rodNft.rods(rodId);
        if (r.level >= config.maxRodLevel || r.level > upgradePrices.length) return 0;
        return upgradePrices[r.level - 1];
    }

    function currentWeek() external view returns (uint256) {
        return block.timestamp / 1 weeks;
    }
}
