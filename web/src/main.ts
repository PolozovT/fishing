import '@fontsource/silkscreen/400.css';
import '@fontsource/silkscreen/700.css';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import './style.css';
import { initBackdrop } from './backdrop';
import { connectBurner, fluentWallet, forgetMode, publicClient, savedMode } from './clients';
import { FLUENT_CONFIGURED, disconnectFluent, mountFluent, openFluentAccount, openFluentConnect, type FluentAccountState } from './fluent';
import { CHAIN_ID, IS_LOCAL, RPC_URL, deployment } from './config';
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
initBackdrop();

if (!deployment) {
  app.append(
    h('div', { class: 'fatal' }, h('h2', { text: 'Contracts not found' }), h('p', { text: `Missing deployments/${CHAIN_ID}.json. Deploy the contracts and run pnpm sync.` })),
  );
  throw new Error('no deployment');
}

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
    `Network ${CHAIN_ID}${IS_LOCAL ? ' (anvil, local)' : ''} · RPC ${RPC_URL} · game ${deployment.game}`,
  ),
);
selectTab(tab);

// ------------------------------------------------------------------ wallet

async function connectBurnerWallet(): Promise<void> {
  state.connecting = true;
  emit();
  try {
    state.wallet = await connectBurner();
    state.sel.rod = null;
    await loadPlayer();
    toast('Burner wallet connected (local anvil only)', 'info');
  } catch (e) {
    state.wallet = null;
    toast(`Connection: ${friendlyError(e)}`, 'err');
  } finally {
    state.connecting = false;
    emit();
  }
}

function clearPlayer(): void {
  state.wallet = null;
  state.rods = [];
  state.fish = [];
  state.cast = null;
}

async function disconnect(): Promise<void> {
  const wasFluent = state.wallet?.mode === 'fluent';
  forgetMode();
  clearPlayer();
  emit();
  if (wasFluent) await disconnectFluent().catch((e) => console.warn('fluent disconnect', e));
}

/** The player asked to sign in with Fluent: the next connected account becomes the active wallet. */
let fluentWanted = false;
function connectFluent(): void {
  fluentWanted = true;
  openFluentConnect();
}

/** Mirrors the widget's account into the game: connect, switch account, or disconnect. */
function onFluentChange(s: FluentAccountState): void {
  state.fluentStatus = s.status;
  const w = state.wallet;
  if (s.status === 'connected' && s.address) {
    // a restored Fluent session takes over unless the player is deliberately on the local burner
    const take = fluentWanted || !w || w.mode === 'fluent';
    if (take && w?.address !== s.address) {
      fluentWanted = false;
      forgetMode();
      state.wallet = fluentWallet(s.address, s.kind);
      state.sel.rod = null;
      void loadPlayer().catch((e) => console.warn('player', e));
    }
  } else if (s.status === 'disconnected' && w?.mode === 'fluent') {
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
    connectFluent,
    openAccount: openFluentAccount,
    connectBurner: () => void connectBurnerWallet(),
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
    showBanner(`Cannot reach node ${RPC_URL}: ${friendlyError(e)}. Is anvil running?`);
    setTimeout(() => void boot(), 3000);
    return;
  }
  showBanner(null);
  const mode = savedMode();
  if (mode === 'burner' && IS_LOCAL && !state.wallet) await connectBurnerWallet();
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
