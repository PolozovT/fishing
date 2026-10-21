import './style.css';
import { connectBurner, connectInjected, forgetMode, hasInjected, publicClient, savedMode } from './clients';
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

if (!deployment) {
  app.append(
    h('div', { class: 'fatal' }, h('h2', { text: 'Контракты не найдены' }), h('p', { text: `Нет deployments/${CHAIN_ID}.json. Задеплойте контракты и выполните pnpm sync.` })),
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
  ['inv', 'Садок'],
  ['shop', 'Магазин'],
  ['market', 'Рынок'],
  ['records', 'Рекорды'],
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
    `Сеть ${CHAIN_ID}${IS_LOCAL ? ' (anvil, локально)' : ''} · RPC ${RPC_URL} · игра ${deployment.game}`,
  ),
);
selectTab(tab);

// ------------------------------------------------------------------ wallet

async function connect(mode: 'burner' | 'injected'): Promise<void> {
  state.connecting = true;
  emit();
  try {
    state.wallet = mode === 'burner' ? await connectBurner() : await connectInjected();
    state.sel.rod = null;
    await loadPlayer();
    if (mode === 'burner') toast('Burner-кошелёк подключён (только для локального anvil)', 'info');
  } catch (e) {
    state.wallet = null;
    toast(`Подключение: ${friendlyError(e)}`, 'err');
  } finally {
    state.connecting = false;
    emit();
  }
}

function disconnect(): void {
  forgetMode();
  state.wallet = null;
  state.rods = [];
  state.fish = [];
  state.cast = null;
  emit();
}

if (hasInjected()) {
  window.ethereum!.on?.('accountsChanged', () => state.wallet?.mode === 'injected' && location.reload());
  window.ethereum!.on?.('chainChanged', () => state.wallet?.mode === 'injected' && location.reload());
}

// ------------------------------------------------------------------ render wiring

const renders = [
  initHeader(headerEl, {
    connectInjected: () => void connect('injected'),
    connectBurner: () => void connect('burner'),
    disconnect,
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
    if (chainId !== CHAIN_ID) showBanner(`RPC отдаёт chainId ${chainId}, ожидается ${CHAIN_ID}`);
    await loadCatalog();
    await loadHead();
    renders.forEach((r) => r());
  } catch (e) {
    showBanner(`Нет связи с узлом ${RPC_URL}: ${friendlyError(e)}. Запущен ли anvil?`);
    setTimeout(() => void boot(), 3000);
    return;
  }
  showBanner(null);
  const mode = savedMode();
  if (mode === 'burner' && IS_LOCAL) await connect('burner');
  else if (mode === 'injected' && hasInjected()) {
    const accs = (await window.ethereum!.request({ method: 'eth_accounts' }).catch(() => [])) as string[];
    if (accs.length) await connect('injected');
  }
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
        .catch((e) => showBanner(`Ошибка обновления: ${friendlyError(e)}`))
        .finally(() => (running = false));
    },
    onError: (e) => showBanner(`Нет связи с узлом: ${friendlyError(e)}`),
  });
}

void boot();
