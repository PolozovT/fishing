/**
 * The Tackle page: rods and reusable lures, with a loadout estimate per location. In the local game it is the
 * shop (buy, equip, repair). With `shop` off (the onchain client, whose contracts know rod levels and bait only)
 * it stays a preview.
 */
import { buyLure, buyRod, equipLure, equipRod, activeSpecialOf, repairRod, rodRepairPrice } from '../game/actions';
import { LOCATIONS } from '../game/content';
import { itemEffects, totals } from '../game/equipment';
import { greenWidth } from '../game/minigame';
import { isUnlocked } from '../game/progress';
import type { Effects as Fx } from '../game/types';
import { RARITY_CLASS, RARITY_NAMES } from '../i18n';
import { apply, getSave, rev } from '../play/state';
import { h, icon, mount, sigOf } from '../ui/dom';
import { LURES, RODS, lureById, rodById, type Effects, type TackleItem } from './catalog';
import { lureSprite, rodSprite } from './sprites';

/** What the loadout card previews: starts as the equipped tackle at the current location. */
const view: { rod: string | null; lure: string | null | undefined; spot: number | null } = { rod: null, lure: undefined, spot: null };

const sign = (n: number): string => (n > 0 ? `+${n}` : String(n));
const pearl = (n: number): string => n.toLocaleString('en-US');

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
    statRow('Catch', e.catch ?? 0, 10, '', 'tk-catch'),
    statRow('Rarity', e.rarity ?? 0, 150, '', 'tk-rarity'),
    statRow('Weight', e.weight ?? 0, 20, '%', 'tk-weight'),
  ];
}

function spotLine(item: TackleItem): HTMLElement | null {
  const s = item.spot;
  if (!s) return null;
  const parts = [s.catch ? `${sign(s.catch)} catch` : '', s.rarity ? `${sign(s.rarity)} rarity` : '', s.weight ? `${sign(s.weight)}% weight` : '']
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
      s.spots.map((i) => h('span', { class: 'tk-chip', text: LOCATIONS[i].name })),
    ),
  );
}

/** "vs your Willow Rod here: +9 catch, +20 rarity" */
function versus(item: TackleItem, current: TackleItem | undefined, spot: number): HTMLElement | null {
  if (!current || current.id === item.id) return null;
  const a = itemEffects(item, LOCATIONS[spot]);
  const b = itemEffects(current, LOCATIONS[spot]);
  const d: Fx = { catch: a.catch - b.catch, rarity: a.rarity - b.rarity, weight: a.weight - b.weight };
  const parts = [d.catch ? `${sign(d.catch)} catch` : '', d.rarity ? `${sign(d.rarity)} rarity` : '', d.weight ? `${sign(d.weight)}% weight` : ''].filter(Boolean);
  const better = d.catch + d.rarity / 10 + d.weight;
  return h('div', { class: `tk-vs ${better > 0 ? 'up' : better < 0 ? 'down' : ''}`, text: `vs your ${current.name} at ${LOCATIONS[spot].name}: ${parts.length ? parts.join(', ') : 'the same'}` });
}

function button(text: string, onclick: (() => void) | null, opts: { primary?: boolean; title?: string; disabled?: boolean } = {}): HTMLElement {
  return h('button', {
    class: `btn btn-sm${opts.primary ? ' btn-primary' : ''}`,
    text,
    title: opts.title,
    disabled: opts.disabled ?? !onclick,
    onclick: (e) => {
      e.stopPropagation();
      onclick?.();
    },
  });
}

function actions(item: TackleItem, shop: boolean): HTMLElement[] {
  if (!shop) return [button('Soon', null, { title: 'Not onchain yet: rod types and lures need a contract update' })];
  const s = getSave();
  const short = s.pearl < item.price;
  const shortTitle = short ? `You need ${pearl(item.price - s.pearl)} more PEARL` : undefined;
  if (item.kind === 'rod') {
    if (!s.rods[item.id]) return [button(`Buy · ${pearl(item.price)}`, () => (apply((x) => buyRod(x, item.id)), (view.rod = item.id)), { primary: true, disabled: short, title: shortTitle })];
    const repair = rodRepairPrice(s, item.id);
    return [
      repair > 0 ? button(`Repair · ${pearl(repair)}`, () => void apply((x) => repairRod(x, item.id)), { disabled: s.pearl < repair }) : null,
      s.equipped.rod === item.id ? button('Equipped', null) : button('Equip', () => (apply((x) => equipRod(x, item.id)), (view.rod = item.id)), { primary: true }),
    ].filter((x): x is HTMLElement => !!x);
  }
  const own = s.lures[item.id];
  if (!own) return [button(`Buy · ${pearl(item.price)}`, () => (apply((x) => equipLure(buyLure(x, item.id), item.id)), (view.lure = item.id)), { primary: true, disabled: short, title: shortTitle })];
  return [
    button(`+${item.wear} casts · ${pearl(item.price)}`, () => void apply((x) => buyLure(x, item.id)), { disabled: short, title: shortTitle ?? 'Adds casts to the lure you already carry' }),
    s.equipped.lure === item.id
      ? button('Take off', () => (apply((x) => equipLure(x, null)), (view.lure = null)))
      : button('Equip', () => (apply((x) => equipLure(x, item.id)), (view.lure = item.id)), { primary: true }),
  ];
}

function card(item: TackleItem, selected: boolean, onPick: () => void, shop: boolean, spot: number): HTMLElement {
  const s = getSave();
  const sprite = item.kind === 'rod' ? rodSprite(item.id, item.name) : lureSprite(item.id, item.name);
  const owned = item.kind === 'rod' ? s.rods[item.id] : s.lures[item.id];
  const equipped = shop && (item.kind === 'rod' ? s.equipped.rod === item.id : s.equipped.lure === item.id);
  let wear: string;
  if (item.kind === 'rod') wear = item.wear === 0 ? 'Never wears out' : shop && s.rods[item.id] ? `${s.rods[item.id].durability}/${item.wear} durability` : `${item.wear} durability`;
  else wear = shop && s.lures[item.id] ? `${s.lures[item.id].casts} casts left` : `${item.wear} casts`;
  const current = item.kind === 'rod' ? rodById(s.equipped.rod) : lureById(s.equipped.lure);
  return h(
    'article',
    {
      class: `tk-card ${RARITY_CLASS[item.tier]}${selected ? ' sel' : ''}${shop && owned ? ' owned' : ''}`,
      attrs: { tabindex: '0', role: 'button', 'aria-pressed': String(selected), 'aria-label': `${item.name}: preview in the loadout` },
      onclick: onPick,
    },
    h(
      'div',
      { class: 'tk-card-top' },
      h('div', { class: 'tk-well' }, sprite),
      h(
        'div',
        { class: 'tk-head' },
        h('span', { class: 'tk-tags' }, h('span', { class: `rarity ${RARITY_CLASS[item.tier]}`, text: RARITY_NAMES[item.tier] }), equipped ? h('span', { class: 'badge badge-on', text: 'Equipped' }) : shop && owned ? h('span', { class: 'badge', text: 'Owned' }) : null),
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
    shop ? versus(item, current, spot) : null,
    h(
      'div',
      { class: 'tk-foot' },
      h('span', { class: 'tk-wear', text: wear }),
      h('span', { class: 'tk-price' }, item.price ? h('span', { class: 'pearl', text: `${pearl(item.price)} PEARL` }) : h('span', { class: 'muted', text: 'Starter' })),
      h('span', { class: 'tk-acts' }, actions(item, shop)),
    ),
  );
}

function loadoutCard(rod: TackleItem, lure: TackleItem | null, spot: number, shop: boolean, rerender: () => void): HTMLElement {
  const s = getSave();
  const loc = LOCATIONS[spot];
  const special = shop ? activeSpecialOf(s) : null;
  const t = totals(rod, lure, loc, special);
  const eqRod = rodById(s.equipped.rod) ?? RODS[0];
  const eqLure = lureById(s.equipped.lure) ?? null;
  const base = totals(eqRod, eqLure, loc, special);
  const previewing = shop && (rod.id !== eqRod.id || (lure?.id ?? null) !== (eqLure?.id ?? null));
  const delta = (now: number, was: number, unit = ''): HTMLElement | null =>
    previewing && now !== was ? h('span', { class: `delta ${now > was ? 'up' : 'down'}`, text: ` ${sign(Math.round((now - was) * 10) / 10)}${unit}` }) : null;
  const tile = (k: string, v: string, d: HTMLElement | null, hint: string): HTMLElement => h('div', { class: 'tk-big' }, h('span', { class: 'k', text: k }), h('span', { class: 'v' }, v, d), h('span', { class: 'd', text: hint }));
  return h(
    'section',
    { class: 'card tk-loadout', attrs: { 'aria-label': 'Loadout estimate' } },
    h('div', { class: 'dex-head' }, h('h3', { text: 'Loadout' }), previewing ? h('span', { class: 'badge', text: 'Preview · compared with your equipped tackle' }) : null),
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
          special ? h('span', { class: 'muted small', text: `+ ${special.name}: ${special.bonus.label}` }) : null,
          previewing ? h('button', { class: 'btn btn-ghost btn-sm', text: 'Back to equipped', onclick: () => ((view.rod = null), (view.lure = undefined), rerender()) }) : null,
        ),
      ),
      h(
        'div',
        { class: 'tk-lo-spots', attrs: { role: 'radiogroup', 'aria-label': 'Location' } },
        LOCATIONS.map((l) =>
          h(
            'button',
            {
              class: `tk-spotbtn${spot === l.id ? ' active' : ''}`,
              attrs: { role: 'radio', 'aria-checked': String(spot === l.id) },
              onclick: () => ((view.spot = l.id), rerender()),
            },
            shop && !isUnlocked(s, l) ? icon('lock', 'Locked') : null,
            l.name,
          ),
        ),
      ),
      h(
        'div',
        { class: 'tk-lo-out' },
        tile('Bite chance', `${t.biteChance}%`, delta(t.biteChance, base.biteChance), 'lure catch: more bites, sooner'),
        tile('Green zone', `${Math.round(greenWidth(t.zone) * 100)}%`, delta(Math.round(greenWidth(t.zone) * 100), Math.round(greenWidth(base.zone) * 100)), 'rod catch: wider safe tension band'),
        tile('Rare odds', t.total.rarity ? `+${t.total.rarity}` : '—', delta(t.total.rarity, base.total.rarity), 'weighting toward rarer fish'),
        tile('Fish weight', t.total.weight ? `+${t.total.weight}%` : '—', delta(t.total.weight, base.total.weight, '%'), 'heavier: more PEARL, more points'),
      ),
    ),
    h('p', {
      class: 'tk-note',
      text: 'Rarity is a relative weighting, not percentage points: +100 makes a Rare fish three times as likely against a Common one. Bonuses add up: rod + lure + location bonus + active special fish.',
    }),
  );
}

export function initTackle(host: HTMLElement, shop = false): () => void {
  const render = (): HTMLElement[] => {
    const s = getSave();
    const rod = rodById(view.rod ?? (shop ? s.equipped.rod : 'carbon')) ?? RODS[0];
    const lureId = view.lure === undefined ? (shop ? s.equipped.lure : 'spoon') : view.lure;
    const lure = lureById(lureId) ?? null;
    const spot = view.spot ?? (shop ? s.location : 0);
    const pickRod = (id: string) => () => {
      view.rod = id;
      rerender();
    };
    const pickLure = (id: string) => () => {
      view.lure = lure?.id === id ? null : id;
      rerender();
    };
    return [
      h(
        'div',
        { class: 'tk-intro' },
        h('h2', { class: 'tk-title', text: 'Tackle' }),
        h(
          'p',
          { class: 'muted' },
          'Rods and lures with different strengths. A rod makes the fight easier, a lure brings more bites; both can pull rarer and heavier fish. Lures are reusable and wear out over their casts. ',
          shop ? h('span', { class: 'badge tk-badge', text: `You have ${pearl(s.pearl)} PEARL` }) : h('span', { class: 'badge tk-badge', text: 'Preview · not onchain yet' }),
        ),
      ),
      loadoutCard(rod, lure, spot, shop, rerender),
      h('h3', { class: 'tk-section', text: 'Rods' }),
      h('div', { class: 'tk-grid' }, RODS.map((r) => card(r, rod.id === r.id, pickRod(r.id), shop, spot))),
      h('h3', { class: 'tk-section', text: 'Lures' }),
      h('div', { class: 'tk-grid' }, LURES.map((l) => card(l, lure?.id === l.id, pickLure(l.id), shop, spot))),
    ];
  };
  const rerender = mount(host, () => sigOf(rev(), view, shop), render);
  host.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement;
    if ((e.key === 'Enter' || e.key === ' ') && t.classList.contains('tk-card')) {
      e.preventDefault();
      t.click();
    }
  });
  rerender();
  return rerender;
}
