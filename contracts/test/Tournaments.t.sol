// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Vm} from "forge-std/Vm.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {BaseTest} from "./Base.t.sol";
import {MockBlend} from "./PearlExchange.t.sol";
import {GameSetup} from "../script/GameSetup.sol";
import {Tournaments} from "../src/Tournaments.sol";
import {FightVerifier, IFightVerifier} from "../src/FightVerifier.sol";

/// @dev Says whatever the test tells it to, so the tournament rules can be tested apart from the fight itself.
contract ScriptedVerifier is IFightVerifier {
    bool public landed = true;
    uint256 public ticks = 200;
    uint256 public good = 200;

    function set(bool landed_, uint256 ticks_, uint256 good_) external {
        (landed, ticks, good) = (landed_, ticks_, good_);
    }

    function replay(uint256, uint256, uint256, bytes calldata) external view returns (bool, uint256, uint256) {
        return (landed, ticks, good);
    }
}

contract TournamentsTest is BaseTest {
    MockBlend internal blend;
    Tournaments internal cup;
    FightVerifier internal realVerifier;
    ScriptedVerifier internal judge;
    address internal carol = makeAddr("carol");
    address internal dave = makeAddr("dave");

    uint96 internal constant PRIZE = 1_000 ether;

    function setUp() public override {
        super.setUp();
        blend = new MockBlend();
        judge = new ScriptedVerifier();
        vm.startPrank(owner);
        (cup, realVerifier) = GameSetup.deployTournaments(owner, game, fish, IERC20(address(blend)));
        cup.setVerifier(judge);
        vm.stopPrank();
        blend.mint(owner, 10 * uint256(PRIZE));
        vm.prank(owner);
        blend.approve(address(cup), type(uint256).max);
    }

    function _new(uint16 castLimit, uint8 counted, uint8 rod) internal returns (uint256 id) {
        vm.prank(owner);
        id = cup.create(
            Tournaments.NewTournament({
                name: "Pond Sprint",
                start: uint40(block.timestamp + 10),
                end: uint40(block.timestamp + 10 + 30 minutes),
                locationId: 0,
                rod: rod,
                lure: 0,
                waterTier: 0,
                green: 31_250,
                castLimit: castLimit,
                counted: counted,
                prize: PRIZE
            })
        );
    }

    function _open(uint16 castLimit, uint8 counted) internal returns (uint256 id) {
        id = _new(castLimit, counted, 0);
        vm.warp(block.timestamp + 10);
    }

    function _enter(uint256 id, address who) internal {
        vm.prank(who);
        cup.enter(id);
    }

    /// @dev One cast and one fight; the judge decides how it went. Returns the points scored.
    function _fish(uint256 id, address who, bytes32 entropy, bool landed, uint256 good) internal returns (uint32 points) {
        judge.set(landed, 200, good);
        vm.prank(who);
        cup.cast(id);
        uint64 target = cup.entryOf(id, who).targetBlock;
        vm.roll(target + 1);
        vm.setBlockhash(target, entropy);
        uint32 before = cup.entryOf(id, who).total;
        vm.recordLogs();
        vm.prank(who);
        cup.reel(id, hex"");
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].topics[0] == Tournaments.TournamentCatch.selector) {
                (,,,, points,,,,) = abi.decode(logs[i].data, (uint16, uint32, uint8, uint32, uint32, bool, uint32, uint32, uint32));
            }
        }
        assertGe(cup.entryOf(id, who).total, before);
    }

    function _finish(uint256 id) internal {
        vm.warp(uint256(cup.tournament(id).end) + cup.GRACE() + 1);
    }

    // ------------------------------------------------------------------ organising

    function test_createTakesThePrize() public {
        uint256 before = blend.balanceOf(owner);
        uint256 id = _new(30, 10, 0);
        assertEq(blend.balanceOf(address(cup)), PRIZE);
        assertEq(blend.balanceOf(owner), before - PRIZE);
        Tournaments.Tournament memory t = cup.tournament(id);
        assertEq(t.sponsor, owner);
        assertEq(t.castLimit, 30);
        assertEq(cup.count(), 1);
    }

    function test_onlyOwnerCreatesAndBadParamsRevert() public {
        Tournaments.NewTournament memory t = Tournaments.NewTournament(
            "x", uint40(block.timestamp + 1), uint40(block.timestamp + 100), 0, 0, 0, 0, 31_250, 30, 10, 0
        );
        vm.prank(alice);
        vm.expectRevert();
        cup.create(t);
        vm.startPrank(owner);
        t.counted = 11;
        vm.expectRevert(Tournaments.BadTournament.selector);
        cup.create(t);
        t.counted = 10;
        t.castLimit = 9;
        vm.expectRevert(Tournaments.BadTournament.selector);
        cup.create(t);
        t.castLimit = 30;
        t.locationId = 99;
        vm.expectRevert(Tournaments.BadTournament.selector);
        cup.create(t);
        t.locationId = 0;
        t.end = t.start;
        vm.expectRevert(Tournaments.BadTournament.selector);
        cup.create(t);
        vm.stopPrank();
    }

    // ------------------------------------------------------------------ entering and casting

    function test_enterOnceAndOnlyBeforeTheEnd() public {
        uint256 id = _new(30, 10, 0);
        _enter(id, alice); // entering before the start is fine
        vm.prank(alice);
        vm.expectRevert(Tournaments.AlreadyEntered.selector);
        cup.enter(id);
        assertEq(cup.tournament(id).players, 1);
        vm.warp(cup.tournament(id).end);
        vm.prank(bob);
        vm.expectRevert(Tournaments.NotOpen.selector);
        cup.enter(id);
    }

    function test_tournamentNeedsItsRod() public {
        uint256 id = _new(30, 10, 1);
        vm.prank(alice);
        vm.expectRevert(Tournaments.RodRequired.selector);
        cup.enter(id);
        _fund(alice, 1_000_000 * E);
        vm.prank(alice);
        game.buyRod(1);
        _enter(id, alice);
        assertTrue(cup.entryOf(id, alice).entered);
    }

    function test_castNeedsAnEntryAndAnOpenTournament() public {
        uint256 id = _new(30, 10, 0);
        _enter(id, alice);
        vm.prank(alice);
        vm.expectRevert(Tournaments.NotOpen.selector); // not started
        cup.cast(id);
        vm.warp(block.timestamp + 10);
        vm.prank(bob);
        vm.expectRevert(Tournaments.NotEntered.selector);
        cup.cast(id);
        vm.warp(cup.tournament(id).end);
        vm.prank(alice);
        vm.expectRevert(Tournaments.NotOpen.selector); // over
        cup.cast(id);
    }

    function test_castLimitIsHard() public {
        uint256 id = _open(3, 2);
        _enter(id, alice);
        for (uint256 i; i < 3; i++) _fish(id, alice, bytes32(i + 1), true, 200);
        vm.prank(alice);
        vm.expectRevert(Tournaments.OutOfCasts.selector);
        cup.cast(id);
        assertEq(cup.entryOf(id, alice).castsUsed, 3);
    }

    function test_castingAgainLetsTheFishGo() public {
        uint256 id = _open(30, 10);
        _enter(id, alice);
        vm.startPrank(alice);
        cup.cast(id);
        vm.expectRevert(Tournaments.TooEarly.selector);
        cup.reel(id, hex"");
        cup.cast(id); // the first fish is gone, its cast stays spent
        vm.stopPrank();
        assertEq(cup.entryOf(id, alice).castsUsed, 2);
        // the recording is judged against the second cast only
        uint64 target = cup.entryOf(id, alice).targetBlock;
        vm.roll(target + 1);
        vm.setBlockhash(target, bytes32(uint256(5)));
        judge.set(true, 200, 200);
        vm.prank(alice);
        cup.reel(id, hex"");
        assertEq(cup.entryOf(id, alice).best.length, 1);
    }

    // ------------------------------------------------------------------ scoring

    function test_skillDecidesThePoints() public {
        uint256 id = _open(30, 10);
        _enter(id, alice);
        _enter(id, bob);
        _enter(id, carol);
        // the same block hash gives different fish to different players, so compare against `base` instead
        uint32 perfect = _fish(id, alice, bytes32(uint256(7)), true, 200);
        uint32 sloppy = _fish(id, alice, bytes32(uint256(7)), true, 0);
        assertGt(perfect, 0);
        assertGt(sloppy, 0);
        assertEq(cup.pointsFor(400, 200, 200), 400);
        assertEq(cup.pointsFor(400, 200, 100), 300);
        assertEq(cup.pointsFor(400, 200, 0), 200);
        assertEq(cup.pointsFor(1, 200, 0), 1);
        // a fish that gets away scores nothing but the cast is spent
        uint32 lost = _fish(id, bob, bytes32(uint256(7)), false, 150);
        assertEq(lost, 0);
        assertEq(cup.entryOf(id, bob).total, 0);
        assertEq(cup.entryOf(id, bob).castsUsed, 1);
    }

    function test_onlyTheBestCatchesCount() public {
        uint256 id = _open(40, 3);
        _enter(id, alice);
        uint32[] memory pts = new uint32[](12);
        for (uint256 i; i < 12; i++) pts[i] = _fish(id, alice, keccak256(abi.encode(i)), true, 200);
        // sort descending
        for (uint256 i; i < 12; i++) {
            for (uint256 j = i + 1; j < 12; j++) {
                if (pts[j] > pts[i]) (pts[i], pts[j]) = (pts[j], pts[i]);
            }
        }
        Tournaments.Entry memory e = cup.entryOf(id, alice);
        assertEq(e.best.length, 3);
        assertEq(e.best[0], pts[0]);
        assertEq(e.best[1], pts[1]);
        assertEq(e.best[2], pts[2]);
        assertEq(e.total, pts[0] + pts[1] + pts[2]);
    }

    function test_lateRecordingForfeitsTheFish() public {
        uint256 id = _open(30, 10);
        _enter(id, alice);
        vm.prank(alice);
        cup.cast(id);
        uint64 target = cup.entryOf(id, alice).targetBlock;
        vm.roll(target + cup.fightBlocks() + 1);
        vm.prank(alice);
        cup.reel(id, hex""); // does not revert: the player is never stuck
        assertEq(cup.entryOf(id, alice).total, 0);
        assertEq(cup.entryOf(id, alice).targetBlock, 0);
        // and a forgotten fight does not block the next cast either
        vm.prank(alice);
        cup.cast(id);
        vm.roll(block.number + cup.fightBlocks() + 3);
        vm.prank(alice);
        cup.cast(id);
        assertEq(cup.entryOf(id, alice).castsUsed, 3);
    }

    function test_fightHookedBeforeTheEndCanFinishInTheGrace() public {
        uint256 id = _open(30, 10);
        _enter(id, alice);
        judge.set(true, 200, 200);
        vm.warp(cup.tournament(id).end - 1);
        vm.prank(alice);
        cup.cast(id);
        uint64 target = cup.entryOf(id, alice).targetBlock;
        vm.roll(target + 1);
        vm.setBlockhash(target, bytes32(uint256(3)));
        vm.warp(uint256(cup.tournament(id).end) + 60);
        vm.prank(alice);
        cup.reel(id, hex"");
        assertGt(cup.entryOf(id, alice).total, 0);
    }

    // ------------------------------------------------------------------ leaderboard and prizes

    function test_standingsAreSortedAndTiesGoToTheEarlier() public {
        uint256 id = _open(30, 1);
        address[4] memory who = [alice, bob, carol, dave];
        for (uint256 i; i < 4; i++) _enter(id, who[i]);
        // everyone fishes until they hold some score; then check the order against the totals
        for (uint256 round; round < 6; round++) {
            for (uint256 i; i < 4; i++) _fish(id, who[i], keccak256(abi.encode(round, i)), true, 40 * (i + 1));
        }
        (address[] memory players, uint32[] memory totals) = cup.standings(id);
        assertEq(players.length, 4);
        for (uint256 i = 1; i < players.length; i++) {
            assertGe(totals[i - 1], totals[i]);
            if (totals[i - 1] == totals[i]) {
                assertLt(cup.entryOf(id, players[i - 1]).seq, cup.entryOf(id, players[i]).seq);
            }
        }
    }

    function test_leaderboardKeepsTheTenBestOfMany() public {
        uint256 id = _open(30, 1);
        uint32 lowestKept = type(uint32).max;
        uint32[] memory all = new uint32[](14);
        for (uint256 i; i < 14; i++) {
            address p = address(uint160(0xA000 + i));
            _enter(id, p);
            all[i] = _fish(id, p, keccak256(abi.encode("many", i)), true, 200);
        }
        (address[] memory players, uint32[] memory totals) = cup.standings(id);
        assertEq(players.length, 10);
        for (uint256 i; i < 10; i++) if (totals[i] < lowestKept) lowestKept = totals[i];
        uint256 better;
        for (uint256 i; i < 14; i++) if (all[i] > lowestKept) better++;
        assertLe(better, 10); // nobody left out beats anyone kept
    }

    function test_topThreeShareThePrize() public {
        uint256 id = _open(30, 1);
        address[4] memory who = [alice, bob, carol, dave];
        for (uint256 i; i < 4; i++) {
            _enter(id, who[i]);
            _fish(id, who[i], keccak256(abi.encode("prize", i)), true, 200);
        }
        (address[] memory players,) = cup.standings(id);
        vm.prank(players[0]);
        vm.expectRevert(Tournaments.NotOver.selector);
        cup.claim(id);
        _finish(id);
        uint256[3] memory share = [uint256(PRIZE) / 2, (uint256(PRIZE) * 3) / 10, uint256(PRIZE) / 5];
        for (uint256 i; i < 3; i++) {
            vm.prank(players[i]);
            assertEq(cup.claim(id), share[i]);
            assertEq(blend.balanceOf(players[i]), share[i]);
            vm.prank(players[i]);
            vm.expectRevert(Tournaments.NothingToClaim.selector);
            cup.claim(id);
        }
        vm.prank(players[3]);
        vm.expectRevert(Tournaments.NothingToClaim.selector);
        cup.claim(id);
        assertEq(blend.balanceOf(address(cup)), 0);
        vm.expectRevert(Tournaments.NothingToClaim.selector);
        cup.reclaim(id); // every place was taken
    }

    function test_unwonPlacesGoBackToTheSponsor() public {
        uint256 id = _open(30, 1);
        _enter(id, alice);
        _fish(id, alice, bytes32(uint256(1)), true, 200);
        _enter(id, bob); // entered, never scored
        _finish(id);
        uint256 before = blend.balanceOf(owner);
        assertEq(cup.reclaim(id), uint256(PRIZE) / 2);
        assertEq(blend.balanceOf(owner), before + uint256(PRIZE) / 2);
        vm.expectRevert(Tournaments.NothingToClaim.selector);
        cup.reclaim(id);
        vm.prank(alice);
        assertEq(cup.claim(id), uint256(PRIZE) / 2);
        vm.prank(bob);
        vm.expectRevert(Tournaments.NothingToClaim.selector);
        cup.claim(id);
    }

    function test_prizesOfDifferentTournamentsStayApart() public {
        uint256 a = _open(30, 1);
        uint256 b = _new(30, 1, 0);
        _enter(a, alice);
        _fish(a, alice, bytes32(uint256(1)), true, 200);
        _finish(a);
        vm.prank(alice);
        cup.claim(a);
        cup.reclaim(a);
        assertEq(blend.balanceOf(address(cup)), PRIZE); // tournament b's prize is untouched
        b;
    }

    function test_listReturnsNewestFirstWithTheEntry() public {
        uint256 a = _new(30, 10, 0);
        uint256 b = _new(20, 5, 0);
        _enter(b, alice);
        (uint256[] memory ids, Tournaments.Tournament[] memory ts, Tournaments.Entry[] memory es,) = cup.list(alice, 10);
        assertEq(ids.length, 2);
        assertEq(ids[0], b);
        assertEq(ids[1], a);
        assertEq(ts[0].castLimit, 20);
        assertTrue(es[0].entered);
        assertFalse(es[1].entered);
    }

    // ------------------------------------------------------------------ the real verifier, end to end

    function test_realVerifierScoresAHeldLineAsLost() public {
        vm.prank(owner);
        cup.setVerifier(realVerifier);
        uint256 id = _open(30, 10);
        _enter(id, alice);
        vm.prank(alice);
        cup.cast(id);
        uint64 target = cup.entryOf(id, alice).targetBlock;
        vm.roll(target + 1);
        vm.setBlockhash(target, bytes32(uint256(99)));
        bytes memory allHold = new bytes(40);
        for (uint256 i; i < 40; i++) allHold[i] = 0xff;
        vm.prank(alice);
        cup.reel(id, allHold);
        assertEq(cup.entryOf(id, alice).total, 0);
        assertEq(cup.entryOf(id, alice).castsUsed, 1);
    }

    // ------------------------------------------------------------------ vectors for the web client

    /// @notice Writes what the contract drew for a set of casts; web/src/game/tournament.test.ts replays them.
    ///         Regenerate: WRITE_VECTORS=true forge test --match-test test_writeTournamentVectors
    function test_writeTournamentVectors() public {
        if (!vm.envOr("WRITE_VECTORS", false)) return;
        string memory out = "[";
        for (uint256 i; i < 64; i++) {
            uint8 loc = uint8(i % 8);
            uint8 rod = uint8((i / 8) % 6);
            uint8 lure = uint8((i / 3) % 7);
            uint8 tier = uint8(i % 3);
            vm.prank(owner);
            uint256 id = cup.create(
                Tournaments.NewTournament("v", uint40(block.timestamp), uint40(block.timestamp + 1 hours), loc, rod, lure, tier, 31_250, 30, 10, 0)
            );
            _enter(id, alice);
            vm.prank(alice);
            cup.cast(id);
            uint64 target = cup.entryOf(id, alice).targetBlock;
            bytes32 entropy = keccak256(abi.encode("tournament", i));
            vm.roll(target + 1);
            vm.setBlockhash(target, entropy);
            judge.set(true, 200, 137);
            vm.recordLogs();
            vm.prank(alice);
            cup.reel(id, hex"");
            Vm.Log[] memory logs = vm.getRecordedLogs();
            (uint16 speciesId, uint32 weight, uint8 quality, uint32 base, uint32 points,,,,) =
                abi.decode(logs[logs.length - 1].data, (uint16, uint32, uint8, uint32, uint32, bool, uint32, uint32, uint32));
            (int256 rodCatch,, uint256 rarity, uint256 weightBonus,) = game.loadout(rod, lure, 0, loc);
            out = string.concat(
                out, i == 0 ? "" : ",", '{"blockHash":"', vm.toString(entropy), '","player":"', vm.toString(alice),
                '","tournaments":"', vm.toString(address(cup)), '","id":', vm.toString(id), ',"castNo":1,"locationId":',
                vm.toString(loc)
            );
            out = string.concat(
                out, ',"rodCatch":', vm.toString(rodCatch), ',"rarity":', vm.toString(rarity), ',"weightBonus":',
                vm.toString(weightBonus), ',"seed":"', vm.toString(cup.castSeed(id, alice, 1, entropy)), '","fightSeed":"',
                vm.toString(cup.fightSeed(cup.castSeed(id, alice, 1, entropy)))
            );
            out = string.concat(
                out, '","speciesId":', vm.toString(speciesId), ',"weight":', vm.toString(weight), ',"quality":',
                vm.toString(quality), ',"base":', vm.toString(base), ',"points":', vm.toString(points), "}"
            );
        }
        vm.writeFile("../web/src/game/fixtures/tournament.json", string.concat(out, "]\n"));
    }
}
