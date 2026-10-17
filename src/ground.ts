// The ground of the Quake view: a slice 61 km wide and 29 km deep under 3 km of sky, 80 m cells, with a sponge
// of 50 cells at the sides and the bottom. Rock types, the ready-made grounds, and their colours.

import type { KindId } from "./noise";
import { PAPER_RGB, earth, hex, mix, type RGB } from "./plot";

export const H = 0.08;                       // km per cell
export const W = 768, VH = 400, SKY = 40;    // cells on screen; rows of sky above sea level
export const SPONGE = 50;
export const NX = W + 2 * SPONGE, NZ = VH + SPONGE;
export const WIDTH_KM = W * H, DEPTH_KM = (VH - SKY) * H;

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
  mantle: { name: "Mantle (peridotite)", vp: 7.6, vs: 4.3, rho: 3.3, group: "Crystalline" },
  ice: { name: "Ice", vp: 3.8, vs: 1.9, rho: 0.92, tint: "#d6e8ee", group: "Other" },
  water: { name: "Water", vp: 1.5, vs: 0, rho: 1.0, group: "Liquid (no S waves)" },
  magma: { name: "Magma", vp: 2.8, vs: 0, rho: 2.6, group: "Liquid (no S waves)" },
} satisfies Record<string, Rock>;
export type RockId = keyof typeof ROCK;
export const VMAX = 7.6;

export interface Preset {
  name: string;
  note: string;
  quake: [number, number];                  // x, depth (km)
  stations: number[];                      // x (km), three of them
  fault?: { x: number; dip: number };       // where a fault meets the surface (km) and its dip (degrees)
  noise?: Partial<Record<KindId, number>>;  // where noise sources of each kind belong (km), such as a coast
  at(x: number, d: number): Rock;           // the rock at x (km) and depth d (km, negative is up)
}

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const layered = (d: number, soil: number, rock: number, hard: number, top: Rock = ROCK.soil) =>
  d < soil ? top : d < rock ? ROCK.rock : d < hard ? ROCK.hard : ROCK.mantle;

export const PRESETS: Record<string, Preset> = {
  layers: {
    name: "Layers",
    note: "Sediment on top, then rock, hard rock and the mantle. Waves bend and bounce at every boundary.",
    quake: [18, 12], stations: [30, 42, 54],
    at: (x, d) => d < 0 ? ROCK.air : layered(d, 2 + 0.5 * Math.sin(x / 7), 10 + 1.5 * Math.sin(x / 11 + 1), 24 + Math.sin(x / 9), ROCK.sediment),
  },
  basin: {
    name: "Soft-soil valley",
    note: "Soft soil traps the waves: the ground shakes harder and longer in the valley. Try Shaking, then compare B with A.",
    quake: [14, 11], stations: [22, 40, 54],
    at: (x, d) => {
      if (d < 0) return ROCK.air;
      const basin = 3.4 * Math.sqrt(Math.max(0, 1 - ((x - 40) / 11) ** 2));
      return d < basin ? ROCK.soil : layered(d, 0, 12, 25);
    },
  },
  mountains: {
    name: "Mountains",
    note: "The surface follows the mountains. Surface waves climb over them; some energy bounces back.",
    quake: [12, 9], stations: [24, 36, 46],
    at: (x, d) => d < -(2.6 * Math.exp(-(((x - 24) / 5.5) ** 2)) + 1.8 * Math.exp(-(((x - 46) / 4) ** 2))) ? ROCK.air : layered(d, -9, 12, 25),
  },
  volcano: {
    name: "Volcano",
    note: "Liquid magma has no stiffness to shake sideways, so S waves cannot cross it. Look for the hole in the S wave behind the magma.",
    quake: [10, 12], stations: [24, 38, 52],
    at: (x, d) => {
      const top = -2.8 * Math.max(0, 1 - Math.abs(x - 38) / 11) ** 1.3;
      if (d < top) return ROCK.air;
      if (((x - 38) / 7) ** 2 + ((d - 5) / 2.5) ** 2 < 1 || (Math.abs(x - 38) < 0.35 && d < 5)) return ROCK.magma;
      return layered(d, -9, 13, 25);
    },
  },
  fault: {
    name: "Fault",
    note: "Earthquakes happen when rock slips along a fault. Here the right side has already dropped, so its soft soil is thick: draw a fault along the break in the layers to make it slip again.",
    quake: [36, 10], stations: [18, 42, 54], fault: { x: 30, dip: 60 },
    at: (x, d) => {
      if (d < 0) return ROCK.air;
      const drop = x > 30 + d / Math.tan(Math.PI / 3) ? 2.5 : 0;
      return layered(d, 0.8 + drop, 10 + drop, 24 + drop * 0.5);
    },
  },
  ocean: {
    name: "Ocean and coast",
    note: "Water is a liquid, so S waves cannot travel in the sea. P waves can, which is how whales and ships sometimes feel quakes.",
    quake: [16, 10], stations: [30, 42, 54], noise: { ocean: 27 },
    at: (x, d) => {
      const top = -0.5 * smooth(28, 36, x);
      if (d < top) return ROCK.air;
      if (d < 2.6 * (1 - smooth(14, 27, x))) return ROCK.water;
      return layered(d, -9, 11, 24);
    },
  },
  saltdome: {
    name: "Salt dome",
    note: "Salt is lighter than the rock around it, so it rises in a dome and bends the layers up. It is also fast: waves speed up inside it and bounce off its sides. Oil and gas often gather beside salt domes.",
    quake: [12, 16], stations: [24, 34, 46],
    at: (x, d) => {
      if (d < 0) return ROCK.air;
      const dx = Math.abs(x - 34);
      const cap = d > 1.4 && d < 3.6 ? 5.2 * Math.sqrt(Math.max(0, 1 - ((d - 2.5) / 1.1) ** 2)) : 0;
      const stem = d >= 2.5 && d < 12 ? 2.2 + 0.18 * (d - 2.5) : 0;
      if (dx < Math.max(cap, stem) || (d > 11 && d < 13)) return ROCK.salt;
      if (d < 0.6) return ROCK.sediment;
      if (d < 11) return Math.floor((d + 3 * Math.exp(-((dx / 8) ** 2))) / 1.4) % 2 ? ROCK.shale : ROCK.sandstone;
      return layered(d, 0, 20, 26);
    },
  },
  watertable: {
    name: "Water table",
    note: "Below the water table, water fills the gaps between sand grains. Water resists squeezing, so P waves speed up there; it cannot resist shearing, so S waves hardly change. Watch the P wave bend at the water table while the S wave goes straight through.",
    quake: [16, 7], stations: [30, 42, 54],
    at: (x, d) => {
      if (d < -0.7 * Math.exp(-(((x - 42) / 9) ** 2))) return ROCK.air;
      const table = 1.0 + 0.35 * Math.sin(x / 8) - 0.4 * Math.exp(-(((x - 42) / 9) ** 2));
      if (d < table) return ROCK.sand;
      if (d < 4.5) return ROCK.wetsand;
      return layered(d, 6.5, 14, 26, ROCK.sediment);
    },
  },
  caves: {
    name: "Caves",
    note: "Water dissolves limestone and leaves caves. A cave is empty, so waves bounce off its walls and each cave sends out small new waves of its own.",
    quake: [12, 9], stations: [26, 38, 50],
    at: (x, d) => {
      if (d < 0) return ROCK.air;
      for (const [cx, cd, rx, rz] of [[23, 1.3, 1.5, 0.6], [30, 2.6, 1.0, 0.8], [36, 0.9, 2.2, 0.45], [43, 3.3, 1.7, 0.9], [50, 1.6, 1.2, 0.6]]) {
        if (((x - cx) / rx) ** 2 + ((d - cd) / rz) ** 2 < 1) return ROCK.air;
      }
      return d < 6 ? ROCK.limestone : layered(d, 0, 16, 26);
    },
  },
  plain: {
    name: "Plain rock",
    note: "Nothing in the way: the P and S rings spread out evenly, and the surface waves follow the ground.",
    quake: [20, 10], stations: [30, 42, 54],
    at: (_x, d) => d < 0 ? ROCK.air : ROCK.rock,
  },
};

/** The ground for a preset on the whole grid (the sponge copies the nearest column on screen). */
export function build(preset: Preset) {
  const vp = new Float32Array(NX * NZ), vs = new Float32Array(NX * NZ), rho = new Float32Array(NX * NZ);
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
    const x = Math.min(W - 1, Math.max(0, i - SPONGE)) * H, r = preset.at(x, (j - SKY + 0.5) * H), k = j * NX + i;
    vp[k] = r.vp; vs[k] = r.vs; rho[k] = r.rho;
  }
  return { vp, vs, rho };
}

/** The rock at a cell, by its speeds (for the readout). */
export function rockAt(vp: number, vs: number, rho: number): Rock {
  if (vp <= 0) return ROCK.air;
  return Object.values(ROCK as Record<string, Rock>).find((r) => Math.abs(r.vp - vp) < 0.01 && Math.abs(r.vs - vs) < 0.01 && Math.abs(r.rho - rho) < 0.01) ?? { name: "Custom rock", vp, vs, rho };
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
  else c = mix(earth((vp - 2) / 5.8), PAPER_RGB, 0.58);
  return [c[0], c[1], c[2], 255];
}
export function rockCss(r: Rock) {
  const c = colour(r.vp, r.vs, r.rho);
  return c[3] ? `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})` : "#faf9f6";
}
