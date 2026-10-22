import { RARITY_CLASS } from '../i18n';
import { state } from '../store';
import { fmtWeight, h, mount, shortAddr, sigOf } from './dom';

export function initRecords(host: HTMLElement): () => void {
  return mount(host, () => sigOf(state.weekly, state.leaderboard, state.wallet?.address, state.bestWeight), render);
}

const name = (id: number): string => state.species[id]?.name ?? `#${id}`;

function render(): HTMLElement[] {
  const me = state.wallet?.address.toLowerCase();
  const w = state.weekly;
  const weekly = h(
    'section',
    { class: 'shop-sec' },
    h('h3', { text: 'Record of the week' }),
    w
      ? h(
          'div',
          { class: `weekly ${RARITY_CLASS[state.species[w.speciesId]?.rarity ?? 0]}` },
          h('div', { class: 'weekly-weight', text: fmtWeight(w.weight) }),
          h('div', null, h('b', { text: name(w.speciesId) }), h('div', { class: 'muted small', text: `${w.angler.toLowerCase() === me ? 'that\'s you!' : shortAddr(w.angler)} · fish #${w.fishId} · week ${w.week}` })),
        )
      : h('p', { class: 'empty', text: 'Nobody has caught anything this week yet.' }),
    state.wallet && state.bestWeight > 0 ? h('p', { class: 'muted small', text: `Your personal best: ${fmtWeight(state.bestWeight)}` }) : null,
  );

  const board = h('section', { class: 'shop-sec' }, h('h3', { text: 'Top 10 heaviest' }));
  if (state.leaderboard.length === 0) board.append(h('p', { class: 'empty', text: 'No catches yet.' }));
  else
    board.append(
      h(
        'table',
        { class: 'board' },
        h('thead', null, h('tr', null, h('th', { text: '#' }), h('th', { text: 'Fish' }), h('th', { text: 'Weight' }), h('th', { class: 'hide-sm', text: 'Spot' }), h('th', { text: 'Angler' }))),
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
              h('td', { class: 'hide-sm', text: state.spots[c.spotId]?.name ?? '' }),
              h('td', { text: c.player.toLowerCase() === me ? 'you' : shortAddr(c.player) }),
            ),
          ),
        ),
      ),
    );
  return [weekly, board];
}
