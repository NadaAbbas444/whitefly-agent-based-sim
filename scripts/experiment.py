#!/usr/bin/env python3
"""Gap sweep: how the gap between canopy top and tape changes detection.

Usage:
    python3 scripts/experiment.py                  # 20 seeds, 60 days, 23 °C
    python3 scripts/experiment.py --temp 18
    python3 scripts/experiment.py --plot docs/results-plot.png
"""

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from whitefly import sweep  # noqa: E402
from whitefly.sim import js_round  # noqa: E402


def fmt_day(v):
    return "—" if v is None else f"day {js_round(v)}"


def fmt_num(v):
    return "—" if v is None else str(js_round(v))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--seeds", type=int, default=20, help="random infestations per gap")
    ap.add_argument("--days", type=int, default=60)
    ap.add_argument("--temp", type=float, help="average greenhouse temperature (°C)")
    ap.add_argument("--plot", type=Path, help="save a results figure (needs matplotlib)")
    args = ap.parse_args()

    params = {"tempMean": args.temp} if args.temp is not None else {}
    seeds = list(range(1, args.seeds + 1))
    t0 = time.time()
    rows, base, raw = sweep(seeds, args.days, params)

    print(f"{args.seeds} seeds x {args.days} days per gap, median values ({time.time() - t0:.1f} s)\n")
    print(
        "| Gap | First fly on tape | Detected (5 on tape) | Adults at detection "
        "| Eggs + nymphs at detection | Never detected | Fewer adults than no tape |"
    )
    print("|---|---:|---:|---:|---:|---:|---:|")
    for r in rows:
        print(
            f"| {r['gap']} m | {fmt_day(r['firstCatchDay'])} | {fmt_day(r['detectDay'])} "
            f"| {fmt_num(r['adultsAtDetect'])} | {fmt_num(r['immatureAtDetect'])} "
            f"| {js_round(r['missed'] * 100)}% | {js_round(r['reduction'] * 100)}% |"
        )
    print(f"\nWithout tape: {round(base)} adults on day {args.days} (mean).")

    if args.plot:
        from plot_results import plot  # local import: matplotlib is optional

        plot(rows, raw, args.plot, temp=args.temp)
        print(f"Saved {args.plot}")


if __name__ == "__main__":
    main()
