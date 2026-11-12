import { formatEther } from 'viem';
import { FLUENT_CONFIGURED } from '../fluent';
import { IS_LOCAL } from '../config';
import { cfg, chainNow, state } from '../store';
import { fmtCountdown, fmtToken, h, icon, mount, segBar, shortAddr, sigOf } from './dom';

export interface HeaderHandlers {
  connectFluent(): void;
  openAccount(): void;
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
        state.fluentStatus,
      ),
    () => render(on),
  );
}

function render(on: HeaderHandlers): HTMLElement[] {
  const brand = h(
    'div',
    { class: 'brand', attrs: { 'aria-label': 'Onchain Fishing' } },
    h('span', { class: 'logo' }, icon('bobber')),
    h('span', { class: 'wordmark' }, h('span', { class: 'wm-top', text: 'Onchain' }), h('span', { class: 'wm-main', text: 'Fishing' })),
  );
  const w = state.wallet;
  if (!w) {
    regenEl = null;
    return [
      brand,
      h(
        'div',
        { class: 'connect' },
        fluentButton(on),
        IS_LOCAL
          ? h('button', {
              class: 'btn btn-burner',
              disabled: state.connecting,
              text: 'Local burner (anvil)',
              title: 'Random key stored in localStorage, ETH funded via anvil_setBalance. Local development only!',
              onclick: on.connectBurner,
            })
          : null,
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
          : h('span', { class: 'badge badge-fluent', text: w.kind === 'eoa' ? 'fluent · wallet' : 'fluent id' }),
        h('span', {
          class: 'addr',
          text: shortAddr(w.address),
          title: w.mode === 'fluent' ? `${w.address} — open account` : `${w.address} — click to copy`,
          onclick: () => (w.mode === 'fluent' ? on.openAccount() : void navigator.clipboard?.writeText(w.address)),
        }),
      ),
      h('div', { class: 'stat' }, h('span', { class: 'k', text: 'ETH' }), h('span', { class: 'v', text: Number(formatEther(state.eth)).toFixed(3) })),
      h('div', { class: 'stat' }, h('span', { class: 'k', text: 'PEARL' }), h('span', { class: 'v pearl', text: fmtToken(state.pearl) })),
      h(
        'div',
        { class: 'stat energy' },
        h('span', { class: 'k', text: `Energy ${state.energy}/${max}` }),
        segBar(state.energy, max, 10, 'en'),
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

/** The Fluent Connect entry point: the widget handles Fluent ID login and External wallets. */
function fluentButton(on: HeaderHandlers): HTMLElement {
  if (!FLUENT_CONFIGURED) {
    return h('span', {
      class: 'warn',
      text: 'Fluent Connect: set VITE_FLUENT_APP_ID and VITE_FLUENT_PRIVY_CLIENT_ID',
    });
  }
  // stays clickable while restoring: if the widget never finishes initializing, the player can still retry
  const pending = state.fluentStatus === 'connecting';
  return h(
    'button',
    {
      class: 'btn btn-primary btn-wallet',
      disabled: state.connecting,
      title: 'Sign in with a Fluent ID or connect a wallet',
      onclick: on.connectFluent,
    },
    icon('bobber'),
    pending ? 'Fluent…' : 'Connect with Fluent',
  );
}
