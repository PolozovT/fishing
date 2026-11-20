/** The pond: scene, cast → bite → hook → reel flow, and the controls under it. */
import {
  GameError,
  castBlocker,
  currentTotals,
  energyNow,
  hookFish,
  landFish,
  landPrize,
  recordEscape,
  rodBroken,
  rodRepairPrice,
  rollBite,
  startCast,
  isValuable,
  type CastTicket,
  type Hooked,
  type Landing,
  saleValue,
} from '../../game/actions';
import { BLEND_PRIZE, LOCATIONS, QUALITIES, SPECIES, TUNING, special } from '../../game/content';
import { fishPrice, levelOf } from '../../game/economy';
import type { CastOutcome } from '../../game/chainOutcome';
import {
  CLEAN_HOOK_HEAD_START,
  START_DIST,
  accuracy,
  bandOf,
  biteDelay,
  difficultyOf,
  greenWidth,
  hookWindow,
  isCleanHook,
  qualityOf,
  reelParams,
  reelStart,
  reelStep,
  type Difficulty,
  type ReelParams,
  type ReelState,
} from '../../game/minigame';
import { canEnter, isUnlocked, unlockText } from '../../game/progress';
import { RARITY_CLASS } from '../../i18n';
import { WaterScene } from '../../scene';
import { emit, state } from '../../store';
import { lureById, rodById } from '../../tackle/catalog';
import { lureSprite, rodSprite } from '../../tackle/sprites';
import { fmtWeight, h, icon, mount, segBar, sigOf } from '../../ui/dom';
import { dropdown } from '../../ui/dropdown';
import { toast } from '../../ui/toast';
import { fishArt } from '../fishSprite';
import { blocksUntilExpiry, outcomeOf, previewCast, tx, waitPastBlock, world } from '../chain';
import { CHAIN, ops, refresh, refreshStandings } from '../ops';
import { act, commit, getSave, rev } from '../state';
import { pearl, qualityTag, rarityTag } from './fmt';
import { showPrizeReveal } from './prize';

/** 'landing' exists on the contracts only: the reel transaction is on its way. */
type Phase = 'idle' | 'casting' | 'waiting' | 'bite' | 'landing' | 'reeling' | 'result';

let scene: WaterScene;
let statusEl: HTMLElement;
let overlayEl: HTMLElement;
let lockEl: HTMLElement;
let hookBtn: HTMLButtonElement;
let landBtn: HTMLButtonElement;
let reelEl: HTMLElement;
let phase: Phase = 'idle';
let ticket: CastTicket | null = null;
let hooked: Hooked | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
/** Location whose details are shown under the picker (may be a locked one). */
let viewLoc: number | null = null;

export function initPond(sceneHost: HTMLElement, controlsHost: HTMLElement): () => void {
  const canvas = h('canvas', { class: 'water', attrs: { 'aria-label': 'Water' } });
  statusEl = h('div', { class: 'scene-status' });
  overlayEl = h('div', { class: 'scene-overlay hidden' });
  lockEl = h('div', { class: 'scene-lock hidden' });
  hookBtn = h('button', { class: 'btn btn-reel hidden', text: 'Hook!', onclick: () => doHook() });
  landBtn = h('button', { class: 'btn btn-reel hidden', text: 'Land it', title: 'Send the settlement transaction again', onclick: () => void settleOnChain() });
  reelEl = h('div', { class: 'reel hidden' });
  sceneHost.append(canvas, statusEl, lockEl, hookBtn, landBtn, reelEl, overlayEl);
  scene = new WaterScene(canvas);

  sceneHost.addEventListener('pointerdown', (e) => {
    if (phase === 'reeling') {
      e.preventDefault();
      holding = true;
    }
  });
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('pointerup', () => (holding = false));
  window.addEventListener('blur', () => (holding = false));

  const renderControls = mount(controlsHost, () => sigOf(rev(), phase, viewLoc, energyNow(getSave(), Date.now()), state.wallet?.address), renderControlsView);
  return () => {
    renderControls();
    resumeChainCast();
    syncScene();
  };
}

/** A locked water the player picked to look at: the scene shows it behind a lock. Never while a cast is out. */
function peekLocation(): number | null {
  if (viewLoc === null || pondBusy()) return null;
  return canEnter(getSave(), LOCATIONS[viewLoc]) ? null : viewLoc;
}

let lockShown: number | null = null;
/** The water in the scene: the one being fished, or a locked one the player is looking at. */
function syncScene(): void {
  const peek = peekLocation();
  scene.setSpot(peek ?? ticket?.locationId ?? getSave().location);
  statusEl.textContent = statusText();
  lockEl.classList.toggle('hidden', peek === null);
  if (peek === lockShown) return;
  lockShown = peek;
  if (peek === null) return lockEl.replaceChildren();
  const loc = LOCATIONS[peek];
  lockEl.replaceChildren(h('div', { class: 'scene-lock-card' }, icon('lock', 'Locked'), h('b', { text: loc.name }), h('span', { text: unlockText(loc.unlock, getSave()) })));
}

export const pondBusy = (): boolean => phase !== 'idle' && phase !== 'result';

function setPhase(p: Phase): void {
  phase = p;
  hookBtn.classList.toggle('hidden', p !== 'bite');
  hookBtn.disabled = false;
  landBtn.classList.toggle('hidden', !(p === 'landing' && landRetry));
  reelEl.classList.toggle('hidden', p !== 'reeling');
  statusEl.textContent = statusText();
  emit();
}

function statusText(): string {
  switch (phase) {
    case 'casting':
      return 'Casting…';
    case 'waiting':
      return 'Waiting for a bite…';
    case 'bite':
      return 'Bite! Hook it!';
    case 'landing':
      return landRetry ? 'At the pier: land it to claim it' : reveal || !predicted ? 'Setting the hook…' : 'Landing your catch…';
    case 'reeling':
      return 'Fish on! Reel it in';
    default: {
      const peek = peekLocation();
      return peek === null ? 'Ready to cast' : `${LOCATIONS[peek].name} · locked`;
    }
  }
}

// ------------------------------------------------------------------ cast → bite → hook

/** What the player did in the current fight. Shown on the catch card; in local play it also decides the result. */
interface Fight {
  d: Difficulty;
  /** Seconds from the float dipping to the hook. */
  reaction: number;
  clean: boolean;
  /** 0 for the first try at this fish. */
  attempt: number;
  accuracy: number;
}
let fight: Fight | null = null;
let biteAt = 0;
/** Tries at the fish on the line. On the contracts a lost fight is a retry, never a lost fish. */
let attempt = 0;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const hookedRarity = (hk: Hooked) => (hk.prize ? BLEND_PRIZE.fightRarity : SPECIES[hk.speciesId].rarity);
const difficultyNow = (): Difficulty => difficultyOf(hookedRarity(hooked!), LOCATIONS[ticket!.locationId].tier);
/** A lure with catch makes fish find it sooner. */
const quickness = (t: CastTicket): number => 1 - Math.min(0.4, Math.max(0, t.totals.lure.catch) * 0.03);

function doCast(): void {
  if (pondBusy()) return;
  if (CHAIN) return void castOnChain();
  hideOverlay();
  const r = act(
    (s) => startCast(s, Date.now()),
    (x) => x.save,
  );
  if (!r) return;
  ticket = r.ticket;
  scene.setSpot(ticket.locationId);
  scene.setPhase('casting');
  setPhase('casting');
  timer = setTimeout(() => {
    scene.setPhase('waiting');
    setPhase('waiting');
    timer = setTimeout(onWaitOver, biteDelay(LOCATIONS[r.ticket.locationId].tier, quickness(r.ticket), Math.random) * 1000);
  }, 900);
}

function onWaitOver(): void {
  if (!ticket) return;
  if (!rollBite(ticket, Math.random)) {
    scene.setPhase('idle');
    finish();
    showMessage('Nothing is biting', 'The float never moved. A lure with catch brings more bites.');
    return;
  }
  hooked = hookFish(getSave(), ticket, Math.random);
  attempt = 0;
  beginBite();
}

/** The float dips: the player has a short window to set the hook. Rarer fish and rougher water leave less time. */
function beginBite(): void {
  if (!ticket || !hooked) return;
  scene.setPhase('bite');
  setPhase('bite');
  biteAt = performance.now();
  // On the contracts the fish cannot be lost to slow hands, so after three misses it simply stays on.
  if (CHAIN && attempt >= 3) return;
  timer = setTimeout(onHookMissed, hookWindow(difficultyNow()) * 1000);
}

function onHookMissed(): void {
  if (phase !== 'bite') return;
  if (CHAIN) {
    attempt++;
    scene.setPhase('waiting');
    setPhase('waiting');
    showMessage('Too slow!', 'It dropped the lure, but it is still circling. Watch the float and hit Hook! the moment it dips.');
    retryOrSettle();
    return;
  }
  commit(recordEscape(getSave()));
  scene.setPhase('missed');
  finish();
  showMessage('Too slow!', 'The fish spat the hook. Hit "Hook!" as soon as the float dips.');
}

function doHook(): void {
  if (CHAIN && !predicted) return void legacyHookOnChain();
  if (phase !== 'bite' || !ticket || !hooked) return;
  clearTimeout(timer);
  const d = difficultyNow();
  const reaction = (performance.now() - biteAt) / 1000;
  const clean = isCleanHook(reaction, d);
  fight = { d, reaction, clean, attempt, accuracy: 0 };
  scene.setPhase('reeling');
  setPhase('reeling');
  // a retried fish is tired: each try widens the green band and softens its jerks
  startReel(reelParams(d, ticket.totals.zone, CHAIN ? attempt : 0), clean ? CLEAN_HOOK_HEAD_START : 0);
}

// ------------------------------------------------------------------ the same flow on the contracts
//
// cast() transaction → wait for the randomness block → the outcome is now fixed and public, so the client works
// it out (game/chainOutcome.ts) and plays bite, hook and fight on it → reel() transaction settles.
// The contract decides the catch; the fight decides only how soon the player gets to settle it.

/** The pending cast as the client predicts it; null while unknown (then the fallback path settles first). */
let predicted: CastOutcome | null = null;
/** A pending cast known to hold nothing (no bite, or its block expired). The next cast() settles it for free. */
let deadNonce: bigint | null = null;
/** The settlement transaction did not go through: the fish waits at the pier for another try. */
let landRetry = false;
/** Fallback path only: what to show once the replayed fight ends. */
let reveal: (() => void) | null = null;

async function castOnChain(): Promise<void> {
  hideOverlay();
  const s = getSave();
  const me = state.wallet?.address;
  const locationId = s.location;
  const totalsNow = currentTotals(s, locationId);
  scene.setSpot(locationId);
  scene.setPhase('casting');
  setPhase('casting');
  const receipt = await tx('Cast', { functionName: 'cast', args: [locationId] }, true);
  if (!receipt) {
    scene.setPhase('idle');
    finish();
    return;
  }
  // cast() settles a finished earlier cast first; normally that one was an empty hook the player already saw
  const earlier = me ? outcomeOf(receipt, me) : null;
  if (earlier?.kind === 'caught') toast(`Your previous cast landed a ${SPECIES[earlier.speciesId]?.name ?? 'fish'}: it is in the keepnet`, 'ok');
  else if (earlier?.kind === 'bottle') toast(`Your previous cast landed a bottle: +${earlier.amount} BLEND`, 'ok');
  ticket = { locationId, totals: totalsNow };
  await refresh();
  if (world.cast) void watchChainCast(world.cast.targetBlock);
  else finish();
}

/** Waits for the randomness block, works out what the cast holds, and stages the bite. */
async function watchChainCast(target: bigint): Promise<void> {
  predicted = null;
  hooked = null;
  scene.setPhase('waiting');
  setPhase('waiting');
  const since = performance.now();
  await waitPastBlock(target, () => phase === 'waiting');
  if (phase !== 'waiting') return;
  let out: CastOutcome | null = null;
  try {
    out = await previewCast();
  } catch (e) {
    console.warn('[preview] could not predict the cast, settling first instead', e);
  }
  if (phase !== 'waiting' || !ticket) return;
  if (!out) {
    scene.setPhase('bite');
    setPhase('bite');
    return;
  }
  // the block arrives in a couple of seconds; fish do not always bite that fast
  const wait = biteDelay(LOCATIONS[ticket.locationId].tier, quickness(ticket), Math.random) * 1000 - (performance.now() - since);
  if (wait > 0) await sleep(wait);
  if (phase !== 'waiting' || !ticket) return;
  if (out.kind === 'missed' || out.kind === 'expired') {
    deadNonce = world.cast?.nonce ?? null;
    scene.setPhase('idle');
    finish();
    if (out.kind === 'expired') showMessage('Too late', 'More than 256 blocks passed, so the randomness for this cast is gone, and the fish with it.');
    else showMessage('Nothing is biting', 'The float never moved. A lure with catch brings more bites. No transaction needed: just cast again.');
    return;
  }
  predicted = out;
  attempt = 0;
  hooked = out.kind === 'bottle' ? { speciesId: -1, weight: 0, isSpecial: false, prize: out.amount } : { speciesId: out.speciesId, weight: out.weight, isSpecial: out.special };
  beginBite();
}

/** A cast left in the water by an earlier visit (or another tab) is picked up again. */
function resumeChainCast(): void {
  if (!CHAIN || phase !== 'idle' || !world.cast || !state.wallet || world.cast.nonce === deadNonce) return;
  const s = getSave();
  ticket = { locationId: world.cast.locationId, totals: currentTotals(s, world.cast.locationId) };
  void watchChainCast(world.cast.targetBlock);
}

/** After a missed hook or a lost fight: bite again shortly, unless the cast is about to expire. */
function retryOrSettle(): void {
  const again = (): void => {
    if (phase === 'waiting' && predicted) beginBite();
  };
  timer = setTimeout(again, 2900 + Math.random() * 1400);
  void blocksUntilExpiry()
    .then((left) => {
      if (left < 45 && phase === 'waiting' && predicted) {
        clearTimeout(timer);
        showMessage('No time left', 'This cast is about to expire, so the fish is hauled straight in.');
        void settleOnChain();
      }
    })
    .catch(() => undefined);
}

/** The settlement: one reel() transaction. Whatever the contract says is the result. */
async function settleOnChain(): Promise<void> {
  const me = state.wallet?.address;
  if (!me || (phase === 'landing' && !landRetry)) return;
  landRetry = false;
  setPhase('landing');
  const before = getSave();
  const receipt = await tx('Land the catch', { functionName: 'reel', args: [] }, true);
  if (!receipt) {
    // rejected or failed: the catch is still there to be claimed until its block is 256 blocks old
    await refresh();
    if (world.cast) {
      landRetry = true;
      setPhase('landing');
    } else {
      scene.setPhase('idle');
      finish();
    }
    return;
  }
  const out = outcomeOf(receipt, me);
  await refresh();
  void refreshStandings();
  const guess = predicted;
  predicted = null;
  const same = guess && out && guess.kind === out.kind && (guess.kind !== 'caught' || (out.kind === 'caught' && guess.speciesId === out.speciesId && guess.weight === out.weight && guess.quality === out.quality));
  if (guess && !same) console.warn('[preview] predicted', guess, 'but the contract settled', out, '— the contract is right');
  if (!out || out.kind === 'missed' || out.kind === 'expired') {
    scene.setPhase('missed');
    finish();
    if (out?.kind === 'expired') showMessage('Too late', 'More than 256 blocks passed, so the randomness for this cast is gone, and the fish with it.');
    else showMessage('It got away!', 'Nothing stayed on the hook this time.');
    return;
  }
  const note = fightNote();
  scene.setPhase('caught');
  finish();
  phase = 'result';
  if (out.kind === 'bottle') showPrize(out.amount);
  else showCatch(landingFrom(out, before), note);
}

type CaughtOutcome = Extract<NonNullable<ReturnType<typeof outcomeOf>>, { kind: 'caught' }>;

/** The catch card's data for a fish the contract just minted. `before` is the save from before the settlement. */
function landingFrom(out: CaughtOutcome, before: ReturnType<typeof getSave>): Landing {
  const sp = SPECIES[out.speciesId];
  const after = getSave();
  const quality = QUALITIES[out.quality] ?? 'B';
  const prev = before.dex[out.speciesId];
  return {
    save: after,
    fish: after.fish.find((f) => f.id === out.fishId) ?? {
      id: out.fishId,
      speciesId: out.speciesId,
      rarity: sp.rarity,
      weight: out.weight,
      quality,
      locationId: out.locationId,
      caughtAt: Date.now(),
      sellPrice: fishPrice(sp, out.weight, quality),
      tournamentScore: out.score,
      isFavorite: false,
      isSpecial: out.special,
    },
    newSpecies: !prev,
    newBest: !!prev && out.weight > prev.best,
    newOverallRecord: !!before.records.overall && out.weight > before.records.overall.weight,
    levelUp: levelOf(after.xp) > levelOf(before.xp) ? levelOf(after.xp) : null,
    unlocked: out.unlocked,
    countedThisWeek: out.counted,
  };
}

/** One line about how the player fought, for the catch card. */
function fightNote(): string | null {
  const f = fight;
  if (!f) return null;
  const parts = [`hook ${f.reaction.toFixed(2)} s${f.clean ? ' (clean)' : ''}`, `${Math.round(f.accuracy * 100)}% in the green`];
  if (f.attempt > 0) parts.push(`try ${f.attempt + 1}`);
  return `Your fight: ${parts.join(' · ')}`;
}

/**
 * Fallback when the outcome could not be predicted (RPC trouble): settle first, then play the fight as a replay
 * of a catch that is already final.
 */
async function legacyHookOnChain(): Promise<void> {
  if (phase !== 'bite') return;
  const me = state.wallet?.address;
  if (!me) return;
  setPhase('landing');
  const before = getSave();
  const receipt = await tx('Reel in', { functionName: 'reel', args: [] }, true);
  if (!receipt) {
    // rejected or failed: the fish is still on the line (until the randomness block is 256 blocks old)
    await refresh();
    if (world.cast) setPhase('bite');
    else {
      scene.setPhase('idle');
      finish();
    }
    return;
  }
  const out = outcomeOf(receipt, me);
  await refresh();
  void refreshStandings();
  if (!out || out.kind === 'missed' || out.kind === 'expired') {
    scene.setPhase('missed');
    finish();
    if (out?.kind === 'expired') showMessage('Too late', 'More than 256 blocks passed, so the randomness for this cast is gone, and the fish with it.');
    else showMessage('It got away!', 'Nothing stayed on the hook this time. A lure with catch brings more bites.');
    return;
  }
  if (out.kind === 'bottle') {
    hooked = { speciesId: -1, weight: 0, isSpecial: false, prize: out.amount };
    reveal = () => showPrize(out.amount);
  } else {
    const landing = landingFrom(out, before);
    hooked = { speciesId: out.speciesId, weight: out.weight, isSpecial: out.special };
    reveal = () => showCatch(landing);
  }
  scene.setPhase('reeling');
  setPhase('reeling');
  fight = null;
  startReel(reelParams(difficultyOf(hookedRarity(hooked), LOCATIONS[ticket?.locationId ?? before.location].tier), (ticket ?? { totals: currentTotals(before) }).totals.zone), 0);
}

function finish(): void {
  clearTimeout(timer);
  ticket = null;
  hooked = null;
  holding = false;
  setPhase('idle');
}

// ------------------------------------------------------------------ reel mini-game

let holding = false;
let reel: ReelState | null = null;
let reelP: ReelParams | null = null;
let promptEl: HTMLElement;
let needleEl: HTMLElement;
let gaugeEl: HTMLElement;
let fishEl: HTMLElement;
let tautEl: HTMLElement;
let holdBtn: HTMLButtonElement;

const PULL = ['A light tug', 'A steady pull', 'A strong fish', 'A heavy fish!', 'A monster!', 'Something unreal…'];

function startReel(p: ReelParams, headStart: number): void {
  reelP = p;
  reel = reelStart(Math.random, headStart);
  promptEl = h('div', { class: 'reel-prompt', attrs: { role: 'status', 'aria-live': 'assertive' } });
  needleEl = h('div', { class: 'gauge-needle' });
  const pc = (v: number): string => `${v * 100}%`;
  gaugeEl = h(
    'div',
    { class: 'gauge', attrs: { 'aria-hidden': 'true' } },
    h('div', { class: 'gauge-seg slack', style: `width:${pc(p.green[0])}` }, h('span', { text: 'Slack' })),
    h('div', { class: 'gauge-seg green', style: `width:${pc(p.green[1] - p.green[0])}` }, h('span', { text: 'Good' })),
    h('div', { class: 'gauge-seg red', style: `width:${pc(1 - p.green[1])}` }, h('span', { text: 'Snap!' })),
    needleEl,
  );
  // the fish is dragged in by the hook in its mouth, on a taut line from the angler
  fishEl = h('div', { class: 'haul-fish' }, icon('hook'), icon('fish'));
  tautEl = h('div', { class: 'haul-taut' });
  holdBtn = h('button', { class: 'btn btn-primary reel-hold', text: 'Hold to reel' });
  const down = (e: Event): void => {
    e.preventDefault();
    holding = true;
  };
  holdBtn.addEventListener('pointerdown', down);
  holdBtn.addEventListener('contextmenu', (e) => e.preventDefault());
  const parts = [
    promptEl,
    h('div', { class: 'reel-label' }, h('span', { text: 'Line tension' }), h('span', { class: 'muted', text: `${hooked!.prize ? 'Something odd on the line…' : PULL[fight?.d ?? hookedRarity(hooked!)]}${headStart > 0 ? ' · clean hook: head start' : ''}` })),
    CHAIN
      ? h('div', {
          class: 'reel-note',
          text: reveal
            ? 'Already yours: the contract decided this catch. The fight is for the joy of it.'
            : fight && fight.attempt > 0
              ? `Try ${fight.attempt + 1}: it is tiring, the green zone is wider now.`
              : 'The contract has fixed what is on the hook. Land it to claim it: a lost fight means another try, not a lost fish.',
        })
      : null,
    gaugeEl,
    h('div', { class: 'haul', attrs: { 'aria-hidden': 'true' } }, h('span', { class: 'haul-you', text: 'You' }), h('div', { class: 'haul-line' }, tautEl, fishEl)),
    holdBtn,
  ];
  reelEl.replaceChildren(...parts.filter((x): x is HTMLElement => !!x));
  paintReel();
  let last = performance.now();
  const frame = (now: number): void => {
    if (phase !== 'reeling' || !reel || !reelP) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    reel = reelStep(reel, holding, dt, reelP, Math.random);
    paintReel();
    if (reel.result === 'fighting') requestAnimationFrame(frame);
    else endReel(reel);
  };
  requestAnimationFrame(frame);
}

/** One plain instruction at a time: what to do with the button right now. */
function promptFor(r: ReelState, p: ReelParams): { text: string; cls: string } {
  const band = bandOf(r.tension, p);
  if (band === 'red') return { text: 'Let go! The line is about to snap', cls: 'bad' };
  if (r.mood === 'pull') return band === 'slack' ? { text: 'It jerks: take up the slack gently', cls: 'warn' } : { text: 'It jerks: let go!', cls: 'warn' };
  if (r.mood === 'warn') return { text: 'Careful: it is about to jerk', cls: 'warn' };
  if (band === 'slack') return { text: 'Hold to reel in', cls: '' };
  return { text: 'Good! Keep the needle in the green', cls: 'good' };
}

function paintReel(): void {
  if (!reel || !reelP) return;
  needleEl.style.left = `${reel.tension * 100}%`;
  const at = `${Math.min(1, reel.dist / START_DIST) * 100}%`;
  fishEl.style.left = at;
  tautEl.style.width = at;
  tautEl.classList.toggle('slack', bandOf(reel.tension, reelP) === 'slack');
  const pr = promptFor(reel, reelP);
  if (promptEl.textContent !== pr.text) promptEl.textContent = pr.text;
  promptEl.className = `reel-prompt ${pr.cls}`;
  gaugeEl.classList.toggle('pulling', reel.mood === 'pull');
  gaugeEl.classList.toggle('warning', reel.mood === 'warn');
  fishEl.classList.toggle('pulling', reel.mood === 'pull');
  holdBtn.classList.toggle('down', holding);
}

function endReel(r: ReelState): void {
  if (fight) fight.accuracy = accuracy(r);
  if (CHAIN) {
    if (reveal) {
      // fallback path: the catch was settled before the fight, so the fight was only a replay
      const show = reveal;
      reveal = null;
      scene.setPhase('caught');
      finish();
      phase = 'result';
      show();
      return;
    }
    if (r.result === 'landed') return void settleOnChain();
    attempt++;
    if (attempt >= 3) {
      showMessage('Worn out at last', 'Three rounds were enough: it has no fight left. Hauling it in.');
      return void settleOnChain();
    }
    scene.setPhase('waiting');
    setPhase('waiting');
    showMessage(
      r.lost === 'snapped' ? 'Too much tension!' : 'It ran with your line!',
      r.lost === 'snapped' ? 'You had to give line to save it. The hook held: it will bite again, and it is tiring.' : 'The line went slack and it took off. The hook held: it will bite again, and it is tiring.',
    );
    retryOrSettle();
    return;
  }
  const t = ticket;
  const hk = hooked;
  if (!t || !hk) return finish();
  if (r.result === 'escaped') {
    commit(recordEscape(getSave()));
    scene.setPhase('missed');
    finish();
    showMessage(r.lost === 'snapped' ? 'The line snapped!' : 'It got away!', r.lost === 'snapped' ? 'Too much tension. Let go when the needle enters the red, and the moment the fish warns of a jerk.' : 'The line was slack for too long. Hold to reel and keep the needle in the green.');
    return;
  }
  if (hk.prize) {
    const amount = hk.prize;
    const ok = act((s) => landPrize(s, hk), (x) => x) !== undefined;
    scene.setPhase('caught');
    finish();
    if (ok) {
      phase = 'result';
      showPrize(amount);
    }
    return;
  }
  const quality = qualityOf(accuracy(r));
  let landing: Landing;
  try {
    landing = landFish(getSave(), t, hk, quality, Date.now());
  } catch (e) {
    finish();
    if (e instanceof GameError) toast(e.message, 'err');
    else throw e;
    return;
  }
  commit(landing.save);
  const note = fightNote();
  scene.setPhase('caught');
  finish();
  phase = 'result';
  showCatch(landing, note);
}

function onKey(e: KeyboardEvent): void {
  if (e.code !== 'Space' && e.code !== 'Enter') return;
  const tag = (e.target as HTMLElement | null)?.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  if (phase === 'bite') {
    e.preventDefault();
    doHook();
  } else if (phase === 'reeling') {
    e.preventDefault();
    holding = true;
  }
}
function onKeyUp(e: KeyboardEvent): void {
  if (e.code !== 'Space' && e.code !== 'Enter') return;
  if (phase === 'reeling' || holding) {
    e.preventDefault();
    holding = false;
  }
}

// ------------------------------------------------------------------ overlays

/** Stops the bottle reveal's animation loop, while one is on screen. */
let stopPrize: (() => void) | null = null;

function hideOverlay(): void {
  clearTimeout(overlayTimer);
  stopPrize?.();
  stopPrize = null;
  overlayEl.classList.add('hidden');
  overlayEl.replaceChildren();
  if (phase === 'result') {
    phase = 'idle';
    scene.setPhase('idle');
    statusEl.textContent = statusText();
    emit();
  }
}

let overlayTimer: ReturnType<typeof setTimeout> | undefined;
function showMessage(title: string, text: string): void {
  clearTimeout(overlayTimer);
  overlayEl.replaceChildren(h('div', { class: 'reveal reveal-miss' }, h('div', { class: 'reveal-title', text: title }), h('p', { text })));
  overlayEl.classList.remove('hidden');
  overlayTimer = setTimeout(hideOverlay, 2600);
}

/**
 * The bottle: the scene shows it coming out of the water in a golden splash, then the reveal takes the screen
 * (play/ui/prize.ts).
 */
function showPrize(amount: number): void {
  clearTimeout(overlayTimer);
  scene.prize();
  overlayTimer = setTimeout(() => {
    stopPrize = showPrizeReveal(overlayEl, amount, {
      note: `Not a fish at all: there are tokens inside. ${CHAIN ? 'The game contract has sent them to your wallet.' : 'Local game: the balance is stored in this browser.'}`,
      onClose: hideOverlay,
    });
  }, 750);
}

function showCatch(l: Landing, fightLine: string | null = null): void {
  clearTimeout(overlayTimer);
  const f = l.fish;
  const sp = SPECIES[f.speciesId];
  const notes: HTMLElement[] = [];
  const note = (cls: string, text: string): void => void notes.push(h('div', { class: `note ${cls}`, text }));
  if (f.isSpecial) note('gold', 'Special fish! See the Trophies tab');
  if (l.newSpecies) note('gold', 'New species discovered');
  if (l.newOverallRecord) note('gold', 'Your heaviest fish ever');
  else if (l.newBest) note('', `Personal best for ${sp.name}`);
  if (l.levelUp) note('gold', `Level ${l.levelUp}!`);
  for (const id of l.unlocked) note('gold', `${LOCATIONS[id].name} unlocked`);
  const canQuickSell = !f.isSpecial && !isValuable(f);
  overlayEl.replaceChildren(
    h(
      'div',
      { class: `reveal reveal-catch ${RARITY_CLASS[f.rarity]}` },
      h('div', { class: 'reveal-title', text: 'Catch!' }),
      fishArt(f.speciesId, { cls: 'reveal-img' }),
      h('div', { class: 'reveal-name', text: sp.name }),
      h('div', { class: 'reveal-tags' }, rarityTag(f.rarity), qualityTag(f.quality)),
      h('div', { class: 'reveal-stats' }, h('span', { text: fmtWeight(f.weight) }), h('span', { class: 'pearl', text: `${pearl(f.sellPrice)} PEARL` })),
      h('div', { class: 'muted small', text: l.countedThisWeek ? `+${f.tournamentScore} pts · counts in this week's top 10` : `${f.tournamentScore} pts · below your weekly top 10` }),
      fightLine ? h('div', { class: 'muted small', text: fightLine }) : null,
      notes,
      h('div', { class: 'muted small', text: `Fresh catch: +${Math.round(TUNING.freshBonus * 100)}% if sold within ${TUNING.freshWindowMs / 60_000} min, ${pearl(f.sellPrice)} after` }),
      h(
        'div',
        { class: 'reveal-actions' },
        canQuickSell
          ? h('button', {
              class: 'btn',
              text: `Sell now · ${pearl(saleValue(f, Date.now()))}`,
              onclick: () => {
                hideOverlay();
                void ops.sellFish([f.id]);
              },
            })
          : null,
        h('button', { class: 'btn btn-primary', text: 'Keep', onclick: hideOverlay }),
      ),
    ),
  );
  overlayEl.classList.remove('hidden');
}

// ------------------------------------------------------------------ controls

function locationInfo(id: number): HTMLElement {
  const s = getSave();
  const loc = LOCATIONS[id];
  const open = isUnlocked(s, loc);
  const sp = loc.special ? special(loc.special) : undefined;
  const names = loc.pool.map(([sid]) => (s.dex[sid] ? SPECIES[sid].name : '???'));
  const rec = loc.recommended.map((t) => rodById(t)?.name ?? lureById(t)?.name).filter(Boolean);
  return h(
    'div',
    { class: `loc-info${open ? '' : ' locked'}` },
    h('div', { class: 'loc-head' }, h('b', { text: loc.name }), h('span', { class: 'muted small' }, icon('bolt', 'Energy'), ` ${loc.energyCost} per cast · ${loc.water} water`)),
    h('p', { class: 'muted small', text: loc.blurb }),
    open ? null : h('p', { class: 'warn small' }, icon('lock', 'Locked'), ` ${unlockText(loc.unlock, s)}`),
    h('p', { class: 'small' }, h('span', { class: 'muted', text: 'Fish: ' }), names.join(', ')),
    sp ? h('p', { class: 'small' }, h('span', { class: 'muted', text: 'Special: ' }), s.specialsFound.includes(sp.id) ? sp.name : 'a very rare fish lives here') : null,
    rec.length ? h('p', { class: 'small' }, h('span', { class: 'muted', text: 'Good tackle: ' }), rec.join(', ')) : null,
  );
}

const signed = (n: number): string => (n > 0 ? `+${n}` : String(n));

function renderControlsView(): HTMLElement[] {
  const s = getSave();
  const now = Date.now();
  const busy = pondBusy();
  const out: HTMLElement[] = [];

  const reason = CHAIN && !state.wallet ? 'Connect with Fluent to fish' : castBlocker(s, now);
  const cost = LOCATIONS[s.location].energyCost;
  out.push(
    h(
      'div',
      { class: 'cast-row' },
      h('button', { class: 'btn btn-cast', disabled: busy || !!reason, onclick: doCast }, busy ? 'In the water…' : 'Cast'),
      h(
        'div',
        { class: 'cast-info' },
        h('div', { class: reason && !busy ? 'warn' : 'muted', text: busy ? 'Press Hook! the moment the float dips, then hold to reel (Space works too)' : reason ?? `Costs ${cost} energy · you have ${energyNow(s, now)}` }),
      ),
    ),
  );

  out.push(
    h(
      'section',
      { class: 'picker' },
      h('h3', { text: 'Location' }),
      h(
        'div',
        { class: 'spots' },
        LOCATIONS.map((loc) => {
          const open = canEnter(s, loc);
          return h(
            'button',
            {
              class: `spot ${s.location === loc.id ? 'sel' : ''} ${open ? '' : 'locked'} ${viewLoc === loc.id && !open ? 'peek' : ''}`,
              disabled: busy,
              title: open ? loc.blurb : unlockText(loc.unlock, s),
              onclick: () => {
                viewLoc = loc.id;
                if (open) ops.setLocation(loc.id);
                emit();
              },
            },
            h('span', { class: 'spot-name', text: loc.name }),
            h('span', { class: 'spot-meta' }, open ? null : icon('lock', 'Locked'), open ? null : 'locked', open ? icon('bolt', 'Energy') : null, open ? String(loc.energyCost) : null),
          );
        }),
      ),
      locationInfo(viewLoc ?? s.location),
    ),
  );

  // tackle
  const rod = rodById(s.equipped.rod)!;
  const lure = lureById(s.equipped.lure);
  const own = s.rods[rod.id];
  const broken = rodBroken(s, rod.id);
  const repair = rodRepairPrice(s, rod.id);
  const rodSel = dropdown({
    label: 'Rod',
    value: rod.id,
    disabled: busy,
    options: Object.keys(s.rods).map((id) => {
      const r = rodById(id);
      return { value: id, label: r?.name ?? id, hint: r && r.wear > 0 ? `${s.rods[id].durability}/${r.wear}` : undefined };
    }),
    onPick: (v) => void ops.equipRod(v),
  });
  const lureSel = dropdown({
    label: 'Lure',
    value: s.equipped.lure ?? '',
    disabled: busy,
    options: [{ value: '', label: 'No lure' }, ...Object.keys(s.lures).map((id) => ({ value: id, label: lureById(id)?.name ?? id, hint: `${s.lures[id].casts} casts` }))],
    onPick: (v) => void ops.equipLure(v || null),
  });
  const t = currentTotals(s);
  const tile = (k: string, v: string, d: string, title: string): HTMLElement => h('div', { class: 'tk-big', title }, h('span', { class: 'k', text: k }), h('span', { class: 'v', text: v }), h('span', { class: 'd', text: d }));
  out.push(
    h(
      'section',
      { class: 'picker' },
      h('div', { class: 'picker-head' }, h('h3', { text: 'Tackle' }), h('a', { class: 'link', text: 'Tackle shop →', attrs: { href: '#/tackle' } })),
      h(
        'div',
        { class: 'gear' },
        h(
          'div',
          { class: `gear-slot${broken ? ' broken' : ''}` },
          h('div', { class: 'tk-well sm' }, rodSprite(rod.id, rod.name, 2)),
          h(
            'div',
            { class: 'gear-body' },
            rodSel,
            rod.wear > 0 ? segBar(own.durability, rod.wear, 8, 'dur') : null,
            h('span', { class: broken ? 'warn small' : 'muted small', text: rod.wear > 0 ? `durability ${own.durability}/${rod.wear}` : 'never wears out' }),
            repair > 0
              ? h('button', { class: 'btn btn-sm', text: `Repair · ${pearl(repair)}`, disabled: busy || s.pearl < repair, onclick: () => void ops.repairRod(rod.id) })
              : null,
          ),
        ),
        h(
          'div',
          { class: 'gear-slot' },
          h('div', { class: 'tk-well sm' }, lure ? lureSprite(lure.id, lure.name, 3) : h('span', { class: 'muted small', text: 'none' })),
          h(
            'div',
            { class: 'gear-body' },
            lureSel,
            lure ? segBar(s.lures[lure.id].casts, Math.max(lure.wear, s.lures[lure.id].casts), 8, 'dur') : null,
            h('span', { class: 'muted small', text: lure ? `${s.lures[lure.id].casts} casts left` : Object.keys(s.lures).length ? 'no lure on the line' : 'buy lures in the tackle shop' }),
          ),
        ),
      ),
      h(
        'div',
        { class: 'tk-lo-out bonus-row' },
        tile('Bite chance', `${t.biteChance}%`, t.lure.catch ? `lure ${signed(t.lure.catch)}` : 'from the lure', 'How often a fish bites. Raised by the lure’s catch.'),
        tile('Green zone', `${Math.round(greenWidth(t.zone) * 100)}%`, t.rod.catch ? `rod ${signed(t.rod.catch)}` : 'from the rod', 'Width of the safe green band on the line-tension gauge while reeling. Raised by the rod’s catch.'),
        tile('Rare odds', t.total.rarity ? `+${t.total.rarity}` : '—', 'weighting, not %', 'Relative weighting of rarer species: rod + lure + active special fish.'),
        tile('Fish weight', t.total.weight ? `+${t.total.weight}%` : '—', 'and sell price', 'Heavier fish sell for more and score higher.'),
      ),
    ),
  );

  return out;
}

export function tickPond(): void {
  // energy may have regenerated: lets the controls refresh their "not enough energy" state
  emit();
}
