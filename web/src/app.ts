import { fluentWallet, publicClient } from './clients';
import { FLUENT_CONFIGURED, disconnectFluent, mountFluent, openFluentAccount, openFluentConnect, type FluentAccountState } from './fluent';
import { CHAIN_ID, RPC_URL, chain, requireDeployment } from './config';
import { friendlyError } from './errors';
import { emit, loadCatalog, loadHead, loadPlayer, loadWorld, state, subscribe } from './store';
import { h } from './ui/dom';
import { initFishing, tickStatus } from './ui/fishing';
import { initHeader, tickHeader } from './ui/header';
import { initInventory } from './ui/inventory';
import { initMarket } from './ui/market';
import { initRecords } from './ui/records';
import { initShop } from './ui/shop';
import { toast } from './ui/toast';

const app = document.getElementById('app')!;
const deployment = requireDeployment();

// ------------------------------------------------------------------ layout

const headerEl = h('header', { class: 'header' });
const banner = h('div', { class: 'banner hidden' });
const sceneEl = h('div', { class: 'scene' });
const controlsEl = h('div', { class: 'controls card' });

type Tab = 'inv' | 'shop' | 'market' | 'records';
const TABS: [Tab, string][] = [
  ['inv', 'Keepnet'],
  ['shop', 'Shop'],
  ['market', 'Market'],
  ['records', 'Records'],
];
const panels: Record<Tab, HTMLElement> = {
  inv: h('div', { class: 'panel' }),
  shop: h('div', { class: 'panel' }),
  market: h('div', { class: 'panel' }),
  records: h('div', { class: 'panel' }),
};
let tab: Tab = (() => {
  try {
    const t = localStorage.getItem('onchain-fishing:tab');
    return TABS.some(([k]) => k === t) ? (t as Tab) : 'inv';
  } catch {
    return 'inv';
  }
})();
const tabBtns = TABS.map(([k, label]) =>
  h('button', {
    class: 'tab',
    text: label,
    attrs: { role: 'tab', 'data-tab': k },
    onclick: () => selectTab(k),
  }),
);
function selectTab(k: Tab): void {
  tab = k;
  try {
    localStorage.setItem('onchain-fishing:tab', k);
  } catch {
    /* ignore */
  }
  tabBtns.forEach((b) => b.classList.toggle('active', b.dataset.tab === k));
  (Object.keys(panels) as Tab[]).forEach((p) => panels[p].classList.toggle('hidden', p !== k));
  if (k === 'market' || k === 'records') void loadWorld().catch(() => undefined);
}

app.append(
  headerEl,
  banner,
  h(
    'main',
    { class: 'layout' },
    h('div', { class: 'col-left' }, sceneEl, controlsEl),
    h('div', { class: 'col-right card' }, h('nav', { class: 'tabs', attrs: { role: 'tablist' } }, tabBtns), ...Object.values(panels)),
  ),
  h(
    'footer',
    { class: 'footer' },
    `${chain.name} (${CHAIN_ID}) · RPC ${RPC_URL} · game ${deployment.game}`,
  ),
);
selectTab(tab);

// ------------------------------------------------------------------ wallet

function clearPlayer(): void {
  state.wallet = null;
  state.rods = [];
  state.fish = [];
  state.cast = null;
}

async function disconnect(): Promise<void> {
  clearPlayer();
  emit();
  await disconnectFluent().catch((e) => console.warn('fluent disconnect', e));
}


/** Mirrors the widget's account into the game: connect, switch account, or disconnect. */
function onFluentChange(s: FluentAccountState): void {
  state.fluentStatus = s.status;
  const w = state.wallet;
  if (s.status === 'connected' && s.address) {
    if (w?.address !== s.address) {
      state.wallet = fluentWallet(s.address, s.kind);
      state.sel.rod = null;
      void loadPlayer().catch((e) => console.warn('player', e));
    }
  } else if (s.status === 'disconnected' && w) {
    clearPlayer();
  }
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

// ------------------------------------------------------------------ render wiring

const renders = [
  initHeader(headerEl, {
    connectFluent: openFluentConnect,
    openAccount: openFluentAccount,
    disconnect: () => void disconnect(),
  }),
  initFishing(sceneEl, controlsEl),
  initInventory(panels.inv),
  initShop(panels.shop),
  initMarket(panels.market),
  initRecords(panels.records),
];
subscribe(() => renders.forEach((r) => r()));
setInterval(() => {
  tickHeader();
  tickStatus();
}, 1000);

function showBanner(text: string | null): void {
  banner.textContent = text ?? '';
  banner.classList.toggle('hidden', !text);
}

// ------------------------------------------------------------------ boot + polling

let blocksSeen = 0;
async function onBlock(): Promise<void> {
  blocksSeen++;
  await loadHead();
  const jobs: Promise<unknown>[] = [];
  if (state.wallet && (state.cast || blocksSeen % 3 === 0)) jobs.push(loadPlayer());
  if (blocksSeen % 6 === 0) jobs.push(loadWorld());
  await Promise.all(jobs);
}

async function boot(): Promise<void> {
  try {
    const chainId = await publicClient.getChainId();
    if (chainId !== CHAIN_ID) showBanner(`RPC returns chainId ${chainId}, expected ${CHAIN_ID}`);
    await loadCatalog();
    await loadHead();
    renders.forEach((r) => r());
  } catch (e) {
    showBanner(`Cannot reach node ${RPC_URL}: ${friendlyError(e)}`);
    setTimeout(() => void boot(), 3000);
    return;
  }
  showBanner(null);
  void loadWorld().catch((e) => console.warn('world', e));

  let running = false;
  publicClient.watchBlockNumber({
    pollingInterval: 1000,
    emitMissed: false,
    onBlockNumber: () => {
      if (running) return;
      running = true;
      onBlock()
        .then(() => showBanner(null))
        .catch((e) => showBanner(`Refresh failed: ${friendlyError(e)}`))
        .finally(() => (running = false));
    },
    onError: (e) => showBanner(`Cannot reach node: ${friendlyError(e)}`),
  });
}

void boot();
