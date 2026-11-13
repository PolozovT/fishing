/** Header of the local game: level, PEARL, energy, and the optional Fluent Connect sign-in. */
import { energyCountdown, energyNow, refillPrice } from '../../game/actions';
import { BLEND_PRIZE, TUNING } from '../../game/content';
import { levelOf, xpForLevel } from '../../game/economy';
import { state } from '../../store';
import { fmtCountdown, h, icon, mount, segBar, shortAddr, sigOf } from '../../ui/dom';
import { fluentButton, type HeaderHandlers } from '../../ui/header';
import { world } from '../chain';
import { CHAIN, ops } from '../ops';
import { getSave, rev } from '../state';
import { pearl } from './fmt';

let regenEl: HTMLElement | null = null;

export function initLocalHeader(host: HTMLElement, on: HeaderHandlers): () => void {
  return mount(
    host,
    () => sigOf(rev(), energyNow(getSave(), Date.now()), state.wallet?.address, state.fluentStatus, location.hash, world.blend?.balance),
    () => render(on),
  );
}

export function tickLocalHeader(): void {
  if (!regenEl) return;
  const left = energyCountdown(getSave(), Date.now());
  regenEl.textContent = left === 0 ? 'full' : `+1 in ${fmtCountdown(left)}`;
}

function render(on: HeaderHandlers): HTMLElement[] {
  const s = getSave();
  const now = Date.now();
  const page = location.hash === '#/tackle' ? 'tackle' : 'pond';
  const link = (id: string, text: string, href: string): HTMLElement =>
    h('a', { class: page === id ? 'active' : '', text, attrs: { href, ...(page === id ? { 'aria-current': 'page' } : {}) } });
  const level = levelOf(s.xp);
  const from = xpForLevel(level);
  const to = xpForLevel(level + 1);
  const energy = energyNow(s, now);
  const price = refillPrice(s, now);
  regenEl = h('span', { class: 'regen' });
  tickLocalHeader();
  const w = state.wallet;
  return [
    h(
      'div',
      { class: 'brand', attrs: { 'aria-label': 'Onchain Fishing' } },
      h('span', { class: 'logo' }, icon('bobber')),
      h('span', { class: 'wordmark' }, h('span', { class: 'wm-top', text: 'Onchain' }), h('span', { class: 'wm-main', text: 'Fishing' })),
    ),
    h('nav', { class: 'topnav', attrs: { 'aria-label': 'Pages' } }, link('pond', 'Pond', '#/'), link('tackle', 'Tackle', '#/tackle')),
    h(
      'div',
      { class: 'stats' },
      h(
        'div',
        { class: 'stat', title: `${s.xp} XP · ${to - s.xp} to level ${level + 1}` },
        h('span', { class: 'k', text: `Level ${level}` }),
        segBar(s.xp - from, to - from, 8, 'xp'),
      ),
      h('div', { class: 'stat' }, h('span', { class: 'k', text: 'PEARL' }), h('span', { class: 'v pearl', text: pearl(s.pearl) })),
      h(
        'div',
        { class: 'stat', title: `There is a small chance to fish out a sealed bottle with ${BLEND_PRIZE.amount} BLEND in any water. ${CHAIN && world.blend ? 'Shown here: the BLEND in your wallet, which buys PEARL on the Tackle page. A bottle win is recorded by the contract and not paid out yet.' : `Preview: ${CHAIN ? 'recorded by the contract' : 'a local counter'}, nothing is paid out yet.`}` },
        h('span', { class: 'k', text: 'BLEND' }),
        h('span', { class: 'v blend', text: (CHAIN && world.blend ? world.blend.balance : s.blend).toLocaleString('en-US', { maximumFractionDigits: 2 }) }),
      ),
      h(
        'div',
        { class: 'stat energy' },
        h('span', { class: 'k', text: `Energy ${energy}/${TUNING.maxEnergy}` }),
        segBar(energy, TUNING.maxEnergy, 10, 'en'),
        regenEl,
      ),
      energy < TUNING.maxEnergy
        ? h('button', {
            class: 'btn btn-sm',
            text: `Refill · ${pearl(price)}`,
            title: 'Fills energy to the maximum. Each further refill on the same day costs twice as much.',
            disabled: s.pearl < price,
            onclick: () => void ops.refillEnergy(),
          })
        : null,
      h('div', { class: 'stat hide-sm' }, h('span', { class: 'k', text: 'Catches' }), h('span', { class: 'v', text: String(s.stats.catches) })),
      w
        ? h(
            'div',
            { class: 'stat who' },
            h('span', { class: 'addr', text: shortAddr(w.address), title: `${w.address} — open account`, onclick: on.openAccount }),
            h('button', { class: 'btn btn-ghost btn-sm', text: 'Log out', onclick: on.disconnect }),
          )
        : fluentButton(on),
    ),
  ];
}
