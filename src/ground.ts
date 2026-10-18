// The ground of the Quake view: a slice 61 km wide and 29 km deep under 3 km of sky, 80 m cells, with an absorbing
// layer of 50 cells at the sides and the bottom; or the same grid scaled up to 600 km wide (cells to 800 m, waves
// ten times longer). Rock types, the ready-made grounds, and their colours.

import type { KindId } from "./noise";
import { PAPER_RGB, earth, hex, mix, type RGB } from "./plot";

/** The slice: any width and depth (km). The grid keeps about CELLS cells under the surface, so every size runs
 *  as fast: a bigger slice has bigger cells (H km) and longer waves. SCALE is H / 80 m (the 61 × 29 km slice). */
export const MIN_KM = 10, MAX_KM = 1000, MIN_DEPTH = 5, MAX_DEPTH = 600;
const CELLS = 768 * 360;
export const SKY = 40, SPONGE = 50;          // rows of sky above sea level; absorbing cells at the sides and bottom
export let W = 768, VH = 400;                // cells on screen (VH includes the sky)
export let NX = W + 2 * SPONGE, NZ = VH + SPONGE;
export let SCALE = 1, H = 0.08;              // km per cell
export let WIDTH_KM = W * H, DEPTH_KM = (VH - SKY) * H;
/** Size the slice: width and depth (km), clamped to what the grid can hold. */
export function setGrid(widthKm: number, depthKm: number) {
  const w = Math.min(MAX_KM, Math.max(MIN_KM, widthKm)), d = Math.min(MAX_DEPTH, Math.max(MIN_DEPTH, depthKm));
  let h = Math.sqrt((w * d) / CELLS);
  // no side of more than 2048 cells or fewer than 96
  h = Math.max(h, w / 2048, d / 2048); h = Math.min(h, w / 96, d / 96);
  W = Math.round(w / h); VH = Math.round(d / h) + SKY;
  NX = W + 2 * SPONGE; NZ = VH + SPONGE;
  H = h; SCALE = h / 0.08; WIDTH_KM = W * H; DEPTH_KM = (VH - SKY) * H;
}

export interface Rock { name: string; vp: number; vs: number; rho: number; tint?: string; group?: string }
/** Typical speeds (km/s) and densities (g/cm³). The grid carries S waves down to 1.6 km/s, so the softest
 *  materials are stiffened to that (real soft soil and dry sand are slower). */
export const ROCK = {
  air: { name: "Air (cave)", vp: 0, vs: 0, rho: 0 },
  soil: { name: "Soft soil, clay", vp: 2.8, vs: 1.6, rho: 1.9, group: "Soft (stiffened to fit the grid)" },
  sand: { name: "Dry sand", vp: 2.4, vs: 1.6, rho: 1.8, group: "Soft (stiffened to fit the grid)" },
  wetsand: { name: "Wet sand (below the water table)", vp: 3.3, vs: 1.6, rho: 2.1, group: "Soft (stiffened to fit the grid)" },
  sediment: { name: "Sediment", vp: 3.8, vs: 2.2, rho: 2.3, group: "Sedimentary" },
  shale: { name: "Shale", vp: 3.6, vs: 1.9, rho: 2.5, group: "Sedimentary" },
  sandstone: { name: "Sandstone", vp: 4.2, vs: 2.5, rho: 2.4, group: "Sedimentary" },
  limestone: { name: "Limestone", vp: 5.2, vs: 2.8, rho: 2.6, group: "Sedimentary" },
  salt: { name: "Salt (halite)", vp: 4.5, vs: 2.6, rho: 2.16, tint: "#ead7df", group: "Sedimentary" },
  rock: { name: "Rock (upper crust)", vp: 5.6, vs: 3.2, rho: 2.6, group: "Crystalline" },
  granite: { name: "Granite", vp: 6.0, vs: 3.5, rho: 2.65, group: "Crystalline" },
  basalt: { name: "Basalt", vp: 6.2, vs: 3.4, rho: 2.9, group: "Crystalline" },
  hard: { name: "Hard rock (lower crust)", vp: 6.6, vs: 3.75, rho: 2.9, group: "Crystalline" },
  mantle: { name: "Mantle (peridotite)", vp: 8.05, vs: 4.5, rho: 3.35, group: "Crystalline" },
  ice: { name: "Ice", vp: 3.8, vs: 1.9, rho: 0.92, tint: "#d6e8ee", group: "Other" },
  water: { name: "Water", vp: 1.5, vs: 0, rho: 1.0, group: "Liquid (no S waves)" },
  magma: { name: "Magma", vp: 2.8, vs: 0, rho: 2.6, group: "Liquid (no S waves)" },
} satisfies Record<string, Rock>;
export type RockId = keyof typeof ROCK;
export const VMAX = 8.1;

/** A fault a model is known for: its upper end at x km from the model's left edge and top km deep, its dip (degrees)
 *  toward +x (toward 1) or -x (-1), its length (km), magnitude and slip. */
export interface KnownFault { x: number; top: number; dip: number; toward: 1 | -1; length: number; magnitude: number; slip: "normal" | "reverse" }
/** A model template: a real setting in kilometres, from x = 0 to its natural width; a slice of another width centres
 *  it and carries its edges on (it is never stretched). */
export interface Preset {
  name: string;
  cite: string;                             // a few words: what it is based on
  note: string;                             // one line: what it is
  about: string;                            // what it is based on (shown folded)
  width: number;                            // natural width (km)
  depth: number;                            // natural depth (km)
  fault?: KnownFault;
  noise?: Partial<Record<KindId, number>>;  // where noise sources of each kind belong (km), such as a coast
  at(x: number, d: number): Rock;           // the rock at x (km) and depth d (km below sea level, negative is up)
}

/** Rocks made by the templates (velocity gradients, named layers), so the readout can name them. */
const NAMED = new Map<string, Rock>();
const key = (vp: number, vs: number, rho: number) => `${Math.fround(vp)},${Math.fround(vs)},${Math.fround(rho)}`;
export function rock(name: string, vp: number, vs: number, rho: number): Rock {
  const k = key(vp, vs, rho);
  let r = NAMED.get(k);
  if (!r) { r = { name, vp, vs, rho }; NAMED.set(k, r); }
  return r;
}

/** The ground for a template on the whole grid (the absorbing layer copies the nearest column on screen). The
 *  template sits in the middle of the slice; past its edges, its edge columns carry on. */
export function build(preset: Preset) {
  const vp = new Float32Array(NX * NZ), vs = new Float32Array(NX * NZ), rho = new Float32Array(NX * NZ);
  const shift = (WIDTH_KM - preset.width) / 2;
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
    const x = Math.min(preset.width, Math.max(0, Math.min(W - 1, Math.max(0, i - SPONGE)) * H - shift));
    const r = preset.at(x, (j - SKY + 0.5) * H), k = j * NX + i;
    vp[k] = r.vp; vs[k] = r.vs; rho[k] = r.rho;
  }
  return { vp, vs, rho };
}
/** Where a template's x (km) lands in the slice (km from its left edge). */
export const placed = (preset: Preset, x: number) => x + (WIDTH_KM - preset.width) / 2;

/** The rock at a cell, by its speeds (for the readout). */
export function rockAt(vp: number, vs: number, rho: number): Rock {
  if (vp <= 0) return ROCK.air;
  return NAMED.get(key(vp, vs, rho)) ?? Object.values(ROCK as Record<string, Rock>).find((r) => Math.abs(r.vp - vp) < 0.01 && Math.abs(r.vs - vs) < 0.01 && Math.abs(r.rho - rho) < 0.01) ?? { name: "Custom rock", vp, vs, rho };
}

const TINTED = Object.values(ROCK as Record<string, Rock>).filter((r) => r.tint).map((r) => ({ vp: Math.fround(r.vp), rho: Math.fround(r.rho), tint: r.tint! }));
const WATER = mix(hex("#6f8fa8"), PAPER_RGB, 0.3), MAGMA = mix(hex("#8e3b46"), PAPER_RGB, 0.2);
/** Colours: Earth Forge's ramp by P speed, faded toward paper so the waves stand out. */
export function colour(vp: number, vs: number, rho: number): [number, number, number, number] {
  if (vp <= 0) return [...PAPER_RGB, 0];
  let c: RGB;
  const tinted = TINTED.find((r) => r.rho === rho && r.vp === vp);
  if (tinted) c = hex(tinted.tint);
  else if (vs <= 0) c = rho < 1.5 ? WATER : MAGMA;
  else c = mix(earth((vp - 2) / 6.2), PAPER_RGB, 0.42);
  return [c[0], c[1], c[2], 255];
}
export function rockCss(r: Rock) {
  const c = colour(r.vp, r.vs, r.rho);
  return c[3] ? `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})` : "#faf9f6";
}
