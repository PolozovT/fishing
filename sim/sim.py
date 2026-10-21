"""Agent-based economy simulation for Onchain Fishing.

Each scenario = contract config overrides + a population of player archetypes. Every cast is sampled with the exact
contract math from model.py (catch roll, weighted species pick with rarity boost, min-of-two-uniforms weight).
Rods are tracked individually (level, durability); balances never go negative; a "farm" is one wallet operating
many addresses (each address has its own energy and its own free starter rod).

Usage:  python3 -I sim/sim.py   → prints a summary, writes sim/out/results.json
"""
from __future__ import annotations

import json
import random
import sys
from dataclasses import dataclass, field, replace
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import model  # noqa: E402

OUT = Path(__file__).resolve().parent / "out"
E = model.E

GAS_PER_CAST = 320_000  # cast + reel with a catch, measured with `forge test --gas-report`
GAS_PER_ACCOUNT_DAY = 60_000  # one sellFish batch per account per day


# ---------------------------------------------------------------- archetypes


@dataclass(frozen=True)
class Archetype:
    name: str
    activity: float  # share of regenerated energy actually used (people do not play 24/7)
    max_refills: int  # paid refills per address per day it is willing to buy (only when profitable)
    upgrades: bool
    keeps_rarity: int  # keeps fish with rarity >= this (5 = sells everything)
    accounts: int = 1  # addresses run from one wallet
    payback_days: float = 30.0  # buys an upgrade only if it pays back within this many days


CASUAL = Archetype("casual", activity=0.35, max_refills=0, upgrades=True, keeps_rarity=3, payback_days=1e9)
REGULAR = Archetype("regular", activity=0.7, max_refills=1, upgrades=True, keeps_rarity=4, payback_days=1e9)
GRINDER = Archetype("grinder", activity=1.0, max_refills=4, upgrades=True, keeps_rarity=5, payback_days=1e9)
BOT = Archetype("bot", activity=1.0, max_refills=48, upgrades=True, keeps_rarity=5, payback_days=60)
FARM = Archetype("sybil_farm", activity=1.0, max_refills=48, upgrades=True, keeps_rarity=5, accounts=50,
                 payback_days=60)

DEFAULT_MIX = ((CASUAL, 120), (REGULAR, 60), (GRINDER, 15))
HOSTILE_MIX = ((CASUAL, 120), (REGULAR, 60), (GRINDER, 15), (BOT, 15), (FARM, 10))


@dataclass
class Rod:
    level: int
    durability: int
    max_dur: int


@dataclass
class Account:
    rod: Rod | None
    alive: bool = True


@dataclass
class Player:
    kind: Archetype
    joined: int
    accounts: list[Account]
    pearl: float = 0.0
    held_value: float = 0.0
    earned: float = 0.0
    spent: float = 0.0
    casts: int = 0


@dataclass(frozen=True)
class Scenario:
    key: str
    title: str
    description: str
    days: int = 60
    mix: tuple = DEFAULT_MIX
    config: dict = field(default_factory=dict)  # overrides of the onchain Config (wei where the contract uses wei)
    upgrade_prices: tuple | None = None
    growth_days: int = 20
    seed: int = 7
    catalog: str = "current"  # "current" = contracts/script/GameSetup.sol, "v1" = sim/GameSetup_v1.sol (first draft)


# ---------------------------------------------------------------- engine


class Engine:
    def __init__(self, sc: Scenario):
        self.sc = sc
        self.rng = random.Random(sc.seed)
        path = model.SETUP if sc.catalog == "current" else Path(__file__).resolve().parent / "GameSetup_v1.sol"
        base = model.load_catalog(path)
        cfg = {"refillPriceGrowthBps": 10_000, "minRepairLevel": 1, "starterRodFee": 0}  # v1 lacked these
        cfg.update(base.config)
        cfg.update(sc.config)
        self.cat = replace(base, config=cfg, upgrade_prices=list(sc.upgrade_prices or base.upgrade_prices))
        self.cfg = cfg
        self.cap = cfg["emissionSoftCap"] / E
        self.energy_day = model.energy_per_day(self.cat)
        self.max_level = min(cfg["maxRodLevel"], len(self.cat.upgrade_prices) + 1)
        self.strategy = {lvl: self._best(lvl) for lvl in range(1, self.max_level + 1)}
        self._tables = {}
        self.players: list[Player] = []
        self.supply = 0.0
        self.minted_today = 0.0

    # -- economics helpers ------------------------------------------------------------------------------

    def _repairable(self, level):
        return level >= self.cfg["minRepairLevel"]

    def _wear_cost(self, level):
        """PEARL cost of one durability point: repair price, or rod replacement for consumable rods."""
        if self._repairable(level):
            return model.repair_cost_per_cast(self.cat, level)
        return self.cfg["rodPrice"] / E / self.cfg["starterDurability"]

    def _best(self, level):
        best = (0, 0, -1e18)
        for sp in self.cat.spots:
            if sp.min_level > level:
                continue
            for b in self.cat.baits:
                gross = model.ev_per_cast(self.cat, sp.id, level, b.id, include_costs=False)
                v = (gross - b.price - self._wear_cost(level)) / sp.energy
                if v > best[2]:
                    best = (sp.id, b.id, v)
        return best

    def _refill_price(self, k):
        return self.cfg["energyRefillPrice"] / E * (self.cfg["refillPriceGrowthBps"] / 10_000) ** k

    def _table(self, spot, level, bait):
        key = (spot, level, bait)
        if key not in self._tables:
            acc, cum = 0.0, []
            for s, p in model.species_probs(self.cat, spot, level, bait):
                acc += p
                cum.append((acc, s))
            self._tables[key] = cum
        return self._tables[key]

    def _cast(self, level, spot, bait):
        if self.rng.random() >= model.catch_chance(self.cat, level, bait):
            return None
        x = self.rng.random()
        for acc, s in self._table(spot, level, bait):
            if x < acc:
                break
        u = min(self.rng.random(), self.rng.random())
        w = s.min_w + (s.max_w - s.min_w) * u
        return s.base_price / E * w / ((s.min_w + s.max_w) // 2), s.rarity

    def _new_rod(self):
        d = self.cfg["starterDurability"]
        return Rod(1, d, d)

    # -- player actions ---------------------------------------------------------------------------------

    def _spend(self, p: Player, amount: float, bucket: str, burned: dict) -> bool:
        if p.pearl + 1e-12 < amount:
            return False
        p.pearl -= amount
        p.spent += amount
        burned[bucket] += amount
        return True

    def _try_upgrade(self, p: Player, acc: Account, burned: dict) -> bool:
        r = acc.rod
        if not p.kind.upgrades or r is None or r.level >= self.max_level:
            return False
        price = self.cat.upgrade_prices[r.level - 1]
        gain_per_day = (self.strategy[r.level + 1][2] - max(self.strategy[r.level][2], 0)) * self.energy_day
        gain_per_day *= p.kind.activity
        if gain_per_day <= 0 or price / gain_per_day > p.kind.payback_days:
            return False
        if not self._spend(p, price, "upgrade", burned):
            return False
        r.level += 1
        r.max_dur += self.cfg["durabilityPerLevel"]
        r.durability = r.max_dur
        return True

    def _fix_rod(self, p: Player, acc: Account, burned: dict) -> bool:
        """Called when the rod is broken. Returns True if the account can keep fishing."""
        r = acc.rod
        if self._repairable(r.level):
            cost = (r.max_dur - r.durability) * self.cfg["repairPricePerPoint"] / E * r.level
            if self._spend(p, cost, "repair", burned):
                r.durability = r.max_dur
                return True
        if self._try_upgrade(p, acc, burned):
            return True
        # consumable rod: buy a new one if a full rod's lifetime is profitable
        lifetime = self.strategy[1][2] * self.cat.spots[self.strategy[1][0]].energy * self.cfg["starterDurability"]
        if lifetime > 0 and self._spend(p, self.cfg["rodPrice"] / E, "rods", burned):
            acc.rod = self._new_rod()
            return True
        return False

    def _sell(self, p: Player, value: float):
        pay = value if (self.cap == 0 or self.minted_today < self.cap) else value * self.cap / self.minted_today
        self.minted_today += pay
        p.pearl += pay
        p.earned += pay
        return pay

    def _play_account(self, p: Player, acc: Account, first_day: bool, burned: dict) -> int:
        if acc.rod is None:
            return 0
        spot, bait, ev = self.strategy[acc.rod.level]
        sp = self.cat.spots[spot]
        energy = self.energy_day * p.kind.activity + (self.cfg["maxEnergy"] if first_day else 0)
        casts = 0
        refills = 0
        while True:
            # use the tank
            while energy >= sp.energy:
                lvl = acc.rod.level
                if acc.rod.durability == 0 and not self._fix_rod(p, acc, burned):
                    return casts
                if acc.rod.level != lvl:
                    spot, bait, ev = self.strategy[acc.rod.level]
                    sp = self.cat.spots[spot]
                    if energy < sp.energy:
                        break
                use_bait = bait if bait and self._spend(p, self.cat.baits[bait].price, "bait", burned) else 0
                energy -= sp.energy
                acc.rod.durability -= 1
                casts += 1
                res = self._cast(acc.rod.level, spot, use_bait)
                if res is not None:
                    value, rarity = res
                    if rarity >= p.kind.keeps_rarity:
                        p.held_value += value
                    else:
                        self._sell(p, value)  # sold right away (players batch, the cap makes order matter)
            # buy another tank only while it is profitable at the current payout ratio
            if refills >= p.kind.max_refills:
                return casts
            price = self._refill_price(refills)
            ratio = 1.0 if self.cap == 0 or self.minted_today < self.cap else self.cap / self.minted_today
            if ev * ratio * self.cfg["maxEnergy"] <= price or not self._spend(p, price, "refill", burned):
                return casts
            energy += self.cfg["maxEnergy"]
            refills += 1

    def _join(self, day):
        frac = min(1.0, (day + 1) / self.sc.growth_days)
        for kind, n in self.sc.mix:
            have = sum(1 for p in self.players if p.kind is kind)
            for _ in range(round(n * frac) - have):
                accs = [Account(self._new_rod()) for _ in range(kind.accounts)]
                self.players.append(Player(kind, day, accs))

    def run(self):
        out = []
        for day in range(self.sc.days):
            self._join(day)
            self.minted_today = 0.0
            burned = {"bait": 0.0, "repair": 0.0, "refill": 0.0, "upgrade": 0.0, "rods": 0.0}
            order = [(p, a) for p in self.players for a in p.accounts]
            self.rng.shuffle(order)  # who sells first matters under the cap
            casts = 0
            for p, a in order:
                n = self._play_account(p, a, p.joined == day, burned)
                casts += n
                p.casts += n
            for p in self.players:  # end-of-day upgrades (best rod first)
                for a in sorted(p.accounts, key=lambda a: -(a.rod.level if a.rod else 0)):
                    while self._try_upgrade(p, a, burned):
                        pass
            self.supply += self.minted_today - sum(burned.values())
            levels = [0] * 5
            active = 0
            for p in self.players:
                for a in p.accounts:
                    if a.rod:
                        levels[a.rod.level - 1] += 1
            for p in self.players:
                active += 1 if p.casts else 0
            accounts = sum(levels)
            by_kind = {}
            for p in self.players:
                if p.kind.accounts == 1:
                    by_kind.setdefault(p.kind.name, []).append(p.accounts[0].rod.level if p.accounts[0].rod else 0)
            arch_levels = {k: sum(v) / len(v) for k, v in by_kind.items()}
            out.append(
                {
                    "day": day,
                    "accounts": accounts,
                    "supply": self.supply,
                    "minted": self.minted_today,
                    "burned": dict(burned),
                    "burned_total": sum(burned.values()),
                    "avg_level": sum((i + 1) * c for i, c in enumerate(levels)) / max(accounts, 1),
                    "level_dist": levels,
                    "casts": casts,
                    "held_fish_value": sum(p.held_value for p in self.players),
                    "arch_levels": arch_levels,
                }
            )
        return out

    def archetypes(self):
        res = {}
        for p in self.players:
            d = res.setdefault(
                p.kind.name,
                {"wallets": 0, "accounts": 0, "earned": 0.0, "spent": 0.0, "casts": 0, "level_sum": 0, "net": 0.0},
            )
            d["wallets"] += 1
            d["accounts"] += len(p.accounts)
            d["earned"] += p.earned
            d["spent"] += p.spent
            d["net"] += p.pearl + p.held_value
            d["casts"] += p.casts
            d["level_sum"] += sum(a.rod.level for a in p.accounts if a.rod)
        for d in res.values():
            w = d["wallets"]
            d["earned_per_wallet"] = d["earned"] / w
            d["net_per_wallet"] = d["net"] / w
            d["casts_per_wallet"] = d["casts"] / w
            d["avg_level"] = d["level_sum"] / max(d["accounts"], 1)
            d["gas_per_wallet"] = d["casts_per_wallet"] * GAS_PER_CAST + GAS_PER_ACCOUNT_DAY * (
                d["accounts"] / w
            ) * self.sc.days
            # PEARL price (in ETH) above which the wallet's gas is covered: gas_eth / pearl_earned
            d["gas_per_pearl"] = d["gas_per_wallet"] / max(d["earned_per_wallet"], 1e-9)
        return res


# ---------------------------------------------------------------- scenarios

SCENARIOS = [
    Scenario("v1", "Черновик v1, только люди", "Первые параметры: рефилл 12 PEARL без роста, апгрейды 60/220/700/2000.",
             days=90, catalog="v1"),
    Scenario("v1_hostile", "Черновик v1 + боты и фермы",
             "То же + 15 ботов (до 48 рефиллов в день) и 10 ферм по 50 адресов.", days=90, catalog="v1",
             mix=HOSTILE_MIX),
    Scenario("v2", "v2, только люди",
             "Текущие параметры: рефилл 20 PEARL ×2 за каждый следующий за день, апгрейды 80/450/1500/5000, "
             "цены рыб выровнены (≈×1.6 дохода за уровень).", days=90),
    Scenario("v2_hostile", "v2 + боты и фермы", "Текущие параметры, враждебная популяция, без лимита эмиссии.",
             days=90, mix=HOSTILE_MIX),
    Scenario("v2_hostile_cap", "v2 + боты и фермы + лимит эмиссии",
             "То же + emissionSoftCap = 25 000 PEARL/день (≈ дневная эмиссия 195 живых игроков).", days=90,
             mix=HOSTILE_MIX, config={"emissionSoftCap": 25_000 * E}),
    Scenario("v2_cap", "v2 + лимит эмиссии, только люди",
             "Проверка, что лимит не душит живых игроков, когда ботов нет.", days=90,
             config={"emissionSoftCap": 25_000 * E}),
]


def strategy_table(eng: Engine):
    rows = []
    for lvl in range(1, eng.max_level + 1):
        for sp in eng.cat.spots:
            if sp.min_level > lvl:
                continue
            for b in eng.cat.baits:
                gross = model.ev_per_cast(eng.cat, sp.id, lvl, b.id, include_costs=False)
                net = gross - b.price - eng._wear_cost(lvl)
                rows.append(
                    {"level": lvl, "spot": sp.name, "bait": b.name, "catch": model.catch_chance(eng.cat, lvl, b.id),
                     "gross_cast": gross, "net_cast": net, "net_energy": net / sp.energy}
                )
    return rows


def run_all(scenarios=SCENARIOS, quiet=False):
    results = []
    for sc in scenarios:
        eng = Engine(sc)
        days = eng.run()
        arch = eng.archetypes()
        results.append(
            {"key": sc.key, "title": sc.title, "description": sc.description, "config": eng.cfg,
             "upgrade_prices": eng.cat.upgrade_prices, "days": days, "archetypes": arch,
             "strategies": strategy_table(eng)}
        )
        if quiet:
            continue
        last = days[-1]
        tail = days[-7:]
        mint7 = sum(d["minted"] for d in tail) / 7
        burn7 = sum(d["burned_total"] for d in tail) / 7
        print(f"\n=== {sc.key}: {sc.title}")
        print(f"  day {last['day']}: accounts={last['accounts']} supply={last['supply']:,.0f} "
              f"mint/day={mint7:,.0f} burn/day={burn7:,.0f} sink/source={burn7 / max(mint7, 1):.2f} "
              f"avgLvl={last['avg_level']:.2f} dist={last['level_dist']}")
        for k, d in arch.items():
            print(f"  {k:11s} wallets={d['wallets']:3d} earned/w={d['earned_per_wallet']:11,.0f} "
                  f"net/w={d['net_per_wallet']:10,.0f} casts/w={d['casts_per_wallet']:9,.0f} "
                  f"lvl={d['avg_level']:.2f} gas/PEARL={d['gas_per_pearl']:,.0f}")
    return results


def main():
    OUT.mkdir(exist_ok=True)
    results = run_all()
    cat = model.load_catalog()
    payload = {
        "gas_per_cast": GAS_PER_CAST,
        "catalog": {
            "species": [s.__dict__ | {"base_price": s.base_price / E, "ev": s.expected_value} for s in cat.species],
            "spots": [s.__dict__ for s in cat.spots],
            "baits": [b.__dict__ for b in cat.baits],
        },
        "scenarios": results,
    }
    (OUT / "results.json").write_text(json.dumps(payload, ensure_ascii=False, indent=1, default=float))
    print(f"\nwritten {OUT / 'results.json'}")


if __name__ == "__main__":
    main()
