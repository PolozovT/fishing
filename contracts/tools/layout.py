#!/usr/bin/env python3
"""Storage layout of the upgradeable contracts: normalising it and deciding whether a new one may replace an old one.

A proxy keeps its storage when its code changes, so the new code must read every old slot the way the old code
wrote it. The rules checked here:

  * state variables: the old list is an exact prefix of the new one (same name, slot, offset and type);
  * every struct that the old layout stores: its old fields are an exact prefix of its new fields;
  * a struct that sits inline (a state variable, an array element, a field of another struct) keeps its size:
    growing it would move whatever is stored after it. Only a struct that is a mapping value may grow;
  * every other type the old layout stores (mappings, arrays, integers …) keeps its size, key, value and base.

What a storage layout cannot show, and so is NOT checked here: the meaning of a field (a unit, a bit mask, the
members of an enum), and anything kept outside the layout (immutables, constants, ERC-7201 namespaces).

    layout.py check       compare the current build with the latest release of every chain (contracts/releases)
    layout.py selftest    prove that the rules reject each kind of incompatible change
"""
import copy
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)  # contracts/
RELEASES = os.path.join(ROOT, "releases")
CONTRACTS = ["FishingGame", "Tournaments"]


def _norm(type_id):
    """`t_struct(Player)1234_storage` → `t_struct(Player)_storage`: AST ids differ from build to build."""
    return re.sub(r"\)\d+", ")", type_id)


def normalize(layout):
    """The compiler's storage layout without build-specific ids: {"storage": [...], "types": {...}}."""
    types = {}
    for type_id, t in (layout.get("types") or {}).items():
        n = {"encoding": t["encoding"], "label": t["label"], "numberOfBytes": int(t["numberOfBytes"])}
        for k in ("key", "value", "base"):
            if k in t:
                n[k] = _norm(t[k])
        if "members" in t:
            n["members"] = [_var(m) for m in t["members"]]
        key = _norm(type_id)
        if key in types and types[key] != n:
            raise SystemExit("two different types share the name %s: the layout cannot be compared by name" % key)
        types[key] = n
    return {"storage": [_var(s) for s in layout["storage"]], "types": types}


def _var(v):
    return {"label": v["label"], "slot": int(v["slot"]), "offset": int(v["offset"]), "type": _norm(v["type"])}


def _show(v):
    return "%s (slot %d, offset %d, %s)" % (v["label"], v["slot"], v["offset"], v["type"])


def _inline_structs(layout):
    """Structs that are stored inline somewhere, so must keep their size."""
    types, inline, seen = layout["types"], set(), set()

    def walk(type_id, may_grow):
        if (type_id, may_grow) in seen or type_id not in types:
            return
        seen.add((type_id, may_grow))
        t = types[type_id]
        if "members" in t:
            if not may_grow:
                inline.add(type_id)
            for m in t["members"]:
                walk(m["type"], False)
        elif t["encoding"] == "mapping":
            walk(t["value"], True)
        elif "base" in t:
            walk(t["base"], False)

    for v in layout["storage"]:
        walk(v["type"], False)
    return inline


def compare(old, new):
    """Problems that make `new` unsafe as an upgrade of `old` (both normalised). Empty list = compatible."""
    problems = []
    o, n = old["storage"], new["storage"]
    for i, was in enumerate(o):
        if i >= len(n):
            problems.append("state variable removed: %s" % _show(was))
        elif n[i] != was:
            problems.append("state variable changed: %s → %s" % (_show(was), _show(n[i])))
    inline = _inline_structs(new) | _inline_structs(old)
    for type_id, was in sorted(old["types"].items()):
        now = new["types"].get(type_id)
        if now is None:
            problems.append("type %s is gone" % type_id)
            continue
        for k in ("encoding", "label", "key", "value", "base"):
            if was.get(k) != now.get(k):
                problems.append("type %s: %s changed (%s → %s)" % (type_id, k, was.get(k), now.get(k)))
        if "members" not in was:
            if was["numberOfBytes"] != now["numberOfBytes"]:
                problems.append("type %s: size changed (%d → %d bytes)" % (type_id, was["numberOfBytes"], now["numberOfBytes"]))
            continue
        fields = now.get("members", [])
        for i, f in enumerate(was["members"]):
            if i >= len(fields):
                problems.append("%s: field removed: %s" % (was["label"], _show(f)))
            elif fields[i] != f:
                problems.append("%s: field changed: %s → %s" % (was["label"], _show(f), _show(fields[i])))
        if type_id in inline and was["numberOfBytes"] != now["numberOfBytes"]:
            problems.append(
                "%s is stored inline (a state variable, an array element or a field) and cannot grow: %d → %d bytes. "
                "Keep new data beside it, in a mapping by id" % (was["label"], was["numberOfBytes"], now["numberOfBytes"])
            )
    return problems


def added(old, new):
    """What an accepted upgrade appends: (state variables, struct fields)."""
    fields = sum(len(new["types"][k].get("members", [])) - len(t.get("members", [])) for k, t in old["types"].items() if k in new["types"])
    return len(new["storage"]) - len(old["storage"]), fields


def current(contract):
    r = subprocess.run(["forge", "inspect", "src/%s.sol:%s" % (contract, contract), "storage-layout", "--json"], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if r.returncode != 0:
        raise SystemExit("forge inspect failed for %s:\n%s" % (contract, r.stderr))
    return normalize(json.loads(r.stdout))


def releases(contract):
    """[(chainId, number, directory)] of every recorded release of a contract, oldest first per chain."""
    found = []
    if not os.path.isdir(RELEASES):
        return found
    for chain in sorted(os.listdir(RELEASES)):
        base = os.path.join(RELEASES, chain, contract)
        if not os.path.isdir(base):
            continue
        for number in sorted(d for d in os.listdir(base) if d.isdigit()):
            found.append((chain, number, os.path.join(base, number)))
    return found


def latest(contract):
    """The newest release of a contract on each chain: [(chainId, number, directory)]."""
    by_chain = {}
    for chain, number, path in releases(contract):
        by_chain[chain] = (chain, number, path)
    return [by_chain[c] for c in sorted(by_chain)]


def check():
    status = 0
    for contract in CONTRACTS:
        now = current(contract)
        baselines = latest(contract)
        if not baselines:
            print("%s: no release recorded under contracts/releases (run ./release.sh record <rpc>)" % contract)
            status = 1
        for chain, number, path in baselines:
            with open(os.path.join(path, "storage-layout.json")) as f:
                old = json.load(f)
            where = "releases/%s/%s/%s" % (chain, contract, number)
            problems = compare(old, now)
            if problems:
                status = 1
                print("%s: LAYOUT IS NOT COMPATIBLE with %s. An upgrade would corrupt player state:" % (contract, where))
                for p in problems:
                    print("  - " + p)
            else:
                print("%s: ok against %s (%d state variable(s) and %d struct field(s) appended)" % ((contract, where) + added(old, now)))
    return status


# ---------------------------------------------------------------------------------------------- self-test


def _sample():
    """A small layout with every shape the game uses: an inline struct, structs in a mapping and in an array."""
    raw = {
        "storage": [
            {"label": "_owner", "slot": "0", "offset": 0, "type": "t_address"},
            {"label": "config", "slot": "1", "offset": 0, "type": "t_struct(Config)10_storage"},
            {"label": "_items", "slot": "2", "offset": 0, "type": "t_array(t_struct(Item)20_storage)dyn_storage"},
            {"label": "players", "slot": "3", "offset": 0, "type": "t_mapping(t_address,t_struct(Player)30_storage)"},
            {"label": "durability", "slot": "4", "offset": 0, "type": "t_mapping(t_address,t_uint16)"},
        ],
        "types": {
            "t_address": {"encoding": "inplace", "label": "address", "numberOfBytes": "20"},
            "t_uint16": {"encoding": "inplace", "label": "uint16", "numberOfBytes": "2"},
            "t_uint32": {"encoding": "inplace", "label": "uint32", "numberOfBytes": "4"},
            "t_uint256": {"encoding": "inplace", "label": "uint256", "numberOfBytes": "32"},
            "t_struct(Effect)40_storage": {
                "encoding": "inplace", "label": "struct Effect", "numberOfBytes": "32",
                "members": [{"label": "mask", "slot": "0", "offset": 0, "type": "t_uint16"}],
            },
            "t_struct(Config)10_storage": {
                "encoding": "inplace", "label": "struct Config", "numberOfBytes": "32",
                "members": [
                    {"label": "maxEnergy", "slot": "0", "offset": 0, "type": "t_uint32"},
                    {"label": "biteBps", "slot": "0", "offset": 4, "type": "t_uint16"},
                    {"label": "maxBiteBps", "slot": "0", "offset": 6, "type": "t_uint16"},
                ],
            },
            "t_struct(Item)20_storage": {
                "encoding": "inplace", "label": "struct Item", "numberOfBytes": "64",
                "members": [
                    {"label": "price", "slot": "0", "offset": 0, "type": "t_uint32"},
                    {"label": "a", "slot": "1", "offset": 0, "type": "t_struct(Effect)40_storage"},
                ],
            },
            "t_struct(Player)30_storage": {
                "encoding": "inplace", "label": "struct Player", "numberOfBytes": "32",
                "members": [
                    {"label": "energy", "slot": "0", "offset": 0, "type": "t_uint32"},
                    {"label": "xp", "slot": "0", "offset": 4, "type": "t_uint32"},
                ],
            },
            "t_array(t_struct(Item)20_storage)dyn_storage": {"encoding": "dynamic_array", "label": "struct Item[]", "numberOfBytes": "32", "base": "t_struct(Item)20_storage"},
            "t_mapping(t_address,t_struct(Player)30_storage)": {"encoding": "mapping", "label": "mapping(address => struct Player)", "numberOfBytes": "32", "key": "t_address", "value": "t_struct(Player)30_storage"},
            "t_mapping(t_address,t_uint16)": {"encoding": "mapping", "label": "mapping(address => uint16)", "numberOfBytes": "32", "key": "t_address", "value": "t_uint16"},
        },
    }
    return raw


def selftest():
    base = normalize(_sample())
    # a different build numbers its types differently: that alone must not matter
    renumbered = json.loads(re.sub(r"\)(\d+)_storage", lambda m: ")%d_storage" % (int(m.group(1)) + 7), json.dumps(_sample())))
    assert compare(base, normalize(renumbered)) == [], "AST ids must not matter"

    def edit(fn):
        x = copy.deepcopy(base)
        fn(x)
        return x

    player, config, item, effect = "t_struct(Player)_storage", "t_struct(Config)_storage", "t_struct(Item)_storage", "t_struct(Effect)_storage"

    def grow(t, name, slot, offset, size=None):
        def fn(x):
            x["types"][t]["members"].append({"label": name, "slot": slot, "offset": offset, "type": "t_uint32"})
            if size:
                x["types"][t]["numberOfBytes"] = size
        return fn

    def insert_first(t):
        def fn(x):
            x["types"][t]["members"].insert(0, {"label": "flag", "slot": 0, "offset": 0, "type": "t_uint16"})
        return fn

    def swap(t):
        def fn(x):
            m = x["types"][t]["members"]
            m[1], m[2] = dict(m[2], offset=m[1]["offset"]), dict(m[1], offset=m[2]["offset"])
        return fn

    def retype(t, i, to):
        def fn(x):
            x["types"][t]["members"][i]["type"] = to
        return fn

    def drop_var(x):
        del x["storage"][-1]

    def move_var(x):
        x["storage"][3], x["storage"][4] = dict(x["storage"][4], slot=3), dict(x["storage"][3], slot=4)

    def rename_var(x):
        x["storage"][4]["label"] = "wear"

    def mapping_value(x):
        x["storage"][4]["type"] = "t_mapping(t_address,t_uint32)"
        x["types"]["t_mapping(t_address,t_uint32)"] = dict(x["types"]["t_mapping(t_address,t_uint16)"], value="t_uint32")

    def new_base_contract(x):
        for v in x["storage"]:
            v["slot"] += 1
        x["storage"].insert(0, {"label": "_status", "slot": 0, "offset": 0, "type": "t_uint256"})

    def append_var(x):
        x["storage"].append({"label": "seasons", "slot": 5, "offset": 0, "type": "t_uint256"})

    accepted = {
        "a state variable appended": append_var,
        "a field appended to a struct held in a mapping, inside its slot": grow(player, "level", 0, 8),
        "a field appended to a struct held in a mapping, into a new slot": grow(player, "level", 1, 0, 64),
        "a field appended to the inline config, inside its last slot": grow(config, "extra", 0, 8),
    }
    rejected = {
        "a state variable removed": drop_var,
        "two state variables swapped": move_var,
        "a state variable renamed": rename_var,
        "a mapping's value type changed": mapping_value,
        "a base contract with storage added in front": new_base_contract,
        "a field inserted at the start of a struct held in a mapping": insert_first(player),
        "two fields of the inline config swapped, size unchanged": swap(config),
        "a field of a struct held in a mapping retyped": retype(player, 1, "t_uint16"),
        "the inline config grown by a slot": grow(config, "extra", 1, 0, 64),
        "a struct held in an array grown by a slot": grow(item, "repair", 2, 0, 96),
        "a struct nested in an array element grown by a slot": grow(effect, "weight", 1, 0, 64),
        "a field of a struct nested in an array element retyped": retype(effect, 0, "t_uint32"),
    }
    for what, fn in accepted.items():
        problems = compare(base, edit(fn))
        assert problems == [], "should be accepted: %s, got %s" % (what, problems)
        print("accepted  %s" % what)
    for what, fn in rejected.items():
        assert compare(base, edit(fn)) != [], "should be rejected: %s" % what
        print("rejected  %s" % what)
    print("layout rules: %d compatible and %d incompatible changes told apart" % (len(accepted), len(rejected)))
    return 0


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "check"
    sys.exit({"check": check, "selftest": selftest}.get(cmd, lambda: (print(__doc__), 2)[1])())
