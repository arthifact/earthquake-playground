// Model templates: real settings as cross-sections in kilometres, built from published structure (references in
// each one's `about`). x runs from 0 to the template's natural width; d is depth below sea level (negative is up).
// P speeds come from the studies cited; S speed and density follow from P speed by Brocher (2005) for crustal rock
// and from AK135 for the mantle, so the layers agree with each other. The grid carries S waves down to 1.6 km/s,
// so slower sediments are stiffened to that (each template says where).

import { ROCK, crustal, rock, type Preset } from "./ground";

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const bump = (x: number, c: number, w: number) => Math.exp(-(((x - c) / w) ** 2));
const AIR = ROCK.air, WATER = ROCK.water;

// continental crust: CRUST1.0 / Christensen and Mooney (1995) average layers; S and density by Brocher (2005)
const UPPER = crustal("Upper crust", 6.1), MIDDLE = crustal("Middle crust", 6.5), LOWER = crustal("Lower crust", 6.9);
// mantle: AK135 just below the Moho (Kennett et al., 1995); hot mantle under rifts and ridges from their Pn
const MANTLE = rock("Mantle (AK135)", 8.04, 4.48, 3.32);
const HOT = rock("Hot mantle (low Pn)", 7.6, 4.25, 3.28);
const WEDGE = rock("Mantle wedge (hydrated)", 7.7, 4.3, 3.3);
// oceanic crust: layer 2 (basalt) over layer 3 (gabbro), White et al. (1992)
const BASALT = crustal("Oceanic crust, basalt (layer 2)", 5.2), GABBRO = crustal("Oceanic crust, gabbro (layer 3)", 6.8);

/** Sediments that stiffen with depth z (km below their top): P speed by compaction, in bands of 0.5 km. */
function sediment(name: string, z: number, vp0: number, grad: number, vpMax: number) {
  const zb = Math.floor(Math.max(0, z) / 0.5) * 0.5 + 0.25;
  return crustal(name, Math.min(vpMax, vp0 + grad * zb));
}
/** Continental crust with its Moho at moho km: upper, middle and lower crust in the CRUST1.0 proportions. */
const continent = (d: number, moho: number) => d < 0.42 * moho ? UPPER : d < 0.66 * moho ? MIDDLE : d < moho ? LOWER : MANTLE;

export const PRESETS: Record<string, Preset> = {
  crust: {
    name: "Continental crust",
    cite: "CRUST1.0 · Christensen and Mooney 1995",
    note: "The average continent: sediments, upper, middle and lower crust over the mantle, with the Moho near 39 km.",
    about: "Layers after the global continental average of Christensen and Mooney (1995, JGR 100, 9761; crust 39 km thick, mean P speed 6.45 km/s) and CRUST1.0 (Laske et al., 2013): about 1.5 km of sediments; upper, middle and lower crust at 6.1, 6.5 and 6.9 km/s; AK135 mantle below (Kennett et al., 1995, GJI 122, 108). S speed and density from P speed by Brocher (2005, BSSA 95, 2081). The fault is illustrative.",
    width: 200, depth: 60, sky: 1.5,
    fault: { x: 100, d: 10, dip: 60, toward: 1, magnitude: 6.8, slip: "normal", dir: "both" },
    at: (x, d) => {
      if (d < 0) return AIR;
      const moho = 39 + 1.5 * Math.sin(x / 31);
      return d < 1.5 + 0.5 * Math.sin(x / 17) ? sediment("Sediments", d, 3.2, 0.7, 4.6) : continent(d, moho);
    },
  },

  subduction: {
    name: "Subduction zone · Chile",
    cite: "Maule 2010 (Mw 8.8) · Slab2",
    note: "The Nazca plate dives under South America near 36°S: trench, slab, coast, Central Valley and Andes.",
    about: "A trench-normal section near the 2010 Maule earthquake (Mw 8.8). Trench about 5.5 km deep (sediment-filled), coast about 125 km east of it; the slab dips about 10° at the trench and steepens with depth, as in Slab2 (Hayes et al., 2018, Science 362, 58), reaching about 47 km below the coast and 110 km under the volcanic arc. Coseismic slip faded out at 43 to 48 km depth about 150 km from the trench, where the slab meets the continental Moho (Tong et al., 2010, GRL 37, L24311); aftershocks cluster at 20 to 35 km on the interface. Nazca crust 7 km thick over its lithosphere; continental crust 38 km thick under the coast, about 45 km under the Andes (here about 3.5 km high). Hypocentre about 30 km deep. S speed and density by Brocher (2005).",
    width: 600, depth: 250, sky: 5,
    fault: { x: 252, d: 30, dip: 18, toward: 1, magnitude: 8.8, slip: "reverse", dir: "both" },
    noise: { ocean: 230 },
    at: (x, d) => {
      const trench = 150, coast = 275;
      // sea floor west of the coast: abyssal plain at 4 km, outer rise, trench at 5.5 km, continental slope
      const floor = x < trench ? 4.0 + 1.5 * smooth(110, trench, x) - 0.25 * bump(x, 105, 15) : 5.5 * (1 - smooth(trench, coast, x));
      // land: Coastal Cordillera, Central Valley, Andes (main cordillera near 3.5 km)
      const land = x > coast ? 0.6 * bump(x, 300, 14) + 0.2 * smooth(coast, 330, x) + 3.3 * smooth(400, 470, x) * (1 - 0.25 * smooth(520, 600, x)) : 0;
      if (d < -land) return AIR;
      if (x < coast && d < 0) return AIR;
      if (x < coast && d < floor) return WATER;
      // top of the Nazca plate: the sea floor west of the trench, the slab east of it
      const u = Math.max(0, x - trench), slab = x < trench ? floor : 5.5 + 0.17 * u + 0.0006 * u * u;
      if (d >= slab) {
        const z = d - slab;
        return z < 2 ? BASALT : z < 7 ? GABBRO : z < 65 ? MANTLE : HOT;
      }
      // over-riding plate: accretionary prism at the toe, then continental crust over the mantle wedge
      if (x < 205 && d < floor + 10 * smooth(trench, 205, x)) return sediment("Accretionary prism", d - floor, 2.4, 0.45, 4.4);
      const moho = 38 + 7 * smooth(330, 450, x);
      return d < moho ? continent(d, moho) : WEDGE;
    },
  },

  himalaya: {
    name: "Himalayan front · Nepal",
    cite: "Gorkha 2015 (Mw 7.8) · Elliott et al. 2016",
    note: "India underthrusts the Himalaya along the Main Himalayan Thrust, beneath the Ganges plain and Kathmandu.",
    about: "A south–north section through central Nepal. The Main Himalayan Thrust (MHT) comes to the surface at the Main Frontal Thrust, runs north as a flat dipping about 7° (the part the 2015 Gorkha earthquake ruptured, about 11 km beneath Kathmandu), then steepens on a ramp beneath the High Himalaya (Elliott et al., 2016, Nature Geosci. 9, 174; Wang et al., 2017, double ramp from aftershock waveforms). Gorkha's hypocentre was about 15 km deep and its rupture ran up the dip toward Kathmandu, stopping short of the surface. Ganges foreland sediments up to about 5 km; Siwaliks, Lesser Himalaya (about 2 km high), High Himalaya (peaks of 6 to 8 km, here a mean near 5.5 km) and Tibet at about 5 km. The Indian Moho deepens from about 40 km to 70 km beneath Tibet (Nábělek et al., 2009, Science 325, 1371, Hi-CLIMB). Kathmandu sits on about 600 m of lake beds (stiffened). S speed and density by Brocher (2005).",
    width: 300, depth: 110, sky: 7.5,
    fault: { x: 197, d: 14.4, dip: 7, toward: 1, magnitude: 7.8, slip: "reverse", dir: "up" },
    at: (x, d) => {
      const front = 80;
      const elev = 0.1 + 0.6 * bump(x, 72, 6) + 1.7 * smooth(84, 100, x) - 0.35 * bump(x, 165, 8) + 3.4 * smooth(190, 215, x) + 1.2 * bump(x, 218, 9);
      if (d < -elev) return AIR;
      // Kathmandu's lake beds
      if (Math.abs(x - 165) < 8 && d < -elev + 0.6 * Math.sqrt(1 - ((x - 165) / 8) ** 2)) return sediment("Kathmandu basin (lake beds, stiffened)", d + elev, 2.4, 0.6, 3.0);
      // the MHT: flat at 7° from the front, ramp at about 20° beneath the High Himalaya, then flatter beneath Tibet
      const mht = x < front ? -Infinity : x < 195 ? 0.123 * (x - front) : x < 222 ? 14.1 + 0.364 * (x - 195) : 23.9 + 0.14 * (x - 222);
      if (x >= front && d < mht) {
        if (x < 100) return sediment("Siwalik sediments", d + elev, 3.4, 0.3, 4.8);
        if (x < 192) return crustal("Lesser Himalaya (metasediments)", 5.7);
        if (x > 235 && d < 3) return crustal("Tethyan sediments", 5.1);
        return crustal("High Himalaya (crystalline)", 6.1);
      }
      // the Indian plate: foreland sediments (thinning under the range), then its crust and mantle
      const top = x < front ? -elev : mht, sed = x < front ? 0.5 + 4.5 * smooth(0, front, x) : 5 * (1 - smooth(front, 170, x));
      if (d < top + sed) return sediment("Foreland basin (Ganges)", d - top, 2.6, 0.45, 4.8);
      return continent(d, 40 + 30 * smooth(60, 300, x));
    },
  },

  rift: {
    name: "East African Rift · Kenya",
    cite: "KRISP · Mechie et al. 1994",
    note: "The continent pulls apart: a graben between border faults, filled with lavas and sediments, over thinned crust.",
    about: "The central Kenya Rift near Lake Naivasha, after the KRISP wide-angle profiles (Mechie et al., 1994, Tectonophysics 236, 179; Khan et al., 2000): a graben about 60 km wide between border normal faults dipping about 60°, its floor about 1 km below the shoulders, filled with up to 5 km of lavas and sediments. The Moho is about 35 km deep beneath the central rift and 38 to 44 km beneath the flanks; Pn is slow along the axis (7.5 to 7.7 km/s) and normal beneath the flanks (8.0 to 8.3). S speed and density by Brocher (2005).",
    width: 200, depth: 100, sky: 3,
    fault: { x: 79, d: 10, dip: 60, toward: 1, magnitude: 6.5, slip: "normal", dir: "both" },
    at: (x, d) => {
      const inside = smooth(66, 74, x) * (1 - smooth(126, 134, x));
      const elev = 1.9 + 0.6 * bump(x, 60, 12) + 0.6 * bump(x, 140, 12) - 0.9 * inside;
      if (d < -elev) return AIR;
      // the graben fill between the border faults (60°, from x = 72 and x = 128 at the surface), deepest mid-rift
      const w = 72 + (d + 1) / Math.tan(Math.PI / 3), e = 128 - (d + 1) / Math.tan(Math.PI / 3), floor = -1 + 5 * bump(x, 100, 18);
      if (x > w && x < e && d < Math.max(1, floor)) return sediment("Rift fill (lavas and sediments)", d + elev, 3.3, 0.35, 5.0);
      const moho = 41 - 6 * bump(x, 100, 40);
      if (d >= moho) return d < moho + 40 * bump(x, 100, 45) ? HOT : MANTLE;
      return continent(d, moho);
    },
  },

  la: {
    name: "Los Angeles basin · Northridge",
    cite: "SCEC CVM · Northridge 1994 (Mw 6.7)",
    note: "A south–north section from the Palos Verdes hills across the Los Angeles basin and the Santa Monica Mountains to the San Fernando Valley.",
    about: "After the SCEC Community Velocity Model (Shaw et al., 2015, EPSL 415, 1) and Wright (1991, AAPG Memoir 52): the Los Angeles basin holds up to about 9 km of sediments in its central trough, stiffening with depth; the Santa Monica Mountains separate it from the San Fernando Valley basin (here about 5 km deep). The 1994 Northridge earthquake (Mw 6.7) broke a blind thrust dipping about 35 to 40° to the south beneath the San Fernando Valley; its hypocentre was about 18 km deep and the rupture ran up the dip to about 6 km (Wald et al., 1996, BSSA 86, S49). The slowest near-surface sediments (S at 0.3 to 0.8 km/s) are stiffened to 1.6 km/s. S speed and density by Brocher (2005).",
    width: 90, depth: 40, sky: 2,
    fault: { x: 75, d: 18, dip: 38, toward: -1, magnitude: 6.7, slip: "reverse", dir: "up" },
    at: (x, d) => {
      const elev = 0.03 + 0.4 * bump(x, 6, 4) + 0.75 * bump(x, 64, 5) + 0.25 * smooth(70, 90, x);
      if (d < -elev) return AIR;
      // Los Angeles basin (central trough) and San Fernando Valley basin
      const t = (x - 10) / 50, la = t > 0 && t < 1 ? 9 * Math.sin(Math.PI * t) ** 1.3 : 0;
      const v = (x - 68) / 24, sfv = v > 0 && v < 1 ? 5 * Math.sin(Math.PI * v) ** 1.2 : 0;
      if (d < la) return sediment("Los Angeles basin sediments", d + elev, 2.6, 0.38, 5.4);
      if (d < sfv) return sediment("San Fernando Valley sediments", d + elev, 2.6, 0.42, 5.4);
      return continent(d, 31);
    },
  },

  salt: {
    name: "Gulf Coast salt basin",
    cite: "Northern Gulf of Mexico · Hudec and Jackson 2007",
    note: "Kilometres of sediments over a buried salt layer whose salt rises in diapirs: waves speed up in the salt and bend round it.",
    about: "After sections of the northern Gulf of Mexico (Hudec and Jackson, 2007, Earth-Sci. Rev. 82, 1): sediments compacting with depth over the Jurassic Louann salt near 11 km, two diapirs rising to 2 to 3 km with overhanging caps, and a detached salt sheet. Salt carries P waves at about 4.5 km/s whatever its depth, so it is fast near the top and slow near the bottom of the section. Thinned transitional crust and mantle below. S speed and density by Brocher (2005); salt S speed and density measured (2.6 km/s, 2.16 g/cm³).",
    width: 100, depth: 30, sky: 1.5,
    fault: { x: 50, d: 6, dip: 50, toward: 1, magnitude: 5.0, slip: "normal", dir: "both" },
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
      if (d < 12.5) return sediment("Basin sediments", d, 2.0, 0.33, 5.2);
      return d < 26 ? crustal("Transitional crust", 6.6) : MANTLE;
    },
  },

  ridge: {
    name: "Mid-ocean ridge · Atlantic",
    cite: "Mid-Atlantic Ridge · White et al. 1992",
    note: "New ocean floor forms at the ridge and sinks as it cools and moves away; the rift valley has its own faults.",
    about: "The slow-spreading Mid-Atlantic Ridge: sea floor about 2.6 km deep at the ridge, deepening as the square root of its age (Parsons and Sclater, 1977, JGR 82, 803; half rate about 1.2 cm/yr), with a rift valley about 1.2 km deep. Oceanic crust about 6 km thick (layer 2 basalt over layer 3 gabbro; White et al., 1992, JGR 97, 19683; 5.5 km in recent equatorial surveys), partly molten beneath the axis, over a lithosphere that thickens with age above hot mantle. S speed and density by Brocher (2005).",
    width: 200, depth: 60, sky: 1,
    fault: { x: 93, d: 5.5, dip: 55, toward: 1, magnitude: 5.8, slip: "normal", dir: "both" },
    noise: { ocean: 40 },
    at: (x, d) => {
      const age = Math.abs(x - 100) / 12, floor = 2.6 + 0.35 * Math.sqrt(age) + 1.2 * bump(x, 100, 5);
      if (d < 0) return AIR;
      if (d < floor) return WATER;
      const z = d - floor;
      if (Math.abs(x - 100) < 6 && z > 1.5 && z < 6) return crustal("Partly molten crust", 5.8);
      if (z < 0.6) return crustal("Pillow lavas (layer 2A)", 4.2);
      if (z < 2) return BASALT;
      if (z < 6) return GABBRO;
      return z < 6 + 2 + 9 * Math.sqrt(age) ? MANTLE : HOT;
    },
  },

  volcano: {
    name: "Stratovolcano · Etna",
    cite: "Etna · INGV tomography 2021 · Castro-Melgar et al. 2021",
    note: "A cone of lavas over sedimentary basement, a dense intrusive core, and magma-bearing rock at 4 to 9 km.",
    about: "After seismic tomography of Mount Etna: a cone of lavas about 40 km wide and 3.3 km high over the Apennine–Maghrebian sedimentary basement; a large high-velocity body of solidified intrusions beneath the summit and southern flank (Laigle and Hirn, 1999; Castro-Melgar et al., 2021, JGR); and magma-bearing fractured rock between about 4 and 9 km depth, with only a few per cent of melt (INGV 4D tomography, 2021), not a liquid chamber: it slows the waves but S waves still cross it. Moho about 30 km. S speed and density by Brocher (2005).",
    width: 60, depth: 30, sky: 3.8,
    fault: { x: 17, d: 2, dip: 70, toward: -1, magnitude: 5.0, slip: "normal", dir: "both" },
    at: (x, d) => {
      const elev = 3.3 * Math.max(0, 1 - Math.abs(x - 30) / 20) ** 1.35;
      if (d < -elev) return AIR;
      // magma-bearing rock (a few per cent melt), the conduit, and the solid intrusive core
      // magma-bearing rock beneath the summit (4 to 9 km), its conduit, and the solid intrusive body beneath the
      // south-eastern flank
      if (((x - 28.5) / 3.5) ** 2 + ((d - 6.5) / 2.3) ** 2 < 1) return rock("Magma-bearing rock (~4 % melt)", 5.1, 2.6, 2.6);
      if (Math.abs(x - 30) < 0.4 && d < 4.5) return rock("Conduit (magma-bearing)", 4.6, 2.3, 2.55);
      if (((x - 37.5) / 4.5) ** 2 + ((d - 5.5) / 3.5) ** 2 < 1) return crustal("Intrusive body (solidified)", 6.6);
      if (d < 0.5 && elev > 0.05) return sediment("Lavas and scoria (volcanic pile)", d + elev, 3.4, 0.45, 5.0);
      if (d < 8) return sediment("Sedimentary basement (flysch, carbonates)", d, 4.4, 0.18, 5.8);
      return continent(d, 30);
    },
  },

  alpine: {
    name: "Alpine valley · Grenoble",
    cite: "Grenoble basin · Chaljub et al. 2010 (ESG 2006)",
    note: "A glacial valley filled with soft lake sediments between limestone and crystalline massifs: the valley rings.",
    about: "After the Grenoble basin of the ESG 2006 benchmark (Chaljub et al., 2010, BSSA 100, 1427): a U-shaped glacial valley filled with up to about 800 m of lacustrine sediments under the city (about 500 m up the Grésivaudan), between the Vercors limestone to the west and the Belledonne crystalline massif to the east. The fill's real S speed is about 0.3 km/s near the surface, ten times slower than the bedrock; the grid carries 1.6 km/s, so the fill is stiffened and rings at higher frequency than the real valley. The fault is illustrative (the Belledonne border fault is mostly strike-slip). S speed and density by Brocher (2005).",
    width: 40, depth: 20, sky: 3,
    fault: { x: 26, d: 5, dip: 70, toward: 1, magnitude: 5.0, slip: "normal", dir: "both" },
    at: (x, d) => {
      const elev = 0.21 + 1.6 * (1 - smooth(9, 16.5, x)) + 2.3 * smooth(23.5, 31, x);
      if (d < -elev) return AIR;
      const fill = 0.8 * Math.sqrt(Math.max(0, 1 - ((x - 20) / 3.6) ** 2));
      if (d < -elev + fill) return crustal("Lake sediments (stiffened)", 2.8);
      if (x < 22 && d < 3) return crustal("Limestone (Vercors)", 5.4);
      return continent(d, 30);
    },
  },

  plain: {
    name: "Half-space (uniform rock)",
    cite: "Lamb's problem · validated against SPECFEM2D",
    note: "Uniform rock under a flat surface: the textbook case, and the one to check numbers against.",
    about: "Uniform rock with P at 5.6 km/s, S at 3.2 km/s and density 2.6 g/cm³ under a flat free surface: Lamb's problem (Lamb, 1904). Validated against an exact solution and SPECFEM2D (validation/README.md).",
    width: 61.44, depth: 29, sky: 1,
    fault: { x: 20, d: 10, dip: 60, toward: 1, magnitude: 6.0, slip: "normal", dir: "both" },
    at: (_x, d) => d < 0 ? AIR : ROCK.rock,
  },
};
