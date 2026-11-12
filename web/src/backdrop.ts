// Fixed, very dark pixel-art forest behind the whole page (pure decoration, drawn once per resize).

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
    c.fillStyle = '#101215';
    c.fillRect(0, 0, W, H);
    const r = rng(42);
    // a few dim stars in the upper band
    for (let i = 0; i < W * 0.25; i++) {
      c.fillStyle = r() < 0.2 ? '#2a2f35' : '#1b1f24';
      c.fillRect(Math.floor(r() * W), Math.floor(r() * Math.min(40, H * 0.25)), 1, 1);
    }
    // upper forest band (like a hero treeline), stepped fog bands between layers
    const top = Math.min(70, Math.round(H * 0.32));
    treeline(c, r, W, top - 6, 6, 14, 5, '#15181c', 6);
    c.fillStyle = 'rgba(40,46,52,0.12)';
    c.fillRect(0, top - 10, W, 3);
    treeline(c, r, W, top, 10, 22, 9, '#121518', 4);
    // fade the upper band back into the page colour in hard steps
    const steps = ['#111316', '#101215'];
    steps.forEach((col, i) => {
      c.fillStyle = col;
      c.fillRect(0, top + 4 + i * 3, W, H);
    });
    // bottom forest, darkest
    treeline(c, r, W, H - 2, 8, 20, 7, '#13161a', 2);
    treeline(c, r, W, H + 2, 12, 30, 13, '#0d0f12', 2);
  };
  let raf = 0;
  window.addEventListener('resize', () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(draw);
  });
  draw();
}
