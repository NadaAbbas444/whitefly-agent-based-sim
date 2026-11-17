import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation, DEFAULTS } from '../src/sim.js';
import { runGap, runNoTape, summarise, median } from '../src/experiment.js';

const fast = { dtHours: 1 };

test('same seed gives identical runs', () => {
  const a = new Simulation({}, 42, fast).runDays(30);
  const b = new Simulation({}, 42, fast).runDays(30);
  assert.deepEqual(a, b);
});

test('different seeds give different runs', () => {
  const a = new Simulation({}, 1, fast).runDays(40);
  const b = new Simulation({}, 2, fast).runDays(40);
  assert.notDeepEqual(a, b);
});

test('catch probability is highest with the tape at the canopy top', () => {
  const sim = new Simulation({}, 1, fast);
  const atTop = sim.catchProbability(0);
  assert.equal(atTop, DEFAULTS.catchAtCanopy);
  assert.ok(sim.catchProbability(0.3) < atTop);
  assert.ok(sim.catchProbability(1.0) < sim.catchProbability(0.3));
  assert.ok(sim.catchProbability(-0.3) < atTop, 'buried tape catches less');
});

test('no flights at night or below the flight temperature', () => {
  const sim = new Simulation({}, 1, fast);
  assert.equal(sim.flightRatePerHour(2), 0);
  assert.equal(sim.flightRatePerHour(22), 0);
  const cold = new Simulation({ tempMean: 12, tempSwing: 2 }, 1, fast);
  for (let h = 0; h < 24; h++) assert.equal(cold.flightRatePerHour(h), 0);
});

test('flight activity peaks in the morning', () => {
  assert.ok(Simulation.daylightWeight(9) > Simulation.daylightWeight(16));
});

test('cold greenhouse: nothing is caught', () => {
  const sim = new Simulation({ tempMean: 12, tempSwing: 2 }, 3, fast);
  assert.equal(sim.runDays(40).caught, 0);
});

test('first new adults appear after the development time', () => {
  const sim = new Simulation({}, 5, fast);
  sim.runDays(DEFAULTS.devDays - DEFAULTS.devJitter - 1);
  assert.equal(sim.stats.emerged, 0);
  sim.runDays(DEFAULTS.devJitter * 2 + 2);
  assert.ok(sim.stats.emerged > 0);
});

test('canopy grows and stops at the maximum height', () => {
  const sim = new Simulation({ canopyHeight: 2, canopyGrowth: 0.2, canopyMax: 3 }, 1, fast);
  assert.equal(sim.canopyTop(0), 2);
  assert.ok(Math.abs(sim.canopyTop(14) - 2.4) < 1e-9);
  assert.equal(sim.canopyTop(100), 3);
});

test('tape segment counts add up to total catches', () => {
  const sim = new Simulation({ canopyHeight: 2.8 }, 7, fast);
  sim.runDays(50);
  assert.equal(sim.segments.reduce((a, b) => a + b, 0), sim.stats.caught);
  assert.equal(sim.caught.length, sim.stats.caught);
});

test('detection day is recorded once the threshold is reached', () => {
  const sim = new Simulation({ canopyHeight: 2.8, detectThreshold: 3 }, 2, fast);
  sim.runDays(60);
  if (sim.stats.caught >= 3) assert.notEqual(sim.detectDay, null);
  else assert.equal(sim.detectDay, null);
});

test('population never exceeds the cap', () => {
  const sim = new Simulation({ maxAdults: 50, initialAdults: 40 }, 3, fast);
  sim.runDays(60);
  assert.ok(sim.adults.length <= 50);
});

test('a larger gap delays detection', () => {
  const seeds = [1, 2, 3, 4, 5, 6];
  const close = seeds.map((s) => runGap(0, s).firstCatchDay ?? 999);
  const far = seeds.map((s) => runGap(0.8, s).firstCatchDay ?? 999);
  assert.ok(median(close) < median(far));
});

test('summary counts runs that never detect as missed', () => {
  const runs = [1, 2].map((s) => runGap(1.2, s, { days: 10 }));
  const s = summarise(1.2, runs, runNoTape(1, { days: 10 }).adults);
  assert.equal(s.missed, 1);
  assert.equal(s.detectDay, null);
});
