/** Entry of the local game: layout, routing and render wiring. No contracts and no RPC are involved. */
import { fluentWallet } from '../clients';
import { FLUENT_CONFIGURED, disconnectFluent, mountFluent, openFluentAccount, openFluentConnect, type FluentAccountState } from '../fluent';
import { emit, state, subscribe } from '../store';
import { initTackle } from '../tackle/page';
import { h } from '../ui/dom';
import { toast } from '../ui/toast';
import { initCollection } from './ui/collection';
import { initLocalHeader, tickLocalHeader } from './ui/header';
import { initKeepnet } from './ui/keepnet';
import { initPond, tickPond } from './ui/pond';
import { initRanks, tickRanks } from './ui/ranks';
import { initTrophies } from './ui/trophies';

const app = document.getElementById('app')!;

const headerEl = h('header', { class: 'header' });
const sceneEl = h('div', { class: 'scene' });
const controlsEl = h('div', { class: 'controls card' });

type Tab = 'inv' | 'dex' | 'trophy' | 'ranks';
const TABS: [Tab, string][] = [
  ['inv', 'Keepnet'],
  ['dex', 'Collection'],
  ['trophy', 'Trophies'],
  ['ranks', 'Ranks'],
];
const panels: Record<Tab, HTMLElement> = {
  inv: h('div', { class: 'panel' }),
  dex: h('div', { class: 'panel' }),
  trophy: h('div', { class: 'panel' }),
  ranks: h('div', { class: 'panel' }),
};
const TAB_KEY = 'onchain-fishing:play-tab';
let tab: Tab = (() => {
  try {
    const t = localStorage.getItem(TAB_KEY);
    return TABS.some(([k]) => k === t) ? (t as Tab) : 'inv';
  } catch {
    return 'inv';
  }
})();
const tabBtns = TABS.map(([k, label]) => h('button', { class: 'tab', text: label, attrs: { role: 'tab', 'data-tab': k }, onclick: () => selectTab(k) }));
function selectTab(k: Tab): void {
  tab = k;
  try {
    localStorage.setItem(TAB_KEY, k);
  } catch {
    /* a remembered tab is a convenience only */
  }
  tabBtns.forEach((b) => b.classList.toggle('active', b.dataset.tab === k));
  (Object.keys(panels) as Tab[]).forEach((p) => panels[p].classList.toggle('hidden', p !== k));
}

const tackleEl = h('main', { class: 'tackle hidden' });
const pondEl = h(
  'main',
  { class: 'layout' },
  h('div', { class: 'col-left' }, sceneEl, controlsEl),
  h('div', { class: 'col-right card' }, h('nav', { class: 'tabs', attrs: { role: 'tablist' } }, tabBtns), ...Object.values(panels)),
);

app.append(
  headerEl,
  pondEl,
  tackleEl,
  h('footer', { class: 'footer' }, 'Local game · progress is saved in this browser · no contracts or transactions yet'),
);
selectTab(tab);

function route(): void {
  const tackle = location.hash === '#/tackle';
  pondEl.classList.toggle('hidden', tackle);
  tackleEl.classList.toggle('hidden', !tackle);
  document.title = tackle ? 'Tackle · Onchain Fishing' : 'Onchain Fishing';
  emit();
}
window.addEventListener('hashchange', () => {
  route();
  window.scrollTo(0, 0);
});

// The Fluent Connect sign-in stays available, but the local game does not depend on it.
function onFluentChange(s: FluentAccountState): void {
  state.fluentStatus = s.status;
  if (s.status === 'connected' && s.address) state.wallet = fluentWallet(s.address, s.kind);
  else if (s.status === 'disconnected') state.wallet = null;
  emit();
}
if (FLUENT_CONFIGURED) {
  state.fluentStatus = 'restoring';
  mountFluent(onFluentChange, (m) => {
    state.fluentStatus = 'off';
    toast(`Fluent Connect: ${m}`, 'err');
    emit();
  });
}

const renders = [
  initLocalHeader(headerEl, {
    connectFluent: openFluentConnect,
    openAccount: openFluentAccount,
    disconnect: () => {
      state.wallet = null;
      emit();
      void disconnectFluent().catch((e) => console.warn('fluent disconnect', e));
    },
  }),
  initPond(sceneEl, controlsEl),
  initKeepnet(panels.inv),
  initCollection(panels.dex),
  initTrophies(panels.trophy),
  initRanks(panels.ranks),
  initTackle(tackleEl, true),
];
subscribe(() => renders.forEach((r) => r()));
route();
setInterval(() => {
  tickLocalHeader();
  tickRanks();
  tickPond();
}, 1000);
