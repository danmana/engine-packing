import * as THREE from 'three';
import { BAY_RADIUS, LEVER_ARM, type Packing } from './data';
import { plumeGeometry, plumeMaterial } from './plume';
import { nozzleTexture, rng } from './textures';

/** Nozzle bell length, in exit radii. */
export const NOZZLE_LENGTH = 1.7;
const THROAT = 0.3;
/** Engines hang just below the aft heat shield at y = 0. */
const MOUNT_Y = -0.04;
const CAPACITY = 256;
const TRANSITION = 0.75;

interface Slot {
  /** Index in the current packing, or -1 while fading out. */
  key: number;
  from: [number, number, number, number]; // x, y, r, presence
  to: [number, number, number, number];
  t0: number;
  x: number;
  y: number;
  r: number;
  s: number;
  power: number;
  ignite: number;
  litAt: number;
  out: boolean;
  seed: number;
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function nozzleGeometry() {
  // Closed at the top by the injector face, so the throat glows instead of showing through.
  const pts = [
    new THREE.Vector2(0.001, 0.3),
    new THREE.Vector2(0.46, 0.3),
    new THREE.Vector2(0.42, 0.14),
    new THREE.Vector2(0.34, 0.04),
  ];
  const steps = 30;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const r = THROAT + (1 - THROAT) * (1 - Math.pow(1 - t, 2.1));
    pts.push(new THREE.Vector2(r, -t * NOZZLE_LENGTH));
  }
  // Exit first, so the lathe's front faces point outwards. uv.y then runs
  // from the exit (0) to the top of the chamber (1).
  return new THREE.LatheGeometry(pts.reverse(), 56);
}

export const plumeLength = (exitRadius: number) => 10 + exitRadius * 15;

export class EngineCluster {
  readonly group = new THREE.Group();
  readonly plumeMat: THREE.ShaderMaterial;
  firing = false;
  /** Fraction of full thrust currently produced, 0..1. */
  thrust = 0;
  /** Mean nozzle exit height, used to place lights and smoke. */
  exitY = -NOZZLE_LENGTH;
  readonly innerGlow = { value: 1.1 };
  readonly lipGlow = { value: 0.25 };

  private slots: Slot[] = [];
  private drawn: Slot[] = [];
  private outer: THREE.InstancedMesh;
  private inner: THREE.InstancedMesh;
  private rim: THREE.InstancedMesh;
  private plumes: THREE.InstancedMesh;
  private glow: THREE.InstancedBufferAttribute;
  private plumeData: THREE.InstancedBufferAttribute;
  private plumeKind: THREE.InstancedBufferAttribute;
  private gimbal = new THREE.Vector2();
  private rand = rng(3);
  private packing: Packing | null = null;

  constructor(noise: THREE.Texture) {
    const geo = nozzleGeometry();
    this.glow = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY), 1);
    this.glow.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aGlow', this.glow);

    const soot = nozzleTexture();
    const outerMat = new THREE.MeshStandardMaterial({
      color: 0x8a8c84,
      map: soot,
      metalness: 0.65,
      roughness: 0.5,
      side: THREE.FrontSide,
    });
    const innerMat = new THREE.MeshStandardMaterial({
      color: 0xb8b4ac,
      map: soot,
      metalness: 0.5,
      roughness: 0.6,
      side: THREE.BackSide,
    });
    // Per-instance glow drives the emissive term; brightest towards the throat.
    const hot = new THREE.Color(1.0, 0.82, 0.62);
    const patch = (mat: THREE.MeshStandardMaterial, gain: { value: number }, lipOnly: boolean) => {
      mat.customProgramCacheKey = () => (lipOnly ? 'nozzle-outer' : 'nozzle-inner');
      mat.onBeforeCompile = (shader) => {
        shader.uniforms.uHot = { value: hot };
        shader.uniforms.uGain = gain;
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nattribute float aGlow;\nvarying float vGlow;\nvarying float vAlong;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow;\nvAlong = 1.0 - uv.y;');
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform vec3 uHot;\nuniform float uGain;\nvarying float vGlow;\nvarying float vAlong;')
          .replace(
            '#include <emissivemap_fragment>',
            lipOnly
              ? `#include <emissivemap_fragment>
                 totalEmissiveRadiance += vec3(1.0, 0.45, 0.2) * vGlow * uGain * smoothstep(0.75, 1.0, vAlong);`
              : `#include <emissivemap_fragment>
                 float deep = 1.0 - vAlong;
                 float soot = 0.7 + 0.9 * dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
                 totalEmissiveRadiance += uHot * vGlow * uGain * (0.85 + 3.0 * pow(deep, 5.0))
                   * mix(soot, 1.4, smoothstep(0.55, 0.85, deep));`
          );
      };
    };
    patch(innerMat, this.innerGlow, false);
    patch(outerMat, this.lipGlow, true);

    this.outer = new THREE.InstancedMesh(geo, outerMat, CAPACITY);
    this.inner = new THREE.InstancedMesh(geo, innerMat, CAPACITY);

    const rimGeo = new THREE.TorusGeometry(1, 0.03, 8, 56);
    rimGeo.rotateX(Math.PI / 2);
    rimGeo.translate(0, -NOZZLE_LENGTH, 0);
    const rimMat = new THREE.MeshStandardMaterial({ color: 0x9c9a92, metalness: 0.8, roughness: 0.35 });
    this.rim = new THREE.InstancedMesh(rimGeo, rimMat, CAPACITY);

    const pGeo = plumeGeometry();
    this.plumeData = new THREE.InstancedBufferAttribute(new Float32Array((CAPACITY + 1) * 4), 4);
    this.plumeKind = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY + 1), 1);
    this.plumeData.setUsage(THREE.DynamicDrawUsage);
    this.plumeKind.setUsage(THREE.DynamicDrawUsage);
    pGeo.setAttribute('aPlume', this.plumeData);
    pGeo.setAttribute('aKind', this.plumeKind);
    this.plumeMat = plumeMaterial(noise);
    this.plumes = new THREE.InstancedMesh(pGeo, this.plumeMat, CAPACITY + 1);
    this.plumes.renderOrder = 2;

    for (const m of [this.outer, this.inner, this.rim, this.plumes]) {
      m.frustumCulled = false;
      m.count = 0;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(m);
    }
  }

  get layout() {
    return this.packing;
  }

  /** Morph from whatever is on screen to a new packing. */
  setLayout(p: Packing, now: number, instant = false) {
    this.packing = p;
    const live = this.slots.filter((s) => s.key >= 0);
    const targets = Array.from({ length: p.n }, (_, i) => [p.pts[2 * i], p.pts[2 * i + 1]] as const);

    // Greedy nearest matching keeps engines from crossing the whole bay.
    const pairs: [number, number, number][] = [];
    for (let a = 0; a < live.length; a++) {
      for (let b = 0; b < targets.length; b++) {
        pairs.push([Math.hypot(live[a].x - targets[b][0], live[a].y - targets[b][1]), a, b]);
      }
    }
    pairs.sort((u, v) => u[0] - v[0]);
    const usedA = new Uint8Array(live.length);
    const usedB = new Uint8Array(targets.length);
    for (const [, a, b] of pairs) {
      if (usedA[a] || usedB[b]) continue;
      usedA[a] = usedB[b] = 1;
      this.retarget(live[a], b, targets[b][0], targets[b][1], p.r, 1, now);
    }
    live.forEach((s, a) => {
      if (!usedA[a]) this.retarget(s, -1, s.x, s.y, s.r, 0, now);
    });
    targets.forEach(([x, y], b) => {
      if (usedB[b]) return;
      const slot: Slot = {
        key: b,
        from: [x, y, p.r, 0],
        to: [x, y, p.r, 1],
        t0: now,
        x,
        y,
        r: p.r,
        s: 0,
        power: 0,
        ignite: now + 0.15 + this.rand() * 0.25,
        litAt: -1,
        out: false,
        seed: this.rand() * 10,
      };
      this.slots.push(slot);
    });
    for (const s of this.slots) {
      s.out = false;
      if (instant) s.t0 = -1e9;
    }
  }

  private retarget(s: Slot, key: number, x: number, y: number, r: number, presence: number, now: number) {
    s.from = [s.x, s.y, s.r, s.s];
    s.to = [x, y, r, presence];
    s.t0 = now;
    s.key = key;
  }

  setFiring(on: boolean, now: number) {
    if (on === this.firing) return;
    this.firing = on;
    if (!on) return;
    // Light up from the centre outwards, like a real start sequence.
    const live = this.slots.filter((s) => s.key >= 0);
    const maxD = Math.max(1e-6, ...live.map((s) => Math.hypot(s.to[0], s.to[1])));
    for (const s of live) {
      s.ignite = now + 0.12 + (Math.hypot(s.to[0], s.to[1]) / maxD) * 1.1 + this.rand() * 0.12;
    }
  }

  setOut(key: number, out: boolean) {
    const s = this.slots.find((s) => s.key === key);
    if (s) s.out = out;
  }

  update(now: number, dt: number) {
    const p = this.packing;
    for (const s of this.slots) {
      const k = Math.min(1, Math.max(0, (now - s.t0) / TRANSITION));
      const e = ease(k);
      s.x = s.from[0] + (s.to[0] - s.from[0]) * e;
      s.y = s.from[1] + (s.to[1] - s.from[1]) * e;
      s.r = s.from[2] + (s.to[2] - s.from[2]) * e;
      s.s = s.from[3] + (s.to[3] - s.from[3]) * e;

      const want = this.firing && s.key >= 0 && !s.out && now >= s.ignite;
      if (want && s.litAt < 0) s.litAt = now;
      if (!want) s.litAt = -1;
      s.power = want ? Math.min(1, s.power + dt / 0.3) : Math.max(0, s.power - dt / 0.5);
    }
    this.slots = this.slots.filter((s) => !(s.key < 0 && now - s.t0 >= TRANSITION));

    // Thrust centre of the engines that should be running, metres.
    const target = new THREE.Vector2();
    let running = 0;
    if (this.firing && p) {
      for (const s of this.slots) {
        if (s.key < 0 || s.out) continue;
        target.x += s.to[0];
        target.y += s.to[1];
        running++;
      }
      if (running) target.multiplyScalar(BAY_RADIUS / running);
      if (target.length() < 1e-7) target.set(0, 0);
    }
    this.gimbal.lerp(target, 1 - Math.exp(-dt * 3));

    // Gimbal every engine so thrust points through the centre of mass.
    const exhaust = new THREE.Vector3(this.gimbal.x, -LEVER_ARM, this.gimbal.y).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), exhaust);
    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    const exit = new THREE.Vector3();
    const one = new THREE.Vector3(1, 1, 1);

    this.drawn = this.slots.filter((s) => s.s > 0.001);
    let total = 0;
    let exitSum = 0;
    this.drawn.forEach((s, i) => {
      // Engines that come and go slide up into the engine bay rather than popping.
      const size = s.r * BAY_RADIUS;
      const stowed = (1 - s.s) * (NOZZLE_LENGTH * size + 0.4);
      pos.set(s.x * BAY_RADIUS, MOUNT_Y + stowed, s.y * BAY_RADIUS);
      scl.setScalar(size);
      m.compose(pos, q, scl);
      this.outer.setMatrixAt(i, m);
      this.inner.setMatrixAt(i, m);
      this.rim.setMatrixAt(i, m);

      const flicker = 0.93 + 0.07 * Math.sin(now * 31 + s.seed * 7) * Math.sin(now * 17.3 + s.seed);
      const flash = s.litAt >= 0 ? Math.exp(-(now - s.litAt) * 7) * 0.9 : 0;
      const power = s.power * s.s;
      this.glow.setX(i, power * (1 + flash));

      exit.set(0, -NOZZLE_LENGTH * size, 0).applyQuaternion(q).add(pos);
      m.compose(exit, q, one);
      this.plumes.setMatrixAt(i, m);
      this.plumeData.setXYZW(i, size, plumeLength(size), power * flicker * (1 + flash * 1.5), s.seed);
      this.plumeKind.setX(i, 0);

      total += power;
      exitSum += exit.y;
    });

    const n = this.drawn.length;
    const count = p ? p.n : 1;
    this.thrust = total / Math.max(1, count);
    if (n) this.exitY = exitSum / n;

    // One wide, faint column for the merged exhaust far downstream.
    exit.set(this.gimbal.x * 0.02, this.exitY, this.gimbal.y * 0.02);
    m.compose(exit, q, one);
    this.plumes.setMatrixAt(n, m);
    this.plumeData.setXYZW(n, BAY_RADIUS * 0.95, 85, this.thrust, 3.7);
    this.plumeKind.setX(n, 1);

    this.outer.count = this.inner.count = this.rim.count = n;
    this.plumes.count = n + 1;
    for (const mesh of [this.outer, this.inner, this.rim, this.plumes]) mesh.instanceMatrix.needsUpdate = true;
    this.glow.needsUpdate = true;
    this.plumeData.needsUpdate = true;
    this.plumeKind.needsUpdate = true;
    this.plumeMat.uniforms.uTime.value = now;
  }

  /** Packing index of the engine under the ray, or -1. */
  pick(raycaster: THREE.Raycaster) {
    this.outer.computeBoundingSphere();
    this.inner.computeBoundingSphere();
    const hits = raycaster.intersectObjects([this.outer, this.inner], false);
    for (const h of hits) {
      const s = h.instanceId !== undefined ? this.drawn[h.instanceId] : undefined;
      if (s && s.key >= 0) return s.key;
    }
    return -1;
  }
}
