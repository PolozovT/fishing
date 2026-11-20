// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ProxyAdmin} from "@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol";
import {FishingGame} from "../src/FishingGame.sol";
import {Tournaments} from "../src/Tournaments.sol";
import {PearlToken} from "../src/PearlToken.sol";
import {FishNFT} from "../src/FishNFT.sol";
import {GameLens} from "../src/GameLens.sol";
import {Upgrade} from "../script/Upgrade.s.sol";

/// @notice The rehearsal of an upgrade on the real thing: a fork of a live network. The proxies there are pointed at
///         the current source, and every player the chain knows, every fish and every tournament must read exactly
///         as before; then the game is played on.
///
///         Skipped unless FORK_RPC names the network (an alias from foundry.toml or a URL):
///             FORK_RPC=fluent_testnet forge test --match-contract UpgradeForkTest -vv
///         Nothing is sent to the network and no key is needed: the upgrade is simulated as the proxy admin's owner.
contract UpgradeForkTest is Test {
    bytes32 internal constant ADMIN_SLOT = 0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103;
    bytes32 internal constant IMPL_SLOT = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;
    uint256 internal constant WEEKS_BACK = 12;

    bool internal forked;
    FishingGame internal game;
    Tournaments internal cup;
    PearlToken internal pearl;
    FishNFT internal fish;
    GameLens internal lens;
    address[] internal players;
    mapping(address => bool) internal known;

    function setUp() public {
        string memory rpc = vm.envOr("FORK_RPC", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);
        forked = true;
        string memory json = vm.readFile(string.concat(vm.projectRoot(), "/../deployments/", vm.toString(block.chainid), ".json"));
        game = FishingGame(vm.parseJsonAddress(json, ".game"));
        cup = Tournaments(vm.parseJsonAddress(json, ".tournaments"));
        lens = GameLens(vm.parseJsonAddress(json, ".lens"));
        pearl = game.pearl();
        fish = game.fishNft();
        _findPlayers();
    }

    modifier onFork() {
        if (!forked) {
            vm.skip(true, "set FORK_RPC to run the upgrade rehearsal on a fork");
        }
        _;
    }

    function _know(address who) internal {
        if (who == address(0) || known[who]) return;
        known[who] = true;
        players.push(who);
    }

    /// @dev The chain keeps no list of players. These are everyone it can name: holders of fish, the anglers who
    ///      caught them, everyone on a weekly board of the last weeks, the leaders of every tournament, the owner.
    function _findPlayers() internal {
        _know(game.owner());
        uint256 n = fish.totalSupply();
        for (uint256 i; i < n; i++) {
            uint256 id = fish.tokenByIndex(i);
            _know(fish.ownerOf(id));
            _know(fish.fish(id).angler);
        }
        uint256 week = game.currentWeek();
        for (uint256 w = week > WEEKS_BACK ? week - WEEKS_BACK : 0; w <= week; w++) {
            uint256 m = game.weekPlayerCount(w);
            for (uint256 i; i < m; i++) _know(game.weekPlayer(w, i));
        }
        uint256 t = cup.count();
        for (uint256 id; id < t; id++) {
            (address[] memory top,) = cup.standings(id);
            for (uint256 i; i < top.length; i++) _know(top[i]);
        }
    }

    function _admin(address proxy) internal view returns (ProxyAdmin) {
        return ProxyAdmin(address(uint160(uint256(vm.load(proxy, ADMIN_SLOT)))));
    }

    function _implementation(address proxy) internal view returns (address) {
        return address(uint160(uint256(vm.load(proxy, IMPL_SLOT))));
    }

    /// @dev The upgrade exactly as script/Upgrade.s.sol sends it, checks included, as the proxy admins' owner.
    function _upgrade() internal {
        Upgrade script = new Upgrade();
        address nextGame = script.rehearse("game", _admin(address(game)).owner());
        address nextCup = script.rehearse("tournaments", _admin(address(cup)).owner());
        assertEq(_implementation(address(game)), nextGame);
        assertEq(_implementation(address(cup)), nextCup);
    }

    function test_theUpgradeScriptRefusesAStranger() public onFork {
        Upgrade script = new Upgrade();
        vm.expectRevert("the sender does not own the proxy admin");
        script.rehearse("game", makeAddr("stranger"));
    }

    function _playerState(address who) internal view returns (bytes32 h) {
        h = keccak256(abi.encode(lens.playerView(who), pearl.balanceOf(who), fish.balanceOf(who)));
        uint256 week = game.currentWeek();
        for (uint256 w = week > WEEKS_BACK ? week - WEEKS_BACK : 0; w <= week; w++) {
            h = keccak256(abi.encode(h, game.weekEntries(w, who), game.weekTotal(w, who)));
        }
        uint256 t = cup.count();
        for (uint256 id; id < t; id++) h = keccak256(abi.encode(h, cup.entryOf(id, who)));
    }

    function _worldState() internal view returns (bytes32 h) {
        uint256 n = fish.totalSupply();
        for (uint256 i; i < n; i++) {
            uint256 id = fish.tokenByIndex(i);
            h = keccak256(abi.encode(h, id, fish.ownerOf(id), fish.fish(id), fish.tokenURI(id), game.fishValue(id)));
        }
        uint256 t = cup.count();
        for (uint256 id; id < t; id++) {
            (address[] memory top, uint32[] memory totals) = cup.standings(id);
            h = keccak256(abi.encode(h, cup.tournament(id), cup.termsOf(id), cup.pool(id), top, totals));
        }
        h = keccak256(abi.encode(h, lens.catalog(), game.totalCasts(), game.owner(), cup.owner(), pearl.totalSupply(), fish.nextId()));
        h = keccak256(abi.encode(h, address(cup.verifier()), cup.fightBlocks(), cup.blend().balanceOf(address(cup))));
    }

    function test_forkRunsTheRecordedRelease() public onFork {
        _assertRelease("FishingGame", address(game));
        _assertRelease("Tournaments", address(cup));
    }

    /// @dev The fork must be what contracts/releases says it is, or the tests that start from a release test the wrong code.
    function _assertRelease(string memory name, address proxy) internal view {
        string memory base = string.concat(vm.projectRoot(), "/releases/", vm.toString(block.chainid), "/");
        string memory latest = vm.parseJsonString(vm.readFile(string.concat(base, "index.json")), string.concat(".", name, ".latest"));
        string memory meta = vm.readFile(string.concat(base, name, "/", latest, "/release.json"));
        address impl = _implementation(proxy);
        assertEq(impl, vm.parseJsonAddress(meta, ".implementation"), "the proxy runs code no release records: ./release.sh record");
        assertEq(keccak256(impl.code), vm.parseJsonBytes32(meta, ".runtimeCodeHash"), "code hash");
        assertEq(proxy, vm.parseJsonAddress(meta, ".proxy"), "proxy");
    }

    function test_upgradeOnTheForkKeepsEveryKnownPlayerFishAndTournament() public onFork {
        assertGt(players.length, 0, "no players found on the fork");
        bytes32[] memory before = new bytes32[](players.length);
        for (uint256 i; i < players.length; i++) before[i] = _playerState(players[i]);
        bytes32 world = _worldState();

        _upgrade();

        for (uint256 i; i < players.length; i++) {
            assertEq(_playerState(players[i]), before[i], string.concat("state changed for ", vm.toString(players[i])));
        }
        assertEq(_worldState(), world, "fish, tournaments or the catalog changed");
        emit log_named_uint("players compared", players.length);
        emit log_named_uint("fish compared", fish.totalSupply());
        emit log_named_uint("tournaments compared", cup.count());
    }

    function test_theGameIsPlayableOnTheForkAfterTheUpgrade() public onFork {
        _upgrade();
        address angler = makeAddr("fork angler");
        uint256 casts = game.totalCasts();
        vm.prank(angler);
        game.cast(0);
        uint64 target = game.castOf(angler).targetBlock;
        vm.roll(target + 1);
        vm.setBlockhash(target, keccak256("fork"));
        vm.prank(angler);
        game.reel();
        assertEq(game.totalCasts(), casts + 1);
        assertEq(game.castOf(angler).targetBlock, 0);
        assertEq(game.playerOf(angler).casts, 1);
        // an existing player's cast, if one is in the water, can still be finished
        for (uint256 i; i < players.length; i++) {
            uint64 pending = game.castOf(players[i]).targetBlock;
            if (pending == 0) continue;
            if (block.number <= pending) vm.roll(pending + 1);
            game.reelFor(players[i]);
            assertEq(game.castOf(players[i]).targetBlock, 0);
        }
    }
}
