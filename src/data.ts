import raw from './data/packings.json';

export interface Packing {
  n: number;
  /** Circle radius when the container has radius 1. */
  r: number;
  /** Flat x, y pairs in the unit container. */
  pts: number[];
  proven: boolean;
  /** Order of rotational symmetry: 1 means none, 0 means continuous (n = 1). */
  rotation: number;
  /** Mirror axis angles in radians. */
  mirrors: number[];
  rattlers: number[];
  pairs: [number, number][];
  /** Mean engine position (thrust centre), from full-precision coordinates. */
  offset: [number, number];
  kind: 'optimal' | 'rings';
}

type RawPacking = Omit<Packing, 'kind'> & { wall: number[] };

export const PACKINGS: Packing[] = (raw as RawPacking[]).map((p) => ({
  n: p.n,
  r: p.r,
  pts: p.pts,
  proven: p.proven,
  rotation: p.rotation,
  mirrors: p.mirrors,
  rattlers: p.rattlers,
  pairs: p.pairs,
  offset: p.offset,
  kind: 'optimal',
}));

export const MAX_N = PACKINGS.length;

/** Booster diameter is 9 m; engines must fit inside this radius (metres). */
export const BAY_RADIUS = 4.25;
export const BOOSTER_RADIUS = 4.5;
/** Assumed height of the centre of mass above the engines, for gimbal angles. */
export const LEVER_ARM = 40;

/**
 * Super Heavy's real arrangement is three concentric groups: 3 centre,
 * 10 middle, 20 outer. This approximation sizes the engines so the outer ring
 * of 20 touches the wall and its neighbours.
 */
export function superHeavyRings(): Packing {
  const s = Math.sin(Math.PI / 20);
  const r = s / (1 + s);
  const rings = [
    { count: 3, radius: 0.17, phase: Math.PI / 2 },
    { count: 10, radius: 0.5, phase: Math.PI / 2 + Math.PI / 10 },
    { count: 20, radius: 1 - r, phase: Math.PI / 2 },
  ];
  const pts: number[] = [];
  for (const ring of rings) {
    for (let i = 0; i < ring.count; i++) {
      const a = ring.phase + (i / ring.count) * Math.PI * 2;
      pts.push(ring.radius * Math.cos(a), ring.radius * Math.sin(a));
    }
  }
  return {
    n: 33,
    r,
    pts,
    proven: false,
    rotation: 1,
    mirrors: [Math.PI / 2],
    rattlers: [],
    pairs: [],
    offset: [0, 0],
    kind: 'rings',
  };
}

export interface Balance {
  active: number;
  /** Thrust centre in the unit container. */
  cx: number;
  cy: number;
  /** Distance of the thrust centre from the axis, metres. */
  offset: number;
  /** Gimbal angle needed to point thrust through the centre of mass, degrees. */
  gimbal: number;
}

export function balanceOf(p: Packing, out: ReadonlySet<number>): Balance {
  let [cx, cy] = p.offset;
  let active = p.n;
  if (out.size) {
    cx = cy = active = 0;
    for (let i = 0; i < p.n; i++) {
      if (out.has(i)) continue;
      cx += p.pts[2 * i];
      cy += p.pts[2 * i + 1];
      active++;
    }
    if (active === 0) return { active, cx: 0, cy: 0, offset: 0, gimbal: 0 };
    cx /= active;
    cy /= active;
  }
  let d = Math.hypot(cx, cy);
  // Stored coordinates are rounded to 1e-7, so smaller offsets are noise.
  if (out.size && d < 2e-7) {
    cx = cy = d = 0;
  }
  const offset = d * BAY_RADIUS;
  return { active, cx, cy, offset, gimbal: (Math.atan2(offset, LEVER_ARM) * 180) / Math.PI };
}

export const isBalanced = (p: Packing) => balanceOf(p, new Set()).offset === 0;
