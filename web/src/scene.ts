// Pixel-art pond at four times of day: pier, angler, rod, line, bobber, ripples, splash. Pure presentation — driven by setPhase().
//
// Everything is drawn procedurally into a low-resolution offscreen canvas (~170 logical px tall) and then
// blitted to the display canvas with an integer scale factor and image smoothing disabled, so every
// "pixel" is a crisp square. Static layers (dithered sky + water, moon, hills, pine forests) are cached
// and only rebuilt when the size, the spot palette or the time of day changes.
import { timeOfDay, type TimeOfDay } from './daytime';

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
  {
    // golden lake
    sky: ['#14100a', '#1a140c', '#21190e', '#291f10', '#322612', '#3d2e14'],
    water: ['#33290f', '#2b220d', '#231c0b', '#1c1609', '#151107', '#0f0c05'],
    hill: '#241c10',
    forest: ['#2a1f0e', '#1f170a', '#141006'],
    mist: '#4a3c1c',
    shimmer: ['#8a7434', '#5c4c22'],
    moon: '#f0dfae',
    moonShade: '#c4b07a',
    moonRef: ['#e0cc90', '#7a6a3c'],
    pines: 0.8,
    hillAmp: 5,
  },
  {
    // ancient swamp
    sky: ['#0b0f0a', '#0e130c', '#11170e', '#141c11', '#182114', '#1c2717'],
    water: ['#141d10', '#111a0e', '#0e160c', '#0b120a', '#090e08', '#060a06'],
    hill: '#131a11',
    forest: ['#10160e', '#0c110b', '#080c07'],
    mist: '#2c3a26',
    shimmer: ['#4c6238', '#2f4024'],
    moon: '#dfe6c4',
    moonShade: '#aeb894',
    moonRef: ['#c4cca6', '#5f6c50'],
    pines: 0.45,
    hillAmp: 3,
  },
  {
    // phantom waters
    sky: ['#0d0f16', '#11141d', '#161a25', '#1c212e', '#232937', '#2b3242'],
    water: ['#242c3c', '#1f2634', '#1a202c', '#151a24', '#10141c', '#0b0e14'],
    hill: '#1c2230',
    forest: ['#181d29', '#12161f', '#0c0f15'],
    mist: '#6a7890',
    shimmer: ['#8ea0c4', '#5a6884'],
    moon: '#eaf0ff',
    moonShade: '#b8c2dc',
    moonRef: ['#d0daf4', '#6a7694'],
    pines: 0.35,
    hillAmp: 4,
  },
];

/** What makes a water its own place, beyond its colours: where the angler stands and what is around. */
interface Spot {
  palette: number;
  stand: 'pier' | 'quay' | 'ledge' | 'bank' | 'boardwalk' | 'boat';
  far?: 'cottage' | 'lighthouse' | 'peaks' | 'torii' | 'snags';
  ship?: 'trawler' | 'ghost';
  lilies?: number;
  /** colour of the lily flowers */
  bloom?: string;
  rocks?: number;
  stumps?: number;
  /** the water runs to the right, this many times faster than a still water shimmers */
  flow?: number;
  buoy?: boolean;
  /** an empty boat adrift */
  skiff?: boolean;
  /** drifting bands of mist over the water (their opacity) */
  mist?: number;
  /** lights over the shore at any hour, instead of fireflies after dark: [bright, dim] */
  wisps?: [string, string];
  shore: 'reeds' | 'boulders' | 'snag' | 'none';
}

/** By location id (see LOCATIONS in game/content.ts). */
const SPOTS: Spot[] = [
  { palette: 0, stand: 'pier', far: 'cottage', lilies: 7, bloom: '#f0c4d2', shore: 'reeds' }, // village pond
  { palette: 1, stand: 'bank', rocks: 3, flow: 5, shore: 'reeds' }, // forest river
  { palette: 2, stand: 'boat', far: 'peaks', buoy: true, shore: 'none' }, // deep lake
  { palette: 3, stand: 'quay', far: 'lighthouse', ship: 'trawler', buoy: true, shore: 'boulders' }, // northern sea
  { palette: 4, stand: 'ledge', far: 'peaks', rocks: 5, flow: 9, shore: 'boulders' }, // taimen rapids
  { palette: 5, stand: 'pier', far: 'torii', lilies: 10, bloom: '#f6cf58', shore: 'reeds' }, // golden lake
  { palette: 6, stand: 'boardwalk', far: 'snags', stumps: 4, lilies: 5, mist: 0.1, wisps: ['#c4f58f', '#62903e'], shore: 'snag' }, // ancient swamp
  { palette: 7, stand: 'boardwalk', far: 'snags', ship: 'ghost', skiff: true, mist: 0.2, wisps: ['#d6e9ff', '#7393c4'], shore: 'snag' }, // phantom waters
];

/** What the time of day adds to a palette: the light, what is in the sky, and how the fixed sprites are lit. */
interface Light {
  sun: boolean;
  /** height of the sun or moon, as a share of the sky (0 = top, 1 = horizon) */
  orbY: number;
  /** share of the stars that show, and the highest brightness step they reach */
  stars: number;
  starSteps: [string, string, string];
  fireflies: boolean;
  lantern: boolean;
  cloud: number;
  haze: number;
  /** sprites (pier, angler, reeds) are drawn for night: gamma < 1 lifts them into daylight, tint colours the light */
  gamma: number;
  tint: [number, number, number];
  line: string;
  ripple: string;
}

const LIGHTS: Record<TimeOfDay, Light> = {
  night: { sun: false, orbY: 0.3, stars: 1, starSteps: ['#d9dbd6', '#7f8890', '#3a424a'], fireflies: true, lantern: true, cloud: 0.18, haze: 1, gamma: 1, tint: [1, 1, 1], line: '#c4cccf', ripple: '#a9bcc2' },
  morning: { sun: true, orbY: 0.74, stars: 0, starSteps: ['#fff', '#fff', '#fff'], fireflies: false, lantern: false, cloud: 0.5, haze: 3.2, gamma: 0.7, tint: [1.04, 1, 1.03], line: '#5d6470', ripple: '#f6f1ea' },
  day: { sun: true, orbY: 0.22, stars: 0, starSteps: ['#fff', '#fff', '#fff'], fireflies: false, lantern: false, cloud: 0.85, haze: 1.4, gamma: 0.58, tint: [1, 1, 1], line: '#3f5560', ripple: '#eefaff' },
  evening: { sun: true, orbY: 0.8, stars: 0.3, starSteps: ['#e9d6d2', '#b79aa8', '#7c6688'], fireflies: true, lantern: true, cloud: 0.45, haze: 2, gamma: 0.86, tint: [1.14, 0.95, 0.9], line: '#f1d6c0', ripple: '#ffd9b8' },
};

/** The pond in daylight; other waters are these with their own colour cast (see paletteFor). */
const DAYLIGHT: Record<Exclude<TimeOfDay, 'night'>, Omit<Palette, 'pines' | 'hillAmp'>> = {
  morning: {
    sky: ['#7391b4', '#93a6c0', '#b6b7c7', '#d8c5c5', '#f0d0b9', '#fbdeb4'],
    water: ['#b4c0c6', '#9aadb9', '#8199aa', '#6b869a', '#587489', '#476277'],
    hill: '#94a3b0',
    forest: ['#758f90', '#557475', '#3b595a'],
    mist: '#f6efe8',
    shimmer: ['#fbe8cd', '#cdd1d4'],
    moon: '#fff3d6',
    moonShade: '#ffdca6',
    moonRef: ['#ffe5bd', '#d8ccc4'],
  },
  day: {
    sky: ['#58a6d8', '#6cb2de', '#83c0e4', '#9bcdea', '#b5daef', '#d0e8f3'],
    water: ['#63aec8', '#529fbc', '#448fae', '#397f9f', '#2f6f8e', '#265f7d'],
    hill: '#86b5a0',
    forest: ['#5f9a78', '#3f7d5a', '#2a6144'],
    mist: '#ffffff',
    shimmer: ['#e2f6fb', '#a6d5e4'],
    moon: '#fff8d2',
    moonShade: '#ffe894',
    moonRef: ['#fff5cc', '#c6e7ea'],
  },
  evening: {
    sky: ['#2c2a4f', '#4a3560', '#7a4468', '#b55a62', '#e07d55', '#f5a85a'],
    water: ['#b26c5d', '#8d5761', '#6c4761', '#513b5b', '#3b2f50', '#292441'],
    hill: '#4c3654',
    forest: ['#3a2a44', '#2a1f36', '#1c1528'],
    mist: '#f3a877',
    shimmer: ['#ffcb8e', '#cb826b'],
    moon: '#ffdca6',
    moonShade: '#ffb466',
    moonRef: ['#ffd194', '#db8c6b'],
  },
};

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
const CATCH_BOTTLE = ['.cc.', '.gg.', 'gLLg', 'gyYg', 'gYyg', 'gyyg', '.gg.'];
const CATCH_BOTTLE_PAL: Record<string, string> = { c: '#b8a071', g: '#3f8f63', L: '#8fe6ad', y: '#f2c94c', Y: '#fff0a8' };
const LANTERN = ['.k.', 'kkk', 'yYy', 'yYy', 'kkk'];
const LANTERN_PAL: Record<string, string> = { k: '#2a2522', y: '#e0b35a', Y: '#f6e3a2' };
const BUOY = ['.l.', '.k.', 'rrr', 'rwr', 'rrr'];
const LANTERN_OFF_PAL: Record<string, string> = { k: '#4a423c', y: '#9aa3a4', Y: '#c3cbcb' };

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

const hex = (c: number[]): string => '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

const paletteCache = new Map<string, Palette>();
/** The palette of a water at a time of day. Night is hand-made per water; daylight is the pond's, cast in the water's own colour. */
function paletteFor(spot: number, time: TimeOfDay): Palette {
  const night = PALETTES[spot];
  if (time === 'night') return night;
  const key = `${spot}:${time}`;
  let pal = paletteCache.get(key);
  if (!pal) {
    // the water's character: how its night shimmer leans against the pond's, channel by channel
    const lean = (c: string): number[] => {
      const v = rgb(c);
      const mean = (v[0] + v[1] + v[2]) / 3;
      return v.map((x) => x / mean);
    };
    const own = lean(night.shimmer[0]);
    const pond = lean(PALETTES[0].shimmer[0]);
    const cast = own.map((v, i) => Math.max(0.78, Math.min(1.26, 1 + (v / pond[i] - 1) * 0.55)));
    const tint = (c: string): string => hex(rgb(c).map((v, i) => v * cast[i]));
    const base = DAYLIGHT[time];
    pal = {
      ...base,
      sky: base.sky.map(tint),
      water: base.water.map(tint),
      hill: tint(base.hill),
      forest: [tint(base.forest[0]), tint(base.forest[1]), tint(base.forest[2])],
      shimmer: [tint(base.shimmer[0]), tint(base.shimmer[1])],
      pines: night.pines,
      hillAmp: night.hillAmp,
    };
    paletteCache.set(key, pal);
  }
  return pal;
}

const litCache = new Map<string, string>();
/** A sprite colour (drawn for night) under the light of a time of day. */
function lit(c: string, time: TimeOfDay): string {
  if (time === 'night') return c;
  const key = time + c;
  let v = litCache.get(key);
  if (!v) {
    const l = LIGHTS[time];
    v = hex(rgb(c).map((x, i) => 255 * Math.pow(x / 255, l.gamma) * l.tint[i]));
    litCache.set(key, v);
  }
  return v;
}
const litPalCache = new Map<string, Record<string, string>>();
function litPal(name: string, pal: Record<string, string>, time: TimeOfDay): Record<string, string> {
  if (time === 'night') return pal;
  const key = time + name;
  let v = litPalCache.get(key);
  if (!v) {
    v = Object.fromEntries(Object.entries(pal).map(([k, c]) => [k, lit(c, time)]));
    litPalCache.set(key, v);
  }
  return v;
}

const mixHex = (a: string, b: string, k: number): string => {
  const x = rgb(a);
  const y = rgb(b);
  return hex(x.map((v, i) => v + (y[i] - v) * k));
};

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
  /** When the catch on the line turned out to be the bottle (0 = it is a fish). */
  private prizeAt = 0;
  private particles: Particle[] = [];
  private ripples: Ripple[] = [];
  private swimmers: Swimmer[] = [];
  private stars: Star[] = [];
  private dashes: Dash[] = [];
  private flies: Fly[] = [];
  private clouds: Cloud[] = [];
  private palette = 0;
  private spotId = 0;
  private lilies: { x: number; y: number; ph: number; flower: boolean }[] = [];
  private rocks: { x: number; y: number; w: number; h: number }[] = [];
  private stumps: { x: number; y: number; h: number }[] = [];
  private time: TimeOfDay = 'night';
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

  /** The water in the scene, by location id. */
  setSpot(locationId: number): void {
    const id = Math.max(0, Math.min(SPOTS.length - 1, locationId));
    if (id === this.spotId) return;
    this.spotId = id;
    this.palette = SPOTS[id].palette;
    this.seedProps();
  }
  private get spot(): Spot {
    return SPOTS[this.spotId];
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

  /** The thing just landed is the bottle: it hangs on the line instead of a fish, in a splash of gold. */
  prize(): void {
    const now = performance.now();
    const b = this.bobberPos(now);
    this.prizeAt = now;
    const cols = ['#f2c94c', '#fff0a8', '#f08a4b', '#f2fff6'];
    for (let i = 0; i < 60; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
      const sp = Math.random() * 70 + 35;
      this.particles.push({ x: b.x, y: b.y, vx: Math.cos(a) * sp * 0.8, vy: Math.sin(a) * sp, life: 1.25, big: Math.random() < 0.4, c: cols[Math.floor(Math.random() * cols.length)] });
    }
    this.ripples.push({ x: b.x, y: b.y + 1, r: 2, life: 1 }, { x: b.x, y: b.y + 1, r: 7, life: 0.9 });
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
    this.seedProps();
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

  /** Things in the water of this spot: lily pads, rocks, drowned stumps. Kept clear of the float and the stand. */
  private seedProps(): void {
    const { W, H, spot } = this;
    const hz = this.hz;
    const r = rng(977 * (this.spotId + 1) + W);
    const tg = this.target();
    const place = (n: number, margin: number): { x: number; y: number }[] => {
      const out: { x: number; y: number }[] = [];
      for (let tries = 0; out.length < n && tries < n * 30; tries++) {
        const x = Math.round(this.pierEnd + 14 + r() * Math.max(1, W - this.pierEnd - 40));
        const y = Math.round(hz + 9 + r() * Math.max(1, H - hz - 20));
        if (Math.abs(x - tg.x) < 18 && Math.abs(y - tg.y) < 11) continue;
        if (out.some((p) => Math.abs(p.x - x) < margin && Math.abs(p.y - y) < 6)) continue;
        out.push({ x, y });
      }
      return out.sort((a, b) => a.y - b.y);
    };
    this.rocks = place(spot.rocks ?? 0, 16).map((p) => {
      const k = (p.y - hz) / (H - hz);
      return { ...p, w: Math.round(6 + k * 6 + r() * 2), h: Math.round(3 + k * 3 + r()) };
    });
    this.stumps = place(spot.stumps ?? 0, 14).map((p) => ({ ...p, h: Math.round(6 + ((p.y - hz) / (H - hz)) * 8 + r() * 3) }));
    this.lilies = place(spot.lilies ?? 0, 9).map((p) => ({ ...p, ph: r() * 6.28, flower: r() < 0.4 }));
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
    return { x: Math.round(this.W * 0.76), y: Math.round(this.hz * LIGHTS[this.time].orbY), r: Math.max(5, Math.round(this.H * 0.038)) };
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
    const pal = paletteFor(this.palette, this.time);
    const light = LIGHTS[this.time];
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

    // sun or moon with a stepped glow; the moon gets a shaded edge and craters
    const m = this.moon;
    const glow = light.sun ? 2 : 1;
    b.globalAlpha = 0.05 * glow;
    this.disk(b, m.x, m.y, m.r + 9 * glow, pal.moon);
    b.globalAlpha = 0.06 * glow;
    this.disk(b, m.x, m.y, m.r + 5 * glow, pal.moon);
    b.globalAlpha = 0.08 * glow;
    this.disk(b, m.x, m.y, m.r + 2 * glow, pal.moon);
    b.globalAlpha = 1;
    if (light.sun) {
      this.disk(b, m.x, m.y, m.r, pal.moonShade);
      this.disk(b, m.x, m.y, m.r - 1, pal.moon);
    } else {
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
    }

    const spot = this.spot;
    const r = rng(97 + this.spotId * 131 + W);
    const ph1 = r() * 6;
    const ph2 = r() * 6;
    if (spot.far === 'peaks') {
      // distant mountains with snow, behind the hills
      const rock = mixHex(pal.sky[3], pal.hill, 0.6);
      const snow = mixHex(rock, pal.mist, light.sun ? 0.85 : 0.45);
      const peaks: [number, number][] = [
        [0.16, 0.6],
        [0.46, 0.8],
        [0.83, 0.54],
      ];
      for (const [fx, fh] of peaks) {
        const cx = Math.round(W * fx);
        const h = Math.round(hz * fh);
        for (let dy = 0; dy < h; dy++) {
          const half = Math.round(dy * 0.8) + (dy % 5 < 2 ? 1 : 0);
          b.fillStyle = dy < 6 || (dy < 9 && dy % 2 === 0) ? snow : rock;
          b.fillRect(cx - half, hz - h + dy, half * 2 + 1, 1);
          if (dy >= 6 && dy < 12) {
            // snow tongues down the left flank
            b.fillStyle = snow;
            b.fillRect(cx - half + 1, hz - h + dy, Math.max(1, 5 - (dy - 6)), 1);
          }
        }
      }
    }
    // far hills
    b.fillStyle = pal.hill;
    for (let x = 0; x < W; x++) {
      const h = 5 + Math.round(Math.sin(x * 0.035 + ph1) * pal.hillAmp * 0.6 + Math.sin(x * 0.011 + ph2) * pal.hillAmp + pal.hillAmp);
      b.fillRect(x, hz - h, 1, h);
    }
    // haze line above the far hills
    b.globalAlpha = Math.min(0.6, 0.12 * light.haze);
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
        b.globalAlpha = Math.min(0.5, 0.1 * light.haze);
        b.fillStyle = pal.mist;
        b.fillRect(0, hz - 4, W, 2);
        b.globalAlpha = 1;
      }
    });
    this.farThings(b, spot, pal, light, r);
    // shoreline: a single lighter row where land meets water
    b.globalAlpha = 0.35;
    b.fillStyle = pal.shimmer[1];
    b.fillRect(0, hz, W, 1);
    b.globalAlpha = 1;
  }

  /** What stands on the far shore of this spot. Static: drawn into the cached background, so the water mirrors it. */
  private farThings(b: CanvasRenderingContext2D, spot: Spot, pal: Palette, light: Light, r: () => number): void {
    const { W, time } = this;
    const hz = this.hz;
    const cx = Math.round(W * 0.55);
    const fill = (x: number, y: number, w: number, h: number, c: string): void => {
      b.fillStyle = c;
      b.fillRect(x, y, w, h);
    };
    if (spot.far === 'cottage') {
      const wall = lit('#2b2622', time);
      const roof = lit('#3d2b22', time);
      fill(cx - 4, hz - 6, 9, 6, wall);
      for (let i = 0; i < 4; i++) fill(cx - 5 + i, hz - 7 - i, 11 - i * 2, 1, roof);
      fill(cx + 2, hz - 12, 2, 3, roof);
      fill(cx + 1, hz - 4, 2, 4, lit('#1b1714', time));
      fill(cx - 3, hz - 4, 2, 2, light.lantern ? '#f0c070' : lit('#4f5f6c', time));
    } else if (spot.far === 'lighthouse') {
      fill(cx - 7, hz - 2, 15, 2, pal.forest[2]);
      fill(cx - 5, hz - 3, 10, 1, pal.forest[2]);
      for (let j = 0; j < 17; j++) {
        const wide = j > 8 ? 5 : 3;
        fill(cx - (wide >> 1), hz - 20 + j, wide, 1, lit(Math.floor(j / 4) % 2 ? '#a8402e' : '#c9cdc8', time));
      }
      fill(cx - 2, hz - 23, 5, 3, lit('#22262a', time));
      fill(cx - 1, hz - 24, 3, 1, lit('#22262a', time));
      fill(cx - 1, hz - 22, 3, 1, light.lantern ? '#f6e3a2' : lit('#7a8a94', time));
    } else if (spot.far === 'torii') {
      const red = lit('#a63c2a', time);
      const dark = lit('#6e2519', time);
      fill(cx - 5, hz - 11, 2, 11, red);
      fill(cx + 4, hz - 11, 2, 11, red);
      fill(cx - 6, hz - 9, 13, 1, red);
      fill(cx - 8, hz - 13, 17, 2, dark);
      fill(cx - 9, hz - 14, 2, 1, dark);
      fill(cx + 8, hz - 14, 2, 1, dark);
    } else if (spot.far === 'snags') {
      // dead trees along the far shore
      for (let i = 0; i < 9; i++) this.deadTree(b, Math.round(W * (0.08 + i * 0.105) + r() * 8), hz, Math.round(10 + r() * 14), i % 2 ? 1 : -1, pal.forest[i % 3 === 0 ? 1 : 2]);
    }
  }

  /** A bare trunk with a few crooked branches, standing on (x, base). */
  private deadTree(b: CanvasRenderingContext2D, x: number, base: number, h: number, lean: number, c: string): void {
    b.fillStyle = c;
    b.fillRect(x, base - h, 1, h);
    b.fillRect(x - 1, base - Math.round(h * 0.45), 3, Math.round(h * 0.45));
    [0.5, 0.7, 0.86].forEach((f, i) => {
      const dir = (i % 2 ? -1 : 1) * lean;
      const len = Math.round(h * (0.34 - i * 0.07));
      for (let k = 1; k <= len; k++) b.fillRect(x + dir * k, base - Math.round(h * f) - Math.floor(k / 2), 1, 1);
    });
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
    this.time = timeOfDay();
    const time = this.time;
    const light = LIGHTS[time];
    const pal = paletteFor(this.palette, time);
    const spot = this.spot;
    const hz = this.hz;

    const key = `${W}x${H}:${this.spotId}:${time}`;
    if (key !== this.bgKey) {
      this.buildBackground();
      this.bgKey = key;
    }
    o.globalAlpha = 1;
    o.drawImage(this.bg, 0, 0);

    // twinkling stars (3 brightness steps), big ones get a plus shape when bright
    const m = this.moon;
    const starLine = light.stars < 1 ? (hz - 34) * 0.45 : Infinity;
    for (let i = 0; i < this.stars.length * light.stars; i++) {
      const s = this.stars[i];
      if (s.y > starLine) continue;
      if (Math.abs(s.x - m.x) <= m.r + 4 && Math.abs(s.y - m.y) <= m.r + 4) continue;
      const v = 0.5 + 0.5 * Math.sin(t * s.sp + s.ph);
      const c = v > 0.75 ? light.starSteps[0] : v > 0.35 ? light.starSteps[1] : light.starSteps[2];
      this.px(s.x, s.y, c);
      if (s.big && v > 0.75 && light.stars === 1) {
        this.px(s.x - 1, s.y, '#59626b');
        this.px(s.x + 1, s.y, '#59626b');
        this.px(s.x, s.y - 1, '#59626b');
        this.px(s.x, s.y + 1, '#59626b');
      }
    }

    // drifting clouds (stepped, translucent): thin strips at night, fuller by day
    o.globalAlpha = light.cloud;
    for (const c of this.clouds) {
      c.x += c.v * dt;
      if (c.x > W + 4) c.x = -c.w - 4;
      const x = Math.round(c.x);
      if (light.sun) {
        this.rect(x + 8, c.y - 3, c.w - 18, 1, pal.mist);
        this.rect(x + 5, c.y - 2, c.w - 11, 1, pal.mist);
      }
      this.rect(x + 4, c.y - 1, c.w - 10, 1, pal.mist);
      this.rect(x, c.y, c.w, 1, pal.mist);
      this.rect(x + 6, c.y + 1, c.w - 4, 1, pal.mist);
    }
    o.globalAlpha = 1;

    this.drawFarLife(t, spot, pal, light);

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
      // running water carries every streak the same way
      d.x += (spot.flow ? Math.abs(d.v) * spot.flow : d.v) * dt;
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

    this.drawWaterThings(t, spot, light);

    // fireflies over the shore once the light goes; some waters have wisps at any hour
    const glow = spot.wisps ?? ['#e8d77a', '#8f8146'];
    for (const f of light.fireflies || spot.wisps ? this.flies : []) {
      const x = f.x + Math.sin(t * f.sp + f.ph) * 6;
      const y = f.y + Math.sin(t * f.sp * 1.7 + f.ph * 2) * 3;
      const v = Math.sin(t * 2.2 + f.ph * 3);
      if (v < 0.2) continue;
      if (v > 0.75) {
        o.globalAlpha = 0.35;
        this.rect(x - 1, y, 3, 1, glow[0]);
        this.rect(x, y - 1, 1, 3, glow[0]);
        o.globalAlpha = 1;
      }
      this.px(x, y, v > 0.6 ? glow[0] : glow[1]);
    }

    if (spot.mist) {
      // bands of mist drifting over the water
      o.globalAlpha = spot.mist * (light.sun ? 1.6 : 1);
      for (let i = 0; i < 5; i++) {
        const len = 70 + i * 14;
        const x = ((t * (2.5 + i) + i * 61) % (W + len)) - len;
        const y = hz + 2 + i * Math.round((H - hz) / 6) + Math.round(Math.sin(t * 0.3 + i));
        this.rect(x, y, len, 2, pal.mist);
        this.rect(x + 8, y - 1, len - 20, 1, pal.mist);
      }
      o.globalAlpha = 1;
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
        this.px(rp.x + Math.cos(a) * rx, rp.y + Math.sin(a) * ry, light.ripple);
      }
    }
    o.globalAlpha = 1;
    this.ripples = this.ripples.filter((rp) => rp.life > 0);

    // angler, rod, line, bobber
    const a = this.anglerPos();
    const anglerPal = litPal('angler', ANGLER_PAL, time);
    this.sprite(ANGLER, anglerPal, a.x, a.y);
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
    this.curve(bendTip.x, bendTip.y, (bendTip.x + b.x) / 2, Math.max(bendTip.y, top) + sag, b.x, top, light.line);
    o.globalAlpha = 1;
    this.curve(hand.x - 2, hand.y + 2, mx, my, bendTip.x, bendTip.y, (k) => lit(k < 0.35 ? '#4a3424' : '#8a6a44', time), (k) => (k < 0.3 ? 2 : 1));
    // reel
    this.rect(hand.x - 1, hand.y + 2, 2, 2, lit('#8c969b', time));
    this.sprite(['SS'], anglerPal, hand.x - 1, hand.y);

    // bobber (partially under the waterline when floating)
    this.sprite(BOBBER, BOBBER_PAL, b.x - 1, top, false, b.inWater ? Math.round(b.y) + 1 : Infinity);
    if (b.inWater) {
      o.globalAlpha = 0.7;
      this.rect(b.x - 3, b.y + 1, 2, 1, light.ripple);
      this.rect(b.x + 2, b.y + 1, 2, 1, light.ripple);
      o.globalAlpha = 1;
    }
    // the catch dangles under the bobber for a few seconds
    if (this.phase === 'caught' && now - this.phaseAt < 4500) {
      const wig = Math.floor(t * 8) % 2;
      if (this.prizeAt >= this.phaseAt) {
        this.sprite(CATCH_BOTTLE, CATCH_BOTTLE_PAL, b.x - 2 + (Math.floor(t * 5) % 2), top + 6);
        // it glints
        if (Math.floor(t * 6) % 3 === 0) this.px(b.x - 3 + (Math.floor(t * 6) % 5) * 2, top + 5 + (Math.floor(t * 9) % 6), '#fff0a8');
      } else this.sprite(CATCH_FISH, CATCH_PAL, b.x - 4 + wig, top + 6, wig === 1);
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

  /** Lights and movement on the far shore: chimney smoke, the lighthouse lamp, a passing boat. */
  private drawFarLife(t: number, spot: Spot, pal: Palette, light: Light): void {
    const { W, o, time } = this;
    const hz = this.hz;
    const cx = Math.round(W * 0.55);
    if (spot.far === 'cottage') {
      o.globalAlpha = 0.3;
      for (let i = 0; i < 3; i++) {
        const k = (t * 0.5 + i / 3) % 1;
        this.px(cx + 3 + Math.round(Math.sin(k * 5 + i) * 1.5) + k * 3, hz - 13 - k * 9, pal.mist);
      }
      o.globalAlpha = 1;
    }
    if (spot.far === 'lighthouse' && light.lantern) {
      // the lamp sweeps: a beam to one side, then the other, with dark in between
      const k = (t * 0.22) % 1;
      const side = k < 0.3 ? -1 : k > 0.5 && k < 0.8 ? 1 : 0;
      o.globalAlpha = 0.1;
      this.disk(o, cx, hz - 22, 5, '#f6e3a2');
      if (side) for (let i = 2; i < 46; i++) this.rect(cx + side * i, hz - 22 - Math.floor(i / 9), 1, 1 + Math.floor(i / 5), '#f6e3a2');
      o.globalAlpha = 1;
    }
    if (spot.ship === 'trawler') {
      const x = Math.round(W + 20 - ((t * 1.4 + W * 0.5) % (W + 60)));
      const y = hz + 3;
      const hull = lit('#1f2328', time);
      this.rect(x, y, 17, 2, hull);
      this.rect(x + 1, y + 2, 14, 1, hull);
      this.rect(x - 1, y - 1, 3, 1, hull);
      this.rect(x + 9, y - 4, 5, 4, lit('#444b52', time));
      this.rect(x + 10, y - 3, 3, 1, light.lantern ? '#f0c070' : lit('#7a8a94', time));
      this.rect(x + 5, y - 7, 1, 7, hull);
      this.rect(x, y, 17, 1, lit('#8a3a2c', time));
      if (light.lantern) this.px(x + 5, y - 8, Math.sin(t * 3) > 0 ? '#f6e3a2' : '#c2453b');
    }
    if (spot.ship === 'ghost') {
      // a ship that is not quite there
      const x = Math.round(((t * 0.9 + W * 0.45) % (W + 80)) - 40);
      const y = hz + 1;
      o.globalAlpha = 0.2 + 0.08 * Math.sin(t * 0.7);
      const c = pal.mist;
      this.rect(x, y, 26, 3, c);
      this.rect(x + 2, y + 3, 21, 1, c);
      this.rect(x - 2, y - 2, 4, 2, c);
      this.rect(x + 23, y - 3, 4, 3, c);
      for (const [mx, mh] of [
        [7, 17],
        [16, 21],
      ]) {
        this.rect(x + mx, y - mh, 1, mh, c);
        // torn sails: rows with gaps
        for (let j = 2; j < mh - 3; j++) if (j % 6 !== 5) this.rect(x + mx - 4 + ((j * 3) % 2), y - mh + j, 9 - ((j * 5) % 3), 1, c);
      }
      o.globalAlpha = 1;
    }
  }

  /** Lily pads, rocks, stumps, a buoy, a boat adrift. */
  private drawWaterThings(t: number, spot: Spot, light: Light): void {
    const { W, H, o, time } = this;
    const hz = this.hz;
    for (const st of this.stumps) {
      const c = lit('#1a1712', time);
      o.globalAlpha = 0.3;
      this.rect(st.x, st.y + 1, 3, Math.min(5, st.h), c);
      o.globalAlpha = 1;
      this.rect(st.x, st.y - st.h, 3, st.h + 1, c);
      this.px(st.x, st.y - st.h - 1, c);
      this.px(st.x + 2, st.y - st.h - 2, c);
      this.rect(st.x + 3, st.y - st.h + 3, 2, 1, c);
      this.px(st.x + 1, st.y - st.h + 2, lit('#3a3428', time));
      o.globalAlpha = 0.5;
      this.rect(st.x - 1, st.y + (Math.sin(t * 1.3 + st.x) > 0 ? 1 : 0), 5, 1, light.ripple);
      o.globalAlpha = 1;
    }
    for (const rk of this.rocks) {
      for (let j = 0; j < rk.h; j++) {
        const inset = j === 0 ? 2 : j === 1 ? 1 : 0;
        this.rect(rk.x + inset, rk.y - rk.h + j, rk.w - inset * 2, 1, lit(j < 2 ? '#4b535b' : '#2c3136', time));
      }
      this.rect(rk.x + 2, rk.y - rk.h, Math.max(1, rk.w - 6), 1, lit('#737d86', time));
      // water breaking on the rock, and trailing off it where the water runs
      const beat = Math.sin(t * 4 + rk.x) > 0 ? 1 : 0;
      o.globalAlpha = 0.8;
      this.rect(rk.x - 1 - beat, rk.y, rk.w + 2 + beat, 1, light.ripple);
      if (spot.flow) {
        o.globalAlpha = 0.5;
        this.rect(rk.x + rk.w + 1, rk.y - 1 + beat, 4 + beat * 3, 1, light.ripple);
        this.rect(rk.x + rk.w + 4, rk.y + 1, 5 - beat * 2, 1, light.ripple);
      }
      o.globalAlpha = 1;
    }
    for (const l of this.lilies) {
      const y = l.y + (Math.sin(t * 0.8 + l.ph) > 0.6 ? 1 : 0);
      const pad = lit('#22402b', time);
      this.rect(l.x, y, 5, 1, pad);
      this.rect(l.x + 1, y - 1, 3, 1, pad);
      this.px(l.x + 1, y - 1, lit('#3b6846', time));
      if (l.flower && spot.bloom) {
        this.px(l.x + 3, y - 2, spot.bloom);
        this.px(l.x + 3, y - 1, lit('#d9d2c0', time));
      }
    }
    if (spot.buoy) {
      const x = Math.round(W * 0.87);
      const y = Math.round(hz + (H - hz) * 0.24) + (Math.sin(t * 1.5) > 0 ? 1 : 0);
      const lamp = light.lantern && Math.sin(t * 2.4) > 0.3;
      if (lamp) {
        o.globalAlpha = 0.12;
        this.disk(o, x + 1, y - 4, 4, '#ff8a70');
        o.globalAlpha = 1;
      }
      this.sprite(BUOY, { l: lamp ? '#ffb39c' : lit('#3a3f45', time), k: lit('#2a2e33', time), r: lit('#b2392f', time), w: lit('#d9d6cc', time) }, x, y - 5);
      o.globalAlpha = 0.5;
      this.rect(x - 1, y, 5, 1, light.ripple);
      o.globalAlpha = 1;
    }
    if (spot.skiff) {
      const x = Math.round(W * 0.48 + Math.sin(t * 0.06) * W * 0.12);
      const y = Math.round(hz + (H - hz) * 0.2) + (Math.sin(t * 1.1) > 0 ? 1 : 0);
      const c = lit('#3a4254', time);
      this.rect(x, y, 15, 1, c);
      this.rect(x + 1, y + 1, 13, 1, c);
      this.px(x - 1, y - 1, c);
      this.px(x + 15, y - 1, c);
      o.globalAlpha = 0.35;
      this.rect(x - 2, y + 2, 19, 1, light.ripple);
      o.globalAlpha = 1;
    }
  }

  /** Where the angler stands: a pier, a boat, a quay, a rock ledge, a river bank or a sagging boardwalk. */
  private drawPier(t: number): void {
    const { H } = this;
    const time = this.time;
    const light = LIGHTS[time];
    const deck = this.deckY;
    const end = this.pierEnd;
    const lap = Math.sin(t * 2) > 0 ? 1 : 0;
    const c = (hexColor: string): string => lit(hexColor, time);
    switch (this.spot.stand) {
      case 'pier':
        // posts
        for (let x = end - 4; x > -4; x -= 14) {
          this.rect(x, deck + 3, 3, H - deck, c('#22180f'));
          this.rect(x, deck + 3, 1, H - deck, c('#3a2a1b'));
          // water line around the post
          this.rect(x - 1, deck + 9 + (Math.sin(t * 2 + x) > 0 ? 1 : 0), 5, 1, c('#3d525a'));
        }
        // deck: lit top edge, planks, dark underside
        this.rect(0, deck, end, 1, c('#7a6044'));
        this.rect(0, deck + 1, end, 2, c('#5a4430'));
        this.rect(0, deck + 3, end, 1, c('#2a1f15'));
        for (let x = end - 6; x > 0; x -= 6) this.rect(x, deck + 1, 1, 2, c('#3f2f20'));
        break;
      case 'boardwalk': {
        // old planks on crooked posts, one plank gone
        let i = 0;
        for (let x = end - 4; x > -4; x -= 13, i++) {
          const up = i % 2 ? 3 : 0;
          this.rect(x + (i % 3 === 1 ? 1 : 0), deck - up, 2, H - deck + up, c('#1c1811'));
          this.rect(x - 1, deck + 9 + (Math.sin(t * 2 + x) > 0 ? 1 : 0), 4, 1, c('#3d4a44'));
        }
        const gap = [end - 21, end - 16];
        for (let x = 0, n = 0; x < end; x += 6, n++) {
          if (x >= gap[0] && x < gap[1]) continue;
          const sag = (n * 5) % 4 === 0 ? 1 : 0;
          const w = Math.min(5, end - x);
          this.rect(x, deck + sag, w, 1, c('#6a6252'));
          this.rect(x, deck + 1 + sag, w, 2, c('#474034'));
          this.rect(x, deck + 3 + sag, w, 1, c('#211d16'));
        }
        break;
      }
      case 'quay': {
        // a stone harbour wall with a mooring bollard
        this.rect(0, deck + 1, end, H - deck, c('#383d43'));
        for (let y = deck + 6, row = 0; y < H; y += 6, row++) {
          this.rect(0, y, end, 1, c('#272b30'));
          for (let x = end - 7 - (row % 2) * 5; x > 0; x -= 11) this.rect(x, y - 5, 1, 5, c('#272b30'));
        }
        this.rect(0, deck, end, 1, c('#8a9096'));
        this.rect(end - 1, deck + 1, 1, H - deck, c('#1f2327'));
        this.rect(end - 15, deck - 3, 3, 3, c('#16191c'));
        this.rect(end - 16, deck - 4, 5, 1, c('#2a2e33'));
        this.o.globalAlpha = 0.6;
        this.rect(end, deck + 9 + lap, 4, 1, light.ripple);
        this.o.globalAlpha = 1;
        break;
      }
      case 'ledge':
        // a shelf of rock over the rapids
        for (let x = 0; x < end + 4; x++) {
          const top = deck + (x > end - 2 ? (x - end + 2) * 2 : 0) + ((x * 7) % 11 === 0 ? 1 : 0);
          this.rect(x, top, 1, H - top, c('#33373c'));
          this.px(x, top, c(x % 6 < 2 ? '#3f5a3c' : '#6a7178'));
          if (x % 9 === 4) this.rect(x, top + 3, 1, 5, c('#23272b'));
          if (x % 13 === 7) this.rect(x, top + 9, 2, 1, c('#4b535b'));
        }
        this.o.globalAlpha = 0.7;
        this.rect(end + 3, deck + 9 + lap, 5, 1, light.ripple);
        this.rect(end + 5, deck + 12 - lap, 4, 1, light.ripple);
        this.o.globalAlpha = 1;
        break;
      case 'bank':
        // a grassy river bank
        for (let x = 0; x < end + 3; x++) {
          const top = deck + (x > end - 3 ? x - end + 3 : 0);
          this.rect(x, top + 2, 1, H - top, c('#3a2c1e'));
          this.rect(x, top, 1, 2, c('#3e5c38'));
          if (x % 5 === 1) this.px(x, top - 1, c('#4f7446'));
          if (x % 7 === 3) this.rect(x, top - 2, 1, 2, c('#4f7446'));
          if (x % 8 === 5) this.px(x, top + 6, c('#5a4732'));
          if (x % 11 === 2) this.rect(x, top + 10, 2, 1, c('#2a1f15'));
        }
        this.o.globalAlpha = 0.6;
        this.rect(end + 3, deck + 9 + lap, 4, 1, light.ripple);
        this.o.globalAlpha = 1;
        break;
      case 'boat': {
        // a rowing boat: the angler stands in it
        const x0 = Math.max(0, end - 46);
        const x1 = end + 7;
        this.rect(x0, deck, x1 - x0, 1, c('#8a6a44'));
        this.rect(x0 + 1, deck + 1, x1 - x0 - 2, 2, c('#5a4430'));
        this.rect(x0 + 3, deck + 3, x1 - x0 - 6, 2, c('#3f2f20'));
        this.rect(x0 + 6, deck + 5, x1 - x0 - 12, 1, c('#2a1f15'));
        this.px(x1, deck - 1, c('#8a6a44'));
        this.px(x1 + 1, deck - 2, c('#8a6a44'));
        this.px(x0 - 1, deck - 1, c('#8a6a44'));
        this.rect(end - 21, deck - 1, 6, 1, c('#6a5238'));
        // an oar over the side
        for (let k = 0; k < 9; k++) this.px(end - 14 - Math.round(k * 1.4), deck - 2 + k, c('#7a6044'));
        this.rect(end - 28, deck + 7, 2, 2, c('#7a6044'));
        this.o.globalAlpha = 0.45;
        this.rect(x0 + 2 - lap, deck + 6, x1 - x0 - 4 + lap * 2, 1, light.ripple);
        this.o.globalAlpha = 1;
        break;
      }
    }
    // tackle box + lantern
    const bx = Math.max(4, end - 30);
    this.rect(bx, deck - 4, 7, 4, lit('#4a5a4c', time));
    this.rect(bx, deck - 4, 7, 1, lit('#62746a', time));
    this.rect(bx + 3, deck - 3, 1, 1, '#b8a071');
    const lx = Math.max(2, end - 40);
    const flick = Math.sin(t * 9) > 0.85 ? 1 : 0;
    if (!light.lantern) {
      // unlit by day
      this.sprite(LANTERN, LANTERN_OFF_PAL, lx, deck - 5);
      return;
    }
    this.o.globalAlpha = 0.07;
    this.disk(this.o, lx + 1, deck - 3, 10 + flick, '#f0c070');
    this.o.globalAlpha = 0.09;
    this.disk(this.o, lx + 1, deck - 3, 6, '#f0c070');
    this.o.globalAlpha = 1;
    this.sprite(LANTERN, LANTERN_PAL, lx, deck - 5);
    if (this.spot.stand !== 'pier' && this.spot.stand !== 'boardwalk') return;
    // lantern reflection on the water next to the pier
    this.o.globalAlpha = 0.4;
    this.rect(lx - 1, deck + 6 + (Math.sin(t * 2.5) > 0 ? 1 : 0), 4, 1, '#c99a4e');
    this.o.globalAlpha = 1;
  }

  /** The near shore in the right corner: reeds, boulders or a dead tree. */
  private drawReeds(t: number): void {
    const { W, H, time } = this;
    const c = (hexColor: string): string => lit(hexColor, time);
    const shore = this.spot.shore;
    if (shore === 'none') return;
    if (shore === 'boulders') {
      this.disk(this.o, W - 9, H - 1, 9, c('#22262a'));
      this.disk(this.o, W - 24, H, 5, c('#2c3136'));
      this.rect(W - 14, H - 10, 6, 1, c('#59616a'));
      this.rect(W - 26, H - 5, 3, 1, c('#59616a'));
      this.o.globalAlpha = 0.6;
      this.rect(W - 32, H - 2 + (Math.sin(t * 3) > 0 ? 1 : 0), 4, 1, LIGHTS[time].ripple);
      this.o.globalAlpha = 1;
      return;
    }
    if (shore === 'snag') {
      // a dead tree leaning over the water, moss hanging from it
      const x = W - 8;
      const dark = c('#0f130e');
      this.rect(x, H - 52, 3, 52, dark);
      this.rect(x - 1, H - 20, 5, 20, dark);
      for (let k = 1; k < 22; k++) this.rect(x - k, H - 40 - Math.floor(k / 3), 1, k < 8 ? 2 : 1, dark);
      for (let k = 1; k < 13; k++) this.px(x - k, H - 26 - Math.floor(k / 2), dark);
      const sway = Math.sin(t * 0.7) > 0.5 ? 1 : 0;
      [5, 10, 15, 19].forEach((k, i) => {
        const top = H - 39 - Math.floor(k / 3);
        for (let j = 0; j < 5 + ((i * 3) % 4); j += 1) if (j % 3 !== 2) this.px(x - k + (j > 3 ? sway : 0), top + j, c('#2f4a2c'));
      });
      this.rect(W - 16, H - 3, 16, 3, c('#0c100b'));
      return;
    }
    const sway = Math.sin(t * 0.9) > 0.4 ? 1 : 0;
    const reeds: [number, number][] = [
      [W - 5, 22],
      [W - 9, 16],
      [W - 13, 26],
      [W - 17, 12],
    ];
    for (const [x, h] of reeds) {
      this.rect(x, H - h + 4, 1, h, c('#121a15'));
      this.rect(x + sway, H - h, 1, 5, c('#121a15'));
      if (h > 14) this.rect(x + sway - 0, H - h + 1, 2, 4, c('#3a2c22'));
    }
    this.rect(W - 20, H - 4, 20, 4, c('#0d1310'));
  }
}
