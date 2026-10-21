"""Exact offchain mirror of FishingGame math + the seed catalog parsed from contracts/script/GameSetup.sol.

Everything here is derived from the Solidity source so the economy report cannot drift from the contracts:
  * species/spots/baits/prices are regex-parsed from GameSetup.sol
  * catch chance, rarity boost, weight roll and sell value follow FishingGame.sol line by line
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SETUP = ROOT / "contracts" / "script" / "GameSetup.sol"
E = 10**18


def _num(expr: str) -> int:
    """Evaluate the tiny arithmetic used in GameSetup ('E * 7 / 10', '120 * E', '15 minutes', 'E / 2')."""
    expr = expr.replace("uint96(", "").replace(")", "").strip()
    expr = expr.replace("minutes", "* 60").replace("_", "")
    tokens = re.findall(r"\d+|E|[*/+-]", expr)
    out = tokens[0]
    val = E if out == "E" else int(out)
    i = 1
    while i < len(tokens):
        op, rhs = tokens[i], tokens[i + 1]
        r = E if rhs == "E" else int(rhs)
        val = {"*": val * r, "/": val // r, "+": val + r, "-": val - r}[op]
        i += 2
    return val


@dataclass(frozen=True)
class Species:
    id: int
    name: str
    rarity: int
    min_w: int
    max_w: int
    base_price: int  # wei

    @property
    def expected_value(self) -> float:
        """E[sell value] in PEARL. weight = min + (max-min)*min(u1,u2); E[min(u1,u2)] = 1/3."""
        avg = (self.min_w + self.max_w) // 2
        ew = self.min_w + (self.max_w - self.min_w) / 3
        return self.base_price * ew / avg / E


@dataclass(frozen=True)
class Spot:
    id: int
    name: str
    min_level: int
    energy: int
    species: tuple[int, ...]
    weights: tuple[int, ...]


@dataclass(frozen=True)
class Bait:
    id: int
    name: str
    price: float  # PEARL
    catch_bonus: int
    rarity_bonus: int


@dataclass
class Catalog:
    species: list[Species]
    spots: list[Spot]
    baits: list[Bait]
    config: dict[str, int]
    upgrade_prices: list[float]
    market_fee_bps: int


def load_catalog(path: Path = SETUP) -> Catalog:
    src = path.read_text()
    species = []
    for m in re.finditer(r'_sp\(f, "([^"]+)", (\d), (\d+), (\d+), ([^,]+), 0x', src):
        species.append(
            Species(len(species), m[1], int(m[2]), int(m[3]), int(m[4]), _num(m[5]))
        )
    tables = re.findall(
        r"_table\(\[uint16\((\d+)\), ([\d, ]+)\], \[uint16\((\d+)\), ([\d, ]+)\]\);\s*g\.addSpot\(\"([^\"]+)\", (\d+), (\d+)",
        src,
    )
    spots = []
    for t in tables:
        ids = (int(t[0]), *map(int, t[1].split(",")))
        ws = (int(t[2]), *map(int, t[3].split(",")))
        spots.append(Spot(len(spots), t[4], int(t[5]), int(t[6]), ids, ws))
    baits = [Bait(0, "None", 0.0, 0, 0)]
    for m in re.finditer(r'FishingGame\.Bait\("([^"]+)", ([^,]+), ([\d_]+), (\d+)\)', src):
        baits.append(Bait(len(baits), m[1], _num(m[2]) / E, int(m[3].replace("_", "")), int(m[4])))
    cfg_block = re.search(r"FishingGame\.Config\(\{(.*?)\}\)", src, re.S)[1]
    config = {k: _num(v) for k, v in re.findall(r"(\w+): ([^,\n]+)", cfg_block)}
    ups = [_num(v) / E for v in re.findall(r"up\[\d\] = (uint96\([^;]+\));", src)]
    fee = int(re.search(r"new Marketplace\(owner, d\.pearl, (\d+)\)", src)[1])
    cat = Catalog(species, spots, baits, config, ups, fee)
    assert len(species) == 20 and len(spots) == 5 and len(baits) == 4 and len(ups) == 4, "catalog parse failed"
    return cat


# ---------------------------------------------------------------- contract math


def catch_chance(cat: Catalog, level: int, bait: int) -> float:
    c = cat.config
    bps = c["baseCatchBps"] + c["catchBpsPerLevel"] * (level - 1) + cat.baits[bait].catch_bonus
    return min(bps, c["maxCatchBps"]) / 10_000


def species_probs(cat: Catalog, spot: int, level: int, bait: int) -> list[tuple[Species, float]]:
    sp = cat.spots[spot]
    boost = cat.config["rarityBoostPerLevel"] * (level - 1) + cat.baits[bait].rarity_bonus
    eff = [w * (100 + cat.species[s].rarity * boost) for s, w in zip(sp.species, sp.weights)]
    tot = sum(eff)
    return [(cat.species[s], e / tot) for s, e in zip(sp.species, eff)]


def repair_cost_per_cast(cat: Catalog, level: int) -> float:
    return cat.config["repairPricePerPoint"] * level / E


def ev_per_cast(cat: Catalog, spot: int, level: int, bait: int, include_costs: bool = True) -> float:
    """Expected PEARL from one cast (sold immediately at full price), minus bait and repair costs."""
    gross = catch_chance(cat, level, bait) * sum(s.expected_value * p for s, p in species_probs(cat, spot, level, bait))
    if not include_costs:
        return gross
    return gross - cat.baits[bait].price - repair_cost_per_cast(cat, level)


def best_strategy(cat: Catalog, level: int) -> tuple[int, int, float]:
    """(spot, bait, EV per energy) maximizing PEARL per energy for a rod level."""
    best = (0, 0, -1e18)
    for sp in cat.spots:
        if sp.min_level > level:
            continue
        for b in cat.baits:
            v = ev_per_cast(cat, sp.id, level, b.id) / sp.energy
            if v > best[2]:
                best = (sp.id, b.id, v)
    return best


def energy_per_day(cat: Catalog) -> float:
    return 86_400 / cat.config["energyRegenSeconds"]
