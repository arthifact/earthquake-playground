"""Exact 2D solution of Lamb's problem for case A (explosive line source at depth h in a homogeneous elastic
half-space, P-SV), by discrete-wavenumber integration (Bouchon and Aki 1977; Bouchon 1981): plane-wave expansion of
the source's P potential, free-surface reflection coefficients, sum over k, complex frequency to keep periodic
images and the Rayleigh pole off the axis. Exact up to the numerical sums (checked by halving dk and doubling kmax).

Writes out/analytic/A_lamb.npz with the point source, and with Earthquake Playground's source spread over its cells
(exp(-r^2 / 2) on the cells with r^2 <= 9, src/sim.wgsl), so the spread's own effect can be told apart.

Units: Earthquake Playground's (km, s, GPa, g/cm^3); saved as m/s, vertical positive up.
"""

import math
from pathlib import Path

import numpy as np

import cases as C

HERE = Path(__file__).resolve().parent


def moment_time(t, f0=C.F0, t0=1.2 / C.F0):
    """Earthquake Playground's moment: the integral of its Ricker, tau exp(-(pi f0 tau)^2) (s; times 1 GPa per cell area)."""
    tau = t - t0
    return tau * np.exp(-((math.pi * f0 * tau) ** 2))


def lamb(x_rec, z_rec, sources, vp, vs, rho, T=64.0, dt=0.01, fmax=6.0, L=1500.0, kmax=60.0):
    """Velocity (vx, vz down) in km/s at receivers (x_rec km, depth z_rec km) for explosive line sources
    [(x, depth, moment km^2 GPa)], the moment's time function being moment_time."""
    nt = int(round(T / dt)); t = np.arange(nt) * dt
    df = 1.0 / T; nf = int(fmax / df) + 1
    wI = math.pi / T
    w = 2 * math.pi * df * np.arange(nf) + 1j * wI                  # complex frequency (e^{-i w t} convention)
    m_w = (moment_time(t)[None, :] * np.exp(1j * w[:, None] * t[None, :])).sum(1) * dt
    dk = 2 * math.pi / L
    k = np.arange(-int(kmax / dk), int(kmax / dk) + 1) * dk
    W, K = np.meshgrid(w, k, indexing="ij")
    ka2, kb2 = (W / vp) ** 2, (W / vs) ** 2
    def root(a):
        r = np.sqrt(a); return np.where(r.imag < 0, -r, r)
    nu, ga = root(ka2 - K ** 2), root(kb2 - K ** 2)
    G = ga ** 2 - K ** 2
    R = G ** 2 + 4 * K ** 2 * nu * ga
    Rp = -(G ** 2 - 4 * K ** 2 * nu * ga) / R
    Rs = -4 * K * nu * G / R
    lam2mu = rho * vp ** 2
    ux = np.zeros((len(x_rec), nf), complex); uz = np.zeros_like(ux)
    for xs, h, m0 in sources:
        A = -(m0 * m_w[:, None] / lam2mu) * 1j / (4 * math.pi * nu)
        for r, (xr, z) in enumerate(zip(x_rec, z_rec)):
            if z >= h: raise ValueError("receivers above the source only")
            e_up, e_dn, e_s = np.exp(1j * nu * (h - z)), np.exp(1j * nu * (h + z)), np.exp(1j * (nu * h + ga * z))
            fx = A * (1j * K * (e_up + Rp * e_dn) - 1j * ga * Rs * e_s)
            fz = A * (-1j * nu * e_up + 1j * nu * Rp * e_dn + 1j * K * Rs * e_s)
            ph = np.exp(1j * k * (xr - xs))[None, :] * dk
            ux[r] += (fx * ph).sum(1); uz[r] += (fz * ph).sum(1)
    vx_w, vz_w = -1j * w * ux, -1j * w * uz
    wt = np.ones(nf); wt[0] = 0.5
    dw = 2 * math.pi * df
    syn = lambda F: (np.exp(wI * t)[None, :] / math.pi) * np.real(((F * wt)[:, :, None] * np.exp(-1j * np.real(w)[None, :, None] * t[None, None, :])).sum(1)) * dw
    return t - 1.2 / C.F0, syn(vx_w), syn(vz_w)


def spread_sources(xs, h):
    """Earthquake Playground's source cells around (xs, h) with their share of the moment (km^2 GPa)."""
    out = []
    for a in range(-3, 4):
        for b in range(-3, 4):
            if a * a + b * b <= 9:
                out.append((xs + a * C.H, h + b * C.H, math.exp(-0.5 * (a * a + b * b)) * C.H ** 2))
    return out


def main():
    c = C.CASES["A_lamb"]
    vp, vs, rho = C.ROCK["rock"]
    xs, h = c["src_km"]
    xr = np.array(C.RECEIVERS_KM); zr = np.full_like(xr, C.H / 2)
    m_total = C.source_weight_sum() * C.H ** 2
    t, vx, vz = lamb(xr, zr, [(xs, h, m_total)], vp, vs, rho)
    _, vx_s, vz_s = lamb(xr, zr, spread_sources(xs, h), vp, vs, rho)
    # convergence check: half the wavenumber step and twice the range
    _, vx2, vz2 = lamb(xr[[1, 7, 14]], zr[[1, 7, 14]], [(xs, h, m_total)], vp, vs, rho, L=3000.0, kmax=90.0)
    err = max(np.abs(vx2 - vx[[1, 7, 14]]).max() / np.abs(vx).max(), np.abs(vz2 - vz[[1, 7, 14]]).max() / np.abs(vz).max())
    (HERE / "out" / "analytic").mkdir(parents=True, exist_ok=True)
    # km/s -> m/s, vertical up
    np.savez(HERE / "out" / "analytic" / "A_lamb.npz", t=t, vx=vx * 1e3, vz=-vz * 1e3, vx_spread=vx_s * 1e3,
             vz_spread=-vz_s * 1e3, x=xr, convergence=err)
    print(f"Lamb (DWN): peak |vz| {np.abs(vz).max() * 1e3:.3e} m/s; convergence check {err:.2e} of the peak")


if __name__ == "__main__":
    main()
