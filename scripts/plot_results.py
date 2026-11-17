"""Results figure for the gap sweep (matplotlib)."""

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

TAPE = "#d4a900"
FIRST = "#7fb069"
DETECT = "#2f6e3b"
GREY = "#8a948d"


def plot(rows, raw, path, temp=None):
    gaps = [r["gap"] for r in rows]
    fig, axes = plt.subplots(1, 3, figsize=(13, 3.8), constrained_layout=True)

    # 1. When does the tape notice?
    ax = axes[0]
    ax.plot(gaps, [r["firstCatchDay"] for r in rows], "o-", color=FIRST, label="First fly on tape")
    det = [(g, r["detectDay"]) for g, r in zip(gaps, rows, strict=True) if r["detectDay"] is not None]
    ax.plot(*zip(*det, strict=True), "o-", color=DETECT, label="Detected (5 flies)")
    ax.set(title="When the tape notices", xlabel="Gap between canopy top and tape (m)", ylabel="Day (median)")
    ax.legend(frameon=False)

    # 2. How big is the hidden infestation by then?
    ax = axes[1]
    x = range(len(rows))
    adults = [r["adultsAtDetect"] or 0 for r in rows]
    young = [r["immatureAtDetect"] or 0 for r in rows]
    ax.bar(x, young, color=GREY, label="Eggs + nymphs")
    ax.bar(x, adults, bottom=young, color=DETECT, label="Adults")
    n_runs = len(next(iter(raw.values())))
    for i, r in enumerate(rows):
        n_det = round((1 - r["missed"]) * n_runs)
        if n_det < n_runs:  # median based on fewer runs: say so
            label = f"{n_det}/{n_runs}\nruns"
            ax.text(i, young[i] + adults[i], label, ha="center", va="bottom", fontsize=8, color=GREY)
    ax.set_ylim(0, max(a + y for a, y in zip(adults, young, strict=True)) * 1.18)
    ax.set_xticks(list(x), [f"{g} m" for g in gaps])
    ax.set(title="Whiteflies already in the crop at detection", xlabel="Gap", ylabel="Count (median)")
    ax.legend(frameon=False)

    # 3. How often does the tape miss it?
    ax = axes[2]
    ax.bar(x, [r["missed"] * 100 for r in rows], color=TAPE)
    ax.set_xticks(list(x), [f"{g} m" for g in gaps])
    ax.set(title="Never detected within 60 days", xlabel="Gap", ylabel="% of runs", ylim=(0, 100))

    for ax in axes:
        ax.spines[["top", "right"]].set_visible(False)
    n = len(next(iter(raw.values())))
    fig.suptitle(
        f"Whitefly Tape Watch: gap sweep, {n} runs per gap" + (f", {temp:g} °C" if temp is not None else ", 23 °C"),
        fontsize=11,
    )
    fig.savefig(path, dpi=130)
    plt.close(fig)
