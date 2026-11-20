#!/usr/bin/env python3
"""Release snapshots of the upgradeable contracts: what exactly runs behind each proxy.

A release is a directory contracts/releases/<chainId>/<Contract>/<NNN>/ with

    release.json         network, proxy, implementation, code hash, dependencies, compiler settings, source commit
    abi.json             the implementation's ABI
    storage-layout.json  its storage layout, normalised (tools/layout.py compares new code against it)
    runtime.hex          the runtime bytecode as it is on the chain (the upgrade tests start from it)

and contracts/releases/<chainId>/index.json names the latest release of each contract.

Everything in a release is public chain data or build output. Nothing here reads a private key or an .env file,
and a release never holds one. Recording is reproducible: the same chain state and the same commit give the same
bytes (there are no timestamps).

    release.py record --rpc <alias|url>              snapshot what the proxies point at now (refuses code it cannot rebuild)
    release.py verify --rpc <alias|url> [--source]   check the snapshots against the chain; --source rebuilds each
                                                     release from its commit and compares the bytecode
    release.py check-impl <Contract> <address> --rpc <alias|url>
                                                     is this freshly deployed implementation the current build, wired
                                                     to the same dependencies as the proxy?
"""
import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile

import layout

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)  # contracts/
REPO = os.path.dirname(ROOT)
RELEASES = os.path.join(ROOT, "releases")

# the proxied contracts: their key in deployments/<chainId>.json and the addresses fixed in their bytecode
CONTRACTS = {
    "FishingGame": {"key": "game", "deps": ["pearl", "fishNft", "bottles"]},
    "Tournaments": {"key": "tournaments", "deps": ["game", "fishNft", "blend"]},
}
NETWORKS = {20994: "Fluent Testnet", 25363: "Fluent"}
IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc"
ADMIN_SLOT = "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103"
BUILD_INPUTS = ["contracts/src", "contracts/lib", "contracts/foundry.toml"]
CODE_LIMIT = 24576  # EIP-170; Fluent enforces it (see contracts/UPGRADES.md)


def run(args, cwd=ROOT):
    return subprocess.check_output(args, cwd=cwd, text=True).strip()


class Chain:
    def __init__(self, rpc):
        self.rpc = rpc
        self.id = int(run(["cast", "chain-id", "--rpc-url", rpc]))

    def cast(self, *args):
        return run(["cast"] + list(args) + ["--rpc-url", self.rpc])

    def slot_address(self, contract, slot):
        return checksum("0x" + self.cast("storage", contract, slot)[-40:])

    def code(self, address):
        return self.cast("code", address)

    def call_address(self, contract, getter):
        return checksum(self.cast("call", contract, getter + "()(address)"))


def checksum(address):
    return run(["cast", "to-check-sum-address", address])


def keccak(hex_data):
    return run(["cast", "keccak", hex_data])


def sha256(path):
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def artifact(root, contract):
    """Builds the contracts in `root` and returns the artifact of one of them."""
    built = subprocess.run(["forge", "build", "--skip", "test", "--skip", "script"], cwd=root, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    if built.returncode != 0:
        raise SystemExit("forge build failed in %s:\n%s" % (root, built.stdout))
    with open(os.path.join(root, "out", contract + ".sol", contract + ".json")) as f:
        return json.load(f)


def match(onchain_hex, art):
    """How the code on the chain relates to a build: 'exact', 'code' (same instructions, other metadata hash), 'none'.

    The addresses fixed in the bytecode (immutables) are zeroed first: the build does not know them. The metadata
    is the CBOR trailer the compiler appends; its hash covers every source file of the compilation, comments
    included, so it moves when an imported file changes even if this contract's instructions do not.
    """
    code = bytearray.fromhex(onchain_hex[2:])
    built = bytearray.fromhex(art["deployedBytecode"]["object"][2:])
    if len(code) != len(built) or not built:
        return "none"
    for refs in (art["deployedBytecode"].get("immutableReferences") or {}).values():
        for r in refs:
            code[r["start"] : r["start"] + r["length"]] = bytes(r["length"])
    if code == built:
        return "exact"
    trailer = int.from_bytes(built[-2:], "big") + 2
    return "code" if code[:-trailer] == built[:-trailer] else "none"


def immutable_offsets(onchain_hex, art, deps):
    """Where each fixed address sits in the runtime code: {dependency: [byte offsets of its 32-byte word]}.

    The upgrade tests use it to run the released code against their own tokens.
    """
    code = bytes.fromhex(onchain_hex[2:])
    by_value = dict((int(v, 16), k) for k, v in deps.items())
    offsets = dict((k, []) for k in deps)
    for refs in (art["deployedBytecode"].get("immutableReferences") or {}).values():
        for r in refs:
            value = int.from_bytes(code[r["start"] : r["start"] + r["length"]], "big")
            if value not in by_value or r["length"] != 32:
                raise SystemExit("an immutable at byte %d is not one of the known dependencies: add it to CONTRACTS" % r["start"])
            offsets[by_value[value]].append(r["start"])
    return dict((k, sorted(v)) for k, v in offsets.items())


def inputs_commit():
    """The last commit that changed what the contracts are built from."""
    return run(["git", "log", "-1", "--format=%H", "--"] + BUILD_INPUTS, cwd=REPO)


def inputs_dirty():
    return bool(run(["git", "status", "--porcelain", "--"] + BUILD_INPUTS, cwd=REPO))


class Worktree:
    """A throwaway checkout of a commit, to build the contracts as they were."""

    def __init__(self, commit):
        self.commit = commit

    def __enter__(self):
        self.dir = tempfile.mkdtemp(prefix="fishing-release-")
        subprocess.check_call(["git", "worktree", "add", "--detach", "--quiet", self.dir, self.commit], cwd=REPO)
        return os.path.join(self.dir, "contracts")

    def __exit__(self, *exc):
        subprocess.call(["git", "worktree", "remove", "--force", self.dir], cwd=REPO, stdout=subprocess.DEVNULL)
        shutil.rmtree(self.dir, ignore_errors=True)


def find_source(contract, onchain_hex):
    """(commit, artifact) of the build that reproduces the code on the chain exactly, newest first."""
    if not inputs_dirty():
        art = artifact(ROOT, contract)
        if match(onchain_hex, art) == "exact":
            return inputs_commit(), art
    commits = run(["git", "log", "--format=%H", "--", "contracts/src"], cwd=REPO).split()
    for commit in commits[:12]:
        print("  %s: the working tree does not reproduce the code on the chain, trying %s" % (contract, commit[:7]))
        with Worktree(commit) as root:
            art = artifact(root, contract)
        if match(onchain_hex, art) == "exact":
            return commit, art
    return None, None


def compiler_of(art):
    meta = art["metadata"]
    s = meta["settings"]
    return {
        "solc": meta["compiler"]["version"],
        "evmVersion": s.get("evmVersion"),
        "optimizer": s.get("optimizer"),
        "viaIR": bool(s.get("viaIR")),
        "metadata": s.get("metadata"),
    }


def deployment(chain_id):
    path = os.path.join(REPO, "deployments", "%d.json" % chain_id)
    if not os.path.isfile(path):
        raise SystemExit("no deployments/%d.json: nothing is deployed on this chain" % chain_id)
    with open(path) as f:
        return json.load(f)


def write_json(path, value):
    with open(path, "w") as f:
        json.dump(value, f, indent=2, sort_keys=True)
        f.write("\n")


def read_json(path):
    with open(path) as f:
        return json.load(f)


def write_index(chain_id):
    index = {}
    for contract in CONTRACTS:
        numbers = [n for c, n, _ in layout.releases(contract) if c == str(chain_id)]
        if numbers:
            index[contract] = {"latest": numbers[-1], "releases": numbers}
    write_json(os.path.join(RELEASES, str(chain_id), "index.json"), index)


def record(chain):
    dep = deployment(chain.id)
    status = 0
    for contract, spec in CONTRACTS.items():
        proxy = checksum(dep[spec["key"]])
        impl = chain.slot_address(proxy, IMPL_SLOT)
        code = chain.code(impl)
        mine = [(n, p) for c, n, p in layout.releases(contract) if c == str(chain.id)]
        if mine and read_json(os.path.join(mine[-1][1], "release.json"))["implementation"] == impl:
            print("%s: release %s already records implementation %s" % (contract, mine[-1][0], impl))
            continue
        commit, art = find_source(contract, code)
        if art is None:
            print("%s: NOT RECORDED. No commit of contracts/src rebuilds the code at %s. Build inputs with local changes: %s" % (contract, impl, inputs_dirty()))
            status = 1
            continue
        number = "%03d" % (int(mine[-1][0]) + 1 if mine else 1)
        out = os.path.join(RELEASES, str(chain.id), contract, number)
        os.makedirs(out)
        write_json(os.path.join(out, "abi.json"), art["abi"])
        write_json(os.path.join(out, "storage-layout.json"), layout.normalize(art["storageLayout"]))
        with open(os.path.join(out, "runtime.hex"), "w") as f:
            f.write(code + "\n")
        admin = chain.slot_address(proxy, ADMIN_SLOT)
        deps = {d: chain.call_address(proxy, d) for d in spec["deps"]}
        files = ["abi.json", "storage-layout.json", "runtime.hex"]
        write_json(
            os.path.join(out, "release.json"),
            {
                "contract": contract,
                "release": int(number),
                "network": NETWORKS.get(chain.id, "chain %d" % chain.id),
                "chainId": chain.id,
                "proxy": proxy,
                "proxyAdmin": admin,
                "implementation": impl,
                "runtimeCodeHash": keccak(code),
                "runtimeCodeSize": (len(code) - 2) // 2,
                "dependencies": deps,
                "immutableOffsets": immutable_offsets(code, art, deps),
                "sourceCommit": commit,
                "compiler": compiler_of(art),
                "sha256": {name: sha256(os.path.join(out, name)) for name in files},
            },
        )
        print("%s: recorded release %s: implementation %s, built from %s" % (contract, number, impl, commit[:7]))
    write_index(chain.id)
    return status


def verify(chain, source):
    status = 0

    def fail(msg):
        nonlocal status
        status = 1
        print("  FAIL " + msg)

    dep = deployment(chain.id)
    for contract, spec in CONTRACTS.items():
        mine = [(n, p) for c, n, p in layout.releases(contract) if c == str(chain.id)]
        if not mine:
            print("%s: no release for chain %d" % (contract, chain.id))
            status = 1
            continue
        proxy = checksum(dep[spec["key"]])
        live = chain.slot_address(proxy, IMPL_SLOT)
        for number, path in mine:
            r = read_json(os.path.join(path, "release.json"))
            print("%s release %s (%s)" % (contract, number, r["implementation"]))
            for name, digest in r["sha256"].items():
                if sha256(os.path.join(path, name)) != digest:
                    fail("%s was edited after the release was recorded" % name)
            code = chain.code(r["implementation"])
            with open(os.path.join(path, "runtime.hex")) as f:
                if f.read().strip() != code:
                    fail("runtime.hex is not the code at %s" % r["implementation"])
            if keccak(code) != r["runtimeCodeHash"]:
                fail("code hash on the chain differs from the recorded one")
            if r["proxy"] != proxy:
                fail("the proxy in deployments/%d.json is %s, the release says %s" % (chain.id, proxy, r["proxy"]))
            if source:
                with Worktree(r["sourceCommit"]) as root:
                    art = artifact(root, contract)
                how = match(code, art)
                if how != "exact":
                    fail("commit %s does not rebuild this bytecode (match: %s)" % (r["sourceCommit"][:7], how))
                elif layout.normalize(art["storageLayout"]) != read_json(os.path.join(path, "storage-layout.json")):
                    fail("the recorded storage layout is not the one commit %s builds" % r["sourceCommit"][:7])
                else:
                    print("  ok   commit %s rebuilds the bytecode and the storage layout exactly" % r["sourceCommit"][:7])
        latest = read_json(os.path.join(mine[-1][1], "release.json"))
        if latest["implementation"] != live:
            fail("the proxy runs %s, the latest release records %s: run `release.sh record`" % (live, latest["implementation"]))
        else:
            print("  ok   the proxy %s runs the latest release" % proxy)
        for d in spec["deps"]:
            if chain.call_address(proxy, d) != latest["dependencies"][d]:
                fail("dependency %s changed" % d)
        if chain.slot_address(proxy, ADMIN_SLOT) != latest["proxyAdmin"]:
            fail("the proxy admin changed")
    print("releases: %s" % ("verified" if status == 0 else "PROBLEMS FOUND"))
    return status


def check_impl(chain, contract, address):
    spec = CONTRACTS[contract]
    proxy = checksum(deployment(chain.id)[spec["key"]])
    address = checksum(address)
    code = chain.code(address)
    size = (len(code) - 2) // 2
    art = artifact(ROOT, contract)
    how = match(code, art)
    ok = how == "exact"
    print("%s candidate %s" % (contract, address))
    print("  code size           %d bytes (limit %d)" % (size, CODE_LIMIT))
    print("  code hash           %s" % keccak(code))
    print("  equals this build   %s%s" % ("yes" if ok else "NO (%s)" % how, " (build inputs have uncommitted changes)" if inputs_dirty() else ""))
    for d in spec["deps"]:
        want, got = chain.call_address(proxy, d), chain.call_address(address, d)
        same = want == got
        ok = ok and same
        print("  %-19s %s%s" % (d, got, "" if same else "  DIFFERS from the proxy's %s" % want))
    print("  current             %s" % chain.slot_address(proxy, IMPL_SLOT))
    print("safe to point the proxy at it: %s" % ("yes" if ok and not inputs_dirty() else "NO"))
    return 0 if ok and not inputs_dirty() else 1


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("record", "verify", "check-impl"):
        p = sub.add_parser(name)
        p.add_argument("--rpc", required=True, help="RPC url or an alias from foundry.toml")
        if name == "verify":
            p.add_argument("--source", action="store_true", help="rebuild every release from its commit")
        if name == "check-impl":
            p.add_argument("contract", choices=sorted(CONTRACTS))
            p.add_argument("address")
    a = ap.parse_args()
    chain = Chain(a.rpc)
    if a.cmd == "record":
        return record(chain)
    if a.cmd == "verify":
        return verify(chain, a.source)
    return check_impl(chain, a.contract, a.address)


if __name__ == "__main__":
    sys.exit(main())
