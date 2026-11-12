// Pixel-art night pond: pier, angler, rod, line, bobber, ripples, splash. Pure presentation — driven by setPhase().
//
// Everything is drawn procedurally into a low-resolution offscreen canvas (~170 logical px tall) and then
// blitted to the display canvas with an integer scale factor and image smoothing disabled, so every
// "pixel" is a crisp square. Static layers (dithered sky + water, moon, hills, pine forests) are cached
// and only rebuilt when the size or spot palette changes.

export type Phase = 'idle' | 'casting' | 'waiting' | 'bite' | 'reeling' | 'caught' | 'missed';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  big: boolean;
  c: string;
}
interface Ripple {
  x: number;
  y: number;
  r: number;
  life: number;
}
interface Swimmer {
  x: number;
  y: number;
  v: number;
  ph: number;
}
interface Star {
  x: number;
  y: number;
  ph: number;
  sp: number;
  big: boolean;
}
interface Dash {
  x: number;
  y: number;
  len: number;
  v: number;
  ph: number;
}
interface Fly {
  x: number;
  y: number;
  ph: number;
  sp: number;
}
interface Cloud {
  x: number;
  y: number;
  w: number;
  v: number;
}

interface Palette {
  sky: string[];
  water: string[];
  hill: string;
  forest: [string, string, string];
  mist: string;
  shimmer: [string, string];
  moon: string;
  moonShade: string;
  moonRef: [string, string];
  /** 0..1 — how dense the pine layers are */
  pines: number;
  hillAmp: number;
}

const PALETTES: Palette[] = [
  {
    // pond
    sky: ['#0d1117', '#10151c', '#131a22', '#161f28', '#1a242d', '#1f2a32'],
    water: ['#1e2d35', '#19262e', '#152028', '#111a21', '#0d151b', '#0a1015'],
    hill: '#1a2329',
    forest: ['#161e22', '#11181a', '#0b1012'],
    mist: '#2a3a40',
    shimmer: ['#4a636c', '#2f444c'],
    moon: '#e8e2c8',
    moonShade: '#bdb69c',
    moonRef: ['#cfc9ad', '#69736f'],
    pines: 1,
    hillAmp: 4,
  },
  {
    // forest river
    sky: ['#0c1113', '#0f1517', '#121a1b', '#151f1f', '#192523', '#1e2b27'],
    water: ['#1b2d2a', '#172723', '#13211e', '#101b18', '#0c1513', '#09100e'],
    hill: '#18241f',
    forest: ['#142019', '#0f1813', '#0a110d'],
    mist: '#2a3d34',
    shimmer: ['#476a5d', '#2d473e'],
    moon: '#e6e4c6',
    moonShade: '#b8b897',
    moonRef: ['#cdcca9', '#62716a'],
    pines: 1.25,
    hillAmp: 5,
  },
  {
    // deep lake
    sky: ['#0b0e18', '#0e121e', '#111724', '#141c2b', '#182233', '#1d283b'],
    water: ['#1b2740', '#172137', '#131c2f', '#0f1726', '#0c121e', '#080d16'],
    hill: '#18202f',
    forest: ['#141b28', '#10161f', '#0b0f16'],
    mist: '#26324a',
    shimmer: ['#465b80', '#2c3c5a'],
    moon: '#e4e3d4',
    moonShade: '#b4b4a6',
    moonRef: ['#c9c8bb', '#5d667a'],
    pines: 0.8,
    hillAmp: 7,
  },
  {
    // northern sea
    sky: ['#0f1214', '#13171a', '#181d21', '#1d2328', '#232a30', '#2a3238'],
    water: ['#26313a', '#202a32', '#1a232a', '#151c22', '#10161b', '#0b1014'],
    hill: '#1d2327',
    forest: ['#1a2024', '#14191c', '#0e1214'],
    mist: '#36414a',
    shimmer: ['#5a6c77', '#3a4852'],
    moon: '#e9ebe6',
    moonShade: '#b9bcb6',
    moonRef: ['#d2d5cf', '#6c767c'],
    pines: 0.3,
    hillAmp: 11,
  },
  {
    // taimen rapids
    sky: ['#110e17', '#16121e', '#1c1624', '#231a2a', '#2b1f2f', '#352534'],
    water: ['#2a2433', '#231e2c', '#1d1925', '#17141e', '#110f17', '#0c0a10'],
    hill: '#221a26',
    forest: ['#1c1620', '#151018', '#0e0b10'],
    mist: '#3c2f42',
    shimmer: ['#6a5672', '#47394f'],
    moon: '#ecdcc0',
    moonShade: '#c0ad90',
    moonRef: ['#d8c6a6', '#6e5f6c'],
    pines: 1.1,
    hillAmp: 6,
  },
];

// 4×4 ordered-dither thresholds
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);

// ---------------------------------------------------------------- sprites (rows of palette keys, '.' = empty)

const ANGLER = [
  '....HHHH....',
  '...HHHHHH...',
  '..hhhhhhhh..',
  '....SSSS....',
  '....SSES....',
  '....sSSS....',
  '...CCCCC....',
  '..CCCCCCC...',
  '..CcCCCCSS..',
  '..CcCCCC....',
  '..CcCCCC....',
  '..PPPPPPPP..',
  '..PPPPPPPP..',
  '........PP..',
  '........PP..',
  '........BBB.',
];
const ANGLER_PAL: Record<string, string> = {
  H: '#3c4636',
  h: '#6b5234',
  S: '#c99c78',
  s: '#9c7458',
  E: '#15171a',
  C: '#4d5c66',
  c: '#36424b',
  P: '#3b3631',
  B: '#1e1b19',
};
const BOBBER = ['.r.', 'rRr', 'rrr', 'www', 'www', '.w.'];
const BOBBER_PAL: Record<string, string> = { r: '#c2453b', R: '#e7766a', w: '#e6e4dc' };
const FISH_SHADOW = ['x..xxx..', 'xxxxxxx.', 'xxxxxxxx', 'xxxxxxx.', 'x..xxx..'];
const FISH_SHADOW2 = ['...xxx..', 'xxxxxxx.', 'xxxxxxxx', 'xxxxxxx.', '...xxx..'];
const CATCH_FISH = ['..ggg...', 'gggggggg', 'GgggggEg', 'gggggggg', '..ggg...'];
const CATCH_PAL: Record<string, string> = { g: '#b8a071', G: '#8c7650', E: '#15171a' };
const LANTERN = ['.k.', 'kkk', 'yYy', 'yYy', 'kkk'];
const LANTERN_PAL: Record<string, string> = { k: '#2a2522', y: '#e0b35a', Y: '#f6e3a2' };

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;
const easeOut = (k: number): number => 1 - (1 - k) * (1 - k);

export class WaterScene {
  private ctx: CanvasRenderingContext2D;
  private off: HTMLCanvasElement;
  private o: CanvasRenderingContext2D;
  private bg: HTMLCanvasElement;
  private bgKey = '';
  /** logical (pixel-art) resolution */
  private W = 0;
  private H = 0;
  /** integer upscale factor (device px per art px) */
  private s = 1;
  private t0 = performance.now();
  private last = performance.now();
  private phase: Phase = 'idle';
  private phaseAt = performance.now();
  private particles: Particle[] = [];
  private ripples: Ripple[] = [];
  private swimmers: Swimmer[] = [];
  private stars: Star[] = [];
  private dashes: Dash[] = [];
  private flies: Fly[] = [];
  private clouds: Cloud[] = [];
  private palette = 0;
  private lastRipple = 0;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is not available');
    this.ctx = ctx;
    this.off = document.createElement('canvas');
    this.o = this.off.getContext('2d')!;
    this.bg = document.createElement('canvas');
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
    const loop = (now: number): void => {
      this.draw(now);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  setPalette(spotId: number): void {
    this.palette = Math.max(0, Math.min(PALETTES.length - 1, spotId));
  }

  getPhase(): Phase {
    return this.phase;
  }

  setPhase(p: Phase): void {
    if (p === this.phase) return;
    const now = performance.now();
    const b = this.bobberPos(now);
    this.phase = p;
    this.phaseAt = now;
    if (p === 'caught') this.splash(b.x, b.y, 44, 1.25);
    if (p === 'missed') this.splash(b.x, b.y, 16, 0.75);
    if (p === 'bite') this.splash(b.x, b.y, 9, 0.5);
  }

  // ---------------------------------------------------------------- sizing

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const devW = Math.max(1, Math.round(rect.width * dpr));
    const devH = Math.max(1, Math.round(rect.height * dpr));
    this.canvas.width = devW;
    this.canvas.height = devH;
    // ~150 art pixels tall, scaled by a whole number so every art pixel is the same size
    this.s = Math.max(1, Math.round(devH / 150));
    this.W = Math.max(64, Math.ceil(devW / this.s));
    this.H = Math.max(48, Math.ceil(devH / this.s));
    this.off.width = this.W;
    this.off.height = this.H;
    this.ctx.imageSmoothingEnabled = false;
    this.o.imageSmoothingEnabled = false;
    this.bgKey = '';
    this.particles = [];
    this.ripples = [];
    this.seedDynamic();
  }

  private seedDynamic(): void {
    const { W, H } = this;
    const hz = this.hz;
    const r = rng(1337 + W * 7 + H);
    this.stars = [];
    const skyTop = Math.max(4, hz - 34);
    for (let i = 0; i < Math.round(W * 0.28); i++)
      this.stars.push({ x: Math.floor(r() * W), y: Math.floor(r() * skyTop), ph: r() * 6.28, sp: 0.6 + r() * 2.2, big: r() < 0.08 });
    this.dashes = [];
    for (let i = 0; i < Math.round(W * 0.16); i++) {
      const y = hz + 2 + Math.floor(r() * (H - hz - 3));
      const k = (y - hz) / (H - hz);
      this.dashes.push({ x: r() * W, y, len: 1 + Math.round(k * 5 + r() * 2), v: (r() * 2 + 1) * (r() < 0.5 ? -1 : 1), ph: r() * 6.28 });
    }
    this.swimmers = [];
    for (let i = 0; i < 3; i++) this.swimmers.push({ x: r() * W, y: hz + 12 + r() * (H - hz - 20), v: (r() * 6 + 4) * (r() < 0.5 ? -1 : 1), ph: r() * 6 });
    this.flies = [];
    for (let i = 0; i < 7; i++) this.flies.push({ x: r() * W, y: hz - 14 + r() * 18, ph: r() * 6.28, sp: 0.4 + r() * 0.8 });
    this.clouds = [];
    for (let i = 0; i < 3; i++) this.clouds.push({ x: r() * W, y: 6 + Math.floor(r() * (hz * 0.45)), w: 18 + Math.floor(r() * 26), v: 1 + r() * 1.5 });
  }

  // ---------------------------------------------------------------- layout (art pixels)

  private get hz(): number {
    return Math.round(this.H * 0.47);
  }
  private get deckY(): number {
    return this.H - Math.round(this.H * 0.2);
  }
  private get pierEnd(): number {
    return Math.round(Math.min(this.W * 0.3, 74));
  }
  private get moon(): { x: number; y: number; r: number } {
    return { x: Math.round(this.W * 0.76), y: Math.round(this.hz * 0.3), r: Math.max(5, Math.round(this.H * 0.038)) };
  }
  private anglerPos(): { x: number; y: number } {
    // sprite column 8 (the shins) hangs just past the end of the pier
    return { x: this.pierEnd - 8, y: this.deckY - 13 };
  }
  private hand(): { x: number; y: number } {
    const a = this.anglerPos();
    return { x: a.x + 9, y: a.y + 8 };
  }
  private rodLen(): number {
    return Math.round(this.H * 0.22);
  }
  /** rod angle (radians, 0 = right, negative = up) and bend for the current phase */
  private rodPose(now: number): { a: number; bend: number } {
    const since = (now - this.phaseAt) / 1000;
    const t = (now - this.t0) / 1000;
    switch (this.phase) {
      case 'idle':
        return { a: -1.0 + Math.sin(t * 1.2) * 0.03, bend: 0 };
      case 'casting':
        if (since < 0.3) return { a: lerp(-1.0, -2.1, since / 0.3), bend: -0.05 };
        return { a: lerp(-2.1, -0.6, easeOut(Math.min(1, (since - 0.3) / 0.25))), bend: 0.05 };
      case 'waiting':
        return { a: -0.7 + Math.sin(t * 0.8) * 0.02, bend: 0.04 };
      case 'bite':
        return { a: -0.45 + Math.sin(now / 70) * 0.06, bend: 0.16 };
      case 'reeling':
        return { a: -0.95 + Math.sin(now / 60) * 0.05, bend: 0.22 };
      case 'caught':
      case 'missed':
        return { a: lerp(-0.6, -1.25, Math.min(1, since / 0.5)), bend: this.phase === 'caught' ? 0.1 : 0 };
    }
  }
  private tipAt(a: number): { x: number; y: number } {
    const h = this.hand();
    const L = this.rodLen();
    return { x: h.x + Math.cos(a) * L, y: h.y + Math.sin(a) * L };
  }
  private target(): { x: number; y: number } {
    return { x: Math.round(Math.max(this.pierEnd + 44, this.W * 0.62)), y: Math.round(this.hz + (this.H - this.hz) * 0.42) };
  }

  private bobberPos(now: number): { x: number; y: number; sink: number; inWater: boolean } {
    const tip = this.tipAt(this.rodPose(now).a);
    const tg = this.target();
    const since = (now - this.phaseAt) / 1000;
    const t = (now - this.t0) / 1000;
    switch (this.phase) {
      case 'idle':
        return { x: tip.x + Math.sin(t * 1.4) * 1.2, y: tip.y + 12, sink: 0, inWater: false };
      case 'casting': {
        if (since < 0.32) return { x: tip.x, y: tip.y + 8, sink: 0, inWater: false };
        const k = Math.min(1, (since - 0.32) / 0.75);
        const s0 = this.tipAt(-1.6);
        const x = lerp(s0.x, tg.x, k);
        const y = lerp(s0.y + 6, tg.y, k) - Math.sin(k * Math.PI) * this.H * 0.28;
        return { x, y, sink: 0, inWater: k >= 1 };
      }
      case 'waiting':
        return { x: tg.x + Math.round(Math.sin(now / 1300)), y: tg.y + (Math.sin(now / 420) > 0.3 ? 1 : 0), sink: 1, inWater: true };
      case 'bite':
        return { x: tg.x + Math.round(Math.sin(now / 70)), y: tg.y + 1 + Math.round(Math.abs(Math.sin(now / 160)) * 2), sink: 3, inWater: true };
      case 'reeling': {
        const k = Math.min(1, since / 2.5);
        return { x: tg.x + (tip.x + 14 - tg.x) * k * 0.5 + Math.sin(now / 50), y: tg.y + 1, sink: 2, inWater: true };
      }
      case 'caught':
      case 'missed': {
        const k = Math.min(1, since / 0.6);
        return { x: lerp(tg.x, tip.x, k), y: lerp(tg.y, tip.y + 12, k) - Math.sin(k * Math.PI) * 22, sink: 0, inWater: false };
      }
    }
  }

  private splash(x: number, y: number, n: number, power: number): void {
    const cols = ['#eef2f0', '#c3d3d8', '#8ea6ae'];
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.0;
      const sp = (Math.random() * 45 + 25) * power;
      this.particles.push({ x, y, vx: Math.cos(a) * sp * 0.7, vy: Math.sin(a) * sp, life: 1, big: Math.random() < 0.25, c: cols[Math.floor(Math.random() * 3)] });
    }
    this.ripples.push({ x, y: y + 1, r: 1, life: 1 }, { x, y: y + 1, r: 4, life: 0.8 });
  }

  // ---------------------------------------------------------------- primitives

  private px(x: number, y: number, c: string): void {
    this.o.fillStyle = c;
    this.o.fillRect(Math.round(x), Math.round(y), 1, 1);
  }
  private rect(x: number, y: number, w: number, h: number, c: string, ctx = this.o): void {
    ctx.fillStyle = c;
    ctx.fillRect(Math.round(x), Math.round(y), w, h);
  }
  private disk(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, c: string): void {
    ctx.fillStyle = c;
    for (let dy = -r; dy <= r; dy++) {
      const w = Math.floor(Math.sqrt(Math.max(0, r * r - dy * dy + r * 0.6)));
      ctx.fillRect(cx - w, cy + dy, w * 2 + 1, 1);
    }
  }
  private sprite(map: string[], pal: Record<string, string>, x: number, y: number, flip = false, maxY = Infinity): void {
    const o = this.o;
    const w = map[0].length;
    x = Math.round(x);
    y = Math.round(y);
    for (let r = 0; r < map.length; r++) {
      if (y + r >= maxY) break;
      const row = map[r];
      for (let c = 0; c < w; c++) {
        const k = row[c];
        if (k === '.') continue;
        o.fillStyle = pal[k];
        o.fillRect(x + (flip ? w - 1 - c : c), y + r, 1, 1);
      }
    }
  }
  /** Pixel-stepped quadratic curve, one art pixel per step. */
  private curve(x0: number, y0: number, cx: number, cy: number, x1: number, y1: number, c: string | ((k: number) => string), thick = (_k: number) => 1): void {
    const n = Math.max(2, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(cy - y0)) * 1.6));
    let lx = NaN;
    let ly = NaN;
    for (let i = 0; i <= n; i++) {
      const k = i / n;
      const x = Math.round((1 - k) * (1 - k) * x0 + 2 * (1 - k) * k * cx + k * k * x1);
      const y = Math.round((1 - k) * (1 - k) * y0 + 2 * (1 - k) * k * cy + k * k * y1);
      if (x === lx && y === ly) continue;
      lx = x;
      ly = y;
      this.o.fillStyle = typeof c === 'string' ? c : c(k);
      this.o.fillRect(x, y, 1, thick(k));
    }
  }

  // ---------------------------------------------------------------- static background (cached)

  private buildBackground(): void {
    const { W, H } = this;
    const pal = PALETTES[this.palette];
    const hz = this.hz;
    this.bg.width = W;
    this.bg.height = H;
    const b = this.bg.getContext('2d')!;
    b.imageSmoothingEnabled = false;

    // dithered banded gradients for sky and water
    const img = b.createImageData(W, H);
    const sky = pal.sky.map(rgb);
    const water = pal.water.map(rgb);
    for (let y = 0; y < H; y++) {
      const isSky = y < hz;
      const bands = isSky ? sky : water;
      const f = isSky ? (y / Math.max(1, hz - 1)) * (bands.length - 1) : ((y - hz) / Math.max(1, H - hz - 1)) * (bands.length - 1);
      const i = Math.min(bands.length - 2, Math.floor(f));
      const frac = f - i;
      for (let x = 0; x < W; x++) {
        // only dither in the lower 45% of each band so the bands stay visibly stepped
        const fr = frac < 0.55 ? 0 : (frac - 0.55) / 0.45;
        const c = fr > BAYER[(y & 3) * 4 + (x & 3)] ? bands[i + 1] : bands[i];
        const p = (y * W + x) * 4;
        img.data[p] = c[0];
        img.data[p + 1] = c[1];
        img.data[p + 2] = c[2];
        img.data[p + 3] = 255;
      }
    }
    b.putImageData(img, 0, 0);

    // moon with stepped glow and craters
    const m = this.moon;
    b.globalAlpha = 0.05;
    this.disk(b, m.x, m.y, m.r + 9, pal.moon);
    b.globalAlpha = 0.06;
    this.disk(b, m.x, m.y, m.r + 5, pal.moon);
    b.globalAlpha = 0.08;
    this.disk(b, m.x, m.y, m.r + 2, pal.moon);
    b.globalAlpha = 1;
    this.disk(b, m.x, m.y, m.r, pal.moon);
    b.fillStyle = pal.moonShade;
    // shaded right edge
    for (let dy = -m.r; dy <= m.r; dy++) {
      const w = Math.floor(Math.sqrt(Math.max(0, m.r * m.r - dy * dy + m.r * 0.6)));
      b.fillRect(m.x + w - 1, m.y + dy, 1, 1);
    }
    b.fillRect(m.x - 2, m.y - 2, 2, 2);
    b.fillRect(m.x + 2, m.y + 1, 2, 1);
    b.fillRect(m.x + 2, m.y + 2, 1, 1);
    b.fillRect(m.x - 1, m.y + 3, 1, 1);

    const r = rng(97 + this.palette * 131 + W);
    const ph1 = r() * 6;
    const ph2 = r() * 6;
    // far hills
    b.fillStyle = pal.hill;
    for (let x = 0; x < W; x++) {
      const h = 5 + Math.round(Math.sin(x * 0.035 + ph1) * pal.hillAmp * 0.6 + Math.sin(x * 0.011 + ph2) * pal.hillAmp + pal.hillAmp);
      b.fillRect(x, hz - h, 1, h);
    }
    // haze line above the far hills
    b.globalAlpha = 0.12;
    b.fillStyle = pal.mist;
    b.fillRect(0, hz - 7, W, 3);
    b.globalAlpha = 1;

    // three pine layers, far → near (each darker, taller, sparser)
    const layers: [number, number, number, number][] = [
      // [min height, max height, average spacing, baseline offset]
      [6, 10, 4, 0],
      [9, 17, 7, 0],
      [14, 26, 12, 0],
    ];
    layers.forEach(([hMin, hMax, gap, off], li) => {
      b.fillStyle = pal.forest[li];
      const spacing = gap / Math.max(0.2, pal.pines);
      let x = -4 + r() * spacing;
      while (x < W + 4) {
        const th = Math.round(hMin + r() * (hMax - hMin));
        // leave a clearing in the middle for the nearest layer so the moon/water open up
        const clearing = li === 2 && x > W * 0.42 && x < W * 0.68 && r() < 0.8;
        if (!clearing) this.pine(b, Math.round(x), hz + off, th);
        x += spacing * (0.6 + r() * 0.9);
      }
      // ground strip under each layer
      b.fillRect(0, hz - (2 - li), W, 2 - li + 1);
      if (li === 0) {
        b.globalAlpha = 0.1;
        b.fillStyle = pal.mist;
        b.fillRect(0, hz - 4, W, 2);
        b.globalAlpha = 1;
      }
    });
    // shoreline: a single lighter row where land meets water
    b.globalAlpha = 0.35;
    b.fillStyle = pal.shimmer[1];
    b.fillRect(0, hz, W, 1);
    b.globalAlpha = 1;
  }

  /** A jagged three-tier pine silhouette standing on (x, base). */
  private pine(b: CanvasRenderingContext2D, x: number, base: number, h: number): void {
    const tier = Math.max(3, Math.round(h / 3));
    b.fillRect(x, base - h - 1, 1, 2); // tip
    for (let j = 0; j < h; j++) {
      const t = Math.floor(j / tier);
      const local = j % tier;
      const half = Math.floor(local * 0.7) + t;
      b.fillRect(x - half, base - h + j, half * 2 + 1, 1);
    }
    b.fillRect(x, base - 1, 1, 2); // trunk
  }

  // ---------------------------------------------------------------- frame

  private draw(now: number): void {
    const { W, H, o } = this;
    if (!W || !H) return;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const t = (now - this.t0) / 1000;
    const pal = PALETTES[this.palette];
    const hz = this.hz;

    const key = `${W}x${H}:${this.palette}`;
    if (key !== this.bgKey) {
      this.buildBackground();
      this.bgKey = key;
    }
    o.globalAlpha = 1;
    o.drawImage(this.bg, 0, 0);

    // twinkling stars (3 brightness steps), big ones get a plus shape when bright
    const m = this.moon;
    for (const s of this.stars) {
      if (Math.abs(s.x - m.x) <= m.r + 4 && Math.abs(s.y - m.y) <= m.r + 4) continue;
      const v = 0.5 + 0.5 * Math.sin(t * s.sp + s.ph);
      const c = v > 0.75 ? '#d9dbd6' : v > 0.35 ? '#7f8890' : '#3a424a';
      this.px(s.x, s.y, c);
      if (s.big && v > 0.75) {
        this.px(s.x - 1, s.y, '#59626b');
        this.px(s.x + 1, s.y, '#59626b');
        this.px(s.x, s.y - 1, '#59626b');
        this.px(s.x, s.y + 1, '#59626b');
      }
    }

    // thin drifting cloud strips (stepped, translucent)
    o.globalAlpha = 0.18;
    for (const c of this.clouds) {
      c.x += c.v * dt;
      if (c.x > W + 4) c.x = -c.w - 4;
      const x = Math.round(c.x);
      this.rect(x + 4, c.y - 1, c.w - 10, 1, pal.mist);
      this.rect(x, c.y, c.w, 1, pal.mist);
      this.rect(x + 6, c.y + 1, c.w - 4, 1, pal.mist);
    }
    o.globalAlpha = 1;

    // forest reflection: mirrored, squashed and wobbling rows just below the horizon
    const R = Math.min(22, H - hz - 2);
    for (let i = 0; i < R; i++) {
      if (i % 3 === 2) continue;
      const src = hz - 1 - Math.floor(i * 1.5);
      if (src < 0) break;
      const dx = i > 2 ? Math.round(Math.sin(t * 1.6 + i * 0.9)) : 0;
      o.globalAlpha = 0.32 * (1 - i / R);
      o.drawImage(this.bg, 0, src, W, 1, dx, hz + 1 + i, W, 1);
    }
    o.globalAlpha = 1;

    // moon path on the water
    for (let y = hz + 2; y < H; y += 2) {
      const k = (y - hz) / (H - hz);
      const w = Math.round(m.r * 1.1 - k * m.r * 0.7 + Math.sin(t * 2 + y * 0.7) * 1.8);
      if (w <= 0) continue;
      const x = m.x - Math.floor(w / 2) + Math.round(Math.sin(t * 1.3 + y * 0.4) * 1.4);
      o.globalAlpha = k < 0.35 ? 0.5 : 0.3;
      this.rect(x, y, w, 1, k < 0.35 ? pal.moonRef[0] : pal.moonRef[1]);
    }
    o.globalAlpha = 1;

    // shimmer dashes drifting across the water
    for (const d of this.dashes) {
      d.x += d.v * dt;
      if (d.x > W + 8) d.x = -8;
      if (d.x < -8) d.x = W + 8;
      const v = Math.sin(t * 1.1 + d.ph);
      if (v < 0.1) continue;
      this.rect(d.x, d.y, d.len, 1, v > 0.7 ? pal.shimmer[0] : pal.shimmer[1]);
    }

    // fish shadows
    o.globalAlpha = 0.45;
    for (const f of this.swimmers) {
      f.x += f.v * dt;
      if (f.x > W + 12) f.x = -12;
      if (f.x < -12) f.x = W + 12;
      const y = f.y + Math.round(Math.sin(t * 0.7 + f.ph) * 1.5);
      const map = Math.floor(t * 3 + f.ph) % 2 ? FISH_SHADOW : FISH_SHADOW2;
      this.sprite(map, { x: pal.water[5] }, f.x, y, f.v < 0);
    }
    o.globalAlpha = 1;

    // fireflies over the shore
    for (const f of this.flies) {
      const x = f.x + Math.sin(t * f.sp + f.ph) * 6;
      const y = f.y + Math.sin(t * f.sp * 1.7 + f.ph * 2) * 3;
      const v = Math.sin(t * 2.2 + f.ph * 3);
      if (v < 0.2) continue;
      if (v > 0.75) {
        o.globalAlpha = 0.35;
        this.rect(x - 1, y, 3, 1, '#c9b45a');
        this.rect(x, y - 1, 1, 3, '#c9b45a');
        o.globalAlpha = 1;
      }
      this.px(x, y, v > 0.6 ? '#e8d77a' : '#8f8146');
    }

    this.drawPier(t);

    // ripples around the bobber
    const b = this.bobberPos(now);
    if (b.inWater && now - this.lastRipple > (this.phase === 'bite' ? 650 : 1500)) {
      this.ripples.push({ x: b.x, y: b.y + 1, r: 1, life: this.phase === 'bite' ? 1 : 0.7 });
      this.lastRipple = now;
    }
    for (const rp of this.ripples) {
      rp.r += 7 * dt;
      rp.life -= 0.85 * dt;
      const rx = Math.round(rp.r * 1.8);
      const ry = Math.max(1, Math.round(rp.r * 0.45));
      o.globalAlpha = rp.life > 0.6 ? 0.7 : rp.life > 0.3 ? 0.4 : 0.18;
      const n = Math.max(8, rx * 3);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        this.px(rp.x + Math.cos(a) * rx, rp.y + Math.sin(a) * ry, '#a9bcc2');
      }
    }
    o.globalAlpha = 1;
    this.ripples = this.ripples.filter((rp) => rp.life > 0);

    // angler, rod, line, bobber
    const a = this.anglerPos();
    this.sprite(ANGLER, ANGLER_PAL, a.x, a.y);
    const pose = this.rodPose(now);
    const hand = this.hand();
    const tip = this.tipAt(pose.a);
    const L = this.rodLen();
    // control point: midpoint pushed perpendicular (downwards along the line) by the bend
    const mx = (hand.x + tip.x) / 2 - Math.sin(pose.a) * pose.bend * L;
    const my = (hand.y + tip.y) / 2 + Math.cos(pose.a) * pose.bend * L;
    const bendTip = { x: tip.x - Math.sin(pose.a) * pose.bend * L * 0.6, y: tip.y + Math.cos(pose.a) * pose.bend * L * 0.9 };

    const top = b.y - 4 + b.sink;
    const sag = b.inWater ? 1 : 4;
    o.globalAlpha = 0.6;
    this.curve(bendTip.x, bendTip.y, (bendTip.x + b.x) / 2, Math.max(bendTip.y, top) + sag, b.x, top, '#c4cccf');
    o.globalAlpha = 1;
    this.curve(hand.x - 2, hand.y + 2, mx, my, bendTip.x, bendTip.y, (k) => (k < 0.35 ? '#4a3424' : '#8a6a44'), (k) => (k < 0.3 ? 2 : 1));
    // reel
    this.rect(hand.x - 1, hand.y + 2, 2, 2, '#8c969b');
    this.sprite(['SS'], ANGLER_PAL, hand.x - 1, hand.y);

    // bobber (partially under the waterline when floating)
    this.sprite(BOBBER, BOBBER_PAL, b.x - 1, top, false, b.inWater ? Math.round(b.y) + 1 : Infinity);
    if (b.inWater) {
      o.globalAlpha = 0.7;
      this.rect(b.x - 3, b.y + 1, 2, 1, '#b7c6ca');
      this.rect(b.x + 2, b.y + 1, 2, 1, '#b7c6ca');
      o.globalAlpha = 1;
    }
    // the catch dangles under the bobber for a few seconds
    if (this.phase === 'caught' && now - this.phaseAt < 4500) {
      const wig = Math.floor(t * 8) % 2;
      this.sprite(CATCH_FISH, CATCH_PAL, b.x - 4 + wig, top + 6, wig === 1);
    }
    // "!" over the angler's head on a bite
    if (this.phase === 'bite' && Math.floor(t * 4) % 2 === 0) {
      const ex = a.x + 6;
      const ey = a.y - 9;
      this.rect(ex - 1, ey - 1, 3, 8, '#0b0c0e');
      this.rect(ex, ey, 1, 4, '#e2c47a');
      this.rect(ex, ey + 5, 1, 1, '#e2c47a');
    }

    // splash particles (1–2 px squares)
    for (const p of this.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 190 * dt;
      p.life -= 1.1 * dt;
      o.globalAlpha = p.life > 0.4 ? 1 : 0.5;
      const sz = p.big && p.life > 0.5 ? 2 : 1;
      this.rect(p.x, p.y, sz, sz, p.c);
    }
    o.globalAlpha = 1;
    this.particles = this.particles.filter((p) => p.life > 0 && p.y < H + 4);

    this.drawReeds(t);

    // upscale: whole-number scale, no smoothing → crisp pixels
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.drawImage(this.off, 0, 0, W * this.s, H * this.s);
  }

  private drawPier(t: number): void {
    const { H } = this;
    const deck = this.deckY;
    const end = this.pierEnd;
    // posts
    for (let x = end - 4; x > -4; x -= 14) {
      this.rect(x, deck + 3, 3, H - deck, '#22180f');
      this.rect(x, deck + 3, 1, H - deck, '#3a2a1b');
      // water line around the post
      const wl = deck + 9 + (Math.sin(t * 2 + x) > 0 ? 1 : 0);
      this.rect(x - 1, wl, 5, 1, '#3d525a');
    }
    // deck: lit top edge, planks, dark underside
    this.rect(0, deck, end, 1, '#7a6044');
    this.rect(0, deck + 1, end, 2, '#5a4430');
    this.rect(0, deck + 3, end, 1, '#2a1f15');
    for (let x = end - 6; x > 0; x -= 6) this.rect(x, deck + 1, 1, 2, '#3f2f20');
    // tackle box + lantern
    const bx = Math.max(4, end - 30);
    this.rect(bx, deck - 4, 7, 4, '#4a5a4c');
    this.rect(bx, deck - 4, 7, 1, '#62746a');
    this.rect(bx + 3, deck - 3, 1, 1, '#b8a071');
    const lx = Math.max(2, end - 40);
    const flick = Math.sin(t * 9) > 0.85 ? 1 : 0;
    this.o.globalAlpha = 0.07;
    this.disk(this.o, lx + 1, deck - 3, 10 + flick, '#f0c070');
    this.o.globalAlpha = 0.09;
    this.disk(this.o, lx + 1, deck - 3, 6, '#f0c070');
    this.o.globalAlpha = 1;
    this.sprite(LANTERN, LANTERN_PAL, lx, deck - 5);
    // lantern reflection on the water next to the pier
    this.o.globalAlpha = 0.4;
    this.rect(lx - 1, deck + 6 + (Math.sin(t * 2.5) > 0 ? 1 : 0), 4, 1, '#c99a4e');
    this.o.globalAlpha = 1;
  }

  private drawReeds(t: number): void {
    const { W, H } = this;
    const sway = Math.sin(t * 0.9) > 0.4 ? 1 : 0;
    const reeds: [number, number][] = [
      [W - 5, 22],
      [W - 9, 16],
      [W - 13, 26],
      [W - 17, 12],
    ];
    for (const [x, h] of reeds) {
      this.rect(x, H - h + 4, 1, h, '#121a15');
      this.rect(x + sway, H - h, 1, 5, '#121a15');
      if (h > 14) this.rect(x + sway - 0, H - h + 1, 2, 4, '#3a2c22');
    }
    this.rect(W - 20, H - 4, 20, 4, '#0d1310');
  }
}
