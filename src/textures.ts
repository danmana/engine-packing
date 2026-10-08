import * as THREE from 'three';

// Small seeded RNG so procedural textures look the same on every load.
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 2D gradient noise that tiles every `period` lattice cells. */
function gradientNoise(seed: number) {
  const rand = rng(seed);
  const perm = new Uint8Array(512);
  const order = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  for (let i = 0; i < 512; i++) perm[i] = order[i & 255];
  const gx = new Float32Array(256);
  const gy = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const a = rand() * Math.PI * 2;
    gx[i] = Math.cos(a);
    gy[i] = Math.sin(a);
  }
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  const wrap = (v: number, p: number) => ((v % p) + p) % p;

  return (x: number, y: number, period = 256) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const corner = (ix: number, iy: number, dx: number, dy: number) => {
      const h = perm[perm[wrap(ix, period)] + wrap(iy, period)];
      return gx[h] * dx + gy[h] * dy;
    };
    const u = fade(xf);
    const v = fade(yf);
    const a = corner(xi, yi, xf, yf) + u * (corner(xi + 1, yi, xf - 1, yf) - corner(xi, yi, xf, yf));
    const b =
      corner(xi, yi + 1, xf, yf - 1) + u * (corner(xi + 1, yi + 1, xf - 1, yf - 1) - corner(xi, yi + 1, xf, yf - 1));
    return a + v * (b - a); // roughly -0.7..0.7
  };
}

function fbm(noise: ReturnType<typeof gradientNoise>, x: number, y: number, period: number, octaves: number) {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let f = 1;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise(x * f, y * f, period * f);
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return sum / norm;
}

/** Tileable noise: R = soft fbm, G = fine fbm, B = ridged. */
export function noiseTexture(size = 256) {
  const n1 = gradientNoise(7);
  const n2 = gradientNoise(19);
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const a = fbm(n1, u * 4, v * 4, 4, 5);
      const b = fbm(n2, u * 12, v * 12, 12, 4);
      const c = 1 - Math.abs(fbm(n1, u * 8 + 3.1, v * 8 + 1.7, 8, 4)) * 2;
      const i = (y * size + x) * 4;
      data[i] = THREE.MathUtils.clamp((a * 1.4 + 0.5) * 255, 0, 255);
      data[i + 1] = THREE.MathUtils.clamp((b * 1.4 + 0.5) * 255, 0, 255);
      data[i + 2] = THREE.MathUtils.clamp(c * c * 255, 0, 255);
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

/** 2x2 atlas of billowy smoke puffs. Alpha = coverage, R = self-shading. */
export function puffTexture(size = 256) {
  const half = size / 2;
  const data = new Uint8Array(size * size * 4);
  for (let tile = 0; tile < 4; tile++) {
    const noise = gradientNoise(101 + tile * 13);
    const ox = (tile % 2) * half;
    const oy = Math.floor(tile / 2) * half;
    for (let y = 0; y < half; y++) {
      for (let x = 0; x < half; x++) {
        const u = (x + 0.5) / half - 0.5;
        const v = (y + 0.5) / half - 0.5;
        const r = Math.hypot(u, v) * 2;
        const n = fbm(noise, u * 5 + 10, v * 5 + 10, 256, 5);
        const edge = r + n * 0.75;
        const alpha = (1 - THREE.MathUtils.smoothstep(edge, 0.35, 1.0)) * (1 - THREE.MathUtils.smoothstep(r, 0.85, 1.0));
        const shade = THREE.MathUtils.clamp(0.55 + n * 1.2 - v * 0.6, 0, 1);
        const i = ((oy + y) * size + ox + x) * 4;
        data[i] = shade * 255;
        data[i + 1] = shade * 255;
        data[i + 2] = shade * 255;
        data[i + 3] = alpha * 255;
      }
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!] as const;
}

/**
 * Stainless steel skin: rings stacked with horizontal welds, one vertical
 * weld per ring, faint brushing. Covers three rings per tile.
 */
export function steelTextures() {
  const W = 512;
  const H = 768;
  const rings = 3;
  const rand = rng(42);
  const [c, g] = canvas(W, H);
  const [rc, rg] = canvas(W, H);

  g.fillStyle = '#c3c7cc';
  g.fillRect(0, 0, W, H);
  rg.fillStyle = 'rgb(92,92,92)';
  rg.fillRect(0, 0, W, H);

  const ringH = H / rings;
  for (let k = 0; k < rings; k++) {
    const y0 = k * ringH;
    const tint = rand();
    g.fillStyle = `rgba(${tint > 0.5 ? '255,236,214' : '200,214,236'},${0.05 + rand() * 0.07})`;
    g.fillRect(0, y0, W, ringH);
    rg.fillStyle = `rgba(${rand() > 0.5 ? '255,255,255' : '0,0,0'},${0.06 + rand() * 0.08})`;
    rg.fillRect(0, y0, W, ringH);
    // vertical seam
    const sx = rand() * W;
    g.fillStyle = 'rgba(70,70,74,0.35)';
    g.fillRect(sx, y0, 2, ringH);
    g.fillStyle = 'rgba(255,255,255,0.25)';
    g.fillRect(sx + 2, y0, 1, ringH);
  }
  // brushing streaks
  for (let i = 0; i < 2400; i++) {
    const x = rand() * W;
    const y = rand() * H;
    const len = 20 + rand() * 160;
    const light = rand() > 0.5;
    g.fillStyle = light ? `rgba(255,255,255,${rand() * 0.06})` : `rgba(40,44,52,${rand() * 0.07})`;
    g.fillRect(x, y, 1, len);
    rg.fillStyle = light ? `rgba(0,0,0,${rand() * 0.08})` : `rgba(255,255,255,${rand() * 0.08})`;
    rg.fillRect(x, y, 1, len);
  }
  // horizontal welds between rings
  for (let k = 0; k <= rings; k++) {
    const y = Math.round(k * ringH);
    g.fillStyle = 'rgba(52,50,50,0.55)';
    g.fillRect(0, y - 2, W, 3);
    g.fillStyle = 'rgba(214,170,120,0.35)';
    g.fillRect(0, y + 1, W, 3);
    rg.fillStyle = 'rgba(255,255,255,0.6)';
    rg.fillRect(0, y - 2, W, 6);
  }

  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  const roughness = new THREE.CanvasTexture(rc);
  for (const t of [map, roughness]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
  }
  return { map, roughness };
}

/** Radial soot streaks for nozzle walls (u runs around, v along the bell). */
export function nozzleTexture() {
  const W = 512;
  const H = 128;
  const rand = rng(9);
  const [c, g] = canvas(W, H);
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#2a2b2e');
  grad.addColorStop(0.6, '#45464a');
  grad.addColorStop(1, '#5a5b5e');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < 900; i++) {
    const x = rand() * W;
    const y0 = rand() * H * 0.5;
    const light = rand() > 0.45;
    g.fillStyle = light ? `rgba(220,215,205,${rand() * 0.16})` : `rgba(10,10,12,${rand() * 0.3})`;
    g.fillRect(x, y0, 1 + rand() * 2, H - y0);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}
