import { formatEther } from 'viem';
import { hasInjected } from '../clients';
import { IS_LOCAL } from '../config';
import { cfg, chainNow, state } from '../store';
import { fmtCountdown, fmtToken, h, mount, shortAddr, sigOf } from './dom';

export interface HeaderHandlers {
  connectInjected(): void;
  connectBurner(): void;
  disconnect(): void;
}

let regenEl: HTMLElement | null = null;

export function initHeader(host: HTMLElement, on: HeaderHandlers): () => void {
  return mount(
    host,
    () =>
      sigOf(
        state.wallet?.address,
        state.wallet?.mode,
        state.connecting,
        state.eth,
        state.pearl,
        state.energy,
        state.xp,
        state.catches,
        state.config.maxEnergy,
      ),
    () => render(on),
  );
}

function render(on: HeaderHandlers): HTMLElement[] {
  const brand = h('div', { class: 'brand' }, h('span', { class: 'logo', text: '〰' }), h('span', { text: 'Onchain Fishing' }));
  const w = state.wallet;
  if (!w) {
    regenEl = null;
    return [
      brand,
      h(
        'div',
        { class: 'connect' },
        hasInjected()
          ? h('button', { class: 'btn btn-primary', disabled: state.connecting, text: 'Connect wallet', onclick: on.connectInjected })
          : null,
        IS_LOCAL
          ? h('button', {
              class: 'btn btn-burner',
              disabled: state.connecting,
              text: 'Local burner (anvil)',
              title: 'Random key stored in localStorage, ETH funded via anvil_setBalance. Local development only!',
              onclick: on.connectBurner,
            })
          : null,
        !hasInjected() && !IS_LOCAL ? h('span', { class: 'warn', text: 'Install a browser wallet' }) : null,
      ),
    ];
  }
  const max = cfg('maxEnergy') || 1;
  regenEl = h('span', { class: 'regen' });
  tickHeader();
  return [
    brand,
    h(
      'div',
      { class: 'stats' },
      h(
        'div',
        { class: 'stat who' },
        w.mode === 'burner'
          ? h('span', { class: 'badge badge-burner', text: 'burner · local only', title: 'The key is stored in this browser\'s localStorage. Do not use it for real funds.' })
          : h('span', { class: 'badge', text: 'wallet' }),
        h('span', {
          class: 'addr',
          text: shortAddr(w.address),
          title: `${w.address} — click to copy`,
          onclick: () => void navigator.clipboard?.writeText(w.address),
        }),
      ),
      h('div', { class: 'stat' }, h('span', { class: 'k', text: 'ETH' }), h('span', { class: 'v', text: Number(formatEther(state.eth)).toFixed(3) })),
      h('div', { class: 'stat' }, h('span', { class: 'k', text: 'PEARL' }), h('span', { class: 'v pearl', text: fmtToken(state.pearl) })),
      h(
        'div',
        { class: 'stat energy' },
        h('span', { class: 'k', text: `Energy ${state.energy}/${max}` }),
        h('span', { class: 'bar' }, h('span', { class: 'bar-fill en', style: `width:${(100 * state.energy) / max}%` })),
        regenEl,
      ),
      h('div', { class: 'stat' }, h('span', { class: 'k', text: 'XP' }), h('span', { class: 'v', text: String(state.xp) })),
      h('div', { class: 'stat hide-sm' }, h('span', { class: 'k', text: 'Catches' }), h('span', { class: 'v', text: String(state.catches) })),
      h('button', { class: 'btn btn-ghost btn-sm', text: 'Log out', onclick: on.disconnect }),
    ),
  ];
}

/** Called every second: energy regen countdown. */
export function tickHeader(): void {
  if (!regenEl) return;
  const max = cfg('maxEnergy');
  const regen = cfg('energyRegenSeconds');
  if (state.energy >= max || state.energyUpdatedAt === 0 || regen === 0) {
    regenEl.textContent = 'full';
    return;
  }
  const elapsed = Math.max(0, chainNow() - state.energyUpdatedAt);
  const left = regen - (elapsed % regen);
  regenEl.textContent = `+1 in ${fmtCountdown(left)}`;
}
