/** Keepnet: the fish you hold. Sort, filter, star favourites, sell one, several, or everything eligible. */
import { bulkSellable, isValuable, sellFish, toggleFavorite } from '../../game/actions';
import { LOCATIONS, SPECIES } from '../../game/content';
import type { FishInstance } from '../../game/types';
import { RARITY_CLASS, RARITY_NAMES } from '../../i18n';
import { fmtWeight, h, mount, sigOf } from '../../ui/dom';
import { dropdown } from '../../ui/dropdown';
import { toast } from '../../ui/toast';
import { fishArt } from '../fishSprite';
import { act, apply, getSave, rev } from '../state';
import { ago, pearl, qualityTag, rarityTag } from './fmt';

type Sort = 'date' | 'rarity' | 'weight' | 'value';
const SORTS: [Sort, string][] = [
  ['date', 'Newest'],
  ['value', 'Value'],
  ['rarity', 'Rarity'],
  ['weight', 'Weight'],
];
const ui = { sort: 'date' as Sort, rarity: -1, location: -1 };
const selected = new Set<string>();
/** What the armed confirm button is about to sell, as a signature of ids. */
let confirming: string | null = null;

export function initKeepnet(host: HTMLElement): () => void {
  const rerender = mount(
    host,
    () => sigOf(rev(), ui, [...selected], confirming),
    () => render(rerender),
  );
  return rerender;
}

function sorted(list: FishInstance[]): FishInstance[] {
  const by: Record<Sort, (a: FishInstance, b: FishInstance) => number> = {
    date: (a, b) => b.caughtAt - a.caughtAt,
    value: (a, b) => b.sellPrice - a.sellPrice,
    rarity: (a, b) => b.rarity - a.rarity || b.sellPrice - a.sellPrice,
    weight: (a, b) => b.weight - a.weight,
  };
  return [...list].sort(by[ui.sort]);
}

function select<T extends string | number>(label: string, value: T, options: [T, string][], onPick: (v: string) => void): HTMLElement {
  return dropdown({ label, value: String(value), small: true, options: options.map(([v, text]) => ({ value: String(v), label: text })), onPick });
}

function render(rerender: () => void): HTMLElement[] {
  const s = getSave();
  for (const id of [...selected]) if (!s.fish.some((f) => f.id === id && bulkSellable(f))) selected.delete(id);

  const shown = sorted(s.fish.filter((f) => (ui.rarity < 0 || f.rarity === ui.rarity) && (ui.location < 0 || f.locationId === ui.location)));
  const eligible = shown.filter(bulkSellable);
  const picked = s.fish.filter((f) => selected.has(f.id));
  const pickedValue = picked.reduce((a, f) => a + f.sellPrice, 0);
  const allValue = s.fish.reduce((a, f) => a + f.sellPrice, 0);
  const eligibleValue = eligible.reduce((a, f) => a + f.sellPrice, 0);

  /** Sells `list`; a sale that includes valuable fish needs a second click on the same button. */
  const sell = (list: FishInstance[], key: string): void => {
    const ids = list.map((f) => f.id);
    const sig = `${key}:${ids.join(',')}`;
    if (list.some(isValuable) && confirming !== sig) {
      confirming = sig;
      rerender();
      return;
    }
    confirming = null;
    const r = act(
      (x) => sellFish(x, ids),
      (x) => x.save,
    );
    if (r) {
      ids.forEach((id) => selected.delete(id));
      toast(`Sold ${ids.length} fish for ${pearl(r.earned)} PEARL`, 'ok');
    }
    rerender();
  };
  const armed = (key: string, list: FishInstance[]): boolean => confirming === `${key}:${list.map((f) => f.id).join(',')}`;
  const valuableIn = (list: FishInstance[]): number => list.filter(isValuable).length;

  const rarities = [...new Set(s.fish.map((f) => f.rarity))].sort();
  const locs = [...new Set(s.fish.map((f) => f.locationId))].sort();
  const toolbar = h(
    'div',
    { class: 'toolbar' },
    h('span', { class: 'muted', text: `Fish: ${s.fish.length} · worth ${pearl(allValue)} PEARL` }),
    h('div', { class: 'spacer' }),
    select('Sort', ui.sort, SORTS, (v) => ((ui.sort = v as Sort), rerender())),
    select('Rarity', ui.rarity, [[-1, 'All rarities'], ...rarities.map((r) => [r, RARITY_NAMES[r]] as [number, string])], (v) => ((ui.rarity = Number(v)), rerender())),
    select('Location', ui.location, [[-1, 'All locations'], ...locs.map((l) => [l, LOCATIONS[l].name] as [number, string])], (v) => ((ui.location = Number(v)), rerender())),
  );
  const actions = h(
    'div',
    { class: 'toolbar' },
    h('button', {
      class: 'btn btn-ghost btn-sm',
      disabled: eligible.length === 0,
      text: eligible.length > 0 && eligible.every((f) => selected.has(f.id)) ? 'Deselect all' : 'Select all',
      onclick: () => {
        if (eligible.every((f) => selected.has(f.id))) eligible.forEach((f) => selected.delete(f.id));
        else eligible.forEach((f) => selected.add(f.id));
        confirming = null;
        rerender();
      },
    }),
    h('div', { class: 'spacer' }),
    h('button', {
      class: `btn btn-sm${armed('sel', picked) ? ' btn-danger' : ' btn-primary'}`,
      disabled: picked.length === 0,
      text: armed('sel', picked) ? `Confirm: ${valuableIn(picked)} valuable fish` : `Sell selected (${picked.length}) · ${pearl(pickedValue)}`,
      onclick: () => sell(picked, 'sel'),
    }),
    h('button', {
      class: `btn btn-sm${armed('all', eligible) ? ' btn-danger' : ''}`,
      disabled: eligible.length === 0,
      title: 'Sells every fish shown here except favourites and special fish',
      text: armed('all', eligible) ? `Confirm: ${valuableIn(eligible)} valuable fish` : `Sell all (${eligible.length}) · ${pearl(eligibleValue)}`,
      onclick: () => sell(eligible, 'all'),
    }),
  );
  if (s.fish.length === 0) return [toolbar, h('p', { class: 'empty', text: 'Your keepnet is empty. Go cast a line!' })];

  const grid = h(
    'div',
    { class: 'grid' },
    shown.map((f) => {
      const sp = SPECIES[f.speciesId];
      const can = bulkSellable(f);
      const on = selected.has(f.id);
      const card = h(
        'div',
        {
          class: `item pick ${on ? 'sel' : ''} ${RARITY_CLASS[f.rarity]}${can ? '' : ' kept'}`,
          title: `${LOCATIONS[f.locationId].name} · ${ago(f.caughtAt)} · ${f.tournamentScore} pts${can ? '' : f.isSpecial ? ' · special fish: sell it from the Trophies tab' : ' · favourite: protected from selling'}`,
          attrs: { role: 'checkbox', 'aria-checked': String(on), tabindex: '0', 'aria-label': `${sp.name}, ${fmtWeight(f.weight)}, ${pearl(f.sellPrice)} PEARL` },
          onclick: () => {
            if (!can) return;
            if (on) selected.delete(f.id);
            else selected.add(f.id);
            confirming = null;
            rerender();
          },
        },
        fishArt(f.speciesId),
        h('span', { class: 'item-name', text: sp.name }),
        h('span', { class: 'item-tags' }, rarityTag(f.rarity), qualityTag(f.quality)),
        h('span', { class: 'item-meta' }, h('span', { text: fmtWeight(f.weight) }), h('span', { class: 'pearl', text: `${pearl(f.sellPrice)} P` })),
        f.isSpecial
          ? h('span', { class: 'star special', text: '◆', title: 'Special fish' })
          : h('button', {
              class: `star${f.isFavorite ? ' on' : ''}`,
              text: f.isFavorite ? '★' : '☆',
              title: f.isFavorite ? 'Favourite: protected from selling. Click to remove' : 'Mark as favourite (protects it from selling)',
              attrs: { 'aria-pressed': String(f.isFavorite), 'aria-label': 'Favourite' },
              onclick: (e) => {
                e.stopPropagation();
                selected.delete(f.id);
                apply((x) => toggleFavorite(x, f.id));
              },
            }),
        on ? h('span', { class: 'check', text: '✓' }) : null,
      );
      card.addEventListener('keydown', (e) => {
        if ((e.key === 'Enter' || e.key === ' ') && e.target === card) {
          e.preventDefault();
          card.click();
        }
      });
      return card;
    }),
  );
  return [toolbar, actions, shown.length ? grid : h('p', { class: 'empty', text: 'No fish match these filters.' })];
}
