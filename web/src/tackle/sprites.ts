/** Pixel sprites for the Tackle page: rods drawn along a diagonal, lures from character grids. */

const NS = 'http://www.w3.org/2000/svg';

type Rect = [number, number, number, number, string];

function svg(w: number, hgt: number, rects: Rect[], scale: number, label: string): SVGSVGElement {
  const el = document.createElementNS(NS, 'svg');
  el.setAttribute('viewBox', `0 0 ${w} ${hgt}`);
  el.setAttribute('width', String(w * scale));
  el.setAttribute('height', String(hgt * scale));
  el.setAttribute('shape-rendering', 'crispEdges');
  el.setAttribute('class', 'pxi tackle-sprite');
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', label);
  for (const [x, y, rw, rh, fill] of rects) {
    const r = document.createElementNS(NS, 'rect');
    r.setAttribute('x', String(x));
    r.setAttribute('y', String(y));
    r.setAttribute('width', String(rw));
    r.setAttribute('height', String(rh));
    r.setAttribute('fill', fill);
    el.append(r);
  }
  return el;
}

interface RodLook {
  blank: string;
  blankHi: string;
  handle: string;
  handleHi: string;
  reel: string;
  reelHi: string;
  tip: string;
  /** Blank thickness in pixels. */
  thick?: 1 | 2;
  /** Fly rods carry the reel at the very end of the handle. */
  reelAtEnd?: boolean;
  /** Bigger reel for the troller. */
  bigReel?: boolean;
  /** Gold fittings. */
  fittings?: string;
}

const ROD_LOOKS: Record<string, RodLook> = {
  willow: { blank: '#8c7650', blankHi: '#b8a071', handle: '#5c4a30', handleHi: '#7a6342', reel: '#5a6670', reelHi: '#afb4b5', tip: '#c9c6bc' },
  carbon: { blank: '#2b3238', blankHi: '#5a6670', handle: '#c9a46a', handleHi: '#e2c47a', reel: '#3a4a6b', reelHi: '#6b93bb', tip: '#c2453b' },
  ironwood: { blank: '#4a3a2a', blankHi: '#6e5640', handle: '#2e241a', handleHi: '#4a3a2a', reel: '#5a6670', reelHi: '#8b9196', tip: '#afb4b5', thick: 2 },
  flyrod: { blank: '#556b2f', blankHi: '#7fa36a', handle: '#c9a46a', handleHi: '#e2c47a', reel: '#6e6157', reelHi: '#b8a071', tip: '#e6e4dc', reelAtEnd: true },
  troller: { blank: '#1e3f66', blankHi: '#6b93bb', handle: '#15171a', handleHi: '#343d43', reel: '#8b9196', reelHi: '#ecebe4', tip: '#d79b5a', thick: 2, bigReel: true },
  pearlmaster: { blank: '#e6e4dc', blankHi: '#ffffff', handle: '#3b2f4a', handleHi: '#9c7cb8', reel: '#b8a071', reelHi: '#ffd98a', tip: '#9c7cb8', fittings: '#d0ad62' },
};

/** A rod on a 32×32 diagonal, butt bottom-left, tip top-right. */
export function rodSprite(id: string, name: string, scale = 3): SVGSVGElement {
  const L = ROD_LOOKS[id] ?? ROD_LOOKS.willow;
  const rects: Rect[] = [];
  const at = (i: number): [number, number] => [3 + i, 28 - i];
  // handle: 2px thick, with a highlight line
  for (let i = 0; i <= 6; i++) {
    const [x, y] = at(i);
    rects.push([x, y - 1, 2, 2, L.handle], [x, y - 1, 1, 1, L.handleHi]);
  }
  // blank
  for (let i = 7; i <= 26; i++) {
    const [x, y] = at(i);
    const colour = i >= 24 ? L.tip : L.blank;
    rects.push([x, y, 1, 1, colour]);
    if (L.thick === 2 && i < 22) rects.push([x + 1, y, 1, 1, i % 2 ? L.blankHi : L.blank]);
    else if (i < 24 && i % 3 === 0) rects.push([x, y - 1, 1, 1, L.blankHi]);
  }
  // guides
  for (const i of [11, 16, 21]) {
    const [x, y] = at(i);
    rects.push([x + 1, y + 1, 1, 1, L.fittings ?? '#afb4b5']);
  }
  // reel
  const [rx, ry] = at(L.reelAtEnd ? 1 : 7);
  const s = L.bigReel ? 5 : L.reelAtEnd ? 4 : 3;
  const ox = L.reelAtEnd ? rx - 2 : rx - 1;
  const oy = ry + 1;
  rects.push([ox, oy, s, s, L.reel], [ox + 1, oy + 1, s - 2, s - 2, L.reelHi], [ox + s, oy + 1, 1, 1, L.reel]);
  if (L.fittings) rects.push([at(7)[0] - 1, at(7)[1] - 1, 2, 1, L.fittings]);
  // line from the tip
  const [tx, ty] = at(26);
  for (let k = 1; k <= 3; k++) rects.push([tx + 1, ty + k, 1, 1, '#4e575d']);
  return svg(32, 32, rects, scale, name);
}

/** Lures as character grids. '.' is empty; every other character is looked up in the lure's palette. */
interface LureArt {
  rows: string[];
  pal: Record<string, string>;
}

const HOOK = { h: '#afb4b5', r: '#8b9196' };

const LURE_ART: Record<string, LureArt> = {
  spoon: {
    rows: [
      '................',
      '..rr............',
      '.r..r.aaaa......',
      '..rr.aSWWSaa....',
      '....aSWSSSSSa...',
      '....aSSSSSSSSa..',
      '.....aSSSSSSSa..',
      '......aaSSSSa.h.',
      '........aaaa..h.',
      '.............hh.',
      '..........h.hh..',
      '...........hh...',
    ],
    pal: { ...HOOK, a: '#5a6670', S: '#c9c6bc', W: '#ffffff' },
  },
  spinner: {
    rows: [
      '................',
      '....BBB.........',
      '...BbbbB........',
      '...BbWbB........',
      '...BbbbB........',
      '....BBB.........',
      '.....r..........',
      'rr---oOOOOoo--h.',
      '.....oOOOOo..hh.',
      '.............h.h',
      '................',
      '................',
    ],
    pal: { ...HOOK, '-': '#8b9196', B: '#8a4a2a', b: '#c4783e', W: '#f0b27a', o: '#3b3b3b', O: '#5a5a5a' },
  },
  fly: {
    rows: [
      '................',
      '.....ff.........',
      '...ffFFf........',
      '..fFFrFFf.......',
      '.fFrrrrFFff.....',
      '..ttTTTTTTth....',
      '.....ttttt..h...',
      '............h...',
      '...........hh...',
      '........h.hh....',
      '.........hh.....',
      '................',
    ],
    pal: { ...HOOK, f: '#7a6342', F: '#c9a46a', r: '#c2453b', t: '#3c6e47', T: '#7fa36a' },
  },
  jig: {
    rows: [
      '................',
      '..hh............',
      '.h..GGG.........',
      '.h.GgggG........',
      '..GgWgggG.......',
      '..GgEgggGsssss..',
      '..GgggggGSsSsSs.',
      '...GgggGsssss.s.',
      '....GGG.........',
      '................',
      '................',
      '................',
    ],
    pal: { ...HOOK, G: '#3f7f5a', g: '#9ef0b5', W: '#ffffff', E: '#15171a', s: '#6b4a8a', S: '#9c7cb8' },
  },
  popper: {
    rows: [
      '................',
      '................',
      '...YYYYYYY......',
      '..YyyyyyyyYr....',
      '.QYyEyyyyyYrr...',
      '.QYyyyyyyyY..h..',
      '..YRRRRRRRY..h..',
      '...YYYYYYY..hh..',
      '.....h.....h.h..',
      '.....hh.........',
      '......h.........',
      '................',
    ],
    pal: { ...HOOK, Y: '#8c6a2a', y: '#e2c47a', E: '#15171a', R: '#c2453b', Q: '#5a3a1a' },
  },
  abyss: {
    rows: [
      '................',
      '..rr............',
      '.r..r.aaaa......',
      '..rr.aVWVVaa....',
      '....aVvvvvvVa...',
      '....aVvvVvvvVa..',
      '.....aVvvvvVVa..',
      '......aaVVVVa.h.',
      '........aaaa..h.',
      '.............hh.',
      '..........h.hh..',
      '...........hh...',
    ],
    pal: { ...HOOK, a: '#15171a', V: '#6b4a8a', v: '#2a1f38', W: '#d8c2f0' },
  },
};

export function lureSprite(id: string, name: string, scale = 4): SVGSVGElement {
  const art = LURE_ART[id] ?? LURE_ART.spoon;
  const rects: Rect[] = [];
  art.rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      const fill = art.pal[ch];
      if (ch !== '.' && fill) rects.push([x, y, 1, 1, fill]);
    });
  });
  return svg(16, 12, rects, scale, name);
}
