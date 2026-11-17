// Whitefly tape-monitoring simulation: side view of one greenhouse row.
//
// Every adult whitefly is an agent living in the young-leaf layer at the top of
// the canopy. Adults fly, lay eggs and die. A yellow sticky tape hangs along the
// row at a fixed height. The question is how well that tape reveals an
// infestation, depending on the gap between the canopy top and the tape.
//
// Browser mirror of the Python reference model (whitefly/sim.py). Keep the two
// in sync line by line: tests/test_cross_check.py fails if they ever differ.
// Pure and deterministic (seeded RNG, no DOM). Sources for parameter values are
// listed in the README; values marked ASSUMPTION are not taken from a study.

/** Small, fast seeded PRNG (mulberry32). Returns floats in [0, 1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const DEFAULTS = Object.freeze({
  // Greenhouse geometry (metres)
  rowLength: 40,
  plantSpacing: 0.5,
  tapeHeight: 2.8, // field value from a commercial tomato greenhouse in Austria
  tapeBand: 0.3, // width of the tape roll
  tapeSegments: 8, // tape is read in segments, e.g. one camera image each
  canopyHeight: 2.0, // canopy top at the start
  canopyGrowth: 0, // metres per week; 0 = head height kept constant
  canopyMax: 3.4,
  topLayer: 0.4, // adults sit on the young leaves in this top layer

  // Climate
  tempMean: 23, // °C
  tempSwing: 3, // day/night amplitude, °C
  flightMinTemp: 16.5, // no flight below this (Liu et al. 1994: 16–17 °C)
  flightFullTemp: 25, // ASSUMPTION: full flight activity from here up

  // Flight
  flightsPerDay: 4, // ASSUMPTION: flights per adult per day at full activity
  longFlightShare: 0.1, // ASSUMPTION: share of flights that are long
  hopMean: 0.3, // m, short flights (Bonsignore 2015: a few cm up to 2–3 m)
  longMean: 3.0, // m

  // Tape catch per flight
  catchAtCanopy: 0.01, // ASSUMPTION: P(caught) for one flight when the tape touches the canopy top
  catchDecay: 0.3, // m; catch falls by 1/e per 30 cm of gap (trap-height studies: 30 cm above = clearly fewer)
  buriedDecay: 0.15, // m; ASSUMPTION: once foliage grows past the tape, leaves hide it

  // Life history on tomato (De Vis & van Lenteren 2002; age-stage tables at 25 °C)
  fecundity: 90, // eggs per female over her life (round tomato)
  longevity: 37, // days, female adult
  femaleShare: 0.5,
  devDays: 23, // egg to adult
  devJitter: 3, // ± days
  immatureSurvival: 0.5, // ASSUMPTION

  // Run
  initialAdults: 5,
  maxAdults: 5000, // performance cap
  detectThreshold: 5, // flies on the tape that count as "detected"
});

export class Simulation {
  constructor(params = {}, seed = 1, { dtHours = 0.25 } = {}) {
    this.p = { ...DEFAULTS, ...params };
    this.seed = seed;
    this.dt = dtHours;
    this.keepFlights = false;
    this.reset();
  }

  reset() {
    const p = this.p;
    this.rng = mulberry32(this.seed);
    this.stepIndex = 0;
    this.hours = 0;
    this.nPlants = Math.floor(p.rowLength / p.plantSpacing);
    this.adults = [];
    this.caught = []; // {x, z, day}: flies stuck on the tape
    this.segments = new Array(p.tapeSegments).fill(0);
    this.flights = []; // recent flights, for drawing
    this.capped = false;

    // Emergence queue: ring buffer of time steps holding plant indices.
    const stepsPerDay = 24 / this.dt;
    this.devSteps = Math.round(p.devDays * stepsPerDay);
    this.jitterSteps = Math.round(p.devJitter * stepsPerDay);
    this.ring = Array.from({ length: this.devSteps + this.jitterSteps + 2 }, () => []);
    this.immature = 0;

    this.stats = { caught: 0, emerged: 0, died: 0, eggs: 0, flights: 0 };
    this.firstCatchDay = null;
    this.detectDay = null;
    this.adultsAtDetect = null;
    this.immatureAtDetect = null;
    this.history = [];

    // The infestation arrives at one spot (a door, a vent, a new batch of plants).
    this.originX = p.rowLength * (0.15 + 0.7 * this.rng());
    for (let i = 0; i < p.initialAdults; i++) {
      const x = clamp(this.originX + (this.rng() - 0.5) * 2, 0, p.rowLength);
      this.adults.push(this._newAdult(x));
    }
    this._sample();
  }

  get day() {
    return this.hours / 24;
  }

  canopyTop(day = this.day) {
    const p = this.p;
    return Math.min(p.canopyMax, p.canopyHeight + (p.canopyGrowth * day) / 7);
  }

  /** Gap between canopy top and tape (negative = foliage has grown past the tape). */
  gap(day = this.day) {
    return this.p.tapeHeight - this.canopyTop(day);
  }

  /** Probability that one flight ends on the tape. */
  catchProbability(gap = this.gap()) {
    const p = this.p;
    if (gap >= 0) return p.catchAtCanopy * Math.exp(-gap / p.catchDecay);
    return p.catchAtCanopy * Math.exp(gap / p.buriedDecay);
  }

  temperature(hourOfDay) {
    const p = this.p;
    return p.tempMean + p.tempSwing * Math.sin((2 * Math.PI * (hourOfDay - 9)) / 24);
  }

  /** Relative flight activity by hour: none at night, peak in the morning. */
  static daylightWeight(hourOfDay) {
    if (hourOfDay < 6 || hourOfDay >= 20) return 0;
    return 1 + 1.5 * Math.exp(-(((hourOfDay - 9) / 2) ** 2));
  }

  flightRatePerHour(hourOfDay) {
    const p = this.p;
    const t = this.temperature(hourOfDay);
    const tempFactor = clamp((t - p.flightMinTemp) / (p.flightFullTemp - p.flightMinTemp), 0, 1);
    return (p.flightsPerDay * Simulation.daylightWeight(hourOfDay) * tempFactor) / DAY_WEIGHT_SUM;
  }

  _newAdult(x) {
    const p = this.p;
    return {
      x,
      plant: Math.min(this.nPlants - 1, Math.max(0, Math.round(x / p.plantSpacing))),
      depth: this.rng() * p.topLayer, // distance below the canopy top
    };
  }

  step() {
    const p = this.p;
    const r = this.rng;
    const dt = this.dt;
    const hourOfDay = this.hours % 24;
    const pFly = 1 - Math.exp(-this.flightRatePerHour(hourOfDay) * dt);
    const pDie = 1 - Math.exp(-dt / 24 / p.longevity);
    const eggRate = (p.fecundity / p.longevity) * p.femaleShare; // eggs per adult per day
    const pEgg = Math.min(1, eggRate * (dt / 24));
    const pCatch = this.catchProbability();
    const top = this.canopyTop();
    const day = this.day;

    const adults = this.adults;
    for (let i = adults.length - 1; i >= 0; i--) {
      const a = adults[i];

      if (r() < pDie) {
        this._remove(i);
        this.stats.died++;
        continue;
      }

      // Egg laying: count every egg, schedule only those that survive to adult.
      if (r() < pEgg) {
        this.stats.eggs++;
        if (r() < p.immatureSurvival) {
          const delay = this.devSteps + Math.round((r() * 2 - 1) * this.jitterSteps);
          this.ring[(this.stepIndex + delay) % this.ring.length].push(a.plant);
          this.immature++;
        }
      }

      if (pFly > 0 && r() < pFly) {
        this.stats.flights++;
        const x0 = a.x;
        const z0 = top - a.depth;
        if (r() < pCatch) {
          const seg = Math.min(p.tapeSegments - 1, Math.floor((a.x / p.rowLength) * p.tapeSegments));
          this.segments[seg]++;
          this.caught.push({ x: a.x, z: p.tapeHeight + (r() - 0.5) * p.tapeBand * 0.8, day });
          this.stats.caught++;
          this._recordFlight(x0, z0, a.x, p.tapeHeight, true);
          this._remove(i);
          if (this.firstCatchDay === null) this.firstCatchDay = day;
          if (this.detectDay === null && this.stats.caught >= p.detectThreshold) {
            this.detectDay = day;
            this.adultsAtDetect = this.adults.length;
            this.immatureAtDetect = this.immature;
          }
          continue;
        }
        const mean = r() < p.longFlightShare ? p.longMean : p.hopMean;
        const dist = -Math.log(1 - r()) * mean;
        let x = a.x + (r() < 0.5 ? -dist : dist);
        if (x < 0) x = -x;
        if (x > p.rowLength) x = 2 * p.rowLength - x;
        a.x = clamp(x, 0, p.rowLength);
        a.plant = Math.min(this.nPlants - 1, Math.round(a.x / p.plantSpacing));
        a.depth = r() * p.topLayer;
        this._recordFlight(x0, z0, a.x, top - a.depth, false);
      }
    }

    // New adults emerge.
    const bucket = this.ring[this.stepIndex % this.ring.length];
    for (const plant of bucket) {
      this.immature--;
      if (this.adults.length >= p.maxAdults) {
        this.capped = true;
        continue;
      }
      const x = clamp((plant + (r() - 0.5)) * p.plantSpacing, 0, p.rowLength);
      this.adults.push(this._newAdult(x));
      this.stats.emerged++;
    }
    bucket.length = 0;

    this.stepIndex++;
    const prevDay = Math.floor(this.hours / 24);
    this.hours += dt;
    if (Math.floor(this.hours / 24) > prevDay) this._sample();
  }

  _recordFlight(x0, z0, x1, z1, caught) {
    if (!this.keepFlights) return;
    this.flights.push({ x0, z0, x1, z1, caught, t: this.hours });
    if (this.flights.length > 300) this.flights.splice(0, this.flights.length - 300);
  }

  _remove(i) {
    const last = this.adults.pop();
    if (i < this.adults.length) this.adults[i] = last;
  }

  _sample() {
    this.history.push(this.summary());
  }

  /** Run headless for a number of days. */
  runDays(days) {
    const steps = Math.round((days * 24) / this.dt);
    for (let s = 0; s < steps; s++) this.step();
    return this.summary();
  }

  summary() {
    const prev = this.history.length ? this.history[this.history.length - 1].caught : 0;
    return {
      day: Math.round(this.day * 100) / 100,
      adults: this.adults.length,
      immature: this.immature,
      caught: this.stats.caught,
      caughtToday: this.stats.caught - prev,
      canopyTop: this.canopyTop(),
      gap: this.gap(),
      firstCatchDay: this.firstCatchDay,
      detectDay: this.detectDay,
      adultsAtDetect: this.adultsAtDetect,
      immatureAtDetect: this.immatureAtDetect,
      capped: this.capped,
    };
  }
}

const DAY_WEIGHT_SUM = (() => {
  let s = 0;
  for (let h = 0; h < 24; h += 0.25) s += Simulation.daylightWeight(h) * 0.25;
  return s;
})();

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
