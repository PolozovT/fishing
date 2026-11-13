/** Pixel fish drawn from a few shape parameters per species. Faces right; 28×18 art pixels. */
import { SPECIES } from '../game/content';

const NS = 'http://www.w3.org/2000/svg';
const W = 28;
const H = 18;

type Pattern = 'plain' | 'bars' | 'spots' | 'patches' | 'band' | 'scales';
interface Shape {
  /** Body length in pixels. */
  len: number;
  /** Half height at the thickest point. */
  half: number;
  pattern: Pattern;
  whiskers?: boolean;
  /** Long snout (pike, gar). */
  snout?: boolean;
  /** Tall first dorsal fin (perch, grayling). */
  sail?: boolean;
  /** Flat, wide body (bream, halibut). */
  flat?: boolean;
  ghost?: boolean;
}

const S = (len: number, half: number, pattern: Pattern = 'plain', extra: Partial<Shape> = {}): Shape => ({ len, half, pattern, ...extra });

/** By species id. */
const SHAPES: Shape[] = [
  S(13, 3), // Roach
  S(13, 4, 'scales'), // Crucian Carp
  S(13, 3, 'bars', { sail: true }), // Perch
  S(15, 4), // Tench
  S(16, 4, 'scales'), // Golden Carp
  S(20, 2, 'spots', { snout: true }), // Pike
  S(16, 3, 'spots'), // Trout
  S(18, 3, 'bars', { sail: true }), // Zander
  S(14, 3, 'band', { sail: true }), // Grayling
  S(21, 3, 'spots'), // Taimen
  S(15, 5, 'plain', { flat: true }), // Bream
  S(19, 2, 'patches', { whiskers: true }), // Burbot
  S(15, 3), // Whitefish
  S(22, 4, 'plain', { whiskers: true }), // Wels Catfish
  S(18, 3, 'band', { ghost: true }), // Lake Spirit
  S(12, 2), // Herring
  S(18, 3, 'spots', { whiskers: true }), // Cod
  S(20, 3, 'spots'), // Atlantic Salmon
  S(18, 6, 'spots', { flat: true }), // Halibut
  S(22, 5, 'band'), // Bluefin Tuna
  S(17, 4, 'patches'), // Golden Koi
  S(22, 5, 'bars', { whiskers: true }), // Ancient Catfish
  S(17, 3, 'plain', { ghost: true, sail: true }), // Ghost Fish
  S(12, 3, 'scales'), // Gilded Rudd
  S(17, 5, 'scales'), // Mirror Carp
  S(12, 4, 'bars', { sail: true }), // Sun Perch
  S(22, 3, 'scales', { snout: true }), // Amber Sturgeon
  S(17, 3, 'band'), // Bowfin
  S(19, 3, 'patches'), // Snakehead
  S(22, 1, 'plain'), // Swamp Eel
  S(22, 3, 'spots', { snout: true }), // Alligator Gar
  S(22, 1, 'band'), // Moon Eel
  S(20, 2, 'bars', { snout: true }), // Lantern Pike
  S(19, 3, 'band', { ghost: true }), // Wraith Salmon
  S(22, 3, 'scales', { snout: true, ghost: true }), // Spectral Sturgeon
  S(20, 2, 'plain', { snout: true }), // Albino Pike
];

const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;
function shade(c: number, k: number): string {
  const ch = (v: number): number => Math.max(0, Math.min(255, Math.round(k >= 0 ? v + (255 - v) * k : v * (1 + k))));
  return hex((ch((c >> 16) & 255) << 16) | (ch((c >> 8) & 255) << 8) | ch(c & 255));
}

interface Opts {
  /** Undiscovered: a flat dark shape. */
  silhouette?: boolean;
  label?: string;
}

export function fishSprite(speciesId: number, opts: Opts = {}): SVGSVGElement {
  const sp = SPECIES[speciesId];
  const sh = SHAPES[speciesId] ?? S(14, 3);
  const c = sp?.color ?? 0x8b9196;
  const px = new Map<string, string>();
  const set = (x: number, y: number, col: string): void => {
    if (x >= 0 && x < W && y >= 0 && y < H) px.set(`${x},${y}`, col);
  };
  const dark = shade(c, -0.45);
  const mid = hex(c);
  const light = shade(c, 0.3);
  const belly = shade(c, 0.6);
  const cy = 9;
  const x1 = W - 3; // nose
  const x0 = x1 - sh.len; // tail root
  const halfAt = (x: number): number => {
    const t = (x - x0) / sh.len; // 0 tail … 1 nose
    const peak = sh.flat ? 0.5 : 0.62;
    const k = t < peak ? t / peak : (1 - t) / (1 - peak);
    const curve = Math.sqrt(Math.max(0, k));
    const min = t < peak ? 0.6 : sh.snout ? 0 : 0.4;
    return Math.max(min, sh.half * (t < peak ? 0.35 + 0.65 * curve : sh.snout ? k ** 1.4 : curve));
  };
  // body
  for (let x = x0; x <= x1; x++) {
    const hf = Math.round(halfAt(x));
    for (let dy = -hf; dy <= hf; dy++) {
      let col = mid;
      if (dy === -hf && hf > 0) col = dark;
      else if (dy < 0 && dy <= -hf + 1 && hf > 2) col = shade(c, -0.2);
      else if (dy === hf && hf > 0) col = belly;
      else if (dy > 0 && dy >= hf - 1 && hf > 2) col = light;
      set(x, cy + dy, col);
    }
  }
  // pattern
  const body = (x: number, y: number): boolean => px.has(`${x},${y}`);
  if (sh.pattern === 'bars') {
    for (let x = x0 + 3; x < x1 - 3; x += 3) for (let dy = -sh.half; dy <= 0; dy++) if (body(x, cy + dy)) set(x, cy + dy, dark);
  } else if (sh.pattern === 'spots') {
    for (let x = x0 + 2; x < x1 - 3; x += 2) {
      const y = cy - 1 + ((x * 7) % 3) - 1;
      if (body(x, y) && body(x, y - 1)) set(x, y, dark);
    }
  } else if (sh.pattern === 'patches') {
    for (let x = x0 + 2; x < x1 - 2; x++) {
      const on = Math.floor((x - x0) / 3) % 2 === 0;
      if (!on) continue;
      for (let dy = -sh.half; dy <= sh.half; dy++) if (body(x, cy + dy) && (x + dy) % 2 === 0) set(x, cy + dy, speciesId === 20 ? '#f7f1e3' : dark);
    }
    if (speciesId === 20) for (let x = x0 + 5; x < x0 + 9; x++) for (let dy = -sh.half + 1; dy <= 0; dy++) if (body(x, cy + dy)) set(x, cy + dy, '#d2562e');
  } else if (sh.pattern === 'band') {
    for (let x = x0 + 1; x < x1 - 2; x++) if (body(x, cy)) set(x, cy, light);
  } else if (sh.pattern === 'scales') {
    for (let x = x0 + 2; x < x1 - 3; x++) for (let dy = -sh.half + 1; dy < sh.half; dy++) if (body(x, cy + dy) && (x + dy * 2) % 4 === 0) set(x, cy + dy, light);
  }
  // tail fin
  const tf = Math.max(2, Math.min(5, sh.half + 1));
  for (let i = 1; i <= 3; i++) {
    const spread = Math.round((tf * i) / 3);
    for (let dy = -spread; dy <= spread; dy++) if (i < 3 || Math.abs(dy) >= spread - 1) set(x0 - i, cy + dy, i === 3 ? dark : shade(c, -0.25));
  }
  // dorsal and pelvic fins
  const dx = x0 + Math.round(sh.len * 0.5);
  const top = cy - Math.round(halfAt(dx));
  const finH = sh.sail ? 3 : 1;
  for (let i = 0; i < (sh.sail ? 5 : 4); i++) for (let k = 1; k <= Math.max(1, finH - Math.abs(i - 2) + (sh.sail ? 0 : 0)); k++) set(dx - 2 + i, top - k, shade(c, -0.3));
  const bot = cy + Math.round(halfAt(dx));
  set(dx, bot + 1, shade(c, -0.3));
  set(dx + 1, bot + 1, shade(c, -0.3));
  set(x0 + Math.round(sh.len * 0.25), cy + Math.round(halfAt(x0 + Math.round(sh.len * 0.25))) + 1, shade(c, -0.3));
  // eye
  const ex = x1 - (sh.snout ? 5 : 3);
  const ey = cy - (sh.half > 2 ? 1 : 0);
  set(ex, ey, '#f4f1e8');
  set(ex + 1, ey, '#15171a');
  if (sh.whiskers) {
    set(x1 + 1, cy + 1, dark);
    set(x1 + 2, cy + 2, dark);
    set(x1, cy + 2, dark);
    set(x1 - 1, cy + 3, dark);
  }

  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.setAttribute('class', `pxi fish-sprite${sh.ghost && !opts.silhouette ? ' ghostly' : ''}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', opts.label ?? (opts.silhouette ? 'Undiscovered fish' : sp?.name ?? 'Fish'));
  for (const [k, col] of px) {
    const [x, y] = k.split(',');
    const r = document.createElementNS(NS, 'rect');
    r.setAttribute('x', x);
    r.setAttribute('y', y);
    r.setAttribute('width', '1');
    r.setAttribute('height', '1');
    r.setAttribute('fill', opts.silhouette ? '#2a3137' : col);
    svg.append(r);
  }
  return svg;
}

/** The sprite in the square framed slot used by cards. */
export function fishArt(speciesId: number, opts: Opts & { cls?: string } = {}): HTMLElement {
  const el = document.createElement('div');
  el.className = `nft-img fish-art ${opts.cls ?? ''}`;
  el.append(fishSprite(speciesId, opts));
  return el;
}
