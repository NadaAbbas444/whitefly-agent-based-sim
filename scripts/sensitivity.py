#!/usr/bin/env python3
"""Sensitivity check: does the main result survive if the assumed values are wrong?

Each assumed parameter is set to a lower and a higher value, one at a time, and
the detection day is compared for the tape at the canopy top (0 m gap) and
0.5 m above it.

Usage:
    python3 scripts/sensitivity.py              # 20 seeds per setting (about 1 minute)
    python3 scripts/sensitivity.py --seeds 5    # quick check
"""

import argparse
import sys
from pathlib import Path
from statistics import median

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from whitefly import DEFAULTS, run_gap  # noqa: E402
from whitefly.sim import js_round  # noqa: E402

# (parameter, label, low value, high value)
ASSUMPTIONS = [
    ("catchAtCanopy", "Catch chance per flight at the canopy top", 0.005, 0.02),
    ("catchDecay", "Distance over which the catch drops by e (m)", 0.2, 0.5),
    ("flightsPerDay", "Flights per adult per day", 2, 8),
    ("immatureSurvival", "Share of eggs that become adults", 0.3, 0.7),
    ("flightFullTemp", "Temperature for full flight activity (°C)", 22, 28),
    ("longFlightShare", "Share of long flights", 0.05, 0.2),
]
GAPS = (0, 0.5)


def detection(params, seeds):
    """Median detection day and number of detecting runs, per gap."""
    out = []
    for g in GAPS:
        days = [r["detectDay"] for r in (run_gap(g, s, params=params) for s in seeds) if r["detectDay"] is not None]
        out.append((median(days) if days else None, len(days)))
    return out


def cell(result, n):
    day, hits = result
    if day is None:
        return "never"
    return f"day {js_round(day)}" + ("" if hits == n else f" ({hits}/{n} runs)")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--seeds", type=int, default=20)
    args = ap.parse_args()
    seeds = list(range(1, args.seeds + 1))
    n = len(seeds)

    print(f"Detection day (median of {n} runs) with the tape at the canopy top and 0.5 m above it.\n")
    print("| Assumption | Value | Gap 0 m | Gap 0.5 m |")
    print("|---|---:|---:|---:|")
    base = detection({}, seeds)
    print(f"| Model as published | — | {cell(base[0], n)} | {cell(base[1], n)} |")
    for key, label, lo, hi in ASSUMPTIONS:
        for v in (lo, hi):
            res = detection({key: v}, seeds)
            print(f"| {label} | {v:g} (default {DEFAULTS[key]:g}) | {cell(res[0], n)} | {cell(res[1], n)} |")


if __name__ == "__main__":
    main()
