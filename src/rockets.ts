import { PACKINGS, type Packing } from './data';

/**
 * Engine layouts of real first stages, for comparison with the optimal
 * packings. Only the pattern is real: engines are sized to the largest that
 * fit it, and the whole cluster is scaled to fill the same engine bay.
 */
export interface Rocket {
  id: string;
  name: string;
  n: number;
  /** Its own pattern, when that differs from the optimal packing. */
  layout?: Packing;
  note: string;
}

type Point = [number, number];

interface Ring {
  count: number;
  radius: number;
  /** Angle of the first engine, degrees. */
  phase?: number;
}

function rings(spec: Ring[]): Point[] {
  const pts: Point[] = [];
  for (const { count, radius, phase = 90 } of spec) {
    for (let i = 0; i < count; i++) {
      const a = ((phase + (360 * i) / count) * Math.PI) / 180;
      pts.push([radius * Math.cos(a), radius * Math.sin(a)]);
    }
  }
  return pts;
}

const TOL = 1e-6;

function matches(pts: Point[], transform: (p: Point) => Point) {
  const used = new Uint8Array(pts.length);
  return pts.every((p) => {
    const [x, y] = transform(p);
    const j = pts.findIndex((q, k) => !used[k] && Math.abs(q[0] - x) < TOL && Math.abs(q[1] - y) < TOL);
    if (j < 0) return false;
    used[j] = 1;
    return true;
  });
}

function symmetry(pts: Point[]) {
  let rotation = 1;
  for (let k = pts.length; k >= 2; k--) {
    const c = Math.cos((2 * Math.PI) / k);
    const s = Math.sin((2 * Math.PI) / k);
    if (matches(pts, ([x, y]) => [c * x - s * y, s * x + c * y])) {
      rotation = k;
      break;
    }
  }
  // A mirror maps the farthest engine onto one at the same distance.
  const far = pts.reduce((a, b) => (Math.hypot(...b) > Math.hypot(...a) ? b : a));
  const mirrors: number[] = [];
  for (const q of pts) {
    if (Math.abs(Math.hypot(...q) - Math.hypot(...far)) > TOL) continue;
    const axis = (Math.atan2(far[1], far[0]) + Math.atan2(q[1], q[0])) / 2;
    const c = Math.cos(2 * axis);
    const s = Math.sin(2 * axis);
    const norm = ((axis % Math.PI) + Math.PI) % Math.PI;
    if (matches(pts, ([x, y]) => [c * x + s * y, s * x - c * y]) && !mirrors.some((m) => Math.abs(m - norm) < TOL)) {
      mirrors.push(norm);
    }
  }
  return { rotation, mirrors };
}

/** Largest equal engines on these centres, scaled so the cluster fills the unit bay. */
function packing(id: string, centres: Point[]): Packing {
  let gap = Infinity;
  for (let i = 0; i < centres.length; i++) {
    for (let j = i + 1; j < centres.length; j++) {
      gap = Math.min(gap, Math.hypot(centres[i][0] - centres[j][0], centres[i][1] - centres[j][1]));
    }
  }
  const r0 = gap / 2;
  const scale = 1 / (Math.max(...centres.map((p) => Math.hypot(...p))) + r0);
  const pts = centres.map(([x, y]): Point => [x * scale, y * scale]);
  const r = r0 * scale;

  const pairs: [number, number][] = [];
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      if (Math.abs(Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]) - 2 * r) < TOL) pairs.push([i, j]);
    }
  }
  const mean = pts.reduce((m, p) => [m[0] + p[0] / pts.length, m[1] + p[1] / pts.length], [0, 0]);
  const offset: Point = Math.hypot(...mean) < 1e-9 ? [0, 0] : mean;

  return { n: pts.length, r, pts: pts.flat(), proven: false, ...symmetry(pts), rattlers: [], pairs, offset, kind: 'real', id };
}

const wider = (p: Packing) => `${Math.round((PACKINGS[p.n - 1].r / p.r - 1) * 100)}\u00a0%`;

// Saturn V's S-IC: a fixed centre F-1 and four gimbaled ones on the diagonals.
const saturnV = packing('saturn-v', [[0, 0], ...rings([{ count: 4, radius: 1, phase: 45 }])]);

// Saturn I and IB: inner square of four at 32 in from the axis, outer square
// of four at 95 in, turned 45° (NASA S-I stage documentation).
const saturnI = packing(
  'saturn-i',
  rings([
    { count: 4, radius: 32, phase: 45 },
    { count: 4, radius: 95, phase: 0 },
  ])
);

// The first five Falcon 9 flights: nine Merlin 1Cs in a 3 × 3 grid.
const falcon9v1 = packing(
  'falcon-9-v1',
  [-1, 0, 1].flatMap((y) => [-1, 0, 1].map((x): Point => [x, y]))
);

// N1 Block A: 24 NK-15s around the rim and 6 in an inner ring. Ring radii are
// not published in the sources used, so the inner ring is set close-packed.
const n1 = packing(
  'n1',
  rings([
    { count: 6, radius: 2 * Math.sin(Math.PI / 24) * 1.1, phase: 90 },
    { count: 24, radius: 1, phase: 90 },
  ])
);

// Super Heavy: 3 centre, 10 middle, 20 outer. Inner ring radii estimated from
// photos of the engine section.
const superHeavy = packing(
  'super-heavy',
  rings([
    { count: 3, radius: 0.197 },
    { count: 10, radius: 0.578, phase: 108 },
    { count: 20, radius: 1 },
  ])
);

export const ROCKETS: Rocket[] = [
  {
    id: 'saturn-v',
    name: 'Saturn V',
    n: 5,
    layout: saturnV,
    note: `Saturn V’s first stage: four gimbaled F-1s around a fixed centre engine. The optimal ring of five fits nozzles ${wider(saturnV)} wider.`,
  },
  {
    id: 'proton',
    name: 'Proton',
    n: 6,
    note: 'Proton’s six first-stage engines sit in a ring like this, one under each outboard fuel tank.',
  },
  {
    id: 'new-glenn',
    name: 'New Glenn',
    n: 7,
    note: 'New Glenn’s seven BE-4s use this pattern: six around one.',
  },
  {
    id: 'saturn-i',
    name: 'Saturn I',
    n: 8,
    layout: saturnI,
    note: `Saturn I and IB: four fixed engines in a tight inner square, four gimbaled ones in an outer square turned 45°. The optimal packing fits nozzles ${wider(saturnI)} wider.`,
  },
  {
    id: 'falcon-9',
    name: 'Falcon 9',
    n: 9,
    note: 'Falcon 9’s Octaweb and Electron’s nine Rutherfords use this pattern: eight around one.',
  },
  {
    id: 'falcon-9-v1',
    name: 'Falcon 9 v1.0',
    n: 9,
    layout: falcon9v1,
    note: `The first five Falcon 9s flew their Merlins in a 3\u00a0×\u00a03 grid. The Octaweb that replaced it is the optimal layout, with nozzles ${wider(falcon9v1)} wider.`,
  },
  {
    id: 'electron',
    name: 'Electron',
    n: 9,
    note: 'Falcon 9’s Octaweb and Electron’s nine Rutherfords use this pattern: eight around one.',
  },
  {
    id: 'n1',
    name: 'N1',
    n: 30,
    layout: n1,
    note: `The Soviet N1: 24 NK-15s around the rim and 6 in an inner ring, approximated. The optimal packing fits nozzles ${wider(n1)} wider.`,
  },
  {
    id: 'super-heavy',
    name: 'Super Heavy',
    n: 33,
    layout: superHeavy,
    note: `Super Heavy’s 3 + 10 + 20 rings, approximated. The optimal packing fits nozzles ${wider(superHeavy)} wider in the same base.`,
  },
];

/** Rockets that fly n engines, with or without their own layout. */
export const rocketsWith = (n: number) => ROCKETS.filter((r) => r.n === n);

export const rocketById = (id: string) => ROCKETS.find((r) => r.id === id);
