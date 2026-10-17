"""The validation cases, defined once for both codes.

Earthquake Playground's grid (src/ground.ts): 80 m cells, 768 x 400 on screen with 40 rows of sky, a 50-cell sponge at the
sides and the bottom. Cell (i, j) has its centre at x = (i - 50) * 0.08 km along the slice and depth
d = (j - 40 + 0.5) * 0.08 km (negative is up); the sponge columns copy the nearest column on screen.

Units: Earthquake Playground works in km, s, km/s and g/cm^3 (stress in GPa). SPECFEM2D works in SI.

Run: python cases.py  -> writes out/cases.json and out/grids/<case>.f32 (for the Earthquake Playground runner).
"""

import json
import math
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
OUT = HERE / "out"

# Earthquake Playground's grid (src/ground.ts, src/views/quake.ts)
H = 0.08
W, VH, SKY, SPONGE = 768, 400, 40, 50
NX, NZ = W + 2 * SPONGE, VH + SPONGE
VMAX = 7.6
F0 = 1.1
DT = 0.45 * H / VMAX          # Earthquake Playground's time step (src/sim.ts)

ROCK = {                        # vp, vs (km/s), rho (g/cm^3), as in src/ground.ts
    "soil": (2.8, 1.6, 1.9),
    "rock": (5.6, 3.2, 2.6),
    "hard": (6.6, 3.75, 2.9),
    "mantle": (7.6, 4.3, 3.3),
}
AIR = (0.0, 0.0, 0.0)

RECEIVERS_KM = [2.0 + 4.0 * r for r in range(15)]   # 2, 6, ..., 58 km along the slice
SECONDS = 40.0                                       # record length after the source's peak


def dc(dip_deg, kind):
    """Moment tensor (mxx, mzz, mxz) of a 2D double couple, z down, unit scalar moment: a fault dipping toward +x."""
    a = math.radians(dip_deg)
    down = (math.cos(a), math.sin(a))          # down the dip
    n = (math.sin(a), -math.cos(a))            # normal, into the hanging wall
    s = down if kind == "normal" else (-down[0], -down[1])
    return [2 * s[0] * n[0], 2 * s[1] * n[1], s[0] * n[1] + s[1] * n[0]]


def hill(x):
    """Case D's Gaussian hill (km above sea level)."""
    return 2.0 * np.exp(-(((x - 34.0) / 5.0) ** 2))


def basin_depth(x):
    """The Soft-soil valley preset (src/ground.ts): soft soil 3.4 km deep and 22 km wide, centred at 40 km."""
    return 3.4 * np.sqrt(np.maximum(0.0, 1.0 - ((x - 40.0) / 11.0) ** 2))


def model(case, x, d):
    """vp, vs, rho at x (km along the slice) and depth d (km, negative up), as arrays."""
    x = np.asarray(x, float); d = np.asarray(d, float)
    out = np.zeros((3,) + np.broadcast(x, d).shape)
    def put(mask, rock):
        for q in range(3): out[q][mask] = ROCK[rock][q] if rock != "air" else 0.0
    xb, db = np.broadcast_arrays(x, d)
    if case == "A_lamb" or case == "E_dc_deep":
        put(db >= 0, "rock")
    elif case == "B_layer":
        put(db >= 0, "rock"); put((db >= 0) & (db < 2.0), "soil")
    elif case == "C_basin":
        put(db >= 0, "rock"); put(db >= 12, "hard"); put(db >= 25, "mantle")
        put((db >= 0) & (db < basin_depth(xb)), "soil")
    elif case == "D_hill":
        put(db >= -hill(xb), "rock")
    else:
        raise KeyError(case)
    return out


CASES = {
    "A_lamb": dict(title="Lamb's problem: explosion 1 km deep in a homogeneous half-space",
                   src_km=(10.0, 1.0), m=[1.0, 1.0, 0.0], source="explosion"),
    "B_layer": dict(title="Soft layer (2 km of soil, Vs 1.6) over rock (Vs 3.2), 60-degree normal fault 6 km deep",
                    src_km=(10.0, 6.04), m=dc(60, "normal"), source="double couple, 60-degree normal"),
    "C_basin": dict(title="Soft-soil valley preset (basin 22 km wide, 3.4 km deep; rock, hard rock, mantle), quake 11 km deep",
                    src_km=(14.0, 11.0), m=dc(60, "normal"), source="double couple, 60-degree normal"),
    "D_hill": dict(title="Gaussian hill 2 km high (half-width 5 km) on a homogeneous half-space, explosion 2 km deep",
                   src_km=(10.0, 2.04), m=[1.0, 1.0, 0.0], source="explosion"),
    "E_dc_deep": dict(title="Double couple (30-degree thrust) 10 km deep in a homogeneous half-space",
                      src_km=(10.0, 10.04), m=dc(30, "reverse"), source="double couple, 30-degree thrust"),
}


def surface_km(case, x):
    """Height of the ground surface (km above sea level) at x, smooth (SPECFEM2D's mesh)."""
    return hill(np.asarray(x, float)) if case == "D_hill" else np.zeros_like(np.asarray(x, float))


VARIANTS = {
    # name: (refinement, sponge km): Earthquake Playground as the app runs it, and two variants for telling error sources apart
    "": (1, 4.0),            # the app: 80 m cells, 50-cell (4 km) sponge
    "@fine": (3, 4.0),       # 26.7 m cells (cell centres stay where they were), same 4 km sponge
    "@sponge150": (1, 12.0), # 80 m cells, 150-cell (12 km) sponge
    "@fine_sponge": (3, 12.0),  # both: 26.7 m cells and a 12 km sponge
}


def grid_params(variant=""):
    r, sponge_km = VARIANTS[variant]
    h = H / r
    sp = int(round(sponge_km / h))
    w, vh, sky = W * r, VH * r, SKY * r
    return dict(h=h, sponge=sp, w=w, vh=vh, sky=sky, nx=w + 2 * sp, nz=vh + sp, refine=r)


def qv_grid(case, variant=""):
    """The ground on Earthquake Playground's whole grid, as src/ground.ts build() samples it (cell centres; the sponge
    columns copy the nearest column on screen)."""
    g = grid_params(variant)
    i = np.arange(g["nx"]); j = np.arange(g["nz"])
    x = np.clip(i - g["sponge"], 0, g["w"] - 1) * g["h"]
    d = (j - g["sky"] + 0.5) * g["h"]
    X, D = np.meshgrid(x, d)        # [j, i]
    return model(case, X, D).astype(np.float32)


def source_weight_sum():
    """Sum of the source's spread exp(-r^2 / 2) over the cells with r^2 <= 9 (src/sim.wgsl)."""
    s = 0.0
    for a in range(-3, 4):
        for b in range(-3, 4):
            if a * a + b * b <= 9: s += math.exp(-0.5 * (a * a + b * b))
    return s


def m0_si():
    """The scalar moment per unit length (N m / m) that Earthquake Playground's unit source carries: the stress glut
    (1 GPa x the time function in s) over the cells it spreads to, each h^2."""
    return source_weight_sum() * (H * 1000.0) ** 2 * 1e9


def receivers_qv(case, variant=""):
    """Earthquake Playground's seismometer cells: the first cell of ground from the top in each receiver's column."""
    g = grid_params(variant); grid = qv_grid(case, variant)
    cells = []
    for xr in RECEIVERS_KM:
        i = int(round(xr / g["h"])) + g["sponge"]
        j = int(np.argmax(grid[0, :, i] > 0))
        cells.append((i, j))
    return cells, grid


HEAVY = ("@fine", "@fine_sponge")   # 9x the cells: minutes of full GPU load each, enough to freeze a laptop's screen


def main(variants=None):
    import sys
    if variants is None:
        variants = tuple(VARIANTS) if "--heavy" in sys.argv else tuple(v for v in VARIANTS if v not in HEAVY)
    (OUT / "grids").mkdir(parents=True, exist_ok=True)
    cases = []
    for variant in variants:
        g = grid_params(variant)
        for name, c in CASES.items():
            rec, grid = receivers_qv(name, variant)
            grid.tofile(OUT / "grids" / f"{name}{variant}.f32")
            si = int(round(c["src_km"][0] / g["h"])) + g["sponge"]
            sj = int(round(c["src_km"][1] / g["h"] - 0.5)) + g["sky"]
            assert abs((si - g["sponge"]) * g["h"] - c["src_km"][0]) < 1e-9, (name, variant)
            assert abs((sj - g["sky"] + 0.5) * g["h"] - c["src_km"][1]) < 1e-9, (name, variant)
            cases.append(dict(name=name + variant, case=name, variant=variant, title=c["title"],
                              grid=f"out/grids/{name}{variant}.f32", src=[si, sj], m=c["m"],
                              stations=[j * g["nx"] + i for i, j in rec], seconds=SECONDS,
                              **{k: g[k] for k in ("nx", "nz", "h", "sponge", "w", "vh", "sky")}))
    meta = dict(vmax=VMAX, f0=F0, receivers_km=RECEIVERS_KM, cases=cases)
    (OUT / "cases.json").write_text(json.dumps(meta, indent=1))
    print(f"{len(cases)} runs; dt {DT:.6f} s; source weight sum {source_weight_sum():.4f}; M0 {m0_si():.4e} N m/m")


if __name__ == "__main__":
    main()
