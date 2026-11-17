// Browser front end: side-view rendering, controls, live chart, experiment.
import { Simulation, DEFAULTS } from './sim.js';
import { GAPS, EXP_DAYS, runGap, runNoTape, summarise, mean } from './experiment.js';
import { drawLineChart } from './chart.js';

const css = getComputedStyle(document.documentElement);
const color = (name) => css.getPropertyValue(name).trim();
const C = {
  muted: color('--muted'),
  line: color('--line'),
  text: color('--text'),
  fly: color('--fly'),
  trap: color('--trap'),
  s1: color('--series-1'),
  s2: color('--series-2'),
  s3: color('--series-3'),
};

const $ = (id) => document.getElementById(id);
const world = $('world');
const ctx = world.getContext('2d');

const VIEW_TOP = 3.7; // metres shown above the floor
const STEPS_PER_FRAME_1X = 1; // 15 simulated minutes per frame at 1×
const STOP_DAY = 90;

const params = { ...DEFAULTS };
const SLIDERS = ['tapeHeight', 'canopyHeight', 'canopyGrowth', 'tempMean', 'initialAdults', 'detectThreshold'];
const LIVE = new Set(['tapeHeight', 'canopyHeight', 'canopyGrowth', 'tempMean', 'detectThreshold']);

let sim;
let running = !matchMedia('(prefers-reduced-motion: reduce)').matches;
let speed = 4;

function newSim(seed) {
  sim = new Simulation(params, seed, { dtHours: 0.25 });
  sim.keepFlights = true;
}
newSim(1);

// ---------- Canvas ----------
let W = 0;
let H = 0;
let dpr = 1;
function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  W = world.clientWidth;
  H = world.clientHeight;
  world.width = Math.round(W * dpr);
  world.height = Math.round(H * dpr);
  draw();
  drawLive();
}
new ResizeObserver(resize).observe(world);

const PAD = { l: 36, r: 54, t: 26, b: 14 };
const sx = (x) => PAD.l + (x / params.rowLength) * (W - PAD.l - PAD.r);
const sz = (z) => PAD.t + (1 - z / VIEW_TOP) * (H - PAD.t - PAD.b);

function skyColor(hourOfDay) {
  // Darker at night, lighter by day.
  const light = Simulation.daylightWeight(hourOfDay) > 0 ? 1 : 0;
  return light ? '#15241c' : '#0b1310';
}

function draw() {
  if (!W) return;
  const p = sim.p;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const hour = sim.hours % 24;
  ctx.fillStyle = skyColor(hour);
  ctx.fillRect(0, 0, W, H);

  // Height axis.
  ctx.font = '11px system-ui, sans-serif';
  ctx.fillStyle = C.muted;
  ctx.strokeStyle = C.line;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let m = 0; m <= 3; m++) {
    const y = Math.round(sz(m)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(PAD.l, y);
    ctx.lineTo(W - PAD.r, y);
    ctx.stroke();
    ctx.fillText(`${m} m`, PAD.l - 6, y);
  }

  // Floor.
  ctx.fillStyle = '#0a110e';
  ctx.fillRect(PAD.l, sz(0), W - PAD.l - PAD.r, H - sz(0));

  // Plants: stems up to the canopy top, the young-leaf layer on top.
  const top = sim.canopyTop();
  const layerTop = sz(top);
  const layerBottom = sz(top - p.topLayer);
  ctx.strokeStyle = '#2a5a33';
  ctx.lineWidth = 1;
  for (let i = 0; i < sim.nPlants; i++) {
    const x = Math.round(sx((i + 0.5) * p.plantSpacing)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, sz(0));
    ctx.lineTo(x, layerTop);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(47, 110, 59, 0.2)';
  ctx.fillRect(sx(0), sz(top * 0.92), sx(p.rowLength) - sx(0), sz(0.15) - sz(top * 0.92));
  ctx.fillStyle = 'rgba(79, 154, 88, 0.55)';
  ctx.fillRect(sx(0), layerTop, sx(p.rowLength) - sx(0), layerBottom - layerTop);

  // Tape and its segments.
  const tTop = sz(p.tapeHeight + p.tapeBand / 2);
  const tBot = sz(p.tapeHeight - p.tapeBand / 2);
  ctx.fillStyle = C.trap;
  ctx.fillRect(sx(0), tTop, sx(p.rowLength) - sx(0), Math.max(3, tBot - tTop));
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  for (let s = 0; s < p.tapeSegments; s++) {
    const x0 = sx((s / p.tapeSegments) * p.rowLength);
    const x1 = sx(((s + 1) / p.tapeSegments) * p.rowLength);
    if (s > 0) {
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(Math.round(x0), tTop, 1, Math.max(3, tBot - tTop));
    }
    ctx.fillStyle = sim.segments[s] > 0 ? C.trap : C.muted;
    ctx.fillText(String(sim.segments[s]), (x0 + x1) / 2, tTop - 3);
  }

  // Caught flies on the tape.
  ctx.fillStyle = '#3d3408';
  for (const c of sim.caught) ctx.fillRect(sx(c.x) - 1.5, sz(c.z) - 1.5, 3, 3);

  // Recent flights (last ~1.5 simulated hours).
  const now = sim.hours;
  for (const f of sim.flights) {
    const age = now - f.t;
    if (age > 1.5) continue;
    const a = 1 - age / 1.5;
    ctx.strokeStyle = f.caught ? `rgba(242, 210, 27, ${a})` : `rgba(244, 247, 242, ${0.35 * a})`;
    ctx.lineWidth = f.caught ? 1.5 : 1;
    const x0 = sx(f.x0);
    const x1 = sx(f.x1);
    const peak = Math.min(sz(Math.max(f.z0, f.z1) + 0.25), sz(f.z1));
    ctx.beginPath();
    ctx.moveTo(x0, sz(f.z0));
    ctx.quadraticCurveTo((x0 + x1) / 2, peak, x1, sz(f.z1));
    ctx.stroke();
  }

  // Adults in the young-leaf layer.
  ctx.fillStyle = C.fly;
  for (const a of sim.adults) ctx.fillRect(sx(a.x) - 1.5, sz(top - a.depth) - 1.5, 3, 3);

  // Gap dimension on the right.
  const gx = W - PAD.r + 14;
  const g = sim.gap();
  ctx.strokeStyle = C.muted;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(gx, sz(p.tapeHeight));
  ctx.lineTo(gx, sz(top));
  ctx.moveTo(gx - 4, sz(p.tapeHeight));
  ctx.lineTo(gx + 4, sz(p.tapeHeight));
  ctx.moveTo(gx - 4, sz(top));
  ctx.lineTo(gx + 4, sz(top));
  ctx.stroke();
  ctx.fillStyle = C.text;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('gap', gx + 6, (sz(p.tapeHeight) + sz(top)) / 2 - 7);
  ctx.fillText(`${g >= 0 ? '' : '−'}${Math.abs(g).toFixed(2)} m`, gx + 6, (sz(p.tapeHeight) + sz(top)) / 2 + 7);

  // Where the infestation started.
  ctx.fillStyle = C.muted;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('▲ first flies arrived here', sx(sim.originX), sz(0) + 1);
}

// ---------- Stats and live chart ----------
const fmt = new Intl.NumberFormat('en');
function clock() {
  const d = Math.floor(sim.day);
  const h = Math.floor(sim.hours % 24);
  return `Day ${d}, ${String(h).padStart(2, '0')}:00`;
}

function updateTiles() {
  const s = sim.summary();
  $('s-time').textContent = clock();
  $('s-adults').textContent = fmt.format(s.adults) + (s.capped ? '+' : '');
  $('s-immature').textContent = fmt.format(s.immature);
  $('s-caught').textContent = fmt.format(s.caught);
  const tile = $('s-detect').closest('.tile');
  if (s.detectDay !== null) {
    $('s-detect').textContent = `Detected, day ${Math.floor(s.detectDay)}`;
    tile.classList.add('hit');
  } else {
    $('s-detect').textContent = s.caught > 0 ? `${s.caught} of ${sim.p.detectThreshold} needed` : 'Nothing yet';
    tile.classList.remove('hit');
  }
  const g = sim.gap();
  $('gap-note').textContent =
    g >= 0
      ? `Canopy top is ${g.toFixed(2)} m below the tape.`
      : `The crop has grown ${(-g).toFixed(2)} m past the tape, so leaves partly hide it.`;
}

function drawLive() {
  const h = sim.history;
  drawLineChart(
    $('live-chart'),
    [
      { data: h.map((p) => p.adults), color: C.s1 },
      { data: h.map((p) => p.caught), color: C.s2 },
    ],
    {
      colors: C,
      log: true,
      xLabel: 'day',
      yLabel: 'count (log scale)',
      marker: sim.detectDay !== null ? { x: Math.floor(sim.detectDay), label: 'tape detects' } : null,
    },
  );
}

// ---------- Main loop ----------
let frameCount = 0;
function frame() {
  if (running) {
    const steps = STEPS_PER_FRAME_1X * speed;
    for (let i = 0; i < steps; i++) sim.step();
    if (sim.day >= STOP_DAY) setRunning(false);
    draw();
    if (++frameCount % 10 === 0) {
      updateTiles();
      drawLive();
    }
  }
  requestAnimationFrame(frame);
}

// ---------- Controls ----------
function setRunning(v) {
  running = v;
  $('play').textContent = running ? 'Pause' : 'Play';
  updateTiles();
  drawLive();
}
$('play').addEventListener('click', () => {
  if (!running && sim.day >= STOP_DAY) reset();
  setRunning(!running);
});
$('speed').addEventListener('change', (e) => {
  speed = Number(e.target.value);
});

function reset() {
  const seed = Math.max(0, Math.floor(Number($('seed').value) || 0));
  newSim(seed);
  draw();
  updateTiles();
  drawLive();
}
$('reset').addEventListener('click', reset);

for (const id of SLIDERS) {
  const input = $(id);
  const out = $(`o-${id}`);
  input.value = params[id];
  out.textContent = input.value;
  input.addEventListener('input', () => {
    params[id] = Number(input.value);
    out.textContent = input.value;
    if (LIVE.has(id)) sim.p[id] = params[id];
    draw();
    updateTiles();
  });
}

// ---------- Experiment ----------
const SEEDS = Array.from({ length: 10 }, (_, i) => i + 1);
const gapLabels = GAPS.map((g) => `${g} m`);
const pause = () => new Promise((r) => setTimeout(r, 0));

$('run-exp').addEventListener('click', async () => {
  const btn = $('run-exp');
  btn.disabled = true;
  const expParams = { ...params };
  const opts = { params: expParams };

  $('exp-status').textContent = 'Running the no-tape baseline…';
  await pause();
  const base = mean(SEEDS.map((s) => runNoTape(s, opts).adults));

  const rows = [];
  for (const g of GAPS) {
    $('exp-status').textContent = `Running gap ${g} m (${rows.length + 1} of ${GAPS.length})…`;
    await pause();
    rows.push(summarise(g, SEEDS.map((s) => runGap(g, s, opts)), base));
  }

  drawLineChart(
    $('exp-chart-days'),
    [
      { data: rows.map((r) => r.firstCatchDay), color: C.s3, dots: true },
      { data: rows.map((r) => r.detectDay), color: C.s2, dots: true },
    ],
    { colors: C, xLabels: gapLabels, xLabel: 'gap between canopy top and tape', yLabel: 'day' },
  );
  drawLineChart(
    $('exp-chart-size'),
    [{ data: rows.map((r) => r.adultsAtDetect), color: C.s1, dots: true }],
    { colors: C, xLabels: gapLabels, xLabel: 'gap between canopy top and tape', yLabel: 'adult whiteflies' },
  );

  const day = (v) => (v === null ? '—' : `day ${Math.round(v)}`);
  const num = (v) => (v === null ? '—' : fmt.format(Math.round(v)));
  $('exp-table').querySelector('tbody').innerHTML = rows
    .map(
      (r) => `<tr><td>${r.gap} m</td><td>${day(r.firstCatchDay)}</td><td>${day(r.detectDay)}</td>
        <td>${num(r.adultsAtDetect)}</td><td>${num(r.immatureAtDetect)}</td>
        <td>${Math.round(r.missed * 100)}%</td><td>${Math.round(r.reduction * 100)}%</td></tr>`,
    )
    .join('');
  $('exp-table').hidden = false;
  const summary = summaryText(rows);
  $('exp-summary').textContent = summary;
  $('exp-summary').hidden = !summary;
  $('exp-status').textContent = `Done: ${GAPS.length * SEEDS.length + SEEDS.length} runs of ${EXP_DAYS} days. "—" means the tape did not reach the threshold in any run.`;
  btn.disabled = false;
});

/** Plain-language reading of the experiment table. */
function summaryText(rows) {
  const best = rows[0];
  if (best.detectDay === null) {
    return 'At these settings the tape did not detect the infestation within 60 days, even with no gap. Try a warmer greenhouse or a lower detection threshold.';
  }
  const parts = [
    `With the tape right at the canopy top, it detects the infestation around day ${Math.round(best.detectDay)}, ` +
      `when about ${fmt.format(Math.round(best.adultsAtDetect))} adults and ${fmt.format(Math.round(best.immatureAtDetect))} eggs and nymphs are already in the row.`,
  ];
  const mid = rows.find((r) => r.gap === 0.5);
  if (mid && mid.detectDay !== null) {
    const weeks = (mid.detectDay - best.detectDay) / 7;
    parts.push(`With a 0.5 m gap it takes until about day ${Math.round(mid.detectDay)}, roughly ${weeks.toFixed(1)} weeks later.`);
  } else if (mid) {
    parts.push('With a 0.5 m gap the tape never reached the threshold.');
  }
  const firstMiss = rows.find((r) => r.missed >= 0.5);
  if (firstMiss) parts.push(`From a ${firstMiss.gap} m gap on, the tape misses the infestation in at least half of the runs.`);
  return parts.join(' ');
}

// ---------- Model tabs ----------
const tabs = [...document.querySelectorAll('.tabs [role="tab"]')];
function selectTab(tab, focus = false) {
  for (const t of tabs) {
    const on = t === tab;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
    $(t.getAttribute('aria-controls')).hidden = !on;
  }
  if (focus) tab.focus();
}
tabs.forEach((tab, i) => {
  tab.addEventListener('click', () => selectTab(tab));
  tab.addEventListener('keydown', (e) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    selectTab(tabs[(i + step + tabs.length) % tabs.length], true);
  });
});
for (const link of document.querySelectorAll('a[data-tab]')) {
  link.addEventListener('click', () => selectTab($(link.dataset.tab)));
}

// ---------- Shareable links: ?gap=0.8 ?seed=3 ?speed=8 ?warmup=40 ----------
const query = new URLSearchParams(location.search);
if (query.has('gap')) {
  const g = Number(query.get('gap'));
  if (Number.isFinite(g)) {
    params.canopyHeight = params.tapeHeight - g;
    $('canopyHeight').value = params.canopyHeight;
    $('o-canopyHeight').textContent = $('canopyHeight').value;
  }
}
if (query.has('seed')) $('seed').value = query.get('seed');
if (['1', '2', '4', '8'].includes(query.get('speed'))) {
  speed = Number(query.get('speed'));
  $('speed').value = String(speed);
}
reset();
const warmup = Math.min(STOP_DAY, Math.max(0, Number(query.get('warmup')) || 0));
if (warmup > 0) sim.runDays(warmup);

setRunning(running);
resize();
requestAnimationFrame(frame);
if (query.has('runexp')) $('run-exp').click();
