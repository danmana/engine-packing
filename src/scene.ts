import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { BOOSTER_RADIUS } from './data';
import { steelTextures } from './textures';

export const SUN_DIR = new THREE.Vector3(0.62, 0.2, 0.76).normalize();

function sky() {
  const geo = new THREE.SphereGeometry(900, 48, 24);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uZenith: { value: new THREE.Color('#061847') },
      uMid: { value: new THREE.Color('#1a4796') },
      uHorizon: { value: new THREE.Color('#7f9bcc') },
      uWarm: { value: new THREE.Color('#f3a364') },
      uBelow: { value: new THREE.Color('#5d5762') },
      uSun: { value: SUN_DIR },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uZenith, uMid, uHorizon, uWarm, uBelow, uSun;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float y = d.y;
        vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.32, y));
        col = mix(col, uZenith, smoothstep(0.3, 1.0, y));
        float toward = max(dot(normalize(vec3(d.x, 0.0, d.z)), normalize(vec3(uSun.x, 0.0, uSun.z))), 0.0);
        col += uWarm * pow(1.0 - abs(y), 7.0) * (0.12 + 0.7 * pow(toward, 3.0));
        col += uWarm * 0.6 * pow(max(dot(d, uSun), 0.0), 120.0);
        col = mix(col, uBelow, smoothstep(0.0, -0.25, y));
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  return mesh;
}

function booster() {
  const group = new THREE.Group();
  const { map, roughness } = steelTextures();
  const height = 70;
  const skirt = 0.45;
  map.repeat.set(5, height / 5.5);
  roughness.repeat.copy(map.repeat);

  const steel = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map,
    roughnessMap: roughness,
    metalness: 0.9,
    roughness: 0.38,
  });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(BOOSTER_RADIUS, BOOSTER_RADIUS, height, 160, 1, true), steel);
  body.position.y = height / 2 - skirt;
  group.add(body);

  // Inside of the skirt lip, visible from below.
  const inner = new THREE.Mesh(
    new THREE.CylinderGeometry(BOOSTER_RADIUS - 0.02, BOOSTER_RADIUS - 0.02, skirt, 160, 1, true),
    new THREE.MeshStandardMaterial({ color: 0x3b3a39, metalness: 0.7, roughness: 0.6, side: THREE.BackSide })
  );
  inner.position.y = -skirt / 2;
  group.add(inner);

  const lip = new THREE.Mesh(
    new THREE.RingGeometry(BOOSTER_RADIUS - 0.04, BOOSTER_RADIUS + 0.01, 160),
    new THREE.MeshStandardMaterial({ color: 0x8b8d90, metalness: 1, roughness: 0.35, side: THREE.DoubleSide })
  );
  lip.rotation.x = Math.PI / 2;
  lip.position.y = -skirt;
  group.add(lip);

  // Aft heat shield the engines hang from.
  const shield = new THREE.Mesh(
    new THREE.CircleGeometry(BOOSTER_RADIUS - 0.02, 160),
    new THREE.MeshStandardMaterial({ color: 0x1d1e21, metalness: 0.3, roughness: 0.85 })
  );
  shield.rotation.x = Math.PI / 2;
  group.add(shield);

  // A cable raceway and two stringers break up the silhouette.
  const trim = new THREE.MeshStandardMaterial({ color: 0xb5b9be, metalness: 1, roughness: 0.38 });
  const raceway = new THREE.Mesh(new THREE.BoxGeometry(0.42, height, 0.28), trim);
  raceway.position.set(BOOSTER_RADIUS + 0.1, height / 2 - skirt + 0.3, 0);
  group.add(raceway);
  for (const a of [Math.PI * 0.62, Math.PI * 1.38]) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.18, height, 0.12), trim);
    s.position.set(Math.cos(a) * (BOOSTER_RADIUS + 0.04), height / 2 - skirt + 0.3, Math.sin(a) * (BOOSTER_RADIUS + 0.04));
    s.rotation.y = -a;
    group.add(s);
  }
  return group;
}

const finishShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uAspect: { value: 1 },
    uGrain: { value: 0.035 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uAspect;
    uniform float uGrain;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + uTime) * 43758.5453); }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 q = (vUv - 0.5) * vec2(uAspect, 1.0);
      float vig = smoothstep(1.25, 0.35, length(q));
      c.rgb *= mix(0.72, 1.0, vig);
      c.rgb += (hash(vUv * 1000.0) - 0.5) * uGrain;
      gl_FragColor = c;
    }
  `,
};

export type View = 'side' | 'below';

const VIEWS: Record<View, { pos: THREE.Vector3; target: THREE.Vector3 }> = {
  side: { pos: new THREE.Vector3(19, -12, 24), target: new THREE.Vector3(0, -3.2, 0) },
  below: { pos: new THREE.Vector3(0, -27, 0.4), target: new THREE.Vector3(0, -2, 0) },
};

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly fireLight: THREE.PointLight;
  private composer: EffectComposer;
  readonly bloom: UnrealBloomPass;
  private finish: ShaderPass;
  private flight: {
    from: THREE.Vector3;
    to: THREE.Vector3;
    fromT: THREE.Vector3;
    toT: THREE.Vector3;
    t: number;
    dur: number;
  } | null = null;
  private shake = new THREE.Vector3();

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.camera = new THREE.PerspectiveCamera(34, 1, 0.1, 2000);
    this.camera.position.copy(VIEWS.side.pos).multiplyScalar(1.6);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.copy(VIEWS.side.target);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.07;
    this.controls.minDistance = 7;
    this.controls.maxDistance = 140;
    this.controls.enablePan = false;
    this.controls.rotateSpeed = 0.7;

    const skyMesh = sky();
    this.scene.add(skyMesh);

    // Reflections come from the same twilight sky.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    envScene.add(sky());
    this.scene.environment = pmrem.fromScene(envScene, 0.02).texture;
    this.scene.environmentIntensity = 0.9;
    pmrem.dispose();

    const sun = new THREE.DirectionalLight('#ffc996', 3);
    sun.position.copy(SUN_DIR).multiplyScalar(100);
    this.scene.add(sun);
    this.scene.add(new THREE.HemisphereLight('#6f8fd6', '#6a5548', 0.9));
    // Soft bounce from the ground so the underside reads when viewed from below.
    const bounce = new THREE.DirectionalLight('#b9b4c8', 0.7);
    bounce.position.set(0.3, -1, 0.2);
    this.scene.add(bounce);

    this.fireLight = new THREE.PointLight('#ffb27a', 0, 0, 1.6);
    this.scene.add(this.fireLight);

    this.scene.add(booster());

    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.4, 0.4, 1.0);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.finish = new ShaderPass(finishShader);
    this.composer.addPass(this.finish);

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    // Pull back on narrow screens so the whole engine section fits.
    this.camera.fov = w / h < 0.8 ? 46 : 34;
    this.camera.updateProjectionMatrix();
    this.finish.uniforms.uAspect.value = w / h;
  }

  flyTo(view: View, duration = 1.4) {
    const v = VIEWS[view];
    this.flight = {
      from: this.camera.position.clone(),
      to: v.pos.clone(),
      fromT: this.controls.target.clone(),
      toT: v.target.clone(),
      t: 0,
      dur: Math.max(duration, 1e-3),
    };
  }

  /** Sun direction in view space, for billboard shading. */
  sunInView(out: THREE.Vector3) {
    return out.copy(SUN_DIR).transformDirection(this.camera.matrixWorldInverse);
  }

  private frameTimes: number[] = [];
  private frames = 0;
  private pixelRatio = Math.min(window.devicePixelRatio, 1.75);

  /** Off while recording, where frame time says nothing about the device. */
  adaptive = true;

  /** Film grain strength; recordings turn it off to save bitrate. */
  set grain(amount: number) {
    this.finish.uniforms.uGrain.value = amount;
  }

  /** Drop resolution on slow devices instead of dropping frames. */
  private adapt(dt: number) {
    if (!this.adaptive) return;
    // Skip the first frames, which include shader compilation.
    if (++this.frames < 120) return;
    this.frameTimes.push(dt);
    if (this.frameTimes.length < 90) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.frameTimes.length = 0;
    if (avg > 1 / 40 && this.pixelRatio > 0.75) {
      this.pixelRatio = Math.max(0.75, this.pixelRatio - 0.25);
      this.renderer.setPixelRatio(this.pixelRatio);
      this.composer.setPixelRatio(this.pixelRatio);
      this.resize();
    }
  }

  render(dt: number, now: number, shakeAmount: number) {
    this.adapt(dt);
    if (this.flight) {
      const f = this.flight;
      f.t = Math.min(1, f.t + dt / f.dur);
      const e = 1 - Math.pow(1 - f.t, 3);
      // Arc through a wider orbit so the camera never clips the booster.
      const pos = f.from.clone().lerp(f.to, e);
      const radius = THREE.MathUtils.lerp(f.from.length(), f.to.length(), e);
      pos.setLength(Math.max(radius, 10));
      this.camera.position.copy(pos);
      this.controls.target.copy(f.fromT).lerp(f.toT, e);
      if (f.t >= 1) this.flight = null;
    }
    this.controls.update(dt);

    this.shake.set(
      Math.sin(now * 61.0) * Math.sin(now * 23.7),
      Math.sin(now * 47.3 + 1.3) * Math.sin(now * 19.1),
      Math.sin(now * 53.9 + 2.1) * Math.sin(now * 29.3)
    );
    this.shake.multiplyScalar(shakeAmount * 0.06);
    this.camera.position.add(this.shake);
    this.finish.uniforms.uTime.value = now % 10;
    this.composer.render();
    this.camera.position.sub(this.shake);
  }

  get flying() {
    return this.flight !== null;
  }
}
