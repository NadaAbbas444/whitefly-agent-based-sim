"""Unit tests for the Python reference model (run with: pytest)."""

from statistics import median

import pytest

from whitefly import DEFAULTS, Simulation, run_gap, run_no_tape, summarise
from whitefly.sim import daylight_weight, js_round

FAST = 1  # 1-hour time step keeps the tests quick


def test_same_seed_gives_identical_runs():
    a = Simulation({}, 42, FAST).run_days(30)
    b = Simulation({}, 42, FAST).run_days(30)
    assert a == b


def test_different_seeds_give_different_runs():
    a = Simulation({}, 1, FAST).run_days(40)
    b = Simulation({}, 2, FAST).run_days(40)
    assert a != b


def test_catch_probability_highest_with_tape_at_canopy_top():
    sim = Simulation({}, 1, FAST)
    at_top = sim.catch_probability(0)
    assert at_top == DEFAULTS["catchAtCanopy"]
    assert sim.catch_probability(0.3) < at_top
    assert sim.catch_probability(1.0) < sim.catch_probability(0.3)
    assert sim.catch_probability(-0.3) < at_top, "tape buried in foliage catches less"


def test_catch_drops_by_e_per_30cm():
    sim = Simulation({}, 1, FAST)
    assert sim.catch_probability(0.3) == pytest.approx(DEFAULTS["catchAtCanopy"] / 2.718281828, rel=1e-6)


def test_no_flights_at_night_or_in_the_cold():
    sim = Simulation({}, 1, FAST)
    assert sim.flight_rate_per_hour(2) == 0
    assert sim.flight_rate_per_hour(22) == 0
    cold = Simulation({"tempMean": 12, "tempSwing": 2}, 1, FAST)
    assert all(cold.flight_rate_per_hour(h) == 0 for h in range(24))


def test_flight_activity_peaks_in_the_morning():
    assert daylight_weight(9) > daylight_weight(16)


def test_cold_greenhouse_catches_nothing():
    assert Simulation({"tempMean": 12, "tempSwing": 2}, 3, FAST).run_days(40)["caught"] == 0


def test_first_new_adults_appear_after_development_time():
    sim = Simulation({}, 5, FAST)
    sim.run_days(DEFAULTS["devDays"] - DEFAULTS["devJitter"] - 1)
    assert sim.stats["emerged"] == 0
    sim.run_days(DEFAULTS["devJitter"] * 2 + 2)
    assert sim.stats["emerged"] > 0


def test_canopy_grows_and_stops_at_max():
    sim = Simulation({"canopyHeight": 2, "canopyGrowth": 0.2, "canopyMax": 3}, 1, FAST)
    assert sim.canopy_top(0) == 2
    assert sim.canopy_top(14) == pytest.approx(2.4)
    assert sim.canopy_top(100) == 3


def test_tape_segments_add_up_to_total_catches():
    sim = Simulation({"canopyHeight": 2.8}, 7, FAST)
    sim.run_days(50)
    assert sum(sim.segments) == sim.stats["caught"] == len(sim.caught)


def test_detection_day_recorded_at_threshold():
    sim = Simulation({"canopyHeight": 2.8, "detectThreshold": 3}, 2, FAST)
    sim.run_days(60)
    if sim.stats["caught"] >= 3:
        assert sim.detect_day is not None
    else:
        assert sim.detect_day is None


def test_population_never_exceeds_cap():
    sim = Simulation({"maxAdults": 50, "initialAdults": 40}, 3, FAST)
    sim.run_days(60)
    assert len(sim.adults) <= 50


def test_larger_gap_delays_detection():
    seeds = range(1, 7)
    close = [run_gap(0, s)["firstCatchDay"] or 999 for s in seeds]
    far = [run_gap(0.8, s)["firstCatchDay"] or 999 for s in seeds]
    assert median(close) < median(far)


def test_summary_counts_runs_that_never_detect_as_missed():
    runs = [run_gap(1.2, s, days=10) for s in (1, 2)]
    s = summarise(1.2, runs, run_no_tape(1, days=10)["adults"])
    assert s["missed"] == 1
    assert s["detectDay"] is None


def test_js_round_matches_javascript():
    # Math.round rounds .5 up, Python's round() would give 2 and -2 here.
    assert js_round(2.5) == 3
    assert js_round(-2.5) == -2
