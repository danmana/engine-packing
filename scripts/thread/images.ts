import '@fontsource-variable/archivo/wdth.css';
import { PACKINGS, isBalanced, type Packing } from '../../src/data';
import { ROCKETS } from '../../src/rockets';

const ROCKET_COUNTS = new Set(ROCKETS.map((r) => r.n));

function plan(p: Packing, size: number, extra = '') {
  const circles = Array.from(
    { length: p.n },
    (_, i) =>
      `<circle class="engine" cx="${p.pts[2 * i].toFixed(4)}" cy="${(-p.pts[2 * i + 1]).toFixed(4)}" r="${(p.r * 0.94).toFixed(4)}"/>`
  ).join('');
  return `<svg width="${size}" height="${size}" viewBox="-1.06 -1.06 2.12 2.12">
    <circle class="bay" r="1" vector-effect="non-scaling-stroke"/>${circles}${extra}</svg>`;
}

const wider = (p: Packing) => Math.round((PACKINGS[p.n - 1].r / p.r - 1) * 100);

function rocketsCard() {
  const shown = ROCKETS.filter((r) => r.layout);
  const already = ROCKETS.filter((r) => !r.layout).map((r) => (r.id === 'falcon-9' ? 'Falcon 9’s Octaweb' : r.name));
  return `
    <h1>Real rockets vs the optimal packing</h1>
    <p class="sub">Same engine bay, same number of engines, each engine as large as its pattern allows.</p>
    <div class="rockets">
      ${shown
        .map(
          (r) => `<section class="rocket">
            <h2>${r.name}</h2>
            <p class="n">${r.n} engines</p>
            <div class="real">${plan(r.layout!, 210)}</div>
            <p class="label">Real pattern</p>
            ${plan(PACKINGS[r.n - 1], 210)}
            <p class="label">Optimal: nozzles <em>${wider(r.layout!)}&nbsp;%</em> wider</p>
          </section>`
        )
        .join('')}
    </div>
    <div class="foot">
      <span>Already optimal: ${already.slice(0, -1).join(', ')} and ${already.at(-1)}</span>
      <b>engine-packing.vercel.app</b>
    </div>`;
}

function galleryCard() {
  return `
    <h1>The best-known packings of 1 to 100 circles</h1>
    <p class="sub">Proven optimal up to 14 and at 19; the rest are the best anyone has found. Coordinates from Eckard Specht’s Packomania.</p>
    <div class="gallery">
      ${PACKINGS.map(
        (p) => `<div class="cell${ROCKET_COUNTS.has(p.n) ? ' rocket-n' : ''}">
          ${plan(p, 64, isBalanced(p) ? '<circle class="dot" r="0.13"/>' : '')}
          <span>${p.n}</span>
        </div>`
      ).join('')}
    </div>
    <div class="foot">
      <div class="legend"><span class="k-rocket">Engine counts real rockets fly</span><span class="k-balanced">Thrust perfectly centred</span></div>
      <b>engine-packing.vercel.app</b>
    </div>`;
}

const card = document.getElementById('card')!;
const render = () => (card.innerHTML = location.hash === '#gallery' ? galleryCard() : rocketsCard());
render();
window.addEventListener('hashchange', render);
