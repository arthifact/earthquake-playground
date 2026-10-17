"""Compare Earthquake Playground's seismograms with SPECFEM2D's (and, for case A, with the exact solution).

Everything is 2D, raw: ground velocity in m/s per unit of Earthquake Playground's source (no magnitude scaling, no 3D
spreading correction; see threed.py for that). Vertical is positive up, horizontal positive toward +x.

Per receiver and component:
  misfit  relative L2 misfit ||q - r|| / ||r|| over the whole record (-1 to 40 s)
  misfit_early  the same over the first 9 s of the reference's signal (1 s before its first arrival to 8 s after)
  peak    peak amplitude ratio max|q| / max|r|
  lag     cross-correlation lag (s, positive: Earthquake Playground late), sub-sample by a parabola
  onset   difference of first-arrival picks (first crossing of 5 % of the trace's peak), s
  EM, PM  Kristekova et al. (2006) single-valued envelope and phase misfits, 0.2-3 Hz (ObsPy tf_misfit)
Traces whose reference peak is below 3 % of the largest in that component and case (nodes, such as the
horizontal right above an explosion) are left out of the summaries.

Writes out/metrics.json, out/metrics.csv and figures/*.png.
"""

import csv
import json
import os
import warnings
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from obspy.signal.tf_misfit import em, pm
from scipy.interpolate import CubicSpline

import cases as C

HERE = Path(__file__).resolve().parent
WORK = Path(os.environ.get("SPECFEM_WORK", Path.home() / "Desktop/Research/specfem2d_work"))
FIG = HERE / "figures"
T = np.arange(-1.0, C.SECONDS + 1e-9, 0.01)
DT = 0.01
COMP = ("Z", "X")                      # vertical, horizontal
INK, BLUE, ORANGE, AQUA, YELLOW, GREY = "#0b0b0b", "#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#8c8b86"
plt.rcParams.update({"font.size": 9, "axes.spines.top": False, "axes.spines.right": False, "axes.edgecolor": "#52514e",
                     "axes.labelcolor": "#52514e", "xtick.color": "#52514e", "ytick.color": "#52514e",
                     "figure.facecolor": "#fcfcfb", "axes.facecolor": "#fcfcfb", "savefig.facecolor": "#fcfcfb"})


def load_qv(run):
    """Earthquake Playground records (km/s, z down, per unit source on that grid) -> m/s, up, per the 80 m grid's unit source."""
    meta = json.loads((HERE / "out" / "qv" / f"{run}.json").read_text())
    r = np.fromfile(HERE / "out" / "qv" / f"{run}.f32", np.float32).reshape(meta["samples"], meta["nst"], 2)
    t = np.arange(meta["samples"]) * meta["dt"] - meta["t0"]
    h = C.grid_params("@" + run.split("@")[1] if "@" in run else "")["h"]
    scale = 1e3 * (C.H / h) ** 2          # the unit source's moment goes with the cell area
    on = lambda y: CubicSpline(t, y, axis=1)(T)
    return {"Z": on(-r[:, :, 1].T.astype(float) * scale), "X": on(r[:, :, 0].T.astype(float) * scale)}


def load_specfem(case):
    out = {}
    for c in COMP:
        tr = [np.loadtxt(WORK / "runs" / case / "OUTPUT_FILES" / f"AA.S{k + 1:04d}.BX{c}.semv") for k in range(len(C.RECEIVERS_KM))]
        out[c] = np.array([np.interp(T, a[:, 0], a[:, 1]) for a in tr])
    return out


def load_analytic():
    a = np.load(HERE / "out" / "analytic" / "A_lamb.npz")
    on = lambda y: np.array([np.interp(T, a["t"], v) for v in y])
    return {"Z": on(a["vz"]), "X": on(a["vx"])}, {"Z": on(a["vz_spread"]), "X": on(a["vx_spread"])}


def onset(y, frac=0.05):
    a = np.abs(y); thr = frac * a.max()
    k = int(np.argmax(a > thr))
    if k == 0: return T[0]
    return T[k - 1] + (thr - a[k - 1]) / (a[k] - a[k - 1]) * DT


def lag(q, r):
    n = len(r)
    cc = np.fft.irfft(np.fft.rfft(q, 2 * n) * np.conj(np.fft.rfft(r, 2 * n)))
    cc = np.concatenate([cc[-(n - 1):], cc[:n]])
    k = int(np.argmax(cc))
    if 0 < k < len(cc) - 1:
        y0, y1, y2 = cc[k - 1], cc[k], cc[k + 1]
        d = 0.5 * (y0 - y2) / (y0 - 2 * y1 + y2)
    else:
        d = 0.0
    return (k - (n - 1) + d) * DT, cc[k] / np.sqrt((q * q).sum() * (r * r).sum())


def metrics(q, r):
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        e = float(em(q, r, dt=DT, fmin=0.2, fmax=3.0, nf=48))
        p = float(pm(q, r, dt=DT, fmin=0.2, fmax=3.0, nf=48))
    lg, ccmax = lag(q, r)
    t1 = onset(r); w = (T > t1 - 1) & (T < t1 + 8)
    return dict(misfit=float(np.linalg.norm(q - r) / np.linalg.norm(r)),
                misfit_early=float(np.linalg.norm((q - r)[w]) / np.linalg.norm(r[w])), peak=float(np.abs(q).max() / np.abs(r).max()),
                lag=float(lg), cc=float(ccmax), onset=float(onset(q) - onset(r)), em=e, pm=p)


def compare(q, r):
    rows = []
    for c in COMP:
        big = np.abs(r[c]).max(1)
        for k, x in enumerate(C.RECEIVERS_KM):
            m = metrics(q[c][k], r[c][k])
            m.update(receiver=k, x_km=x, comp=c, used=bool(big[k] >= 0.03 * big.max()))
            rows.append(m)
    return rows


def summary(rows):
    u = [m for m in rows if m["used"]]
    f = lambda key, fn: float(fn([abs(m[key]) if key != "peak" else m[key] for m in u]))
    return dict(misfit_median=f("misfit", np.median), misfit_max=f("misfit", np.max),
                early_median=f("misfit_early", np.median), early_max=f("misfit_early", np.max),
                peak_min=f("peak", np.min), peak_max=f("peak", np.max), lag_max=f("lag", np.max),
                onset_max=f("onset", np.max), onset_median=f("onset", np.median), lag_median=f("lag", np.median), em_median=f("em", np.median), pm_median=f("pm", np.median), n=len(u))


def section(case, ref, runs, path, title, ref_label="SPECFEM2D"):
    """Record section: every trace scaled by its reference trace's peak; misfit at the right."""
    fig, axes = plt.subplots(1, 2, figsize=(11, 8.2), sharey=True)
    xs = C.RECEIVERS_KM
    for ax, c in zip(axes, COMP):
        for k, x in enumerate(xs):
            big = np.abs(ref[c]).max(1)
            s = 1.6 / max(np.abs(ref[c][k]).max(), 0.03 * big.max())     # weak traces (nodes) at 3 % of the largest
            ax.plot(T, x + s * ref[c][k], color=INK, lw=1.4, label=ref_label if k == 0 else None)
            for label, (y, colour, ls) in runs.items():
                ax.plot(T, x + s * y[c][k], color=colour, lw=1.0, ls=ls, label=label if k == 0 else None)
            mis = np.linalg.norm(runs[next(iter(runs))][0][c][k] - ref[c][k]) / np.linalg.norm(ref[c][k])
            ax.text(C.SECONDS + 0.4, x, f"{100 * mis:.0f} %" if big[k] >= 0.03 * big.max() else "weak", va="center", fontsize=7.5, color="#52514e")
        ax.set_xlim(-1, C.SECONDS + 3.5); ax.set_ylim(xs[-1] + 4, xs[0] - 4)
        ax.set_xlabel("time after the source's peak (s)")
        ax.set_title({"Z": "vertical (up)", "X": "horizontal (+x)"}[c], fontsize=9, color="#52514e")
        ax.grid(axis="x", color="#e6e5e0", lw=0.6)
    axes[0].set_ylabel("receiver position along the slice (km); each trace scaled to its reference's peak")
    axes[0].legend(loc="lower right", frameon=False, fontsize=8)
    src = C.CASES[case]["src_km"]
    axes[1].annotate("misfit", (C.SECONDS + 0.4, xs[0] - 3), fontsize=7.5, color="#52514e", annotation_clip=False)
    fig.suptitle(f"{title}\nsource at {src[0]:g} km, {src[1]:g} km deep", fontsize=10, x=0.06, ha="left")
    fig.tight_layout(); fig.savefig(path, dpi=130); plt.close(fig)


def misfit_vs_offset(results, path):
    fig, axes = plt.subplots(1, len(C.CASES), figsize=(13, 3.4), sharey=True)
    styles = {"": ("Earthquake Playground (80 m, 4 km C-PML)", BLUE, "-"), "@sponge150": ("12 km C-PML", YELLOW, "--"),
              "@fine": ("26.7 m cells", AQUA, "--"), "@fine_sponge": ("26.7 m cells, 12 km C-PML", INK, "-")}
    for ax, case in zip(axes, C.CASES):
        src = C.CASES[case]["src_km"][0]
        for v, (label, colour, ls) in styles.items():
            if v not in results[case]: continue
            rows = [m for m in results[case][v]["rows"] if m["used"] and m["comp"] == "Z"]
            ax.plot([m["x_km"] for m in rows], [100 * m["misfit"] for m in rows], color=colour, ls=ls, lw=2,
                    marker="o", ms=4, label=label)
        ax.axvline(src, color="#8c8b86", lw=0.8, ls=":")
        ax.annotate("epicentre", (src, 0.97), xycoords=("data", "axes fraction"), fontsize=7, color="#52514e", ha="left")
        ax.set_title(case.replace("_", " "), fontsize=9); ax.set_xlabel("receiver position (km)")
        ax.grid(color="#e6e5e0", lw=0.6)
    axes[0].set_ylabel("vertical: L2 misfit to SPECFEM2D (%)")
    axes[0].legend(frameon=False, fontsize=7.5)
    fig.tight_layout(); fig.savefig(path, dpi=130); plt.close(fig)


def lamb_zoom(qv, fine, sf, exact, path):
    fig, axes = plt.subplots(2, 3, figsize=(12, 5.4))
    for col, k in enumerate([2 + 1, 8, 14]):         # 4, 28 and 48 km from the epicentre
        for row, c in enumerate(COMP):
            ax = axes[row, col]
            ax.plot(T, exact[c][k], color=ORANGE, lw=2.4, label="exact (wavenumber integral)")
            ax.plot(T, sf[c][k], color=INK, lw=1.0, ls="--", label="SPECFEM2D")
            ax.plot(T, qv[c][k], color=BLUE, lw=1.2, label="Earthquake Playground 80 m")
            if fine is not None: ax.plot(T, fine[c][k], color=AQUA, lw=1.0, label="Earthquake Playground 26.7 m")
            d = abs(C.RECEIVERS_KM[k] - 10.0)
            t0 = d / 5.6 - 1.5; ax.set_xlim(max(-1, t0), d / 2.9 + 3.5)
            ax.set_title(f"{d:g} km, {'vertical' if c == 'Z' else 'horizontal'}", fontsize=9)
            ax.grid(color="#e6e5e0", lw=0.6)
            if col == 0: ax.set_ylabel("m/s per unit source")
    axes[0, 0].legend(frameon=False, fontsize=7.5)
    for ax in axes[1]: ax.set_xlabel("time (s)")
    fig.tight_layout(); fig.savefig(path, dpi=130); plt.close(fig)


def main():
    FIG.mkdir(exist_ok=True)
    results, csv_rows = {}, []
    for case in C.CASES:
        ref = load_specfem(case)
        results[case] = {}
        have = [v for v in C.VARIANTS if (HERE / "out" / "qv" / f"{case}{v}.json").exists()]
        qv = {v: load_qv(case + v) for v in have}
        for v in have:
            rows = compare(qv[v], ref)
            results[case][v] = dict(summary=summary(rows), rows=rows)
            csv_rows += [dict(case=case, run="quakeview" + v, reference="specfem2d", **m) for m in rows]
        # the sponge's echoes: what the 12 km sponge takes away, against the trace's peak
        def echo_of(a, b):
            out = {}
            for c in COMP:
                big = np.abs(ref[c]).max(1); use = big >= 0.03 * big.max()
                e = np.abs(qv[a][c] - qv[b][c]).max(1)[use] / np.abs(qv[b][c]).max(1)[use]
                out[c] = dict(median=float(np.median(e)), max=float(e.max()))
            return out
        echo = echo_of("", "@sponge150")
        results[case]["sponge_echo"] = echo
        # the same on the 26.7 m grid (the sponge acts per step, and there are three times as many steps)
        if "@fine" in qv and "@fine_sponge" in qv: results[case]["sponge_echo_fine"] = echo_of("@fine", "@fine_sponge")
        runs = {"Earthquake Playground (80 m)": (qv[""], BLUE, "-")}
        if case == "A_lamb":
            exact, exact_spread = load_analytic()
            for name, y in (("specfem2d", ref), ("quakeview", qv[""]), ("quakeview@fine", qv.get("@fine")),
                            ("exact_spread", exact_spread)):
                if y is None: continue
                rows = compare(y, exact)
                results[case][f"{name} vs exact"] = dict(summary=summary(rows), rows=rows)
                csv_rows += [dict(case=case, run=name, reference="exact", **m) for m in rows]
            runs["exact"] = (exact, ORANGE, ":")
            lamb_zoom(qv[""], qv.get("@fine"), ref, exact, FIG / "A_lamb_zoom.png")
        section(case, ref, runs, FIG / f"{case}.png", C.CASES[case]["title"])
        s = results[case][""]["summary"]
        print(f"{case:10s} misfit median {100 * s['misfit_median']:5.1f} % max {100 * s['misfit_max']:5.1f} %  "
              f"peak {s['peak_min']:.3f}-{s['peak_max']:.3f}  |lag| <= {s['lag_max'] * 1000:.0f} ms  "
              f"EM {100 * s['em_median']:.1f} %  PM {100 * s['pm_median']:.1f} %  sponge echo median {100 * echo['Z']['median']:.1f} % max {100 * echo['Z']['max']:.1f} % (Z)")
    misfit_vs_offset(results, FIG / "misfit_vs_distance.png")
    (HERE / "out" / "metrics.json").write_text(json.dumps(results, indent=1))
    with open(HERE / "out" / "metrics.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(csv_rows[0])); w.writeheader(); w.writerows(csv_rows)


if __name__ == "__main__":
    main()
