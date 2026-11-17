// Minimal dependency-free line chart for <canvas>.

// Round the axis top up so each of the 4 grid steps is 1, 2 or 5 × 10^k.
function niceMax(v) {
  if (v <= 0) return 4;
  const raw = v / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 5, 10]) if (raw <= m * mag) return 4 * m * mag;
  return 40 * mag;
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{data:(number|null)[], color:string, dots?:boolean}[]} series one value per x index; null = gap
 * @param {object} opts
 *   colors     {muted, line}
 *   log        log10 y axis (values are counts, 0 shown at the bottom)
 *   xLabels    category labels, one per index (otherwise indices are numbered)
 *   xLabel, yLabel  axis captions
 *   marker     {x, label} vertical marker at an index
 */
export function drawLineChart(canvas, series, opts) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const pad = { l: 46, r: 16, t: opts.yLabel ? 22 : 10, b: opts.xLabel ? 38 : 26 };
  const pw = w - pad.l - pad.r;
  const ph = h - pad.t - pad.b;
  const n = Math.max(2, ...series.map((s) => s.data.length));
  const xmax = n - 1;
  const values = series.flatMap((s) => s.data).filter((v) => v !== null && Number.isFinite(v));
  const vmax = Math.max(1, ...values);

  let yOf;
  let ticks;
  if (opts.log) {
    const top = Math.ceil(Math.log10(vmax + 1));
    const span = Math.max(1, top);
    yOf = (v) => pad.t + ph - (Math.log10(Math.max(0, v) + 1) / span) * ph;
    ticks = [0];
    for (let k = 0; k <= span; k++) ticks.push(10 ** k);
    ticks = [...new Set(ticks)].filter((t) => Math.log10(t + 1) <= span + 1e-9);
  } else {
    const ymax = niceMax(vmax);
    yOf = (v) => pad.t + ph - (v / ymax) * ph;
    ticks = [0, 1, 2, 3, 4].map((i) => (ymax / 4) * i);
  }
  const xOf = (i) => pad.l + (xmax ? (i / xmax) * pw : pw / 2);

  const { colors } = opts;
  ctx.font = '11px system-ui, sans-serif';
  ctx.lineWidth = 1;

  // Grid and y labels.
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const v of ticks) {
    const y = yOf(v);
    ctx.strokeStyle = colors.line;
    ctx.beginPath();
    ctx.moveTo(pad.l, Math.round(y) + 0.5);
    ctx.lineTo(pad.l + pw, Math.round(y) + 0.5);
    ctx.stroke();
    ctx.fillStyle = colors.muted;
    ctx.fillText(Math.round(v).toLocaleString('en'), pad.l - 6, y);
  }

  // X labels.
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  if (opts.xLabels) {
    opts.xLabels.forEach((lab, i) => ctx.fillText(lab, xOf(i), pad.t + ph + 6));
  } else {
    for (let i = 0; i <= 4; i++) {
      const v = Math.round((xmax / 4) * i);
      ctx.fillText(String(v), xOf(v), pad.t + ph + 6);
    }
  }
  if (opts.xLabel) {
    ctx.textAlign = 'right';
    ctx.fillText(opts.xLabel, pad.l + pw, pad.t + ph + 21);
  }
  if (opts.yLabel) {
    ctx.textAlign = 'left';
    ctx.fillText(opts.yLabel, pad.l, 4);
  }

  // Vertical marker.
  if (opts.marker && opts.marker.x !== null && opts.marker.x <= xmax) {
    const x = Math.round(xOf(opts.marker.x)) + 0.5;
    ctx.strokeStyle = colors.muted;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(x, pad.t);
    ctx.lineTo(x, pad.t + ph);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = colors.muted;
    ctx.textAlign = x > pad.l + pw * 0.7 ? 'right' : 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(opts.marker.label, x + (ctx.textAlign === 'left' ? 6 : -6), pad.t + 2);
  }

  // Lines (with breaks at null) and optional dots.
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  for (const s of series) {
    ctx.strokeStyle = s.color;
    ctx.fillStyle = s.color;
    ctx.beginPath();
    let drawing = false;
    s.data.forEach((v, i) => {
      if (v === null || !Number.isFinite(v)) {
        drawing = false;
        return;
      }
      const x = xOf(i);
      const y = yOf(v);
      if (!drawing) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
      drawing = true;
    });
    ctx.stroke();
    if (s.dots) {
      s.data.forEach((v, i) => {
        if (v === null || !Number.isFinite(v)) return;
        ctx.beginPath();
        ctx.arc(xOf(i), yOf(v), 3.5, 0, Math.PI * 2);
        ctx.fill();
      });
    }
  }
}
