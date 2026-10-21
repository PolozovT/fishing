import { RARITY_CLASS, SPECIES_RU, SPOTS_RU, ru } from '../i18n';
import { state } from '../store';
import { fmtWeight, h, mount, shortAddr, sigOf } from './dom';

export function initRecords(host: HTMLElement): () => void {
  return mount(host, () => sigOf(state.weekly, state.leaderboard, state.wallet?.address, state.bestWeight), render);
}

const name = (id: number): string => ru(SPECIES_RU, state.species[id]?.name ?? `#${id}`);

function render(): HTMLElement[] {
  const me = state.wallet?.address.toLowerCase();
  const w = state.weekly;
  const weekly = h(
    'section',
    { class: 'shop-sec' },
    h('h3', { text: 'Рекорд недели' }),
    w
      ? h(
          'div',
          { class: `weekly ${RARITY_CLASS[state.species[w.speciesId]?.rarity ?? 0]}` },
          h('div', { class: 'weekly-weight', text: fmtWeight(w.weight) }),
          h('div', null, h('b', { text: name(w.speciesId) }), h('div', { class: 'muted small', text: `${w.angler.toLowerCase() === me ? 'это вы!' : shortAddr(w.angler)} · рыба #${w.fishId} · неделя ${w.week}` })),
        )
      : h('p', { class: 'empty', text: 'На этой неделе ещё никто ничего не поймал.' }),
    state.wallet && state.bestWeight > 0 ? h('p', { class: 'muted small', text: `Ваш личный рекорд: ${fmtWeight(state.bestWeight)}` }) : null,
  );

  const board = h('section', { class: 'shop-sec' }, h('h3', { text: 'Топ-10 самых тяжёлых' }));
  if (state.leaderboard.length === 0) board.append(h('p', { class: 'empty', text: 'Пока нет уловов.' }));
  else
    board.append(
      h(
        'table',
        { class: 'board' },
        h('thead', null, h('tr', null, h('th', { text: '#' }), h('th', { text: 'Рыба' }), h('th', { text: 'Вес' }), h('th', { class: 'hide-sm', text: 'Место' }), h('th', { text: 'Рыбак' }))),
        h(
          'tbody',
          null,
          state.leaderboard.map((c, i) =>
            h(
              'tr',
              { class: c.player.toLowerCase() === me ? 'me' : '' },
              h('td', { text: String(i + 1) }),
              h('td', { class: RARITY_CLASS[state.species[c.speciesId]?.rarity ?? 0] }, h('span', { class: 'dot' }), name(c.speciesId)),
              h('td', { text: fmtWeight(c.weight) }),
              h('td', { class: 'hide-sm', text: ru(SPOTS_RU, state.spots[c.spotId]?.name ?? '') }),
              h('td', { text: c.player.toLowerCase() === me ? 'вы' : shortAddr(c.player) }),
            ),
          ),
        ),
      ),
    );
  return [weekly, board];
}
