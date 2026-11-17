// Fixed, faint pixel-art forest behind the whole page (pure decoration, redrawn on resize and when the theme changes).
import { onTimeChange, timeOfDay } from './daytime';

const PX = 4; // CSS px per art pixel

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

function pine(c: CanvasRenderingContext2D, x: number, base: number, h: number): void {
  const tier = Math.max(3, Math.round(h / 3));
  c.fillRect(x, base - h - 1, 1, 2);
  for (let j = 0; j < h; j++) {
    const t = Math.floor(j / tier);
    const half = Math.floor((j % tier) * 0.7) + t;
    c.fillRect(x - half, base - h + j, half * 2 + 1, 1);
  }
}

function treeline(c: CanvasRenderingContext2D, r: () => number, W: number, base: number, hMin: number, hMax: number, gap: number, color: string, fillBelow: number): void {
  c.fillStyle = color;
  let x = -4 + r() * gap;
  while (x < W + 4) {
    pine(c, Math.round(x), base, Math.round(hMin + r() * (hMax - hMin)));
    x += gap * (0.5 + r());
  }
  c.fillRect(0, base, W, fillBelow);
}

type Rgb = [number, number, number];
function cssColor(name: string, fallback: string): Rgb {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  const n = parseInt(v.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const mix = (a: Rgb, b: Rgb, k: number): string => `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * k)).join(',')})`;

export function initBackdrop(): void {
  const cv = document.createElement('canvas');
  cv.className = 'backdrop';
  cv.setAttribute('aria-hidden', 'true');
  document.body.prepend(cv);
  const c = cv.getContext('2d')!;

  const draw = (): void => {
    const W = Math.ceil(window.innerWidth / PX);
    const H = Math.ceil(window.innerHeight / PX);
    cv.width = W;
    cv.height = H;
    // every colour is the page colour nudged towards the text or the deep colour, so it follows the theme
    const bg = cssColor('--bg', '#0c1424');
    const fg = cssColor('--text', '#e8eef7');
    const deep = cssColor('--bg-deep', '#070d19');
    const dark = timeOfDay() === 'night' || timeOfDay() === 'evening';
    c.fillStyle = mix(bg, fg, 0);
    c.fillRect(0, 0, W, H);
    const r = rng(42);
    // a few dim stars in the upper band (the draws stay so the forest is the same in every theme)
    for (let i = 0; i < W * 0.25; i++) {
      c.fillStyle = mix(bg, fg, r() < 0.2 ? 0.12 : 0.05);
      const x = Math.floor(r() * W);
      const y = Math.floor(r() * Math.min(40, H * 0.25));
      if (dark) c.fillRect(x, y, 1, 1);
    }
    // upper forest band (like a hero treeline), stepped fog bands between layers
    const top = Math.min(70, Math.round(H * 0.32));
    treeline(c, r, W, top - 6, 6, 14, 5, mix(bg, fg, dark ? 0.03 : 0.05), 6);
    c.fillStyle = mix(bg, fg, dark ? 0.045 : 0.02);
    c.fillRect(0, top - 10, W, 3);
    treeline(c, r, W, top, 10, 22, 9, mix(bg, fg, dark ? 0.015 : 0.03), 4);
    // fade the upper band back into the page colour in hard steps
    [0.008, 0].forEach((k, i) => {
      c.fillStyle = mix(bg, fg, k);
      c.fillRect(0, top + 4 + i * 3, W, H);
    });
    // bottom forest, strongest
    treeline(c, r, W, H - 2, 8, 20, 7, mix(bg, dark ? fg : deep, dark ? 0.03 : 0.5), 2);
    treeline(c, r, W, H + 2, 12, 30, 13, mix(bg, deep, dark ? 0.6 : 1), 2);
  };
  let raf = 0;
  const redraw = (): void => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(draw);
  };
  window.addEventListener('resize', redraw);
  onTimeChange(redraw);
  draw();
}
