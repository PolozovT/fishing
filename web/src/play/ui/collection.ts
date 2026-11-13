/** Fish collection: the permanent encyclopedia, grouped by location. */
import { claimAchievement } from '../../game/actions';
import { LOCATIONS, SPECIES, special } from '../../game/content';
import { achievements, collectorStats, isUnlocked, locationProgress, unlockText } from '../../game/progress';
import type { Save } from '../../game/types';
import { RARITY_CLASS } from '../../i18n';
import { fmtWeight, h, icon, mount, sigOf } from '../../ui/dom';
import { toast } from '../../ui/toast';
import { fishArt } from '../fishSprite';
import { act, getSave, rev } from '../state';
import { pearl, rarityTag } from './fmt';

export function initCollection(host: HTMLElement): () => void {
  return mount(host, () => sigOf(rev()), render);
}

export function claimButton(id: string, reward: number): HTMLElement {
  return h('button', {
    class: 'btn btn-primary btn-sm',
    text: `Claim ${pearl(reward)} PEARL`,
    onclick: () => {
      const r = act(
        (s) => claimAchievement(s, id),
        (x) => x.save,
      );
      if (r) toast(`+${pearl(r.reward)} PEARL`, 'ok');
    },
  });
}

function speciesCard(s: Save, id: number, isSpecial: boolean): HTMLElement {
  const sp = SPECIES[id];
  const e = s.dex[id];
  if (!e) {
    return h(
      'div',
      { class: `item dex unknown ${RARITY_CLASS[sp.rarity]}`, title: isSpecial ? 'A special fish. Extremely rare.' : sp.hidden ? 'A hidden species. Very rare.' : 'Not discovered yet' },
      fishArt(id, { silhouette: true }),
      h('span', { class: 'item-name', text: '???' }),
      h('span', { class: 'item-tags' }, rarityTag(sp.rarity)),
      h('span', { class: 'item-meta muted', text: isSpecial ? 'special' : sp.hidden ? 'hidden' : 'undiscovered' }),
    );
  }
  return h(
    'div',
    { class: `item dex ${RARITY_CLASS[sp.rarity]}`, title: `${fmtWeight(sp.minWeight)} – ${fmtWeight(sp.maxWeight)} · base price ${pearl(sp.basePrice)} PEARL` },
    fishArt(id),
    h('span', { class: 'item-name', text: sp.name }),
    h('span', { class: 'item-tags' }, rarityTag(sp.rarity)),
    h('span', { class: 'item-meta' }, h('span', { text: `×${e.count}` }), h('span', { text: `best ${fmtWeight(e.best)}` })),
  );
}

function render(): HTMLElement[] {
  const s = getSave();
  const st = collectorStats(s);
  const ach = achievements(s);
  const out: HTMLElement[] = [
    h(
      'div',
      { class: 'toolbar' },
      h('span', { class: 'muted', text: `Discovered ${st.discovered}/${st.total} species` }),
      h('div', { class: 'spacer' }),
      h('span', { class: 'badge', text: st.title }),
    ),
    h('p', { class: 'muted small', text: 'A species stays discovered even after you sell every specimen.' }),
  ];
  for (const loc of LOCATIONS) {
    const open = isUnlocked(s, loc);
    const p = locationProgress(s, loc);
    const a = ach.find((x) => x.id === `loc:${loc.id}`);
    const sp = loc.special ? special(loc.special) : undefined;
    out.push(
      h(
        'section',
        { class: `dex-sec${open ? '' : ' locked'}` },
        h(
          'div',
          { class: 'dex-head' },
          h('h3', null, open ? null : icon('lock', 'Locked'), ` ${loc.name}`),
          h('span', { class: 'muted small', text: `${p.have}/${p.of}` }),
          h('div', { class: 'spacer' }),
          a && a.done && !a.claimed ? claimButton(a.id, a.reward) : h('span', { class: 'muted small', text: a?.claimed ? 'collection reward claimed' : `complete for ${pearl(a?.reward ?? 0)} PEARL` }),
        ),
        open ? null : h('p', { class: 'warn small', text: unlockText(loc.unlock, s) }),
        h('div', { class: 'grid dex-grid' }, loc.pool.map(([id]) => speciesCard(s, id, false)), sp ? speciesCard(s, sp.speciesId, true) : null),
      ),
    );
  }
  return out;
}
