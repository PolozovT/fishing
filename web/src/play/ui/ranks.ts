/** Leaderboards: the weekly championship (local score + labelled demo opponents), personal records, collection. */
import { LOCATIONS, SPECIES } from '../../game/content';
import { achievements, collectorStats } from '../../game/progress';
import { COUNTED_CATCHES, SETTLEMENT_ENABLED, WEEKLY_REWARDS, standings, weekEnd, weekId, weekStart, weekTotal } from '../../game/tournament';
import { RARITY_CLASS } from '../../i18n';
import { fmtWeight, h, mount, sigOf } from '../../ui/dom';
import { EXPLORER_URL } from '../../config';
import { world } from '../chain';
import { CHAIN } from '../ops';
import { getSave, rev } from '../state';
import { state } from '../../store';
import { shortAddr } from '../../ui/dom';
import { claimButton } from './collection';
import { ago, duration, pearl, qualityTag } from './fmt';

type View = 'weekly' | 'biggest' | 'collector';
const VIEWS: [View, string][] = [
  ['weekly', 'Weekly cup'],
  ['biggest', 'Biggest catch'],
  ['collector', 'Collector'],
];
let view: View = 'weekly';
let countdownEl: HTMLElement | null = null;

export function initRanks(host: HTMLElement): () => void {
  const rerender = mount(
    host,
    () => sigOf(rev(), view, weekId(Date.now()), Math.floor(Date.now() / 60_000), world.standings, world.history, state.wallet?.address),
    () => render(rerender),
  );
  return rerender;
}

export function tickRanks(): void {
  if (countdownEl) countdownEl.textContent = `resets in ${duration(weekEnd(weekId(Date.now())) - Date.now())}`;
}

/** An angler's name linking to their address in the block explorer (plain text when the network has none). */
function anglerLink(name: string, address: string): HTMLElement | string {
  if (!EXPLORER_URL) return name;
  return h('a', { class: 'addr-link', text: name, title: `${address} · open in the explorer`, attrs: { href: `${EXPLORER_URL}/address/${address}`, target: '_blank', rel: 'noopener noreferrer' } });
}

const dot = (speciesId: number): HTMLElement => h('span', { class: RARITY_CLASS[SPECIES[speciesId].rarity] }, h('span', { class: 'dot' }), SPECIES[speciesId].name);

function weekly(): HTMLElement[] {
  const s = getSave();
  const now = Date.now();
  const week = weekId(now);
  const mine = s.weeks[week] ?? [];
  const total = weekTotal(mine);
  const me = state.wallet?.address.toLowerCase();
  // on the contracts the table is every angler who landed a fish this week; locally it is the labelled demo field
  const table: { name: string; total: number; demo: boolean; you?: boolean; address?: string }[] = CHAIN
    ? world.standings.map((r) => ({ name: r.address.toLowerCase() === me ? 'You' : shortAddr(r.address), total: r.total, demo: false, you: r.address.toLowerCase() === me, address: r.address }))
    : standings(week, now, total);
  const rank = table.findIndex((r) => r.you) + 1;
  countdownEl = h('span', { class: 'muted small' });
  tickRanks();
  const past = Object.keys(s.weeks)
    .map(Number)
    .filter((w) => w < week)
    .sort((a, b) => b - a)
    .slice(0, 8);
  return [
    h(
      'section',
      { class: 'shop-sec' },
      h('div', { class: 'dex-head' }, h('h3', { text: 'Weekly Angler Championship' }), h('div', { class: 'spacer' }), countdownEl),
      h(
        'div',
        { class: 'weekly' },
        h('div', { class: 'weekly-weight', text: pearl(total) }),
        h(
          'div',
          null,
          h('b', { text: mine.length ? (rank > 0 ? `Your score · place ${rank} of ${table.length}` : 'Your score') : 'No catches this week yet' }),
          h('div', { class: 'muted small', text: `Sum of your ${COUNTED_CATCHES} best catches this week (${mine.length}/${COUNTED_CATCHES} counted). Points are fixed when the fish is landed: selling it keeps them.` }),
        ),
      ),
      CHAIN
        ? h('p', { class: 'muted small', text: 'Live standings from the game contract: every angler who landed a fish this week.' })
        : h(
            'p',
            { class: 'note-demo small' },
            h('span', { class: 'badge badge-demo', text: 'Demo' }),
            ' Opponents below are generated for preview. They are not real players, and no rank rewards are paid until online tournaments exist.',
          ),
      table.length === 0 ? h('p', { class: 'empty', text: 'Nobody has landed a fish this week yet.' }) : null,
      h(
        'table',
        { class: 'board' },
        h('thead', null, h('tr', null, h('th', { text: '#' }), h('th', { text: 'Angler' }), h('th', { text: 'Score' }))),
        h(
          'tbody',
          null,
          table.map((r, i) =>
            h(
              'tr',
              { class: r.you ? 'me' : '' },
              h('td', { text: String(i + 1) }),
              h('td', null, r.address ? anglerLink(r.name, r.address) : r.name, r.demo ? h('span', { class: 'badge badge-demo', text: 'Demo' }) : null),
              h('td', { text: pearl(r.total) }),
            ),
          ),
        ),
      ),
    ),
    h(
      'section',
      { class: 'shop-sec' },
      h('h3', { text: 'Your counted catches' }),
      mine.length === 0
        ? h('p', { class: 'empty', text: 'Land a fish to get on the board.' })
        : h(
            'table',
            { class: 'board' },
            h('thead', null, h('tr', null, h('th', { text: '#' }), h('th', { text: 'Fish' }), h('th', { text: 'Weight' }), h('th', { text: 'Q' }), h('th', { text: 'Pts' }))),
            h(
              'tbody',
              null,
              mine.map((e, i) => h('tr', null, h('td', { text: String(i + 1) }), h('td', null, dot(e.speciesId)), h('td', { text: fmtWeight(e.weight) }), h('td', null, qualityTag(e.quality)), h('td', { text: String(e.score) }))),
            ),
          ),
      h('p', { class: 'muted small', text: 'Score = rarity points × weight factor (0.7–1.5 of the species average) × quality (D 0.8 … S 1.3). Only ten catches count, so one good hour can beat a week of grinding.' }),
    ),
    h(
      'section',
      { class: 'shop-sec' },
      h('h3', { text: 'Planned rewards' }),
      h(
        'table',
        { class: 'board' },
        h('tbody', null, WEEKLY_REWARDS.map((t) => h('tr', null, h('td', { text: t.from === t.to ? `${t.from}` : `${t.from}–${t.to}` }), h('td', { text: `${pearl(t.pearl)} PEARL${t.trophy ? ' + trophy' : ''}` })))),
      ),
      h('p', { class: 'muted small', text: SETTLEMENT_ENABLED ? '' : CHAIN ? 'Not paid out yet: scores are recorded onchain, the prize payout is not switched on.' : 'Not paid out yet: rank rewards need real opponents and a trusted server.' }),
    ),
    CHAIN ? chainHistory() : null,
    !CHAIN && past.length
      ? h(
          'section',
          { class: 'shop-sec' },
          h('h3', { text: 'Past weeks' }),
          h(
            'table',
            { class: 'board' },
            h('thead', null, h('tr', null, h('th', { text: 'Week of' }), h('th', { text: 'Score' }), h('th', { text: 'Best fish' }), h('th', { text: 'Demo place' }))),
            h(
              'tbody',
              null,
              past.map((w) => {
                const list = s.weeks[w];
                const t = weekTotal(list);
                const place = standings(w, weekEnd(w) - 1, t).findIndex((r) => r.you) + 1;
                return h(
                  'tr',
                  null,
                  h('td', { text: new Date(weekStart(w)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) }),
                  h('td', { text: pearl(t) }),
                  h('td', null, list[0] ? dot(list[0].speciesId) : '—'),
                  h('td', { text: String(place) }),
                );
              }),
            ),
          ),
        )
      : null,
  ].filter((x): x is HTMLElement => !!x);
}

function chainHistory(): HTMLElement | null {
  if (world.history.length === 0) return null;
  return h(
    'section',
    { class: 'shop-sec' },
    h('h3', { text: 'Past weeks' }),
    h(
      'table',
      { class: 'board' },
      h('thead', null, h('tr', null, h('th', { text: 'Week of' }), h('th', { text: 'Score' }))),
      h(
        'tbody',
        null,
        world.history.map((w) =>
          h('tr', null, h('td', { text: new Date(weekStart(w.week)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) }), h('td', { text: pearl(w.total) })),
        ),
      ),
    ),
  );
}

function biggest(): HTMLElement[] {
  const s = getSave();
  const o = s.records.overall;
  const perSpecies = Object.entries(s.dex)
    .map(([id, e]) => ({ id: Number(id), ...e }))
    .sort((a, b) => b.best - a.best);
  return [
    h(
      'section',
      { class: 'shop-sec' },
      h('h3', { text: 'Heaviest fish ever' }),
      o
        ? h(
            'div',
            { class: `weekly ${RARITY_CLASS[SPECIES[o.speciesId].rarity]}` },
            h('div', { class: 'weekly-weight', text: fmtWeight(o.weight) }),
            h('div', null, h('b', { text: SPECIES[o.speciesId].name }), h('div', { class: 'muted small', text: `${LOCATIONS[o.locationId].name} · ${ago(o.at)}` })),
          )
        : h('p', { class: 'empty', text: 'No catches yet.' }),
    ),
    h(
      'section',
      { class: 'shop-sec' },
      h('h3', { text: 'Record by location' }),
      h(
        'table',
        { class: 'board' },
        h(
          'tbody',
          null,
          LOCATIONS.map((l) => {
            const r = s.records.byLocation[l.id];
            return h('tr', null, h('td', { text: l.name }), h('td', null, r ? dot(r.speciesId) : h('span', { class: 'muted', text: '—' })), h('td', { text: r ? fmtWeight(r.weight) : '' }));
          }),
        ),
      ),
    ),
    h(
      'section',
      { class: 'shop-sec' },
      h('h3', { text: 'Record by species' }),
      perSpecies.length === 0
        ? h('p', { class: 'empty', text: 'Nothing discovered yet.' })
        : h(
            'table',
            { class: 'board' },
            h('thead', null, h('tr', null, h('th', { text: '#' }), h('th', { text: 'Species' }), h('th', { text: 'Best' }), h('th', { text: 'Caught' }))),
            h('tbody', null, perSpecies.map((e, i) => h('tr', null, h('td', { text: String(i + 1) }), h('td', null, dot(e.id)), h('td', { text: fmtWeight(e.best) }), h('td', { text: `×${e.count}` })))),
          ),
    ),
  ];
}

function collector(): HTMLElement[] {
  const s = getSave();
  const st = collectorStats(s);
  const tile = (k: string, v: string): HTMLElement => h('div', { class: 'tk-big' }, h('span', { class: 'k', text: k }), h('span', { class: 'v', text: v }));
  return [
    h(
      'section',
      { class: 'shop-sec' },
      h('div', { class: 'dex-head' }, h('h3', { text: 'Master Collector' }), h('div', { class: 'spacer' }), h('span', { class: 'badge', text: st.title })),
      h(
        'div',
        { class: 'tk-lo-out' },
        tile('Species', `${st.discovered}/${st.total}`),
        tile('Legendary+', `${st.legendary}/${st.legendaryTotal}`),
        tile('Locations done', `${st.locationsComplete}/${st.locations}`),
        tile('Fish landed', String(s.stats.catches)),
      ),
    ),
    h(
      'section',
      { class: 'shop-sec' },
      h('h3', { text: 'Achievements' }),
      achievements(s).map((a) =>
        h(
          'div',
          { class: `shop-row${a.claimed ? ' done' : ''}` },
          h('div', { class: 'shop-desc' }, h('b', { text: a.title }), h('span', { class: 'muted small', text: `${a.desc} · ${a.have}/${a.goal}` })),
          h('div', { class: 'shop-act' }, a.claimed ? h('span', { class: 'ok small', text: 'claimed' }) : a.done ? claimButton(a.id, a.reward) : h('span', { class: 'pearl', text: `${pearl(a.reward)} PEARL` })),
        ),
      ),
    ),
  ];
}

function render(rerender: () => void): HTMLElement[] {
  countdownEl = null;
  const nav = h(
    'div',
    { class: 'chips', attrs: { role: 'tablist' } },
    VIEWS.map(([k, label]) => h('button', { class: `chip${view === k ? ' active' : ''}`, text: label, attrs: { role: 'tab', 'aria-selected': String(view === k) }, onclick: () => ((view = k), rerender()) })),
  );
  return [nav, ...(view === 'weekly' ? weekly() : view === 'biggest' ? biggest() : collector())];
}
