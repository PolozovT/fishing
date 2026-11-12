import { formatEther, parseEventLogs, type TransactionReceipt } from 'viem';
import { fishingGameAbi } from '../abi';
import { castLine, claimStarter, reelIn } from '../actions';
import { publicClient } from '../clients';
import { revertName } from '../errors';
import { RARITY_CLASS, RARITY_NAMES } from '../i18n';
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
import { fmtToken, fmtWeight, h, icon, img, mount, segBar, sigOf } from './dom';
import { toast } from './toast';

let scene: WaterScene;
let statusEl: HTMLElement;
let overlayEl: HTMLElement;
let reelBtn: HTMLButtonElement;
let casting = false;
let reeling = false;
let reelRetryBlock = 0n;

export function initFishing(sceneHost: HTMLElement, controlsHost: HTMLElement): () => void {
  const canvas = h('canvas', { class: 'water', attrs: { 'aria-label': 'Water' } });
  statusEl = h('div', { class: 'scene-status' });
  overlayEl = h('div', { class: 'scene-overlay hidden' });
  reelBtn = h('button', { class: 'btn btn-reel hidden', text: 'Reel in!', onclick: () => void doReel() });
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
  if (!state.wallet) return 'Connect a wallet to fish';
  const p = scene.getPhase();
  const { n, m } = castProgress();
  if (casting) return 'Casting…';
  if (reeling) return 'Reeling in…';
  if (state.cast) {
    if (state.block > state.cast.targetBlock) return state.autoReel ? 'Bite! Reeling in…' : 'Bite! Hit "Reel in!"';
    return `Waiting for a bite · block ${n}/${m}`;
  }
  if (p === 'caught') return 'Catch!';
  if (p === 'missed') return 'It got away…';
  return 'Ready to cast';
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
    toast(`Cast: ${e instanceof TxError ? e.message : String(e)}`, 'err');
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
      toast(`Reel in: ${e instanceof TxError ? e.message : String(e)}`, 'err');
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
      name: sp?.name ?? `#${speciesId}`,
      rarity: sp?.rarity ?? 0,
      weight,
      value,
      fishId,
      note: fromCast ? 'Result of your last cast' : undefined,
    });
    return true;
  }
  if (ev.eventName === 'Missed') {
    if (!fromCast) scene.setPhase('missed');
    showMessage('It got away!', fromCast ? 'Your last cast came up empty.' : 'The fish escaped. Try again.');
    return true;
  }
  if (!fromCast) scene.setPhase('missed');
  showMessage('Cast expired', 'More than 256 blocks passed — the randomness is lost, and so is the fish.');
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
      h('div', { class: 'reveal-title', text: 'Catch!' }),
      img(c.image, c.name, 'reveal-img'),
      h('div', { class: 'reveal-name', text: c.name }),
      h('div', { class: `rarity ${RARITY_CLASS[c.rarity]}`, text: RARITY_NAMES[c.rarity] ?? '' }),
      h('div', { class: 'reveal-stats' }, h('span', { text: fmtWeight(c.weight) }), h('span', { text: `≈ ${fmtToken(c.value)} PEARL` })),
      h('div', { class: 'muted small', text: `Fish #${c.fishId}` }),
      h('button', { class: 'btn btn-primary', text: 'Nice!', onclick: hideOverlay }),
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
  if (!state.wallet) return 'Connect a wallet';
  if (!state.catalogLoaded) return 'Loading…';
  if (casting) return 'Casting…';
  if (state.cast) return 'Rod is already in the water';
  const rod = selectedRod();
  if (!rod) return state.starterClaimed ? 'No rod — buy one in the shop' : 'Claim your starter rod';
  const spot = state.spots[state.sel.spot];
  if (!spot) return 'Choose a spot';
  if (!spot.active) return 'Spot is closed';
  if (rod.level < spot.minRodLevel) return `Requires rod lvl ${spot.minRodLevel}`;
  if (rod.durability === 0) return 'Rod is broken — repair it';
  if (state.energy < spot.energyCost) return 'Not enough energy';
  if (state.sel.bait !== 0 && (state.baitBalance[state.sel.bait] ?? 0n) === 0n) return 'Out of bait';
  return null;
}

function renderControlsView(): HTMLElement[] {
  const out: HTMLElement[] = [];
  if (state.wallet && state.catalogLoaded && !state.starterClaimed) {
    out.push(
      h(
        'div',
        { class: 'card starter' },
        h('div', null, h('b', { text: 'Welcome to Onchain Fishing!' }), h('p', {
            class: 'muted',
            text:
              cfgBig('starterRodFee') > 0n
                ? `Claim your starter rod (fee ${formatEther(cfgBig('starterRodFee'))} ETH) to get started.`
                : 'Claim your free starter rod to get started.',
          })),
        h('button', {
          class: 'btn btn-primary',
          text: 'Claim starter rod',
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
      h('h3', { text: 'Spot' }),
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
              title: s.speciesIds.map((id) => state.species[id]?.name ?? '').join(', '),
              onclick: () => {
                state.sel.spot = s.id;
                emit();
              },
            },
            h('span', { class: 'spot-name', text: s.name }),
            h(
              'span',
              { class: 'spot-meta' },
              locked ? icon('lock', 'Locked') : null,
              `lvl ${s.minRodLevel}+`,
              h('span', { class: 'sep', text: '·' }),
              icon('bolt', 'Energy'),
              String(s.energyCost),
            ),
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
      h('h3', { text: 'Rod' }),
      state.rods.length === 0
        ? h('p', { class: 'muted', text: state.starterClaimed ? 'No rods — buy one in the shop.' : 'No rod yet.' })
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
                h('span', { class: 'rod-title', text: `#${r.id} · lvl ${r.level}` }),
                segBar(r.durability, r.maxDurability, 8, 'dur'),
                h('span', { class: 'rod-meta', text: r.locked ? 'in the water' : `durability ${r.durability}/${r.maxDurability}` }),
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
      h('h3', { text: 'Bait' }),
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
              title: b.id === 0 ? 'No bonuses' : `+${b.catchBonusBps / 100}% bite, +${b.rarityBonus}% rarity`,
              onclick: () => {
                state.sel.bait = b.id;
                emit();
              },
            },
            h('span', { text: b.name }),
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
        state.cast ? 'In the water…' : 'Cast',
      ),
      h(
        'div',
        { class: 'cast-info' },
        h('div', { class: reason ? 'warn' : 'muted', text: reason ?? `Bite chance: ${(chance / 100).toFixed(0)}%` }),
        h(
          'label',
          { class: 'toggle' },
          (() => {
            const cb = h('input', { attrs: { type: 'checkbox' }, onchange: (e) => setAutoReel((e.target as HTMLInputElement).checked) });
            cb.checked = state.autoReel;
            return cb;
          })(),
          h('span', { class: 'toggle-box', attrs: { 'aria-hidden': 'true' } }),
          h('span', { text: 'Auto reel' }),
        ),
      ),
    ),
  );
  return out;
}

export function tickStatus(): void {
  if (statusEl) statusEl.textContent = statusText();
}
