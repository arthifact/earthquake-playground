// Model templates: real settings as cross-sections in kilometres, with speeds and densities from published models
// (simplified to a few layers and smooth shapes). x runs from 0 to each template's natural width; d is depth below
// sea level (negative is up). Soft sediments keep S speeds of at least 1.6 km/s, as the grid needs.

import { ROCK, rock, type Preset, type Rock } from "./ground";

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const bump = (x: number, c: number, w: number) => Math.exp(-(((x - c) / w) ** 2));
const AIR = ROCK.air, WATER = ROCK.water;

// layers used by several templates (speeds km/s, density g/cm³)
const UPPER = rock("Upper crust", 6.1, 3.55, 2.75);
const MIDDLE = rock("Middle crust", 6.4, 3.7, 2.85);
const LOWER = rock("Lower crust", 6.9, 3.9, 2.95);
const MANTLE = rock("Mantle (lithosphere)", 8.05, 4.5, 3.35);
const ASTHENO = rock("Mantle (asthenosphere, hot)", 7.6, 4.2, 3.3);
const BASALT = rock("Oceanic crust, basalt (layer 2)", 5.0, 2.75, 2.65);
const GABBRO = rock("Oceanic crust, gabbro (layer 3)", 6.8, 3.8, 2.95);
const WEDGE = rock("Mantle wedge (hydrated)", 7.7, 4.3, 3.3);
const PRISM = rock("Accretionary prism (sediments)", 3.6, 2.0, 2.3);
const MELT = rock("Partly molten crust", 5.8, 2.9, 2.8);

/** Sediments that stiffen with depth (km below their top): speeds and density in bands of 0.5 km. */
function sediment(name: string, z: number, vp0: number, grad: number, vpMax: number): Rock {
  const zb = Math.floor(Math.max(0, z) / 0.5) * 0.5 + 0.25;
  const vp = Math.min(vpMax, vp0 + grad * zb), vs = Math.max(1.6, vp / 1.85), rho = Math.min(2.6, 1.95 + 0.25 * (vp - 2.5));
  return rock(name, Math.round(vp * 100) / 100, Math.round(vs * 100) / 100, Math.round(rho * 100) / 100);
}

/** Continental crust under land, with a Moho at moho km. */
const continent = (d: number, moho: number) => d < 0.4 * moho ? UPPER : d < 0.65 * moho ? MIDDLE : d < moho ? LOWER : MANTLE;

export const PRESETS: Record<string, Preset> = {
  crust: {
    name: "Continental crust",
    note: "The average continent: sediments, upper, middle and lower crust, and the mantle below a Moho near 38 km.",
    about: "Layer thicknesses and speeds of the global average continental crust in CRUST1.0 (Laske et al., 2013), with the AK135 mantle (Kennett et al., 1995). The Moho undulates gently.",
    width: 200,
    fault: { x: 80, top: 2, dip: 60, toward: 1, length: 30, magnitude: 6.8, slip: "normal" },
    at: (x, d) => {
      if (d < 0) return AIR;
      const moho = 38 + 2 * Math.sin(x / 31);
      return d < 1.5 + 0.5 * Math.sin(x / 17) ? sediment("Sediments", d, 3.4, 0.6, 4.4) : continent(d, moho);
    },
  },

  subduction: {
    name: "Subduction zone · Chile",
    note: "The Nazca plate dives under South America: ocean, trench, slab, Andes. The megathrust is ready to slip.",
    about: "Central Chile near the 2010 Maule earthquake (Mw 8.8). Slab shape after Slab2 (Hayes et al., 2018): about 10° at the trench, steepening to 30° and more at depth. Trench 6.5 km deep, coast 120 km east of it, Andes about 4.5 km high, crust up to 65 km thick beneath them. Oceanic crust 7 km thick (basalt over gabbro).",
    width: 600,
    fault: { x: 150, top: 6.5, dip: 17, toward: 1, length: 148, magnitude: 8.8, slip: "reverse" },
    noise: { ocean: 230 },
    at: (x, d) => {
      const trench = 150, coast = 270;
      // sea floor (west of the coast) and land (east of it)
      const floor = x < trench ? 4.2 + 2.3 * smooth(110, trench, x) - 0.3 * bump(x, 110, 15) : 6.5 * (1 - smooth(trench, coast, x));
      const land = x > coast ? 0.4 * smooth(coast, 300, x) + 0.5 * bump(x, 305, 12) + 4.1 * smooth(380, 470, x) : 0;
      if (d < -land) return AIR;
      if (x < coast && d < 0) return AIR;
      if (x < coast && d < floor) return WATER;
      // top of the down-going plate
      const u = Math.max(0, x - trench), slab = x < trench ? floor : 6.5 + 0.18 * u + 0.0009 * u * u;
      if (d >= slab) {
        const z = d - slab;
        return z < 2 ? BASALT : z < 7 ? GABBRO : z < 75 ? MANTLE : ASTHENO;
      }
      // the over-riding plate: prism at the toe, then continental crust over the mantle wedge
      if (x < 215 && d < floor + 9 * smooth(trench, 215, x)) return PRISM;
      const moho = 32 + 33 * smooth(330, 470, x);
      return d < moho ? continent(d, moho) : WEDGE;
    },
  },

  himalaya: {
    name: "Himalayan front · Nepal",
    note: "India pushes under the Himalaya along the Main Himalayan Thrust, beneath the Ganges plain and Kathmandu.",
    about: "A section through central Nepal near the 2015 Gorkha earthquake (Mw 7.8): the Main Himalayan Thrust rises gently (about 7°) to the Main Frontal Thrust, with a steeper ramp under the high range (Elliott et al., 2016). Foreland sediments up to 5 km, Siwalik hills, Lesser and Greater Himalaya, Tibet at about 5 km; the Moho deepens from 38 km under India to 75 km under Tibet. Kathmandu sits on a soft lake-bed basin.",
    width: 300,
    fault: { x: 110, top: 3.8, dip: 10, toward: 1, length: 76, magnitude: 7.8, slip: "reverse" },
    at: (x, d) => {
      const front = 78;
      const elev = 0.1 + 0.7 * bump(x, 70, 6) + 1.5 * smooth(78, 95, x) - 0.3 * bump(x, 150, 8) + 3.5 * smooth(170, 205, x) + 0.6 * bump(x, 205, 10);
      if (d < -elev) return AIR;
      // Kathmandu's lake-bed basin
      if (Math.abs(x - 150) < 7 && d < -elev + 0.6 * Math.sqrt(1 - ((x - 150) / 7) ** 2)) return sediment("Kathmandu basin (lake beds)", d + elev, 2.6, 0.5, 3.0);
      const mht = x < front ? -Infinity : x < 170 ? 0.12 * (x - front) : x < 200 ? 11 + 0.36 * (x - 170) : 21.8 + 0.18 * (x - 200);
      const moho = 38 + 37 * smooth(60, 300, x);
      if (x >= front && d < mht) {
        // the Himalaya above the thrust
        if (x < 95) return sediment("Siwalik sediments", d + elev, 3.6, 0.25, 4.6);
        if (x < 180) return rock("Lesser Himalaya (metasediments)", 5.6, 3.25, 2.7);
        if (x > 230 && d < 2) return rock("Tethyan sediments", 5.0, 2.9, 2.6);
        return rock("Greater Himalaya (crystalline)", 6.1, 3.55, 2.75);
      }
      // the Indian plate: foreland sediments, then its crust and mantle
      // foreland sediments thicken toward the front, then thin out where they are carried under the range
      const top = x < front ? -elev : mht, sed = x < front ? 0.5 + 4.5 * smooth(0, front, x) : 5 * (1 - smooth(front, 170, x));
      if (d < top + sed) return sediment("Foreland basin (Ganges)", d - top, 2.9, 0.35, 4.6);
      return continent(d, moho);
    },
  },

  rift: {
    name: "East African Rift · Kenya",
    note: "The continent pulls apart: a graben between normal faults, filled with lava and sediments, over thinned crust.",
    about: "The central Kenya Rift: a graben about 60 km wide whose floor lies about 1 km below its shoulders, filled with 3 to 4 km of volcanic and sedimentary rock, between border normal faults dipping about 60°. The crust thins from 38 km to about 28 km beneath the rift, over hot, slow mantle (KRISP; Mechie et al., 1997).",
    width: 200,
    fault: { x: 72, top: 0, dip: 60, toward: 1, length: 16, magnitude: 7.0, slip: "normal" },
    at: (x, d) => {
      const inside = smooth(66, 74, x) * (1 - smooth(126, 134, x));
      const elev = 1.6 + 0.6 * bump(x, 60, 12) + 0.6 * bump(x, 140, 12) - 0.6 * inside;
      if (d < -elev) return AIR;
      // the graben fill, between the border faults (60°, from x = 72 and x = 128 at the surface)
      const w = 72 + (d + 1) / Math.tan(Math.PI / 3), e = 128 - (d + 1) / Math.tan(Math.PI / 3);
      if (x > w && x < e && d < 3) return sediment("Rift fill (lavas and sediments)", d + elev, 3.4, 0.3, 4.6);
      const moho = 38 - 10 * bump(x, 100, 45);
      // hot, slow mantle rising beneath the rift in a dome
      if (d >= moho) return d < moho + 45 * bump(x, 100, 50) ? ASTHENO : MANTLE;
      return continent(d, moho);
    },
  },

  la: {
    name: "Los Angeles basin",
    note: "A deep sedimentary basin under a city, with a blind thrust like the one of the 1994 Northridge earthquake.",
    about: "A south–north section after the SCEC Community Velocity Model (Shaw et al., 2015): the basin is up to about 8.5 km deep and deepest to the north, its sediments stiffening with depth; the Palos Verdes hills to the south, the Santa Monica Mountains to the north. Its slowest sediments are slower than the grid can carry (stiffened to 1.6 km/s). The fault is a Northridge-like blind thrust dipping about 35°.",
    width: 80,
    fault: { x: 62, top: 5, dip: 35, toward: -1, length: 26, magnitude: 6.7, slip: "reverse" },
    at: (x, d) => {
      const elev = 0.05 + 0.4 * bump(x, 8, 4) + 0.85 * bump(x, 64, 6) + 0.25 * smooth(70, 80, x);
      if (d < -elev) return AIR;
      const t = (x - 12) / 46, deep = t > 0 && t < 1 ? 8.5 * Math.sin(Math.PI * t ** 1.6) : 0;
      if (d < deep) return sediment("Basin sediments", d + elev, 2.8, 0.33, 5.2);
      return continent(d, 31);
    },
  },

  salt: {
    name: "Gulf Coast salt basin",
    note: "Thick sediments with salt rising in diapirs from a buried salt layer: waves speed up in the salt and bend round it.",
    about: "After sections of the northern Gulf of Mexico (Hudec and Jackson, 2007): sediments stiffening with depth to about 12 km, the Jurassic (Louann) salt layer near 11 km, two diapirs rising to 2 to 3 km with overhanging caps, and a detached salt sheet. Salt carries P waves at about 4.5 km/s; the sediments around it are slower.",
    width: 100,
    fault: { x: 48, top: 0.5, dip: 50, toward: 1, length: 9, magnitude: 5.5, slip: "normal" },
    at: (x, d) => {
      if (d < 0) return AIR;
      const SALT = ROCK.salt;
      if (d > 11 && d < 12.5) return SALT;
      for (const c of [30, 68]) {
        const stem = d > 3 && d < 11 && Math.abs(x - c) < 2 + 0.12 * (d - 3);
        const cap = d > 1.8 && d < 3.8 && ((x - c) / 5) ** 2 + ((d - 2.8) / 1) ** 2 < 1;
        if (stem || cap) return SALT;
      }
      if (x > 82 && d > 3.2 && d < 4.4) return SALT;
      if (d < 12.5) return sediment("Basin sediments", d, 2.4, 0.26, 5.0);
      return d < 24 ? LOWER : MANTLE;
    },
  },

  ridge: {
    name: "Mid-ocean ridge · Atlantic",
    note: "New ocean floor forms at the ridge and sinks as it cools and moves away; the rift valley has its own faults.",
    about: "The slow-spreading Mid-Atlantic Ridge: sea floor 2.6 km deep at the ridge, deepening as the square root of its age (about 1.2 cm/yr each way), with a rift valley about 1.2 km deep. Oceanic crust 6.5 km thick (basalt over gabbro), partly molten beneath the axis, over a lithosphere that thickens with age above hot mantle (Parsons and Sclater, 1977; White et al., 1992).",
    width: 200,
    fault: { x: 94, top: 3.8, dip: 55, toward: 1, length: 8, magnitude: 5.8, slip: "normal" },
    noise: { ocean: 40 },
    at: (x, d) => {
      const age = Math.abs(x - 100) / 12, floor = 2.6 + 0.35 * Math.sqrt(age) + 1.2 * bump(x, 100, 5);
      if (d < 0) return AIR;
      if (d < floor) return WATER;
      const z = d - floor;
      if (Math.abs(x - 100) < 6 && z > 1.5 && z < 7) return MELT;
      if (z < 2) return BASALT;
      if (z < 6.5) return GABBRO;
      return z < 6.5 + 2 + 9 * Math.sqrt(age) ? MANTLE : ASTHENO;
    },
  },

  volcano: {
    name: "Stratovolcano · Etna-type",
    note: "A cone of lavas over a magma reservoir: liquid magma stops S waves and leaves a shadow behind it.",
    about: "After Mount Etna: a cone of lavas about 40 km wide (here 2.9 km high, a little lower than Etna's 3.3, to fit the sky), over sedimentary basement; a magma reservoir at about 6 to 10 km depth and a smaller one near 3 km, joined by a conduit (Patanè et al., 2006).",
    width: 60,
    fault: { x: 18, top: 0.5, dip: 70, toward: -1, length: 6, magnitude: 5.3, slip: "normal" },
    at: (x, d) => {
      const elev = 2.9 * Math.max(0, 1 - Math.abs(x - 30) / 20) ** 1.4;
      if (d < -elev) return AIR;
      if ((((x - 30) / 4) ** 2 + ((d - 8) / 1.6) ** 2 < 1) || (((x - 30) / 1.5) ** 2 + ((d - 3) / 0.6) ** 2 < 1) || (Math.abs(x - 30) < 0.2 && d < 8)) return ROCK.magma;
      if (d < 1.5 && elev > 0.05) return rock("Volcanic pile (lavas)", 4.6, 2.6, 2.5);
      if (d < 6) return sediment("Sedimentary basement", d, 3.9, 0.12, 4.6);
      return continent(d, 27);
    },
  },

  alpine: {
    name: "Alpine valley · Grenoble",
    note: "A glacial valley filled with soft lake sediments between limestone and crystalline massifs: the valley rings.",
    about: "After the Grenoble basin in the French Alps (Chaljub et al., 2010): a U-shaped glacial valley filled with up to about 900 m of soft lacustrine sediments, between the Vercors limestone to the west and the Belledonne crystalline massif to the east. The real fill is far slower (S at 0.3 to 0.8 km/s) than the grid can carry, so it is stiffened to 1.6 km/s.",
    width: 40,
    fault: { x: 25, top: 1, dip: 70, toward: 1, length: 8, magnitude: 5.0, slip: "normal" },
    at: (x, d) => {
      const elev = 0.21 + 1.4 * (1 - smooth(10, 16.5, x)) + 1.7 * smooth(23.5, 30, x);
      if (d < -elev) return AIR;
      const fill = 0.9 * Math.sqrt(Math.max(0, 1 - ((x - 20) / 3.6) ** 2));
      if (d < -elev + fill) return ROCK.soil;
      if (x < 22 && d < 3) return ROCK.limestone;
      return continent(d, 30);
    },
  },

  plain: {
    name: "Half-space (uniform rock)",
    note: "Uniform rock under a flat surface: the textbook case, and the one to check numbers against.",
    about: "Uniform rock with P at 5.6 km/s, S at 3.2 km/s and density 2.6 g/cm³ under a flat free surface: Lamb's problem. Validated against an exact solution and SPECFEM2D (validation/README.md).",
    width: 61.44,
    fault: { x: 20, top: 6, dip: 60, toward: 1, length: 10, magnitude: 6.0, slip: "normal" },
    at: (_x, d) => d < 0 ? AIR : ROCK.rock,
  },
};
