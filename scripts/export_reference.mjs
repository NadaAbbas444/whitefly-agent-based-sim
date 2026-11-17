#!/usr/bin/env node
// Export results from the browser simulation (src/sim.js) so the Python
// reference implementation can check it gives identical numbers.
// Usage: node scripts/export_reference.mjs > tests/fixtures/js_reference.json
import { mulberry32, Simulation } from '../src/sim.js';
import { runGap } from '../src/experiment.js';

export const CASES = [
  { name: 'default', params: {}, seed: 1, days: 60, dtHours: 1 },
  { name: 'tape-at-canopy', params: { canopyHeight: 2.8 }, seed: 7, days: 60, dtHours: 1 },
  { name: 'growing-crop', params: { canopyHeight: 2.2, canopyGrowth: 0.15 }, seed: 3, days: 50, dtHours: 0.25 },
  { name: 'cool-greenhouse', params: { tempMean: 18, canopyHeight: 2.6 }, seed: 11, days: 60, dtHours: 1 },
];

const rng = mulberry32(12345);
const out = {
  rng: Array.from({ length: 20 }, () => rng()),
  runs: CASES.map((c) => {
    const sim = new Simulation(c.params, c.seed, { dtHours: c.dtHours });
    const end = sim.runDays(c.days);
    return { ...c, end, history: sim.history.map((h) => [h.adults, h.immature, h.caught]), segments: sim.segments };
  }),
  gaps: [0, 0.3, 0.8].map((g) => ({ gap: g, seed: 4, end: runGap(g, 4) })),
};
console.log(JSON.stringify(out, null, 1));
