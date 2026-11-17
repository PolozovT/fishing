/**
 * The Cup page: tournaments, the tournament fight and the leaderboards.
 *
 * Fishing here differs from the pond in one way that matters: the fight counts. The cast is one transaction, the
 * fish it hooks is public once its block exists, and then the player gets exactly one fight at it. The fight is
 * the integer machine from game/fight.ts, driven tick by tick by whether the player holds the button; the input is
 * recorded and sent to the contract, which plays it back and scores the catch. Nothing computed here is trusted.
 */
import { EXPLORER_URL } from '../../config';
import { LOCATIONS, QUALITIES, SPECIES } from '../../game/content';
import { PULL, MAX_TICKS, TICK_MS, U, WARN, fightBand, fightParams, fightStart, fightTick, packInputs, pointsFor, type FightParams, type FightState } from '../../game/fight';
import { RARITY_CLASS } from '../../i18n';
import { WaterScene } from '../../scene';
import { emit, state } from '../../store';
import { LURES, RODS } from '../../tackle/catalog';
import { fmtCountdown, fmtWeight, h, icon, mount, shortAddr, sigOf } from '../../ui/dom';
import { toast } from '../../ui/toast';
import { waitPastBlock } from '../chain';
import { CUP_DEPLOYED, PRIZE_SHARES, castTargetOf, cupOps, cupResultOf, cupStage, cups, hookedFish, loadCupStandings, loadCups, type Cup, type CupResult, type HookedCupFish } from '../cup';
import { fishArt } from '../fishSprite';
import { CHAIN } from '../ops';
import { pearl, qualityTag, rarityTag } from './fmt';

type Phase = 'idle' | 'casting' | 'waiting' | 'bite' | 'fighting' | 'sending' | 'unsent' | 'result';

let scene: WaterScene;
let statusEl: HTMLElement;
let overlayEl: HTMLElement;
let hookBtn: HTMLButtonElement;
let sendBtn: HTMLButtonElement;
let reelEl: HTMLElement;
let phase: Phase = 'idle';
/** The tournament shown; null = the newest one that is not over. */
let picked: number | null = null;
/** The tournament the current cast belongs to. */
let fishing: Cup | null = null;
let pending: { targetBlock: bigint; castNo: number } | null = null;
let hook: HookedCupFish | null = null;
/** Wall-clock deadline for the recording to be mined, estimated from the block deadline. */
let deadlineAt = 0;
let recording: boolean[] = [];
let lastFight: { landed: boolean; ticks: number; good: number; lost?: 'snapped' | 'slack' | 'time' } | null = null;

const blend = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(2));
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const visible = (): boolean => location.hash === '#/cup';

export const cupBusy = (): boolean => phase !== 'idle' && phase !== 'result';

function current(): Cup | null {
  if (picked !== null) {
    const c = cups.list.find((x) => x.id === picked);
    if (c) return c;
  }
  const now = Date.now();
  return cups.list.find((c) => cupStage(c, now) !== 'over') ?? cups.list[0] ?? null;
}

export function initCup(root: HTMLElement): () => void {
  if (!CHAIN || !CUP_DEPLOYED) {
    root.append(h('div', { class: 'card cup-off' }, h('h2', { text: 'Tournaments' }), h('p', { class: 'muted', text: CHAIN ? 'Tournaments are not deployed on this network yet.' : 'Tournaments run on the contracts: scores, casts and prizes live onchain. This is the local game, so there are none here.' })));
    return () => undefined;
  }
  const sceneHost = h('div', { class: 'scene' });
  const controlsHost = h('div', { class: 'controls card' });
  const sideHost = h('div', { class: 'col-right card cup-side' });
  root.append(h('div', { class: 'col-left' }, sceneHost, controlsHost), sideHost);

  const canvas = h('canvas', { class: 'water', attrs: { 'aria-label': 'Water' } });
  statusEl = h('div', { class: 'scene-status' });
  overlayEl = h('div', { class: 'scene-overlay hidden' });
  hookBtn = h('button', { class: 'btn btn-reel hidden', text: 'Hook!', onclick: () => startFight() });
  sendBtn = h('button', { class: 'btn btn-reel hidden', text: 'Send it', title: 'Send the recording of your fight again', onclick: () => void sendRecording() });
  reelEl = h('div', { class: 'reel hidden' });
  sceneHost.append(canvas, statusEl, hookBtn, sendBtn, reelEl, overlayEl);
  scene = new WaterScene(canvas);

  sceneHost.addEventListener('pointerdown', (e) => {
    if (phase === 'fighting') {
      e.preventDefault();
      holding = true;
    }
  });
  window.addEventListener('keydown', (e) => key(e, true));
  window.addEventListener('keyup', (e) => key(e, false));
  window.addEventListener('pointerup', () => (holding = false));
  window.addEventListener('blur', () => (holding = false));

  const sig = (): string => {
    const c = current();
    return sigOf(cups.rev, c?.id, c ? cupStage(c, Date.now()) : '', phase, state.wallet?.address, visible());
  };
  const renderControls = mount(controlsHost, sig, controlsView);
  const renderSide = mount(sideHost, sig, sideView);
  setPhase('idle');
  void reload();
  let lastWallet = state.wallet?.address;
  return () => {
    if (state.wallet?.address !== lastWallet) {
      lastWallet = state.wallet?.address;
      void reload();
    }
    renderControls();
    renderSide();
  };
}

async function reload(): Promise<void> {
  try {
    await loadCups();
    const c = current();
    if (c) await loadCupStandings(c.id);
  } catch (e) {
    console.warn('[cup] could not read the tournaments', e);
  }
}

let ticks = 0;
/** Once a second: countdowns, and a refresh of the lists every ten seconds while the page is open. */
export function tickCup(): void {
  if (!CHAIN || !CUP_DEPLOYED) return;
  paintCountdowns();
  if (phase === 'bite' || phase === 'unsent') statusEl.textContent = statusText();
  if ((phase === 'bite' || phase === 'unsent') && Date.now() > deadlineAt) outOfTime();
  if (++ticks % 10 === 0 && visible() && document.visibilityState === 'visible' && !cupBusy()) void reload();
}

function setPhase(p: Phase): void {
  phase = p;
  hookBtn.classList.toggle('hidden', p !== 'bite');
  sendBtn.classList.toggle('hidden', p !== 'unsent');
  reelEl.classList.toggle('hidden', p !== 'fighting');
  statusEl.textContent = statusText();
  emit();
}

const secondsLeft = (): number => Math.max(0, Math.round((deadlineAt - Date.now()) / 1000));

function statusText(): string {
  switch (phase) {
    case 'casting':
      return 'Casting…';
    case 'waiting':
      return 'Waiting for a bite…';
    case 'bite':
      return `Bite! Hook it · ${secondsLeft()} s to land it`;
    case 'fighting':
      return 'Fish on! This fight is your score';
    case 'sending':
      return 'Sending your fight to the judge…';
    case 'unsent':
      return `Landed, not scored yet: send it · ${secondsLeft()} s left`;
    default:
      return 'Tournament water';
  }
}

// ------------------------------------------------------------------ cast → bite

async function doCast(c: Cup): Promise<void> {
  if (cupBusy()) return;
  hideOverlay();
  fishing = c;
  scene.setSpot(c.locationId);
  scene.setPhase('casting');
  setPhase('casting');
  const receipt = await cupOps.cast(c.id);
  const made = receipt && castTargetOf(receipt);
  if (!made) {
    scene.setPhase('idle');
    setPhase('idle');
    return;
  }
  pending = made;
  void reload();
  await watch();
}

/** Picks up the fish already on the line (after a reload, or a cast made in another tab). */
async function resume(c: Cup): Promise<void> {
  if (cupBusy() || c.entry.targetBlock === 0n) return;
  hideOverlay();
  fishing = c;
  pending = { targetBlock: c.entry.targetBlock, castNo: c.entry.castsUsed };
  scene.setSpot(c.locationId);
  await watch();
}

/** Waits for the randomness block, works out which fish it is, and stages the bite. */
async function watch(): Promise<void> {
  const c = fishing;
  const p = pending;
  if (!c || !p) return;
  scene.setPhase('waiting');
  setPhase('waiting');
  const since = performance.now();
  await waitPastBlock(p.targetBlock, () => phase === 'waiting');
  if (phase !== 'waiting') return;
  try {
    hook = await hookedFish(c, p.targetBlock, p.castNo);
  } catch (e) {
    console.warn('[cup] could not read the cast', e);
    hook = null;
  }
  if (phase !== 'waiting') return;
  if (!hook || hook.blocksLeft < 25) {
    scene.setPhase('idle');
    setPhase('idle');
    showMessage('It slipped the hook', hook ? 'Too little time was left to fight this one. Cast again: that cast is spent.' : 'Could not read the cast from the network. Try “Back to your fish”.');
    return;
  }
  // blocks come about once a second; keep a margin for the transaction to be mined
  deadlineAt = Date.now() + (hook.blocksLeft - 8) * 1000;
  // a moment of suspense, but the clock is running
  const wait = 900 + Math.random() * 1200 - (performance.now() - since);
  if (wait > 0) await sleep(wait);
  if (phase !== 'waiting') return;
  scene.setPhase('bite');
  setPhase('bite');
}

function outOfTime(): void {
  hook = null;
  pending = null;
  recording = [];
  scene.setPhase('missed');
  setPhase('idle');
  showMessage('Out of time', 'The fish had to be landed and sent within about two minutes of the bite. That cast is spent.');
  void reload();
}

// ------------------------------------------------------------------ the fight

let holding = false;
let fs: FightState | null = null;
let fp: FightParams | null = null;
let promptEl: HTMLElement;
let needleEl: HTMLElement;
let gaugeEl: HTMLElement;
let fishEl: HTMLElement;
let tautEl: HTMLElement;
let holdBtn: HTMLButtonElement;

const PULL_TEXT = ['A light tug', 'A steady pull', 'A strong fish', 'A heavy fish!', 'A monster!', 'Something unreal…'];

function startFight(): void {
  const c = fishing;
  if (phase !== 'bite' || !c || !hook) return;
  const p = fightParams(hook.fish.difficulty, c.green);
  fp = p;
  fs = fightStart(hook.fightSeed);
  recording = [];
  lastFight = null;
  holding = false;
  const sp = SPECIES[hook.fish.speciesId];
  promptEl = h('div', { class: 'reel-prompt', attrs: { role: 'status', 'aria-live': 'assertive' } });
  needleEl = h('div', { class: 'gauge-needle' });
  const pc = (v: number): string => `${(v / U) * 100}%`;
  gaugeEl = h(
    'div',
    { class: 'gauge', attrs: { 'aria-hidden': 'true' } },
    h('div', { class: 'gauge-seg slack', style: `width:${pc(p.lo)}` }, h('span', { text: 'Slack' })),
    h('div', { class: 'gauge-seg green', style: `width:${pc(p.hi - p.lo)}` }, h('span', { text: 'Good' })),
    h('div', { class: 'gauge-seg red', style: `width:${pc(U - p.hi)}` }, h('span', { text: 'Snap!' })),
    needleEl,
  );
  fishEl = h('div', { class: 'haul-fish' }, icon('hook'), icon('fish'));
  tautEl = h('div', { class: 'haul-taut' });
  holdBtn = h('button', { class: 'btn btn-primary reel-hold', text: 'Hold to reel' });
  holdBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    holding = true;
  });
  holdBtn.addEventListener('contextmenu', (e) => e.preventDefault());
  reelEl.replaceChildren(
    promptEl,
    h('div', { class: 'reel-label' }, h('span', { text: 'Line tension' }), h('span', { class: 'muted', text: `${sp.name} · ${PULL_TEXT[hook.fish.difficulty]}` })),
    h('div', { class: 'reel-note', text: `One try. Land it for ${pointsFor(hook.fish.base, 1, 0)} points, up to ${hook.fish.base} the longer you keep the needle in the green. Lose it and the cast scores nothing.` }),
    gaugeEl,
    h('div', { class: 'haul', attrs: { 'aria-hidden': 'true' } }, h('span', { class: 'haul-you', text: 'You' }), h('div', { class: 'haul-line' }, tautEl, fishEl)),
    holdBtn,
  );
  scene.setPhase('reeling');
  setPhase('fighting');
  paintFight();
  let last = performance.now();
  let acc = 0;
  const frame = (now: number): void => {
    if (phase !== 'fighting' || !fs || !fp) return;
    // fixed 50 ms ticks: the contract replays exactly these, one recorded bit each
    acc += Math.min(250, now - last);
    last = now;
    while (acc >= TICK_MS && fs.result === 'fighting' && recording.length < MAX_TICKS) {
      recording.push(holding);
      fightTick(fs, holding, fp);
      acc -= TICK_MS;
    }
    paintFight();
    if (fs.result === 'fighting' && recording.length < MAX_TICKS) requestAnimationFrame(frame);
    else endFight();
  };
  requestAnimationFrame(frame);
}

function promptFor(s: FightState, p: FightParams): { text: string; cls: string } {
  const band = fightBand(s.tension, p);
  if (band === 'red') return { text: 'Let go! The line is about to snap', cls: 'bad' };
  if (s.mood === PULL) return band === 'slack' ? { text: 'It jerks: take up the slack gently', cls: 'warn' } : { text: 'It jerks: let go!', cls: 'warn' };
  if (s.mood === WARN) return { text: 'Careful: it is about to jerk', cls: 'warn' };
  if (band === 'slack') return { text: 'Hold to reel in', cls: '' };
  return { text: 'Good! Keep the needle in the green', cls: 'good' };
}

function paintFight(): void {
  if (!fs || !fp) return;
  needleEl.style.left = `${(fs.tension / U) * 100}%`;
  const at = `${Math.min(1, fs.dist / 70_000) * 100}%`;
  fishEl.style.left = at;
  tautEl.style.width = at;
  tautEl.classList.toggle('slack', fightBand(fs.tension, fp) === 'slack');
  const pr = promptFor(fs, fp);
  if (promptEl.textContent !== pr.text) promptEl.textContent = pr.text;
  promptEl.className = `reel-prompt ${pr.cls}`;
  gaugeEl.classList.toggle('pulling', fs.mood === PULL);
  gaugeEl.classList.toggle('warning', fs.mood === WARN);
  fishEl.classList.toggle('pulling', fs.mood === PULL);
  holdBtn.classList.toggle('down', holding);
}

function endFight(): void {
  if (!fs) return;
  holding = false;
  lastFight = { landed: fs.result === 'landed', ticks: fs.ticks, good: fs.good, lost: fs.result === 'snapped' ? 'snapped' : fs.result === 'slack' ? 'slack' : fs.result === 'fighting' ? 'time' : undefined };
  if (lastFight.landed) return void sendRecording();
  // a lost fish needs no transaction: the cast is already spent, and the next cast clears the line
  const name = hook ? SPECIES[hook.fish.speciesId].name : 'fish';
  hook = null;
  pending = null;
  recording = [];
  scene.setPhase('missed');
  setPhase('idle');
  showMessage(
    lastFight.lost === 'snapped' ? 'The line snapped!' : lastFight.lost === 'slack' ? 'It got away!' : 'It outlasted you!',
    `${lastFight.lost === 'snapped' ? 'Too much tension: let go when the needle enters the red, and the moment the fish warns of a jerk.' : lastFight.lost === 'slack' ? 'The line was slack for too long: hold to reel and keep the needle in the green.' : 'A minute is all a fight may take.'} The ${name} scores nothing and the cast is spent.`,
  );
}

/** The settlement: the recording goes to the contract, which replays it and scores the catch. */
async function sendRecording(): Promise<void> {
  const c = fishing;
  const me = state.wallet?.address;
  if (!c || recording.length === 0 || phase === 'sending') return;
  if (!me) {
    toast('Connect with Fluent to send your fight', 'info');
    setPhase('unsent');
    return;
  }
  setPhase('sending');
  const receipt = await cupOps.reel(c.id, packInputs(recording));
  if (!receipt) {
    // rejected or failed: the recording is still good until the deadline
    if (Date.now() > deadlineAt) return outOfTime();
    setPhase('unsent');
    return;
  }
  const result = cupResultOf(receipt, me);
  const predicted = hook;
  hook = null;
  pending = null;
  recording = [];
  await reload();
  if (!result || result.kind === 'forfeited') {
    scene.setPhase('missed');
    setPhase('idle');
    showMessage('Too late', 'The recording reached the contract after the deadline, so the fish does not count. That cast is spent.');
    return;
  }
  if (predicted && lastFight && (result.landed !== lastFight.landed || result.ticks !== lastFight.ticks || result.good !== lastFight.good)) {
    console.warn('[cup] the contract replayed the fight differently', { mine: lastFight, contract: result });
  }
  scene.setPhase(result.landed ? 'caught' : 'missed');
  setPhase('idle');
  phase = 'result';
  showResult(c, result);
}

function key(e: KeyboardEvent, down: boolean): void {
  if (!visible() || (e.code !== 'Space' && e.code !== 'Enter')) return;
  const tag = (e.target as HTMLElement | null)?.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  if (down && phase === 'bite') {
    e.preventDefault();
    startFight();
  } else if (phase === 'fighting') {
    e.preventDefault();
    holding = down;
  }
}

// ------------------------------------------------------------------ overlays

let overlayTimer: ReturnType<typeof setTimeout> | undefined;

function hideOverlay(): void {
  clearTimeout(overlayTimer);
  overlayEl.classList.add('hidden');
  overlayEl.replaceChildren();
  if (phase === 'result') {
    phase = 'idle';
    scene.setPhase('idle');
    statusEl.textContent = statusText();
    emit();
  }
}

function showMessage(title: string, text: string): void {
  clearTimeout(overlayTimer);
  overlayEl.replaceChildren(h('div', { class: 'reveal reveal-miss' }, h('div', { class: 'reveal-title', text: title }), h('p', { text })));
  overlayEl.classList.remove('hidden');
  overlayTimer = setTimeout(hideOverlay, 4200);
}

function showResult(c: Cup, r: Extract<CupResult, { kind: 'scored' }>): void {
  clearTimeout(overlayTimer);
  const sp = SPECIES[r.speciesId];
  const share = r.ticks > 0 ? Math.round((r.good / r.ticks) * 100) : 0;
  // the lists were reloaded after the settlement, so the entry already includes this catch
  const counts = r.points > 0 && (cups.list.find((x) => x.id === c.id) ?? c).entry.best.includes(r.points);
  overlayEl.replaceChildren(
    h(
      'div',
      { class: `reveal reveal-catch ${RARITY_CLASS[sp.rarity]}` },
      h('div', { class: 'reveal-title', text: r.landed ? 'Scored!' : 'It got away' }),
      fishArt(r.speciesId, { cls: 'reveal-img' }),
      h('div', { class: 'reveal-name', text: sp.name }),
      h('div', { class: 'reveal-tags' }, rarityTag(sp.rarity), qualityTag(QUALITIES[r.quality] ?? 'B')),
      h('div', { class: 'reveal-stats' }, h('span', { text: fmtWeight(r.weight) }), h('span', { class: 'pearl', text: `${r.points} of ${r.base} pts` })),
      h('div', { class: 'muted small', text: `Your fight: ${(r.ticks / 20).toFixed(1)} s · ${share}% in the green` }),
      h('div', { class: 'muted small', text: r.landed ? (counts ? `Counts in your best ${c.counted} · tournament score ${r.total}` : `Below your best ${c.counted} · tournament score ${r.total}`) : 'The contract replayed the fight and the fish was lost.' }),
      h('div', { class: 'reveal-actions' }, h('button', { class: 'btn btn-primary', text: 'Next cast', onclick: hideOverlay })),
    ),
  );
  overlayEl.classList.remove('hidden');
}

// ------------------------------------------------------------------ controls and lists

let countdownEls: { el: HTMLElement; cup: Cup }[] = [];

function countdownText(c: Cup, nowMs: number): string {
  const now = nowMs / 1000;
  const stage = cupStage(c, nowMs);
  const span = (sec: number): string => (sec >= 3600 ? `${Math.floor(sec / 3600)} h ${Math.floor((sec % 3600) / 60)} min` : fmtCountdown(sec));
  if (stage === 'soon') return `starts in ${span(c.start - now)}`;
  if (stage === 'live') return `ends in ${span(c.end - now)}`;
  if (stage === 'closing') return `closed · prizes in ${span(c.end + cups.grace - now)}`;
  return 'over';
}

function paintCountdowns(): void {
  const now = Date.now();
  for (const { el, cup } of countdownEls) el.textContent = countdownText(cup, now);
}

function countdown(c: Cup, cls = 'muted small'): HTMLElement {
  const el = h('span', { class: cls, text: countdownText(c, Date.now()) });
  countdownEls.push({ el, cup: c });
  return el;
}

const tackleText = (c: Cup): string => `${RODS[c.rod]?.name ?? `rod ${c.rod}`}${c.lure ? ` + ${LURES[c.lure - 1]?.name ?? 'a lure'}` : ', no lure'}`;

function place(c: Cup): number {
  const me = state.wallet?.address.toLowerCase();
  return me ? (cups.standings[c.id] ?? []).findIndex((r) => r.address.toLowerCase() === me) : -1;
}

function controlsView(): HTMLElement[] {
  countdownEls = countdownEls.filter((x) => x.el.isConnected && !x.el.closest('.controls'));
  if (!cups.loaded) return [h('p', { class: 'muted', text: 'Reading the tournaments…' })];
  const c = current();
  if (!c) return [h('p', { class: 'empty', text: 'No tournament has been announced yet.' })];
  const now = Date.now();
  const stage = cupStage(c, now);
  const e = c.entry;
  const busy = cupBusy();
  const connected = !!state.wallet;
  const left = c.castLimit - e.castsUsed;
  const myPlace = place(c);
  const out: HTMLElement[] = [];

  let button: HTMLElement;
  let info: string;
  let warn = false;
  if (!connected) {
    button = h('button', { class: 'btn btn-cast', disabled: true }, 'Cast');
    info = 'Connect with Fluent to take part';
    warn = true;
  } else if (stage === 'over' || stage === 'closing') {
    const share = myPlace >= 0 && myPlace < 3 ? c.prize * PRIZE_SHARES[myPlace] : 0;
    if (stage === 'over' && share > 0 && !e.claimed) {
      button = h('button', { class: 'btn btn-cast', disabled: busy, onclick: () => void cupOps.claim(c.id).then((r) => r && (toast(`${blend(share)} BLEND is yours`, 'ok'), reload())) }, 'Claim');
      info = `Place ${myPlace + 1}: ${blend(share)} BLEND is waiting for you`;
    } else {
      button = h('button', { class: 'btn btn-cast', disabled: true }, stage === 'closing' ? 'Closed' : 'Over');
      info = e.claimed ? 'Your prize is claimed. Well fished!' : stage === 'closing' ? 'Fish already hooked can still be landed. Prizes open when the timer runs out.' : e.entered ? (myPlace >= 0 ? `You finished in place ${myPlace + 1}` : 'You did not score in this one') : 'This tournament is over';
    }
  } else if (!e.entered) {
    const rodName = RODS[c.rod]?.name ?? 'rod';
    button = h('button', { class: 'btn btn-cast', disabled: busy || !c.ownsRod, onclick: () => void cupOps.enter(c.id).then((r) => r && reload()) }, 'Enter');
    info = c.ownsRod ? `Free to enter. Everyone fishes with the ${rodName}` : `This tournament is for anglers who own the ${rodName}. Buy it in the tackle shop to enter`;
    warn = !c.ownsRod;
  } else if (stage === 'soon') {
    button = h('button', { class: 'btn btn-cast', disabled: true }, 'Cast');
    info = 'You are in. Casting opens when the tournament starts';
  } else if (busy) {
    button = h('button', { class: 'btn btn-cast', disabled: true }, 'In the water…');
    info = 'Press Hook! when the float dips, then hold to reel (Space works too). One try per fish';
  } else if (e.targetBlock !== 0n && phase === 'idle') {
    button = h('button', { class: 'btn btn-cast', onclick: () => void resume(c) }, 'Back to your fish');
    info = 'A fish from your last cast may still be on the line';
  } else if (left <= 0) {
    button = h('button', { class: 'btn btn-cast', disabled: true }, 'No casts left');
    info = `All ${c.castLimit} casts used. Your score stands at ${e.total}`;
  } else {
    button = h('button', { class: 'btn btn-cast', onclick: () => void doCast(c) }, 'Cast');
    info = `${left} of ${c.castLimit} casts left · no energy needed`;
  }
  out.push(h('div', { class: 'cast-row' }, button, h('div', { class: 'cast-info' }, h('div', { class: warn ? 'warn' : 'muted', text: info }))));

  const tile = (k: string, v: string, d: string): HTMLElement => h('div', { class: 'tk-big' }, h('span', { class: 'k', text: k }), h('span', { class: 'v', text: v }), h('span', { class: 'd', text: d }));
  out.push(
    h(
      'section',
      { class: 'picker' },
      h('div', { class: 'picker-head' }, h('h3', { text: c.name }), countdown(c)),
      h(
        'div',
        { class: 'tk-lo-out bonus-row' },
        tile('Prize', `${blend(c.prize)}`, 'BLEND · 50 / 30 / 20'),
        tile('Your score', String(e.total), e.entered ? (myPlace >= 0 ? `place ${myPlace + 1}` : 'no catch yet') : 'not entered'),
        tile('Casts', e.entered ? `${Math.max(0, left)}` : String(c.castLimit), e.entered ? `of ${c.castLimit} left` : 'per angler'),
        tile('Counted', String(c.counted), 'best catches'),
      ),
      e.best.length ? h('p', { class: 'small' }, h('span', { class: 'muted', text: 'Your counted catches: ' }), e.best.join(' · ')) : null,
      h(
        'div',
        { class: 'loc-info' },
        h('div', { class: 'loc-head' }, h('b', { text: LOCATIONS[c.locationId].name }), h('span', { class: 'muted small', text: `${tackleText(c)} for everyone` })),
        h('p', { class: 'muted small', text: `Every cast hooks a fish; which one is the luck of the draw. The points are yours to win: land it and it scores half, keep the needle in the green and it scores up to all of it. A lost fish scores nothing. Your ${c.counted} best catches make your score, ties go to whoever got there first.` }),
        h('p', { class: 'muted small', text: 'The contract replays every fight from your recorded input, so the score is the contract’s, not the browser’s. You have about two minutes from the bite to land the fish and send it.' }),
        h('p', { class: 'muted small' }, icon('lock', 'Rod'), ` Open to anglers who own the ${RODS[c.rod]?.name ?? 'rod'}. Everyone fishes with it, so nobody has better tackle than you.`),
      ),
    ),
  );
  return out;
}

function addressLink(address: string, me: boolean): HTMLElement | string {
  const name = me ? 'You' : shortAddr(address);
  if (!EXPLORER_URL) return name;
  return h('a', { class: 'addr-link', text: name, title: `${address} · open in the explorer`, attrs: { href: `${EXPLORER_URL}/address/${address}`, target: '_blank', rel: 'noopener noreferrer' } });
}

function sideView(): HTMLElement[] {
  countdownEls = countdownEls.filter((x) => x.el.isConnected && !x.el.closest('.cup-side'));
  if (!cups.loaded) return [h('p', { class: 'muted', text: 'Reading the tournaments…' })];
  const c = current();
  const now = Date.now();
  const me = state.wallet?.address.toLowerCase();
  const out: HTMLElement[] = [];
  out.push(
    h(
      'section',
      { class: 'shop-sec' },
      h('div', { class: 'dex-head' }, h('h3', { text: 'Tournaments' })),
      cups.list.length === 0 ? h('p', { class: 'empty', text: 'No tournament has been announced yet.' }) : null,
      h(
        'div',
        { class: 'cup-list' },
        cups.list.map((t) => {
          const stage = cupStage(t, now);
          return h(
            'button',
            {
              class: `spot cup-item ${c?.id === t.id ? 'sel' : ''} ${stage === 'over' ? 'locked' : ''}`,
              disabled: cupBusy(),
              onclick: () => {
                picked = t.id;
                void loadCupStandings(t.id);
                emit();
              },
            },
            h('span', { class: 'spot-name', text: t.name }),
            h('span', { class: 'spot-meta' }, h('span', { class: 'blend', text: `${blend(t.prize)} BLEND` }), h('span', { class: 'sep', text: '·' }), countdown(t, ''), t.entry.entered ? h('span', { class: 'sep', text: '· you are in' }) : null),
          );
        }),
      ),
    ),
  );
  if (c) {
    const table = cups.standings[c.id] ?? [];
    const stage = cupStage(c, now);
    const unwon = stage === 'over' && !c.reclaimed && table.length < 3 && me === c.sponsor.toLowerCase();
    out.push(
      h(
        'section',
        { class: 'shop-sec' },
        h('div', { class: 'dex-head' }, h('h3', { text: stage === 'over' ? 'Final standings' : 'Standings' }), h('div', { class: 'spacer' }), h('span', { class: 'muted small', text: `${c.players} entered` })),
        table.length === 0 ? h('p', { class: 'empty', text: stage === 'soon' ? 'Not started yet.' : 'Nobody has scored yet.' }) : null,
        table.length
          ? h(
              'table',
              { class: 'board' },
              h('thead', null, h('tr', null, h('th', { text: '#' }), h('th', { text: 'Angler' }), h('th', { text: 'Score' }), h('th', { text: 'Prize' }))),
              h(
                'tbody',
                null,
                table.map((r, i) =>
                  h(
                    'tr',
                    { class: r.address.toLowerCase() === me ? 'me' : '' },
                    h('td', { text: String(i + 1) }),
                    h('td', null, addressLink(r.address, r.address.toLowerCase() === me)),
                    h('td', { text: pearl(r.total) }),
                    h('td', { class: i < 3 ? 'blend' : 'muted', text: i < 3 ? `${blend(c.prize * PRIZE_SHARES[i])}` : '—' }),
                  ),
                ),
              ),
            )
          : null,
        h('p', { class: 'muted small', text: 'The ten best anglers, straight from the tournament contract. Prizes are paid in BLEND and claimed by the winners themselves once the tournament is over.' }),
        unwon ? h('button', { class: 'btn btn-sm', text: 'Take back unwon prizes', onclick: () => void cupOps.reclaim(c.id).then((r) => r && reload()) }) : null,
      ),
    );
  }
  return out;
}
