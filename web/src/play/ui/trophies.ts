/** Trophies: the special collectible fish, what they unlock and the single passive-bonus slot. */
import { BLEND_PRIZE, LOCATIONS, SPECIALS, SPECIES } from '../../game/content';
import { saleValue } from '../../game/actions';
import { isUnlocked } from '../../game/progress';
import { RARITY_CLASS } from '../../i18n';
import { fmtWeight, h, mount, sigOf } from '../../ui/dom';
import { toast } from '../../ui/toast';
import { fishArt } from '../fishSprite';
import { CHAIN, ops } from '../ops';
import { levelOf } from '../../game/economy';
import { world } from '../chain';
import { getSave, rev } from '../state';
import { ago, pearl, qualityTag, rarityTag } from './fmt';

let confirming: string | null = null;

export function initTrophies(host: HTMLElement): () => void {
  const rerender = mount(
    host,
    () => sigOf(rev(), confirming, world.bottle?.left, world.bottle?.today),
    () => render(rerender),
  );
  return rerender;
}

type Bottle = { amount: number; minLevel: number; maxWins: number; dailyMax: number; today: number; left: number | null };

/** Where the player stands with the bottle, in one line. */
function bottleStatus(wins: number, level: number, b: Bottle): string {
  if (wins >= b.maxWins) return 'you have found yours';
  if (level < b.minLevel) return `opens at level ${b.minLevel} (you are level ${level})`;
  if (b.left === 0) return 'the pool is empty for now';
  if (b.dailyMax && b.today >= b.dailyMax) return "today's bottles are found, the next ones bite tomorrow (UTC)";
  return 'it can bite on any cast';
}

function render(rerender: () => void): HTMLElement[] {
  const s = getSave();
  // on the contracts the numbers are the contract's; the local game has no pool and no daily limit
  const bottle: Bottle = CHAIN && world.bottle ? world.bottle : { amount: BLEND_PRIZE.amount, minLevel: BLEND_PRIZE.minLevel, maxWins: BLEND_PRIZE.maxWins, dailyMax: 0, today: 0, left: null };
  const out: HTMLElement[] = [
    h(
      'p',
      { class: 'muted small' },
      'Special fish are extremely rare. Each one opens a new water for good and carries a passive bonus. One bonus can be active at a time, and it works only while you hold a specimen. ',
      h('span', { class: 'badge', text: CHAIN ? 'Every fish is an NFT' : 'Local collectibles · not NFTs yet' }),
    ),
  ];
  for (const sp of SPECIALS) {
    const species = SPECIES[sp.speciesId];
    const found = s.specialsFound.includes(sp.id);
    const held = s.fish.filter((f) => f.speciesId === sp.speciesId);
    const active = s.activeSpecial === sp.id && held.length > 0;
    const target = LOCATIONS[sp.unlocksLocation];
    const homes = LOCATIONS.filter((l) => l.special === sp.id);
    const reachable = homes.filter((l) => isUnlocked(s, l));
    out.push(
      h(
        'section',
        { class: `trophy ${RARITY_CLASS[species.rarity]}${found ? '' : ' unknown'}${active ? ' active' : ''}` },
        fishArt(sp.speciesId, { silhouette: !found, cls: 'trophy-art' }),
        h(
          'div',
          { class: 'trophy-body' },
          h('div', { class: 'trophy-head' }, h('h3', { text: found ? sp.name : '???' }), rarityTag(species.rarity), active ? h('span', { class: 'badge badge-on', text: 'Bonus active' }) : null),
          h('p', { class: 'muted small', text: found ? sp.lore : `Lives in ${homes.map((l) => l.name).join(', ')}.${reachable.length ? '' : ' You cannot reach those waters yet.'}` }),
          h('p', { class: 'small' }, h('span', { class: 'muted', text: 'Unlocks: ' }), `${target.name} `, h('span', { class: isUnlocked(s, target) ? 'ok' : 'muted', text: isUnlocked(s, target) ? '· unlocked for good' : '· locked' })),
          h('p', { class: 'small' }, h('span', { class: 'muted', text: 'Bonus: ' }), found ? sp.bonus.label : '???'),
          found
            ? h(
                'div',
                { class: 'trophy-actions' },
                held.length === 0
                  ? h('span', { class: 'muted small', text: 'No specimen in hand: the bonus is off, the unlock stays.' })
                  : active
                    ? h('button', { class: 'btn btn-ghost btn-sm', text: 'Turn bonus off', onclick: () => void ops.setActiveSpecial(null) })
                    : h('button', { class: 'btn btn-primary btn-sm', text: s.activeSpecial ? 'Use this bonus instead' : 'Use bonus', onclick: () => void ops.setActiveSpecial(sp.id) }),
              )
            : null,
          held.length
            ? h(
                'ul',
                { class: 'specimens' },
                held.map((f) =>
                  h(
                    'li',
                    null,
                    h('span', { text: fmtWeight(f.weight) }),
                    qualityTag(f.quality),
                    h('span', { class: 'muted small', text: `${LOCATIONS[f.locationId].name} · ${ago(f.caughtAt)}` }),
                    h('div', { class: 'spacer' }),
                    h('button', {
                      class: `btn btn-sm${confirming === f.id ? ' btn-danger' : ' btn-ghost'}`,
                      text: confirming === f.id ? (held.length === 1 ? 'Confirm: bonus will turn off' : 'Confirm sale') : `Sell · ${pearl(saleValue(f, Date.now()))}`,
                      onclick: () => {
                        if (confirming !== f.id) {
                          confirming = f.id;
                          rerender();
                          return;
                        }
                        confirming = null;
                        rerender();
                        void ops.sellFish([f.id]).then((earned) => earned !== undefined && toast(`Sold ${sp.name} for ${pearl(earned)} PEARL`, 'ok'));
                      },
                    }),
                  ),
                ),
              )
            : null,
        ),
      ),
    );
  }
  out.push(
    h(
      'section',
      { class: `trophy prize${s.blendWins > 0 ? ' active' : ''}` },
      h(
        'div',
        { class: 'trophy-body' },
        h('div', { class: 'trophy-head' }, h('h3', { text: 'Sealed bottle' }), h('span', { class: 'badge badge-blend', text: `${bottle.amount.toLocaleString('en-US')} BLEND` }), s.blendWins > 0 ? h('span', { class: 'badge badge-on', text: 'Found' }) : null),
        h('p', { class: 'muted small', text: `Once in a great while the thing on your hook is not a fish but a bottle with ${bottle.amount.toLocaleString('en-US')} BLEND tokens. It can bite in any water once you are level ${bottle.minLevel}, and you still have to reel it in.` }),
        h('p', { class: 'small' }, h('span', { class: 'muted', text: 'Found: ' }), `${s.blendWins}/${bottle.maxWins}`, h('span', { class: 'muted', text: ' · ' }), bottleStatus(s.blendWins, levelOf(s.xp), bottle)),
        h('p', { class: 'muted small', text: CHAIN ? `The game contract pays the bottle straight to your wallet out of its pool${world.bottle ? `: ${world.bottle.left} ${world.bottle.left === 1 ? 'bottle' : 'bottles'} left` : ''}${world.bottle?.dailyMax ? `, at most ${world.bottle.dailyMax} found a day by all players` : ''}.` : 'Local game: the balance is stored in this browser.' }),
      ),
    ),
  );
  return out;
}
