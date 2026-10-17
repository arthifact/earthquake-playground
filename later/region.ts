// Cross sections: an imaginary region, Harrow Bay, 120 km by 90 km, with its geology in three dimensions. A
// straight line on its map gives a slice for the Quake view (always the view's 61 km), so the same ground can be
// cut several ways: four named sections, or any line drawn on the map.

import { ROCK, WIDTH_KM, colour, type Preset, type Rock } from "./ground";
import type { KindId } from "./noise";
import { INK, MONO, MUTED, RUST, label } from "./plot";

export const MAP_W = 120, MAP_H = 90;        // km, east and north
export const REGION = "Harrow Bay";

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const layered = (d: number, soil: number, rock: number, hard: number, top: Rock = ROCK.sediment) =>
  d < soil ? top : d < rock ? ROCK.rock : d < hard ? ROCK.hard : ROCK.mantle;

// The features, in km (x east, y north).
const coast = (y: number) => 24 + 5 * Math.sin(y / 13);
const FAULT = { x0: 44, y0: 0, x1: 70, y1: 90, dip: 60 };   // the trace on the surface; dips to the east
const fl = Math.hypot(FAULT.x1 - FAULT.x0, FAULT.y1 - FAULT.y0);
const fs = [(FAULT.x1 - FAULT.x0) / fl, (FAULT.y1 - FAULT.y0) / fl];   // along the fault
const fn = [fs[1], -fs[0]];                                            // across it, toward the east (down-dip)
const BASIN = { x: 66, y: 34, rx: 12, ry: 9, depth: 3.2 };
const VOLCANO = { x: 80, y: 70, r: 11, h: 2.6 };
const TOWN = { x: 64, y: 37 };
const FACTORY = { x: 66.5, y: 22 };
const ROAD: [number, number][] = [[18, 66], [36, 54], [50, 44], [64, 37], [86, 31], [120, 27]];

/** Height of the ground above sea level (km); negative is the sea floor. */
export function elevation(x: number, y: number) {
  const land = x - coast(y);
  if (land < 0) return -2.6 * smooth(0, 14, -land);
  const ridge = 2.4 * Math.exp(-(((x - 104) / 7) ** 2)) * (0.75 + 0.25 * Math.sin(y / 6)) * smooth(-10, 10, y);
  const r = Math.hypot(x - VOLCANO.x, y - VOLCANO.y), cone = VOLCANO.h * Math.max(0, 1 - r / VOLCANO.r) ** 1.3;
  return 0.12 * smooth(0, 8, land) + 0.25 * smooth(30, 60, x) * (1 - inBasin(x, y)) + ridge + cone;
}
const inBasin = (x: number, y: number) => Math.sqrt(Math.max(0, 1 - ((x - BASIN.x) / BASIN.rx) ** 2 - ((y - BASIN.y) / BASIN.ry) ** 2));
/** How far east of the fault's trace (km). */
const across = (x: number, y: number) => (x - FAULT.x0) * fn[0] + (y - FAULT.y0) * fn[1];

/** The rock at (x, y) and depth d below sea level (km, negative is up). */
export function rockAt3(x: number, y: number, d: number): Rock {
  const top = -elevation(x, y);
  if (d < Math.min(0, top)) return ROCK.air;
  if (d < top) return ROCK.water;
  // the volcano's magma chamber and the pipe up to the summit
  const vr = Math.hypot(x - VOLCANO.x, y - VOLCANO.y);
  if ((vr / 6.5) ** 2 + ((d - 5) / 2.3) ** 2 < 1 || (vr < 0.35 && d < 5)) return ROCK.magma;
  // soft soil in the valley, where the town is
  if (d < BASIN.depth * inBasin(x, y)) return ROCK.soil;
  // east of the fault plane the rock has dropped by 2.5 km; the sediment thins out toward the mountains
  const drop = across(x, y) > d / Math.tan((FAULT.dip * Math.PI) / 180) ? 2.5 : 0;
  const sed = 1.4 * (1 - smooth(88, 98, x));
  return layered(d, sed + drop, 10.5 + drop + 0.8 * Math.sin(y / 11), 24 + drop * 0.5);
}

export interface Line { x: number; y: number; ux: number; uy: number }   // start, and direction (unit)
export interface Section { id: string; ends: [string, string]; name: string; note: string; line: Line; quake: [number, number]; stations: number[] }

const towards = (x: number, y: number, x1: number, y1: number): Line => { const l = Math.hypot(x1 - x, y1 - y); return { x, y, ux: (x1 - x) / l, uy: (y1 - y) / l }; };
export const SECTIONS: Section[] = [
  { id: "A", ends: ["A", "A′"], name: "Sea to town", line: towards(10, 40, 80, 40), quake: [51, 10], stations: [20, 40, 54],
    note: "From the open sea, over the coast and the fault, to the town on its valley of soft soil. S waves cannot cross the sea; the town's soft ground shakes longest." },
  { id: "B", ends: ["B", "B′"], name: "Across the fault", line: { x: 57 - 30 * fn[0], y: 45 - 30 * fn[1], ux: fn[0], uy: fn[1] }, quake: [37, 12], stations: [14, 30, 50],
    note: "Square across the fault, so it shows its true dip of 60°. The quake is on the fault; the east side has dropped 2.5 km." },
  { id: "C", ends: ["C", "C′"], name: "Through the volcano", line: towards(50, 70, 120, 70), quake: [12, 9], stations: [22, 30, 48],
    note: "West to east through the volcano and into the mountains. Magma under the volcano stops the S waves." },
  { id: "D", ends: ["D", "D′"], name: "Along the valley", line: towards(66, 4, 66, 80), quake: [8, 10], stations: [16, 33, 50],
    note: "South to north along the valley, past a factory, under the town and over the road. Compare a station on the soft soil with one on rock." },
];

/** The slice along a line, as a ready-made ground for the Quake view. */
export function slice(line: Line, section?: Section): Preset {
  const at = (s: number) => [line.x + line.ux * s, line.y + line.uy * s] as const;
  // where the fault's trace crosses the line, and how steep it looks there
  let fault: Preset["fault"];
  const denom = line.ux * fn[0] + line.uy * fn[1];
  if (Math.abs(denom) > 0.05) {
    const s = -across(line.x, line.y) / denom;
    if (s > 0 && s < WIDTH_KM) {
      const app = (Math.atan(Math.tan((FAULT.dip * Math.PI) / 180) * Math.abs(denom)) * 180) / Math.PI;   // apparent dip
      fault = { x: s, dip: denom > 0 ? app : 180 - app };
    }
  }
  // the region's noisy places on the line: the coast, the road, the factory (within 3 km)
  const noise: Partial<Record<KindId, number>> = {};
  for (let s = 0.5; s < WIDTH_KM; s += 0.25) {
    const [x, y] = at(s), [x0, y0] = at(s - 0.25);
    if (noise.ocean === undefined && (x - coast(y)) * (x0 - coast(y0)) < 0) noise.ocean = s;
  }
  ROAD.slice(1).forEach(([bx, by], q) => {
    const [ax, ay] = ROAD[q], dx = bx - ax, dy = by - ay, den = line.ux * dy - line.uy * dx;
    if (Math.abs(den) < 1e-9) return;
    const s = ((ax - line.x) * dy - (ay - line.y) * dx) / den, t = ((ax - line.x) * line.uy - (ay - line.y) * line.ux) / den;
    if (t >= 0 && t <= 1 && s > 0 && s < WIDTH_KM && noise.traffic === undefined) noise.traffic = s;
  });
  const fsAlong = (FACTORY.x - line.x) * line.ux + (FACTORY.y - line.y) * line.uy;
  if (fsAlong > 0 && fsAlong < WIDTH_KM && Math.abs((FACTORY.x - line.x) * line.uy - (FACTORY.y - line.y) * line.ux) < 3) noise.factory = fsAlong;
  const tAlong = (TOWN.x - line.x) * line.ux + (TOWN.y - line.y) * line.uy, tOff = Math.abs((TOWN.x - line.x) * line.uy - (TOWN.y - line.y) * line.ux);
  const marks: { x: number; text: string }[] = [];
  if (tAlong > 1 && tAlong < WIDTH_KM - 1 && tOff < 4) marks.push({ x: tAlong, text: "town" });
  if (noise.ocean !== undefined) marks.push({ x: noise.ocean, text: "coast" });
  if (noise.traffic !== undefined) marks.push({ x: noise.traffic, text: "road" });
  if (noise.factory !== undefined) marks.push({ x: noise.factory, text: "factory" });
  const vAlong = (VOLCANO.x - line.x) * line.ux + (VOLCANO.y - line.y) * line.uy;
  if (vAlong > 1 && vAlong < WIDTH_KM - 1 && Math.abs((VOLCANO.x - line.x) * line.uy - (VOLCANO.y - line.y) * line.ux) < 4) marks.push({ x: vAlong, text: "volcano" });
  const heading = Math.round((((Math.atan2(line.ux, line.uy) * 180) / Math.PI) + 360) % 360);
  return {
    name: section ? `${REGION} ${section.ends.join("–")}` : `${REGION}, your line`,
    note: section ? section.note : `Your own cross-section, ${WIDTH_KM.toFixed(0)} km long, heading ${heading}° from north.`,
    quake: section ? section.quake : [WIDTH_KM / 2, 10],
    stations: section ? section.stations : [16, 38, 54],
    fault, noise, marks, ends: section ? section.ends : ["X", "X′"],
    at: (s, d) => { const [x, y] = at(s); return rockAt3(x, y, d); },
  };
}

// ---------------------------------------------------------------- the map
let base: { w: number; h: number; img: OffscreenCanvas } | null = null;
/** The region's surface geology, shaded by height (light from the north-west), w by h device pixels. */
function geology(w: number, h: number) {
  if (base && base.w === w && base.h === h) return base.img;
  const img = new OffscreenCanvas(w, h), data = new ImageData(w, h), e = 0.4;
  for (let r = 0; r < h; r++) for (let q = 0; q < w; q++) {
    const x = ((q + 0.5) / w) * MAP_W, y = MAP_H * (1 - (r + 0.5) / h), z = elevation(x, y);
    const rock = rockAt3(x, y, Math.max(0, -z) + 0.05), c = colour(rock.vp, rock.vs, rock.rho);
    const shade = z > 0 ? Math.min(1.15, Math.max(0.7, 1 - 0.6 * ((elevation(x + e, y) - elevation(x - e, y)) - (elevation(x, y + e) - elevation(x, y - e))) / (2 * e))) : 1 - 0.08 * Math.min(1, -z / 2.6);
    const o = 4 * (r * w + q);
    data.data[o] = c[0] * shade; data.data[o + 1] = c[1] * shade; data.data[o + 2] = c[2] * shade; data.data[o + 3] = 255;
  }
  img.getContext("2d")!.putImageData(data, 0, 0);
  base = { w, h, img };
  return img;
}

/** Draw the map in a box (CSS pixels, at pixel ratio dpr): the named sections faint, the current line bold. */
export function drawMap(c: CanvasRenderingContext2D, w: number, h: number, dpr: number, line: Line, ends: [string, string]) {
  c.imageSmoothingEnabled = true;
  c.drawImage(geology(Math.round(w * dpr), Math.round(h * dpr)), 0, 0, w, h);
  const X = (x: number) => (x / MAP_W) * w, Y = (y: number) => h - (y / MAP_H) * h;
  const path = (pts: [number, number][]) => { c.beginPath(); pts.forEach(([x, y], k) => k ? c.lineTo(X(x), Y(y)) : c.moveTo(X(x), Y(y))); };
  c.font = MONO(9); c.textBaseline = "middle";
  // the fault, the road, the town, the factory, the volcano
  path([[FAULT.x0, FAULT.y0], [FAULT.x1, FAULT.y1]]);
  c.setLineDash([4, 3]); c.strokeStyle = INK; c.lineWidth = 1; c.stroke(); c.setLineDash([]);
  c.textAlign = "left"; label(c, "fault", X(FAULT.x0 + 0.85 * (FAULT.x1 - FAULT.x0)) + 4, Y(FAULT.y0 + 0.85 * (FAULT.y1 - FAULT.y0)), INK);
  path(ROAD); c.strokeStyle = "rgba(250,249,246,0.9)"; c.lineWidth = 3; c.stroke(); c.strokeStyle = MUTED; c.lineWidth = 1.2; c.stroke();
  c.textAlign = "right"; label(c, "road", X(ROAD[1][0]) - 4, Y(ROAD[1][1]) - 6, MUTED);
  c.fillStyle = INK; c.fillRect(X(TOWN.x) - 3, Y(TOWN.y) - 3, 6, 6);
  c.textAlign = "left"; label(c, "town", X(TOWN.x) + 5, Y(TOWN.y) + 7);
  c.fillRect(X(FACTORY.x) - 2.5, Y(FACTORY.y) - 2.5, 5, 5);
  c.textAlign = "right"; label(c, "factory", X(FACTORY.x) - 5, Y(FACTORY.y) - 5);
  c.beginPath(); c.moveTo(X(VOLCANO.x), Y(VOLCANO.y) - 5); c.lineTo(X(VOLCANO.x) + 5, Y(VOLCANO.y) + 3); c.lineTo(X(VOLCANO.x) - 5, Y(VOLCANO.y) + 3); c.closePath(); c.fill();
  c.textAlign = "left"; label(c, "volcano", X(VOLCANO.x) + 7, Y(VOLCANO.y));
  c.textAlign = "center"; label(c, "sea", X(10), Y(70), MUTED); label(c, "mountains", X(104), Y(14), MUTED);
  // the sections, then the current line with its ends
  const draw = (l: Line, names: [string, string], strong: boolean) => {
    const x1 = l.x + l.ux * WIDTH_KM, y1 = l.y + l.uy * WIDTH_KM;
    path([[l.x, l.y], [x1, y1]]);
    if (strong) { c.strokeStyle = "rgba(250,249,246,0.9)"; c.lineWidth = 4; c.stroke(); }
    c.strokeStyle = strong ? RUST : "rgba(37,39,34,0.45)"; c.lineWidth = strong ? 2 : 1; c.stroke();
    c.font = strong ? "bold 11px Georgia, serif" : MONO(9); c.textAlign = "center";
    label(c, names[0], X(l.x) - 8 * l.ux, Y(l.y) + 8 * l.uy, strong ? RUST : MUTED);
    label(c, names[1], X(x1) + 8 * l.ux, Y(y1) - 8 * l.uy, strong ? RUST : MUTED);
  };
  for (const s of SECTIONS) if (s.line !== line) draw(s.line, s.ends, false);
  draw(line, ends, true);
  // north and the scale
  c.font = MONO(9); c.textAlign = "right"; c.textBaseline = "top"; label(c, "N ↑", w - 4, 4, INK);
  c.strokeStyle = INK; c.lineWidth = 1;
  c.beginPath(); c.moveTo(w - 6 - X(20), h - 8); c.lineTo(w - 6, h - 8); c.stroke();
  c.textBaseline = "bottom"; label(c, "20 km", w - 6, h - 10, INK);
  c.strokeStyle = INK; c.strokeRect(0.5, 0.5, w - 1, h - 1);
}
