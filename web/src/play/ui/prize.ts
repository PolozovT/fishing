/**
 * The bottle reveal: what the player sees when the thing on the hook turns out to be a sealed bottle of BLEND.
 * A full-screen pixel scene on one canvas (the bottle comes up dripping, shakes, the cork flies off, the coins
 * fountain out) with the title, the running amount and the button as ordinary DOM on top, so the text stays
 * sharp and readable by a screen reader. A click or a key skips to the end; reduced motion starts at the end.
 */
import { h } from '../../ui/dom';

// ------------------------------------------------------------------ timeline, seconds

const T_SHAKE = 0.75; // the bottle is up and starts to shake
const T_POP = 1.95; // the cork flies off
const T_COUNT = 2.25; // the amount starts running
const T_SETTLE = 4.35; // the fountain is spent: title, final amount, button
/** Coins the fountain throws, however large the prize is. */
const FOUNTAIN_COINS = 90;

// ------------------------------------------------------------------ art

/** 16 × 25. c/C cork, g/G glass, L glass body, w glint, y/Y/o coins. */
const BOTTLE = [
  '......cccc......',
  '......cCCc......',
  '......cccc......',
  '.....gggggg.....',
  '......gLLg......',
  '......gLLg......',
  '......gLLg......',
  '.....gGLLGg.....',
  '....gGLLLLGg....',
  '...gGLLLLLLGg...',
  '..gGLwLLLLLLGg..',
  '..gLwLLLLLLLLg..',
  '..gLwLLLLLLLLg..',
  '..gLwLLLyLLLLg..',
  '..gLLLLyYyLLLg..',
  '..gLLyLLyLLyLg..',
  '..gLyYyLLLyYyg..',
  '..gLLyLyoLLyLg..',
  '..gLyyyYYyyyLg..',
  '..gLyYyoyyYyyg..',
  '..gyyyyYyyoyyg..',
  '..gyYyoyyyYyyg..',
  '..gGyyyyyyyyGg..',
  '...gGGGGGGGGg...',
  '....gggggggg....',
];
const CORK_ROWS = 3;
/** Rows of the bottle that hold coins; the pile sinks from the first to the last as the fountain runs. */
const COIN_TOP = 13;
const COIN_BOTTOM = 19;
const PAL: Record<string, string> = {
  c: '#b8a071',
  C: '#d9c493',
  g: '#1f5a43',
  G: '#3f8f63',
  L: '#8fe6ad',
  w: '#f2fff6',
  y: '#f2c94c',
  Y: '#fff0a8',
  o: '#b47a1e',
};
/** One coin turning: face, three-quarter, edge, three-quarter. */
const COIN = [
  ['.yyy.', 'yYYYy', 'yYoYy', 'yYYYy', '.yyy.'],
  ['.yy.', 'yYYy', 'yYoy', 'yYYy', '.yy.'],
  ['y', 'Y', 'o', 'Y', 'y'],
  ['.yy.', 'yYYy', 'yoYy', 'yYYy', '.yy.'],
];
const CONFETTI = ['#7fdcd8', '#e98397', '#ab8ad0', '#86b872', '#6fa3d8', '#fff0a8', '#f2fff6', '#f08a4b'];
const RAY_A = [255, 205, 80];
const RAY_B = [136, 92, 235];
const FIREWORKS = ['#ff7fa1', '#6fe0d8', '#b99cff', '#ffd95a', '#86e07a', '#ff9f5a'];
/** The heap of coins that grows under the bottle: rows from the bottom up, each a little narrower. */
const HEAP_ROWS = [13, 10, 7, 4];
const HEAP: { dx: number; dy: number; frame: number }[] = (() => {
  const out: { dx: number; dy: number; frame: number }[] = [];
  let seed = 7;
  const rnd = (): number => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  HEAP_ROWS.forEach((n, row) => {
    for (let i = 0; i < n; i++) out.push({ dx: (i - (n - 1) / 2) * 5 + Math.round((rnd() - 0.5) * 2), dy: -row * 4 + Math.round(rnd() * 1), frame: rnd() < 0.75 ? 0 : 1 });
  });
  // filled from the middle outwards and from the bottom up, the way a heap grows
  return out.sort((a, b) => Math.abs(a.dx) - a.dy * 3 - (Math.abs(b.dx) - b.dy * 3));
})();

type Kind = 'coin' | 'confetti' | 'drop' | 'spark' | 'cork' | 'fire';
interface Bit {
  kind: Kind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** seconds lived */
  age: number;
  /** seconds to live */
  ttl: number;
  /** art pixels per sprite pixel (coins in front are drawn larger) */
  size: number;
  /** spin phase and speed for coins, flutter for confetti */
  ph: number;
  spin: number;
  c: string;
}

export interface PrizeOptions {
  /** One line under the amount: where the tokens went. */
  note: string;
  onClose: () => void;
}

/**
 * Plays the reveal inside `host` (the scene overlay) and returns a function that stops it. `onClose` runs when the
 * player presses the button; the caller hides the overlay there.
 */
export function showPrizeReveal(host: HTMLElement, amount: number, opts: PrizeOptions): () => void {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const canvas = h('canvas', { class: 'prize-canvas', attrs: { 'aria-hidden': 'true' } });
  const title = h(
    'div',
    { class: 'prize-title', attrs: { 'aria-hidden': 'true' } },
    [...'JACKPOT!'].map((ch, i) => h('span', { text: ch, style: `--i:${i}` })),
  );
  const teaser = h('div', { class: 'prize-teaser', text: 'That is no fish…' });
  const slot = h('div', { class: 'prize-slot' });
  const sum = h('span', { class: 'prize-sum', text: '+0' });
  const amountEl = h('div', { class: 'prize-amount' }, sum, h('span', { class: 'prize-unit', text: 'BLEND' }));
  const name = h('div', { class: 'prize-name', text: 'A sealed bottle' });
  const note = h('div', { class: 'prize-note', text: opts.note });
  const button = h('button', { class: 'btn btn-primary prize-btn', text: 'Nice!' });
  const live = h('div', { class: 'sr-only', attrs: { role: 'status' } });
  const head = h('div', { class: 'prize-head' }, teaser, title);
  const stage = h('div', { class: 'prize-stage', attrs: { role: 'dialog', 'aria-label': 'A sealed bottle' } }, canvas, h('div', { class: 'prize-hud' }, head, slot, amountEl, name, note, button), live);
  host.replaceChildren(stage);
  host.classList.remove('hidden');

  const ctx = canvas.getContext('2d')!;
  /** CSS pixels per art pixel, and the canvas size in art pixels. */
  let k = 4;
  let W = 0;
  let H = 0;
  let rays: ImageData | null = null;
  const fit = (): void => {
    const r = stage.getBoundingClientRect();
    k = Math.max(2, Math.round(r.height / 190));
    W = Math.max(40, Math.ceil(r.width / k));
    H = Math.max(40, Math.ceil(r.height / k));
    canvas.width = W;
    canvas.height = H;
    canvas.style.width = `${W * k}px`;
    canvas.style.height = `${H * k}px`;
    rays = ctx.createImageData(W, H);
    if (reduced && settled) draw(performance.now());
  };

  const bits: Bit[] = [];
  const rings: { at: number; c: string }[] = [];
  let started = performance.now();
  let last = started;
  let popped = false;
  let settled = false;
  let thrown = 0;
  let shown = -1;
  let frame = 0;
  let stopped = false;

  const rect = (x: number, y: number, w: number, hh: number, c: string): void => {
    ctx.fillStyle = c;
    ctx.fillRect(Math.round(x), Math.round(y), w, hh);
  };
  /** `as` may repaint a pixel (return another palette key) or drop it (return null). */
  const sprite = (rows: string[], x: number, y: number, size: number, as?: (ch: string, row: number) => string | null): void => {
    x = Math.round(x);
    y = Math.round(y);
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      for (let c = 0; c < row.length; c++) {
        const ch = row[c] === '.' ? null : as ? as(row[c], r) : row[c];
        if (!ch) continue;
        ctx.fillStyle = PAL[ch];
        ctx.fillRect(x + c * size, y + r * size, size, size);
      }
    }
  };

  /** Where the bottle stands: the centre of the empty slot the HUD leaves for it, in art pixels. */
  const place = (): { cx: number; cy: number; size: number } => {
    const s = slot.getBoundingClientRect();
    const st = stage.getBoundingClientRect();
    const size = Math.max(1, Math.floor((s.height * 0.74) / (BOTTLE.length * k)));
    return { cx: (s.left - st.left + s.width / 2) / k, cy: (s.top - st.top + s.height / 2) / k, size };
  };

  const coin = (x: number, y: number, vx: number, vy: number, size: number, ttl = 4): void => {
    bits.push({ kind: 'coin', x, y, vx, vy, age: 0, ttl, size, ph: Math.random() * 4, spin: 9 + Math.random() * 9, c: '' });
  };
  const confetti = (x: number, y: number, power: number): void => {
    const a = Math.random() * Math.PI * 2;
    const sp = (30 + Math.random() * 120) * power;
    bits.push({ kind: 'confetti', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60 * power, age: 0, ttl: 2.2 + Math.random() * 1.6, size: Math.random() < 0.3 ? 2 : 1, ph: Math.random() * 6, spin: 4 + Math.random() * 6, c: CONFETTI[Math.floor(Math.random() * CONFETTI.length)] });
  };
  const spark = (x: number, y: number): void => {
    bits.push({ kind: 'spark', x, y, vx: 0, vy: -6, age: 0, ttl: 0.5 + Math.random() * 0.5, size: 1, ph: 0, spin: 0, c: Math.random() < 0.5 ? '#f2fff6' : '#fff0a8' });
  };

  /** A firework: one colour, thrown out in a ring. */
  const firework = (x: number, y: number): void => {
    const c = FIREWORKS[Math.floor(Math.random() * FIREWORKS.length)];
    const n = 22;
    const sp = 55 + Math.random() * 35;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const v = sp * (i % 2 ? 1 : 0.62);
      bits.push({ kind: 'fire', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, age: 0, ttl: 0.75 + Math.random() * 0.25, size: 1, ph: 0, spin: 0, c });
    }
  };
  let nextFirework = 0;

  /** The moment the cork leaves: flash, shake, rings, the first burst. */
  const pop = (p: { cx: number; cy: number; size: number }, quiet: boolean): void => {
    popped = true;
    const top = p.cy - (BOTTLE.length * p.size) / 2;
    bits.push({ kind: 'cork', x: p.cx - 2 * p.size, y: top, vx: 26, vy: -170, age: 0, ttl: 3, size: p.size, ph: 0, spin: 7, c: '' });
    if (quiet) return;
    for (let i = 0; i < 70; i++) confetti(p.cx, top, 1);
    rings.push({ at: 0, c: '#f2fff6' }, { at: -0.12, c: '#f2c94c' }, { at: -0.26, c: '#e98397' });
    stage.classList.add('prize-pop');
  };

  const settle = (): void => {
    if (settled) return;
    settled = true;
    stage.classList.add('prize-done');
    sum.textContent = `+${amount.toLocaleString('en-US')}`;
    shown = amount;
    live.textContent = `Jackpot! A sealed bottle: ${amount.toLocaleString('en-US')} BLEND. ${opts.note}`;
    button.focus({ preventScroll: true });
  };

  /** Jumps to the end of the timeline: everything out of the bottle, the button on screen. */
  const skip = (): void => {
    if (settled) return;
    const p = place();
    const top = p.cy - (BOTTLE.length * p.size) / 2;
    if (!popped) pop(p, true);
    started = performance.now() - T_SETTLE * 1000;
    if (!reduced) {
      // what was still to come, all at once
      for (let i = 0; i < 50; i++) confetti(p.cx, top, 1.1);
      for (let i = thrown; i < FOUNTAIN_COINS; i += 3) coin(p.cx - 2, top, (Math.random() - 0.5) * 170, -(140 + Math.random() * 160), Math.random() < 0.22 ? 2 : 1);
    } else {
      bits.length = 0;
    }
    thrown = FOUNTAIN_COINS;
    stage.classList.add('prize-pop', 'prize-counting');
    settle();
  };

  const draw = (now: number): void => {
    if (stopped) return;
    if (!canvas.isConnected) return stop();
    if (!reduced) frame = requestAnimationFrame(draw);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const t = (now - started) / 1000;
    const p = place();
    const bw = BOTTLE[0].length * p.size;
    const bh = BOTTLE.length * p.size;
    ctx.clearRect(0, 0, W, H);

    // the bottle comes up from below the screen, overshoots a little and hangs
    const rise = Math.min(1, t / T_SHAKE);
    const eased = 1 - (1 - rise) ** 3;
    const hang = rise < 1 ? 0 : Math.round(Math.sin((t - T_SHAKE) * 2.2) * 1.5);
    const by = p.cy - bh / 2 + (1 - eased) * (H - p.cy + bh) + hang;
    // shaking harder and harder until the cork goes
    const shakeK = t > T_SHAKE && t < T_POP ? ((t - T_SHAKE) / (T_POP - T_SHAKE)) ** 2 : 0;
    const bx = p.cx - bw / 2 + Math.round(Math.sin(t * 46) * shakeK * 3.2 * p.size);
    const neckX = p.cx;
    const neckY = by + CORK_ROWS * p.size;

    // rays behind the bottle: faint while it shakes, full once it is open
    const glow = popped ? Math.min(1, (t - T_POP) / 0.35) : Math.max(0, shakeK - 0.25) * 0.55;
    if (glow > 0 && rays) paintRays(rays, W, H, p.cx, p.cy, t, glow);
    else if (rays) rays.data.fill(0);
    if (rays) ctx.putImageData(rays, 0, 0);

    // shock rings from the pop
    if (popped) {
      for (const r of rings) {
        const age = t - T_POP + r.at;
        if (age <= 0 || age > 0.9) continue;
        ring(p.cx, neckY, age * 150, r.c, age > 0.6 ? 0.5 : 1);
      }
    }

    if (!popped && t >= T_POP) pop(p, false);
    if (!popped && t > T_SHAKE && Math.random() < 0.25 + shakeK * 0.6) spark(bx + Math.random() * bw, by + Math.random() * bh);
    // water running off the bottle as it comes up
    if (t < T_SHAKE + 0.5 && Math.random() < 0.7) bits.push({ kind: 'drop', x: bx + 3 * p.size + Math.random() * (bw - 6 * p.size), y: by + bh, vx: 0, vy: 30, age: 0, ttl: 1.2, size: 1, ph: 0, spin: 0, c: Math.random() < 0.5 ? '#8ea6ae' : '#c3d3d8' });

    // the fountain: most of the coins in the first second, the rest trailing off
    if (popped && thrown < FOUNTAIN_COINS) {
      const k2 = Math.min(1, (t - T_POP) / (T_SETTLE - T_POP - 0.5));
      const due = Math.floor(FOUNTAIN_COINS * (1 - (1 - k2) ** 2.2));
      while (thrown < due) {
        thrown++;
        const front = Math.random() < 0.22;
        coin(neckX - 2 + (Math.random() - 0.5) * 3 * p.size, neckY, (Math.random() - 0.5) * (front ? 190 : 120), -(150 + Math.random() * 150), front ? 2 : 1);
        if (Math.random() < 0.5) confetti(neckX, neckY, 0.7);
      }
    }
    // afterwards a slow rain of coins and the odd twinkle, for as long as the card is up
    // fireworks around the bottle from the pop on: often at first, now and then afterwards
    if (popped && !reduced && t >= nextFirework) {
      nextFirework = t + (settled ? 0.9 + Math.random() * 1.4 : 0.22 + Math.random() * 0.25);
      const side = Math.random() < 0.5 ? -1 : 1;
      firework(p.cx + side * (bw * 0.9 + Math.random() * W * 0.3), p.cy - bh * 0.2 + (Math.random() - 0.6) * H * 0.45);
    }
    if (settled && !reduced) {
      if (Math.random() < 0.06) coin(Math.random() * W, -6, (Math.random() - 0.5) * 16, 40 + Math.random() * 40, Math.random() < 0.3 ? 2 : 1, 8);
      if (Math.random() < 0.2) spark(Math.random() * W, Math.random() * H * 0.8);
    }

    // coins that fly behind the bottle are drawn first, the big ones in front of it last
    step(dt);
    paintBits(false);
    const sunk = popped ? Math.min(1, thrown / FOUNTAIN_COINS) : 0;
    const coinFrom = COIN_TOP + Math.floor(sunk * (COIN_BOTTOM - COIN_TOP));
    // no cork once it has flown; rows the pile has left show glass again
    sprite(BOTTLE, bx, by, p.size, (ch, row) => (row < CORK_ROWS ? (popped ? null : ch) : row < coinFrom && (ch === 'y' || ch === 'Y' || ch === 'o') ? 'L' : ch));
    // the heap under the bottle: a coin for every two the fountain has thrown, a moment after they went up
    const heaped = popped ? Math.min(HEAP.length, Math.floor(Math.max(0, thrown - 8) / 2 * (HEAP.length / ((FOUNTAIN_COINS - 8) / 2)))) : 0;
    for (let i = 0; i < heaped; i++) {
      const c = HEAP[i];
      const rows = COIN[c.frame];
      sprite(rows, p.cx + c.dx - 2, p.cy + bh / 2 - 2 + c.dy, 1);
    }
    paintBits(true);

    // the white flash of the pop, two frames long
    const sincePop = t - T_POP;
    if (popped && sincePop >= 0 && sincePop < 0.16 && !settled) {
      ctx.globalAlpha = sincePop < 0.07 ? 0.85 : 0.35;
      rect(0, 0, W, H, '#fff7d6');
      ctx.globalAlpha = 1;
    }

    // the amount runs up while the coins fly, and lands exactly on the prize
    if (!settled && t >= T_COUNT) {
      const k3 = Math.min(1, (t - T_COUNT) / (T_SETTLE - T_COUNT));
      const v = Math.round(amount * (1 - (1 - k3) ** 2));
      if (v !== shown) {
        shown = v;
        sum.textContent = `+${v.toLocaleString('en-US')}`;
      }
      if (!stage.classList.contains('prize-counting')) stage.classList.add('prize-counting');
    }
    if (!settled && t >= T_SETTLE) settle();
  };

  const step = (dt: number): void => {
    for (const b of bits) {
      b.age += dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.kind === 'coin' || b.kind === 'cork') b.vy += 300 * dt;
      else if (b.kind === 'drop') b.vy += 240 * dt;
      else if (b.kind === 'fire') {
        b.vx *= 1 - 3.2 * dt;
        b.vy = b.vy * (1 - 3.2 * dt) + 26 * dt;
      } else if (b.kind === 'confetti') {
        // paper: slows down fast, then drifts down, swaying
        b.vx *= 1 - 2.4 * dt;
        b.vy = b.vy * (1 - 2.4 * dt) + 70 * dt;
        b.x += Math.sin(b.age * b.spin + b.ph) * 14 * dt;
      }
    }
    for (let i = bits.length - 1; i >= 0; i--) {
      const b = bits[i];
      if (b.age > b.ttl || b.y > H + 12 || b.x < -12 || b.x > W + 12) bits.splice(i, 1);
    }
  };

  const paintBits = (front: boolean): void => {
    for (const b of bits) {
      if ((b.size > 1 && b.kind === 'coin') !== front) continue;
      if (b.kind === 'coin') {
        const f = Math.floor(b.ph + b.age * b.spin) % 4;
        const rows = COIN[f];
        sprite(rows, b.x + ((5 - rows[0].length) * b.size) / 2, b.y, b.size);
      } else if (b.kind === 'cork') {
        const tilt = Math.floor(b.age * b.spin) % 2;
        rect(b.x, b.y, (tilt ? 3 : 4) * b.size, (tilt ? 4 : 3) * b.size, PAL.c);
        rect(b.x + b.size, b.y + b.size, b.size, b.size, PAL.C);
      } else if (b.kind === 'confetti') {
        // a flake shows its face and its edge in turn
        const flat = Math.sin(b.age * b.spin * 2 + b.ph) > 0;
        ctx.globalAlpha = b.ttl - b.age < 0.4 ? 0.5 : 1;
        rect(b.x, b.y, flat ? b.size * 2 : b.size, b.size, b.c);
        ctx.globalAlpha = 1;
      } else if (b.kind === 'drop') {
        rect(b.x, b.y, 1, 2, b.c);
      } else if (b.kind === 'fire') {
        // bright and fat at first, a blinking dot at the end
        const k5 = b.age / b.ttl;
        if (k5 > 0.7 && Math.floor(b.age * 30) % 2) continue;
        const sz = k5 < 0.35 ? 2 : 1;
        rect(b.x, b.y, sz, sz, k5 < 0.12 ? '#f2fff6' : b.c);
      } else {
        // a four-point twinkle: a dot, then a cross, then a dot
        const k4 = b.age / b.ttl;
        rect(b.x, b.y, 1, 1, b.c);
        if (k4 > 0.25 && k4 < 0.75) {
          rect(b.x - 1, b.y, 3, 1, b.c);
          rect(b.x, b.y - 1, 1, 3, b.c);
        }
      }
    }
  };

  /** A one-pixel circle outline (midpoint algorithm), for the shock rings. */
  const ring = (cx: number, cy: number, r: number, c: string, alpha: number): void => {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = c;
    let x = Math.round(r);
    let y = 0;
    let err = 1 - x;
    const X = Math.round(cx);
    const Y = Math.round(cy);
    while (x >= y) {
      for (const [dx, dy] of [[x, y], [y, x], [-x, y], [-y, x], [x, -y], [y, -x], [-x, -y], [-y, -x]]) ctx.fillRect(X + dx, Y + dy, 1, 1);
      y++;
      if (err < 0) err += 2 * y + 1;
      else {
        x--;
        err += 2 * (y - x) + 1;
      }
    }
    ctx.globalAlpha = 1;
  };

  const onKey = (e: KeyboardEvent): void => {
    if (e.code !== 'Space' && e.code !== 'Enter' && e.code !== 'Escape') return;
    if (!settled) {
      e.preventDefault();
      e.stopPropagation();
      skip();
    } else if (e.code === 'Escape') {
      e.preventDefault();
      close();
    }
  };
  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(frame);
    watcher.disconnect();
    window.removeEventListener('keydown', onKey, true);
  };
  const close = (): void => {
    stop();
    opts.onClose();
  };
  stage.addEventListener('pointerdown', (e) => {
    if (!settled && e.target !== button) skip();
  });
  button.addEventListener('click', close);
  window.addEventListener('keydown', onKey, true);

  const watcher = new ResizeObserver(fit);
  watcher.observe(stage);
  fit();
  if (reduced) skip();
  draw(performance.now());
  return stop;
}

/**
 * A turning fan of twelve rays in two golds, written straight into the pixel buffer so every art pixel is one flat
 * colour. Brightness falls off in three rings instead of a smooth fade: this is pixel art, not a gradient.
 */
function paintRays(img: ImageData, W: number, H: number, cx: number, cy: number, t: number, strength: number): void {
  const d = img.data;
  const rot = t * 0.55;
  const reach = Math.hypot(W, H) * 0.62;
  const wedge = Math.PI / 6;
  for (let y = 0; y < H; y++) {
    const dy = y - cy;
    for (let x = 0; x < W; x++) {
      const dx = x - cx;
      const i = (y * W + x) * 4;
      const dist = Math.hypot(dx, dy);
      if (dist > reach) {
        d[i + 3] = 0;
        continue;
      }
      const a = Math.atan2(dy, dx) + rot;
      const band = Math.floor(a / wedge) & 1;
      const fall = dist < reach * 0.3 ? 1 : dist < reach * 0.6 ? 0.66 : 0.36;
      // a checker dither on the ring borders softens the steps without leaving the palette
      const edge = Math.abs(dist - reach * 0.3) < 1.5 || Math.abs(dist - reach * 0.6) < 1.5 ? ((x + y) & 1 ? 0.85 : 1) : 1;
      const c = band ? RAY_A : RAY_B;
      d[i] = c[0];
      d[i + 1] = c[1];
      d[i + 2] = c[2];
      d[i + 3] = Math.round(255 * strength * fall * edge * (band ? 0.5 : 0.3));
    }
  }
}
