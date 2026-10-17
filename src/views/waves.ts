// View 2, Wave types: the four kinds of earthquake wave race across 60 km of rock, side by side. Each lane is a
// lattice of rock particles moved by the wave (exact formulas, not the simulation): P pushes and pulls along the
// direction of travel, S shakes across it, a Love wave shakes the ground sideways (toward you and away), a Rayleigh
// wave rolls it backwards in ellipses; both surface waves fade with depth. Follow the rust dots; their rings mark where they rest.

import { INK, LINE, MONO, MUTED, NAVY, OCHRE, RUST, SERIF, TEAL, label, star, surface } from "../plot";
import { type Room, type View } from "./view";

const KM = 60;                     // lane length
const PERIOD = 2.5;                // seconds per wave cycle
const COLS = 49;                   // particles along a lane (every 1.25 km)
interface Lane { id: "p" | "s" | "l" | "r"; name: string; sub: string; v: number; rows: number; colour: string }
const LANES: Lane[] = [
  { id: "p", name: "P wave", sub: "primary · push and pull · 6.0 km/s", v: 6.0, rows: 4, colour: RUST },
  { id: "s", name: "S wave", sub: "secondary · up and down or side to side · 3.5 km/s", v: 3.5, rows: 4, colour: NAVY },
  { id: "l", name: "Love wave", sub: "surface · shakes the ground sideways, toward you and away · 3.4 km/s", v: 3.4, rows: 5, colour: TEAL },
  { id: "r", name: "Rayleigh wave", sub: "surface · rolls the ground like a swell · 3.2 km/s", v: 3.2, rows: 5, colour: INK },
];
const END = KM / LANES[3].v;       // when the slowest wave arrives

export function createWaves(main: HTMLElement, side: HTMLElement, room: Room): View {
  main.innerHTML = `<canvas class="lanes" id="wCanvas"></canvas>`;
  side.innerHTML = `
    <div class="pane">
      <h2>Four kinds of wave</h2>
      <p>An earthquake sends out four kinds of wave at the same moment, from the left. Watch which arrives first, and how each one moves the ground. Follow the rust dots: their rings show where they rest.</p>
      <label class="slider"><span class="lbl">Speed</span><output id="wSpeedOut"></output><input type="range" id="wSpeed" min="0.25" max="4" step="0.25" value="1.5"></label>
      <div class="row"><button type="button" class="btn" id="wPlay">Pause</button><button type="button" class="btn" id="wRestart">Restart</button></div>
    </div>
    <div class="pane">
      <ul class="key">
        <li><i class="swatch sw-p"></i><div><b>P wave · push and pull</b><span>Squeezes (rust) and stretches (ochre) the rock along the way it travels, like a slinky. The fastest, about 6 km/s in rock. It also travels through water, magma and air: it is a kind of sound.</span></div></li>
        <li><i class="swatch sw-s"></i><div><b>S wave · side to side</b><span>Shakes the rock across the way it travels, like a flicked rope. About 3.5 km/s. A liquid cannot be bent sideways, so S waves stop at water, magma and the Earth's liquid outer core.</span></div></li>
        <li><i class="swatch sw-l"></i><div><b>Love wave · sideways</b><span>A surface wave that shakes the ground from side to side, across the way it travels (here toward you and away). Faster than Rayleigh waves; it needs softer rock on top of stiffer rock. Named after Augustus Love (1911).</span></div></li>
        <li><i class="swatch sw-r"></i><div><b>Rayleigh wave · rolling</b><span>At the surface the ground rolls in ellipses, backwards at the top, like an ocean swell. The slowest, and it fades with depth, but it often shakes the ground the most. Named after Lord Rayleigh (1885).</span></div></li>
      </ul>
    </div>`;

  const canvas = document.getElementById("wCanvas") as HTMLCanvasElement;
  const speedEl = document.getElementById("wSpeed") as HTMLInputElement, playEl = document.getElementById("wPlay")!;
  let t = 0, speed = 1.5, playing = true, last = performance.now(), hold = 0;
  const showSpeed = () => { speed = +speedEl.value; document.getElementById("wSpeedOut")!.textContent = `${speed} s per second`; };
  speedEl.addEventListener("input", showSpeed); showSpeed();
  const setPlaying = (on: boolean) => { playing = on; playEl.textContent = on ? "Pause" : "Play"; };
  playEl.addEventListener("click", () => setPlaying(!playing));
  const restart = () => { t = 0; hold = 0; setPlaying(true); };
  document.getElementById("wRestart")!.addEventListener("click", restart);

  function draw() {
    const { c, w, h } = surface(canvas);
    const L = 34, R = w - 18, span = R - L, dx = span / (COLS - 1);
    const A = dx * 0.42;
    c.font = MONO(10); c.fillStyle = MUTED; c.textBaseline = "alphabetic"; c.textAlign = "left";
    c.fillText(`THE QUAKE IS ON THE LEFT · ${KM} KM OF ROCK`, 0, 12);
    c.font = MONO(12); c.fillStyle = INK; c.textAlign = "right";
    c.fillText(`${t.toFixed(1)} s after the quake`, w - 4, 12);
    const laneH = (h - 26) / LANES.length;

    LANES.forEach((lane, li) => {
      const y0 = 26 + li * laneH, surfaceLane = lane.id === "r" || lane.id === "l", fieldTop = y0 + (lane.id === "r" || lane.id === "l" ? 50 : 40), fieldBottom = y0 + laneH - 30;
      const fieldH = fieldBottom - fieldTop, dy = fieldH / (lane.rows - 1);
      const front = Math.min(KM, lane.v * t), frontX = L + (front / KM) * span, arrived = lane.v * t >= KM;
      c.font = SERIF(17); c.fillStyle = INK; c.textAlign = "left"; c.textBaseline = "alphabetic";
      c.fillText(lane.name, 0, y0 + 20);
      const nameW = c.measureText(lane.name).width;
      c.font = MONO(10); c.fillStyle = MUTED;
      c.fillText(lane.sub, nameW + 12, y0 + 20);
      c.textAlign = "right";
      if (arrived) { c.fillStyle = lane.colour; c.font = "bold 11px ui-monospace, SFMono-Regular, monospace"; c.fillText(`arrived after ${(KM / lane.v).toFixed(1)} s`, R, y0 + 20); }
      if (li) { c.strokeStyle = LINE; c.lineWidth = 1; c.beginPath(); c.moveTo(0, y0 + 0.5); c.lineTo(w, y0 + 0.5); c.stroke(); }

      const phase = (km: number) => {
        const tau = t - km / lane.v;
        return tau <= 0 ? null : { s: Math.sin((2 * Math.PI * tau) / PERIOD), co: Math.cos((2 * Math.PI * tau) / PERIOD), e: Math.min(1, tau / (0.5 * PERIOD)) ** 2 };
      };

      // colour bands: squeeze and stretch for P, the two directions of shear for S
      if (!surfaceLane) {
        for (let col = 0; col < COLS; col++) {
          const ph = phase((col / (COLS - 1)) * KM);
          if (!ph) continue;
          const strain = ph.co * ph.e;
          c.globalAlpha = 0.28 * Math.abs(strain);
          c.fillStyle = lane.id === "p" ? (strain > 0 ? RUST : OCHRE) : (strain > 0 ? NAVY : TEAL);
          c.fillRect(L + (col - 0.5) * dx, fieldTop - 12, dx, fieldH + 24);
        }
        c.globalAlpha = 1;
      }

      /** A particle's place now and at rest: [x, y, x0, y0]. */
      const pos = (col: number, row: number) => {
        const km = (col / (COLS - 1)) * KM, x0 = L + col * dx, y = fieldTop + row * dy, ph = phase(km);
        if (!ph) return [x0, y, x0, y];
        if (lane.id === "p") return [x0 + A * ph.e * ph.s, y, x0, y];
        if (lane.id === "s") return [x0, y - A * ph.e * ph.s, x0, y];
        if (lane.id === "l") return [x0, y, x0, y];
        const f = Math.exp(-row / 2.4) * ph.e * 1.15;
        return [x0 - 0.68 * A * f * ph.s, y - A * f * ph.co, x0, y];
      };
      // the surface lane's ground line follows the top row of particles
      if (surfaceLane) {
        c.beginPath();
        c.moveTo(0, fieldTop - dy * 0.5);
        for (let col = 0; col < COLS; col++) { const [x, y] = pos(col, 0); c.lineTo(x, y - dy * 0.5); }
        c.lineTo(w, fieldTop - dy * 0.5);
        c.strokeStyle = INK; c.lineWidth = 1.4; c.stroke();
        c.font = MONO(10); c.fillStyle = MUTED; c.textAlign = "right"; c.textBaseline = "bottom";
        c.fillText("ground surface", R, fieldTop - dy * 0.5 - 6);
      }

      for (let row = 0; row < lane.rows; row++) for (let col = 0; col < COLS; col++) {
        const [x, y, x0, y0r] = pos(col, row);
        const follow = col % 8 === 4 && row === (surfaceLane ? 0 : Math.floor(lane.rows / 2));
        if (lane.id === "l") {
          // motion across the slice: toward you (bigger, dark) or away (smaller, pale), fading with depth
          const ph = phase((col / (COLS - 1)) * KM), u = ph ? Math.exp(-row / 2.4) * ph.e * ph.s : 0;
          c.beginPath(); c.arc(x, y, Math.max(0.8, (follow ? 4.2 : 2.4) * (1 + 0.75 * u)), 0, 2 * Math.PI);
          c.globalAlpha = 0.55 + 0.45 * Math.max(0, u) + (follow ? 0.4 : 0);
          c.fillStyle = follow ? RUST : INK; c.fill(); c.globalAlpha = 1;
          continue;
        }
        if (follow) {
          c.beginPath(); c.arc(x0, y0r, A * 1.15, 0, 2 * Math.PI); c.strokeStyle = "rgba(164,70,42,0.4)"; c.lineWidth = 1; c.stroke();
          c.beginPath(); c.arc(x, y, 4.2, 0, 2 * Math.PI); c.fillStyle = RUST; c.fill();
        } else {
          c.beginPath(); c.arc(x, y, 2.4, 0, 2 * Math.PI); c.fillStyle = INK; c.fill();
        }
      }

      // the quake, and the wave front
      star(c, L - 22, fieldTop + fieldH / 2, 8); c.fillStyle = RUST; c.fill();
      if (!arrived && t > 0) {
        c.setLineDash([4, 4]); c.strokeStyle = lane.colour; c.lineWidth = 1.2;
        c.beginPath(); c.moveTo(frontX, fieldTop - 10); c.lineTo(frontX, fieldBottom + 8); c.stroke(); c.setLineDash([]);
        c.font = MONO(10); c.textAlign = "center"; c.textBaseline = "top";
        label(c, `${front.toFixed(0)} km`, frontX, fieldBottom + 10, lane.colour);
      }
    });
  }

  return {
    frame() {
      const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (playing) {
        if (t < END + 2) t += dt * speed;
        else if ((hold += dt) > 2.5) restart();
      }
      draw();
    },
    resize() {
      const { w, h } = room();
      canvas.style.width = `${w}px`;
      canvas.style.height = `${Math.max(560, Math.min(h, 820))}px`;
    },
    key(e) {
      if (e.key === " ") { e.preventDefault(); playEl.click(); }
      else if (e.key === "r" || e.key === "R") restart();
    },
  };
}
