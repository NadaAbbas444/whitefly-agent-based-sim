"""Whitefly tape-monitoring simulation: side view of one greenhouse row.

Every adult whitefly is an agent living in the young-leaf layer at the top of
the canopy. Adults fly, lay eggs and die. A yellow sticky tape hangs along the
row at a fixed height. The question is how well that tape reveals an
infestation, depending on the gap between the canopy top and the tape.

This is the reference implementation. The browser demo (src/sim.js) is a
line-by-line mirror of it, and tests/test_cross_check.py checks that both give
identical results for the same seed.

Sources for parameter values are listed in the README; values marked
ASSUMPTION are not taken from a study.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

MASK32 = 0xFFFFFFFF


def _imul(a: int, b: int) -> int:
    """32-bit integer multiply (like C uint32 overflow)."""
    return (a * b) & MASK32


def mulberry32(seed: int):
    """Small, fast seeded PRNG (mulberry32). Returns floats in [0, 1).

    Uses only 32-bit integer operations, so it produces exactly the same
    sequence as the JavaScript version.
    """
    state = seed & MASK32

    def rng() -> float:
        nonlocal state
        state = (state + 0x6D2B79F5) & MASK32
        t = state
        t = _imul(t ^ (t >> 15), t | 1)
        t ^= (t + _imul(t ^ (t >> 7), t | 61)) & MASK32
        return (t ^ (t >> 14)) / 4294967296

    return rng


def js_round(v: float) -> int:
    """Round half up, like JavaScript's Math.round (Python's round() is banker's)."""
    return math.floor(v + 0.5)


def clamp(v: float, lo: float, hi: float) -> float:
    return lo if v < lo else hi if v > hi else v


DEFAULTS: dict = {
    # Greenhouse geometry (metres)
    "rowLength": 40,
    "plantSpacing": 0.5,
    "tapeHeight": 2.8,  # field value from a commercial tomato greenhouse in Austria
    "tapeBand": 0.3,  # width of the tape roll
    "tapeSegments": 8,  # tape is read in segments, e.g. one camera image each
    "canopyHeight": 2.0,  # canopy top at the start
    "canopyGrowth": 0,  # metres per week; 0 = head height kept constant
    "canopyMax": 3.4,
    "topLayer": 0.4,  # adults sit on the young leaves in this top layer
    # Climate
    "tempMean": 23,  # °C
    "tempSwing": 3,  # day/night amplitude, °C
    "flightMinTemp": 16.5,  # no flight below this (Liu et al. 1994: 16–17 °C)
    "flightFullTemp": 25,  # ASSUMPTION: full flight activity from here up
    # Flight
    "flightsPerDay": 4,  # ASSUMPTION: flights per adult per day at full activity
    "longFlightShare": 0.1,  # ASSUMPTION: share of flights that are long
    "hopMean": 0.3,  # m, short flights (Bonsignore 2015: a few cm up to 2–3 m)
    "longMean": 3.0,  # m
    # Tape catch per flight
    "catchAtCanopy": 0.01,  # ASSUMPTION: P(caught) per flight when the tape touches the canopy top
    "catchDecay": 0.3,  # m; catch falls by 1/e per 30 cm of gap (trap-height studies)
    "buriedDecay": 0.15,  # m; ASSUMPTION: once foliage grows past the tape, leaves hide it
    # Life history on tomato (De Vis & van Lenteren 2002; age-stage tables at 25 °C)
    "fecundity": 90,  # eggs per female over her life
    "longevity": 37,  # days, female adult
    "femaleShare": 0.5,
    "devDays": 23,  # egg to adult
    "devJitter": 3,  # ± days
    "immatureSurvival": 0.5,  # ASSUMPTION
    # Run
    "initialAdults": 5,
    "maxAdults": 5000,  # performance cap
    "detectThreshold": 5,  # flies on the tape that count as "detected"
}


def daylight_weight(hour_of_day: float) -> float:
    """Relative flight activity by hour: none at night, peak in the morning."""
    if hour_of_day < 6 or hour_of_day >= 20:
        return 0.0
    return 1 + 1.5 * math.exp(-(((hour_of_day - 9) / 2) ** 2))


# Integral of daylight_weight over one day, so flightsPerDay means what it says.
DAY_WEIGHT_SUM = sum(daylight_weight(i * 0.25) * 0.25 for i in range(96))


@dataclass
class Adult:
    x: float  # position along the row (m)
    plant: int  # index of the plant it sits on
    depth: float  # distance below the canopy top (m)


class Simulation:
    def __init__(self, params: dict | None = None, seed: int = 1, dt_hours: float = 0.25):
        self.p = {**DEFAULTS, **(params or {})}
        self.seed = seed
        self.dt = dt_hours
        self.reset()

    def reset(self) -> None:
        p = self.p
        self.rng = mulberry32(self.seed)
        self.step_index = 0
        self.hours = 0.0
        self.n_plants = math.floor(p["rowLength"] / p["plantSpacing"])
        self.adults: list[Adult] = []
        self.caught: list[tuple[float, float, float]] = []  # (x, z, day) of flies on the tape
        self.segments = [0] * p["tapeSegments"]
        self.capped = False

        # Emergence queue: ring buffer of time steps holding plant indices.
        steps_per_day = 24 / self.dt
        self.dev_steps = js_round(p["devDays"] * steps_per_day)
        self.jitter_steps = js_round(p["devJitter"] * steps_per_day)
        self.ring: list[list[int]] = [[] for _ in range(self.dev_steps + self.jitter_steps + 2)]
        self.immature = 0

        self.stats = {"caught": 0, "emerged": 0, "died": 0, "eggs": 0, "flights": 0}
        self.first_catch_day: float | None = None
        self.detect_day: float | None = None
        self.adults_at_detect: int | None = None
        self.immature_at_detect: int | None = None
        self.history: list[dict] = []

        # The infestation arrives at one spot (a door, a vent, a new batch of plants).
        self.origin_x = p["rowLength"] * (0.15 + 0.7 * self.rng())
        for _ in range(p["initialAdults"]):
            x = clamp(self.origin_x + (self.rng() - 0.5) * 2, 0, p["rowLength"])
            self.adults.append(self._new_adult(x))
        self._sample()

    # ---- model functions -------------------------------------------------

    @property
    def day(self) -> float:
        return self.hours / 24

    def canopy_top(self, day: float | None = None) -> float:
        p = self.p
        d = self.day if day is None else day
        return min(p["canopyMax"], p["canopyHeight"] + (p["canopyGrowth"] * d) / 7)

    def gap(self, day: float | None = None) -> float:
        """Gap between canopy top and tape (negative = foliage has grown past the tape)."""
        return self.p["tapeHeight"] - self.canopy_top(day)

    def catch_probability(self, gap: float | None = None) -> float:
        """Probability that one flight ends on the tape."""
        p = self.p
        g = self.gap() if gap is None else gap
        if g >= 0:
            return p["catchAtCanopy"] * math.exp(-g / p["catchDecay"])
        return p["catchAtCanopy"] * math.exp(g / p["buriedDecay"])

    def temperature(self, hour_of_day: float) -> float:
        p = self.p
        return p["tempMean"] + p["tempSwing"] * math.sin((2 * math.pi * (hour_of_day - 9)) / 24)

    def flight_rate_per_hour(self, hour_of_day: float) -> float:
        p = self.p
        t = self.temperature(hour_of_day)
        temp_factor = clamp((t - p["flightMinTemp"]) / (p["flightFullTemp"] - p["flightMinTemp"]), 0, 1)
        return (p["flightsPerDay"] * daylight_weight(hour_of_day) * temp_factor) / DAY_WEIGHT_SUM

    # ---- time step -------------------------------------------------------

    def _new_adult(self, x: float) -> Adult:
        p = self.p
        plant = min(self.n_plants - 1, max(0, js_round(x / p["plantSpacing"])))
        return Adult(x=x, plant=plant, depth=self.rng() * p["topLayer"])

    def step(self) -> None:
        p = self.p
        r = self.rng
        dt = self.dt
        hour_of_day = self.hours % 24
        p_fly = 1 - math.exp(-self.flight_rate_per_hour(hour_of_day) * dt)
        p_die = 1 - math.exp(-dt / 24 / p["longevity"])
        egg_rate = (p["fecundity"] / p["longevity"]) * p["femaleShare"]  # eggs per adult per day
        p_egg = min(1, egg_rate * (dt / 24))
        p_catch = self.catch_probability()
        day = self.day
        row = p["rowLength"]

        adults = self.adults
        # Iterate backwards so swap-removing the current fly is safe.
        for i in range(len(adults) - 1, -1, -1):
            a = adults[i]

            if r() < p_die:
                self._remove(i)
                self.stats["died"] += 1
                continue

            # Egg laying: count every egg, schedule only those that survive to adult.
            if r() < p_egg:
                self.stats["eggs"] += 1
                if r() < p["immatureSurvival"]:
                    delay = self.dev_steps + js_round((r() * 2 - 1) * self.jitter_steps)
                    self.ring[(self.step_index + delay) % len(self.ring)].append(a.plant)
                    self.immature += 1

            if p_fly > 0 and r() < p_fly:
                self.stats["flights"] += 1
                if r() < p_catch:
                    seg = min(p["tapeSegments"] - 1, math.floor((a.x / row) * p["tapeSegments"]))
                    self.segments[seg] += 1
                    self.caught.append((a.x, p["tapeHeight"] + (r() - 0.5) * p["tapeBand"] * 0.8, day))
                    self.stats["caught"] += 1
                    self._remove(i)
                    if self.first_catch_day is None:
                        self.first_catch_day = day
                    if self.detect_day is None and self.stats["caught"] >= p["detectThreshold"]:
                        self.detect_day = day
                        self.adults_at_detect = len(self.adults)
                        self.immature_at_detect = self.immature
                    continue
                mean = p["longMean"] if r() < p["longFlightShare"] else p["hopMean"]
                dist = -math.log(1 - r()) * mean  # exponential flight distance
                x = a.x + (-dist if r() < 0.5 else dist)
                if x < 0:  # reflect at the row ends
                    x = -x
                if x > row:
                    x = 2 * row - x
                a.x = clamp(x, 0, row)
                a.plant = min(self.n_plants - 1, js_round(a.x / p["plantSpacing"]))
                a.depth = r() * p["topLayer"]

        # New adults emerge.
        bucket = self.ring[self.step_index % len(self.ring)]
        for plant in bucket:
            self.immature -= 1
            if len(self.adults) >= p["maxAdults"]:
                self.capped = True
                continue
            x = clamp((plant + (r() - 0.5)) * p["plantSpacing"], 0, row)
            self.adults.append(self._new_adult(x))
            self.stats["emerged"] += 1
        bucket.clear()

        self.step_index += 1
        prev_day = math.floor(self.hours / 24)
        self.hours += dt
        if math.floor(self.hours / 24) > prev_day:
            self._sample()

    def _remove(self, i: int) -> None:
        last = self.adults.pop()
        if i < len(self.adults):
            self.adults[i] = last

    def _sample(self) -> None:
        self.history.append(self.summary())

    def run_days(self, days: float) -> dict:
        """Run headless for a number of days."""
        for _ in range(js_round((days * 24) / self.dt)):
            self.step()
        return self.summary()

    def summary(self) -> dict:
        prev = self.history[-1]["caught"] if self.history else 0
        return {
            "day": js_round(self.day * 100) / 100,
            "adults": len(self.adults),
            "immature": self.immature,
            "caught": self.stats["caught"],
            "caughtToday": self.stats["caught"] - prev,
            "canopyTop": self.canopy_top(),
            "gap": self.gap(),
            "firstCatchDay": self.first_catch_day,
            "detectDay": self.detect_day,
            "adultsAtDetect": self.adults_at_detect,
            "immatureAtDetect": self.immature_at_detect,
            "capped": self.capped,
        }
