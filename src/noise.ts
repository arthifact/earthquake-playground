// Noise sources for the Quake view: things on the surface that shake the ground all the time. Each pushes up and
// down at random, coloured to its own frequencies; its waves are part of the simulation (sim.wgsl), so they
// spread, bend and fade like any other, and the seismometers nearest it hear it best.

import type { NoiseSource } from "./sim";

export interface NoiseKind {
  name: string;
  note: string;
  f: number;                                 // centre frequency, Hz
  bw: number;                                // bandwidth, Hz
  swell: number;                             // seconds over which it swells and fades (0: steady)
  cal: number;                               // force for RMS 1 m/s up and down at 1 km on plain rock, below 4 Hz (measured in the browser)
}
export const KINDS = {
  ocean: { name: "Ocean waves", note: "Waves breaking on the coast: microseism, slow and everywhere near the sea.", f: 0.25, bw: 0.12, swell: 0, cal: 120 },
  traffic: { name: "Traffic", note: "A road: lorries and buses come and go, so it swells and fades.", f: 2.0, bw: 1.4, swell: 2.5, cal: 95 },
  factory: { name: "Factory", note: "Machines turning at a steady rate: one clear tone that never stops.", f: 2.4, bw: 0.05, swell: 0, cal: 30 },
} satisfies Record<string, NoiseKind>;
export type KindId = keyof typeof KINDS;

/** RMS ground velocity at 1 km, m/s. */
export const LEVELS: [number, string][] = [[1e-6, "1 µm/s at 1 km · weak"], [1e-5, "10 µm/s · strong"], [1e-4, "100 µm/s · very strong"]];

/** A source of this kind at cell (i, j), as the engine takes it, for time step dt and level (m/s at 1 km). */
export function source(kind: KindId, i: number, j: number, level: number, dt: number): NoiseSource {
  const k: NoiseKind = KINDS[kind];
  // a resonator: poles at radius r, angle 2π f dt
  const r = Math.exp(-Math.PI * k.bw * dt), a1 = 2 * r * Math.cos(2 * Math.PI * k.f * dt), a2 = r * r;
  // its RMS for uniform white noise (variance 1/12): an AR(2) process with φ1 = a1, φ2 = -a2
  const p2 = -a2, variance = ((1 - p2) / ((1 + p2) * ((1 - p2) ** 2 - a1 * a1))) / 12;
  return { i, j, force: level * k.cal, a1, a2, env: k.swell > 0 ? Math.exp(-dt / k.swell) : 0, norm: 1 / Math.sqrt(variance) };
}
