import * as THREE from 'three';
import { BOOSTER_RADIUS } from './data';
import { puffTexture, rng } from './textures';

const CAPACITY = 900;

interface Puff {
  p: THREE.Vector3;
  v: THREE.Vector3;
  size: number;
  grow: number;
  rot: number;
  spin: number;
  age: number;
  life: number;
  alpha: number;
  drag: number;
  lift: number;
  tile: number;
  depth: number;
}

const vertexShader = /* glsl */ `
  attribute vec3 aCenter;
  attribute vec4 aParams; // size, rotation, alpha, warmth
  attribute float aTile;
  uniform float uGround;
  uniform float uExit;
  varying vec2 vTileUv;
  varying vec2 vLocal;
  varying vec2 vRot;
  varying float vAlpha;
  varying float vWarm;
  varying vec3 vToFire;

  void main() {
    vec4 mv = viewMatrix * vec4(aCenter, 1.0);
    vec3 fire = vec3(0.0, clamp(aCenter.y, uGround, uExit), 0.0);
    vToFire = normalize((viewMatrix * vec4(fire, 1.0)).xyz - mv.xyz);
    float c = cos(aParams.y);
    float s = sin(aParams.y);
    vec2 q = position.xy;
    mv.xy += vec2(c * q.x - s * q.y, s * q.x + c * q.y) * aParams.x;
    vLocal = q * 2.0;
    vRot = vec2(c, s);
    vTileUv = (uv + vec2(mod(aTile, 2.0), floor(aTile / 2.0))) * 0.5;
    // Fade puffs that drift right up to the camera.
    vAlpha = aParams.z * smoothstep(2.0, 10.0, -mv.z);
    vWarm = aParams.w;
    gl_Position = projectionMatrix * mv;
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D uPuff;
  uniform vec3 uSun;
  uniform vec3 uLit;
  uniform vec3 uShadow;
  uniform vec3 uFireCol;
  varying vec2 vTileUv;
  varying vec2 vLocal;
  varying vec2 vRot;
  varying float vAlpha;
  varying float vWarm;
  varying vec3 vToFire;

  void main() {
    vec4 t = texture2D(uPuff, vTileUv);
    float a = t.a * vAlpha;
    if (a < 0.003) discard;
    vec2 l = vLocal;
    vec2 nr = vec2(vRot.x * l.x - vRot.y * l.y, vRot.y * l.x + vRot.x * l.y);
    vec3 n = normalize(vec3(nr, sqrt(max(0.0, 1.0 - dot(l, l))) + 0.3));
    float sun = clamp(dot(n, uSun) * 0.5 + 0.5, 0.0, 1.0) * (0.55 + 0.45 * t.r);
    vec3 col = mix(uShadow, uLit, sun);
    float f = clamp(dot(n, vToFire) * 0.5 + 0.5, 0.0, 1.0);
    col += uFireCol * vWarm * f * (0.6 + 0.4 * t.r);
    gl_FragColor = vec4(col, a);
  }
`;

export class Smoke {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  private geo: THREE.InstancedBufferGeometry;
  private center: THREE.InstancedBufferAttribute;
  private params: THREE.InstancedBufferAttribute;
  private tile: THREE.InstancedBufferAttribute;
  private puffs: Puff[] = [];
  private debt = { ground: 0, skirt: 0 };
  private rand = rng(77);

  constructor() {
    const quad = new THREE.PlaneGeometry(1, 1);
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.index = quad.index;
    this.geo.setAttribute('position', quad.getAttribute('position'));
    this.geo.setAttribute('uv', quad.getAttribute('uv'));
    this.center = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY * 3), 3);
    this.params = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY * 4), 4);
    this.tile = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY), 1);
    for (const a of [this.center, this.params, this.tile]) a.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('aCenter', this.center);
    this.geo.setAttribute('aParams', this.params);
    this.geo.setAttribute('aTile', this.tile);
    this.geo.instanceCount = 0;

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uPuff: { value: puffTexture() },
        uSun: { value: new THREE.Vector3(0, 1, 0) },
        uLit: { value: new THREE.Color('#cdc3bc') },
        uShadow: { value: new THREE.Color('#38425f') },
        uFireCol: { value: new THREE.Color('#ff9a52') },
        uGround: { value: -30 },
        uExit: { value: -1 },
      },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(this.geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
  }

  private spawn(kind: 'ground' | 'skirt', exitY: number, groundY: number) {
    if (this.puffs.length >= CAPACITY) return;
    const r = this.rand;
    const a = r() * Math.PI * 2;
    const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const puff: Puff =
      kind === 'ground'
        ? {
            p: dir.clone().multiplyScalar(r() * 3).setY(groundY + r() * 2),
            v: dir.clone().multiplyScalar(7 + r() * 10).setY(0.5 + r() * 2.5),
            size: 4 + r() * 3,
            grow: 2.5 + r() * 2.5,
            life: 4.5 + r() * 3.5,
            alpha: 0.34,
            drag: 0.55,
            lift: 1.1,
            rot: 0,
            spin: 0,
            age: 0,
            tile: 0,
            depth: 0,
          }
        : {
            // Steam that wraps the skirt and climbs the booster, as in launch photos.
            p: dir.clone().multiplyScalar(BOOSTER_RADIUS + 0.2 + r() * 1.6).setY(exitY + r() * 1.5),
            v: dir.clone().multiplyScalar(0.4 + r() * 1.2).setY(2 + r() * 3),
            size: 2 + r() * 1.8,
            grow: 1.4 + r() * 1.2,
            life: 3 + r() * 3,
            alpha: 0.16,
            drag: 0.3,
            lift: 0.4,
            rot: 0,
            spin: 0,
            age: 0,
            tile: 0,
            depth: 0,
          };
    puff.rot = r() * Math.PI * 2;
    puff.spin = (r() - 0.5) * 0.4;
    puff.tile = Math.floor(r() * 4);
    this.puffs.push(puff);
  }

  update(dt: number, camera: THREE.Camera, thrust: number, exitY: number, sunView: THREE.Vector3) {
    const groundY = exitY - 30;
    this.debt.ground += dt * 48 * thrust;
    this.debt.skirt += dt * 22 * thrust;
    while (this.debt.ground >= 1) {
      this.spawn('ground', exitY, groundY);
      this.debt.ground--;
    }
    while (this.debt.skirt >= 1) {
      this.spawn('skirt', exitY, groundY);
      this.debt.skirt--;
    }

    const camPos = camera.position;
    const camDir = new THREE.Vector3();
    camera.getWorldDirection(camDir);
    const tmp = new THREE.Vector3();
    const alive: Puff[] = [];
    for (const f of this.puffs) {
      f.age += dt;
      if (f.age >= f.life) continue;
      f.v.multiplyScalar(Math.exp(-f.drag * dt));
      f.v.y += f.lift * dt;
      f.p.addScaledVector(f.v, dt);
      f.size += f.grow * dt;
      f.rot += f.spin * dt;
      f.depth = tmp.subVectors(f.p, camPos).dot(camDir);
      alive.push(f);
    }
    alive.sort((a, b) => b.depth - a.depth);
    this.puffs = alive;

    alive.forEach((f, i) => {
      const t = f.age / f.life;
      const alpha = f.alpha * THREE.MathUtils.smoothstep(f.age, 0, 0.6) * Math.pow(1 - t, 1.4);
      const axis = Math.hypot(f.p.x, f.p.z);
      const below = Math.max(0, f.p.y - exitY);
      const warm = thrust * 1.3 * Math.exp(-axis / 7) * Math.exp(-below / 5);
      this.center.setXYZ(i, f.p.x, f.p.y, f.p.z);
      this.params.setXYZW(i, f.size, f.rot, alpha, warm);
      this.tile.setX(i, f.tile);
    });
    this.geo.instanceCount = alive.length;
    this.center.needsUpdate = true;
    this.params.needsUpdate = true;
    this.tile.needsUpdate = true;

    const u = this.material.uniforms;
    u.uSun.value.copy(sunView);
    u.uGround.value = groundY;
    u.uExit.value = exitY;
  }
}
