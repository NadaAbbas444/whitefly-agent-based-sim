// Gap-sweep experiment shared by the browser and the CLI script.
// For each gap between canopy top and tape, run several seeds and record when
// the tape first shows the infestation and how big it already was by then.
import { Simulation, DEFAULTS } from './sim.js';

export const GAPS = [0, 0.15, 0.3, 0.5, 0.8, 1.2]; // metres
export const EXP_DAYS = 60;

/** One run with the canopy top `gap` metres below the tape (no growth). */
export function runGap(gap, seed, { days = EXP_DAYS, params = {}, dtHours = 1 } = {}) {
  const base = { ...DEFAULTS, ...params };
  const p = { ...base, canopyGrowth: 0, canopyHeight: base.tapeHeight - gap };
  const sim = new Simulation(p, seed, { dtHours });
  const end = sim.runDays(days);
  return { ...end, series: sim.history.map((h) => h.adults) };
}

/** Same run without any tape: the population baseline. */
export function runNoTape(seed, { days = EXP_DAYS, params = {}, dtHours = 1 } = {}) {
  const sim = new Simulation({ ...params, catchAtCanopy: 0 }, seed, { dtHours });
  return sim.runDays(days);
}

export function mean(xs) {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Summarise runs for one gap. Runs that never reached the detection
 * threshold count as "missed" and are left out of the day/size medians.
 */
export function summarise(gap, runs, noTapeAdults) {
  const detected = runs.filter((r) => r.detectDay !== null);
  const first = runs.filter((r) => r.firstCatchDay !== null);
  return {
    gap,
    firstCatchDay: first.length ? median(first.map((r) => r.firstCatchDay)) : null,
    detectDay: detected.length ? median(detected.map((r) => r.detectDay)) : null,
    adultsAtDetect: detected.length ? median(detected.map((r) => r.adultsAtDetect)) : null,
    immatureAtDetect: detected.length ? median(detected.map((r) => r.immatureAtDetect)) : null,
    missed: (runs.length - detected.length) / runs.length,
    adultsEnd: mean(runs.map((r) => r.adults)),
    caughtEnd: mean(runs.map((r) => r.caught)),
    reduction: noTapeAdults > 0 ? 1 - mean(runs.map((r) => r.adults)) / noTapeAdults : 0,
  };
}
