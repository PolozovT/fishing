// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ProxyAdmin} from "@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol";
import {ITransparentUpgradeableProxy} from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import {PearlToken} from "../src/PearlToken.sol";
import {FishNFT} from "../src/FishNFT.sol";
import {FishingGame, IBottlePool} from "../src/FishingGame.sol";
import {Tournaments} from "../src/Tournaments.sol";

/// @notice Points a proxy at the current code, keeping its address and every player's state. It changes the code and
///         nothing else: no price, no config value, no catalog entry. The economy is a separate, explicit step
///         (script/Economy.s.sol), so a code upgrade can never reset the game's balance by accident.
///
///         Before any transaction is sent the script checks, and reverts if any of it fails:
///           - the proxy runs exactly the implementation the latest release records (contracts/releases), so the
///             layout and regression checks were made against the code that is really there;
///           - the token addresses the proxy uses, read from the chain, are the ones in deployments/<chainId>.json,
///             and the new implementation is built with them;
///           - the new implementation is this build (bytecode compared with out/, immutables aside) and fits the
///             contract size limit;
///           - the sender owns the proxy's ProxyAdmin;
///           - after the upgrade the proxy runs the new code and its owner, config and counters read as before.
///
///         Read contracts/UPGRADES.md first; ./preflight.sh runs the checks that do not fit in a script.
///           TARGET=game|tournaments forge script script/Upgrade.s.sol --rpc-url <rpc> --broadcast --private-key <owner>
///           TARGET=…                forge script script/Upgrade.s.sol --sig "check()" --rpc-url <rpc>        (no transaction)
///           TARGET=… IMPL=0x…       forge script script/Upgrade.s.sol --sig "switchTo()" --rpc-url <rpc> --broadcast …
contract Upgrade is Script {
    /// @dev ERC-1967 slots of a transparent proxy.
    bytes32 internal constant ADMIN_SLOT = 0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103;
    bytes32 internal constant IMPL_SLOT = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;
    /// @dev EIP-170. Fluent enforces it: a 24,577-byte contract is refused (contracts/UPGRADES.md).
    uint256 internal constant CODE_LIMIT = 24_576;

    struct Plan {
        bool isGame;
        string name;
        address proxy;
        ProxyAdmin admin;
        address current;
        address[3] deps; // game: pearl, fish, bottles. tournaments: game, fish, blend
    }

    /// @dev A byte range of the runtime code that holds an immutable (the artifact has zeroes there).
    struct Range {
        uint256 length;
        uint256 start;
    }

    // ------------------------------------------------------------------ entry points

    /// @notice Deploys the current code and points the proxy at it.
    function run() external {
        Plan memory p = _plan(_isGame(vm.envString("TARGET")));
        vm.startBroadcast();
        address impl = _upgrade(p, address(0));
        vm.stopBroadcast();
        _report(p, impl);
    }

    /// @notice Points the proxy at IMPL: an implementation deployed earlier (`deployOnly`), so that it can be looked at
    ///         on the chain (./release.sh check-impl) before anything depends on it.
    function switchTo() external {
        Plan memory p = _plan(_isGame(vm.envString("TARGET")));
        vm.startBroadcast();
        address impl = _upgrade(p, vm.envAddress("IMPL"));
        vm.stopBroadcast();
        _report(p, impl);
    }

    /// @notice Only deploys the implementation. The proxy is not touched.
    function deployOnly() external {
        Plan memory p = _plan(_isGame(vm.envString("TARGET")));
        vm.startBroadcast();
        address impl = _deploy(p);
        vm.stopBroadcast();
        _checkImplementation(p, impl);
        console2.log("implementation deployed, proxy untouched:", impl);
        console2.log("next: ./release.sh check-impl", p.name, impl);
    }

    /// @notice Sends nothing: prints what the proxy runs and whether the checks before an upgrade pass.
    function check() external view {
        Plan memory p = _plan(_isGame(vm.envString("TARGET")));
        console2.log("target              ", p.name);
        console2.log("chain               ", block.chainid);
        console2.log("proxy               ", p.proxy);
        console2.log("proxy admin         ", address(p.admin));
        console2.log("admin owner         ", p.admin.owner());
        console2.log("implementation      ", p.current);
        console2.log("code size           ", p.current.code.length);
        console2.log("ready: the proxy runs the recorded release and its dependencies match deployments/");
    }

    /// @notice The upgrade as `as_` would send it, without broadcasting: the fork rehearsal (test/UpgradeFork.t.sol).
    function rehearse(string calldata target, address as_) external returns (address impl) {
        Plan memory p = _plan(_isGame(target));
        vm.startPrank(as_);
        impl = _upgrade(p, address(0));
        vm.stopPrank();
    }

    // ------------------------------------------------------------------ the plan and its checks

    function _isGame(string memory target) internal pure returns (bool) {
        bytes32 t = keccak256(bytes(target));
        require(t == keccak256("game") || t == keccak256("tournaments"), "TARGET must be game or tournaments");
        return t == keccak256("game");
    }

    function _plan(bool isGame) internal view returns (Plan memory p) {
        string memory chain = vm.toString(block.chainid);
        string memory json = vm.readFile(string.concat(vm.projectRoot(), "/../deployments/", chain, ".json"));
        p.isGame = isGame;
        p.name = isGame ? "FishingGame" : "Tournaments";
        p.proxy = vm.parseJsonAddress(json, isGame ? ".game" : ".tournaments");
        require(p.proxy.code.length != 0, "no contract at the proxy address: wrong network?");
        p.admin = ProxyAdmin(address(uint160(uint256(vm.load(p.proxy, ADMIN_SLOT)))));
        require(address(p.admin).code.length != 0, "the address is not a transparent proxy");
        p.current = address(uint160(uint256(vm.load(p.proxy, IMPL_SLOT))));

        // the dependencies are read from the chain, and the deployments file must agree with it
        if (isGame) {
            FishingGame g = FishingGame(p.proxy);
            p.deps = [address(g.pearl()), address(g.fishNft()), address(g.bottles())];
            _same(p.deps[0], vm.parseJsonAddress(json, ".pearl"), "pearl");
            _same(p.deps[1], vm.parseJsonAddress(json, ".fish"), "fish");
            _same(p.deps[2], vm.parseJsonAddress(json, ".bottles"), "bottles");
        } else {
            Tournaments t = Tournaments(p.proxy);
            p.deps = [address(t.game()), address(t.fishNft()), address(t.blend())];
            _same(p.deps[0], vm.parseJsonAddress(json, ".game"), "game");
            _same(p.deps[1], vm.parseJsonAddress(json, ".fish"), "fish");
            _same(p.deps[2], vm.parseJsonAddress(json, ".blend"), "blend");
        }
        for (uint256 i; i < 3; i++) require(p.deps[i].code.length != 0, "a dependency has no code");

        // the proxy must run the release the layout and regression checks were made against
        string memory base = string.concat(vm.projectRoot(), "/releases/", chain, "/");
        string memory latest = vm.parseJsonString(vm.readFile(string.concat(base, "index.json")), string.concat(".", p.name, ".latest"));
        string memory release = vm.readFile(string.concat(base, p.name, "/", latest, "/release.json"));
        require(
            vm.parseJsonAddress(release, ".implementation") == p.current,
            "the proxy runs code that no release records: run ./release.sh record <rpc> and the checks again"
        );
        require(vm.parseJsonBytes32(release, ".runtimeCodeHash") == keccak256(p.current.code), "the released code hash differs from the chain");
    }

    function _same(address onChain, address inFile, string memory what) internal pure {
        require(onChain == inFile, string.concat("deployments file disagrees with the chain about ", what));
    }

    function _deploy(Plan memory p) internal returns (address) {
        return p.isGame
            ? address(new FishingGame(PearlToken(p.deps[0]), FishNFT(p.deps[1]), IBottlePool(p.deps[2])))
            : address(new Tournaments(FishingGame(p.deps[0]), FishNFT(p.deps[1]), IERC20(p.deps[2])));
    }

    /// @dev The implementation is this build, wired to the proxy's dependencies, and small enough to exist.
    function _checkImplementation(Plan memory p, address impl) internal view {
        require(impl.code.length != 0, "no code at the implementation");
        require(impl.code.length <= CODE_LIMIT, "the implementation is over the contract size limit");
        address[3] memory got = p.isGame
            ? [address(FishingGame(impl).pearl()), address(FishingGame(impl).fishNft()), address(FishingGame(impl).bottles())]
            : [address(Tournaments(impl).game()), address(Tournaments(impl).fishNft()), address(Tournaments(impl).blend())];
        for (uint256 i; i < 3; i++) require(got[i] == p.deps[i], "the implementation is built with other dependencies than the proxy uses");
        require(_isThisBuild(p.name, impl), "the implementation's bytecode is not this build (out/)");
    }

    /// @dev Compares the code at `impl` with the build artifact, with the immutables zeroed as they are in the artifact.
    function _isThisBuild(string memory name, address impl) internal view returns (bool) {
        string memory art = vm.readFile(string.concat(vm.projectRoot(), "/out/", name, ".sol/", name, ".json"));
        bytes memory built = vm.parseJsonBytes(art, ".deployedBytecode.object");
        bytes memory code = impl.code;
        if (code.length != built.length) return false;
        string memory refs = ".deployedBytecode.immutableReferences";
        string[] memory ids = vm.parseJsonKeys(art, refs);
        for (uint256 i; i < ids.length; i++) {
            Range[] memory ranges = abi.decode(vm.parseJson(art, string.concat(refs, ".", ids[i])), (Range[]));
            for (uint256 k; k < ranges.length; k++) {
                for (uint256 b = ranges[k].start; b < ranges[k].start + ranges[k].length; b++) code[b] = 0;
            }
        }
        return keccak256(code) == keccak256(built);
    }

    /// @dev What must read the same before and after: the owner, the configuration and the counters.
    function _fingerprint(Plan memory p) internal view returns (bytes32 h) {
        string[9] memory game = ["owner()", "config()", "rodCount()", "lureCount()", "locationCount()", "specialCount()", "achievementCount()", "totalCasts()", "totalBlendWon()"];
        string[9] memory cup = ["owner()", "verifier()", "fightBlocks()", "count()", "game()", "fishNft()", "blend()", "GRACE()", "owner()"];
        for (uint256 i; i < 9; i++) {
            (bool ok, bytes memory out) = p.proxy.staticcall(abi.encodeWithSignature(p.isGame ? game[i] : cup[i]));
            require(ok, "a view the upgrade must keep reverts");
            h = keccak256(abi.encode(h, out));
        }
    }

    /// @param impl an implementation deployed earlier, or zero to deploy the current code now
    function _upgrade(Plan memory p, address impl) internal returns (address) {
        (, address sender,) = vm.readCallers();
        require(p.admin.owner() == sender, "the sender does not own the proxy admin");
        if (impl == address(0)) impl = _deploy(p);
        _checkImplementation(p, impl);
        require(impl != p.current, "the proxy already runs this implementation");

        bytes32 before = _fingerprint(p);
        p.admin.upgradeAndCall(ITransparentUpgradeableProxy(p.proxy), impl, "");

        require(address(uint160(uint256(vm.load(p.proxy, IMPL_SLOT)))) == impl, "the proxy does not run the new implementation");
        require(_fingerprint(p) == before, "the owner, the config or a counter reads differently after the upgrade");
        return impl;
    }

    function _report(Plan memory p, address impl) internal view {
        console2.log("upgraded            ", p.name);
        console2.log("chain               ", block.chainid);
        console2.log("proxy               ", p.proxy);
        console2.log("proxy admin         ", address(p.admin));
        console2.log("old implementation  ", p.current);
        console2.log("new implementation  ", impl);
        console2.log("code size           ", impl.code.length);
        console2.log("bytes under limit   ", CODE_LIMIT - impl.code.length);
        console2.log("code hash           ", vm.toString(keccak256(impl.code)));
        console2.log("dependencies        ", p.deps[0], p.deps[1], p.deps[2]);
        console2.log("checked: built from this source, same dependencies, owner/config/counters unchanged");
        console2.log("not changed: prices, config, catalog (script/Economy.s.sol is a separate step)");
        console2.log("next: ./release.sh record <rpc>, then ./release.sh verify <rpc> --source, then commit contracts/releases");
    }
}
