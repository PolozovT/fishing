/** The pond: scene, cast → bite → hook → reel flow, and the controls under it. */
import {
  GameError,
  castBlocker,
  currentTotals,
  energyNow,
  equipLure,
  equipRod,
  hookFish,
  landFish,
  landPrize,
  recordEscape,
  repairRod,
  rodBroken,
  rodRepairPrice,
  rollBite,
  sellFish,
  setLocation,
  startCast,
  isValuable,
  type CastTicket,
  type Hooked,
  type Landing,
} from '../../game/actions';
import { BLEND_PRIZE, LOCATIONS, SPECIES, special } from '../../game/content';
import { START_DIST, accuracy, bandOf, greenWidth, qualityOf, reelParams, reelStart, reelStep, type ReelParams, type ReelState } from '../../game/minigame';
import { canEnter, isUnlocked, unlockText } from '../../game/progress';
import { RARITY_CLASS } from '../../i18n';
import { WaterScene } from '../../scene';
import { emit } from '../../store';
import { lureById, rodById } from '../../tackle/catalog';
import { lureSprite, rodSprite } from '../../tackle/sprites';
import { fmtWeight, h, icon, mount, segBar, sigOf } from '../../ui/dom';
import { dropdown } from '../../ui/dropdown';
import { toast } from '../../ui/toast';
import { fishArt } from '../fishSprite';
import { act, apply, commit, getSave, rev } from '../state';
import { pearl, qualityTag, rarityTag } from './fmt';

type Phase = 'idle' | 'casting' | 'waiting' | 'bite' | 'reeling' | 'result';

let scene: WaterScene;
let statusEl: HTMLElement;
let overlayEl: HTMLElement;
let hookBtn: HTMLButtonElement;
let reelEl: HTMLElement;
let phase: Phase = 'idle';
let ticket: CastTicket | null = null;
let hooked: Hooked | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
/** Location whose details are shown under the picker (may be a locked one). */
let viewLoc: number | null = null;

const HOOK_WINDOW_MS = 1700;

export function initPond(sceneHost: HTMLElement, controlsHost: HTMLElement): () => void {
  const canvas = h('canvas', { class: 'water', attrs: { 'aria-label': 'Water' } });
  statusEl = h('div', { class: 'scene-status' });
  overlayEl = h('div', { class: 'scene-overlay hidden' });
  hookBtn = h('button', { class: 'btn btn-reel hidden', text: 'Hook!', onclick: () => doHook() });
  reelEl = h('div', { class: 'reel hidden' });
  sceneHost.append(canvas, statusEl, hookBtn, reelEl, overlayEl);
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

  const renderControls = mount(controlsHost, () => sigOf(rev(), phase, viewLoc, energyNow(getSave(), Date.now())), renderControlsView);
  return () => {
    renderControls();
    scene.setPalette(LOCATIONS[ticket?.locationId ?? getSave().location].palette);
    statusEl.textContent = statusText();
  };
}

export const pondBusy = (): boolean => phase !== 'idle' && phase !== 'result';

function setPhase(p: Phase): void {
  phase = p;
  hookBtn.classList.toggle('hidden', p !== 'bite');
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
    case 'reeling':
      return 'Fish on! Reel it in';
    default:
      return 'Ready to cast';
  }
}

// ------------------------------------------------------------------ cast → bite → hook

function doCast(): void {
  if (pondBusy()) return;
  hideOverlay();
  const r = act(
    (s) => startCast(s, Date.now()),
    (x) => x.save,
  );
  if (!r) return;
  ticket = r.ticket;
  scene.setPalette(LOCATIONS[ticket.locationId].palette);
  scene.setPhase('casting');
  setPhase('casting');
  timer = setTimeout(() => {
    scene.setPhase('waiting');
    setPhase('waiting');
    // a lure with catch makes fish find it sooner
    const quick = 1 - Math.min(0.4, Math.max(0, r.ticket.totals.lure.catch) * 0.03);
    timer = setTimeout(onWaitOver, (2200 + Math.random() * 4500) * quick);
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
  scene.setPhase('bite');
  setPhase('bite');
  timer = setTimeout(() => {
    if (phase !== 'bite') return;
    commit(recordEscape(getSave()));
    scene.setPhase('missed');
    finish();
    showMessage('Too slow!', 'The fish spat the hook. Hit "Hook!" as soon as the float dips.');
  }, HOOK_WINDOW_MS);
}

function doHook(): void {
  if (phase !== 'bite' || !ticket || !hooked) return;
  clearTimeout(timer);
  scene.setPhase('reeling');
  setPhase('reeling');
  startReel(reelParams(hookedRarity(hooked), ticket.totals.zone));
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
let holdBtn: HTMLButtonElement;

const hookedRarity = (hk: Hooked) => (hk.prize ? BLEND_PRIZE.fightRarity : SPECIES[hk.speciesId].rarity);

const PULL = ['A light tug', 'A steady pull', 'A strong fish', 'A heavy fish!', 'A monster!', 'Something unreal…'];

function startReel(p: ReelParams): void {
  reelP = p;
  reel = reelStart(Math.random);
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
  fishEl = h('div', { class: 'haul-fish' }, icon('fish'));
  holdBtn = h('button', { class: 'btn btn-primary reel-hold', text: 'Hold to reel' });
  const down = (e: Event): void => {
    e.preventDefault();
    holding = true;
  };
  holdBtn.addEventListener('pointerdown', down);
  holdBtn.addEventListener('contextmenu', (e) => e.preventDefault());
  reelEl.replaceChildren(
    promptEl,
    h('div', { class: 'reel-label' }, h('span', { text: 'Line tension' }), h('span', { class: 'muted', text: hooked!.prize ? 'Something odd on the line…' : PULL[hookedRarity(hooked!)] })),
    gaugeEl,
    h('div', { class: 'haul', attrs: { 'aria-hidden': 'true' } }, h('span', { class: 'haul-you', text: 'You' }), h('div', { class: 'haul-line' }, fishEl)),
    holdBtn,
  );
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
  if (r.pulling) return band === 'slack' ? { text: 'The fish is pulling: reel gently', cls: 'warn' } : { text: 'The fish is pulling: let go', cls: 'warn' };
  if (band === 'slack') return { text: 'Hold to reel in', cls: '' };
  return { text: 'Good! Keep the needle in the green', cls: 'good' };
}

function paintReel(): void {
  if (!reel || !reelP) return;
  needleEl.style.left = `${reel.tension * 100}%`;
  fishEl.style.left = `${Math.min(1, reel.dist / START_DIST) * 100}%`;
  const pr = promptFor(reel, reelP);
  if (promptEl.textContent !== pr.text) promptEl.textContent = pr.text;
  promptEl.className = `reel-prompt ${pr.cls}`;
  gaugeEl.classList.toggle('pulling', reel.pulling);
  fishEl.classList.toggle('pulling', reel.pulling);
  holdBtn.classList.toggle('down', holding);
}

function endReel(r: ReelState): void {
  const t = ticket;
  const hk = hooked;
  if (!t || !hk) return finish();
  if (r.result === 'escaped') {
    commit(recordEscape(getSave()));
    scene.setPhase('missed');
    finish();
    showMessage(r.lost === 'snapped' ? 'The line snapped!' : 'It got away!', r.lost === 'snapped' ? 'Too much tension. Let go when the needle enters the red or the fish pulls.' : 'The line was slack for too long. Hold to reel and keep the needle in the green.');
    return;
  }
  if (hk.prize) {
    const amount = hk.prize;
    const ok = apply((s) => landPrize(s, hk));
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
  scene.setPhase('caught');
  finish();
  phase = 'result';
  showCatch(landing);
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

let overlayTimer: ReturnType<typeof setTimeout> | undefined;
function showMessage(title: string, text: string): void {
  clearTimeout(overlayTimer);
  overlayEl.replaceChildren(h('div', { class: 'reveal reveal-miss' }, h('div', { class: 'reveal-title', text: title }), h('p', { text })));
  overlayEl.classList.remove('hidden');
  overlayTimer = setTimeout(hideOverlay, 2600);
}

/** A sealed bottle, drawn in pixels. */
function bottleArt(): HTMLElement {
  const rows = ['....cc....', '....cc....', '...gggg...', '...gLLg...', '..gLLLLg..', '..gLppLg..', '..gLppLg..', '..gLppLg..', '..gLLLLg..', '..gggggg..'];
  const pal: Record<string, string> = { c: '#b8a071', g: '#3f7f5a', L: '#9ef0b5', p: '#f4f1e8' };
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 10 10');
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.setAttribute('class', 'pxi fish-sprite');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Sealed bottle');
  rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (!pal[ch]) return;
      const r = document.createElementNS(ns, 'rect');
      r.setAttribute('x', String(x));
      r.setAttribute('y', String(y));
      r.setAttribute('width', '1');
      r.setAttribute('height', '1');
      r.setAttribute('fill', pal[ch]);
      svg.append(r);
    }),
  );
  const el = h('div', { class: 'nft-img fish-art reveal-img bottle-art' });
  el.append(svg);
  return el;
}

function showPrize(amount: number): void {
  clearTimeout(overlayTimer);
  overlayEl.replaceChildren(
    h(
      'div',
      { class: 'reveal reveal-catch r4 reveal-prize' },
      h('div', { class: 'reveal-title', text: 'Jackpot!' }),
      bottleArt(),
      h('div', { class: 'reveal-name', text: 'A sealed bottle' }),
      h('div', { class: 'reveal-stats' }, h('span', { class: 'blend', text: `+${amount} BLEND` })),
      h('div', { class: 'muted small', text: 'Not a fish at all: there are tokens inside. Preview: the balance is local and nothing is paid out yet.' }),
      h('div', { class: 'reveal-actions' }, h('button', { class: 'btn btn-primary', text: 'Nice!', onclick: hideOverlay })),
    ),
  );
  overlayEl.classList.remove('hidden');
}

function showCatch(l: Landing): void {
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
      notes,
      h(
        'div',
        { class: 'reveal-actions' },
        h('button', { class: 'btn btn-primary', text: 'Keep', onclick: hideOverlay }),
        canQuickSell
          ? h('button', {
              class: 'btn',
              text: `Sell · ${pearl(f.sellPrice)}`,
              onclick: () => {
                act(
                  (s) => sellFish(s, [f.id]),
                  (x) => x.save,
                );
                hideOverlay();
              },
            })
          : null,
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

  const reason = castBlocker(s, now);
  const cost = LOCATIONS[s.location].energyCost;
  out.push(
    h(
      'div',
      { class: 'cast-row' },
      h('button', { class: 'btn btn-cast', disabled: busy || !!reason, onclick: doCast }, busy ? 'In the water…' : 'Cast'),
      h(
        'div',
        { class: 'cast-info' },
        h('div', { class: reason && !busy ? 'warn' : 'muted', text: busy ? 'Press Hook! when the float dips, then hold to reel (Space works too)' : reason ?? `Costs ${cost} energy · you have ${energyNow(s, now)}` }),
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
                if (open) apply((x) => setLocation(x, loc.id));
                else emit();
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
    onPick: (v) => void apply((x) => equipRod(x, v)),
  });
  const lureSel = dropdown({
    label: 'Lure',
    value: s.equipped.lure ?? '',
    disabled: busy,
    options: [{ value: '', label: 'No lure' }, ...Object.keys(s.lures).map((id) => ({ value: id, label: lureById(id)?.name ?? id, hint: `${s.lures[id].casts} casts` }))],
    onPick: (v) => void apply((x) => equipLure(x, v || null)),
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
              ? h('button', { class: 'btn btn-sm', text: `Repair · ${pearl(repair)}`, disabled: busy || s.pearl < repair, onclick: () => void apply((x) => repairRod(x, rod.id)) })
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
