import '@fontsource-variable/archivo/wdth.css';
import './style.css';
import * as THREE from 'three';
import { MAX_N, PACKINGS, balanceOf, superHeavyRings, type Packing } from './data';
import { Stage, type View } from './scene';
import { EngineCluster } from './engines';
import { Smoke } from './smoke';
import { Rumble } from './audio';
import { Ui } from './ui';
import { noiseTexture } from './textures';

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const canvas = document.getElementById('scene') as HTMLCanvasElement;

const stage = new Stage(canvas);
const engines = new EngineCluster(noiseTexture());
const smoke = new Smoke();
const rumble = new Rumble();
stage.scene.add(engines.group, smoke.mesh);

const rings = superHeavyRings();
const state = {
  n: initialCount(),
  layout: 'optimal' as Packing['kind'],
  out: new Set<number>(),
  firing: false,
  sound: true,
};
let now = 0;

function initialCount() {
  const m = location.hash.match(/^#(\d+)/);
  return m ? Math.min(MAX_N, Math.max(1, Number(m[1]))) : 33;
}

const packing = () => (state.n === 33 && state.layout === 'rings' ? rings : PACKINGS[state.n - 1]);

function refresh() {
  const p = packing();
  ui.render(p, balanceOf(p, state.out), state.out);
}

function applyLayout(instant = false) {
  state.out.clear();
  engines.setLayout(packing(), now, instant);
  ui.setCount(state.n);
  refresh();
  history.replaceState(null, '', `#${state.n}`);
}

function setCount(n: number) {
  n = Math.min(MAX_N, Math.max(1, n));
  if (n === state.n) return;
  state.n = n;
  applyLayout();
}

function toggleFire() {
  rumble.wake();
  state.firing = !state.firing;
  engines.setFiring(state.firing, now);
  ui.setFiring(state.firing);
}

function toggleEngine(i: number) {
  if (state.out.has(i)) state.out.delete(i);
  else state.out.add(i);
  engines.setOut(i, state.out.has(i));
  refresh();
}

function restoreEngines() {
  for (const i of state.out) engines.setOut(i, false);
  state.out.clear();
  refresh();
}

const ui = new Ui({
  count: setCount,
  fire: toggleFire,
  view(v: View) {
    stage.controls.autoRotate = false;
    stage.flyTo(v, reduceMotion ? 0.001 : 1.4);
    ui.setView(v);
  },
  sound() {
    state.sound = !state.sound;
    rumble.enabled = state.sound;
    if (state.sound && state.firing) rumble.wake();
    ui.setSound(state.sound);
  },
  toggleEngine,
  restore: restoreEngines,
  layout(kind) {
    if (kind === state.layout) return;
    state.layout = kind;
    applyLayout();
  },
});

applyLayout(true);

// Camera: a slow drift until someone grabs the view.
stage.controls.autoRotate = !reduceMotion;
stage.controls.autoRotateSpeed = 0.35;
stage.controls.addEventListener('start', () => {
  stage.controls.autoRotate = false;
  ui.setView(null);
});
stage.flyTo('side', reduceMotion ? 0.001 : 2.8);

// Click an engine in 3D to shut it down; ignore drags.
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let downAt: { x: number; y: number } | null = null;
function engineAt(e: PointerEvent) {
  pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(pointer, stage.camera);
  return engines.pick(raycaster);
}
canvas.addEventListener('pointerdown', (e) => (downAt = { x: e.clientX, y: e.clientY }));
canvas.addEventListener('pointerup', (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 5) return;
  downAt = null;
  const i = engineAt(e);
  if (i >= 0) toggleEngine(i);
});
let hoverQueued = false;
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse' || e.buttons || hoverQueued) return;
  hoverQueued = true;
  requestAnimationFrame(() => {
    hoverQueued = false;
    canvas.style.cursor = engineAt(e) >= 0 ? 'pointer' : 'grab';
  });
});

window.addEventListener('keydown', (e) => {
  const el = e.target instanceof Element ? e.target : document.body;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const inControl = el.closest('button, input, a');
  if (e.code === 'Space' && !inControl) {
    e.preventDefault();
    toggleFire();
  } else if ((e.key === 'ArrowRight' || e.key === 'ArrowUp') && !el.closest('input')) {
    e.preventDefault();
    setCount(state.n + 1);
  } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowDown') && !el.closest('input')) {
    e.preventDefault();
    setCount(state.n - 1);
  } else if (e.key === 'r' && !inControl && state.out.size) {
    restoreEngines();
  }
});

window.addEventListener('hashchange', () => setCount(initialCount()));

/** Fire light intensity (candela) at full thrust. */
const FIRE_LIGHT = 80;
const sun = new THREE.Vector3();
let last = performance.now();
function frame(t: number) {
  const dt = Math.min((t - last) / 1000, 0.1);
  last = t;
  now += dt;

  engines.update(now, dt);
  stage.fireLight.position.set(0, engines.exitY - 3, 0);
  stage.fireLight.intensity = engines.thrust * FIRE_LIGHT;
  smoke.update(dt, stage.camera, engines.thrust, engines.exitY, stage.sunInView(sun));
  rumble.update(engines.thrust);
  stage.render(dt, now, reduceMotion ? 0 : engines.thrust);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
