import { formatEther, parseEventLogs, type TransactionReceipt } from 'viem';
import { fishingGameAbi } from '../abi';
import { castLine, claimStarter, reelIn } from '../actions';
import { publicClient } from '../clients';
import { revertName } from '../errors';
import { BAITS_RU, RARITY_CLASS, RARITY_RU, SPECIES_RU, SPOTS_RU, ru } from '../i18n';
import { WaterScene } from '../scene';
import {
  ADDR,
  catchChanceBps,
  cfg,
  cfgBig,
  emit,
  loadPlayer,
  loadWorld,
  selectedRod,
  setAutoReel,
  state,
  tokenImage,
} from '../store';
import { TxError } from '../tx';
import { fmtToken, fmtWeight, h, img, mount, sigOf } from './dom';
import { toast } from './toast';

let scene: WaterScene;
let statusEl: HTMLElement;
let overlayEl: HTMLElement;
let reelBtn: HTMLButtonElement;
let casting = false;
let reeling = false;
let reelRetryBlock = 0n;

export function initFishing(sceneHost: HTMLElement, controlsHost: HTMLElement): () => void {
  const canvas = h('canvas', { class: 'water', attrs: { 'aria-label': 'Водоём' } });
  statusEl = h('div', { class: 'scene-status' });
  overlayEl = h('div', { class: 'scene-overlay hidden' });
  reelBtn = h('button', { class: 'btn btn-reel hidden', text: 'Подсечь!', onclick: () => void doReel() });
  sceneHost.append(canvas, statusEl, reelBtn, overlayEl);
  scene = new WaterScene(canvas);

  const renderControls = mount(controlsHost, controlsSig, renderControlsView);
  return () => {
    renderControls();
    syncScene();
  };
}

// ------------------------------------------------------------------ scene state machine

function castProgress(): { n: number; m: number } {
  const delay = cfg('revealDelay') || 2;
  const m = delay + 1;
  if (!state.cast) return { n: 0, m };
  const castBlock = state.cast.targetBlock - BigInt(delay);
  const n = Number(state.block - castBlock);
  return { n: Math.max(0, Math.min(m, n)), m };
}

function syncScene(): void {
  scene.setPalette(state.cast?.spotId ?? state.sel.spot);
  const phase = scene.getPhase();
  const c = state.cast;
  if (c && !casting && !reeling) {
    const ready = state.block > c.targetBlock;
    if (ready) {
      scene.setPhase('bite');
      if (state.autoReel && state.block > reelRetryBlock) void doReel();
    } else if (phase !== 'casting') {
      scene.setPhase('waiting');
    }
  } else if (!c && !casting && !reeling && (phase === 'waiting' || phase === 'bite')) {
    // cast finished elsewhere (e.g. reelFor by a keeper, or another tab)
    scene.setPhase('idle');
    void loadWorld();
  }
  reelBtn.classList.toggle('hidden', !(c && state.block > c.targetBlock && !reeling && !state.autoReel));
  statusEl.textContent = statusText();
}

function statusText(): string {
  if (!state.wallet) return 'Подключите кошелёк, чтобы рыбачить';
  const p = scene.getPhase();
  const { n, m } = castProgress();
  if (casting) return 'Забрасываем…';
  if (reeling) return 'Вываживаем…';
  if (state.cast) {
    if (state.block > state.cast.targetBlock) return state.autoReel ? 'Клюёт! Подсекаем…' : 'Клюёт! Жми «Подсечь»';
    return `Ждём поклёвку · блок ${n}/${m}`;
  }
  if (p === 'caught') return 'Есть улов!';
  if (p === 'missed') return 'Сорвалась…';
  return 'Готов к забросу';
}

async function doCast(): Promise<void> {
  const rod = selectedRod();
  if (!rod || casting) return;
  casting = true;
  hideOverlay();
  scene.setPalette(state.sel.spot);
  scene.setPhase('casting');
  emit();
  try {
    const receipt = await castLine(rod.id, state.sel.spot, state.sel.bait);
    // A finished previous cast is auto-resolved inside `cast`; show its result if any.
    await showResult(receipt, true);
    await loadPlayer();
    scene.setPhase('waiting');
  } catch (e) {
    scene.setPhase('idle');
    toast(`Заброс: ${e instanceof TxError ? e.message : String(e)}`, 'err');
  } finally {
    casting = false;
    emit();
  }
}

async function doReel(): Promise<void> {
  if (reeling || !state.cast) return;
  reeling = true;
  scene.setPhase('reeling');
  emit();
  try {
    const receipt = await reelIn();
    const shown = await showResult(receipt, false);
    if (!shown) scene.setPhase('idle');
  } catch (e) {
    const name = e instanceof TxError ? revertName(e.original) : undefined;
    if (name === 'TooEarly') {
      reelRetryBlock = state.block; // try again next block
      scene.setPhase('bite');
    } else if (name === 'NoActiveCast') {
      scene.setPhase('idle');
    } else {
      scene.setPhase('bite');
      reelRetryBlock = state.block + 3n; // avoid hammering on persistent errors
      toast(`Подсечка: ${e instanceof TxError ? e.message : String(e)}`, 'err');
    }
  } finally {
    reeling = false;
    await Promise.all([loadPlayer(), loadWorld()]).catch(() => undefined);
    emit();
  }
}

/** Parses Caught / Missed / CastExpired for us in a receipt and shows the reveal. Returns true if shown. */
async function showResult(receipt: TransactionReceipt, fromCast: boolean): Promise<boolean> {
  const me = state.wallet?.address.toLowerCase();
  const logs = parseEventLogs({
    abi: fishingGameAbi,
    logs: receipt.logs,
    eventName: ['Caught', 'Missed', 'CastExpired'],
  }).filter((l) => (l.args as { player: string }).player.toLowerCase() === me);
  const ev = logs[0];
  if (!ev) return false;
  if (ev.eventName === 'Caught') {
    const { fishId, speciesId, weight } = ev.args;
    if (!fromCast) scene.setPhase('caught');
    const image = await tokenImage('fish', fishId);
    const sp = state.species[speciesId];
    const value = await publicClient
      .readContract({ address: ADDR.game, abi: fishingGameAbi, functionName: 'quoteSell', args: [fishId] })
      .catch(() => 0n);
    showCatchCard({
      image,
      name: ru(SPECIES_RU, sp?.name ?? `#${speciesId}`),
      rarity: sp?.rarity ?? 0,
      weight,
      value,
      fishId,
      note: fromCast ? 'Итог прошлого заброса' : undefined,
    });
    return true;
  }
  if (ev.eventName === 'Missed') {
    if (!fromCast) scene.setPhase('missed');
    showMessage('Сорвалась!', fromCast ? 'Прошлый заброс — без улова.' : 'Рыба ушла. Попробуйте ещё раз.');
    return true;
  }
  if (!fromCast) scene.setPhase('missed');
  showMessage('Заброс истёк', 'Прошло больше 256 блоков — случайность потеряна, рыба тоже.');
  return true;
}

function hideOverlay(): void {
  overlayEl.classList.add('hidden');
  overlayEl.replaceChildren();
}

let overlayTimer: ReturnType<typeof setTimeout> | undefined;
function showMessage(title: string, text: string): void {
  clearTimeout(overlayTimer);
  overlayEl.replaceChildren(h('div', { class: 'reveal reveal-miss' }, h('div', { class: 'reveal-title', text: title }), h('p', { text })));
  overlayEl.classList.remove('hidden');
  overlayTimer = setTimeout(hideOverlay, 2800);
}

function showCatchCard(c: {
  image?: string;
  name: string;
  rarity: number;
  weight: number;
  value: bigint;
  fishId: bigint;
  note?: string;
}): void {
  clearTimeout(overlayTimer);
  overlayEl.replaceChildren(
    h(
      'div',
      { class: `reveal reveal-catch ${RARITY_CLASS[c.rarity]}` },
      c.note ? h('div', { class: 'muted small', text: c.note }) : null,
      h('div', { class: 'reveal-title', text: 'Улов!' }),
      img(c.image, c.name, 'reveal-img'),
      h('div', { class: 'reveal-name', text: c.name }),
      h('div', { class: `rarity ${RARITY_CLASS[c.rarity]}`, text: RARITY_RU[c.rarity] ?? '' }),
      h('div', { class: 'reveal-stats' }, h('span', { text: fmtWeight(c.weight) }), h('span', { text: `≈ ${fmtToken(c.value)} PEARL` })),
      h('div', { class: 'muted small', text: `Рыба #${c.fishId}` }),
      h('button', { class: 'btn btn-primary', text: 'Отлично!', onclick: hideOverlay }),
    ),
  );
  overlayEl.classList.remove('hidden');
}

// ------------------------------------------------------------------ controls

function controlsSig(): string {
  return sigOf(
    !!state.wallet,
    state.catalogLoaded,
    state.starterClaimed,
    state.sel,
    state.rods,
    state.energy,
    state.baitBalance,
    !!state.cast,
    casting,
    reeling,
    state.autoReel,
  );
}

function blockReason(): string | null {
  if (!state.wallet) return 'Подключите кошелёк';
  if (!state.catalogLoaded) return 'Загрузка…';
  if (casting) return 'Забрасываем…';
  if (state.cast) return 'Удочка уже в воде';
  const rod = selectedRod();
  if (!rod) return state.starterClaimed ? 'Нет удочки — купите в магазине' : 'Получите стартовую удочку';
  const spot = state.spots[state.sel.spot];
  if (!spot) return 'Выберите место';
  if (!spot.active) return 'Место закрыто';
  if (rod.level < spot.minRodLevel) return `Нужна удочка ур. ${spot.minRodLevel}`;
  if (rod.durability === 0) return 'Удочка сломана — почините';
  if (state.energy < spot.energyCost) return 'Нет энергии';
  if (state.sel.bait !== 0 && (state.baitBalance[state.sel.bait] ?? 0n) === 0n) return 'Нет наживки';
  return null;
}

function renderControlsView(): HTMLElement[] {
  const out: HTMLElement[] = [];
  if (state.wallet && state.catalogLoaded && !state.starterClaimed) {
    out.push(
      h(
        'div',
        { class: 'card starter' },
        h('div', null, h('b', { text: 'Добро пожаловать на рыбалку!' }), h('p', {
            class: 'muted',
            text:
              cfgBig('starterRodFee') > 0n
                ? `Получите стартовую удочку (плата ${formatEther(cfgBig('starterRodFee'))} ETH), чтобы начать.`
                : 'Получите бесплатную стартовую удочку, чтобы начать.',
          })),
        h('button', {
          class: 'btn btn-primary',
          text: 'Получить стартовую удочку',
          onclick: (e) => {
            const b = e.currentTarget as HTMLButtonElement;
            b.disabled = true;
            claimStarter().catch(() => (b.disabled = false));
          },
        }),
      ),
    );
  }

  const rod = selectedRod();
  // spots
  out.push(
    h(
      'section',
      { class: 'picker' },
      h('h3', { text: 'Место' }),
      h(
        'div',
        { class: 'spots' },
        state.spots.map((s) => {
          const locked = !rod || rod.level < s.minRodLevel;
          return h(
            'button',
            {
              class: `spot ${state.sel.spot === s.id ? 'sel' : ''} ${locked ? 'locked' : ''}`,
              disabled: !s.active || !!state.cast,
              title: s.speciesIds.map((id) => ru(SPECIES_RU, state.species[id]?.name ?? '')).join(', '),
              onclick: () => {
                state.sel.spot = s.id;
                emit();
              },
            },
            h('span', { class: 'spot-name', text: ru(SPOTS_RU, s.name) }),
            h('span', { class: 'spot-meta' }, locked ? `🔒 ур. ${s.minRodLevel}+` : `ур. ${s.minRodLevel}+`, ` · ⚡${s.energyCost}`),
          );
        }),
      ),
    ),
  );

  // rods
  out.push(
    h(
      'section',
      { class: 'picker' },
      h('h3', { text: 'Удочка' }),
      state.rods.length === 0
        ? h('p', { class: 'muted', text: state.starterClaimed ? 'Удочек нет — купите в магазине.' : 'Пока нет удочки.' })
        : h(
            'div',
            { class: 'rods' },
            state.rods.map((r) =>
              h(
                'button',
                {
                  class: `rod ${state.sel.rod === r.id ? 'sel' : ''} ${r.durability === 0 ? 'broken' : ''}`,
                  disabled: !!state.cast,
                  onclick: () => {
                    state.sel.rod = r.id;
                    emit();
                  },
                },
                h('span', { class: 'rod-title', text: `#${r.id} · ур. ${r.level}` }),
                h('span', { class: 'bar' }, h('span', { class: 'bar-fill dur', style: `width:${(100 * r.durability) / Math.max(1, r.maxDurability)}%` })),
                h('span', { class: 'rod-meta', text: r.locked ? 'в воде' : `прочность ${r.durability}/${r.maxDurability}` }),
              ),
            ),
          ),
    ),
  );

  // baits
  out.push(
    h(
      'section',
      { class: 'picker' },
      h('h3', { text: 'Наживка' }),
      h(
        'div',
        { class: 'baits' },
        state.baits.map((b) => {
          const bal = b.id === 0 ? null : state.baitBalance[b.id] ?? 0n;
          return h(
            'button',
            {
              class: `bait ${state.sel.bait === b.id ? 'sel' : ''}`,
              disabled: (bal !== null && bal === 0n) || !!state.cast,
              title: b.id === 0 ? 'Без бонусов' : `+${b.catchBonusBps / 100}% к поклёвке, +${b.rarityBonus}% к редкости`,
              onclick: () => {
                state.sel.bait = b.id;
                emit();
              },
            },
            h('span', { text: ru(BAITS_RU, b.name) }),
            h('span', { class: 'bait-bal', text: bal === null ? '∞' : `×${bal}` }),
          );
        }),
      ),
    ),
  );

  const reason = blockReason();
  const chance = rod ? catchChanceBps(rod.level, state.sel.bait) : 0;
  out.push(
    h(
      'div',
      { class: 'cast-row' },
      h(
        'button',
        { class: 'btn btn-cast', disabled: !!reason, onclick: () => void doCast() },
        state.cast ? 'В воде…' : 'Забросить',
      ),
      h(
        'div',
        { class: 'cast-info' },
        h('div', { class: reason ? 'warn' : 'muted', text: reason ?? `Шанс поклёвки: ${(chance / 100).toFixed(0)}%` }),
        h(
          'label',
          { class: 'toggle' },
          (() => {
            const cb = h('input', { attrs: { type: 'checkbox' }, onchange: (e) => setAutoReel((e.target as HTMLInputElement).checked) });
            cb.checked = state.autoReel;
            return cb;
          })(),
          h('span', { text: 'Авто-подсечка' }),
        ),
      ),
    ),
  );
  return out;
}

export function tickStatus(): void {
  if (statusEl) statusEl.textContent = statusText();
}
