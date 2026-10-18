// View 1, Quake: a slice through the ground, 61 km wide. Draw a fault and it ruptures (its magnitude, start, speed and
// slip are yours to set), or set off an explosion (any magnitude)
// or an explosion (quarry blast to nuclear test) and watch its P, S and Rayleigh waves. One to five seismometers
// on the surface record ground velocity, displacement or acceleration in real units at 100 samples per second,
// with added background noise, or hear noise sources (ocean waves, traffic, a factory) whose waves are simulated;
// the records download as SAC and CSV. Draw any rock type, or dig caves.

import { save, sac, csv, zip, type Trace } from "../export";
import { DEPTH_KM, H, MAX_KM, MIN_KM, NX, NZ, ROCK, SCALE, SKY, SPONGE, VH, VMAX, W, WIDTH_KM, build, colour, placed, rockAt, rockCss, setScale, type Preset, type Rock } from "../ground";
import { PRESETS } from "../templates";
import { KINDS, LEVELS, source, type KindId } from "../noise";
import { ACCENT, INK, LINE, MONO, MUTED, NAVY, OCHRE, PAPER, RUST, TEAL, label, ramp, star, surface } from "../plot";
import { BLASTS, FELT, ROMAN, blastMagnitude, corner, intensity, magnitudeFor, ruptureKm, size, units } from "../shaking";
import { amplitude, bandpass, spectrogram } from "../spectrum";
import { Sim } from "../sim";
import { applyGround, decode, diffGround, encode, fromAddress, linkFor, type Scenario } from "../scenario";
import { arrivals } from "../travel";
import { segmented, type Log, type Room, type View } from "./view";

// Times and frequencies follow the slice's scale (ground.ts SCALES): a slice s times bigger has cells, waves,
// records and samples s times longer. These are the values for the 61 km slice; scaled() sets them.
let F0 = 1.1;                                // source peak frequency, Hz
// How long to record: until the quake's waves have gone. At least until the slowest wave could have crossed the
// whole slice (plus the rupture's own time), then on while any seismometer still hears the quake; never past MAX_S.
let MAX_S = 120;                             // seconds of seismogram at most
const NOISE_S = 60;                          // the noise sources alone: a fixed length, enough for their spectra
let AXIS_S = 30;                             // the time axis starts this long and grows with the record
// quiet: the last 3 s below 3 % of each station's peak (the absorbing edges send back echoes of about 2 %,
// measured on plain rock, so a stricter bar would wait for those)
let TAIL_S = 3;
const QUIET = 0.03;
let SPS = 100;                               // samples per second, as a broadband seismometer (HH channels; BH when slower)
const GAINS: [number, number, number] = [1.2e6, 1.2e5, 5e4];   // measured: P, S and ground speed peak near 1.5e-5, 6e-5, 1.5e-4
const EXAG = 4e5;                            // particles: displacement peaks near 2e-5, shown as up to 5 cells
const REF_KM = 20;
const K = 230;                               // m/s per simulation unit for magnitude 5: peaks near 6.5e-5 at 20 km (plain rock) give 1.5 cm/s
const KM_PER_S = 8;                          // distance per second of S minus P, for rock like this
const PAD = { l: 44, r: 8, t: 26, b: 4 };
const SEIS_H = 260;
const NAMES = ["A", "B", "C", "D", "E"];
const NOISE: [number, string][] = [[0, "no added noise"], [1e-7, "0.1 µm/s · quiet vault"], [1e-6, "1 µm/s · quiet site"], [1e-5, "10 µm/s · town"], [1e-4, "100 µm/s · busy street"], [1e-3, "1 mm/s · building site"]];
const MEASURES = { vel: ["Velocity", "m/s", "ground velocity"], disp: ["Displacement", "m", "ground displacement"], acc: ["Acceleration", "m/s²", "ground acceleration"] } as const;
type Measure = keyof typeof MEASURES;
type Tool = "fault" | "blast" | "draw" | "dig";
const MAX_SOURCES = 4;
/** Filters for the seismograms on screen: high-pass and low-pass corners (Hz, 0 for none), whether they follow the
 *  slice's scale (the quake's band does; the ocean's and traffic's are fixed by nature), and what they are for. */
const FILTERS: [string, number, number, boolean, string][] = [
  ["none", 0, 0, false, "No filter"], ["micro", 0.1, 0.5, false, "ocean microseism"], ["quake", 0.5, 2, true, "the quake's waves"],
  ["cultural", 1, 4, false, "traffic and machines"], ["hp", 1, 0, true, "no slow noise"], ["lp", 0, 1, true, "no fast noise"], ["custom", 0.5, 2, true, "Your own band…"],
];
const hz = (f: number) => (f < 0.1 ? f.toFixed(3) : f < 1 ? f.toFixed(2) : f.toFixed(1)).replace(/\.?0+$/, "");
const corners = (f: (typeof FILTERS)[number]) => f[3] ? [f[1] / SCALE, f[2] / SCALE] : [f[1], f[2]];
function filterName(f: (typeof FILTERS)[number]) {
  const [lo, hi] = corners(f);
  return f[0] === "none" || f[0] === "custom" ? f[4] : lo && hi ? `${hz(lo)}–${hz(hi)} Hz · ${f[4]}` : lo ? `High-pass ${hz(lo)} Hz · ${f[4]}` : `Low-pass ${hz(hi)} Hz · ${f[4]}`;
}
type Look = "trace" | "spec" | "sgram";
let FMIN = 0.1, FMAX = 10;                    // the frequency axis of spectra (Hz, log)
let F_GRID = 1.6 / (5 * H);                  // above this the grid has fewer than 5 cells per wavelength of the slowest S wave
/** Set the times and frequencies for the slice's scale. */
function scaled() {
  F0 = 1.1 / SCALE; MAX_S = 120 * SCALE; AXIS_S = 30 * SCALE; TAIL_S = 3 * SCALE; SPS = 100 / SCALE;
  FMIN = 0.1 / SCALE; FMAX = 10 / SCALE; F_GRID = 1.6 / (5 * H);
}
/** The Brune source spectrum of a magnitude 5 at f Hz, relative to its flat level. */
const brune5 = (f: number) => 1 / (1 + (f / corner(5)) ** 2);
const HEAT = ramp([PAPER, "#ebc488", OCHRE, RUST, "#3a1a10"]);
const WARM_S = 20;                           // the noise sources run this long before a quake, so their waves fill the slice
const NOISE_LOSS = 0.5;                      // 1/s: noise waves fade e times in 2 s (about 6 km), as rock near the surface absorbs them
const WARM_STEPS = 400;                      // noise steps per frame while they start
const NOISE_SHOW = 3e-6;                     // the picture shows the loudest noise source as if it were this many m/s (brighter than true)
const SOURCE_COLOUR: Record<KindId, string> = { ocean: TEAL, traffic: OCHRE, factory: ACCENT };
const SOURCE_AT: Record<KindId, number> = { ocean: 4, traffic: 34, factory: 47 };   // where a new source goes (km), unless the ground says
const ROCKS = Object.entries(ROCK as Record<string, Rock>).filter(([id]) => id !== "air");
const GROUPS = [...new Set(ROCKS.map(([, r]) => r.group!))];

/** Deterministic background noise, RMS 1 at 100 samples per second: microseism near 0.2 Hz plus local noise. */
function noiseTrace(seed: number, n: number) {
  let a = seed >>> 0;
  const rand = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 - 0.5; };
  const out = new Float32Array(n), r = 0.995, c = 2 * r * Math.cos((2 * Math.PI * 0.2) / SPS);
  let y1 = 0, y2 = 0, w1 = 0, sm = 0, sl = 0;
  const micro = new Float32Array(n), local = new Float32Array(n);
  for (let k = -2000; k < n; k++) {
    const y = c * y1 - r * r * y2 + rand(); y2 = y1; y1 = y;
    const w = rand(), l = 0.5 * (w + w1); w1 = w;
    if (k >= 0) { micro[k] = y; local[k] = l; sm += y * y; sl += l * l; }
  }
  const am = 0.8 / Math.sqrt(sm / n), al = 0.6 / Math.sqrt(sl / n);
  for (let k = 0; k < n; k++) out[k] = micro[k] * am + local[k] * al;
  return out;
}

export function createQuake(main: HTMLElement, side: HTMLElement, room: Room, log: Log): View {
  main.innerHTML = `
    <div class="pic" id="qPic"><canvas class="gpu"></canvas><canvas class="over"></canvas><p class="loading">Starting the GPU…</p></div>
    <div class="under" id="qUnder">
      <div class="legend mono"><span><i class="sw-p"></i>P wave</span><span><i class="sw-s"></i>S wave</span><span>slow rock <b class="ramp" id="qRamp"></b> fast rock</span></div>
      <p class="readout mono" id="qRead">Point at the ground to read it</p>
    </div>
    <canvas class="seis" id="qSeis"></canvas>`;
  side.innerHTML = `
    <div class="pane">
      <h2>Model</h2>
      <div class="field"><span class="lbl">Template</span><select id="qPreset">${Object.entries(PRESETS).map(([id, p]) => `<option value="${id}">${p.name}</option>`).join("")}</select></div>
      <p id="qNote"></p>
      <div class="nums">
        <label class="num"><span class="lbl">Width</span><span class="in"><input type="number" id="qWidth" min="20" max="1000" step="1"><em>km</em></span></label>
        <div class="num"><span class="lbl">Grid</span><p class="hint" id="qSizeNote"></p></div>
      </div>
      <details class="more"><summary>About this model</summary><p id="qAbout"></p></details>
    </div>
    <div class="pane">
      <div class="field"><span class="lbl">Click on the picture to</span><div class="segmented" id="qTool"><button type="button" data-tool="fault">Draw a fault</button><button type="button" data-tool="blast">Explode</button><button type="button" data-tool="draw">Add rock</button><button type="button" data-tool="dig">Dig</button></div></div>
      <div class="stack" id="qDrawRow" hidden>
        <div class="field"><span class="lbl">Rock</span><select id="qRock">${GROUPS.map((g) => `<optgroup label="${g}">${ROCKS.filter(([, r]) => r.group === g).map(([id, r]) => `<option value="${id}">${r.name}</option>`).join("")}</optgroup>`).join("")}<optgroup label="Your own"><option value="custom">Custom rock…</option></optgroup></select></div>
        <div class="stack" id="qCustom" hidden>
          <label class="slider"><span class="lbl">P speed</span><output id="qCvpOut"></output><input type="range" id="qCvp" min="1.5" max="${VMAX}" step="0.1" value="4.5"></label>
          <label class="slider"><span class="lbl">S speed</span><output id="qCvsOut"></output><input type="range" id="qCvs" min="0" max="4.5" step="0.05" value="2.5"></label>
          <label class="slider"><span class="lbl">Density</span><output id="qCrhoOut"></output><input type="range" id="qCrho" min="0.9" max="3.5" step="0.05" value="2.5"></label>
        </div>
        <p class="hint" id="qRockInfo"></p>
      </div>
      <label class="slider" id="qBrushRow" hidden><span class="lbl">Brush</span><output id="qBrushOut"></output><input type="range" id="qBrush" min="0.5" max="6" step="0.5" value="1"></label>
      <div class="row3"><button type="button" class="btn" id="qUndo" title="Undo (⌘Z)" disabled>Undo</button><button type="button" class="btn" id="qRedo" title="Redo (⇧⌘Z)" disabled>Redo</button><button type="button" class="btn" id="qReset" title="Put the model back as it was">Reset</button></div>
    </div>
    <div class="pane" id="qFaultPane">
      <span class="lbl">Fault</span>
      <p class="hint" id="qFaultInfo"></p>
      <button type="button" class="btn" id="qAddFault" hidden>Add the model's fault</button>
      <div class="stack" id="qFaultControls">
        <button type="button" class="btn wide go" id="qRupture">Start the quake</button>
        <label class="slider"><span class="lbl">Magnitude</span><output id="qMagOut"></output><input type="range" id="qMag" min="4" max="9.5" step="0.1" value="6"></label>
        <div class="nums">
          <label class="num"><span class="lbl">Length</span><span class="in"><input type="number" id="qLen" min="0.5" step="1"><em>km</em></span></label>
          <label class="num"><span class="lbl">Dip</span><span class="in"><input type="number" id="qDip" min="1" max="89" step="1"><em>°</em></span></label>
          <label class="num"><span class="lbl">Top depth</span><span class="in"><input type="number" id="qTop" step="0.5"><em>km</em></span></label>
          <label class="num"><span class="lbl">Top at</span><span class="in"><input type="number" id="qPos" step="1"><em>km</em></span></label>
        </div>
        <div class="row"><div class="segmented" id="qToward"><button type="button" data-toward="-1" title="Dips toward the left">Dips ←</button><button type="button" data-toward="1" title="Dips toward the right">Dips →</button></div><button type="button" class="btn small" id="qFit" title="Make the fault as long as this magnitude ruptures">Fit to M</button></div>
        <div class="field"><span class="lbl">Slip</span><div class="segmented" id="qSlip"><button type="button" data-slip="normal">Normal</button><button type="button" data-slip="reverse">Reverse (thrust)</button></div></div>
        <label class="slider"><span class="lbl">Rupture starts</span><output id="qStartOut"></output><input type="range" id="qStart" min="0" max="1" step="0.01" value="0.5"></label>
        <label class="slider"><span class="lbl">Rupture speed</span><output id="qVrOut"></output><input type="range" id="qVr" min="0.5" max="0.95" step="0.05" value="0.8"></label>
        <p class="hint" id="qSrcNote"></p>
        <button type="button" class="btn" id="qDelete">Delete fault</button>
        <details class="more"><summary>About faults</summary>
          <p>Normal: the rock above the fault slides down, as where the crust is pulled apart. Reverse (thrust): it is pushed up, as where plates collide. The rupture runs from its start both ways, as far down the dip as the magnitude reaches (Wells and Coppersmith, 1994; Strasser et al., 2010, for megathrusts), and each step of 1 in magnitude releases about 32 times more energy.</p>
          <p>A slice shows faults that slip up or down their dip. Strike-slip faults, like the San Andreas, slip across the slice, so a slice cannot show them.</p>
        </details>
      </div>
    </div>
    <div class="pane" id="qBlastPane" hidden>
      <div class="field"><span class="lbl">Explosion</span><select id="qBlast">${BLASTS.map((b) => `<option value="${b.id}">${b.name}</option>`).join("")}</select></div>
      <p class="hint" id="qBlastNote"></p>
      <details class="more"><summary>About explosions</summary><p>An explosion pushes out equally in all directions, so it makes mostly P waves and little S, and the first motion is up everywhere: that is how seismologists tell nuclear tests from earthquakes. Body-wave magnitude 4.45 + 0.75 log₁₀(yield in kt).</p></details>
    </div>
    <div class="pane">
      <div class="field"><span class="lbl">Seismometers</span><div class="segmented" id="qCount">${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-count="${n}">${n}</button>`).join("")}</div></div>
      <div class="stlist" id="qStations"></div>
      <div class="field"><span class="lbl">Record</span><div class="segmented" id="qMeasure">${Object.entries(MEASURES).map(([id, [name]]) => `<button type="button" data-measure="${id}">${name}</button>`).join("")}</div></div>
      <div class="field"><span class="lbl">Direction</span><div class="segmented" id="qComp"><button type="button" data-comp="z">Up and down</button><button type="button" data-comp="h">Sideways</button></div></div>
      <details class="more"><summary>Filter and spectra</summary><div class="stack">
        <div class="field"><span class="lbl">Show records as</span><div class="segmented" id="qLook"><button type="button" data-look="trace">Traces</button><button type="button" data-look="spec">Spectra</button><button type="button" data-look="sgram">Spectrogram</button></div></div>
        <div class="field"><span class="lbl">Filter</span><select id="qFilter">${FILTERS.map((f) => `<option value="${f[0]}">${filterName(f)}</option>`).join("")}</select></div>
        <div class="stack" id="qBand" hidden>
          <label class="slider"><span class="lbl">High-pass</span><output id="qLoOut"></output><input type="range" id="qLo" min="-1.3" max="1" step="0.01" value="-0.3"></label>
          <label class="slider"><span class="lbl">Low-pass</span><output id="qHiOut"></output><input type="range" id="qHi" min="-1.3" max="1" step="0.01" value="0.3"></label>
        </div>
        <div class="toggles"><label><input type="checkbox" id="qZero">Zero phase</label></div>
        <div class="field"><span class="lbl">Scale</span><div class="segmented" id="qScale"><button type="button" data-scale="fit">Each to fit</button><button type="button" data-scale="true">True size</button></div></div>
        <p class="hint">4-pole Butterworth, causal unless zero phase. Above <span id="qFgrid">${hz(F_GRID)}</span> Hz the grid is too coarse. Downloads are not filtered.</p>
      </div></details>
      <div class="row"><button type="button" class="btn" id="qDownload">Download</button><button type="button" class="btn" id="qShare">Copy link</button></div>
      <p class="hint">SAC (nm/s) and CSV (m/s), noise included. The link reopens this exact setup.</p>
      <div class="toggles"><label><input type="checkbox" id="qShareStart" checked>Link starts the quake</label></div>
      <input type="text" class="mono" id="qShareLink" readonly hidden aria-label="Link to this setup" style="width:100%;font-size:10px">
    </div>
    <div class="pane">
      <div class="field"><span class="lbl">Show</span><div class="segmented" id="qMode"><button type="button" data-mode="0">Waves</button><button type="button" data-mode="1">Shaking</button><button type="button" data-mode="2">Particles</button></div></div>
      <label class="slider"><span class="lbl">Speed</span><output id="qSpeedOut"></output><input type="range" id="qSpeed" min="1" max="24" step="1" value="7"></label>
      <label class="slider"><span class="lbl">Brightness</span><output id="qGlowOut"></output><input type="range" id="qGlow" min="-2" max="2" step="0.1" value="0"></label>
      <div class="row"><button type="button" class="btn" id="qPlay">Pause</button><button type="button" class="btn" id="qReplay">Replay</button></div>
      <div class="toggles"><label><input type="checkbox" id="qLabels" checked>Labels</label></div>
    </div>
    <div class="pane">
      <div class="field"><span class="lbl">Noise sources</span><div class="segmented" id="qAdd">${Object.entries(KINDS).map(([id, k]) => `<button type="button" data-add="${id}">${k.name.split(" ")[0]}</button>`).join("")}</div></div>
      <div class="stlist" id="qSources"></div>
      <p class="hint" id="qSrcHelp">Simulated with the quake; drag one along the surface.</p>
    </div>
    <div class="pane">
      <details class="more"><summary>What you see</summary>
      <ul class="key" style="margin-top:10px">
        <li><i class="swatch sw-p"></i><div><b>P wave</b><span>Squeezes (rust) and stretches (ochre). Fastest; crosses rock, water and magma.</span></div></li>
        <li><i class="swatch sw-s"></i><div><b>S wave</b><span>Shakes sideways, about 0.6 × the P speed; solids only.</span></div></li>
        <li><i class="swatch sw-r"></i><div><b>Rayleigh wave</b><span>Rolls along the surface (R); slowest, often strongest.</span></div></li>
        <li><i class="swatch sw-l"></i><div><b>Love wave</b><span>Shakes across the slice, so a slice cannot show it.</span></div></li>
      </ul>
      <p>S − P tells the distance: about ${KM_PER_S} km per second. P↑ / P↓: the ground first moved up (pushed) or down (pulled).</p>
      </details>
    </div>`;

  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const pic = $("qPic"), gpuCanvas = pic.querySelector<HTMLCanvasElement>(".gpu")!, over = pic.querySelector<HTMLCanvasElement>(".over")!;
  const seis = $<HTMLCanvasElement>("qSeis"), under = $("qUnder"), readout = $("qRead");
  $("qRamp").style.background = `linear-gradient(90deg, ${["soil", "sediment", "rock", "hard", "mantle"].map((r) => rockCss(ROCK[r as keyof typeof ROCK])).join(", ")})`;

  let sim: Sim | null = null;
  let presetId = "subduction", preset: Preset = PRESETS[presetId];
  setScale(preset.width / (W * 0.08)); scaled();
  let ground = build(preset);
  let sources: { kind: KindId; x: number; level: number; j: number }[] = [];
  let tool: Tool = "fault", mode = 0, kind: "quake" | "blast" = "quake", speed = 7, glow = 1, brush = 1, labels = true, playing = true;
  let rockId = "granite";
  const custom: Rock = { name: "Custom rock", vp: 4.5, vs: 2.5, rho: 2.5 };
  let blast = BLASTS[3];
  let measure: Measure = "vel", comp: "z" | "h" = "z", trueSize = false;
  let look: Look = "trace", band = { lo: 0, hi: 0 }, zeroPhase = false;
  let quakeAt: [number, number] = [0, 0];
  let stationsX: number[] = [];
  const noise = [0, 0, 0, 0, 0];
  const noiseUnit = NAMES.map((_, s) => [noiseTrace(101 + 7 * s, MAX_S * SPS + 1), noiseTrace(907 + 13 * s, MAX_S * SPS + 1)]);
  const top = new Int32Array(W);                       // first ground row of each column on screen
  let arr: { p: number[]; s: number[]; r: number[] } | null = null;
  let dirty: [number, number] | null = null;
  let pointer: { x: number; y: number } | null = null;
  let drag: { station: number } | { source: number } | { last: [number, number] } | { from: [number, number]; to: [number, number]; on: { fault: Fault; at: number } | null } | { start: Fault } | null = null;
  /** A fault, in grid cells (i, j) from end to end, and how it slips: its magnitude, where along it the rupture
   *  starts (0 at end a, 1 at end b), how fast the rupture runs (times the S speed) and which way it slips. */
  interface Fault { a: [number, number]; b: [number, number]; magnitude: number; start: number; speed: number; slip: "normal" | "reverse" }
  const faults: Fault[] = [];
  let chosen: Fault | null = null;
  let hasSource = false;                           // has a quake or explosion started on this ground yet?
  let minEnd = AXIS_S, ended = false;              // the earliest end of this recording (s after the quake); is it over?
  let rupture: { fault: Fault; at: number; s0: number; s1: number; parts: number; times: Float32Array } | null = null;   // along the fault, in cells
  let box = { L: PAD.l, T: PAD.t, iw: 1, ih: 1 };

  /** m/s per simulation unit for this quake. K holds for the 61 km slice. A slice s times bigger solves the same
   *  equations with lengths and times s times larger: its records come out s times larger, sqrt(20 km / r) gives
   *  s^-1/2, and a real source of the same moment shakes s^-3 times less at s times the distance, more where its
   *  spectrum is richer at the lower frequency (Brune): together K s^-3.5 brune5(F0) / brune5(1.1). */
  const amp = () => K * size(sourceMagnitude(), F0) * SCALE ** -3.5 * brune5(F0) / brune5(1.1);
  const sourceMagnitude = () => kind === "quake" ? (rupture?.fault ?? chosen)?.magnitude ?? 6 : blastMagnitude(blast.kt);
  const findSurface = () => {
    for (let x = 0; x < W; x++) {
      let j = 0;
      while (j < VH - 1 && ground.vp[j * NX + x + SPONGE] <= 0) j++;
      top[x] = j;
    }
  };
  const stationCells = () => stationsX.map((x) => top[x] * NX + x + SPONGE);
  const distance = (s: number) => Math.hypot(stationsX[s] + SPONGE - quakeAt[0], top[stationsX[s]] - quakeAt[1]) * H;
  const epicentral = (s: number) => Math.abs(stationsX[s] + SPONGE - quakeAt[0]) * H;
  const brushRock = (): Rock => tool === "dig" ? ROCK.air : rockId === "custom" ? custom : (ROCK as Record<string, Rock>)[rockId];

  /** Rayleigh arrival: along the surface at 0.92 × the S speed of the top 1.5 km, from the epicentre. */
  function rayleigh(): number[] {
    const ex = Math.min(W - 1, Math.max(0, quakeAt[0] - SPONGE));
    return stationsX.map((sx) => {
      let t = 0;
      for (let x = Math.min(ex, sx); x < Math.max(ex, sx); x++) {
        let sum = 0, n = 0;
        for (let j = top[x]; j < Math.min(VH, top[x] + 40) && n < 19; j++) { const v = ground.vs[j * NX + x + SPONGE]; if (v > 0) { sum += v; n++; } }
        t += H / (0.92 * (n ? sum / n : 3));
      }
      return t;
    });
  }

  function startQuake(i: number, j: number) {
    if (!sim) return;
    if ((j - SKY) * H > 2) { j = SKY + Math.round(2 / H); log("Explosions are set off near the surface, so this one is 2 km deep"); }
    quakeAt = [i, j];
    rupture = null; kind = "blast"; hasSource = true;
    sim.quake(i, j, [1, 1, 0]);
    planEnd(0);
    setPlaying(true);
    arr = null;
    const from = j * NX + i, cells = stationCells();
    setTimeout(() => { arr = { p: arrivals(NX, NZ, H, ground.vp, from, cells), s: arrivals(NX, NZ, H, ground.vs, from, cells), r: rayleigh() }; }, 0);
    log(`${blast.name}, ${Math.max(0, (j - SKY) * H).toFixed(1)} km deep (about magnitude ${blastMagnitude(blast.kt).toFixed(1)})`);
  }
  const replay = () => kind === "blast" ? startQuake(quakeAt[0], quakeAt[1]) : chosen ? slip(chosen) : listen();
  /** No quake yet: if there are noise sources, record them alone (a quiet day, for their spectra). */
  function listen() {
    if (!sim || !sources.length) return;
    sim.still(); arr = null; minEnd = NOISE_S; ended = false; setPlaying(true);
    log(`Recording ${NOISE_S} s of the noise sources alone. Draw a fault to add a quake.`);
  }
  /** The ground still again (a new fault, before it is set off): the old quake's waves and records go. */
  function hush() {
    if (!sim) return;
    rupture = null; hasSource = false; kind = "quake"; arr = null;
    sim.still(); setPlaying(false);
  }
  /** The earliest end of a quake's recording: the rupture's time, then the slowest wave from the source to the far
   *  edge of the slice (surface waves at 0.92 × the slowest S speed near the surface, or sound in water), plus 3 s. */
  function planEnd(duration: number) {
    let slow = Infinity;
    for (let x = 0; x < W; x++) for (let j = top[x]; j < Math.min(VH, top[x] + 19); j++) {
      const k = j * NX + x + SPONGE, vs = ground.vs[k], vp = ground.vp[k];
      if (vp > 0) slow = Math.min(slow, vs > 0 ? 0.92 * vs : vp);
    }
    const qx = quakeAt[0] - SPONGE, far = (Math.max(qx, W - qx) + Math.max(0, quakeAt[1] - SKY)) * H;
    minEnd = Math.min(MAX_S, duration + far / (Number.isFinite(slow) ? slow : 1.5) + 3 * SCALE);
    ended = false;
  }
  /** Has every seismometer been quiet for the last TAIL_S seconds of the quake's record? */
  function quiet(n: number) {
    const tail = TAIL_S * SPS;
    if (n <= tail) return false;
    // each station against its own peak, up and down and sideways together (a direction that hardly moves would
    // otherwise keep the recording going for nothing)
    for (let st = 0; st < stationsX.length; st++) {
      let peak = 0, last = 0;
      for (const v of sig[st]) for (let k = 0; k < n; k++) { const a = Math.abs(v[k]); peak = Math.max(peak, a); if (k >= n - tail) last = Math.max(last, a); }
      if (peak > 0 && last > QUIET * peak) return false;
    }
    return true;
  }

  // ---------------------------------------------------------------- faults
  const faultLength = (f: Fault) => Math.hypot(f.b[0] - f.a[0], f.b[1] - f.a[1]);
  /** The fault under a cell (within about 1 km), and how far along it (cells from end a). */
  function faultAt(i: number, j: number) {
    let best: { fault: Fault; at: number } | null = null, gap = 13;
    for (const f of faults) {
      const len = faultLength(f), tx = (f.b[0] - f.a[0]) / len, tz = (f.b[1] - f.a[1]) / len;
      const at = Math.min(len, Math.max(0, (i - f.a[0]) * tx + (j - f.a[1]) * tz));
      const d = Math.hypot(f.a[0] + tx * at - i, f.a[1] + tz * at - j);
      if (d < gap) { gap = d; best = { fault: f, at }; }
    }
    return best;
  }
  /** Down the fault (unit vector, z down) and the normal pointing up into the block above it (the hanging wall). */
  function frame(f: Fault) {
    const len = faultLength(f), tx = (f.b[0] - f.a[0]) / len, tz = (f.b[1] - f.a[1]) / len;
    const down = tz >= 0 ? [tx, tz] : [-tx, -tz], up = down[0] >= 0 ? [down[1], -down[0]] : [-down[1], down[0]];
    return { len, tx, tz, down, up, dip: Math.round((Math.atan2(Math.abs(tz), Math.abs(tx)) * 180) / Math.PI) };
  }
  /** A new fault drawn from a to b: its magnitude ruptures about its whole length; it starts near its deep end. */
  function newFault(a: [number, number], b: [number, number]): Fault {
    const km = Math.hypot(b[0] - a[0], b[1] - a[1]) * H;
    const dip = (Math.atan2(Math.abs(b[1] - a[1]), Math.abs(b[0] - a[0]) || 1e-9) * 180) / Math.PI;
    const magnitude = Math.round(Math.min(9.5, Math.max(4, magnitudeFor(km, "normal", dip))) * 10) / 10;
    return { a, b, magnitude, start: b[1] > a[1] ? 0.85 : 0.15, speed: 0.8, slip: "normal" };
  }
  /** Rupture the fault: it starts at its start point and runs both ways at its speed (times the local S speed), as
   *  far as its magnitude reaches (Wells and Coppersmith), each part slipping as the rupture front reaches it. */
  function slip(f: Fault) {
    if (!sim) return;
    const { len, tx, tz, down, up, dip } = frame(f), at = f.start * len;
    // as far as its magnitude reaches, half each way; near an end it runs the other way instead (one-sided)
    const want = Math.min(len, ruptureKm(f.magnitude, f.slip, dip) / H);
    const s0 = Math.min(Math.max(0, at - want / 2), len - want), s1 = s0 + want;
    // when the rupture front reaches each point along the fault (s, in whole cells from end a)
    const times = new Float32Array(Math.ceil(len) + 1).fill(NaN);
    const vsAt = (s: number) => { const k = Math.round(f.a[1] + tz * s) * NX + Math.round(f.a[0] + tx * s); return ground.vs[k] > 0 ? ground.vs[k] : 3; };
    times[Math.round(at)] = 0;
    for (const dir of [1, -1]) for (let s = Math.round(at) + dir, t = 0; s >= 0 && s < times.length; s += dir) { t += H / (f.speed * vsAt(s)); times[s] = t; }
    const sign = f.slip === "normal" ? 1 : -1, sl = [sign * down[0], sign * down[1]];
    const m: [number, number, number] = [2 * sl[0] * up[0], 2 * sl[1] * up[1], sl[0] * up[1] + sl[1] * up[0]];
    const count = Math.min(64, Math.max(1, Math.round((s1 - s0) / 3) + 1));
    const parts = Array.from({ length: count }, (_, q) => {
      const s = count === 1 ? at : s0 + ((s1 - s0) * q) / (count - 1);
      return { i: Math.round(f.a[0] + tx * s), j: Math.round(f.a[1] + tz * s), delay: times[Math.round(s)] || 0, m, share: 0 };
    }).filter((q) => q.i > 2 && q.j > 2 && q.i < NX - 3 && q.j < NZ - 3 && ground.vs[q.j * NX + q.i] > 0);
    if (!parts.length) { log("That part of the fault is not in solid rock"); return; }
    parts.forEach((q) => { q.share = 1 / parts.length; });
    kind = "quake"; chosen = f; hasSource = true;
    quakeAt = [Math.round(f.a[0] + tx * at), Math.round(f.a[1] + tz * at)];
    rupture = { fault: f, at, s0, s1, parts: parts.length, times };
    sim.rupture(parts);
    planEnd(Math.max(times[Math.round(s0)] || 0, times[Math.round(s1)] || 0));
    setPlaying(true);
    arr = null;
    const from = quakeAt[1] * NX + quakeAt[0], cells = stationCells();
    setTimeout(() => { arr = { p: arrivals(NX, NZ, H, ground.vp, from, cells), s: arrivals(NX, NZ, H, ground.vs, from, cells), r: rayleigh() }; }, 0);
    const duration = Math.max(times[Math.round(s0)] || 0, times[Math.round(s1)] || 0);
    log(`Magnitude ${f.magnitude.toFixed(1)} ${f.slip} fault dipping ${dip}°: ${((s1 - s0) * H).toFixed(1)} km ruptures in ${duration.toFixed(1)} s, starting ${((quakeAt[1] - SKY) * H).toFixed(1)} km deep`);
    showFault();
  }

  function placeStations(n: number, at?: number[]) {
    // evenly spread across the slice, each in the middle of its own share of it (or where a scenario put them)
    stationsX = at ? at.slice(0, NAMES.length).map((x) => Math.min(W - 3, Math.max(2, Math.round(x)))) : Array.from({ length: n }, (_, s) => ((s + 0.5) * WIDTH_KM) / n)
      .map((km) => Math.min(W - 3, Math.max(2, Math.round(km / H))));
    n = stationsX.length;
    segmented($("qCount"), "count", String(n));
    $("qStations").innerHTML = stationsX.map((_, s) => `<div class="strow"><b>${NAMES[s]}</b><span class="mono" data-dist="${s}"></span>
      <select data-noise="${s}" aria-label="Added noise at ${NAMES[s]}">${NOISE.map(([v, name]) => `<option value="${v}"${v === noise[s] ? " selected" : ""}>${name}</option>`).join("")}</select></div>`).join("");
    sim?.setStations(stationCells());
  }

  // ---------------------------------------------------------------- undo, redo and reset for drawing
  /** One stroke: the cells it changed, with their rock before and after (P speed, S speed, density). */
  interface Stroke { cells: Int32Array; before: Float32Array; after: Float32Array; j0: number; j1: number }
  type Item = Stroke | { fault: Fault; added: boolean };
  const done: Item[] = [], undone: Item[] = [];
  let snapshot: [Float32Array, Float32Array, Float32Array] | null = null;
  const showHistory = () => { ($("qUndo") as HTMLButtonElement).disabled = !done.length; ($("qRedo") as HTMLButtonElement).disabled = !undone.length; };
  function endStroke() {
    if (!snapshot) return;
    const [vp0, vs0, rho0] = snapshot, changed: number[] = [];
    snapshot = null;
    for (let k = 0; k < vp0.length; k++) if (vp0[k] !== ground.vp[k] || vs0[k] !== ground.vs[k] || rho0[k] !== ground.rho[k]) changed.push(k);
    if (!changed.length) return;
    const n = changed.length, before = new Float32Array(3 * n), after = new Float32Array(3 * n);
    changed.forEach((k, m) => {
      before[3 * m] = vp0[k]; before[3 * m + 1] = vs0[k]; before[3 * m + 2] = rho0[k];
      after[3 * m] = ground.vp[k]; after[3 * m + 1] = ground.vs[k]; after[3 * m + 2] = ground.rho[k];
    });
    done.push({ cells: Int32Array.from(changed), before, after, j0: Math.floor(changed[0] / NX), j1: Math.floor(changed[n - 1] / NX) });
    if (done.length > 50) done.shift();
    undone.length = 0;
    showHistory();
  }
  function step(from: Item[], to: Item[], which: "before" | "after", word: string) {
    const st = from.pop();
    if (!st) return;
    if ("fault" in st) {
      // undoing an added fault, or redoing a deleted one, takes it away; the other two put it back
      if ((which === "before") === st.added) { faults.splice(faults.indexOf(st.fault), 1); if (chosen === st.fault) chosen = faults.at(-1) ?? null; }
      else { faults.push(st.fault); chosen = st.fault; }
      to.push(st); showHistory(); showFault(); log(`${word}: a fault`);
      return;
    }
    const v = st[which];
    st.cells.forEach((k, m) => { ground.vp[k] = v[3 * m]; ground.vs[k] = v[3 * m + 1]; ground.rho[k] = v[3 * m + 2]; });
    dirty = dirty ? [Math.min(dirty[0], st.j0), Math.max(dirty[1], st.j1)] : [st.j0, st.j1];
    to.push(st);
    showHistory();
    log(word);
  }
  const undo = () => step(done, undone, "before", "Undone");
  const redo = () => step(undone, done, "after", "Redone");

  function loadPreset(id: string) {
    done.length = 0; undone.length = 0; showHistory();
    presetId = id;
    preset = PRESETS[id];
    // no faults at first: the ground is quiet until one is drawn
    faults.length = 0;
    chosen = null; rupture = null; kind = "quake"; hasSource = false;
    ground = build(preset);
    $<HTMLSelectElement>("qPreset").value = id;
    $("qNote").textContent = preset.note; $("qAbout").textContent = preset.about;
    if (preset.fault) addKnownFault();
    if (!sim) return;
    sim.setGround(ground.vp, ground.vs, ground.rho, colour);
    findSurface();
    placeStations(stationsX.length || 3);
    // the noise sources go where this ground has a coast, a road or a factory
    for (const q of sources) { const km = preset.noise?.[q.kind]; if (km !== undefined) q.x = Math.min(W - 3, Math.max(2, Math.round(km / H))); }
    applyNoise();
    sim.still(); arr = null; setPlaying(false); showFault();
    log(preset.fault ? "Press Start the quake, or draw your own fault" : "Draw a fault on the picture, or choose Explode");
    if (sources.length) listen();
  }

  // ---------------------------------------------------------------- noise sources
  /** Give the engine the noise sources (their waves start again and spread for WARM_S seconds first). */
  function applyNoise() {
    for (const q of sources) q.j = top[q.x];
    $("qSources").innerHTML = sources.map((q, s) => `<div class="srcrow"><i style="background:${SOURCE_COLOUR[q.kind]}"></i><b>${KINDS[q.kind].name}</b><span class="mono">${(q.x * H).toFixed(1)} km</span>
      <button type="button" class="close" data-remove="${s}" aria-label="Remove ${KINDS[q.kind].name}">×</button>
      <select data-level="${s}" aria-label="Level of ${KINDS[q.kind].name}">${LEVELS.map(([v, name]) => `<option value="${v}"${v === q.level ? " selected" : ""}>${name}</option>`).join("")}</select></div>`).join("");
    $("qAdd").querySelectorAll("button").forEach((b) => { b.disabled = sources.length >= MAX_SOURCES || SCALE > 2; });
    if (!sim) return;
    sim.setNoise(sources.map((q) => source(q.kind, q.x + SPONGE, q.j, q.level, sim!.dt)), Math.ceil(WARM_S / sim.dt));
  }
  function addSource(kind: KindId) {
    if (sources.length >= MAX_SOURCES || SCALE > 2) return;
    const km = preset.noise?.[kind] ?? SOURCE_AT[kind];
    sources.push({ kind, x: Math.min(W - 3, Math.max(2, Math.round(km / H))), level: LEVELS[1][0], j: 0 });
    log(`${KINDS[kind].name}: ${KINDS[kind].note}`);
    applyNoise(); replay();
  }

  function paint(i: number, j: number) {
    const rock = brushRock(), r = brush / H;
    const j0 = Math.max(0, Math.floor(j - r)), j1 = Math.min(NZ - 1, Math.ceil(j + r));
    for (let y = j0; y <= j1; y++) for (let x = Math.max(0, Math.floor(i - r)); x <= Math.min(NX - 1, Math.ceil(i + r)); x++) {
      if ((x - i) ** 2 + (y - j) ** 2 > r * r) continue;
      const k = y * NX + x;
      ground.vp[k] = rock.vp; ground.vs[k] = rock.vs; ground.rho[k] = rock.rho;
    }
    dirty = dirty ? [Math.min(dirty[0], j0), Math.max(dirty[1], j1)] : [j0, j1];
  }

  function setPlaying(on: boolean) { playing = on; $("qPlay").textContent = on ? "Pause" : "Play"; }

  // ---------------------------------------------------------------- seismometer records in real units
  const MAXN = MAX_S * SPS + 1;
  const sig = NAMES.map(() => [new Float32Array(MAXN), new Float32Array(MAXN)]);    // m/s, signal only: [sideways, up]
  const heard = NAMES.map(() => [new Float32Array(MAXN), new Float32Array(MAXN)]);  // m/s, the noise sources' waves
  // From 2D to 3D. The slice's sources are lines, and a line source's waves are a point source's integrated by half
  // an order (45 degrees late, with a long tail), with amplitudes falling as 1 / sqrt(r) for body waves (1 / r in 3D)
  // and not at all for surface waves (1 / sqrt(r) in 3D). So each record is half-differentiated (Grunwald-Letnikov,
  // causal; gain 1 at F0, so the calibration K still holds) and scaled by sqrt(REF_KM / r). Checked against exact 2D
  // and 3D waves in validation/threed.py.
  const HALF = new Float64Array(MAXN); HALF[0] = 1; for (let k = 1; k < MAXN; k++) HALF[k] = HALF[k - 1] * (1 - 1.5 / k);
  const HALF_GAIN = Math.sqrt(SPS / (2 * Math.PI * F0));   // peaks at 20 km move by under 5 % (measured)
  const flat = NAMES.map(() => [new Float32Array(MAXN), new Float32Array(MAXN)]);   // the 2D records at SPS (simulation units)
  const half = NAMES.map(() => [new Float32Array(MAXN), new Float32Array(MAXN)]);   // and their half-derivatives
  const halfDone = NAMES.map(() => [0, 0]);
  /** The half-derivative of flat[s][c] up to n samples, recomputing only from the first sample that changed. */
  function halfDerivative(s: number, c: number, n: number, fresh: Float32Array) {
    const x = flat[s][c], y = half[s][c];
    let from = Math.min(halfDone[s][c], n);
    for (let k = 0; k < from; k++) if (x[k] !== fresh[k]) { from = k; break; }
    x.set(fresh.subarray(from, n), from);
    for (let k = from; k < n; k++) {
      let acc = 0;
      for (let m = 0; m <= k; m++) acc += HALF[m] * x[k - m];
      y[k] = HALF_GAIN * acc;
    }
    halfDone[s][c] = n;
  }
  const fresh = new Float32Array(MAXN);
  /** Resample the records to 100 samples per second in m/s, with the 2D-to-3D conversion; returns the count. */
  function readRecords() {
    if (!sim || sim.recorded < 3) return 0;
    const { records, noiseRecords, nst, dt, t0 } = sim, scale = amp(), loud = sources.length > 0;
    const n = Math.max(0, Math.min(MAXN, Math.floor(((sim.recorded - 2) * dt - t0) * SPS) + 1));
    for (let s = 0; s < nst; s++) {
      const g = scale * Math.sqrt(REF_KM / Math.max(1, distance(s)));
      for (const c of [0, 1]) {
        for (let k = 0; k < n; k++) {
          const q = (k / SPS + t0) / dt, q0 = Math.floor(q), f = q - q0, a = (q0 * nst + s) * 2 + c, b = a + nst * 2;
          fresh[k] = (c ? -1 : 1) * (records[a] * (1 - f) + records[b] * f);
          heard[s][c][k] = loud ? (c ? -1 : 1) * (noiseRecords[a] * (1 - f) + noiseRecords[b] * f) : 0;
        }
        halfDerivative(s, c, n, fresh);
        const y = half[s][c], out = sig[s][c];
        for (let k = 0; k < n; k++) out[k] = g * y[k];
      }
      // the noise sources push at every step, so they also shake at frequencies the grid cannot carry: keep
      // only what it can (their spectra would otherwise rise past the grid's limit)
      if (loud) for (const c of [0, 1]) heard[s][c].set(bandpass(heard[s][c].subarray(0, n), SPS, 0, F_GRID, true));
    }
    return n;
  }
  /** One recorded trace with the noise sources and the station's added noise, as velocity, then as the chosen measure. */
  function trace(s: number, c: 0 | 1, n: number, as: Measure = "vel", filtered = false) {
    let v = new Float32Array(n);
    const u = noiseUnit[s][c], sv = sig[s][c], hv = heard[s][c], level = noise[s];
    for (let k = 0; k < n; k++) v[k] = sv[k] + hv[k] + level * u[k];
    if (filtered && (band.lo || band.hi)) v = bandpass(v, SPS, band.lo, band.hi, zeroPhase);
    if (as === "vel") return v;
    const out = new Float32Array(n);
    if (as === "disp") { let acc = 0; for (let k = 1; k < n; k++) { acc += (0.5 * (v[k] + v[k - 1])) / SPS; out[k] = acc; } }
    else for (let k = 1; k < n - 1; k++) out[k] = ((v[k + 1] - v[k - 1]) * SPS) / 2;
    return out;
  }
  const pgv = (s: number, n: number) => { let m = 0; for (let k = 0; k < n; k++) m = Math.max(m, Math.abs(sig[s][0][k]), Math.abs(sig[s][1][k])); return m; };

  // ---------------------------------------------------------------- scenarios: share the setup as a link
  let shareLink = "";
  function scenario(start: boolean): Scenario {
    const { rocks, runs } = diffGround(build(preset), ground);
    return {
      v: 1, scale: SCALE, preset: presetId, rocks, runs, start,
      faults: faults.map((f) => ({ a: [...f.a], b: [...f.b], magnitude: f.magnitude, start: f.start, speed: f.speed, slip: f.slip })),
      chosen: chosen ? faults.indexOf(chosen) : -1, kind, blast: blast.id, at: [quakeAt[0], quakeAt[1]],
      stations: [...stationsX], noise: stationsX.map((_, s) => noise[s]), sources: sources.map((q) => [q.kind, q.x, q.level]),
    };
  }
  async function share() {
    const code = await encode(scenario($<HTMLInputElement>("qShareStart").checked && hasSource));
    shareLink = linkFor(code);
    const box = $<HTMLInputElement>("qShareLink");
    box.value = shareLink; box.hidden = false; box.select();
    try { await navigator.clipboard.writeText(shareLink); log(`Link copied (${shareLink.length} characters): it opens this setup${hasSource && $<HTMLInputElement>("qShareStart").checked ? " and starts the quake" : ""}`); }
    catch { log("Copy the link from the box under the button"); }
  }
  /** Open a shared setup: its ground, faults, explosion, seismometers and noise; start the quake if it says so. */
  function open(sc: Scenario) {
    if (!sim || !PRESETS[sc.preset]) { log("That link's setup could not be read"); return; }
    presetId = sc.preset;
    setSize(sc.scale ?? 1, false);
    faults.length = 0; chosen = null;
    applyGround(ground, sc.rocks, sc.runs);
    sim.setGround(ground.vp, ground.vs, ground.rho, colour);
    findSurface();
    sc.noise.forEach((v, s) => { noise[s] = v; });
    placeStations(sc.stations.length, sc.stations);
    sources = sc.sources.filter(([k]) => k in KINDS).slice(0, MAX_SOURCES).map(([k, x, level]) => ({ kind: k as KindId, x, level, j: 0 }));
    applyNoise();
    faults.push(...sc.faults.map((f) => ({ ...f, a: [...f.a] as [number, number], b: [...f.b] as [number, number] })));
    chosen = faults[sc.chosen] ?? faults.at(-1) ?? null;
    blast = BLASTS.find((b) => b.id === sc.blast) ?? blast;
    $<HTMLSelectElement>("qBlast").value = blast.id; showBlast();
    kind = sc.kind; quakeAt = sc.at;
    showFault();
    if (sc.start && kind === "blast") startQuake(sc.at[0], sc.at[1]);
    else if (sc.start && chosen) slip(chosen);
    else if (sources.length) listen();
    log(`Opened a shared setup on ${preset.name}${sc.start ? "" : ": press Start the quake, or set off an explosion"}`);
  }

  function download() {
    if (!sim) return;
    const n = readRecords();
    if (n < 2) { log("Nothing recorded yet"); return; }
    const m = sourceMagnitude(), depth = Math.max(0, (quakeAt[1] - SKY) * H);
    const name = kind === "quake" ? `Playground M${m.toFixed(1)}` : `Playground ${blast.name.split(" · ")[1]} blast`;
    const q = { name, magnitude: m, depth, delta: 1 / SPS, origin: new Date() };
    const bc = SPS >= 80 ? "HH" : "BH";                // SEED band code: high (80 samples per second and up) or broad band
    const traces: Trace[] = stationsX.flatMap((_, s) => ([[`${bc}Z`, 0, 0, 1], [`${bc}E`, 90, 90, 0]] as const).map(([channel, azimuth, incidence, c]) => ({
      station: NAMES[s], channel, azimuth, incidence, velocity: trace(s, c, n), distance: epicentral(s), p: arr?.p[s], s: arr?.s[s],
    })));
    const readme = [
      "Earthquake Playground synthetic seismograms", "",
      `Source: ${kind === "quake" && rupture ? `earthquake, magnitude ${m.toFixed(1)}: a ${rupture.fault.slip} fault dipping ${frame(rupture.fault).dip}°, rupturing ${((rupture.s1 - rupture.s0) * H).toFixed(1)} km at ${rupture.fault.speed.toFixed(2)} x the S speed (double couples along the fault), starting` : `${blast.name} (explosion), about magnitude ${m.toFixed(1)}`}, ${depth.toFixed(1)} km deep, ${((quakeAt[0] - SPONGE) * H).toFixed(2)} km along the slice.`,
      `Ground: ${preset.name}. Stations on the surface at ${stationsX.map((x, s) => `${NAMES[s]} ${(x * H).toFixed(2)} km`).join(", ")} along the slice.`,
      `Channels: ${bc}Z up, ${bc}E horizontal along the slice (away from the left edge). ${SPS} samples per second, starting at the origin time.`,
      "SAC files: ground velocity in nm/s (IDEP = IVEL), T0 = P and T1 = S first-arrival times, DIST = epicentral distance (km), EVDP in km.",
      "CSV: ground velocity in m/s.", "",
      `Made by a 2D elastic (P-SV) finite-difference simulation with a ${hz(F0)} Hz Ricker source on a slice ${WIDTH_KM.toFixed(0)} km wide (${(H * 1000).toFixed(0)} m cells).`,
      `Amplitudes scale with magnitude through a Brune spectrum at ${hz(F0)} Hz, calibrated to about 1.5 cm/s at 20 km for magnitude 5 on the 61 km`,
      "slice (bigger slices by the scaling of the elastic equations), converted from 2D toward 3D (half-differentiated, then",
      "amplitude x sqrt(20 km / distance)). Added noise is synthetic (microseism near 0.2 Hz plus local noise) at the level chosen for each station.",
      shareLink ? `The setup, to open again: ${shareLink}` : "",
      sources.length ? `Noise sources, simulated with the quake (random vertical forces on the surface, their waves in m/s, no 3D correction): ${sources.map((q) => `${KINDS[q.kind].name.toLowerCase()} at ${(q.x * H).toFixed(1)} km (${units(q.level, "m/s")} RMS at 1 km)`).join(", ")}.` : "No noise sources.",
    ].join("\n");
    const files = [{ name: "README.txt", data: new TextEncoder().encode(readme + "\n") }, { name: "seismograms.csv", data: csv(traces, q) },
      ...traces.map((t) => ({ name: `EP.${t.station}..${t.channel}.SAC`, data: sac(t, q) }))];
    save(zip(files), `earthquake-playground-${kind === "quake" ? `M${m.toFixed(1)}` : blast.id}-${preset.name.toLowerCase().replace(/\W+/g, "-")}.zip`);
    log(`Downloaded ${traces.length} seismograms (${(n / SPS).toFixed(1)} s each)`);
  }

  // ---------------------------------------------------------------- pointer
  const local = (e: PointerEvent) => { const r = over.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const toCell = (p: { x: number; y: number }) => {
    const x = Math.floor(((p.x - box.L) / box.iw) * W), y = Math.floor(((p.y - box.T) / box.ih) * VH);
    return x < 0 || y < 0 || x >= W || y >= VH ? null : { x, y, i: x + SPONGE, j: y };
  };
  /** Is the pointer on the chosen fault's start (the star)? */
  const startAt = (p: { x: number; y: number }) => {
    if (!chosen) return false;
    const { len, tx, tz } = frame(chosen), s0 = chosen.start * len;
    const px = box.L + ((chosen.a[0] + tx * s0 - SPONGE + 0.5) / W) * box.iw, py = box.T + ((chosen.a[1] + tz * s0 + 0.5) / VH) * box.ih;
    return Math.hypot(p.x - px, p.y - py) < 11;
  };
  const stationAt = (p: { x: number; y: number }) => stationsX.findIndex((x) => {
    const px = box.L + ((x + 0.5) / W) * box.iw, py = box.T + (top[x] / VH) * box.ih;
    return Math.abs(p.x - px) < 10 && p.y > py - 30 && p.y < py + 6;
  });
  const sourceAt = (p: { x: number; y: number }) => sources.findIndex((q) => {
    const px = box.L + ((q.x + 0.5) / W) * box.iw, py = box.T + (top[q.x] / VH) * box.ih;
    return Math.abs(p.x - px) < 10 && p.y > py - 8 && p.y < py + 26;   // the diamond, its waves and its name
  });

  over.addEventListener("pointerdown", (e) => {
    const p = local(e), cell = toCell(p);
    if (!cell || !sim) return;
    const s = stationAt(p);
    if (s >= 0) { drag = { station: s }; over.setPointerCapture(e.pointerId); return; }
    const q = sourceAt(p);
    if (q >= 0) { drag = { source: q }; over.setPointerCapture(e.pointerId); return; }
    if (tool === "blast") {
      if (ground.vp[cell.j * NX + cell.i] <= 0) { log("Click below the ground surface to set off an explosion"); return; }
      startQuake(cell.i, cell.j);
      return;
    }
    if (tool === "fault") {
      // the fault's start (the star) can be dragged along it; a click on the fault moves the start there; a drag
      // anywhere else draws a new fault in place of the old one. None of these starts the quake: the button does.
      if (chosen && startAt(p)) { drag = { start: chosen }; over.setPointerCapture(e.pointerId); return; }
      drag = { from: [cell.i, cell.j], to: [cell.i, cell.j], on: faultAt(cell.i, cell.j) };
      over.setPointerCapture(e.pointerId);
      return;
    }
    drag = { last: [cell.i, cell.j] };
    snapshot = [ground.vp.slice(), ground.vs.slice(), ground.rho.slice()];
    over.setPointerCapture(e.pointerId);
    paint(cell.i, cell.j);
  });
  over.addEventListener("pointermove", (e) => {
    const p = local(e), cell = toCell(p);
    pointer = p;
    if (drag && "station" in drag && cell) {
      stationsX[drag.station] = Math.min(W - 3, Math.max(2, cell.x));
      sim?.setStations(stationCells());
    } else if (drag && "source" in drag && cell) {
      sources[drag.source].x = Math.min(W - 3, Math.max(2, cell.x));
    } else if (drag && "from" in drag && cell) {
      drag.to = [cell.i, cell.j];
    } else if (drag && "start" in drag && cell) {
      const f = drag.start, { len, tx, tz } = frame(f);
      f.start = Math.min(1, Math.max(0, ((cell.i - f.a[0]) * tx + (cell.j - f.a[1]) * tz) / len));
      showFault();
    } else if (drag && "last" in drag && cell) {
      const [i0, j0] = drag.last, steps = Math.max(1, Math.ceil(Math.hypot(cell.i - i0, cell.j - j0) / Math.max(1, brush / H / 2)));
      for (let q = 1; q <= steps; q++) paint(i0 + ((cell.i - i0) * q) / steps, j0 + ((cell.j - j0) * q) / steps);
      drag.last = [cell.i, cell.j];
    }
    over.style.cursor = stationAt(p) >= 0 || sourceAt(p) >= 0 || (drag && ("station" in drag || "source" in drag)) ? "ew-resize" : tool === "fault" && (drag && "start" in drag || (chosen && startAt(p))) ? "grab" : tool === "fault" && cell && faultAt(cell.i, cell.j) ? "pointer" : tool === "fault" || tool === "blast" ? "crosshair" : "none";
    if (!cell) { readout.textContent = "Point at the ground to read it"; return; }
    const k = cell.j * NX + cell.i, rock = rockAt(ground.vp[k], ground.vs[k], ground.rho[k]), d = (cell.y - SKY + 0.5) * H;
    readout.textContent = `${(cell.x * H).toFixed(1)} km across · ${d < 0 ? `${(-d).toFixed(1)} km up` : `${d.toFixed(1)} km deep`} · ${rock.name}` +
      (rock.vp > 0 ? ` · P ${rock.vp.toFixed(1)} km/s · S ${rock.vs > 0 ? `${rock.vs.toFixed(1)} km/s` : "none"} · ${rock.rho.toFixed(2)} g/cm³` : "");
  });
  const release = () => {
    if (drag && "station" in drag) replay();
    if (drag && "source" in drag) { applyNoise(); replay(); }
    // drawing moved the surface under a noise source: put it back on the ground
    if (drag && "last" in drag && sources.some((q) => q.j !== top[q.x])) applyNoise();
    if (drag && "last" in drag) endStroke();
    if (drag && "start" in drag) log(`The rupture will start ${Math.round(drag.start.start * 100)}% along the fault. Press Start the quake.`);
    if (drag && "from" in drag) {
      if (Math.hypot(drag.to[0] - drag.from[0], drag.to[1] - drag.from[1]) * H >= 1) {
        // one fault at a time: the new one takes the old one's place (Undo brings the old one back)
        for (const old of faults.splice(0)) done.push({ fault: old, added: false });
        const f = newFault(drag.from, drag.to);
        faults.push(f); chosen = f; done.push({ fault: f, added: true }); undone.length = 0; showHistory();
        hush();
        showFault();
        log(`A ${(faultLength(f) * H).toFixed(1)} km fault: set its magnitude and where the rupture starts, then press Start the quake.`);
      } else if (drag.on) {
        drag.on.fault.start = drag.on.at / faultLength(drag.on.fault); chosen = drag.on.fault;
        showFault();
        log(`The rupture will start ${Math.round(chosen.start * 100)}% along the fault. Press Start the quake.`);
      } else log("Drag across the ground to draw a fault, or click on the fault to choose where its rupture starts");
    }
    drag = null;
  };
  over.addEventListener("pointerup", release);
  over.addEventListener("pointercancel", release);
  over.addEventListener("pointerleave", () => { pointer = null; });

  // ---------------------------------------------------------------- controls
  const on = (id: string, attr: string, f: (v: string) => void) => {
    const el = $(id);
    el.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>(`[data-${attr}]`);
      if (b) { segmented(el, attr, b.dataset[attr]!); f(b.dataset[attr]!); }
    });
  };
  function showRock() {
    const r = brushRock();
    $("qCustom").hidden = rockId !== "custom";
    $("qRockInfo").textContent = `P ${r.vp.toFixed(1)} km/s · S ${r.vs > 0 ? `${r.vs.toFixed(2)} km/s` : "none (liquid)"} · ${r.rho.toFixed(2)} g/cm³`;
  }
  on("qTool", "tool", (v) => {
    tool = v as Tool;
    $("qDrawRow").hidden = tool !== "draw";
    $("qBrushRow").hidden = tool === "fault" || tool === "blast";
    $("qFaultPane").hidden = tool === "blast"; $("qBlastPane").hidden = tool !== "blast";
    log(tool === "fault" ? "Drag across the ground to draw a fault; click a fault to start its rupture there; drag the star to move the start" : tool === "blast" ? "Click under the ground to set off the explosion" : tool === "dig" ? "Drag over the ground to dig it away, or dig caves underground" : "Drag to draw the rock; draw in the sky to build a mountain");
  });
  $<HTMLSelectElement>("qRock").addEventListener("change", (e) => { rockId = (e.target as HTMLSelectElement).value; showRock(); });
  const cvp = $<HTMLInputElement>("qCvp"), cvs = $<HTMLInputElement>("qCvs"), crho = $<HTMLInputElement>("qCrho");
  const showCustom = () => {
    custom.vp = +cvp.value; custom.rho = +crho.value;
    // S speed: 0 (a liquid), or between the grid's 1.6 km/s and P / 1.45 (rock cannot be stiffer in shear than that)
    const vs = +cvs.value;
    custom.vs = Math.round((vs < 0.8 ? 0 : Math.min(custom.vp / 1.45, Math.max(1.6, vs))) * 100) / 100;
    $("qCvpOut").textContent = `${custom.vp.toFixed(1)} km/s`; $("qCvsOut").textContent = custom.vs ? `${custom.vs.toFixed(2)} km/s` : "liquid"; $("qCrhoOut").textContent = `${custom.rho.toFixed(2)} g/cm³`;
    showRock();
  };
  for (const el of [cvp, cvs, crho]) el.addEventListener("input", showCustom);
  const brushEl = $<HTMLInputElement>("qBrush");
  const showBrush = () => { brush = +brushEl.value; $("qBrushOut").textContent = `${brush} km`; };
  brushEl.addEventListener("input", showBrush);

  // the fault's properties: changing one only changes the fault; Start the quake sets it off
  const magEl = $<HTMLInputElement>("qMag"), startEl = $<HTMLInputElement>("qStart"), vrEl = $<HTMLInputElement>("qVr");
  // ---------------------------------------------------------------- fault geometry, in numbers
  interface Geometry { x: number; top: number; dip: number; toward: 1 | -1; length: number }
  /** A fault's upper end (km along the slice, km deep), dip, which way it dips and its length. */
  function geometry(f: Fault): Geometry {
    const [up, lo] = f.a[1] <= f.b[1] ? [f.a, f.b] : [f.b, f.a];
    const dx = (lo[0] - up[0]) * H, dz = (lo[1] - up[1]) * H;
    return { x: (up[0] - SPONGE) * H, top: (up[1] - SKY) * H, dip: Math.round((Math.atan2(dz, Math.abs(dx)) * 180) / Math.PI), toward: dx < 0 ? -1 : 1, length: Math.hypot(dx, dz) };
  }
  /** Put a fault where its numbers say (upper end first), kept inside the slice: too long a fault is shortened,
   *  keeping its dip. */
  function setGeometry(f: Fault, g: Geometry) {
    const upperWasA = f.a[1] <= f.b[1], r = (Math.min(89, Math.max(1, g.dip)) * Math.PI) / 180;
    const i = (x: number) => Math.min(NX - 4, Math.max(3, Math.round(x / H + SPONGE))), j = (d: number) => Math.min(NZ - 4, Math.max(3, Math.round(d / H + SKY)));
    const xmin = (3 - SPONGE) * H, xmax = (NX - 4 - SPONGE) * H, dmax = (NZ - 4 - SKY) * H;
    g.x = Math.min(xmax, Math.max(xmin, g.x));
    const room = Math.min((g.toward > 0 ? xmax - g.x : g.x - xmin) / Math.cos(r), (dmax - g.top) / Math.sin(r));
    const len = Math.max(H, Math.min(g.length, room));
    f.a = [i(g.x), j(g.top)];
    f.b = [i(g.x + g.toward * len * Math.cos(r)), j(g.top + len * Math.sin(r))];
    if (!upperWasA) f.start = 1 - f.start;
  }
  /** The template's own fault, in place and ready (not started). */
  function addKnownFault() {
    const k = preset.fault;
    if (!k) return;
    const f: Fault = { a: [0, 0], b: [1, 1], magnitude: k.magnitude, start: 0.85, speed: 0.8, slip: k.slip };
    setGeometry(f, { x: placed(preset, k.x), top: k.top, dip: k.dip, toward: k.toward, length: k.length });
    faults.push(f); chosen = f;
  }
  const lenEl = $<HTMLInputElement>("qLen"), dipEl = $<HTMLInputElement>("qDip"), topEl = $<HTMLInputElement>("qTop"), posEl = $<HTMLInputElement>("qPos");
  const reshape = (change: (g: Geometry) => void) => edit((f) => { const g = geometry(f); change(g); setGeometry(f, g); }, false);
  lenEl.addEventListener("change", () => reshape((g) => { if (+lenEl.value > 0) g.length = +lenEl.value; }));
  dipEl.addEventListener("change", () => reshape((g) => { if (+dipEl.value > 0) g.dip = +dipEl.value; }));
  topEl.addEventListener("change", () => reshape((g) => { g.top = +topEl.value; }));
  posEl.addEventListener("change", () => reshape((g) => { g.x = +posEl.value; }));
  on("qToward", "toward", (v) => reshape((g) => { g.toward = v === "-1" ? -1 : 1; }));
  $("qFit").addEventListener("click", () => reshape((g) => { g.length = ruptureKm(chosen!.magnitude, chosen!.slip, g.dip); }));
  $("qAddFault").addEventListener("click", () => { addKnownFault(); showFault(); });

  function showFault() {
    $("qFaultControls").hidden = !chosen;
    $("qAddFault").hidden = !!chosen || !preset.fault;
    if (!chosen) { $("qFaultInfo").textContent = "None: drag across the picture to draw one."; return; }
    const f = chosen, { len, dip } = frame(f), km = ruptureKm(f.magnitude, f.slip, dip), g = geometry(f);
    $("qFaultInfo").textContent = `${(len * H).toFixed(1)} km · dips ${dip}° · ${g.top.toFixed(1)} to ${(g.top + len * H * Math.sin((dip * Math.PI) / 180)).toFixed(1)} km deep`;
    lenEl.value = g.length.toFixed(1); dipEl.value = String(g.dip); topEl.value = g.top.toFixed(1); posEl.value = g.x.toFixed(1);
    segmented($("qToward"), "toward", String(g.toward));
    magEl.value = String(f.magnitude); startEl.value = String(f.start); vrEl.value = String(f.speed);
    $("qMagOut").textContent = `M ${f.magnitude.toFixed(1)}`;
    $("qStartOut").textContent = `${Math.round(f.start * 100)}% along`;
    $("qVrOut").textContent = `${f.speed.toFixed(2)} × S speed`;
    segmented($("qSlip"), "slip", f.slip);
    const slips = Math.min(km, len * H), size = (v: number) => v < 1 ? `${Math.round(v * 1000)} m` : `${v.toFixed(v < 10 ? 1 : 0)} km`;
    $("qSrcNote").textContent = `${size(slips)} slips` + (km > len * H * 1.05 ? ` · M ${f.magnitude.toFixed(1)} needs about ${size(km)}: Fit to M, or a smaller magnitude` : "");
  }
  const edit = (change: (f: Fault) => void, again: boolean) => { if (!chosen) return; change(chosen); showFault(); if (again) slip(chosen); };
  magEl.addEventListener("input", () => edit((f) => { f.magnitude = +magEl.value; }, false));
  startEl.addEventListener("input", () => edit((f) => { f.start = +startEl.value; }, false));
  vrEl.addEventListener("input", () => edit((f) => { f.speed = +vrEl.value; }, false));
  on("qSlip", "slip", (v) => edit((f) => { f.slip = v as Fault["slip"]; }, false));
  $("qRupture").addEventListener("click", () => edit(() => {}, true));
  $("qDelete").addEventListener("click", () => {
    if (!chosen) return;
    const f = chosen;
    faults.splice(faults.indexOf(f), 1); done.push({ fault: f, added: false }); undone.length = 0; showHistory();
    chosen = faults.at(-1) ?? null; showFault();
    log("Fault deleted");
  });
  const showBlast = () => { $("qBlastNote").textContent = `About magnitude ${blastMagnitude(blast.kt).toFixed(1)}`; };
  $<HTMLSelectElement>("qBlast").addEventListener("change", (e) => { blast = BLASTS.find((b) => b.id === (e.target as HTMLSelectElement).value)!; showBlast(); });
  // a template opens at its natural width
  $<HTMLSelectElement>("qPreset").addEventListener("change", (e) => { presetId = (e.target as HTMLSelectElement).value; setSize(PRESETS[presetId].width / (W * 0.08), false); });
  on("qCount", "count", (v) => { placeStations(+v); replay(); });
  $("qAdd").addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-add]");
    if (b) addSource(b.dataset.add as KindId);
  });
  $("qSources").addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-remove]");
    if (b) { sources.splice(+b.dataset.remove!, 1); applyNoise(); replay(); }
  });
  $("qSources").addEventListener("change", (e) => {
    const el = e.target as HTMLSelectElement;
    if (el.dataset.level) { sources[+el.dataset.level].level = +el.value; applyNoise(); replay(); }
  });
  $("qStations").addEventListener("change", (e) => {
    const el = e.target as HTMLSelectElement;
    if (el.dataset.noise) noise[+el.dataset.noise] = +el.value;
  });
  on("qMeasure", "measure", (v) => { measure = v as Measure; });
  on("qComp", "comp", (v) => { comp = v as "z" | "h"; });
  on("qScale", "scale", (v) => { trueSize = v === "true"; });
  on("qLook", "look", (v) => { look = v as Look; });
  const loEl = $<HTMLInputElement>("qLo"), hiEl = $<HTMLInputElement>("qHi");
  function showFilter() {
    const id = $<HTMLSelectElement>("qFilter").value, preset = FILTERS.find((f) => f[0] === id)!;
    $("qBand").hidden = id !== "custom";
    if (id === "custom") {
      // the sliders cover 0.05 to 10 Hz on the 61 km slice, and follow its scale
      let lo = 10 ** +loEl.value / SCALE, hi = 10 ** +hiEl.value / SCALE;
      if (hi <= lo * 1.2) hi = lo * 1.2;
      band = { lo: +hz(lo), hi: +hz(hi) };
    } else { const [lo, hi] = corners(preset); band = { lo, hi }; }
    $("qLoOut").textContent = `${hz(10 ** +loEl.value / SCALE)} Hz`; $("qHiOut").textContent = `${hz(10 ** +hiEl.value / SCALE)} Hz`;
  }
  $("qFilter").addEventListener("change", showFilter);
  loEl.addEventListener("input", showFilter); hiEl.addEventListener("input", showFilter);
  $<HTMLInputElement>("qZero").addEventListener("change", (e) => { zeroPhase = (e.target as HTMLInputElement).checked; });
  $("qDownload").addEventListener("click", download);
  $("qShare").addEventListener("click", () => { void share(); });
  on("qMode", "mode", (v) => { mode = +v; });
  const speedEl = $<HTMLInputElement>("qSpeed"), glowEl = $<HTMLInputElement>("qGlow");
  const showSpeed = () => { speed = +speedEl.value; $("qSpeedOut").textContent = sim ? `${(speed * sim.dt * 60).toFixed(1)} s per second` : String(speed); };
  const showGlow = () => { glow = 2 ** +glowEl.value; $("qGlowOut").textContent = `×${glow.toFixed(1)}`; };
  speedEl.addEventListener("input", showSpeed);
  glowEl.addEventListener("input", showGlow);
  $("qPlay").addEventListener("click", () => {
    if (!playing && sim && ended) replay(); else setPlaying(!playing);
  });
  $("qReplay").addEventListener("click", replay);
  $("qUndo").addEventListener("click", undo);
  $("qRedo").addEventListener("click", redo);
  /** Change the slice's size: the same grid, cells and waves scaled (see ground.ts and Sim.setScale). */
  /** Change the slice's width. The faults stay where they are in the model (a new template brings its own). */
  function setSize(k: number, keep = true) {
    k = Math.min(MAX_KM, Math.max(MIN_KM, k * W * 0.08)) / (W * 0.08);
    const was = keep ? faults.map((f) => ({ f, g: geometry(f), shift: (WIDTH_KM - preset.width) / 2, mine: f === chosen })) : [];
    const restore = () => {
      if (!was.length) return;
      faults.length = 0; chosen = null;
      for (const { f, g, shift, mine } of was) { g.x += (WIDTH_KM - preset.width) / 2 - shift; setGeometry(f, g); faults.push(f); if (mine) chosen = f; }
      chosen ??= faults.at(-1) ?? null; showFault();
    };
    if (Math.abs(k - SCALE) < 1e-6) { loadPreset(presetId); restore(); return; }
    setScale(k); scaled();
    sim?.setScale(H, F0);
    noiseUnit.forEach((u, s) => { u[0] = noiseTrace(101 + 7 * s, MAX_S * SPS + 1); u[1] = noiseTrace(907 + 13 * s, MAX_S * SPS + 1); });
    halfDone.forEach((d) => d.fill(0));
    if (SCALE > 2) sources = [];
    showSize(); showSpeed();
    $<HTMLSelectElement>("qFilter").querySelectorAll("option").forEach((o, q) => { o.textContent = filterName(FILTERS[q]); });
    showFilter(); $("qFgrid").textContent = hz(F_GRID);
    loadPreset(presetId);
    restore();
  }
  function showSize() {
    $<HTMLInputElement>("qWidth").value = WIDTH_KM.toFixed(0);
    $("qSizeNote").textContent = `${DEPTH_KM.toFixed(0)} km deep · ${H < 0.1 ? `${(H * 1000).toFixed(0)} m` : `${H.toFixed(2)} km`} cells · ${hz(F0)} Hz`;
    $("qSizeNote").title = "The grid keeps 768 × 400 cells, so any width runs as fast; wider slices have bigger cells and longer, slower waves." +
      (SCALE > 1.5 ? " Peaks and intensities then count only these slow waves, so near a big quake they underrate the shaking." : "");
  }
  const widthEl = $<HTMLInputElement>("qWidth");
  widthEl.addEventListener("change", () => { const km = +widthEl.value; if (km > 0) setSize(km / (W * 0.08)); else showSize(); });
  $("qReset").addEventListener("click", () => { loadPreset(presetId); log(`${preset.name}: the ground is back as it was`); });
  $<HTMLInputElement>("qLabels").addEventListener("change", (e) => { labels = (e.target as HTMLInputElement).checked; });

  segmented($("qTool"), "tool", tool); segmented($("qMode"), "mode", "0");
  segmented($("qMeasure"), "measure", measure); segmented($("qComp"), "comp", comp); segmented($("qScale"), "scale", "fit"); segmented($("qLook"), "look", look); showFilter(); showSize();
  $<HTMLSelectElement>("qRock").value = rockId; $<HTMLSelectElement>("qBlast").value = blast.id;
  showBrush(); showSpeed(); showGlow(); showCustom(); showFault(); showBlast();
  $("qNote").textContent = preset.note; $("qAbout").textContent = preset.about; $<HTMLSelectElement>("qPreset").value = presetId;

  Sim.create(gpuCanvas, {
    nx: NX, nz: NZ, h: H, vmax: VMAX, f0: F0, sponge: { left: SPONGE, right: SPONGE, bottom: SPONGE, top: 0 },
    view: { x0: SPONGE, z0: 0, w: W, h: VH }, seconds: MAX_S + 1.2 / F0 + 0.2, stations: NAMES.length, gains: GAINS, dots: 12, noise: MAX_SOURCES, noiseLoss: NOISE_LOSS,
  }).then((s) => {
    sim = s;
    (window as unknown as { playground: Record<string, Sim> }).playground = { ...(window as unknown as { playground?: object }).playground, quake: s };
    pic.querySelector(".loading")!.remove();
    showSpeed();
    loadPreset(presetId);
    const code = fromAddress();
    if (code) void decode(code).then((sc) => sc ? open(sc) : log("That link's setup could not be read"));
  }, (err: Error) => { pic.querySelector(".loading")!.textContent = err.message; });

  // ---------------------------------------------------------------- drawing
  function drawOver() {
    const { c } = surface(over), { L, T, iw, ih } = box;
    const X = (x: number) => L + (x / W) * iw, Y = (y: number) => T + (y / VH) * ih;
    const tick = (x0: number, y0: number, x1: number, y1: number) => { c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke(); };
    c.strokeStyle = INK; c.lineWidth = 1; c.strokeRect(L - 0.5, T - 0.5, iw + 1, ih + 1);
    c.font = MONO(10); c.fillStyle = MUTED; c.strokeStyle = MUTED; c.textBaseline = "bottom";
    const nice = (span: number, n: number) => [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500].find((d) => span / d <= n) ?? 1000;
    const xstep = nice(WIDTH_KM, iw > 520 ? 7 : 4), dstep = nice(DEPTH_KM, 6);
    for (let km = 0; km <= WIDTH_KM; km += xstep) {
      const x = X(km / H);
      tick(x, T - 4, x, T);
      c.textAlign = km === 0 ? "left" : "center";
      c.fillText(km === 0 ? (iw > 520 ? "0 km across" : "0 km") : String(km), x, T - 6);
    }
    c.textAlign = "right"; c.textBaseline = "middle";
    for (let d = 0; d <= DEPTH_KM; d += dstep) {
      const y = Y(SKY + d / H);
      tick(L - 4, y, L, y);
      c.fillText(d === 0 ? "0 km" : String(d), L - 7, y);
    }
    c.save(); c.translate(11, Y(SKY + DEPTH_KM / 2 / H)); c.rotate(-Math.PI / 2); c.textAlign = "center"; c.fillText("depth", 0, 0); c.restore();
    c.save();
    c.beginPath(); c.rect(L, T, iw, ih); c.clip();
    // the ground surface
    c.beginPath();
    for (let x = 0; x < W; x++) { const y = Y(top[x]); if (x === 0) c.moveTo(X(0), y); c.lineTo(X(x + 0.5), y); }
    c.lineTo(X(W), Y(top[W - 1]));
    c.strokeStyle = INK; c.lineWidth = 1.25; c.stroke();
    // faults, the one being drawn, and the part of a fault slipping now (the rupture front runs out from the start)
    const FX = (i: number) => X(i - SPONGE + 0.5), FY = (j: number) => Y(j + 0.5);
    /** Text beside a fault, off the line: on the side of the screen normal (nx, ny), aligned away from the fault. */
    const beside = (text: string, x: number, y: number, nx: number, ny: number, colour: string) => {
      c.font = MONO(10);
      c.textAlign = nx > 0.35 ? "left" : nx < -0.35 ? "right" : "center";
      c.textBaseline = ny > 0.35 ? "top" : ny < -0.35 ? "bottom" : "middle";
      label(c, text, x + nx * 9, y + ny * 9, colour);
    };
    /** The screen normal of a fault that points up (or, for an upright fault, right). */
    const upward = (f: Fault) => {
      const dx = FX(f.b[0]) - FX(f.a[0]), dy = FY(f.b[1]) - FY(f.a[1]), l = Math.hypot(dx, dy) || 1;
      let nx = -dy / l, ny = dx / l;
      if (ny > 0.01 || (Math.abs(ny) <= 0.01 && nx < 0)) { nx = -nx; ny = -ny; }
      return [nx, ny] as const;
    };
    for (const f of faults) {
      // the fault itself, soft: the part that slips is drawn over it in rust
      const mine = f === chosen;
      c.strokeStyle = mine ? "rgba(37,39,34,0.7)" : "rgba(37,39,34,0.4)"; c.lineWidth = 2.5; c.lineCap = "round";
      tick(FX(f.a[0]), FY(f.a[1]), FX(f.b[0]), FY(f.b[1]));
    }
    if (drag && "from" in drag) {
      c.setLineDash([6, 4]); c.strokeStyle = INK; c.lineWidth = 2;
      tick(FX(drag.from[0]), FY(drag.from[1]), FX(drag.to[0]), FY(drag.to[1])); c.setLineDash([]);
    }
    if (rupture && sim) {
      const f = rupture.fault, { tx, tz } = frame(f), now = Math.max(0, sim.step * sim.dt - sim.t0);
      // how far the rupture front has run each way (it slows where the rock is soft)
      let lo = rupture.at, hi = rupture.at;
      while (lo - 1 >= rupture.s0 && rupture.times[Math.round(lo - 1)] <= now) lo -= 1;
      while (hi + 1 <= rupture.s1 && rupture.times[Math.round(hi + 1)] <= now) hi += 1;
      // the whole stretch that will slip, faintly; the part slipping so far, strongly
      c.strokeStyle = "rgba(164,70,42,0.28)"; c.lineWidth = 6; c.lineCap = "round";
      tick(FX(f.a[0] + tx * rupture.s0), FY(f.a[1] + tz * rupture.s0), FX(f.a[0] + tx * rupture.s1), FY(f.a[1] + tz * rupture.s1));
      c.strokeStyle = RUST; c.lineWidth = 5;
      if (hi > lo) tick(FX(f.a[0] + tx * lo), FY(f.a[1] + tz * lo), FX(f.a[0] + tx * hi), FY(f.a[1] + tz * hi));
    }
    c.lineCap = "butt";
    // the faults' names, on the upper side, clear of the line
    if (labels) for (const f of faults) {
      const { dip } = frame(f), [nx, ny] = upward(f);
      beside(`${f.slip} fault · M ${f.magnitude.toFixed(1)} · ${dip}°`, FX((f.a[0] + f.b[0]) / 2), FY((f.a[1] + f.b[1]) / 2), nx, ny, f === chosen ? INK : MUTED);
    }
    // where the chosen fault's rupture starts: a handle to drag along it, its name on the lower side
    if (chosen) {
      const { len, tx, tz } = frame(chosen), s0 = chosen.start * len, hx = FX(chosen.a[0] + tx * s0), hy = FY(chosen.a[1] + tz * s0);
      c.beginPath(); c.arc(hx, hy, 9, 0, 2 * Math.PI); c.fillStyle = "#faf9f6"; c.fill();
      c.strokeStyle = RUST; c.lineWidth = 2; c.stroke();
      star(c, hx, hy, 5.5); c.fillStyle = RUST; c.fill();
      if (labels) {
        const [nx, ny] = upward(chosen), slips = rupture && rupture.fault === chosen ? ` · ${((rupture.s1 - rupture.s0) * H).toFixed(1)} km slips` : "";
        beside(`rupture starts here${slips}`, hx - nx * 4, hy - ny * 4, -nx, -ny, RUST);
      }
    }
    // noise sources: a mark on the surface with its waves going down
    sources.forEach((q) => {
      const px = X(q.x + 0.5), py = Y(top[q.x]), col = SOURCE_COLOUR[q.kind];
      c.strokeStyle = col; c.lineWidth = 1.2;
      for (const rr of [6, 10, 14]) { c.beginPath(); c.arc(px, py, rr, 0.2 * Math.PI, 0.8 * Math.PI); c.stroke(); }
      c.beginPath(); c.moveTo(px, py - 5); c.lineTo(px + 5, py); c.lineTo(px, py + 5); c.lineTo(px - 5, py); c.closePath();
      c.fillStyle = col; c.fill(); c.strokeStyle = "#faf9f6"; c.lineWidth = 1; c.stroke();
      if (labels) {
        // the name under it, kept inside the picture
        const name = KINDS[q.kind].name.toLowerCase(); c.font = MONO(10); c.textAlign = "center"; c.textBaseline = "top";
        const half = c.measureText(name).width / 2 + 3;
        label(c, name, Math.min(L + iw - half, Math.max(L + half, px)), py + 17, col);
      }
    });
    // the quake: focus underground, epicentre on the surface above it
    const qx = quakeAt[0] - SPONGE, fx = X(qx + 0.5), fy = Y(quakeAt[1] + 0.5);
    if (hasSource && qx >= 0 && qx < W) {
      const ey = Y(top[qx]);
      if (labels) {
        c.setLineDash([3, 3]); c.strokeStyle = "rgba(164,70,42,0.7)"; c.lineWidth = 1; tick(fx, ey, fx, fy - 8); c.setLineDash([]);
      }
      c.beginPath(); c.moveTo(fx - 5, ey - 9); c.lineTo(fx + 5, ey - 9); c.lineTo(fx, ey - 1); c.closePath();
      c.fillStyle = RUST; c.fill();
      // an explosion's star (a fault's start has its own handle, drawn with the fault)
      if (kind !== "quake") { star(c, fx, fy, 8); c.fillStyle = RUST; c.fill(); c.strokeStyle = "#faf9f6"; c.lineWidth = 1.2; c.stroke(); }
      if (labels) {
        c.font = MONO(10); c.textBaseline = "middle"; c.textAlign = "left";
        if (kind !== "quake") label(c, "explosion", fx + 11, fy + 12, RUST);
        c.textAlign = "center"; c.textBaseline = "bottom";
        if (!stationsX.some((x) => Math.abs(X(x + 0.5) - fx) < 40)) label(c, "epicentre", fx, ey - 12, RUST);
      }
    }
    // seismometers
    stationsX.forEach((x, s) => {
      const px = X(x + 0.5), py = Y(top[x]);
      c.beginPath(); c.moveTo(px - 6, py); c.lineTo(px + 6, py); c.lineTo(px, py - 11); c.closePath();
      c.fillStyle = INK; c.fill(); c.strokeStyle = "#faf9f6"; c.lineWidth = 1; c.stroke();
      // the name above the seismometer, or beside it where the sky is too thin (narrow screens)
      c.font = "bold 13px Georgia, serif"; c.textBaseline = "bottom";
      if (py - 27 >= T) { c.textAlign = "center"; label(c, NAMES[s], px, py - 13); }
      else { c.textAlign = "left"; label(c, NAMES[s], px + 7, py - 1); }
    });
    // the brush
    if (pointer && (tool === "draw" || tool === "dig") && !(drag && "station" in drag)) {
      c.beginPath(); c.arc(pointer.x, pointer.y, (brush / H / W) * iw, 0, 2 * Math.PI);
      c.setLineDash([4, 3]); c.strokeStyle = INK; c.lineWidth = 1; c.stroke(); c.setLineDash([]);
    }
    if (sim) {
      c.font = MONO(11); c.textAlign = "right"; c.textBaseline = "bottom";
      const warm = Math.ceil(WARM_S / sim.dt);
      label(c, sim.warming > 0 ? `noise sources starting · ${Math.round(100 * (1 - sim.warming / warm))}%` : `${Math.max(0, sim.step * sim.dt - sim.t0).toFixed(1)} s ${hasSource ? "after the quake" : "recorded"}`, L + iw - 8, T + ih - 7);
    }
    c.restore();
  }

  /** Which way the ground first moves when the P wave arrives (up ↑ or down ↓): the quake's signal alone, vertical. */
  function firstMotion(s: number, P: number, n: number) {
    const z = sig[s][1], k0 = Math.max(0, Math.floor((P - 0.2) * SPS)), k1 = Math.min(n, Math.ceil((P + 1.2) * SPS));
    let m = 0;
    for (let k = k0; k < k1; k++) m = Math.max(m, Math.abs(z[k]));
    if (!m) return "";
    for (let k = k0; k < k1; k++) if (Math.abs(z[k]) > 0.15 * m) return z[k] > 0 ? "↑" : "↓";
    return "";
  }
  function drawSeis() {
    const { c, w, h } = surface(seis), nst = stationsX.length;
    const L = 64, R = 6, T = 22, B = 22, iw = w - L - R, rowH = (h - T - B) / Math.max(1, nst);
    const now = sim ? Math.max(0, sim.step * sim.dt - sim.t0) : 0;
    // the time axis: 30 s, growing in steps of 10 s while recording, then fitted to the whole record
    const grow = 10 * SCALE, span = Math.max(AXIS_S, ended ? now : Math.ceil((now + 0.01) / grow) * grow);
    const every = [1, 2, 5, 10, 20, 50, 100, 200, 500].find((d) => span / d <= 8) ?? 1000;
    const tx = (t: number) => L + (Math.min(t, span) / span) * iw;
    const [, base, measured] = MEASURES[measure];
    const what = `${look === "spec" ? "spectra of " : look === "sgram" ? "spectrogram of " : ""}${measured}`;
    const bandText = band.lo && band.hi ? ` · ${band.lo}–${band.hi} Hz` : band.lo ? ` · above ${band.lo} Hz` : band.hi ? ` · below ${band.hi} Hz` : "";
    c.font = MONO(10); c.fillStyle = MUTED; c.textBaseline = "alphabetic";
    // the heading, shorter on narrow screens so it never runs into the scale note
    const scaleNote = trueSize ? "all traces at the same scale" : "each trace scaled to fit", room = w - R - c.measureText(scaleNote).width - 16;
    const short = `${what.toUpperCase()}, ${comp === "z" ? "UP AND DOWN" : "SIDEWAYS"}${bandText.toUpperCase()}`;
    const heading = [`SEISMOGRAMS · ${short} · ${+SPS.toFixed(1)} SAMPLES PER SECOND`, `SEISMOGRAMS · ${short}`, short].find((t) => c.measureText(t).width <= room);
    c.textAlign = "left"; c.fillText(heading ?? short, 0, 12);
    if (heading) { c.textAlign = "right"; c.fillText(scaleNote, w - R, 12); }
    c.strokeStyle = MUTED; c.lineWidth = 1;
    c.beginPath(); c.moveTo(L, h - B + 0.5); c.lineTo(L + iw, h - B + 0.5); c.stroke();
    c.textAlign = "center"; c.textBaseline = "top";
    const fx = (f: number) => L + (Math.log(f / FMIN) / Math.log(FMAX / FMIN)) * iw;
    if (look === "spec") {
      for (const f of [0.1, 0.2, 0.5, 1, 2, 5, 10]) {
        const x = fx(f);
        c.beginPath(); c.moveTo(x, h - B); c.lineTo(x, h - B + 4); c.stroke();
        c.textAlign = f === 10 ? "right" : "center"; c.fillText(f === 10 ? "10 Hz" : `${f}`, x, h - B + 6);
      }
    } else for (let t = 0; t <= span; t += every) {
      const x = tx(t);
      c.beginPath(); c.moveTo(x, h - B); c.lineTo(x, h - B + 4); c.stroke();
      c.fillText(t === 0 ? "0 s" : `${t}`, x, h - B + 6);
    }
    const n = readRecords(), ci = comp === "z" ? 1 : 0;
    const shown = stationsX.map((_, s) => trace(s, ci, n, measure, true));
    const spectra = look === "spec" && n > 64 ? shown.map((v) => amplitude(v, SPS, 0, n)) : null;
    const topAmp = spectra ? Math.max(1e-30, ...spectra.map((q) => q.amp.reduce((m, a, k) => q.f[k] >= FMIN ? Math.max(m, a) : m, 0))) : 0;
    const peaks = shown.map((v) => v.reduce((m, x) => Math.max(m, Math.abs(x)), 0));
    const most = Math.max(1e-15, ...peaks);
    for (let s = 0; s < nst; s++) {
      const y0 = T + s * rowH, mid = y0 + rowH / 2;
      c.strokeStyle = LINE;
      if (look === "trace") { c.beginPath(); c.moveTo(L, mid + 0.5); c.lineTo(L + iw, mid + 0.5); c.stroke(); }
      c.font = "bold 16px Georgia, serif"; c.fillStyle = INK; c.textAlign = "left"; c.textBaseline = "middle";
      c.fillText(NAMES[s], 0, mid - 7);
      c.font = MONO(10); c.fillStyle = MUTED;
      // distances from the quake, once there is one; until then, where the seismometer stands
      const there = hasSource ? `${distance(s).toFixed(0)} km` : `at ${(stationsX[s] * H).toFixed(0)}`;
      c.fillText(there, 0, mid + 9);
      const dist = $("qStations").querySelector(`[data-dist="${s}"]`);
      if (dist) dist.textContent = hasSource ? `${distance(s).toFixed(1)} km` : `at ${(stationsX[s] * H).toFixed(1)} km`;
      if (!sim) continue;
      const v = shown[s], scale = (rowH * 0.44) / (trueSize ? most : Math.max(peaks[s], most * 0.01));
      const facts: string[] = [];
      c.save(); c.beginPath(); c.rect(L, y0, iw, rowH); c.clip();
      if (look === "trace") {
        c.beginPath();
        for (let k = 0; k < n; k++) { const x = tx(k / SPS), y = mid - v[k] * scale; if (k) c.lineTo(x, y); else c.moveTo(x, y); }
        c.strokeStyle = INK; c.lineWidth = 1; c.stroke();
      } else if (look === "spec" && spectra) {
        // log amplitude, three decades per row; above the grid's limit the spectrum is not to be trusted
        const sp = spectra[s], amax = trueSize ? topAmp : Math.max(1e-30, sp.amp.reduce((m, a, k) => sp.f[k] >= FMIN ? Math.max(m, a) : m, 0));
        const ay = (a: number) => y0 + rowH - 4 - ((Math.log10(Math.max(a, 1e-30) / amax) + 3) / 3) * (rowH - 18);
        c.fillStyle = "rgba(222,222,212,0.45)"; c.fillRect(fx(F_GRID), y0, L + iw - fx(F_GRID), rowH);
        if (s === 0) { c.font = MONO(9); c.textAlign = "left"; c.textBaseline = "top"; label(c, "beyond the grid", fx(F_GRID) + 4, y0 + 2, MUTED); }
        const curve = (q: { f: Float64Array; amp: Float64Array }, k0: number, colour: string, width: number, gain = 1) => {
          c.beginPath(); let pen = false;
          for (let k = k0; k < q.f.length && q.f[k] <= FMAX; k++) { if (q.f[k] < FMIN) continue; const x = fx(q.f[k]), y = ay(q.amp[k] * gain); if (pen) c.lineTo(x, y); else { c.moveTo(x, y); pen = true; } }
          c.strokeStyle = colour; c.lineWidth = width; c.stroke();
        };
        // before the P wave: the noise alone, scaled to the whole record's length so the two compare
        const P = arr?.p[s] ?? NaN, np = Number.isFinite(P) ? Math.min(n, Math.floor(P * SPS)) : 0;
        if (np >= 128) curve(amplitude(v, SPS, 0, np), 1, "rgba(100,103,94,0.6)", 1, Math.sqrt(n / np));
        curve(sp, 1, INK, 1.2);
        let kp = 1; for (let k = 1; k < sp.f.length && sp.f[k] <= F_GRID; k++) if (sp.f[k] >= FMIN && sp.amp[k] > sp.amp[kp]) kp = k;
        if (sp.amp[kp] > 0) facts.push(`strongest at ${sp.f[kp].toFixed(sp.f[kp] < 1 ? 2 : 1)} Hz`);
      } else if (look === "sgram" && n > 256) {
        // power in 2.56 s windows, on a log frequency axis from 0.2 to 10 Hz, 50 dB from the row's (or all rows') top
        const g = spectrogram(v, SPS, n), F0g = 0.2 / SCALE, rows = 64, img = new ImageData(g.rows.length, rows);
        let pmax = 1e-60; for (const p of g.rows) for (let k = 1; k < p.length; k++) pmax = Math.max(pmax, p[k]);
        if (trueSize) pmax = Math.max(pmax, (most / Math.max(1e-30, peaks[s])) ** 2 * pmax);
        g.rows.forEach((p, col) => {
          for (let y = 0; y < rows; y++) {
            const f = F0g * (FMAX / F0g) ** (1 - y / (rows - 1)), q = f / g.df, k0 = Math.min(p.length - 2, Math.floor(q)), t = q - k0;
            const db = 10 * Math.log10(Math.max(1e-60, p[k0] * (1 - t) + p[k0 + 1] * t) / pmax), col4 = HEAT(Math.min(1, Math.max(0, (db + 50) / 50))), o = 4 * (y * g.rows.length + col);
            img.data[o] = col4[0]; img.data[o + 1] = col4[1]; img.data[o + 2] = col4[2]; img.data[o + 3] = 255;
          }
        });
        const off = new OffscreenCanvas(img.width, rows); off.getContext("2d")!.putImageData(img, 0, 0);
        const half = 8 / SPS, x0 = tx(g.times[0] - half), x1 = tx(g.times[g.times.length - 1] + half);
        c.imageSmoothingEnabled = true; c.drawImage(off, x0, y0 + 12, x1 - x0, rowH - 16);
        const fy = (f: number) => y0 + 12 + (1 - Math.log(f / F0g) / Math.log(FMAX / F0g)) * (rowH - 16);
        c.font = MONO(9); c.textAlign = "left"; c.textBaseline = "middle";
        for (const f of [1 / SCALE, 5 / SCALE]) { c.strokeStyle = "rgba(37,39,34,0.25)"; c.setLineDash([2, 3]); c.beginPath(); c.moveTo(L, fy(f)); c.lineTo(L + iw, fy(f)); c.stroke(); c.setLineDash([]); label(c, `${hz(f)} Hz`, L + 3, fy(f), MUTED); }
      }
      c.restore();
      // one line per row: S - P and distance, then the peak and the intensity
      if (n > 1 && peaks[s] > 0) {
        const i = Math.round(intensity(pgv(s, n) * 100)) - 1;
        facts.push(`peak ${units(peaks[s], base)}`, `intensity ${ROMAN[i]} · ${FELT[i]}`);
      }
      const say = (first?: string, colour = MUTED) => {
        c.font = MONO(10); c.textAlign = "right"; c.textBaseline = "bottom";
        label(c, [first, ...facts].filter(Boolean).join("   ·   "), L + iw, y0 + rowH - 1, colour);
      };
      if (!arr || look === "spec") { say(); continue; }
      const P = arr.p[s], S = arr.s[s], Rt = arr.r[s];
      const mark = (t: number, colour: string, text: string) => {
        const x = tx(t);
        c.strokeStyle = colour; c.lineWidth = 1.5;
        c.beginPath(); c.moveTo(x, y0 + 13); c.lineTo(x, y0 + rowH - 4); c.stroke();
        c.font = "bold 10px ui-monospace, SFMono-Regular, monospace"; c.fillStyle = colour; c.textAlign = "center"; c.textBaseline = "top";
        c.fillText(text, x, y0 + 2);
      };
      if (Number.isFinite(P) && now >= P) mark(P, RUST, comp === "z" && now >= P + 1.5 ? `P${firstMotion(s, P, n)}` : "P");
      // R is estimated along the surface from the epicentre, which is meaningless close to a deep quake: never before P or S
      if (Number.isFinite(Rt) && now >= Rt && Rt < span && Rt > (Number.isFinite(S) ? S : P) + 0.3) mark(Rt, ACCENT, "R");
      if (Number.isFinite(S) && now >= S) {
        mark(S, NAVY, "S");
        say(`S − P = ${(S - P).toFixed(1)} s → about ${Math.round((S - P) * KM_PER_S)} km away`, INK);
      } else if (!Number.isFinite(S) && Number.isFinite(P) && now >= P * 1.8) say("no S wave: liquid in the way", NAVY);
      else say();
    }
    if (sim && now > 0 && look !== "spec") {
      const x = tx(now);
      c.strokeStyle = "rgba(37,39,34,0.35)"; c.lineWidth = 1;
      c.beginPath(); c.moveTo(x, T); c.lineTo(x, h - B); c.stroke();
    }
  }

  return {
    frame() {
      if (!sim) return;
      if (dirty) {
        sim.update(dirty[0], dirty[1]); dirty = null;
        findSurface(); sim.setStations(stationCells());
        if (!drag && sources.some((q) => q.j !== top[q.x])) applyNoise();
      }
      // the noise sources' waves in the picture: true size next to the quake, or bright enough to see
      const loudest = Math.max(0, ...sources.map((q) => q.level));
      sim.setNoiseMix(loudest ? Math.max(1 / amp(), NOISE_SHOW / loudest) : 0);
      if (sim.warming > 0) { if (playing) sim.warm(WARM_STEPS); }
      else if (playing) {
        // stop once the quake's waves have gone (see planEnd and quiet), or at the end of the record space
        const now = sim.step * sim.dt - sim.t0;
        ended = sim.step >= sim.end || (now >= minEnd && (!hasSource || quiet(readRecords())));
        if (!ended) sim.advance(Math.min(speed, sim.end - sim.step));
        else {
          setPlaying(false);
          log(hasSource ? `The waves have gone: ${now.toFixed(0)} s recorded. Click under the ground to start another quake.` : `The noise recording is over (${now.toFixed(0)} s). Replay records it again; draw a fault for a quake.`);
        }
      } else sim.pull();
      // bigger quakes look a little brighter (their true range is far too wide to show); a rupture spreads its
      // moment over many small sources, so the picture is brightened to match (the seismograms are not)
      const bright = Math.min(3, Math.max(0.35, size(sourceMagnitude(), F0) ** 0.2));
      sim.render({ mode, glow: (glow * bright * (rupture ? Math.min(4, 0.5 * Math.sqrt(rupture.parts)) : 1)) / SCALE, exag: EXAG / SCALE ** 2 });
      drawOver();
      drawSeis();
    },
    resize() {
      const { w, h } = room();
      const free = h - SEIS_H - 14 - 30;
      const iw = Math.max(240, Math.min(w - PAD.l - PAD.r, (free - PAD.t - PAD.b) * (W / VH))), ih = (iw * VH) / W;
      const width = `${Math.floor(iw + PAD.l + PAD.r)}px`;
      pic.style.width = width; pic.style.height = `${Math.ceil(ih + PAD.t + PAD.b)}px`;
      Object.assign(gpuCanvas.style, { left: `${PAD.l}px`, top: `${PAD.t}px`, width: `${iw}px`, height: `${ih}px` });
      under.style.width = width; seis.style.width = width; seis.style.height = `${SEIS_H}px`;
      box = { L: PAD.l, T: PAD.t, iw, ih };
    },
    key(e) {
      if ((e.metaKey || e.ctrlKey) && (e.key === "z" || e.key === "Z" || e.key === "y")) {
        e.preventDefault();
        if (e.key === "y" || e.shiftKey) redo(); else undo();
        return;
      }
      if (e.key === " ") { e.preventDefault(); $("qPlay").click(); }
      else if (e.key === "r" || e.key === "R") replay();
    },
  };
}
