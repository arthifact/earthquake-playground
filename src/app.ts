// Earthquake Playground: earthquakes for the classroom and the lab. One screen, three views along the top; each view owns a picture area
// and a side panel (src/views/*.ts). This file builds the frame, switches views, runs the animation loop and
// holds the dialogs.

import { createEarth } from "./views/earth";
import { createQuake } from "./views/quake";
import type { View } from "./views/view";
import { createWaves } from "./views/waves";

export const NAME = "Earthquake Playground";
const VIEWS = [["quake", "Quake"], ["waves", "Wave types"], ["earth", "Inside the Earth"]] as const;
type ViewId = (typeof VIEWS)[number][0];

const LOGO = `<svg class="mark" viewBox="0 0 40 40" aria-hidden="true"><rect x="0.5" y="0.5" width="39" height="39" fill="none" stroke="currentColor"/><path d="M1 13 L39 13" stroke="currentColor"/><path d="M10 27 A10 10 0 0 1 30 27 M15 27 A5 5 0 0 1 25 27 M6 34 A14 14 0 0 1 8 20" stroke="currentColor" fill="none"/><path d="M20 24 L21.2 26.6 L24 27 L21.9 28.9 L22.5 31.7 L20 30.3 L17.5 31.7 L18.1 28.9 L16 27 L18.8 26.6 Z" fill="#a4462a"/></svg>`;
const dialog = (id: string, title: string, body: string) =>
  `<dialog id="${id}" class="modal"><div class="modal-in"><header class="modal-head"><h2>${title}</h2><button type="button" class="close" data-close aria-label="Close">×</button></header><div class="modal-body">${body}</div></div></dialog>`;

const HELP = `
  <p class="lbl">1 Quake</p>
  <ol class="steps">
    <li><b>Model</b>: a real setting (subduction zone, Himalaya, rift, basin, volcano, ridge…) at its natural size. Type the <b>width × depth</b> on the picture's frame: any size runs in real time (the line under the picture gives the cell size, the highest frequency the grid carries and the time step).</li>
    <li><b>Earthquake</b>: click the picture to place the hypocentre, then press <b>Start</b> (or <kbd>R</kbd>). Set <b>Mw</b>, <b>dip</b> and <b>slip</b> (thrust or normal); the fault plane and the beachball follow. Drag the star to move it, or the fault's deep end to turn it. <i>Rupture</i> (folded) sets its length, the way it runs and its speed. <b>Explosion</b>: choose a yield, click to place it, Start.</li>
    <li><b>Seismometers</b> (A to E, drag them along the surface) record velocity, displacement or acceleration, vertical (Z) or along the slice (E), with P, S and R marks, first motions (P↑, P↓), distance, peak and intensity. <b>Download</b> saves SAC and CSV; <b>Copy link</b> shares the exact setup.</li>
    <li>Folded: <i>Filters and spectra</i>, <i>Display</i>, <i>Edit model</i> (add rock, dig; Undo, Redo, Reset), <i>Noise sources</i>, <i>Key</i>.</li>
  </ol>
  <p class="lbl">2 Wave types</p>
  <ol class="steps"><li>P, S, Love and Rayleigh waves race across 60 km of rock. Follow the rust dots to see how each one moves the ground.</li></ol>
  <p class="lbl">3 Inside the Earth</p>
  <ol class="steps"><li>Click inside the Earth to place a deep quake's origin, then press <b>Play</b> (<b>Replay</b> starts it again, <b>Reset</b> stills the Earth). It runs until the quake's waves have sunk below the background noise at every seismometer: under an hour for a magnitude 5, about nine hours for a 7, at most twelve hours. The rock takes the waves' energy as in the real Earth (PREM's attenuation), so they fade as they go. The record on the right shows what seismometers all around the world receive, and where the core casts its shadows. P waves reach the far side, through the core, in about 20 minutes (S waves cannot cross the liquid core); the surface waves (R1) crawl round the planet at about 3.7 km/s and get there after about an hour and a half, then come back the long way (R2), and round again (R3, R4).</li></ol>
  <p class="lbl">Keys</p>
  <ol class="steps"><li><kbd>Space</kbd> pause or play, <kbd>R</kbd> replay the quake.</li></ol>`;
const ABOUT = `
  <p>${NAME} shows how earthquakes shake the ground. The waves are computed, not drawn: the equations of motion of elastic rock run on the graphics card (WebGPU), many times a second, so every wave you see comes out of the physics: P, S and Rayleigh waves, their reflections and bending, the S wave stopping at liquid.</p>
  <p class="lbl">How</p>
  <p>Elastic waves in a vertical slice (P-SV), velocity and stress on a staggered grid, fourth order in space; a free surface where the rock meets the air, so mountains, valleys and caves work; a perfectly matched layer that absorbs the waves at the open sides. Checked against SPECFEM2D (see validation/README.md). The source is a slipping fault (double couple) or an explosion, with a 1.1 Hz Ricker pulse. The P and S marks are first-arrival times through the ground you drew; R is estimated from the S speed near the surface.</p>
  <p class="lbl">Sizes and units</p>
  <p>The simulation is linear, so magnitude scales the waves without changing their shape: by a Brune source spectrum at 1.1 Hz (3 MPa stress drop), calibrated to about 1.5 cm/s at 20 km for magnitude 5, with the 2D spreading corrected toward 3D. Explosions use body-wave magnitude 4.45 + 0.75 log₁₀(yield in kt). Intensity is Modified Mercalli from the peak ground velocity of the stronger direction (Worden et al., 2012). Added noise is synthetic: microseism near 0.2 Hz plus local noise. Noise sources are random vertical forces on the surface (ocean waves near 0.25 Hz, traffic near 2 Hz that swells and fades, a factory's steady 2.4 Hz tone), simulated in their own layer in m/s, calibrated at 1 km on plain rock; their waves lose energy as they travel (amplitude e times smaller every 2 s), and in a 2D slice each is really a line across the slice, like a road or a coast. The picture shows them brighter than their true size; their records keep only what the grid carries (below 4 Hz).</p>
  <p class="lbl">Filters and spectra</p>
  <p>Four-pole Butterworth filters (as ObsPy's), causal or zero phase. Spectra are Fourier amplitudes of the shown trace with a Hann taper; the noise before the P wave is scaled to the record's length to compare. Spectrograms use 2.56 s windows every 0.16 s. Above about 4 Hz the grid has fewer than five cells per wavelength of the slowest S wave, so that part is shaded. Downloads are not filtered.</p>
  <p class="lbl">Simplified</p>
  <p>Two dimensions instead of three, so there are no Love waves in the slice; waves longer than in real quakes, and a big quake is still a point that slips at once (real large quakes rupture for seconds to minutes); no damping in the rock; the softest materials are stiffened to S speeds of 1.6 km/s. The Earth model is a simplified PREM (Dziewonski and Anderson, 1981), with its shear attenuation (Q) at the waves' 80 s period: one Q per depth for both P and S, so P waves lose a little too much; amplitudes spread as in a slice (a disc), not a sphere, though travel times are the same.</p>
  <p class="lbl">Made by</p>
  <p><a href="https://arthifact.com/">Gabriel I. Alonso</a>, in the style of Earth Forge and RenderWave.</p>`;

export function start(root: HTMLElement) {
  root.innerHTML = `
  <div class="app">
    <header class="topbar">
      <a class="brand" href="./">${LOGO}<span>${NAME}</span></a>
      <nav class="stages" aria-label="Views">${VIEWS.map(([id, label], i) => `<button type="button" data-view="${id}"><span>${i + 1}</span>${label}</button>`).join("")}</nav>
      <nav class="menu" aria-label="Menu"><button type="button" data-open="help">How to use</button><button type="button" data-open="about">About</button></nav>
    </header>
    <main class="work">
      <section class="stage" id="stage">
        ${VIEWS.map(([id]) => `<div id="main-${id}" hidden></div>`).join("")}
        <p class="mono muted" id="logline" aria-live="polite" style="padding-top:8px"></p>
      </section>
      <aside class="side" aria-label="Controls">${VIEWS.map(([id]) => `<div id="side-${id}" hidden></div>`).join("")}</aside>
    </main>
  </div>
  ${dialog("help", "How to use", HELP)}
  ${dialog("about", "About", ABOUT)}`;

  const byId = (id: string) => document.getElementById(id)!;
  const stage = byId("stage");
  /** Each view writes to the log line only while it is on screen. */
  const logFor = (id: ViewId) => (text: string) => { if (id === current) byId("logline").textContent = text; };
  const fromHash = (): ViewId => { const v = location.hash.slice(1); return v === "waves" || v === "earth" ? v : "quake"; };
  let current: ViewId = fromHash();
  const room = () => ({ w: stage.clientWidth - 40, h: stage.clientHeight - 26 - 28 });
  const views: Record<ViewId, View> = {
    quake: createQuake(byId("main-quake"), byId("side-quake"), room, logFor("quake")),
    waves: createWaves(byId("main-waves"), byId("side-waves"), room),
    earth: createEarth(byId("main-earth"), byId("side-earth"), room, logFor("earth")),
  };

  function show(id: ViewId) {
    current = id;
    for (const [v] of VIEWS) { byId(`main-${v}`).hidden = v !== id; byId(`side-${v}`).hidden = v !== id; }
    document.querySelectorAll<HTMLButtonElement>("[data-view]").forEach((b) => {
      if (b.dataset.view === id) b.setAttribute("aria-current", "step"); else b.removeAttribute("aria-current");
    });
    history.replaceState(null, "", id === "quake" ? location.pathname + location.search : `#${id}`);
    byId("logline").textContent = "";
    views[id].resize();
  }
  document.querySelectorAll<HTMLButtonElement>("[data-view]").forEach((b) => b.addEventListener("click", () => show(b.dataset.view as ViewId)));
  addEventListener("keydown", (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || document.querySelector("dialog[open]")) return;
    views[current].key(e);
  });
  new ResizeObserver(() => views[current].resize()).observe(stage);

  document.querySelectorAll<HTMLButtonElement>("[data-open]").forEach((b) => b.addEventListener("click", () => (byId(b.dataset.open!) as HTMLDialogElement).showModal()));
  document.querySelectorAll<HTMLDialogElement>("dialog").forEach((d) => {
    d.querySelector("[data-close]")!.addEventListener("click", () => d.close());
    d.addEventListener("click", (e) => { if (e.target === d) d.close(); });
  });
  show(current);
  const loop = () => { views[current].frame(); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  // For checking from the console: run frames by hand (animation frames stop while the page is hidden).
  Object.assign(window, { playgroundFrames: (n: number) => { for (let i = 0; i < n; i++) views[current].frame(); } });
}
