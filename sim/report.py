"""Builds sim/out/report.html (self-contained, inline SVG charts with hover tooltips) from sim/out/results.json."""
from __future__ import annotations

import html
import json
from pathlib import Path

OUT = Path(__file__).resolve().parent / "out"

W, H, PAD_L, PAD_R, PAD_T, PAD_B = 640, 260, 64, 16, 16, 32


def fmt(v: float) -> str:
    a = abs(v)
    if a >= 1e6:
        return f"{v / 1e6:.1f}M"
    if a >= 1e3:
        return f"{v / 1e3:.0f}k"
    if a >= 10:
        return f"{v:.0f}"
    return f"{v:.2f}"


def nice_max(v: float) -> float:
    if v <= 0:
        return 1
    import math

    p = 10 ** math.floor(math.log10(v))
    for m in (1, 2, 2.5, 5, 10):
        if m * p >= v:
            return m * p
    return 10 * p


def line_chart(cid: str, title: str, subtitle: str, x: list, series: list[tuple[str, list[float]]], unit: str = ""):
    ymax = nice_max(max(max(s) for _, s in series))
    xmax = max(x) or 1

    def px(i):
        return PAD_L + (W - PAD_L - PAD_R) * x[i] / xmax

    def py(v):
        return PAD_T + (H - PAD_T - PAD_B) * (1 - v / ymax)

    grid = []
    for k in range(5):
        v = ymax * k / 4
        y = py(v)
        grid.append(f'<line x1="{PAD_L}" x2="{W - PAD_R}" y1="{y:.1f}" y2="{y:.1f}" class="grid"/>')
        grid.append(f'<text x="{PAD_L - 8}" y="{y + 4:.1f}" class="tick" text-anchor="end">{fmt(v)}</text>')
    for d in range(0, xmax + 1, 15):
        grid.append(f'<text x="{PAD_L + (W - PAD_L - PAD_R) * d / xmax:.1f}" y="{H - 10}" class="tick" '
                    f'text-anchor="middle">{d}</text>')
    paths, labels = [], []
    for si, (name, ys) in enumerate(series):
        d = " ".join(f"{'M' if i == 0 else 'L'}{px(i):.1f},{py(v):.1f}" for i, v in enumerate(ys))
        paths.append(f'<path d="{d}" class="ln s{si + 1}"/>')
        labels.append(f'<span class="key"><i class="sw s{si + 1}"></i>{html.escape(name)}</span>')
    data = json.dumps({"x": x, "series": [{"name": n, "y": ys} for n, ys in series], "unit": unit}, ensure_ascii=False)
    return f"""
<figure class="chart" id="{cid}" data-w="{W}" data-h="{H}" data-pl="{PAD_L}" data-pr="{PAD_R}">
  <figcaption><b>{html.escape(title)}</b><span>{html.escape(subtitle)}</span></figcaption>
  <div class="legend">{''.join(labels)}</div>
  <div class="plot">
    <svg viewBox="0 0 {W} {H}" role="img" aria-label="{html.escape(title)}">
      {''.join(grid)}
      <line x1="{PAD_L}" x2="{W - PAD_R}" y1="{py(0):.1f}" y2="{py(0):.1f}" class="axis"/>
      {''.join(paths)}
      <line class="cross" y1="{PAD_T}" y2="{H - PAD_B}" x1="-10" x2="-10"/>
    </svg>
    <div class="tip" hidden></div>
  </div>
  <script type="application/json">{data}</script>
</figure>"""


def table(head: list[str], rows: list[list[str]], num_from: int = 1) -> str:
    th = "".join(f'<th class="{"n" if i >= num_from else ""}">{html.escape(h)}</th>' for i, h in enumerate(head))
    trs = "".join(
        "<tr>" + "".join(f'<td class="{"n" if i >= num_from else ""}">{c}</td>' for i, c in enumerate(r)) + "</tr>"
        for r in rows
    )
    return f'<div class="tbl"><table><thead><tr>{th}</tr></thead><tbody>{trs}</tbody></table></div>'


NAMES = {"casual": "Казуал", "regular": "Регуляр", "grinder": "Грайндер", "bot": "Бот", "sybil_farm": "Ферма (50 адр.)"}


def main():
    res = json.loads((OUT / "results.json").read_text())
    sc = {s["key"]: s for s in res["scenarios"]}
    x = [d["day"] for d in sc["v2"]["days"]]

    def col(key, field):
        return [d[field] for d in sc[key]["days"]]

    c1 = line_chart("supply-humans", "Объём PEARL в обороте, только живые игроки", "195 игроков, 90 дней",
                    x, [("v1 (черновик)", col("v1", "supply")), ("v2 (перебалансировка)", col("v2", "supply"))],
                    "PEARL")
    c2 = line_chart("supply-hostile", "Объём PEARL, v2 с ботами и фермами", "710 адресов, из них 500 — фермы",
                    x, [("без лимита эмиссии", col("v2_hostile", "supply")),
                        ("лимит 25 000 PEARL/день", col("v2_hostile_cap", "supply"))], "PEARL")
    def roll7(v):
        return [sum(v[max(0, i - 6): i + 1]) / len(v[max(0, i - 6): i + 1]) for i in range(len(v))]

    c3 = line_chart("mint-burn", "v2, только люди: выпуск и сжигание в день",
                    "скользящее среднее за 7 дней; сжигание = апгрейды, ремонт, наживка, рефиллы",
                    x, [("выпуск (продажа рыбы)", roll7(col("v2", "minted"))),
                        ("сжигание", roll7(col("v2", "burned_total")))], "PEARL/день")

    def arch_rows(key):
        rows = []
        for k, d in sc[key]["archetypes"].items():
            rows.append([NAMES.get(k, k), str(d["wallets"]), str(d["accounts"]), fmt(d["earned_per_wallet"]),
                         f'{d["casts_per_wallet"]:,.0f}'.replace(",", " "), f'{d["avg_level"]:.1f}',
                         f'{d["gas_per_pearl"]:,.0f}'.replace(",", " ")])
        return rows

    head = ["Архетип", "Кошельков", "Адресов", "Заработал PEARL / кошелёк", "Забросов / кошелёк", "Ур. удочки",
            "Газа на 1 PEARL"]

    def lvl_rows(key):
        rows = {}
        for r in sc[key]["strategies"]:
            cur = rows.get(r["level"])
            if cur is None or r["net_energy"] > cur["net_energy"]:
                rows[r["level"]] = r
        return rows

    l1, l2 = lvl_rows("v1"), lvl_rows("v2")
    ev_rows = [[f"Ур. {lv}", f'{l1[lv]["spot"]} / {l1[lv]["bait"]}', f'{l1[lv]["net_energy"]:.2f}',
                f'{l2[lv]["spot"]} / {l2[lv]["bait"]}', f'{l2[lv]["net_energy"]:.2f}'] for lv in sorted(l2)]

    def last(key, f):
        return sc[key]["days"][-1][f]

    def avg7(key, f):
        return sum(d[f] for d in sc[key]["days"][-7:]) / 7

    tiles = [
        ("Сжигание / выпуск, v1 → v2", f'{avg7("v1", "burned_total") / avg7("v1", "minted"):.2f} → '
                                      f'{avg7("v2", "burned_total") / avg7("v2", "minted"):.2f}', "последняя неделя, только люди"),
        ("PEARL в обороте на 90-й день", f'{fmt(last("v1", "supply"))} → {fmt(last("v2", "supply"))}', "v1 → v2, только люди"),
        ("Бот / грайндер, доход", f'{sc["v1_hostile"]["archetypes"]["bot"]["earned_per_wallet"] / sc["v1_hostile"]["archetypes"]["grinder"]["earned_per_wallet"]:.1f}× → '
                                  f'{sc["v2_hostile"]["archetypes"]["bot"]["earned_per_wallet"] / sc["v2_hostile"]["archetypes"]["grinder"]["earned_per_wallet"]:.1f}×',
         "v1 → v2: принтер рефиллов закрыт"),
        ("Ферма / грайндер, доход", f'{sc["v2_hostile"]["archetypes"]["sybil_farm"]["earned_per_wallet"] / sc["v2_hostile"]["archetypes"]["grinder"]["earned_per_wallet"]:.0f}×',
         "v2: = число адресов. Нерешённая проблема"),
    ]
    tiles_html = "".join(f'<div class="tile"><span>{html.escape(a)}</span><b>{b}</b><small>{html.escape(c)}</small></div>'
                         for a, b, c in tiles)

    page = f"""<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Экономика рыбалки</title>
<style>
:root {{ color-scheme: light; --surface:#fcfcfb; --card:#ffffff; --ink:#0b0b0b; --ink2:#52514e; --muted:#8a8984;
  --grid:#e8e7e3; --axis:#bdbcb6; --s1:#2a78d6; --s2:#eb6834; --border:#e6e5e0; }}
@media (prefers-color-scheme: dark) {{ :root:not([data-theme="light"]) {{ color-scheme: dark; --surface:#1a1a19;
  --card:#222220; --ink:#fff; --ink2:#c3c2b7; --muted:#8f8e86; --grid:#33332f; --axis:#55544f; --s1:#3987e5;
  --s2:#d95926; --border:#33332f; }} }}
:root[data-theme="dark"] {{ color-scheme: dark; --surface:#1a1a19; --card:#222220; --ink:#fff; --ink2:#c3c2b7;
  --muted:#8f8e86; --grid:#33332f; --axis:#55544f; --s1:#3987e5; --s2:#d95926; --border:#33332f; }}
* {{ box-sizing:border-box }}
body {{ margin:0; background:var(--surface); color:var(--ink); font:15px/1.5 system-ui,-apple-system,sans-serif; }}
main {{ max-width:880px; margin:0 auto; padding:32px 16px 64px; }}
h1 {{ font-size:26px; margin:0 0 4px }} h2 {{ font-size:18px; margin:36px 0 8px }}
p.lead {{ color:var(--ink2); margin:0 0 24px }}
.tiles {{ display:grid; grid-template-columns:repeat(auto-fit,minmax(190px,1fr)); gap:12px }}
.tile {{ background:var(--card); border:1px solid var(--border); border-radius:10px; padding:14px }}
.tile span {{ display:block; color:var(--ink2); font-size:13px }} .tile b {{ display:block; font-size:22px; margin:4px 0 }}
.tile small {{ color:var(--muted) }}
.chart {{ background:var(--card); border:1px solid var(--border); border-radius:10px; padding:14px; margin:16px 0 }}
figcaption b {{ display:block }} figcaption span {{ color:var(--ink2); font-size:13px }}
.legend {{ display:flex; gap:16px; flex-wrap:wrap; margin:8px 0; font-size:13px; color:var(--ink2) }}
.key {{ display:inline-flex; align-items:center; gap:6px }} .sw {{ width:14px; height:3px; border-radius:2px; display:inline-block }}
.sw.s1 {{ background:var(--s1) }} .sw.s2 {{ background:var(--s2) }}
.plot {{ position:relative }} svg {{ width:100%; height:auto; display:block }}
.grid {{ stroke:var(--grid); stroke-width:1 }} .axis {{ stroke:var(--axis); stroke-width:1 }}
.tick {{ fill:var(--muted); font-size:11px }} .ln {{ fill:none; stroke-width:2; stroke-linejoin:round }}
.ln.s1 {{ stroke:var(--s1) }} .ln.s2 {{ stroke:var(--s2) }} .cross {{ stroke:var(--axis); stroke-dasharray:3 3 }}
.tip {{ position:absolute; top:4px; pointer-events:none; background:var(--card); border:1px solid var(--border);
  border-radius:8px; padding:6px 10px; font-size:12px; box-shadow:0 2px 8px rgba(0,0,0,.12); white-space:nowrap }}
.tbl {{ overflow-x:auto; border:1px solid var(--border); border-radius:10px; background:var(--card) }}
table {{ border-collapse:collapse; width:100%; font-size:13px }} th,td {{ padding:8px 10px; border-bottom:1px solid var(--border); text-align:left }}
th {{ color:var(--ink2); font-weight:600 }} td.n,th.n {{ text-align:right; font-variant-numeric:tabular-nums }}
tr:last-child td {{ border-bottom:0 }}
</style></head><body><main>
<h1>Экономика ончейн-рыбалки</h1>
<p class="lead">Агентная симуляция на точной копии формул контракта: каждый заброс разыгрывается так же, как в FishingGame.sol.
Шесть сценариев по 90 дней, игроки приходят равномерно в первые 20 дней.</p>
<div class="tiles">{tiles_html}</div>

<h2>1. Перебалансировка сдержала инфляцию</h2>
{c1}
{c3}
<h2>2. Чистый доход за единицу энергии на лучшей стратегии</h2>
{table(["Удочка", "v1: место / наживка", "v1 PEARL/энергия", "v2: место / наживка", "v2 PEARL/энергия"], ev_rows, 2)}
<h2>3. Боты больше не выигрывают, а фермы выигрывают</h2>
{c2}
<p><b>v1 + боты и фермы</b></p>{table(head, arch_rows("v1_hostile"))}
<p><b>v2 + боты и фермы</b></p>{table(head, arch_rows("v2_hostile"))}
<p><b>v2 + боты и фермы + лимит эмиссии</b></p>{table(head, arch_rows("v2_hostile_cap"))}
<p style="color:var(--ink2);font-size:13px">«Газа на 1 PEARL» показывает, сколько газа тратится на добычу одной монеты. Боту выгодно фармить, если цена PEARL выше
«газ на PEARL × цена газа». Например, на L2 при 0.01 gwei 38 500 газа на PEARL ≈ 3.9·10⁻⁷ ETH, то есть меньше $0.001.</p>
</main>
<script>
document.querySelectorAll('.chart').forEach(fig => {{
  const d = JSON.parse(fig.querySelector('script[type="application/json"]').textContent);
  const svg = fig.querySelector('svg'), tip = fig.querySelector('.tip'), cross = fig.querySelector('.cross');
  const W = +fig.dataset.w, PL = +fig.dataset.pl, PR = +fig.dataset.pr, n = d.x.length;
  const f = v => Math.abs(v) >= 1e6 ? (v/1e6).toFixed(2)+'M' : Math.abs(v) >= 1e3 ? (v/1e3).toFixed(1)+'k' : v.toFixed(1);
  svg.addEventListener('pointermove', e => {{
    const r = svg.getBoundingClientRect(), vx = (e.clientX - r.left) * W / r.width;
    const i = Math.max(0, Math.min(n - 1, Math.round((vx - PL) / (W - PL - PR) * (n - 1))));
    const x = PL + (W - PL - PR) * i / (n - 1);
    cross.setAttribute('x1', x); cross.setAttribute('x2', x);
    tip.hidden = false;
    tip.innerHTML = '<b>День ' + d.x[i] + '</b><br>' + d.series.map((s, k) =>
      '<span class="sw s' + (k+1) + '"></span> ' + s.name + ': <b>' + f(s.y[i]) + '</b>').join('<br>');
    const px = x * r.width / W;
    tip.style.left = (px > r.width / 2 ? px - tip.offsetWidth - 12 : px + 12) + 'px';
  }});
  svg.addEventListener('pointerleave', () => {{ tip.hidden = true; cross.setAttribute('x1', -10); cross.setAttribute('x2', -10); }});
}});
</script></body></html>"""
    (OUT / "report.html").write_text(page)
    print("written", OUT / "report.html")


if __name__ == "__main__":
    main()
