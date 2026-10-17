// Runs the validation cases (validation/out/cases.json, from cases.py) through Earthquake Playground's own engine, src/sim.ts,
// with the Quake view's grid, sponge, time step and source, and saves the raw seismograms (simulation units: km/s,
// 2D, no magnitude scaling and no 3D spreading correction) through the validation dev server's /__save.
// Open http://localhost:5178/validation/qv/runner.html (optionally ?case=A_lamb).
import { gpu } from "../../src/gpu";
import { Sim } from "../../src/sim";

interface Case {
  name: string; grid: string; src: [number, number]; m: [number, number, number]; stations: number[]; seconds: number;
  nx: number; nz: number; h: number; sponge: number; w: number; vh: number;
}
interface Meta { vmax: number; f0: number; cases: Case[] }

const logEl = document.getElementById("log")!;
const log = (s: string) => { logEl.textContent += "\n" + s; console.log(s); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const save = (name: string, body: BodyInit) => fetch(`/__save?name=${encodeURIComponent(name)}`, { method: "POST", body });
async function sha(url: string) {
  const text = await (await fetch(url)).text();
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return Array.from(d.slice(0, 8), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function run(meta: Meta, c: Case) {
  const { vmax, f0 } = meta, { nx, nz, h, sponge, w, vh } = c, n = nx * nz;
  const canvas = document.createElement("canvas"); canvas.width = 64; canvas.height = 32; document.body.append(canvas);
  const sim = await Sim.create(canvas, {
    nx, nz, h, vmax, f0, sponge: { left: sponge, right: sponge, bottom: sponge, top: 0 },
    view: { x0: sponge, z0: 0, w, h: vh }, seconds: c.seconds + 1.2 / f0 + 0.2, stations: c.stations.length,
    gains: [1, 1, 1], dots: 12,
  });
  const g = new Float32Array(await (await fetch("/validation/" + c.grid)).arrayBuffer());
  sim.setGround(g.slice(0, n), g.slice(n, 2 * n), g.slice(2 * n, 3 * n), () => [0, 0, 0, 0]);
  sim.setStations(c.stations);
  sim.quake(c.src[0], c.src[1], c.m);
  const t = performance.now();
  while (sim.step < sim.end) {
    // small batches, each finished before the next: long GPU batches freeze the screen (the display shares the GPU)
    sim.advance(Math.min(100, sim.end - sim.step));
    await (await gpu()).device.queue.onSubmittedWorkDone();
    await sleep(1);
  }
  while (sim.recorded < sim.samples) { sim.pull(); await sleep(20); }
  const secs = (performance.now() - t) / 1000;
  await save(`${c.name}.f32`, sim.records.slice());
  await save(`${c.name}.json`, JSON.stringify({ name: c.name, dt: sim.dt, t0: sim.t0, every: sim.every, samples: sim.samples,
    nst: sim.nst, steps: sim.end, wall_s: secs, adapter: navigator.userAgent }));
  canvas.remove();
  log(`${c.name}: ${sim.end} steps in ${secs.toFixed(1)} s`);
}

async function main() {
  const meta: Meta = await (await fetch("/validation/out/cases.json", { cache: "no-store" })).json();
  const only = new URLSearchParams(location.search).get("case");   // a run name, or a prefix ending in "*"
  const engine = { sim_ts: await sha("/src/sim.ts?raw"), sim_wgsl: await sha("/src/sim.wgsl?raw"), date: new Date().toISOString() };
  log(`engine sim.ts ${engine.sim_ts}, sim.wgsl ${engine.sim_wgsl}`);
  const want = (c: Case) => !only || c.name === only || (only.endsWith("*") && c.name.startsWith(only.slice(0, -1)));
  for (const c of meta.cases) if (want(c)) await run(meta, c);
  await save("done.json", JSON.stringify({ ...engine, cases: meta.cases.filter(want).map((c) => c.name) }));
  log("done");
  document.title = "done";
}
main().catch((e) => { log("error: " + (e as Error).message); document.title = "error"; void save("error.txt", String((e as Error).stack ?? e)); });
