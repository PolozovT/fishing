/** Header of the local game: level, PEARL, energy, and the optional Fluent Connect sign-in. */
import { energyCountdown, energyNow, refillPrice } from '../../game/actions';
import { BLEND_PRIZE, TUNING } from '../../game/content';
import { levelOf, xpForLevel } from '../../game/economy';
import { TIME_SETTINGS, setTimeSetting, timeOfDay, timeSetting, type TimeSetting } from '../../daytime';
import { state } from '../../store';
import { fmtCountdown, h, icon, mount, segBar, shortAddr, sigOf } from '../../ui/dom';
import { fluentButton, type HeaderHandlers } from '../../ui/header';
import { bottleOn, world } from '../chain';
import { CHAIN, ops } from '../ops';
import { getSave, rev } from '../state';
import { pearl } from './fmt';

let regenEl: HTMLElement | null = null;

export function initLocalHeader(host: HTMLElement, on: HeaderHandlers): () => void {
  return mount(
    host,
    () => sigOf(rev(), energyNow(getSave(), Date.now()), state.wallet?.address, state.fluentStatus, location.hash, world.blend?.balance, world.bottle?.chancePpm, timeSetting(), timeOfDay()),
    () => render(on),
  );
}

export function tickLocalHeader(): void {
  if (!regenEl) return;
  const left = energyCountdown(getSave(), Date.now());
  regenEl.textContent = left === 0 ? 'full' : `+1 in ${fmtCountdown(left)}`;
}

/** Morning, day, evening or night for the scene and the whole interface; "Auto" follows the player's clock. */
function timeSwitch(): HTMLElement {
  const chosen = timeSetting();
  const button = (id: TimeSetting, label: string, hint: string): HTMLElement =>
    h(
      'button',
      {
        class: chosen === id ? 'time-btn active' : 'time-btn',
        title: id === 'auto' ? `${hint} (now: ${timeOfDay()})` : hint,
        attrs: { type: 'button', 'aria-label': label, 'aria-pressed': String(chosen === id) },
        onclick: () => setTimeSetting(id),
      },
      id === 'auto' ? h('span', { class: 'time-auto', text: 'Auto' }) : icon(id),
    );
  return h('div', { class: 'time-switch', attrs: { role: 'group', 'aria-label': 'Time of day' } }, ...TIME_SETTINGS.map((t) => button(t.id, t.label, t.hint)));
}

function render(on: HeaderHandlers): HTMLElement[] {
  const s = getSave();
  const now = Date.now();
  const page = location.hash === '#/tackle' ? 'tackle' : location.hash === '#/cup' ? 'cup' : 'pond';
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
    h('nav', { class: 'topnav', attrs: { 'aria-label': 'Pages' } }, link('pond', 'Pond', '#/'), link('cup', 'Cup', '#/cup'), link('tackle', 'Tackle', '#/tackle')),
    timeSwitch(),
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
        {
          class: 'stat',
          title: bottleOn()
            ? `From level ${world.bottle?.minLevel ?? BLEND_PRIZE.minLevel} there is a small chance to fish out a sealed bottle with ${(world.bottle?.amount ?? BLEND_PRIZE.amount).toLocaleString('en-US')} BLEND in any water. ${CHAIN ? (world.blend ? 'Shown here: the BLEND in your wallet, which buys PEARL on the Tackle page. A bottle is paid straight into it.' : 'A bottle is paid straight to your wallet.') : 'Local game: this is a counter in this browser.'}`
            : CHAIN
              ? 'The BLEND in your wallet: it pays tournament entries and buys PEARL on the Tackle page.'
              : 'Local game: this is a counter in this browser.',
        },
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
