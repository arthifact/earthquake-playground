"""How good is Earthquake Playground's conversion of its 2D seismograms to 3D (src/views/quake.ts readRecords: amplitude
x sqrt(20 km / distance), calibrated at 20 km)?

A 2D simulation has line sources. Its far field differs from a point source's in two ways: amplitude (1/sqrt(r)
against 1/r for body waves, 1 against 1/sqrt(r) for surface waves: the sqrt(20/r) factor fixes both), and pulse
shape: u3D(w) ~ sqrt(w / (2 pi c r)) exp(-i pi/4) u2D(w), a half-derivative, and a factor 1/sqrt(c) that differs
between P, S and Rayleigh waves. The test: the exact P wave of an explosion in a whole space (Vp 5.6 km/s),
2D (line) and 3D (point), with Earthquake Playground's moment-time function; the app's conversion against the exact 3D, and
against the half-derivative conversion.

The app now half-differentiates (src/views/quake.ts readRecords); this checks its discrete filter too.

Writes out/threed.json and figures/threed.png.
"""

import json
import math
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from scipy.special import hankel1

import cases as C
from compare import AQUA, BLUE, INK, ORANGE
from lamb import moment_time

HERE = Path(__file__).resolve().parent
VP, RHO = 5.6, 2.6
DT, NT = 0.005, 2 ** 15
R = np.array([2, 5, 10, 20, 30, 40, 50, 60.0])


def fields():
    t = np.arange(NT) * DT
    f = np.fft.rfftfreq(NT, DT); w = 2 * math.pi * f
    # e^{-i w t} convention: X(w) = sum x e^{+i w t} dt
    M = np.conj(np.fft.rfft(moment_time(t))) * DT
    k = w / VP
    v2, v3, vc = [], [], []
    with np.errstate(all="ignore"):
        for r in R:
            u2 = (M / (RHO * VP ** 2)) * 0.25j * k * hankel1(1, k * r)              # line source: d/dr of -(M/rho a^2)(i/4) H0(kr)
            u3 = -(M / (4 * math.pi * RHO * VP ** 2)) * np.exp(1j * k * r) * (1j * k / r - 1 / r ** 2)
            uc = u2 * np.sqrt(w / (2 * math.pi * VP * r)) * np.exp(-0.25j * math.pi)
            back = lambda U: np.fft.irfft(np.conj(np.nan_to_num(-1j * w * U)), NT) / DT   # velocity, back to time
            v2.append(back(u2)); v3.append(back(u3)); vc.append(back(uc))
    return t - 1.2 / C.F0, np.array(v2), np.array(v3), np.array(vc)


def main():
    t, v2, v3, vc = fields()
    i20 = int(np.where(R == 20)[0][0])
    old = v2 * np.sqrt(20.0 / R)[:, None]                         # the app before: sqrt(20 km / r) only
    old *= np.abs(v3[i20]).max() / np.abs(old[i20]).max()       # the app calibrates its amplitude at 20 km
    # the app now (src/views/quake.ts readRecords): the record at 100 samples per second, half-differentiated by
    # Grunwald-Letnikov weights with gain 1 at f0, times sqrt(20 km / r)
    sps, step = 100, int(round(1 / (100 * DT)))
    w = np.ones(int(40 * sps)); w[1:] = np.cumprod(1 - 1.5 / np.arange(1, len(w)))
    keep = t >= 0
    app = np.zeros_like(v2)
    for k in range(len(R)):
        x = v2[k][keep][::step]
        y = np.convolve(x, w)[:len(x)] * math.sqrt(sps / (2 * math.pi * C.F0)) * math.sqrt(20.0 / R[k])
        app[k][keep] = np.interp(t[keep], t[keep][::step], y)
    app *= np.abs(v3[i20]).max() / np.abs(app[i20]).max()
    vc *= np.abs(v3[i20]).max() / np.abs(vc[i20]).max()
    rows = []
    for k, r in enumerate(R):
        shape = lambda y: np.linalg.norm(y / np.abs(y).max() - v3[k] / np.abs(v3[k]).max()) / np.linalg.norm(v3[k] / np.abs(v3[k]).max())
        spec = lambda y: np.fft.rfftfreq(NT, DT)[np.argmax(np.abs(np.fft.rfft(y)))]
        rows.append(dict(r_km=float(r), old_peak_ratio=float(np.abs(old[k]).max() / np.abs(v3[k]).max()),
                         old_shape_misfit=float(shape(old[k])), app_peak_ratio=float(np.abs(app[k]).max() / np.abs(v3[k]).max()),
                         app_shape_misfit=float(shape(app[k])), halfderiv_peak_ratio=float(np.abs(vc[k]).max() / np.abs(v3[k]).max()),
                         halfderiv_shape_misfit=float(shape(vc[k])), peak_freq_2d=float(spec(v2[k])), peak_freq_3d=float(spec(v3[k]))))
        print(f"r {r:4.0f} km: before peak/exact {rows[-1]['old_peak_ratio']:.3f}, shape {100 * rows[-1]['old_shape_misfit']:.0f} %; "
              f"now {rows[-1]['app_peak_ratio']:.3f}, {100 * rows[-1]['app_shape_misfit']:.1f} %; "
              f"half-derivative {rows[-1]['halfderiv_peak_ratio']:.3f}, {100 * rows[-1]['halfderiv_shape_misfit']:.1f} %; "
              f"peak frequency 2D {rows[-1]['peak_freq_2d']:.2f} Hz, 3D {rows[-1]['peak_freq_3d']:.2f} Hz")
    (HERE / "out" / "threed.json").write_text(json.dumps(rows, indent=1))

    fig, axes = plt.subplots(1, 4, figsize=(13, 3.2), gridspec_kw={"width_ratios": [1, 1, 1, 1.2]})
    for ax, r in zip(axes[:3], (5, 20, 50)):
        k = int(np.where(R == r)[0][0]); ta = r / VP
        for y, colour, lw, ls, label in ((v3[k], ORANGE, 2.4, "-", "exact 3D (point source)"), (old[k], BLUE, 1.3, "-", "before: 2D x sqrt(20 km / r)"),
                                         (app[k], INK, 1.0, "--", "now: half-derivative too")):
            ax.plot(t - ta, y * 1e3, color=colour, lw=lw, ls=ls, label=label)
        ax.set_xlim(-1.2, 2.5); ax.set_title(f"P wave at {r} km", fontsize=9); ax.set_xlabel("time after the P arrival (s)")
        ax.grid(color="#e6e5e0", lw=0.6)
    axes[0].set_ylabel("velocity (arbitrary)"); axes[0].legend(frameon=False, fontsize=7)
    ax = axes[3]
    ax.plot(R, [100 * q["old_shape_misfit"] for q in rows], color=BLUE, marker="o", ms=4, lw=2, label="before: shape misfit")
    ax.plot(R, [100 * q["app_shape_misfit"] for q in rows], color=INK, ls="--", marker="o", ms=4, lw=1.4, label="now: shape misfit")
    ax.plot(R, [100 * abs(q["app_peak_ratio"] - 1) for q in rows], color=AQUA, marker="s", ms=4, lw=2, label="now: peak error")
    ax.set_xlabel("distance (km)"); ax.set_ylabel("%"); ax.legend(frameon=False, fontsize=7); ax.grid(color="#e6e5e0", lw=0.6)
    ax.set_title("against the exact 3D P wave", fontsize=9)
    fig.tight_layout(); fig.savefig(HERE / "figures" / "threed.png", dpi=130); plt.close(fig)


if __name__ == "__main__":
    main()
