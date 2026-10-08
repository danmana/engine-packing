// Records the demo video frame by frame.
//
//   npx vite build --mode capture --outDir .capture/site
//   npx vite preview --outDir .capture/site --port 5197     # in one terminal
//   BASE=http://localhost:5197 node scripts/demo/record.mjs # writes .capture/engine-packing-demo.mp4
//
// (A static capture build, so dev-server reloads can't interrupt a recording.)
//
// The page runs with ?capture, so nothing moves until this script steps time.
// Each frame: run due actions, place the fake cursor, step 1/FPS, screenshot.

import puppeteer from 'puppeteer-core';
import { mkdir, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const BASE = process.env.BASE ?? 'http://localhost:5173';
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
// A 1280 × 720 layout at 1.5× gives a 1920 × 1080 video with readable UI.
const W = 1280;
const H = 720;
const SCALE = 1.5;
const FPS = 30;
const DURATION = Number(process.env.DURATION ?? 37);
const OUT_DIR = '.capture';
const FRAMES = join(OUT_DIR, 'frames');
const VIDEO = join(OUT_DIR, 'engine-packing-demo.mp4');

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

// Storyboard. `at` is seconds into the video. Targets are CSS selectors, or
// functions returning a point, resolved when the action runs.
const tick = (n) => ({ ruler: n });
const STORY = [
  { at: 1.4, show: true },
  { at: 1.5, move: '#fire', dur: 1.1 },
  { at: 2.8, click: '#fire' },

  { at: 6.2, move: tick(33), dur: 1.0 },
  ...Array.from({ length: 14 }, (_, i) => ({ at: 7.4 + i * 0.22, scrub: 32 - i })), // 32 → 19
  ...Array.from({ length: 12 }, (_, i) => ({ at: 11.8 + i * 0.1, scrub: 18 - i })), // 18 → 7

  { at: 13.4, move: '[data-view="below"]', dur: 0.9 },
  { at: 14.4, click: '[data-view="below"]' },

  { at: 16.8, move: '#rockets-toggle', dur: 0.7 },
  { at: 17.6, click: '#rockets-toggle' },
  { at: 17.9, move: '[data-rocket="super-heavy"]', dur: 0.6 },
  { at: 18.6, click: '[data-rocket="super-heavy"]' },
  { at: 19.6, move: '[data-view="side"]', dur: 0.6 },
  { at: 20.3, click: '[data-view="side"]' },
  { at: 21.8, move: '#layout-switch [data-layout="optimal"]', dur: 0.9 },
  { at: 22.8, click: '#layout-switch [data-layout="optimal"]' },

  { at: 24.6, move: '#rockets-toggle', dur: 0.8 },
  { at: 25.5, click: '#rockets-toggle' },
  { at: 25.8, move: '[data-rocket="saturn-v"]', dur: 0.5 },
  { at: 26.4, click: '[data-rocket="saturn-v"]' },
  { at: 28.0, move: '#layout-switch [data-layout="optimal"]', dur: 0.8 },
  { at: 28.9, click: '#layout-switch [data-layout="optimal"]' },

  { at: 30.4, move: '#plan [data-i="3"]', dur: 0.8 },
  { at: 31.3, click: '#plan [data-i="3"]' },
  { at: 31.7, move: '#plan [data-i="4"]', dur: 0.5 },
  { at: 32.3, click: '#plan [data-i="4"]' },
  { at: 34.4, move: '#fire-all', dur: 0.7 },
  { at: 35.2, click: '#fire-all' },
  { at: 36.0, hide: true },
];

async function centre(page, target) {
  return page.evaluate((t) => {
    if (t.ruler) {
      const r = document.getElementById('ticks').getBoundingClientRect();
      return { x: r.left + ((t.ruler - 0.5) / 100) * r.width, y: r.top + r.height - 8 };
    }
    const el = document.querySelector(t);
    if (!el) throw new Error(`missing ${t}`);
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, target);
}

await rm(FRAMES, { recursive: true, force: true });
await mkdir(FRAMES, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  defaultViewport: { width: W, height: H, deviceScaleFactor: SCALE },
  args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--use-angle=metal', '--hide-scrollbars'],
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('page error:', e.message));
await page.goto(`${BASE}/?capture#33`, { waitUntil: 'networkidle0' });
await page.evaluate(() => document.fonts.ready);
console.log(
  'renderer:',
  await page.evaluate(() => {
    const gl = document.querySelector('canvas').getContext('webgl2');
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
  })
);

// A visible cursor, since scripted clicks have none.
await page.evaluate(() => {
  const c = document.createElement('div');
  c.id = 'demo-cursor';
  c.innerHTML = '<i></i>';
  Object.assign(c.style, {
    position: 'fixed',
    left: '0',
    top: '0',
    width: '26px',
    height: '26px',
    marginLeft: '-13px',
    marginTop: '-13px',
    borderRadius: '50%',
    background: 'rgba(247, 233, 212, 0.92)',
    boxShadow: '0 0 0 2px rgba(3, 11, 34, 0.55), 0 4px 14px rgba(3, 11, 34, 0.5)',
    pointerEvents: 'none',
    zIndex: '99',
    opacity: '0',
  });
  const ring = c.firstChild;
  Object.assign(ring.style, {
    position: 'absolute',
    inset: '-2px',
    borderRadius: '50%',
    border: '2px solid rgba(247, 233, 212, 0.9)',
    opacity: '0',
  });
  document.body.append(c);
  window.__cursor = (x, y, opacity, press, ring) => {
    c.style.transform = `translate(${x}px, ${y}px) scale(${1 - press * 0.25})`;
    c.style.opacity = String(opacity);
    c.firstChild.style.transform = `scale(${1 + ring * 1.6})`;
    c.firstChild.style.opacity = String(ring > 0 ? 1 - ring : 0);
  };
});

let cursor = { x: W * 0.78, y: H * 0.7 };
let path = null; // { from, to, t0, dur }
let opacity = 0;
let opacityTarget = 0;
let lastClick = -10;
const done = new Set();
const total = Math.round(DURATION * FPS);

for (let f = 0; f < total; f++) {
  const t = f / FPS;
  for (const [i, a] of STORY.entries()) {
    if (done.has(i) || a.at > t) continue;
    done.add(i);
    if (a.show) opacityTarget = 1;
    if (a.hide) opacityTarget = 0;
    if (a.move) path = { from: { ...cursor }, to: await centre(page, a.move), t0: t, dur: a.dur };
    if (a.click) {
      lastClick = t;
      // dispatchEvent, since SVG elements (the plan's engines) have no click().
      await page.evaluate(
        (sel) => document.querySelector(sel).dispatchEvent(new MouseEvent('click', { bubbles: true })),
        a.click
      );
    }
    if (a.scrub) {
      cursor = await centre(page, tick(a.scrub));
      path = null;
      await page.evaluate((n) => {
        const input = document.getElementById('count');
        input.value = String(n);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }, a.scrub);
    }
  }
  if (path) {
    const k = Math.min(1, (t - path.t0) / path.dur);
    const e = ease(k);
    cursor = { x: path.from.x + (path.to.x - path.from.x) * e, y: path.from.y + (path.to.y - path.from.y) * e };
    if (k >= 1) path = null;
  }
  opacity += (opacityTarget - opacity) * 0.2;
  const sinceClick = t - lastClick;
  const press = sinceClick < 0.18 ? Math.sin((sinceClick / 0.18) * Math.PI) : 0;
  const ring = sinceClick < 0.45 ? sinceClick / 0.45 : 0;
  await page.evaluate((x, y, o, p, r) => window.__cursor(x, y, o, p, r), cursor.x, cursor.y, opacity, press, ring);

  await page.evaluate((dt) => window.__capture.step(dt), 1 / FPS);
  await page.screenshot({
    path: join(FRAMES, `${String(f).padStart(5, '0')}.jpg`),
    type: 'jpeg',
    quality: 94,
    optimizeForSpeed: true,
  });
  if (f % FPS === 0) process.stdout.write(`\r${t.toFixed(0)}s / ${DURATION}s`);
}
console.log();
await browser.close();

execFileSync(
  'ffmpeg',
  [
    '-y',
    '-loglevel',
    'error',
    '-framerate',
    String(FPS),
    '-i',
    join(FRAMES, '%05d.jpg'),
    '-c:v',
    'libx264',
    '-preset',
    'slow',
    '-crf',
    '18',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    VIDEO,
  ],
  { stdio: 'inherit' }
);
console.log(`wrote ${VIDEO}`);
