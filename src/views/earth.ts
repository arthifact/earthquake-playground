// View 3, Inside the Earth: a slice through the whole planet (a simplified PREM: mantle, liquid outer core, solid
// inner core). Click inside to start a deep quake. The surface records every degree all the way round; the
// seismometers you choose (every 1, 5, 10 or 30 degrees from the quake, or one you drag around) show on the globe and
// in the record on the right, by distance from the quake, with background noise at the level you set. The liquid
// outer core stops S waves and bends P waves, which leaves the shadow zones.

import { INK, LINE, MONO, MUTED, NAVY, PAPER_RGB, RUST, earth, hex, label, mix, seismic, star, surface, type RGB } from "../plot";
import { size as waveSize } from "../shaking";
import { Sim } from "../sim";
import { arrivals } from "../travel";
import { segmented, type Log, type Room, type View } from "./view";

const R = 6371, CMB = 3480, ICB = 1221;          // radii, km
const N = 640, H = (2 * R) / 600, C = N / 2;     // grid, cell size (km), centre
const F0 = 0.012;                                // source peak frequency (Hz): a period of about 80 s
// How long to record: until the quake's waves have sunk below the background noise at every seismometer (the rock
// takes their energy, as PREM's attenuation says), but at least until the waves through the core have reached the
// far side, and at most twelve hours. Body waves arrive within about 25 minutes; surface waves crawl round the planet
// at about 3.7 km/s, reach the far side after about 90 minutes and come round again, fading e times every 80 minutes
// or so (measured here), so a magnitude 7 at normal noise is heard for about 7 hours; great quakes ring longer.
const WINDOW = 12 * 60 * 60;                     // seconds of record at most
const MIN_S = 25 * 60;                           // never stop before this
const QUIET_S = 10 * 60;                         // gone: below the noise everywhere for this long
const AXIS = 30 * 60;                            // the record's time axis starts at 30 minutes and grows with it
const EVERY = 8;                                 // one sample every 8 steps (about 5.6 s; the waves last 80 s)
const V_R = 3.7;                                 // surface (Rayleigh) waves, km/s: measured in this model (their largest swing reaches 90° after 45 min, 180° after 89 min)
const NOISE = 2e-5;                              // normal background noise, in simulation units of a magnitude 7
const GAINS: [number, number, number] = [6000, 1500, 600]; // measured: P, S and ground speed peak near 0.01, 0.03, 0.05 by the quake, far less across the Earth
const ROUND = 360;                               // the surface records at every degree, clockwise from the top
const DEGREES = 181;                             // distances from the quake: 0 to 180 degrees
const PAD = 36;
const P_SHADOW: [number, number] = [104, 140], S_SHADOW = 104;
const SPACINGS = [1, 5, 10, 30];
const NOISE_LEVELS: [number, string][] = [[0, "None"], [0.3, "Quiet"], [1, "Normal"], [3, "Noisy"], [10, "Loud"]];

/** PREM's shear attenuation by radius (Dziewonski and Anderson, 1981): the quality factor Q, how many cycles a
 *  wave takes to lose about e^-π of its amplitude. The liquid outer core takes almost nothing (only its bulk Q). */
function quality(r: number) {
  const d = R - r;
  return d < 80 ? 600 : d < 220 ? 80 : d < 670 ? 143 : r > CMB ? 312 : r > ICB ? 57823 : 84.6;
}
/** A simplified PREM by radius (km): speeds (km/s) and density (g/cm³). */
function layer(r: number) {
  if (r > R) return { vp: 0, vs: 0, rho: 0 };
  if (r > R - 670) { const d = (R - r) / 670; return { vp: 8.1 + 2.0 * d, vs: 4.5 + 1.0 * d, rho: 3.4 + 0.6 * d }; }
  if (r > CMB) { const t = (R - 670 - r) / (R - 670 - CMB); return { vp: 10.8 + 2.9 * t, vs: 5.95 + 1.3 * t, rho: 4.4 + 1.2 * t }; }
  if (r > ICB) { const t = (CMB - r) / (CMB - ICB); return { vp: 8.0 + 2.3 * t, vs: 0, rho: 9.9 + 2.3 * t }; }
  return { vp: 11.1, vs: 3.6, rho: 12.9 };
}
const name = (r: number) => r > R ? "space" : r > R - 670 ? "upper mantle" : r > CMB ? "lower mantle" : r > ICB ? "outer core (liquid)" : "inner core (solid)";

const OUTER: RGB = mix(hex("#c98a6f"), PAPER_RGB, 0.45), INNER: RGB = mix(hex("#dba65a"), PAPER_RGB, 0.45);
function colour(vp: number, vs: number, rho: number): [number, number, number, number] {
  if (vp <= 0) return [...PAPER_RGB, 0];
  const c = vs <= 0 ? OUTER : rho > 12.5 ? INNER : mix(earth(0.42 + 0.3 * (vp - 8) / 5.7), PAPER_RGB, 0.55);
  return [c[0], c[1], c[2], 255];
}
/** Minutes, or hours and minutes. */
const clock = (t: number) => t < 5400 ? `${(t / 60).toFixed(1)} min` : `${Math.floor(t / 3600)} h ${String(Math.floor((t % 3600) / 60)).padStart(2, "0")} min`;
const wrap = (g: number) => ((Math.round(g) % ROUND) + ROUND) % ROUND;

export function createEarth(main: HTMLElement, side: HTMLElement, room: Room, log: Log): View {
  main.innerHTML = `
    <div class="pair">
      <div class="pic" id="ePic"><canvas class="gpu"></canvas><canvas class="over"></canvas><p class="loading">Starting the GPU…</p></div>
      <div class="pic" id="eRecPic"><canvas class="over" id="eRec"></canvas></div>
    </div>
    <div class="under" id="eUnder">
      <div class="legend mono"><span><i class="sw-p"></i>P wave</span><span><i class="sw-s"></i>S wave</span><span><i class="sw-core"></i>liquid outer core</span></div>
      <p class="readout mono" id="eRead">Point at the Earth to read it</p>
    </div>`;
  side.innerHTML = `
    <div class="pane">
      <h2>Inside the Earth</h2>
      <p>Click inside the Earth to place a quake's origin, then press <b>Play</b>. It runs until its waves have sunk below the noise everywhere (hours for a big quake). Seismometers (▲) record it (choose One to drag a single seismometer around the planet): the picture on the right shows what each one felt, by its distance from the quake. Point at the picture to find that seismometer on the globe.</p>
      <div class="field"><span class="lbl">Seismometers</span><div class="segmented" id="eLayout">${SPACINGS.map((d) => `<button type="button" data-layout="${d}">${d === 1 ? "Every 1°" : `${d}°`}</button>`).join("")}<button type="button" data-layout="hand">One</button></div></div>
      <p class="mono" id="eLayoutNote" style="font-size:11px"></p>
      <div class="field"><span class="lbl">Background noise</span><div class="segmented" id="eNoise">${NOISE_LEVELS.map(([v, n]) => `<button type="button" data-noise="${v}">${n}</button>`).join("")}</div></div>
      <label class="slider"><span class="lbl">Magnitude</span><output id="eMagOut"></output><input type="range" id="eMag" min="4" max="9.5" step="0.1" value="7"></label>
      <p id="eMagNote">Every seismometer has some background noise. A small quake's waves sink below it a little way from the quake; a great quake is recorded all around the world.</p>
    </div>
    <div class="pane">
      <div class="field"><span class="lbl">Show</span><div class="segmented" id="eMode"><button type="button" data-mode="0">Waves</button><button type="button" data-mode="1">Shaking</button></div></div>
      <div class="toggles"><label><input type="checkbox" id="eNames" checked>Layer names</label><label><input type="checkbox" id="eShadow" checked>Shadow zones</label></div>
      <label class="slider"><span class="lbl">Speed</span><output id="eSpeedOut"></output><input type="range" id="eSpeed" min="1" max="80" step="1" value="20"></label>
      <div class="row three"><button type="button" class="btn go" id="ePlay">Play</button><button type="button" class="btn" id="eReplay">Replay</button><button type="button" class="btn" id="eReset">Reset</button></div>
    </div>
    <div class="pane">
      <span class="lbl">What the shadows tell us</span>
      <ul class="key">
        <li><i class="swatch sw-s"></i><div><b>S shadow · beyond ${S_SHADOW}°</b><span>S waves cannot cross the liquid outer core, so seismometers more than ${S_SHADOW}° from the quake get no direct S wave.</span></div></li>
        <li><i class="swatch sw-p"></i><div><b>P shadow · ${P_SHADOW[0]}° to ${P_SHADOW[1]}°</b><span>P waves slow down and bend as they enter the core, leaving a ring of the Earth with almost no P wave.</span></div></li>
      </ul>
      <p>That is how Richard Oldham (1906) and Beno Gutenberg (1914) found the core, and Inge Lehmann (1936) its solid centre.</p>
    </div>
    <div class="pane">
      <dl class="facts">
        <div><dt>Radius</dt><dd>6,371 km</dd></div>
        <div><dt>Mantle</dt><dd>solid rock, to 2,891 km deep</dd></div>
        <div><dt>Outer core</dt><dd>liquid iron, to 5,150 km</dd></div>
        <div><dt>Inner core</dt><dd>solid iron, 1,221 km radius</dd></div>
      </dl>
    </div>`;

  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const pic = $("ePic"), gpuCanvas = pic.querySelector<HTMLCanvasElement>(".gpu")!, over = pic.querySelector<HTMLCanvasElement>(".over")!;
  const recPic = $("eRecPic"), rec = $<HTMLCanvasElement>("eRec"), under = $("eUnder"), readout = $("eRead");

  const vp = new Float32Array(N * N), vs = new Float32Array(N * N), rho = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const l = layer(Math.hypot(i + 0.5 - C, j + 0.5 - C) * H), k = j * N + i;
    vp[k] = l.vp; vs[k] = l.vs; rho[k] = l.rho;
  }

  // attenuation: amplitude falls as exp(-π f t / Q) at the waves' frequency
  const loss = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) loss[j * N + i] = (Math.PI * F0) / quality(Math.hypot(i + 0.5 - C, j + 0.5 - C) * H);

  let sim: Sim | null = null;
  let mode = 0, speed = 20, playing = false, started = false, ended = false, span = AXIS, names = true, shadows = true, magnitude = 7, reach = 0;
  let layout: number | "hand" = 1, noiseLevel = 1, dragging = false;
  let placed = 60;                                 // the one seismometer you move: degrees clockwise from the top
  let pointed = -1;                                // the seismometer under the pointer on the record (degrees from the top)
  const relative = () => waveSize(magnitude, F0) / waveSize(7, F0);    // wave size against a magnitude 7
  let noise = new Float32Array(0);                 // unit background noise, sample by degree
  let quake = { phi: 0, depth: 200 };              // clockwise from the top (radians), km
  let cells: number[] = [];                        // the surface cell at each degree
  let curves: { p: number[]; s: number[] } | null = null;
  let size = 400;
  const image = new ImageData(DEGREES, 360);

  const quakeDeg = () => (quake.phi * 180) / Math.PI;
  /** Degrees from the quake (0 to 180) of the seismometer at g degrees from the top. */
  const distanceOf = (g: number) => Math.abs(((((g - quakeDeg()) % 360) + 540) % 360) - 180);
  /** The seismometers on show: [degrees from the top, degrees from the quake]. */
  const stations = (): [number, number][] => layout === "hand"
    ? [[placed, Math.round(distanceOf(placed))]]
    : Array.from({ length: Math.floor(180 / layout) + 1 }, (_, k) => [wrap(quakeDeg() + k * (layout as number)), k * (layout as number)]);

  const cellAt = (phi: number, r: number) => {
    const i = Math.round(C - 0.5 + (Math.sin(phi) * r) / H), j = Math.round(C - 0.5 - (Math.cos(phi) * r) / H);
    return j * N + i;
  };
  /** Put the quake's origin here: the Earth is still until Play. */
  function place(phi: number, depth: number) {
    if (!sim) return;
    quake = { phi, depth };
    reset();
    curves = null;
    const src = cellAt(phi, R - depth), along = Array.from({ length: DEGREES }, (_, a) => cells[wrap(quakeDeg() + a)]);
    setTimeout(() => { curves = { p: arrivals(N, N, H, vp, src, along, 4), s: arrivals(N, N, H, vs, src, along, 4) }; }, 0);
    log(`Origin ${Math.round(depth)} km deep. Press Play to start the magnitude ${magnitude.toFixed(1)} earthquake.`);
  }
  /** Start the quake at its origin, from the beginning. */
  function go() {
    if (!sim) return;
    const { phi, depth } = quake, er = [Math.sin(phi), -Math.cos(phi)], et = [Math.cos(phi), Math.sin(phi)];
    const src = cellAt(phi, R - depth);
    // a fault slipping across the radius (double couple), turned to where the quake is
    sim.quake(src % N, Math.floor(src / N), [2 * er[0] * et[0], 2 * er[1] * et[1], er[0] * et[1] + et[0] * er[1]]);
    started = true; ended = false;
    setPlaying(true);
    log(`Magnitude ${magnitude.toFixed(1)} earthquake ${Math.round(depth)} km deep`);
  }
  /** Still again, back to the start, nothing recorded (the origin stays). */
  function reset() {
    if (!sim) return;
    sim.still(); started = false; ended = false; span = AXIS;
    setPlaying(false);
  }
  const replay = go;
  function setPlaying(on: boolean) { playing = on; $("ePlay").textContent = on ? "Pause" : "Play"; }
  /** Have the quake's waves sunk below the noise at every seismometer for the last QUIET_S seconds? (With no noise
   *  chosen, below a quiet station's noise.) */
  function gone() {
    if (!sim) return false;
    const { records, nst, t0, recorded } = sim, rdt = sim.dt * sim.every, rows = Math.round(QUIET_S / rdt), q0 = recorded - rows;
    if (recorded * rdt - t0 < MIN_S || q0 < 0) return false;
    const limit = 3 * NOISE * Math.max(0.3, noiseLevel) / relative();
    for (let g = 0; g < ROUND; g++) {
      const p = (g * Math.PI) / 180, sn = Math.sin(p), cs = Math.cos(p);
      for (let q = q0; q < recorded; q++) { const o = (q * nst + g) * 2; if (Math.abs(records[o] * sn - records[o + 1] * cs) > limit) return false; }
    }
    return true;
  }

  function setLayout(v: number | "hand") {
    layout = v;
    segmented($("eLayout"), "layout", String(v));
    $("eLayoutNote").textContent = v === "hand"
      ? `One seismometer, ${Math.round(distanceOf(placed))}° from the quake. Drag it around the Earth.`
      : v === 1 ? "One at every degree, clockwise from the quake: the record becomes a picture." : `One every ${v}°, clockwise from the quake.`;
  }

  // ---------------------------------------------------------------- controls and pointer
  const geo = () => { const inner = size - 2 * PAD; return { cx: PAD + inner / 2, cy: PAD + inner / 2, scale: inner / (N * H) }; };
  const degreesAt = (e: PointerEvent) => {
    const b = over.getBoundingClientRect(), { cx, cy, scale } = geo();
    const x = (e.clientX - b.left - cx) / scale, z = (e.clientY - b.top - cy) / scale;
    return { r: Math.hypot(x, z), phi: Math.atan2(x, -z), g: wrap((Math.atan2(x, -z) * 180) / Math.PI) };
  };
  /** Is the pointer on the movable seismometer? */
  const onStation = (e: PointerEvent) => {
    if (layout !== "hand") return false;
    const { r, g } = degreesAt(e);
    return r > R * 0.9 && r < R * 1.15 && Math.abs(((g - placed + 540) % 360) - 180) <= 5;
  };
  over.addEventListener("pointerdown", (e) => {
    const { r, phi } = degreesAt(e);
    if (onStation(e)) { dragging = true; over.setPointerCapture(e.pointerId); return; }
    if (r > R * 1.08) return;
    place(phi, Math.min(700, Math.max(40, R - r)));
    if (R - r > 700) log("Earthquakes happen no deeper than about 700 km, so this one starts at 700 km");
  });
  const drop = () => { if (dragging) { dragging = false; log(`Seismometer ${Math.round(distanceOf(placed))}° from the quake`); } };
  over.addEventListener("pointerup", drop);
  over.addEventListener("pointercancel", drop);
  over.addEventListener("pointermove", (e) => {
    const { r, g } = degreesAt(e), l = layer(r);
    if (dragging) { placed = g; setLayout("hand"); }
    over.style.cursor = dragging || onStation(e) ? "grab" : "crosshair";
    if (dragging || onStation(e)) { readout.textContent = `Seismometer ${Math.round(distanceOf(placed))}° from the quake (${Math.round((distanceOf(placed) * Math.PI * R) / 180).toLocaleString()} km)`; return; }
    readout.textContent = r > R ? "Point at the Earth to read it" :
      `${Math.round(R - r).toLocaleString()} km deep · ${name(r)} · P ${l.vp.toFixed(1)} km/s · S ${l.vs > 0 ? `${l.vs.toFixed(1)} km/s` : "none"}`;
  });
  rec.addEventListener("pointerleave", () => { pointed = -1; });
  rec.addEventListener("pointermove", (e) => {
    const b = rec.getBoundingClientRect(), box = recBox();
    const d = ((e.clientX - b.left - box.L) / box.iw) * 180, t = ((e.clientY - b.top - box.T) / box.ih) * span;
    const list = stations();
    let best = -1, gap = Infinity;
    for (const [g, dist] of list) if (Math.abs(dist - d) < gap) { gap = Math.abs(dist - d); best = g; }
    pointed = d < -2 || d > 182 || gap > Math.max(3, layout === "hand" ? 4 : (layout as number) / 2 + 1) ? -1 : best;
    readout.textContent = d < 0 || d > 180 || t < 0 || t > span ? "Point at the record to read it" : `${d.toFixed(0)}° from the quake (${Math.round((d * Math.PI * R) / 180).toLocaleString()} km) · ${(t / 60).toFixed(1)} min after it`;
  });
  const choose = (id: string, attr: string, f: (v: string) => void) => {
    const el = $(id);
    el.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>(`[data-${attr}]`);
      if (b) { segmented(el, attr, b.dataset[attr]!); f(b.dataset[attr]!); }
    });
  };
  choose("eMode", "mode", (v) => { mode = +v; });
  choose("eLayout", "layout", (v) => { if (v === "hand") placed = wrap(quakeDeg() + 60); setLayout(v === "hand" ? "hand" : +v); });
  choose("eNoise", "noise", (v) => { noiseLevel = +v; });
  segmented($("eMode"), "mode", "0"); segmented($("eNoise"), "noise", "1");
  $<HTMLInputElement>("eNames").addEventListener("change", (e) => { names = (e.target as HTMLInputElement).checked; });
  $<HTMLInputElement>("eShadow").addEventListener("change", (e) => { shadows = (e.target as HTMLInputElement).checked; });
  const magEl = $<HTMLInputElement>("eMag");
  const showMagnitude = () => { magnitude = +magEl.value; $("eMagOut").textContent = `M ${magnitude.toFixed(1)}`; };
  magEl.addEventListener("input", showMagnitude);
  showMagnitude();
  const speedEl = $<HTMLInputElement>("eSpeed");
  const showSpeed = () => { speed = +speedEl.value; $("eSpeedOut").textContent = sim ? `${((speed * sim.dt * 60) / 60).toFixed(1)} min per second` : String(speed); };
  speedEl.addEventListener("input", showSpeed);
  $("ePlay").addEventListener("click", () => { if (!playing && (!started || ended)) go(); else setPlaying(!playing); });
  $("eReplay").addEventListener("click", replay);
  $("eReset").addEventListener("click", () => { reset(); log("Still again. Press Play to start the quake, or click inside the Earth to move its origin."); });
  setLayout(1);

  Sim.create(gpuCanvas, {
    nx: N, nz: N, h: H, vmax: 13.7, f0: F0, sponge: { left: 0, right: 0, bottom: 0, top: 0 },
    view: { x0: 0, z0: 0, w: N, h: N }, seconds: WINDOW + 1.2 / F0, every: EVERY, stations: ROUND, gains: GAINS, dots: 16,
  }).then((s) => {
    sim = s;
    (window as unknown as { playground: Record<string, Sim> }).playground = { ...(window as unknown as { playground?: object }).playground, earth: s };
    pic.querySelector(".loading")!.remove();
    s.setGround(vp, vs, rho, colour, loss);
    // the surface cell at every degree (solid rock just under the surface)
    cells = Array.from({ length: ROUND }, (_, g) => {
      const p = (g * Math.PI) / 180;
      for (let r = R - 0.5 * H; r > R - 6 * H; r -= 0.5 * H) { const k = cellAt(p, r); if (vp[k] > 0 && vs[k] > 0) return k; }
      return cellAt(p, R - 2 * H);
    });
    s.setStations(cells);
    // background noise: random, smoothed over about 20 s, the same for every quake
    noise = new Float32Array(s.samples * ROUND);
    let seed = 12345;
    const rand = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 4294967296 - 0.5; };
    for (let g = 0; g < ROUND; g++) { let y = 0; for (let q = 0; q < s.samples; q++) { y = 0.97 ** s.every * y + Math.sqrt(s.every) * rand(); noise[q * ROUND + g] = y * 0.5; } }
    showSpeed();
    place(0, 200);
  }, (err: Error) => { pic.querySelector(".loading")!.textContent = err.message; });

  // ---------------------------------------------------------------- drawing
  function drawGlobe() {
    const { c } = surface(over), { cx, cy, scale } = geo(), rr = R * scale;
    const at = (deg: number, r: number) => { const p = quake.phi + (deg * Math.PI) / 180; return [cx + Math.sin(p) * r, cy - Math.cos(p) * r]; };
    c.lineWidth = 1; c.strokeStyle = INK;
    c.beginPath(); c.arc(cx, cy, rr, 0, 2 * Math.PI); c.stroke();
    c.strokeStyle = "rgba(37,39,34,0.45)";
    for (const r of [CMB, ICB]) { c.beginPath(); c.arc(cx, cy, r * scale, 0, 2 * Math.PI); c.stroke(); }
    // shadow zones, on both sides of the quake
    if (shadows) {
      const arc = (a: number, b: number, r: number, colour: string) => {
        for (const side of [1, -1]) {
          const p0 = quake.phi - Math.PI / 2 + (side * a * Math.PI) / 180, p1 = quake.phi - Math.PI / 2 + (side * b * Math.PI) / 180;
          c.beginPath(); c.arc(cx, cy, r, Math.min(p0, p1), Math.max(p0, p1)); c.strokeStyle = colour; c.lineWidth = 5; c.stroke();
        }
      };
      arc(P_SHADOW[0], P_SHADOW[1], rr + 7, "rgba(164,70,42,0.75)");
      arc(S_SHADOW, 180, rr + 15, "rgba(18,63,98,0.75)");
      c.font = MONO(10); c.textAlign = "center"; c.textBaseline = "middle";
      const [px, py] = at(122, rr + 26), [sx, sy] = at(165, rr + 26);
      label(c, "P shadow", px, py, RUST); label(c, "S shadow", sx, sy, NAVY);
      // distance marks every 30 degrees
      c.lineWidth = 1; c.strokeStyle = INK; c.fillStyle = MUTED;
      for (let d = 30; d <= 180; d += 30) for (const side of d === 180 ? [1] : [1, -1]) {
        const [x0, y0] = at(side * d, rr - 5), [x1, y1] = at(side * d, rr + 2);
        c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
        if (side === 1 || d === 180) { const [lx, ly] = at(side * d, rr - 16); c.font = MONO(9); label(c, `${d}°`, lx, ly, MUTED); }
      }
    }
    if (names) {
      c.font = MONO(10); c.textAlign = "center"; c.textBaseline = "middle";
      const down = quake.phi + Math.PI;            // write on the far side from the quake, where it is calm
      const tag = (text: string, r: number, turn: number) => label(c, text, cx + Math.sin(down + turn) * r * scale, cy - Math.cos(down + turn) * r * scale, INK);
      tag("mantle", (R + CMB) / 2, 0.55);
      tag("outer core · liquid", (CMB + ICB) / 2, 0.35);
      tag("inner core · solid", 0, 0);
    }
    // seismometers (every tenth when there is one at every degree), and the one pointed at
    const station = (g: number, r: number, colour: string) => {
      const p = (g * Math.PI) / 180, ox = Math.sin(p), oy = -Math.cos(p), tx = -oy, ty = ox;
      const bx = cx + ox * rr, by = cy + oy * rr;
      c.beginPath(); c.moveTo(bx + tx * r, by + ty * r); c.lineTo(bx - tx * r, by - ty * r); c.lineTo(bx + ox * r * 1.7, by + oy * r * 1.7); c.closePath();
      c.fillStyle = colour; c.fill();
    };
    for (const [g, d] of stations()) if (layout !== 1 || d % 10 === 0) station(g, layout === "hand" ? 6 : 3.5, layout === "hand" ? RUST : INK);
    if (pointed >= 0) {
      station(pointed, 6, RUST);
      const p = (pointed * Math.PI) / 180;
      c.font = MONO(11); c.textAlign = "center"; c.textBaseline = "middle";
      label(c, `${Math.round(distanceOf(pointed))}°`, cx + Math.sin(p) * (rr + 22), cy - Math.cos(p) * (rr + 22), RUST);
    }
    // the quake
    const [fx, fy] = at(0, (R - quake.depth) * scale), [ex, ey] = at(0, rr);
    star(c, fx, fy, 8); c.fillStyle = RUST; c.fill(); c.strokeStyle = "#faf9f6"; c.lineWidth = 1.2; c.stroke();
    c.font = MONO(10); c.textAlign = "left"; c.textBaseline = "middle";
    label(c, `M ${magnitude.toFixed(1)}`, fx + 11, fy, RUST);
    c.beginPath(); c.arc(ex, ey, 3, 0, 2 * Math.PI); c.fillStyle = RUST; c.fill();
    if (sim) {
      c.font = MONO(11); c.textAlign = "left"; c.textBaseline = "top"; c.fillStyle = INK;
      c.fillText(started ? `${clock(Math.max(0, sim.step * sim.dt - sim.t0))} after the quake` : "Press Play to start the quake", 0, 0);
    }
  }

  const recBox = () => ({ L: 44, T: PAD, iw: size - 44 - 10, ih: size - 2 * PAD });
  function drawRecord() {
    const { c } = surface(rec), { L, T, iw, ih } = recBox();
    // the time axis: 30 minutes, growing in steps of 10 minutes as the record does
    if (sim && started) { const now = Math.max(0, sim.step * sim.dt - sim.t0); span = Math.min(WINDOW, Math.max(AXIS, ended ? now : Math.ceil((now + 1) / 600) * 600)); }
    const tx = (d: number) => L + (d / 180) * iw, ty = (t: number) => T + (t / span) * ih;
    c.font = MONO(10); c.fillStyle = MUTED; c.textAlign = "left"; c.textBaseline = "alphabetic";
    c.fillText("SEISMOMETERS AROUND THE WORLD, BY DISTANCE FROM THE QUAKE", 0, 12);
    const list = stations();
    if (sim && sim.nst) {
      const { records, nst, t0, recorded } = sim, rows = image.height, dt = sim.dt * sim.every;
      // radial (up and down) motion at the seismometer g degrees from the top
      const up = (q: number, g: number) => {
        const p = (g * Math.PI) / 180, o = (q * nst + g) * 2;
        return records[o] * Math.sin(p) - records[o + 1] * Math.cos(p);
      };
      // the waves at this magnitude plus the noise, on a logarithmic scale (four decades above normal noise)
      const r = relative(), decades = Math.log1p(1e4);
      const seen = (q: number, g: number) => r * up(q, g) + noiseLevel * NOISE * (noise[q * ROUND + g] ?? 0);
      const shade = (v: number) => Math.sign(v) * Math.min(1, Math.log1p(Math.abs(v) / NOISE) / decades);
      const threshold = 8 * NOISE * Math.max(0.25, noiseLevel);
      reach = 0;
      for (const [g, d] of list) for (let q = 0; q < recorded; q += 3) if (r * Math.abs(up(q, g)) > threshold) { reach = Math.max(reach, d); break; }
      const sampleAt = (row: number) => Math.round((((row + 0.5) / rows) * span + t0) / dt);
      if (layout === 1) {
        // a seismometer at every degree: the record is a picture
        const px = image.data;
        for (let row = 0; row < rows; row++) {
          const q = sampleAt(row);
          for (const [g, d] of list) {
            const o = 4 * (row * DEGREES + d);
            if (q >= recorded) { px[o + 3] = 0; continue; }
            const col = seismic(0.5 + 0.5 * shade(seen(q, g)));
            px[o] = col[0]; px[o + 1] = col[1]; px[o + 2] = col[2]; px[o + 3] = 255;
          }
        }
        const off = new OffscreenCanvas(DEGREES, rows);
        off.getContext("2d")!.putImageData(image, 0, 0);
        c.imageSmoothingEnabled = true;
        c.drawImage(off, L, T, iw, ih);
      } else {
        // a few seismometers: one wiggle each, at its distance
        const half = layout === "hand" ? 30 : Math.min(22, ((layout as number) / 180) * iw * 0.55);
        for (const [g, d] of list) {
          const x0 = tx(d);
          c.strokeStyle = LINE; c.lineWidth = 1;
          c.beginPath(); c.moveTo(x0, T); c.lineTo(x0, T + ih); c.stroke();
          c.beginPath();
          for (let row = 0; row < rows; row++) {
            const q = sampleAt(row);
            if (q >= recorded) break;
            const x = x0 + half * shade(seen(q, g)), y = T + ((row + 0.5) / rows) * ih;
            if (row) c.lineTo(x, y); else c.moveTo(x, y);
          }
          c.strokeStyle = g === pointed ? RUST : INK; c.lineWidth = g === pointed ? 1.5 : 1; c.stroke();
        }
      }
      // first arrivals, where the direct waves still reach
      if (curves) {
        const line = (times: number[], to: number, colour: string, text: string) => {
          c.beginPath();
          let first = true;
          for (let a = 0; a <= to; a++) { const t = times[a]; if (!Number.isFinite(t)) continue; const x = tx(a), y = ty(t); if (first) { c.moveTo(x, y); first = false; } else c.lineTo(x, y); }
          c.setLineDash([2, 3]); c.strokeStyle = colour; c.lineWidth = 1.2; c.stroke(); c.setLineDash([]);
          const t = times[Math.min(to, 60)];
          if (Number.isFinite(t)) { c.font = "bold 11px ui-monospace, SFMono-Regular, monospace"; c.textAlign = "left"; c.textBaseline = "bottom"; label(c, text, tx(Math.min(to, 60)) + 4, ty(t) - 2, colour); }
        };
        line(curves.p, 100, RUST, "P");
        line(curves.s, 100, NAVY, "S");
      }
      // surface waves: the short way round (R1) and, later, the long way (R2)
      const around = (Math.PI * R) / 180 / V_R, surf = (first: (d: number) => number, text: string) => {
        c.beginPath();
        for (let d = 0; d <= 180; d += 2) { const y = ty(first(d)); if (d) c.lineTo(tx(d), y); else c.moveTo(tx(d), y); }
        c.setLineDash([1, 4]); c.strokeStyle = INK; c.lineWidth = 1.2; c.stroke(); c.setLineDash([]);
        const d0 = [30, 60, 90, 120, 150].find((d) => first(d) < span * 0.92);
        if (d0 !== undefined) { c.font = "bold 11px ui-monospace, SFMono-Regular, monospace"; c.textAlign = "left"; c.textBaseline = "bottom"; label(c, text, tx(d0) + 4, ty(first(d0)) - 2, INK); }
      };
      c.save(); c.beginPath(); c.rect(L, T, iw, ih); c.clip();
      // R1 the short way round, R2 the long way, R3 and R4 once more round the planet
      surf((d) => d * around, "R1");
      surf((d) => (360 - d) * around, "R2");
      surf((d) => (360 + d) * around, "R3");
      surf((d) => (720 - d) * around, "R4");
      c.restore();
      const now = Math.max(0, sim.step * dt - t0);
      c.strokeStyle = "rgba(37,39,34,0.5)"; c.lineWidth = 1;
      c.beginPath(); c.moveTo(L, ty(Math.min(now, span))); c.lineTo(L + iw, ty(Math.min(now, span))); c.stroke();
    }
    if (shadows) {
      c.fillStyle = "rgba(164,70,42,0.08)"; c.fillRect(tx(P_SHADOW[0]), T, tx(P_SHADOW[1]) - tx(P_SHADOW[0]), ih);
      c.strokeStyle = "rgba(164,70,42,0.6)"; c.setLineDash([3, 3]); c.lineWidth = 1;
      for (const d of P_SHADOW) { c.beginPath(); c.moveTo(tx(d), T); c.lineTo(tx(d), T + ih); c.stroke(); }
      c.setLineDash([]);
      c.font = MONO(10); c.textAlign = "center"; c.textBaseline = "top";
      label(c, "P shadow", tx((P_SHADOW[0] + P_SHADOW[1]) / 2), T + 4, RUST);
      label(c, "no S beyond here →", tx(S_SHADOW) - 2, T + 18, NAVY);
    }
    if (sim && sim.recorded) {
      c.font = MONO(11); c.textAlign = "right"; c.textBaseline = "top";
      const text = layout === "hand"
        ? `M ${magnitude.toFixed(1)} · ${reach > 0 ? "above the noise here" : "lost in the noise here"}`
        : `M ${magnitude.toFixed(1)} · seen to ${reach >= 178 ? "180°, the whole Earth" : `${reach}°`}`;
      label(c, text, L + iw - 4, T + ih - 18, INK);
    }
    // axes
    c.strokeStyle = INK; c.lineWidth = 1; c.strokeRect(L - 0.5, T - 0.5, iw + 1, ih + 1);
    c.font = MONO(10); c.fillStyle = MUTED; c.strokeStyle = MUTED; c.textBaseline = "bottom";
    for (let d = 0; d <= 180; d += 30) {
      c.beginPath(); c.moveTo(tx(d), T - 4); c.lineTo(tx(d), T); c.stroke();
      c.textAlign = d === 0 ? "left" : d === 180 ? "right" : "center"; c.fillText(`${d}°`, tx(d), T - 6);
    }
    c.textAlign = "right"; c.textBaseline = "middle";
    for (let m = 0, every = span <= 2400 ? 5 : span <= 4800 ? 10 : span <= 10800 ? 30 : span <= 21600 ? 60 : 120; m <= span / 60; m += every) {
      c.beginPath(); c.moveTo(L - 4, ty(m * 60)); c.lineTo(L, ty(m * 60)); c.stroke();
      c.fillText(m === 0 ? "0 min" : span > 5400 ? (m % 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}` : `${m / 60} h`) : String(m), L - 7, ty(m * 60));
    }
  }

  return {
    frame() {
      if (!sim) return;
      if (playing) {
        const left = sim.end - sim.step;
        ended = left <= 0 || gone();
        if (!ended) sim.advance(Math.min(speed, left));
        else {
          setPlaying(false);
          const t = Math.max(0, sim.step * sim.dt - sim.t0);
          log(left <= 0 ? "Twelve hours: the Earth still rings, but the record stops here. Play or Replay starts the quake again." : `The waves have sunk below the noise everywhere: ${clock(t)} recorded. Play or Replay starts the quake again.`);
        }
      } else sim.pull();
      sim.render({ mode, glow: Math.min(2.5, Math.max(0.15, relative() ** 0.2)), exag: 0 });
      drawGlobe();
      drawRecord();
    },
    resize() {
      const { w, h } = room();
      size = Math.floor(Math.max(260, Math.min((w - 24) / 2, h - 40)));
      for (const p of [pic, recPic]) { p.style.width = `${size}px`; p.style.height = `${size}px`; }
      Object.assign(gpuCanvas.style, { left: `${PAD}px`, top: `${PAD}px`, width: `${size - 2 * PAD}px`, height: `${size - 2 * PAD}px` });
      under.style.width = `${2 * size + 24}px`;
    },
    key(e) {
      if (e.key === " ") { e.preventDefault(); $("ePlay").click(); }
      else if (e.key === "r" || e.key === "R") replay();
    },
  };
}
