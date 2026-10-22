// Canvas water scene: rod, line, bobber, ripples, splash. Pure presentation — driven by setPhase().

export type Phase = 'idle' | 'casting' | 'waiting' | 'bite' | 'reeling' | 'caught' | 'missed';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  r: number;
}
interface Ripple {
  x: number;
  y: number;
  r: number;
  a: number;
}
interface Swimmer {
  x: number;
  y: number;
  v: number;
  s: number;
  phase: number;
}

const PALETTES: { sky: [string, string]; water: [string, string]; shore: string }[] = [
  { sky: ['#0b1f3d', '#1c4a72'], water: ['#0f4c75', '#06203d'], shore: '#0b2a24' }, // pond
  { sky: ['#0a1d33', '#1d5160'], water: ['#0f5a66', '#062633'], shore: '#0a2b1c' }, // forest river
  { sky: ['#0a1430', '#23305e'], water: ['#123a7a', '#050f2e'], shore: '#141a33' }, // deep lake
  { sky: ['#08121f', '#2a3f55'], water: ['#1a4560', '#040e1a'], shore: '#1d2833' }, // northern sea
  { sky: ['#140f26', '#45304f'], water: ['#165266', '#061722'], shore: '#1f1424' }, // taimen rapids
];

export class WaterScene {
  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private t0 = performance.now();
  private phase: Phase = 'idle';
  private phaseAt = performance.now();
  private particles: Particle[] = [];
  private ripples: Ripple[] = [];
  private swimmers: Swimmer[] = [];
  private stars: { x: number; y: number; r: number; tw: number }[] = [];
  private palette = 0;
  private lastRipple = 0;
  private bobberColor = '#ff4d4d';

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is not available');
    this.ctx = ctx;
    for (let i = 0; i < 60; i++) this.stars.push({ x: Math.random(), y: Math.random(), r: Math.random() * 1.3 + 0.2, tw: Math.random() * 6 });
    for (let i = 0; i < 6; i++)
      this.swimmers.push({ x: Math.random(), y: 0.55 + Math.random() * 0.4, v: (Math.random() * 0.02 + 0.01) * (Math.random() < 0.5 ? -1 : 1), s: Math.random() * 0.6 + 0.6, phase: Math.random() * 6 });
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
    this.phase = p;
    this.phaseAt = performance.now();
    const b = this.bobberPos(performance.now());
    if (p === 'caught') this.splash(b.x, b.y, 70, 1.4);
    if (p === 'missed') this.splash(b.x, b.y, 22, 0.7);
    if (p === 'bite') this.splash(b.x, b.y, 14, 0.5);
  }

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = Math.max(1, rect.width);
    this.h = Math.max(1, rect.height);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.particles = [];
    this.ripples = [];
  }

  private get horizon(): number {
    return this.h * 0.38;
  }
  private rodBase(): { x: number; y: number } {
    return { x: this.w * 0.06, y: this.h * 1.02 };
  }
  private rodTip(now: number): { x: number; y: number } {
    const since = (now - this.phaseAt) / 1000;
    let bend = 0;
    if (this.phase === 'casting') bend = Math.sin(Math.min(1, since / 0.5) * Math.PI) * -0.08;
    if (this.phase === 'bite') bend = 0.05 + Math.sin(now / 90) * 0.02;
    if (this.phase === 'reeling') bend = 0.09 + Math.sin(now / 60) * 0.015;
    return { x: this.w * (0.3 + bend * 0.3), y: this.h * (0.22 + bend) };
  }
  private target(): { x: number; y: number } {
    return { x: this.w * 0.64, y: this.horizon + (this.h - this.horizon) * 0.38 };
  }

  private bobberPos(now: number): { x: number; y: number; visible: boolean } {
    const tip = this.rodTip(now);
    const tg = this.target();
    const since = (now - this.phaseAt) / 1000;
    switch (this.phase) {
      case 'idle':
        return { x: tip.x, y: tip.y + 40, visible: true };
      case 'casting': {
        const k = Math.min(1, since / 0.9);
        const x = tip.x + (tg.x - tip.x) * k;
        const y = tip.y + 40 + (tg.y - tip.y - 40) * k - Math.sin(k * Math.PI) * this.h * 0.25;
        return { x, y, visible: true };
      }
      case 'waiting':
        return { x: tg.x + Math.sin(now / 1300) * 3, y: tg.y + Math.sin(now / 420) * 2.5, visible: true };
      case 'bite':
        return { x: tg.x + Math.sin(now / 70) * 2, y: tg.y + 6 + Math.abs(Math.sin(now / 160)) * 7, visible: true };
      case 'reeling': {
        const k = Math.min(1, since / 2.5);
        return { x: tg.x + (tip.x + 30 - tg.x) * k * 0.5 + Math.sin(now / 50) * 3, y: tg.y + 4 + Math.sin(now / 80) * 3, visible: true };
      }
      case 'caught':
      case 'missed': {
        const k = Math.min(1, since / 0.6);
        return { x: tg.x + (tip.x - tg.x) * k, y: tg.y + (tip.y + 40 - tg.y) * k - Math.sin(k * Math.PI) * 50, visible: true };
      }
    }
  }

  private splash(x: number, y: number, n: number, power: number): void {
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
      const sp = (Math.random() * 3 + 1.5) * power;
      this.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1, r: Math.random() * 2.5 + 1 });
    }
    this.ripples.push({ x, y, r: 4, a: 0.9 }, { x, y, r: 12, a: 0.6 });
  }

  private draw(now: number): void {
    const { ctx, w, h } = this;
    const t = (now - this.t0) / 1000;
    const pal = PALETTES[this.palette];
    const hz = this.horizon;

    // sky
    const sky = ctx.createLinearGradient(0, 0, 0, hz);
    sky.addColorStop(0, pal.sky[0]);
    sky.addColorStop(1, pal.sky[1]);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, hz + 1);
    for (const s of this.stars) {
      ctx.globalAlpha = 0.35 + 0.35 * Math.sin(t * 1.5 + s.tw);
      ctx.fillStyle = '#dbeafe';
      ctx.beginPath();
      ctx.arc(s.x * w, s.y * hz * 0.8, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    // moon
    const mx = w * 0.82;
    const my = hz * 0.32;
    const glow = ctx.createRadialGradient(mx, my, 4, mx, my, 60);
    glow.addColorStop(0, 'rgba(255,248,220,0.5)');
    glow.addColorStop(1, 'rgba(255,248,220,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(mx - 60, my - 60, 120, 120);
    ctx.fillStyle = '#fdf6d8';
    ctx.beginPath();
    ctx.arc(mx, my, 16, 0, Math.PI * 2);
    ctx.fill();

    // shoreline (trees / hills)
    ctx.fillStyle = pal.shore;
    ctx.beginPath();
    ctx.moveTo(0, hz);
    for (let x = 0; x <= w; x += 14) {
      const n = Math.sin(x * 0.013 + this.palette) * 10 + Math.sin(x * 0.041) * 6 + (this.palette === 3 ? -8 : 0);
      const tree = this.palette === 1 || this.palette === 4 ? (x / 14) % 2 === 0 ? 12 : 0 : 0;
      ctx.lineTo(x, hz - 16 - n - tree);
    }
    ctx.lineTo(w, hz);
    ctx.closePath();
    ctx.fill();

    // water
    const water = ctx.createLinearGradient(0, hz, 0, h);
    water.addColorStop(0, pal.water[0]);
    water.addColorStop(1, pal.water[1]);
    ctx.fillStyle = water;
    ctx.fillRect(0, hz, w, h - hz);
    // moon reflection
    for (let i = 0; i < 14; i++) {
      const yy = hz + 6 + i * 9;
      const ww = 30 - i * 1.5 + Math.sin(t * 2 + i) * 6;
      ctx.fillStyle = `rgba(253,246,216,${0.18 - i * 0.011})`;
      ctx.fillRect(mx - ww / 2 + Math.sin(t * 1.3 + i * 0.7) * 4, yy, ww, 2);
    }
    // fish silhouettes
    for (const f of this.swimmers) {
      f.x += f.v / 60;
      if (f.x > 1.15) f.x = -0.15;
      if (f.x < -0.15) f.x = 1.15;
      const fx = f.x * w;
      const fy = hz + (h - hz) * (f.y - 0.38) / 0.62 + Math.sin(t + f.phase) * 4;
      const dir = Math.sign(f.v);
      ctx.fillStyle = 'rgba(2,10,25,0.35)';
      ctx.beginPath();
      ctx.ellipse(fx, fy, 16 * f.s, 5 * f.s, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(fx - dir * 14 * f.s, fy);
      ctx.lineTo(fx - dir * 24 * f.s, fy - 6 * f.s + Math.sin(t * 8 + f.phase) * 2);
      ctx.lineTo(fx - dir * 24 * f.s, fy + 6 * f.s + Math.sin(t * 8 + f.phase) * 2);
      ctx.fill();
    }
    // wave lines
    ctx.lineWidth = 1;
    for (let i = 0; i < 9; i++) {
      const yy = hz + 8 + ((h - hz) / 9) * i;
      ctx.strokeStyle = `rgba(160,220,255,${0.06 + i * 0.008})`;
      ctx.beginPath();
      for (let x = 0; x <= w; x += 8) {
        const y = yy + Math.sin(x * 0.02 + t * (0.8 + i * 0.1) + i) * (1.5 + i * 0.4);
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // rod + line + bobber
    const base = this.rodBase();
    const tip = this.rodTip(now);
    const b = this.bobberPos(now);
    ctx.strokeStyle = '#7a4f2a';
    ctx.lineCap = 'round';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(base.x, base.y);
    ctx.quadraticCurveTo(base.x + (tip.x - base.x) * 0.55, base.y + (tip.y - base.y) * 0.45, tip.x, tip.y);
    ctx.stroke();
    ctx.strokeStyle = '#c99a5b';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    // reel
    ctx.fillStyle = '#b8c4d0';
    ctx.beginPath();
    ctx.arc(base.x + (tip.x - base.x) * 0.18, base.y + (tip.y - base.y) * 0.18 + 8, 9, 0, Math.PI * 2);
    ctx.fill();

    const inWater = this.phase === 'waiting' || this.phase === 'bite' || this.phase === 'reeling';
    ctx.strokeStyle = 'rgba(230,240,255,0.7)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y);
    const sag = inWater ? 50 : 15;
    ctx.quadraticCurveTo((tip.x + b.x) / 2, Math.max(tip.y, b.y) + (this.phase === 'reeling' || this.phase === 'bite' ? 5 : sag), b.x, b.y - 6);
    ctx.stroke();

    if (inWater && now - this.lastRipple > (this.phase === 'bite' ? 260 : 1100)) {
      this.ripples.push({ x: b.x, y: b.y + 2, r: 4, a: this.phase === 'bite' ? 0.8 : 0.45 });
      this.lastRipple = now;
    }
    for (const r of this.ripples) {
      r.r += 0.6;
      r.a -= 0.008;
      ctx.strokeStyle = `rgba(200,235,255,${Math.max(0, r.a)})`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.ellipse(r.x, r.y, r.r * 1.8, r.r * 0.5, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    this.ripples = this.ripples.filter((r) => r.a > 0);

    if (b.visible) {
      // bobber: red top, white bottom; partially submerged in water
      const sub = inWater ? (this.phase === 'bite' ? 0.65 : 0.35) : 0;
      ctx.save();
      if (sub > 0) {
        ctx.beginPath();
        ctx.rect(b.x - 12, b.y - 30, 24, 30 - 9 * sub + 6);
        ctx.clip();
      }
      ctx.fillStyle = '#f5f5f5';
      ctx.beginPath();
      ctx.ellipse(b.x, b.y, 6, 8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = this.bobberColor;
      ctx.beginPath();
      ctx.ellipse(b.x, b.y - 3, 6, 5, 0, Math.PI, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(b.x - 1, b.y - 16, 2, 9);
      ctx.restore();
    }

    // particles
    for (const p of this.particles) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.15;
      p.life -= 0.018;
      ctx.fillStyle = `rgba(210,240,255,${Math.max(0, p.life)})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    this.particles = this.particles.filter((p) => p.life > 0);
  }
}
