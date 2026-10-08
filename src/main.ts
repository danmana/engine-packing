import '@fontsource-variable/archivo/wdth.css';
import './style.css';
import * as THREE from 'three';
import { MAX_N, PACKINGS, balanceOf } from './data';
import { rocketById } from './rockets';
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

const state = {
  n: 33,
  /** 'optimal', or the id of a rocket whose own layout is shown. */
  layout: 'optimal',
  /** Engines that are on, by packing index. Empty means shut down. */
  lit: new Set<number>(),
  sound: true,
};
let now = 0;

/** Links look like #33 or #33/super-heavy. */
function readHash() {
  const m = location.hash.match(/^#(\d+)(?:\/([\w.-]+))?/);
  const n = m ? Math.min(MAX_N, Math.max(1, Number(m[1]))) : 33;
  const rocket = m?.[2] ? rocketById(m[2]) : undefined;
  return { n, layout: rocket?.layout && rocket.n === n ? rocket.id : 'optimal' };
}
Object.assign(state, readHash());

const packing = () => rocketById(state.layout)?.layout ?? PACKINGS[state.n - 1];

const allEngines = () => new Set(Array.from({ length: packing().n }, (_, i) => i));

function refresh() {
  const p = packing();
  ui.render(p, balanceOf(p, state.lit), state.lit);
  ui.setFiring(state.lit.size > 0);
}

function applyLayout(instant = false) {
  // A running rocket keeps running on the new layout, with every engine on.
  const running = state.lit.size > 0;
  engines.setLayout(packing(), now, instant);
  state.lit = running ? allEngines() : new Set();
  engines.setLit(state.lit, now);
  ui.setCount(state.n, state.layout);
  refresh();
  history.replaceState(null, '', state.layout === 'optimal' ? `#${state.n}` : `#${state.n}/${state.layout}`);
}

function show(n: number, layout = 'optimal') {
  n = Math.min(MAX_N, Math.max(1, n));
  if (n === state.n && layout === state.layout) return;
  state.n = n;
  state.layout = layout;
  applyLayout();
}

const setCount = (n: number) => show(n);

/** Jump to a rocket: its own layout if it has one, else the optimal packing it flies. */
function showRocket(id: string) {
  const rocket = rocketById(id);
  if (rocket) show(rocket.n, rocket.layout ? rocket.id : 'optimal');
}

/** Fire every engine, or shut everything down if anything is running. */
function toggleFire() {
  rumble.wake();
  state.lit = state.lit.size ? new Set() : allEngines();
  engines.setLit(state.lit, now, true);
  refresh();
}

function fireAll() {
  rumble.wake();
  state.lit = allEngines();
  engines.setLit(state.lit, now, true);
  refresh();
}

function toggleEngine(i: number) {
  rumble.wake();
  if (state.lit.has(i)) state.lit.delete(i);
  else state.lit.add(i);
  engines.setLit(state.lit, now);
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
    if (state.sound && state.lit.size) rumble.wake();
    ui.setSound(state.sound);
  },
  toggleEngine,
  fireAll,
  layout: (id) => show(state.n, id),
  rocket: showRocket,
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
  } else if (e.key === 'a' && !inControl && state.lit.size < packing().n) {
    fireAll();
  }
});

window.addEventListener('hashchange', () => {
  const { n, layout } = readHash();
  show(n, layout);
});

/** Fire light intensity (candela) at full thrust. */
const FIRE_LIGHT = 80;
const sun = new THREE.Vector3();
function tick(dt: number) {
  now += dt;

  engines.update(now, dt);
  stage.fireLight.position.set(0, engines.exitY - 3, 0);
  stage.fireLight.intensity = engines.thrust * FIRE_LIGHT;
  smoke.update(dt, stage.camera, engines.thrust, engines.exitY, stage.sunInView(sun));
  rumble.update(engines.thrust);
  stage.render(dt, now, reduceMotion ? 0 : engines.thrust);
}

// With ?capture in dev (or a `--mode capture` build), a recording script steps
// time one frame at a time (scripts/demo/record.mjs), so the video is smooth
// whatever the render speed.
const canCapture = import.meta.env.DEV || import.meta.env.MODE === 'capture';
if (canCapture && new URLSearchParams(location.search).has('capture')) {
  stage.adaptive = false;
  stage.grain = 0;
  Object.assign(window, {
    __capture: { step: tick, stage },
  });
} else {
  let last = performance.now();
  const frame = (t: number) => {
    tick(Math.min((t - last) / 1000, 0.1));
    last = t;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
