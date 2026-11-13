/**
 * The Tackle page: rods and reusable lures with different strengths, and a loadout estimate for a spot.
 * A design preview — the contracts know rod levels and consumable bait only, so nothing here can be bought
 * or affects a catch yet.
 */
import { RARITY_CLASS, RARITY_NAMES } from '../i18n';
import { h } from '../ui/dom';
import { LURES, RODS, SPOT_NAMES, BASE_CATCH, MAX_CATCH, loadout, type Effects, type TackleItem } from './catalog';
import { lureSprite, rodSprite } from './sprites';

const sel = { rod: 'carbon', lure: 'spoon' as string | null, spot: 0 };

const sign = (n: number): string => (n > 0 ? `+${n}` : String(n));

/** One stat row: label, a 10-segment bar scaled to `max`, and the value. */
function statRow(label: string, value: number, max: number, suffix: string, cls: string): HTMLElement {
  const segs = 10;
  const on = value <= 0 ? 0 : Math.max(1, Math.min(segs, Math.round((value / max) * segs)));
  return h(
    'div',
    { class: 'tk-stat' },
    h('span', { class: 'tk-stat-k', text: label }),
    h(
      'span',
      { class: `segbar tk-bar ${cls}`, attrs: { 'aria-hidden': 'true' } },
      Array.from({ length: segs }, (_, i) => h('span', { class: i < on ? 'seg on' : 'seg' })),
    ),
    h('span', { class: value ? 'tk-stat-v' : 'tk-stat-v dim', text: value ? `${sign(value)}${suffix}` : '—' }),
  );
}

function effectRows(e: Effects): HTMLElement[] {
  return [
    statRow('Catch', e.catch ?? 0, 10, '%', 'tk-catch'),
    statRow('Rarity', e.rarity ?? 0, 150, '%', 'tk-rarity'),
    statRow('Weight', e.weight ?? 0, 20, '%', 'tk-weight'),
  ];
}

function spotLine(item: TackleItem): HTMLElement | null {
  const s = item.spot;
  if (!s) return null;
  const parts = [s.catch ? `${sign(s.catch)}% catch` : '', s.rarity ? `${sign(s.rarity)}% rarity` : '', s.weight ? `${sign(s.weight)}% weight` : '']
    .filter(Boolean)
    .join(', ');
  return h(
    'div',
    { class: 'tk-spot' },
    h('span', { class: 'tk-spot-k', text: `Bonus ${s.label}` }),
    h('span', { class: 'tk-spot-v', text: parts }),
    h(
      'span',
      { class: 'tk-chips' },
      s.spots.map((i) => h('span', { class: 'tk-chip', text: SPOT_NAMES[i] })),
    ),
  );
}

function card(item: TackleItem, selected: boolean, onPick: () => void): HTMLElement {
  const sprite = item.kind === 'rod' ? rodSprite(item.id, item.name) : lureSprite(item.id, item.name);
  const wear = item.kind === 'rod' ? `${item.wear} durability` : `${item.wear} casts`;
  return h(
    'article',
    {
      class: `tk-card ${RARITY_CLASS[item.tier]}${selected ? ' sel' : ''}`,
      attrs: { tabindex: '0', role: 'button', 'aria-pressed': String(selected), 'aria-label': `${item.name}: use in the loadout` },
      onclick: onPick,
    },
    h(
      'div',
      { class: 'tk-card-top' },
      h('div', { class: 'tk-well' }, sprite),
      h(
        'div',
        { class: 'tk-head' },
        h('span', { class: `rarity ${RARITY_CLASS[item.tier]}`, text: RARITY_NAMES[item.tier] }),
        h('h4', { class: 'tk-name', text: item.name }),
        h('p', { class: 'tk-blurb', text: item.blurb }),
      ),
    ),
    h('div', { class: 'tk-stats' }, effectRows(item.base)),
    spotLine(item),
    h(
      'ul',
      { class: 'tk-perks' },
      item.pros.map((p) => h('li', { class: 'pro', text: p })),
      item.cons.map((c) => h('li', { class: 'con', text: c })),
    ),
    h(
      'div',
      { class: 'tk-foot' },
      h('span', { class: 'tk-wear', text: wear }),
      h('span', { class: 'tk-price' }, item.price ? h('span', { class: 'pearl', text: `${item.price} PEARL` }) : h('span', { class: 'muted', text: 'Starter' })),
      h('button', {
        class: 'btn btn-sm',
        disabled: true,
        text: 'Soon',
        title: 'Not onchain yet: rod types and lures need a contract update',
      }),
    ),
  );
}

function loadoutCard(rerender: () => void): HTMLElement {
  const rod = RODS.find((r) => r.id === sel.rod) ?? RODS[0];
  const lure = LURES.find((l) => l.id === sel.lure) ?? null;
  const l = loadout(rod, lure, sel.spot);
  const pct = (n: number) => `${n}%`;
  return h(
    'section',
    { class: 'card tk-loadout', attrs: { 'aria-label': 'Loadout estimate' } },
    h('h3', { text: 'Loadout' }),
    h(
      'div',
      { class: 'tk-lo-grid' },
      h(
        'div',
        { class: 'tk-lo-gear' },
        h('div', { class: 'tk-well sm' }, rodSprite(rod.id, rod.name, 2)),
        h('span', { class: 'tk-plus', text: '+' }),
        h('div', { class: 'tk-well sm' }, lure ? lureSprite(lure.id, lure.name, 3) : h('span', { class: 'muted small', text: 'no lure' })),
        h(
          'div',
          { class: 'tk-lo-names' },
          h('strong', { text: rod.name }),
          h('span', { class: 'muted', text: lure ? lure.name : 'No lure' }),
          lure ? h('button', { class: 'btn btn-ghost btn-sm', text: 'Remove lure', onclick: () => ((sel.lure = null), rerender()) }) : null,
        ),
      ),
      h(
        'div',
        { class: 'tk-lo-spots', attrs: { role: 'radiogroup', 'aria-label': 'Spot' } },
        SPOT_NAMES.map((name, i) =>
          h('button', {
            class: `tk-spotbtn${sel.spot === i ? ' active' : ''}`,
            text: name,
            attrs: { role: 'radio', 'aria-checked': String(sel.spot === i) },
            onclick: () => ((sel.spot = i), rerender()),
          }),
        ),
      ),
      h(
        'div',
        { class: 'tk-lo-out' },
        h('div', { class: 'tk-big' }, h('span', { class: 'k', text: 'Catch chance' }), h('span', { class: 'v', text: pct(l.catch) }), h('span', { class: 'd', text: `base ${BASE_CATCH}%, max ${MAX_CATCH}%` })),
        h('div', { class: 'tk-big' }, h('span', { class: 'k', text: 'Rare odds' }), h('span', { class: 'v', text: l.rarity ? `+${l.rarity}%` : '—' }), h('span', { class: 'd', text: 'per rarity tier' })),
        h('div', { class: 'tk-big' }, h('span', { class: 'k', text: 'Fish weight' }), h('span', { class: 'v', text: l.weight ? `+${l.weight}%` : '—' }), h('span', { class: 'd', text: 'and sell price' })),
        h(
          'div',
          { class: 'tk-big' },
          h('span', { class: 'k', text: 'Wear' }),
          h('span', { class: 'v', text: `${l.rodWear}` }),
          h('span', { class: 'd', text: lure ? `rod durability · lure ${l.lureCasts} casts` : 'rod durability' }),
        ),
      ),
    ),
    h('p', { class: 'tk-note', text: 'Estimate for a level 1 rod. Upgrades and bait still stack on top in the game.' }),
  );
}

export function initTackle(host: HTMLElement): () => void {
  const render = (): void => {
    const pickRod = (id: string) => () => {
      sel.rod = id;
      render();
    };
    const pickLure = (id: string) => () => {
      sel.lure = sel.lure === id ? null : id;
      render();
    };
    host.replaceChildren(
      h(
        'div',
        { class: 'tk-intro' },
        h('h2', { class: 'tk-title', text: 'Tackle' }),
        h(
          'p',
          { class: 'muted' },
          'Rods and lures with different strengths. Lures are reusable: put one on, and it wears out over its casts like a rod. ',
          h('span', { class: 'badge tk-badge', text: 'Preview · not onchain yet' }),
        ),
      ),
      loadoutCard(render),
      h('h3', { class: 'tk-section', text: 'Rods' }),
      h('div', { class: 'tk-grid' }, RODS.map((r) => card(r, sel.rod === r.id, pickRod(r.id)))),
      h('h3', { class: 'tk-section', text: 'Lures' }),
      h('div', { class: 'tk-grid' }, LURES.map((l) => card(l, sel.lure === l.id, pickLure(l.id)))),
    );
  };
  host.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement;
    if ((e.key === 'Enter' || e.key === ' ') && t.classList.contains('tk-card')) {
      e.preventDefault();
      t.click();
    }
  });
  render();
  return render;
}
