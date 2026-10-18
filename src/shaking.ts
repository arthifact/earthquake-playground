// How big the shaking is: magnitude, explosions and intensity. The simulation is linear, so a quake's size only
// scales its waves; the scale here is the source spectrum at the simulation's frequency.

/** Seismic moment (N·m) of moment magnitude m. */
export const moment = (m: number) => 10 ** (1.5 * m + 9.1);
/** Brune corner frequency (Hz) for a 3 MPa stress drop and S speed 3.5 km/s. */
export const corner = (m: number) => 4.9e6 * 3.5 * (30 / (moment(m) * 1e7)) ** (1 / 3);
/** Ground motion near f Hz relative to magnitude 5: grows with the moment, but big quakes put their energy
 *  into longer waves (below the corner frequency), so it grows more slowly above magnitude 5 or so. */
export const size = (m: number, f: number) => (moment(m) / moment(5)) * (1 + (f / corner(5)) ** 2) / (1 + (f / corner(m)) ** 2);
/** Magnitude of an explosion of kt kilotons of TNT (body-wave magnitude in hard rock). */
export const blastMagnitude = (kt: number) => 4.45 + 0.75 * Math.log10(kt);
/** How far a rupture of magnitude m reaches down its dip (km): what a slice through the fault shows. Down-dip
 *  width from Wells and Coppersmith (1994) for normal and reverse faults, and from Strasser et al. (2010) for
 *  shallow-dipping megathrusts (subduction interfaces, under 25°). */
const WIDTH = { normal: [-1.14, 0.35], reverse: [-1.61, 0.41], megathrust: [-0.882, 0.351] } as const;
const widthKind = (slip: "normal" | "reverse", dip: number) => slip === "normal" ? WIDTH.normal : dip < 25 ? WIDTH.megathrust : WIDTH.reverse;
export const ruptureKm = (m: number, slip: "normal" | "reverse", dip: number) => { const [a, b] = widthKind(slip, dip); return 10 ** (a + b * m); };
/** The magnitude whose rupture reaches km down the dip. */
export const magnitudeFor = (km: number, slip: "normal" | "reverse", dip: number) => { const [a, b] = widthKind(slip, dip); return (Math.log10(km) - a) / b; };

/** Modified Mercalli intensity from peak ground velocity in cm/s (Worden et al., 2012). */
export function intensity(pgv: number) {
  const l = Math.log10(Math.max(pgv, 1e-9));
  return Math.min(10, Math.max(1, l <= 0.53 ? 3.78 + 1.47 * l : 2.89 + 3.16 * l));
}
export const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
export const FELT = ["not felt", "weak", "weak", "light", "moderate", "strong", "very strong", "severe", "violent", "extreme"];

export const BLASTS: { id: string; name: string; kt: number }[] = [
  { id: "quarry", name: "Quarry blast · 10 t", kt: 0.01 },
  { id: "mine", name: "Mining blast · 100 t", kt: 0.1 },
  { id: "large", name: "Large chemical blast · 1 kt", kt: 1 },
  { id: "n10", name: "Nuclear test · 10 kt", kt: 10 },
  { id: "n100", name: "Nuclear test · 100 kt", kt: 100 },
  { id: "n1000", name: "Nuclear test · 1 Mt", kt: 1000 },
];

/** A value in SI units with a readable prefix: base is "m", "m/s" or "m/s²". */
export function units(v: number, base: string) {
  const a = Math.abs(v);
  const [k, p] = a >= 1 ? [1, ""] : a >= 1e-2 && base !== "m/s²" ? [1e-2, "c"] : a >= 1e-3 ? [1e-3, "m"] : a >= 1e-6 ? [1e-6, "µ"] : [1e-9, "n"];
  const x = v / k;
  return `${Math.abs(x) >= 100 ? x.toFixed(0) : Math.abs(x) >= 10 ? x.toFixed(1) : x.toFixed(2)} ${p}${base}`;
}
