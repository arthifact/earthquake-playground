"""Set up and run the validation cases in SPECFEM2D (spectral elements, degree 4, P-SV, no attenuation, CPML on the
left, right and bottom, free surface on top).

The mesh reaches 8 km past each side of Earthquake Playground's 61.44 km slice and 36 km deep; elements are 250 m (about 8
GLL points per shortest S wavelength at 3 Hz in the 1.6 km/s soil). Layer boundaries are mesh boundaries (B, C);
the basin (C) is read from a 25 m tomography grid inside the top 12 km; the hill (D) is the mesh's top surface.
The source is a point moment tensor whose moment is the integral of Earthquake Playground's Ricker (SPECFEM2D's
"first derivative of a Gaussian", type 2), scaled to the moment Earthquake Playground's spread-out unit source carries.

Usage: python specfem.py [--run] [--jobs 5] [--dx 0.25] [--tag ""] [case ...]
Run directories go to $SPECFEM_WORK/runs/<case><tag> (default ~/Desktop/Research/specfem2d_work).
"""

import argparse
import math
import os
import re
import shutil
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np

import cases as C

SPECFEM = Path(os.environ.get("SPECFEM2D", Path.home() / "Desktop/Research/specfem2d"))
WORK = Path(os.environ.get("SPECFEM_WORK", Path.home() / "Desktop/Research/specfem2d_work"))

XMIN, XMAX, ZBOT = -8.0, 69.5, -36.0     # km
PML_ELEMENTS = 4


def set_keys(text, values):
    for k, v in values.items():
        pat = re.compile(rf"^({re.escape(k)}\s*=\s*)(.*)$" if k == "title" else rf"^({re.escape(k)}\s*=\s*)(\S+)", re.M)
        assert pat.search(text), k
        text = pat.sub(lambda m: m.group(1) + str(v), text, count=1)
    return text


def replace_block(text, key, lines):
    """Replace the numeric lines that follow `key = n` (materials, regions) with `lines`."""
    rows = text.splitlines()
    i = next(k for k, r in enumerate(rows) if re.match(rf"^{key}\s*=", r))
    rows[i] = re.sub(r"=\s*\S+", f"= {len(lines)}", rows[i], count=1)
    j = i + 1
    while j < len(rows) and not re.match(r"^[A-Za-z_]", rows[j]): j += 1
    numeric = [k for k in range(i + 1, j) if re.match(r"^\s*-?\d", rows[k])]
    at = numeric[0]
    rows = rows[:at] + lines + [r for k, r in enumerate(rows[at:j], at) if k not in numeric] + rows[j:]
    return "\n".join(rows) + "\n"


def material(rock, number):
    vp, vs, rho = C.ROCK[rock]
    return f"{number} 1 {rho * 1000:.1f}d0 {vp * 1000:.1f}d0 {vs * 1000:.1f}d0 0 0 9999 9999 0 0 0 0 0 0"


def interfaces(surfaces, layers):
    """surfaces: list of (x, z) arrays in m from the bottom up; layers: elements per layer."""
    s = ["# number of interfaces", f" {len(surfaces)}"]
    for k, (x, z) in enumerate(surfaces):
        s += [f"# interface {k + 1}", f" {len(x)}"] + [f" {a:.3f} {b:.3f}" for a, b in zip(x, z)]
    s += ["# elements per layer, bottom up"] + [f" {n}" for n in layers]
    return "\n".join(s) + "\n"


def setup(case, dx=0.25, tag=""):
    c = C.CASES[case]
    run = WORK / "runs" / (case + tag)
    if run.exists(): shutil.rmtree(run)
    (run / "DATA").mkdir(parents=True); (run / "OUTPUT_FILES").mkdir()
    nx = int(round((XMAX - XMIN) / dx))
    flat = lambda z: (np.array([XMIN, XMAX]) * 1000, np.array([z, z]) * 1000)
    nz = lambda top, bottom: int(round((top - bottom) / dx))
    tomo = None
    if case in ("A_lamb", "E_dc_deep"):
        mats, surf, layers = [material("rock", 1)], [flat(ZBOT), flat(0)], [nz(0, ZBOT)]
        regions = [f"1 {nx} 1 {layers[0]} 1"]
    elif case == "B_layer":
        mats = [material("rock", 1), material("soil", 2)]
        surf, layers = [flat(ZBOT), flat(-2.0), flat(0)], [nz(-2.0, ZBOT), nz(0, -2.0)]
        regions = [f"1 {nx} 1 {layers[0]} 1", f"1 {nx} {layers[0] + 1} {sum(layers)} 2"]
    elif case == "C_basin":
        # tomography material: the 5th number non-zero means elastic
        mats = [material("mantle", 1), material("hard", 2), "3 -1 0 0 1 0 0 0 0 0 0 0 0 0 0"]
        surf = [flat(ZBOT), flat(-25.0), flat(-12.0), flat(0)]
        layers = [nz(-25, ZBOT), nz(-12, -25), nz(0, -12)]
        a, b = layers[0], layers[0] + layers[1]
        regions = [f"1 {nx} 1 {a} 1", f"1 {nx} {a + 1} {b} 2", f"1 {nx} {b + 1} {sum(layers)} 3"]
        tomo = run / "DATA" / "tomo.xyz"
        step = 0.025
        xs = np.round(np.arange(XMIN, XMAX + step / 2, step), 6); zs = np.round(np.arange(-12.0, 0.0 + step / 2, step), 6)
        X, Z = np.meshgrid(xs, zs)
        # the bottom row (12 km) belongs to the rock above the hard rock
        vp, vs, rho = C.model(case, X, np.minimum(-Z, 11.999)) * 1000.0
        with open(tomo, "w") as f:
            f.write(f"{xs[0] * 1000:.1f} {zs[0] * 1000:.1f} {xs[-1] * 1000:.1f} {zs[-1] * 1000:.1f}\n")
            f.write(f"{step * 1000:.1f} {step * 1000:.1f}\n{len(xs)} {len(zs)}\n")
            f.write(f"{vp.min():.1f} {vp.max():.1f} {vs.min():.1f} {vs.max():.1f} {rho.min():.1f} {rho.max():.1f}\n")
            np.savetxt(f, np.column_stack([X.ravel() * 1000, Z.ravel() * 1000, vp.ravel(), vs.ravel(), rho.ravel()]), fmt="%.1f")
    elif case == "D_hill":
        mats = [material("rock", 1)]
        xt = np.arange(XMIN, XMAX + 1e-9, 0.05)
        surf, layers = [flat(ZBOT), (xt * 1000, C.hill(xt) * 1000)], [nz(0, ZBOT)]
        regions = [f"1 {nx} 1 {layers[0]} 1"]
    (run / "DATA" / "interfaces.dat").write_text(interfaces(surf, layers))

    dt = 2.0e-3 * dx / 0.25
    nstep = int(math.ceil((C.SECONDS + 1.2 / C.F0 + 0.2) / dt / 10) * 10)
    sub = max(1, int(round(0.01 / dt)))
    par = (SPECFEM / "DATA" / "Par_file").read_text()
    par = set_keys(par, {
        "title": case, "NPROC": 1, "NSTEP": nstep, "DT": f"{dt:.6e}".replace("e", "d"), "MODEL": "default",
        "SAVE_MODEL": "default", "seismotype": 2, "NTSTEP_BETWEEN_OUTPUT_SEISMOS": nstep,
        "NTSTEP_BETWEEN_OUTPUT_SAMPLE": sub, "save_ASCII_seismograms": ".true.",
        "save_binary_seismograms_single": ".false.", "use_existing_STATIONS": ".true.",
        "PML_BOUNDARY_CONDITIONS": ".true.", "NELEM_PML_THICKNESS": PML_ELEMENTS, "STACEY_ABSORBING_CONDITIONS": ".false.",
        "TOMOGRAPHY_FILE": "./DATA/tomo.xyz", "interfacesfile": "interfaces.dat",
        "xmin": f"{XMIN * 1000:.1f}d0", "xmax": f"{XMAX * 1000:.1f}d0", "nx": nx,
        "absorbbottom": ".true.", "absorbright": ".true.", "absorbtop": ".false.", "absorbleft": ".true.",
        "NTSTEP_BETWEEN_OUTPUT_INFO": 2000, "NTSTEP_BETWEEN_OUTPUT_IMAGES": nstep, "output_color_image": ".false.",
        "output_postscript_snapshot": ".false.", "output_grid_Gnuplot": ".false.", "output_grid_ASCII": ".false.",
        "ATTENUATION_VISCOELASTIC": ".false.", "P_SV": ".true.", "time_stepping_scheme": 1, "GPU_MODE": ".false.",
    })
    par = replace_block(par, "nbmodels", mats)
    par = replace_block(par, "nbregions", regions)
    (run / "DATA" / "Par_file").write_text(par)

    xs_km, ds_km = c["src_km"]
    m = c["m"]
    src = set_keys((SPECFEM / "DATA" / "SOURCE").read_text(), {
        "source_surf": ".false.", "xs": f"{xs_km * 1000:.1f}", "zs": f"{-ds_km * 1000:.1f}", "source_type": 2,
        "time_function_type": 2, "f0": C.F0, "tshift": 0.0,
        # Earthquake Playground is z down, SPECFEM2D z up: mxz changes sign
        "Mxx": f"{m[0]:.10f}", "Mzz": f"{m[1]:.10f}", "Mxz": f"{-m[2]:.10f}",
        # SPECFEM2D's type 2 is -factor * t exp(-(pi f0 t)^2); Earthquake Playground's moment is +t exp(-(pi f0 t)^2)
        "factor": f"{-C.m0_si():.8e}".replace("e", "d"),
    })
    (run / "DATA" / "SOURCE").write_text(src)

    # receivers 40 m under the surface, as Earthquake Playground's (the middle of the top cell)
    xr = np.array(C.RECEIVERS_KM)
    zr = C.surface_km(case, xr) - C.H / 2
    (run / "DATA" / "STATIONS").write_text("".join(
        f"S{k + 1:04d}    AA {x * 1000:16.4f} {z * 1000:16.4f}       0.0         0.0\n" for k, (x, z) in enumerate(zip(xr, zr))))
    return run


def execute(run):
    t = time.time()
    for exe in ("xmeshfem2D", "xspecfem2D"):
        with open(run / f"{exe}.log", "w") as log:
            r = subprocess.run([str(SPECFEM / "bin" / exe)], cwd=run, stdout=log, stderr=subprocess.STDOUT)
        text = (run / f"{exe}.log").read_text(errors="replace")
        if r.returncode or "Error detected" in text or "STOP Error" in text:
            raise RuntimeError(f"{exe} failed in {run}, see {run / (exe + '.log')}")
    return run.name, time.time() - t


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cases", nargs="*", default=list(C.CASES))
    ap.add_argument("--run", action="store_true")
    ap.add_argument("--jobs", type=int, default=5)
    ap.add_argument("--dx", type=float, default=0.25)
    ap.add_argument("--tag", default="")
    a = ap.parse_args()
    runs = [setup(c, a.dx, a.tag) for c in a.cases]
    print("set up:", *[str(r) for r in runs], sep="\n  ")
    if a.run:
        with ThreadPoolExecutor(a.jobs) as ex:
            for name, secs in ex.map(execute, runs):
                print(f"{name}: {secs / 60:.1f} min", flush=True)


if __name__ == "__main__":
    sys.exit(main())
