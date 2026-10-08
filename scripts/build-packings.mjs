// Builds src/data/packings.json from Eckard Specht's Packomania tables
// (best known packings of n equal circles in a unit circle).
// Usage: node scripts/build-packings.mjs [maxN]

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cacheDir = join(root, 'scripts', '.cache');
const outFile = join(root, 'src', 'data', 'packings.json');
const MAX_N = Number(process.argv[2] ?? 100);
const BASE = 'https://www.packomania.com/cci/txt';

// Proven optimal per Wikipedia, "Circle packing in a circle" (n = 1..14 and 19).
const PROVEN = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 19]);

const CONTACT_TOL = 1e-9;
const SYM_TOL = 1e-6;

async function cached(name) {
  const file = join(cacheDir, name);
  if (existsSync(file)) return readFile(file, 'utf8');
  const res = await fetch(`${BASE}/${name}`);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  const text = await res.text();
  await writeFile(file, text);
  return text;
}

function parseCoords(text) {
  return text
    .trim()
    .split('\n')
    .map((line) => line.trim().split(/\s+/).slice(1, 3).map(Number));
}

function contactsOf(pts, r) {
  const pairs = [];
  const wall = [];
  for (let i = 0; i < pts.length; i++) {
    const [xi, yi] = pts[i];
    if (Math.abs(1 - r - Math.hypot(xi, yi)) < CONTACT_TOL) wall.push(i);
    for (let j = i + 1; j < pts.length; j++) {
      const d = Math.hypot(pts[j][0] - xi, pts[j][1] - yi);
      if (Math.abs(d - 2 * r) < CONTACT_TOL) pairs.push([i, j]);
    }
  }
  return { pairs, wall };
}

// A circle is locked when its contact directions are not confined to a
// half-plane. Circles that aren't locked are rattlers; removing them can
// free their neighbours, so iterate until stable.
function rattlersOf(pts, pairs, wall) {
  const n = pts.length;
  if (n === 1) return [];
  const loose = new Set();
  for (;;) {
    let changed = false;
    for (let i = 0; i < n; i++) {
      if (loose.has(i)) continue;
      const angles = [];
      for (const [a, b] of pairs) {
        if (a !== i && b !== i) continue;
        const j = a === i ? b : a;
        if (loose.has(j)) continue;
        angles.push(Math.atan2(pts[j][1] - pts[i][1], pts[j][0] - pts[i][0]));
      }
      const onWall = wall.includes(i);
      if (onWall) angles.push(Math.atan2(pts[i][1], pts[i][0]));
      angles.sort((a, b) => a - b);
      let maxGap = angles.length ? 2 * Math.PI - (angles.at(-1) - angles[0]) : Infinity;
      for (let k = 1; k < angles.length; k++) maxGap = Math.max(maxGap, angles[k] - angles[k - 1]);
      // Two exactly opposite contacts only lock a circle when one of them is
      // the (curved) container wall.
      const halfPlane = Math.abs(maxGap - Math.PI) < 1e-9;
      if (angles.length < 2 || maxGap > Math.PI + 1e-9 || (halfPlane && !onWall)) {
        loose.add(i);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return [...loose].sort((a, b) => a - b);
}

function matches(pts, transform) {
  const used = new Uint8Array(pts.length);
  for (const p of pts) {
    const [x, y] = transform(p);
    let hit = -1;
    for (let j = 0; j < pts.length; j++) {
      if (!used[j] && Math.abs(pts[j][0] - x) < SYM_TOL && Math.abs(pts[j][1] - y) < SYM_TOL) {
        hit = j;
        break;
      }
    }
    if (hit < 0) return false;
    used[hit] = 1;
  }
  return true;
}

function symmetryOf(pts) {
  const n = pts.length;
  if (n === 1) return { rotation: 0, mirrors: [] };
  let rotation = 1;
  for (let k = n; k >= 2; k--) {
    const a = (2 * Math.PI) / k;
    const c = Math.cos(a);
    const s = Math.sin(a);
    if (matches(pts, ([x, y]) => [c * x - s * y, s * x + c * y])) {
      rotation = k;
      break;
    }
  }
  // Any mirror maps the point farthest from the centre onto a point at the
  // same distance, which pins down the axis.
  let p0 = 0;
  for (let i = 1; i < n; i++) if (Math.hypot(...pts[i]) > Math.hypot(...pts[p0])) p0 = i;
  const r0 = Math.hypot(...pts[p0]);
  const t0 = Math.atan2(pts[p0][1], pts[p0][0]);
  const mirrors = [];
  for (let j = 0; j < n; j++) {
    if (Math.abs(Math.hypot(...pts[j]) - r0) > SYM_TOL) continue;
    const axis = (t0 + Math.atan2(pts[j][1], pts[j][0])) / 2;
    const c = Math.cos(2 * axis);
    const s = Math.sin(2 * axis);
    if (matches(pts, ([x, y]) => [c * x + s * y, s * x - c * y])) {
      const norm = ((axis % Math.PI) + Math.PI) % Math.PI;
      if (!mirrors.some((m) => Math.abs(m - norm) < 1e-6)) mirrors.push(norm);
    }
  }
  return { rotation, mirrors };
}

const round = (v, d = 7) => Math.round(v * 10 ** d) / 10 ** d;

await mkdir(cacheDir, { recursive: true });
await mkdir(dirname(outFile), { recursive: true });

const radii = new Map(
  (await cached('radius.txt'))
    .trim()
    .split('\n')
    .map((l) => l.trim().split(/\s+/).map(Number))
);

const packings = [];
for (let n = 1; n <= MAX_N; n++) {
  const pts = parseCoords(await cached(`cci${n}.txt`));
  if (pts.length !== n) throw new Error(`n=${n}: got ${pts.length} circles`);
  const r = radii.get(n);
  const { pairs, wall } = contactsOf(pts, r);
  const rattlers = rattlersOf(pts, pairs, wall);
  const { rotation, mirrors } = symmetryOf(pts);
  const cx = pts.reduce((s, p) => s + p[0], 0) / n;
  const cy = pts.reduce((s, p) => s + p[1], 0) / n;
  packings.push({
    n,
    r: round(r, 10),
    proven: PROVEN.has(n),
    rotation,
    mirrors: mirrors.map((m) => round(m, 6)),
    offset: [cx, cy].map((v) => (Math.abs(v) < 1e-12 ? 0 : Number(v.toPrecision(6)))),
    rattlers,
    wall,
    pairs,
    pts: pts.flat().map((v) => round(v)),
  });
  process.stdout.write(
    `n=${String(n).padStart(3)} r=${r.toFixed(5)} sym=${mirrors.length ? 'D' : 'C'}${rotation} ` +
      `rattlers=${rattlers.length} offset=${Math.hypot(cx, cy).toExponential(2)}\n`
  );
}

await writeFile(outFile, JSON.stringify(packings));
console.log(`wrote ${packings.length} packings to ${outFile}`);
