import { BAY_RADIUS, LEVER_ARM, MAX_N, PACKINGS, isBalanced, type Balance, type Packing } from './data';
import { ROCKETS, rocketById, rocketsWith } from './rockets';
import type { View } from './scene';

export interface UiHandlers {
  count(n: number): void;
  fire(): void;
  view(v: View): void;
  sound(): void;
  toggleEngine(i: number): void;
  fireAll(): void;
  /** 'optimal' or a rocket id, for the current engine count. */
  layout(id: string): void;
  rocket(id: string): void;
}

const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector(sel) as T;

export function formatOffset(m: number) {
  if (m === 0) return '0 mm';
  const mm = m * 1000;
  if (mm < 0.1) return '< 0.1 mm';
  if (mm < 10) return `${mm.toFixed(1)} mm`;
  if (mm < 1000) return `${Math.round(mm)} mm`;
  return `${m.toFixed(2)} m`;
}

export function formatAngle(deg: number) {
  if (deg === 0) return '0°';
  if (deg < 0.001) return '< 0.001°';
  if (deg < 0.1) return `${deg.toFixed(3)}°`;
  if (deg < 10) return `${deg.toFixed(2)}°`;
  return `${deg.toFixed(1)}°`;
}

export function symmetryOf(p: Packing) {
  if (p.rotation === 0) return 'Circular';
  const mirrored = p.mirrors.length > 0;
  if (p.rotation >= 2) return mirrored ? `${p.rotation}-fold, mirrored` : `${p.rotation}-fold rotation`;
  return mirrored ? 'Mirror only' : 'None';
}

/** Super Heavy flies 33 engines; the ruler labels that count. */
const SUPER_HEAVY = 33;

// Storage can be unavailable (private mode, blocked site data); the default then applies.
function remembered(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function remember(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

export class Ui {
  private ticks: HTMLElement[] = [];
  private landmark = document.createElement('button');
  private tip = $('#tip');
  private range = $<HTMLInputElement>('#count');
  private plan = $<SVGSVGElement>('#plan');
  private fireBtn = $<HTMLButtonElement>('#fire');
  private fireAllBtn = $<HTMLButtonElement>('#fire-all');
  private soundBtn = $<HTMLButtonElement>('#sound');
  private layoutSwitch = $('#layout-switch');
  private rockets = $('#rockets');
  private rocketsToggle = $<HTMLButtonElement>('#rockets-toggle');
  private rocketButtons: HTMLButtonElement[] = [];
  private readout = $('#readout');
  private detailsToggle = $<HTMLButtonElement>('#details-toggle');
  private announceTimer = 0;

  constructor(private on: UiHandlers) {
    this.buildRuler();

    this.fireBtn.addEventListener('click', () => on.fire());
    this.fireAllBtn.addEventListener('click', () => on.fireAll());
    this.soundBtn.addEventListener('click', () => on.sound());
    this.detailsToggle.addEventListener('click', () => this.setDetails(!this.readout.classList.contains('open')));
    this.setDetails(remembered('details-open') === '1');
    document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((b) =>
      b.addEventListener('click', () => on.view(b.dataset.view as View))
    );
    this.layoutSwitch.addEventListener('click', (e) => {
      const b = (e.target as Element).closest<HTMLElement>('[data-layout]');
      if (b) on.layout(b.dataset.layout!);
    });
    this.buildRocketList();
    this.plan.addEventListener('click', (e) => {
      const el = (e.target as Element).closest('[data-i]');
      if (el) on.toggleEngine(Number(el.getAttribute('data-i')));
    });
  }

  private buildRocketList() {
    const list = $('#rocket-list');
    for (const r of ROCKETS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.rocket = r.id;
      b.innerHTML = `<span>${r.name}</span><span class="engines">${r.n}</span>`;
      b.setAttribute('aria-label', `${r.name}, ${r.n} engines`);
      b.addEventListener('click', () => {
        this.on.rocket(r.id);
        this.setRocketsOpen(false);
      });
      const li = document.createElement('li');
      li.append(b);
      list.append(li);
      this.rocketButtons.push(b);
    }
    this.rocketsToggle.addEventListener('click', () =>
      this.setRocketsOpen(this.rocketsToggle.getAttribute('aria-expanded') !== 'true')
    );
    // Tapping anywhere else closes it.
    document.addEventListener('pointerdown', (e) => {
      const t = e.target as Node;
      if (!this.rockets.contains(t) && !this.rocketsToggle.contains(t)) this.setRocketsOpen(false);
    });
  }

  /** Phones only: the rocket list opens under the top bar. */
  private setRocketsOpen(open: boolean) {
    this.rockets.classList.toggle('open', open);
    this.rocketsToggle.setAttribute('aria-expanded', String(open));
  }

  private buildRuler() {
    const ticks = $('#ticks');
    const scale = $('#scale');
    const densities = PACKINGS.map((p) => p.n * p.r * p.r);
    PACKINGS.forEach((p, i) => {
      const t = document.createElement('i');
      const h = Math.min(1, Math.max(0, (densities[i] - 0.6) / 0.25));
      t.style.setProperty('--h', h.toFixed(3));
      if (isBalanced(p)) t.classList.add('balanced');
      if (rocketsWith(p.n).length) t.classList.add('landmark');
      ticks.append(t);
      this.ticks.push(t);
    });
    // Real rockets get orange ticks; Super Heavy also gets a label.
    this.landmark.type = 'button';
    this.landmark.className = 'ruler-label';
    this.landmark.textContent = 'Super Heavy';
    this.landmark.setAttribute('aria-label', `Show Super Heavy's ${SUPER_HEAVY}-engine layout`);
    this.landmark.style.left = `${((SUPER_HEAVY - 0.5) / MAX_N) * 100}%`;
    this.landmark.addEventListener('click', () => this.on.rocket('super-heavy'));
    ticks.before(this.landmark);

    for (const n of [1, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].filter((n) => n <= MAX_N)) {
      const s = document.createElement('span');
      s.textContent = String(n);
      s.style.left = `${((n - 0.5) / MAX_N) * 100}%`;
      scale.append(s);
    }

    const nAt = (clientX: number) => {
      const rect = ticks.getBoundingClientRect();
      const n = Math.floor(((clientX - rect.left) / rect.width) * MAX_N) + 1;
      return Math.min(MAX_N, Math.max(1, n));
    };
    let dragging = false;
    let hovered = -1;
    const hover = (n: number) => {
      if (hovered >= 0) this.ticks[hovered - 1]?.classList.remove('hover');
      hovered = n;
      // Step the label aside while the hover number is close to it.
      this.landmark.classList.toggle('faded', n > 0 && Math.abs(n - SUPER_HEAVY) <= 6);
      if (n < 0) {
        this.tip.hidden = true;
        return;
      }
      this.ticks[n - 1].classList.add('hover');
      this.tip.hidden = false;
      const names = rocketsWith(n).map((r) => r.name);
      this.tip.innerHTML = names.length ? `${n} <span>${names.join(', ')}</span>` : String(n);
      this.tip.style.left = `${((n - 0.5) / MAX_N) * 100}%`;
    };
    ticks.addEventListener('pointerdown', (e) => {
      dragging = true;
      ticks.setPointerCapture(e.pointerId);
      this.on.count(nAt(e.clientX));
    });
    ticks.addEventListener('pointermove', (e) => {
      const n = nAt(e.clientX);
      if (dragging) this.on.count(n);
      if (e.pointerType === 'mouse') hover(n);
    });
    const end = () => (dragging = false);
    ticks.addEventListener('pointerup', end);
    ticks.addEventListener('pointercancel', end);
    ticks.addEventListener('pointerleave', () => hover(-1));
    this.range.max = String(MAX_N);
    this.range.addEventListener('input', () => this.on.count(Number(this.range.value)));
  }

  setCount(n: number, layout: string) {
    this.ticks.forEach((t, i) => t.classList.toggle('on', i === n - 1));
    this.range.value = String(n);
    $('#n').textContent = String(n);
    $('#unit').textContent = n === 1 ? 'engine' : 'engines';
    this.landmark.classList.toggle('on', n === SUPER_HEAVY);

    // Offer each real layout flown with this many engines.
    const own = rocketsWith(n).filter((r) => r.layout);
    this.layoutSwitch.hidden = own.length === 0;
    this.layoutSwitch.setAttribute('aria-label', `Layout for ${n} engines`);
    this.layoutSwitch.innerHTML = [{ id: 'optimal', name: 'Optimal packing' }, ...own]
      .map(
        (o) =>
          `<button type="button" role="radio" aria-checked="${o.id === layout}" data-layout="${o.id}">${o.name}</button>`
      )
      .join('');

    for (const b of this.rocketButtons) {
      const r = rocketById(b.dataset.rocket!)!;
      const current = r.n === n && (r.layout ? layout === r.id : layout === 'optimal');
      b.setAttribute('aria-current', String(current));
    }
  }

  /** Phones only: show or hide the stats under the engine count. */
  setDetails(open: boolean) {
    this.readout.classList.toggle('open', open);
    this.detailsToggle.setAttribute('aria-expanded', String(open));
    this.detailsToggle.textContent = open ? 'Hide details' : 'Show details';
    remember('details-open', open ? '1' : '0');
  }

  setFiring(on: boolean) {
    this.fireBtn.setAttribute('aria-pressed', String(on));
    this.fireBtn.querySelector('.label')!.textContent = on ? 'Shut down' : 'Fire engines';
  }

  setSound(on: boolean) {
    this.soundBtn.setAttribute('aria-pressed', String(on));
    this.soundBtn.textContent = on ? 'Sound on' : 'Sound off';
  }

  setView(v: View | null) {
    document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((b) =>
      b.setAttribute('aria-pressed', String(b.dataset.view === v))
    );
  }

  render(p: Packing, b: Balance, lit: ReadonlySet<number>) {
    const partial = lit.size > 0 && lit.size < p.n;

    // First row describes the packing, second row its balance.
    const rows: [string, string][] = [
      ['Nozzle exit', `${(2 * p.r * BAY_RADIUS).toFixed(2)} m`],
      ['Area filled', `${(p.n * p.r * p.r * 100).toFixed(1)} %`],
      ['Symmetry', symmetryOf(p)],
      ['Packing', p.kind === 'real' ? 'Real pattern' : p.proven ? 'Proven optimal' : 'Best known'],
      ['Thrust off-centre', formatOffset(b.offset)],
      ['Gimbal to correct', formatAngle(b.gimbal)],
    ];
    if (partial) rows.push(['Thrust', `${Math.round((b.active / p.n) * 100)} %`]);
    else if (p.rattlers.length) rows.push(['Rattlers', `${p.rattlers.length} loose`]);

    $('#stats').innerHTML = rows
      .map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`)
      .join('');

    let note = `Gimbal assumes the centre of mass sits ${LEVER_ARM} m above the engines.`;
    if (b.gimbal > 10) note = 'That is more gimbal than most engines can manage.';
    else if (p.kind === 'real') note = rocketById(p.id)?.note ?? note;
    else if (rocketsWith(p.n).some((r) => !r.layout)) note = rocketsWith(p.n).find((r) => !r.layout)!.note;
    else if (p.rattlers.length && !partial)
      note = 'Rattlers are engines the packing doesn’t lock in place. Where they sit shifts the balance.';
    $('#note').textContent = note;

    this.fireAllBtn.hidden = !partial;
    this.renderPlan(p, b, lit);

    window.clearTimeout(this.announceTimer);
    this.announceTimer = window.setTimeout(() => {
      $('#announce').textContent = `${p.n} engines. Symmetry: ${symmetryOf(p)}. Thrust off-centre ${formatOffset(
        b.offset
      )}.`;
    }, 500);
  }

  private renderPlan(p: Packing, b: Balance, lit: ReadonlySet<number>) {
    const f = (v: number) => v.toFixed(4);
    const parts: string[] = ['<circle class="bay" r="1"/>'];
    for (const a of p.mirrors) {
      const x = Math.cos(a) * 1.07;
      const y = -Math.sin(a) * 1.07;
      parts.push(`<line class="axis" x1="${f(-x)}" y1="${f(-y)}" x2="${f(x)}" y2="${f(y)}"/>`);
    }
    for (const [i, j] of p.pairs) {
      parts.push(
        `<line class="contact" x1="${f(p.pts[2 * i])}" y1="${f(-p.pts[2 * i + 1])}" x2="${f(p.pts[2 * j])}" y2="${f(
          -p.pts[2 * j + 1]
        )}"/>`
      );
    }
    const rattlers = new Set(p.rattlers);
    for (let i = 0; i < p.n; i++) {
      const cls = ['engine', rattlers.has(i) ? 'rattler' : '', lit.has(i) ? 'lit' : ''].join(' ').trim();
      parts.push(
        `<circle class="${cls}" data-i="${i}" cx="${f(p.pts[2 * i])}" cy="${f(-p.pts[2 * i + 1])}" r="${f(
          p.r * 0.96
        )}"><title>Engine ${i + 1}, ${lit.has(i) ? 'firing' : 'off'}</title></circle>`
      );
    }
    parts.push('<path class="centre" d="M-0.07 0H0.07M0 -0.07V0.07"/>');
    if (b.offset > 0) parts.push(`<line class="lever" x1="0" y1="0" x2="${f(b.cx)}" y2="${f(-b.cy)}"/>`);
    parts.push(`<circle class="thrust" cx="${f(b.cx)}" cy="${f(-b.cy)}" r="0.032"/>`);
    this.plan.innerHTML = parts.join('');
    this.plan.classList.toggle('firing', lit.size > 0);
    this.plan.setAttribute(
      'aria-label',
      `Plan of ${p.n} engines seen from below, ${lit.size} firing. Thrust centre ${formatOffset(b.offset)} from the axis.`
    );
  }
}
