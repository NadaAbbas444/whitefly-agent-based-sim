"""Gap-sweep experiment.

For each gap between canopy top and tape, run several seeds and record when the
tape first shows the infestation and how big it already was by then.
"""

from __future__ import annotations

from statistics import fmean, median

from .sim import DEFAULTS, Simulation

GAPS = [0, 0.15, 0.3, 0.5, 0.8, 1.2]  # metres
EXP_DAYS = 60


def run_gap(gap: float, seed: int, days: int = EXP_DAYS, params: dict | None = None, dt_hours: float = 1) -> dict:
    """One run with the canopy top `gap` metres below the tape (no growth)."""
    base = {**DEFAULTS, **(params or {})}
    p = {**base, "canopyGrowth": 0, "canopyHeight": base["tapeHeight"] - gap}
    sim = Simulation(p, seed, dt_hours)
    end = sim.run_days(days)
    return {**end, "series": [h["adults"] for h in sim.history]}


def run_no_tape(seed: int, days: int = EXP_DAYS, params: dict | None = None, dt_hours: float = 1) -> dict:
    """Same run without any tape: the population baseline."""
    sim = Simulation({**(params or {}), "catchAtCanopy": 0}, seed, dt_hours)
    return sim.run_days(days)


def summarise(gap: float, runs: list[dict], no_tape_adults: float) -> dict:
    """Summarise runs for one gap.

    Runs that never reached the detection threshold count as "missed" and are
    left out of the day/size medians.
    """
    detected = [r for r in runs if r["detectDay"] is not None]
    first = [r for r in runs if r["firstCatchDay"] is not None]

    def med(rs, key):
        return median(r[key] for r in rs) if rs else None

    adults_end = fmean(r["adults"] for r in runs)
    return {
        "gap": gap,
        "firstCatchDay": med(first, "firstCatchDay"),
        "detectDay": med(detected, "detectDay"),
        "adultsAtDetect": med(detected, "adultsAtDetect"),
        "immatureAtDetect": med(detected, "immatureAtDetect"),
        "missed": (len(runs) - len(detected)) / len(runs),
        "adultsEnd": adults_end,
        "caughtEnd": fmean(r["caught"] for r in runs),
        "reduction": 1 - adults_end / no_tape_adults if no_tape_adults > 0 else 0,
    }


def sweep(seeds: list[int], days: int = EXP_DAYS, params: dict | None = None) -> tuple[list[dict], float, dict]:
    """Run the full gap sweep. Returns (summary rows, no-tape mean, raw runs per gap)."""
    base = fmean(run_no_tape(s, days, params)["adults"] for s in seeds)
    raw = {g: [run_gap(g, s, days, params) for s in seeds] for g in GAPS}
    rows = [summarise(g, raw[g], base) for g in GAPS]
    return rows, base, raw
