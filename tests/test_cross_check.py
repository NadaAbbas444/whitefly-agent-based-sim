"""The browser demo (src/sim.js) must give exactly the same numbers as the
Python reference model for the same seed.

If Node.js is installed, the JavaScript results are produced live by
scripts/export_reference.mjs, so the check always runs against the current
code. Without Node.js, the saved copy in tests/fixtures/js_reference.json is
used (refresh it with `npm run reference`).
"""

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from whitefly import Simulation, mulberry32, run_gap

ROOT = Path(__file__).resolve().parent.parent
FIXTURE = ROOT / "tests" / "fixtures" / "js_reference.json"


@pytest.fixture(scope="module")
def ref():
    if shutil.which("node"):
        cmd = ["node", "scripts/export_reference.mjs"]
        return json.loads(subprocess.run(cmd, cwd=ROOT, check=True, capture_output=True, text=True).stdout)
    return json.loads(FIXTURE.read_text())


def test_random_numbers_match(ref):
    rng = mulberry32(12345)
    assert [rng() for _ in range(len(ref["rng"]))] == ref["rng"]


@pytest.mark.parametrize("i", range(4))
def test_full_runs_match(ref, i):
    case = ref["runs"][i]
    sim = Simulation(case["params"], case["seed"], case["dtHours"])
    end = sim.run_days(case["days"])
    assert end == case["end"], case["name"]
    assert [[h["adults"], h["immature"], h["caught"]] for h in sim.history] == case["history"]
    assert sim.segments == case["segments"]


def test_experiment_runs_match(ref):
    for g in ref["gaps"]:
        assert run_gap(g["gap"], g["seed"]) == g["end"]


@pytest.mark.skipif(not shutil.which("node"), reason="needs Node.js")
def test_saved_reference_is_current(ref):
    # The saved copy is used where Node.js is missing, so it must not go stale.
    assert json.loads(FIXTURE.read_text()) == ref, "run: npm run reference"
