import { sellFish } from '../actions';
import { RARITY_CLASS, RARITY_RU, SPECIES_RU, SPOTS_RU, ru } from '../i18n';
import { cachedImage, state } from '../store';
import { fmtToken, fmtWeight, h, img, mount, sigOf } from './dom';

const selected = new Set<string>();
let selling = false;

export function initInventory(host: HTMLElement): () => void {
  const rerender = mount(
    host,
    () => sigOf(state.wallet?.address, state.fish, [...selected], selling, state.fish.map((f) => !!cachedImage('fish', f.id))),
    () => render(rerender),
  );
  return rerender;
}

function render(rerender: () => void): HTMLElement[] {
  if (!state.wallet) return [h('p', { class: 'muted', text: 'Подключите кошелёк, чтобы увидеть садок.' })];
  // drop selections for fish that are gone
  for (const id of [...selected]) if (!state.fish.some((f) => f.id.toString() === id)) selected.delete(id);
  const total = state.fish.filter((f) => selected.has(f.id.toString())).reduce((a, f) => a + f.value, 0n);
  const allValue = state.fish.reduce((a, f) => a + f.value, 0n);

  const toolbar = h(
    'div',
    { class: 'toolbar' },
    h('span', { class: 'muted', text: `Рыб: ${state.fish.length} · всего ≈ ${fmtToken(allValue)} PEARL` }),
    h('div', { class: 'spacer' }),
    h('button', {
      class: 'btn btn-ghost btn-sm',
      disabled: state.fish.length === 0,
      text: selected.size === state.fish.length && state.fish.length > 0 ? 'Снять выбор' : 'Выбрать все',
      onclick: () => {
        if (selected.size === state.fish.length) selected.clear();
        else state.fish.forEach((f) => selected.add(f.id.toString()));
        rerender();
      },
    }),
    h('button', {
      class: 'btn btn-primary btn-sm',
      disabled: selected.size === 0 || selling,
      text: selling ? 'Продаём…' : `Продать (${selected.size}) · ${fmtToken(total)} PEARL`,
      onclick: async () => {
        const ids = state.fish.filter((f) => selected.has(f.id.toString())).map((f) => f.id);
        selling = true;
        rerender();
        try {
          await sellFish(ids);
          selected.clear();
        } catch {
          /* toast shown by sendTx */
        } finally {
          selling = false;
          rerender();
        }
      },
    }),
  );
  if (state.fish.length === 0) return [toolbar, h('p', { class: 'empty', text: 'Садок пуст. Забросьте удочку!' })];

  const grid = h(
    'div',
    { class: 'grid' },
    state.fish.map((f) => {
      const sp = state.species[f.speciesId];
      const key = f.id.toString();
      const name = ru(SPECIES_RU, sp?.name ?? `#${f.speciesId}`);
      return h(
        'button',
        {
          class: `item ${selected.has(key) ? 'sel' : ''} ${RARITY_CLASS[sp?.rarity ?? 0]}`,
          title: `Поймана: ${ru(SPOTS_RU, state.spots[f.spotId]?.name ?? '')}, ${new Date(f.caughtAt * 1000).toLocaleString('ru-RU')}`,
          onclick: () => {
            if (selected.has(key)) selected.delete(key);
            else selected.add(key);
            rerender();
          },
        },
        img(cachedImage('fish', f.id), name),
        h('span', { class: 'item-name', text: name }),
        h('span', { class: `rarity ${RARITY_CLASS[sp?.rarity ?? 0]}`, text: RARITY_RU[sp?.rarity ?? 0] }),
        h('span', { class: 'item-meta' }, h('span', { text: fmtWeight(f.weight) }), h('span', { class: 'pearl', text: `${fmtToken(f.value)} P` })),
        h('span', { class: 'check', text: selected.has(key) ? '✓' : '' }),
      );
    }),
  );
  return [toolbar, grid];
}
