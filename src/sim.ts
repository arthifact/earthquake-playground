// The GPU wave engine (sim.wgsl, draw.wgsl), one per view. The view owns the ground (P speed, S speed and
// density on the grid); the engine turns it into stiffness and density, runs the steps, records the
// seismometers and draws the picture. Views with noise sources get a second layer of waves for them, stepped
// together with the quake's but kept apart (the quake's are scaled by magnitude later, the noise is in m/s).

import drawCode from "./draw.wgsl?raw";
import { gpu } from "./gpu";
import simCode from "./sim.wgsl?raw";

export interface SimConfig {
  nx: number; nz: number;                // grid cells, absorbing layer included
  h: number;                             // cell size, km
  vmax: number;                          // fastest P speed the ground may have, km/s (sets the time step)
  f0: number;                            // peak frequency of the source, Hz
  sponge: { left: number; right: number; bottom: number; top: number };   // absorbing layer (C-PML) on each side, cells; 0 for none
  view: { x0: number; z0: number; w: number; h: number };   // the cells on screen
  seconds: number;                       // how long the seismometers record, from the start of the source
  every?: number;                        // record one sample every this many steps (default 1: every step)
  stations: number;                      // the most seismometers
  gains: [number, number, number];       // picture scales for P, S and shaking
  dots: number;                          // cells between the dots of the particle look
  noise?: number;                        // the most noise sources (up to 4); none if left out
  noiseLoss?: number;                    // how fast the noise sources' waves lose energy, 1/s (their amplitude falls e times in 1 / this)
}
/** A noise source: a random vertical force near cell (i, j), white noise coloured by the resonator a1, a2 (with an
 *  envelope that swells and fades if env > 0, an AR(1) coefficient), times norm to RMS 1, times force. */
export interface NoiseSource { i: number; j: number; force: number; a1: number; a2: number; env: number; norm: number }
/** The colour of the ground for a P speed, S speed and density: [r, g, b, a] in 0-255, a = 0 for air. */
export type Colour = (vp: number, vs: number, rho: number) => [number, number, number, number];
/** mode 0: P and S waves, 1: shaking, 2: particles. */
export interface Look { mode: number; glow: number; exag: number }

const FIELDS = 7, PLANES = 8, PARAMS = 256;
const PML_R = 1e-4;                    // the absorbing layer's reflection at normal incidence, in theory
const RUPTURE_PARTS = 64, RUPTURE_FLOATS = 8 + 8 * RUPTURE_PARTS;   // a header (count, box), then i, j, delay, mxx, mzz, mxz, share, -
type Grid = Float32Array<ArrayBuffer>;

export class Sim {
  readonly n: number;
  dt: number;
  readonly samples: number;
  /** Steps between seismometer samples, and the steps it takes to fill the record (samples × every). */
  readonly every: number;
  readonly end: number;
  /** The source's peak comes this long after the quake starts (s); seismograms count time from it. */
  t0: number;
  /** Steps since the quake started. */
  step = 0;
  /** Seismometer samples copied back from the GPU so far, and their values: sample, station, (vx, vz). */
  recorded = 0;
  readonly records: Float32Array;
  /** The same for the noise sources' waves alone, in m/s (empty without noise sources). */
  readonly noiseRecords: Float32Array;
  nst = 0;
  /** Noise steps still to run before the noise has spread out (see warm). */
  warming = 0;
  vp: Grid = new Float32Array(0); vs: Grid = new Float32Array(0); rho: Grid = new Float32Array(0);

  private colour: Colour = () => [0, 0, 0, 0];
  private readonly planes: Grid;
  private loss: Float32Array | null = null;
  private readonly rockPixels: Uint8Array<ArrayBuffer>;
  private src = { i: 0, j: 0, m: [0, 0, 0] as [number, number, number], active: 0 };
  private sources: NoiseSource[] = [];
  private noiseMix = 0;
  private lay0 = 0;
  private gen = 0;
  private busy = false;
  private readonly params = new ArrayBuffer(PARAMS);
  private readonly b: Record<"fields" | "mat" | "clock" | "st" | "rec" | "staging" | "params" | "draw" | "noise" | "rupture" | "pml", GPUBuffer>;
  private readonly pmlCoefs: number;
  private readonly tex: { wave: GPUTexture; rock: GPUTexture };
  private readonly pipes: Record<"velocity" | "record" | "stress" | "tick" | "show", GPUComputePipeline> & Record<"full" | "dots", GPURenderPipeline>;
  private readonly group: GPUBindGroup;
  private readonly drawGroup: GPUBindGroup;
  private readonly ctx: GPUCanvasContext;

  static async create(canvas: HTMLCanvasElement, cfg: SimConfig) {
    const { device } = await gpu();
    return new Sim(device, canvas, cfg);
  }

  private constructor(private readonly device: GPUDevice, readonly canvas: HTMLCanvasElement, readonly cfg: SimConfig) {
    const { nx, nz, view } = cfg, n = this.n = nx * nz;
    this.dt = 0.45 * cfg.h / cfg.vmax;
    this.every = Math.max(1, Math.round(cfg.every ?? 1));
    this.samples = Math.ceil(cfg.seconds / (this.dt * this.every));
    this.end = this.samples * this.every;
    this.t0 = 1.2 / cfg.f0;
    this.records = new Float32Array(this.samples * cfg.stations * 2);
    this.noiseRecords = new Float32Array(cfg.noise ? this.records.length : 0);
    const layers = cfg.noise ? 2 : 1;
    this.planes = new Float32Array(PLANES * n);
    this.rockPixels = new Uint8Array(view.w * view.h * 4);

    const { left, right, bottom, top } = cfg.sponge;
    const coefs = this.pmlCoefficients();
    this.pmlCoefs = coefs.length;
    const anyPml = left + right + bottom + top > 0;

    const S = GPUBufferUsage.STORAGE, D = GPUBufferUsage.COPY_DST, C = GPUBufferUsage.COPY_SRC;
    const buffer = (size: number, usage: number) => device.createBuffer({ size: Math.max(16, size), usage });
    this.b = {
      fields: buffer(layers * FIELDS * n * 4, S | D | C),
      mat: buffer(PLANES * n * 4, S | D),
      clock: buffer(16, S | D),
      st: buffer(cfg.stations * 4, S | D),
      rec: buffer(layers * this.records.byteLength, S | D | C),
      staging: buffer(layers * this.records.byteLength, GPUBufferUsage.MAP_READ | D),
      params: buffer(PARAMS, GPUBufferUsage.UNIFORM | D),
      draw: buffer(64, GPUBufferUsage.UNIFORM | D),
      noise: buffer(4 * 4 * 4, S | D),
      rupture: buffer(RUPTURE_FLOATS * 4, S | D),
      pml: buffer((coefs.length + (anyPml ? layers * 8 * n : 0)) * 4, S | D),
    };
    device.queue.writeBuffer(this.b.pml, 0, coefs);
    this.tex = {
      wave: device.createTexture({ size: [view.w, view.h], format: "rgba16float", usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING }),
      rock: device.createTexture({ size: [view.w, view.h], format: "rgba8unorm", usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST }),
    };

    const CS = GPUShaderStage.COMPUTE, VS = GPUShaderStage.VERTEX, FS = GPUShaderStage.FRAGMENT;
    const simLayout = device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: CS, buffer: { type: "uniform" } },
      { binding: 1, visibility: CS, buffer: { type: "storage" } },
      { binding: 2, visibility: CS, buffer: { type: "read-only-storage" } },
      { binding: 3, visibility: CS, buffer: { type: "storage" } },
      { binding: 4, visibility: CS, buffer: { type: "read-only-storage" } },
      { binding: 5, visibility: CS, buffer: { type: "storage" } },
      { binding: 6, visibility: CS, storageTexture: { access: "write-only", format: "rgba16float" } },
      { binding: 7, visibility: CS, buffer: { type: "storage" } },
      { binding: 8, visibility: CS, buffer: { type: "read-only-storage" } },
      { binding: 9, visibility: CS, buffer: { type: "storage" } },
    ] });
    const drawLayout = device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: VS | FS, buffer: { type: "uniform" } },
      { binding: 1, visibility: FS, sampler: { type: "filtering" } },
      { binding: 2, visibility: FS, texture: { sampleType: "float" } },
      { binding: 3, visibility: FS, texture: { sampleType: "float" } },
      { binding: 4, visibility: VS, buffer: { type: "read-only-storage" } },
      { binding: 5, visibility: VS, buffer: { type: "read-only-storage" } },
    ] });
    const simModule = device.createShaderModule({ code: simCode }), drawModule = device.createShaderModule({ code: drawCode });
    const simPipes = device.createPipelineLayout({ bindGroupLayouts: [simLayout] });
    const drawPipes = device.createPipelineLayout({ bindGroupLayouts: [drawLayout] });
    const compute = (entryPoint: string) => device.createComputePipeline({ layout: simPipes, compute: { module: simModule, entryPoint } });
    const format = navigator.gpu.getPreferredCanvasFormat();
    const blend: GPUBlendState = { color: { srcFactor: "one", dstFactor: "one-minus-src-alpha" }, alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" } };
    this.pipes = {
      velocity: compute("velocity"), record: compute("record"), stress: compute("stress"), tick: compute("tick"), show: compute("show"),
      full: device.createRenderPipeline({ layout: drawPipes, vertex: { module: drawModule, entryPoint: "vfull" }, fragment: { module: drawModule, entryPoint: "ffull", targets: [{ format }] } }),
      dots: device.createRenderPipeline({ layout: drawPipes, vertex: { module: drawModule, entryPoint: "vdot" }, fragment: { module: drawModule, entryPoint: "fdot", targets: [{ format, blend }] } }),
    };
    const b = this.b;
    this.group = device.createBindGroup({ layout: simLayout, entries: [
      { binding: 0, resource: { buffer: b.params } }, { binding: 1, resource: { buffer: b.fields } }, { binding: 2, resource: { buffer: b.mat } },
      { binding: 3, resource: { buffer: b.clock } }, { binding: 4, resource: { buffer: b.st } }, { binding: 5, resource: { buffer: b.rec } },
      { binding: 6, resource: this.tex.wave.createView() }, { binding: 7, resource: { buffer: b.noise } },
      { binding: 8, resource: { buffer: b.rupture } }, { binding: 9, resource: { buffer: b.pml } },
    ] });
    this.drawGroup = device.createBindGroup({ layout: drawLayout, entries: [
      { binding: 0, resource: { buffer: b.draw } }, { binding: 1, resource: device.createSampler({ magFilter: "linear", minFilter: "linear" }) },
      { binding: 2, resource: this.tex.rock.createView() }, { binding: 3, resource: this.tex.wave.createView() },
      { binding: 4, resource: { buffer: b.fields } }, { binding: 5, resource: { buffer: b.mat } },
    ] });
    this.ctx = canvas.getContext("webgpu")!;
    this.ctx.configure({ device, format, alphaMode: "opaque" });
    this.writeParams();
  }

  /** The open sides end in a convolutional perfectly matched layer (C-PML; Komatitsch and Martin 2007): each
   *  derivative there gets a memory variable psi <- b psi + a d, with damping d growing as the square of the depth
   *  into the layer (for a reflection of PML_R at normal incidence) and alpha = pi f0 falling to 0 at its far side,
   *  so grazing and slow waves are taken too. a and b at whole and half cells, along x then z. */
  private pmlCoefficients() {
    const { nx, nz, h, vmax, f0 } = this.cfg, { left, right, bottom, top } = this.cfg.sponge, dt = this.dt;
    const coefs = new Float32Array(4 * (nx + nz));
    const profile = (o: number, count: number, lo: number, hi: number) => {
      for (let half = 0; half < 2; half++) for (let q = 0; q < count; q++) {
        const at = q + 0.5 * half;
        const into = Math.max(lo > 0 ? (lo - at) / lo : 0, hi > 0 ? (at - (count - 1 - hi)) / hi : 0);
        const x = Math.min(1, Math.max(0, into)), width = (at < count / 2 ? lo : hi) * h;
        const d = x > 0 && width > 0 ? ((3 * vmax * Math.log(1 / PML_R)) / (2 * width)) * x * x : 0;
        const alpha = x > 0 ? Math.PI * f0 * (1 - x) : 0, b = Math.exp(-(d + alpha) * dt);
        coefs[o + 2 * half * count + q] = d > 0 ? (d / (d + alpha)) * (b - 1) : 0;
        coefs[o + (2 * half + 1) * count + q] = d > 0 ? b : 1;
      }
    };
    profile(0, nx, left, right);
    profile(4 * nx, nz, top, bottom);
    return coefs;
  }

  /** The same grid at another scale: cells of h km and a source of f0 Hz (both scaled by the same factor from the
   *  start). Elastic waves look the same when lengths and times scale together, so only the clock, the source and
   *  the absorbing layer change; the record keeps its number of samples, now spanning seconds × the factor. The
   *  ground is still again (and its loss factors need setGround again if they are used). */
  setScale(h: number, f0: number) {
    const k = h / this.cfg.h;
    Object.assign(this.cfg, { h, f0, seconds: this.cfg.seconds * k });
    this.dt = 0.45 * h / this.cfg.vmax;
    this.t0 = 1.2 / f0;
    this.device.queue.writeBuffer(this.b.pml, 0, this.pmlCoefficients());
    this.writeParams();
    this.reset();
  }

  /** A new ground: speeds (km/s) and density (g/cm³) on the whole grid; P speed 0 is air. Optionally how fast
   *  the rock takes energy from the waves (attenuation), as the rate their amplitude falls (1/s) in each cell. */
  setGround(vp: Grid, vs: Grid, rho: Grid, colour: Colour, loss?: Float32Array) {
    this.vp = vp; this.vs = vs; this.rho = rho; this.colour = colour; this.loss = loss ?? null;
    this.update(0, this.cfg.nz - 1);
  }

  /** The ground changed in rows j0 to j1: recompute and upload those rows (and their neighbours). */
  update(j0: number, j1: number) {
    const { nx, nz, view } = this.cfg, n = this.n, P = this.planes, { vp, vs, rho } = this;
    j0 = Math.max(0, j0 - 2); j1 = Math.min(nz - 1, j1 + 2);
    const mu = (k: number) => rho[k] * vs[k] * vs[k];
    for (let j = j0; j <= j1; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i, i1 = Math.min(i + 1, nx - 1), jd = Math.min(j + 1, nz - 1);
      const m = mu(k), m2 = mu(j * nx + i1), m3 = mu(jd * nx + i), m4 = mu(jd * nx + i1);
      P[k] = rho[k] * vp[k] * vp[k] - 2 * m;
      P[n + k] = m;
      // shear stiffness at the cell corner: harmonic mean of the four cells, none next to liquid or air
      P[2 * n + k] = m > 0 && m2 > 0 && m3 > 0 && m4 > 0 ? 4 / (1 / m + 1 / m2 + 1 / m3 + 1 / m4) : 0;
      // 1 / density where vx and vz live; air has no mass, so the surface node carries half a cell of rock
      const rx = 0.5 * (rho[k] + rho[j * nx + i1]), rz = 0.5 * (rho[k] + rho[jd * nx + i]);
      P[3 * n + k] = rx > 0 ? 1 / rx : 0;
      P[4 * n + k] = rz > 0 ? 1 / rz : 0;
      // second order within two cells of air (in both directions). Keeping fourth order along a flat surface
      // looked more accurate, but it went unstable after hours on the round, stair-stepped surface of the Earth view.
      let low = 0;
      for (let b = -2; b <= 2 && !low; b++) for (let a = -2; a <= 2; a++) {
        if (vp[Math.min(nz - 1, Math.max(0, j + b)) * nx + Math.min(nx - 1, Math.max(0, i + a))] <= 0) { low = 3; break; }
      }
      P[5 * n + k] = low;
      P[6 * n + k] = vp[k] <= 0 ? 0 : vs[k] <= 0 ? 1 : 2;
      P[7 * n + k] = this.loss ? Math.exp(-this.loss[k] * this.dt) : 1;
    }
    const q = this.device.queue;
    for (let p = 0; p < PLANES; p++) q.writeBuffer(this.b.mat, (p * n + j0 * nx) * 4, P, p * n + j0 * nx, (j1 - j0 + 1) * nx);

    const y0 = Math.max(0, j0 - view.z0), y1 = Math.min(view.h - 1, j1 - view.z0);
    if (y1 < y0) return;
    const px = this.rockPixels;
    for (let y = y0; y <= y1; y++) for (let x = 0; x < view.w; x++) {
      const k = (y + view.z0) * nx + x + view.x0, o = 4 * (y * view.w + x);
      const c = this.colour(vp[k], vs[k], rho[k]);
      px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = c[3];
    }
    q.writeTexture({ texture: this.tex.rock, origin: [0, y0] }, px, { offset: y0 * view.w * 4, bytesPerRow: view.w * 4 }, [view.w, y1 - y0 + 1]);
  }

  /** Seismometers at these cells (k = j * nx + i). */
  setStations(cells: number[]) {
    this.nst = Math.min(cells.length, this.cfg.stations);
    this.device.queue.writeBuffer(this.b.st, 0, new Uint32Array(cells.slice(0, this.nst)));
    this.writeParams();
  }

  /** Start a quake at cell (i, j) with moment tensor [mxx, mzz, mxz]: the ground is still again first. */
  quake(i: number, j: number, m: [number, number, number]) {
    this.src = { i, j, m, active: 1 };
    this.writeParams();
    this.device.queue.writeBuffer(this.b.rupture, 0, new Float32Array(8));
    this.reset();
  }

  /** No source at all: the ground is still and stays still. */
  still() {
    this.src = { ...this.src, active: 0 };
    this.writeParams();
    this.device.queue.writeBuffer(this.b.rupture, 0, new Float32Array(8));
    this.reset();
  }

  /** Start a quake that ruptures along a fault: up to 64 point sources, each with its own delay (s) after the
   *  first, moment tensor and share of the moment (the shares add up to 1). The ground is still again first. */
  rupture(parts: { i: number; j: number; delay: number; m: [number, number, number]; share: number }[]) {
    parts = parts.slice(0, RUPTURE_PARTS);
    const data = new Float32Array(RUPTURE_FLOATS);
    data[0] = parts.length;
    data[1] = Math.min(...parts.map((q) => q.i)) - 4; data[2] = Math.max(...parts.map((q) => q.i)) + 4;
    data[3] = Math.min(...parts.map((q) => q.j)) - 4; data[4] = Math.max(...parts.map((q) => q.j)) + 4;
    parts.forEach((q, s) => data.set([q.i, q.j, q.delay, q.m[0], q.m[1], q.m[2], q.share, 0], 8 + 8 * s));
    this.device.queue.writeBuffer(this.b.rupture, 0, data);
    this.src = { ...this.src, active: 0 };
    this.writeParams();
    this.reset();
  }

  /** Everything still, the clock and the seismometers back to zero (the source stays where it is). The noise
   *  sources' waves keep going. */
  reset() {
    const e = this.device.createCommandEncoder();
    e.clearBuffer(this.b.fields, 0, FIELDS * this.n * 4); e.clearBuffer(this.b.rec);
    if (this.b.pml.size > this.pmlCoefs * 4) e.clearBuffer(this.b.pml, this.pmlCoefs * 4, 8 * this.n * 4);
    this.device.queue.submit([e.finish()]);
    this.device.queue.writeBuffer(this.b.clock, 0, new Uint32Array([0]));
    this.step = 0; this.recorded = 0; this.records.fill(0); this.noiseRecords.fill(0); this.gen++;
    this.advance(0);
  }

  /** New noise sources (up to cfg.noise): their waves start from still ground, and need warm(warmup) steps to
   *  spread out before the seismometers hear them as they would. */
  setNoise(sources: NoiseSource[], warmup: number) {
    this.sources = sources.slice(0, this.cfg.noise ?? 0);
    const e = this.device.createCommandEncoder();
    if (this.cfg.noise) { e.clearBuffer(this.b.fields, FIELDS * this.n * 4); e.clearBuffer(this.b.noise); }
    if (this.cfg.noise && this.b.pml.size > this.pmlCoefs * 4) e.clearBuffer(this.b.pml, (this.pmlCoefs + 8 * this.n) * 4, 8 * this.n * 4);
    this.device.queue.submit([e.finish()]);
    this.warming = this.sources.length ? warmup : 0;
    this.writeParams();
  }
  /** How the picture shows the noise waves (m/s) next to the quake's (simulation units): this many units per m/s. */
  setNoiseMix(v: number) {
    if (v !== this.noiseMix) { this.noiseMix = v; this.writeParams(); }
  }
  /** Run up to k steps of the noise sources alone (the quake waits): until warming is used up. */
  warm(k: number) {
    k = Math.min(k, this.warming);
    if (k <= 0) return;
    this.lay0 = 1; this.writeParams();
    this.steps(k, 1, false);
    this.lay0 = 0; this.writeParams();
    this.warming -= k;
  }

  /** Run k steps, update the picture, and start copying new seismometer samples back. */
  advance(k: number) {
    this.steps(k, this.sources.length ? 2 : 1, true);
    this.step += k;
    this.pull();
  }

  private steps(k: number, layers: number, record: boolean) {
    const { nx, nz, view } = this.cfg, e = this.device.createCommandEncoder(), pass = e.beginComputePass();
    pass.setBindGroup(0, this.group);
    const gx = Math.ceil(nx / 16), gz = Math.ceil(nz / 16), gs = Math.max(1, Math.ceil(this.nst / 64));
    for (let s = 0; s < k; s++) {
      pass.setPipeline(this.pipes.velocity); pass.dispatchWorkgroups(gx, gz, layers);
      if (this.nst && record) { pass.setPipeline(this.pipes.record); pass.dispatchWorkgroups(gs); }
      pass.setPipeline(this.pipes.stress); pass.dispatchWorkgroups(gx, gz, layers);
      pass.setPipeline(this.pipes.tick); pass.dispatchWorkgroups(1);
    }
    pass.setPipeline(this.pipes.show); pass.dispatchWorkgroups(Math.ceil(view.w / 16), Math.ceil(view.h / 16));
    pass.end();
    this.device.queue.submit([e.finish()]);
  }

  /** Copy seismometer samples recorded since the last copy back from the GPU (one copy at a time). */
  pull() {
    const row = this.nst * 8, a = this.recorded, z = Math.min(Math.ceil(this.step / this.every), this.samples), len = (z - a) * row;
    if (this.busy || this.nst === 0 || z <= a) return;
    const e = this.device.createCommandEncoder(), noise = this.noiseRecords.length > 0;
    e.copyBufferToBuffer(this.b.rec, a * row, this.b.staging, 0, len);
    if (noise) e.copyBufferToBuffer(this.b.rec, this.records.byteLength + a * row, this.b.staging, len, len);
    this.device.queue.submit([e.finish()]);
    this.busy = true;
    const gen = this.gen, staging = this.b.staging, size = noise ? 2 * len : len;
    staging.mapAsync(GPUMapMode.READ, 0, size).then(() => {
      if (gen === this.gen) {
        const got = new Float32Array(staging.getMappedRange(0, size));
        this.records.set(got.subarray(0, len / 4), a * this.nst * 2);
        if (noise) this.noiseRecords.set(got.subarray(len / 4), a * this.nst * 2);
        this.recorded = z;
      }
      staging.unmap();
    }, () => {}).finally(() => { this.busy = false; });
  }

  /** Draw the picture at the canvas's size. */
  render(look: Look) {
    const c = this.canvas, dpr = Math.min(2, window.devicePixelRatio || 1);
    if (!c.clientWidth || !c.clientHeight) return;
    const w = Math.round(c.clientWidth * dpr), h = Math.round(c.clientHeight * dpr);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const { view, dots, nx } = this.cfg, cols = Math.floor(view.w / dots), rows = Math.floor(view.h / dots);
    this.device.queue.writeBuffer(this.b.draw, 0, new Float32Array([look.mode, look.glow, look.exag, 2.1 * dpr, view.w, view.h, w, h, nx, this.n, view.x0, view.z0, cols, rows, dots, 0]));
    const e = this.device.createCommandEncoder();
    const pass = e.beginRenderPass({ colorAttachments: [{ view: this.ctx.getCurrentTexture().createView(), loadOp: "clear", storeOp: "store", clearValue: { r: 0.98, g: 0.976, b: 0.965, a: 1 } }] });
    pass.setBindGroup(0, this.drawGroup);
    pass.setPipeline(this.pipes.full); pass.draw(3);
    if (look.mode === 2) { pass.setPipeline(this.pipes.dots); pass.draw(6, cols * rows); }
    pass.end();
    this.device.queue.submit([e.finish()]);
  }

  /** For checking: the largest P, S, ground speed and displacement on screen, as the picture scales them. */
  async peaks() {
    const { nx, view } = this.cfg, n = this.n, size = FIELDS * n * 4;
    const read = this.device.createBuffer({ size, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const e = this.device.createCommandEncoder(); e.copyBufferToBuffer(this.b.fields, 0, read, 0, size); this.device.queue.submit([e.finish()]);
    await read.mapAsync(GPUMapMode.READ);
    const f = new Float32Array(read.getMappedRange().slice(0)); read.unmap(); read.destroy();
    let p = 0, s = 0, v = 0, u = 0;
    for (let y = 1; y < view.h - 1; y++) for (let x = 1; x < view.w - 1; x++) {
      const k = (y + view.z0) * nx + x + view.x0;
      if (this.vp[k] <= 0) continue;
      p = Math.max(p, Math.abs(f[k] - f[k - 1] + f[n + k] - f[n + k - nx]));
      s = Math.max(s, Math.abs(f[k + nx] - f[k] - f[n + k + 1] + f[n + k]));
      v = Math.max(v, Math.hypot(f[k], f[n + k]));
      u = Math.max(u, Math.hypot(f[5 * n + k], f[6 * n + k]));
    }
    const [gp, gs, gm] = this.cfg.gains;
    return { p: p * gp, s: s * gs, v: v * gm, u, step: this.step };
  }

  private writeParams() {
    const u = new Uint32Array(this.params), f = new Float32Array(this.params), i = new Int32Array(this.params);
    const { nx, nz, h, f0, view, gains } = this.cfg;
    u[0] = nx; u[1] = nz; u[2] = this.n; u[3] = this.samples;
    f[4] = this.dt; f[5] = h; f[6] = f0; f[7] = this.t0;
    i[8] = this.src.i; i[9] = this.src.j; f[10] = 1; u[11] = this.nst;
    f[12] = this.src.m[0]; f[13] = this.src.m[1]; f[14] = this.src.m[2]; f[15] = this.src.active;
    u[16] = view.x0; u[17] = view.z0; u[18] = view.w; u[19] = view.h;
    f[20] = gains[0]; f[21] = gains[1]; f[22] = gains[2]; f[23] = this.noiseMix;
    u[24] = this.sources.length; u[25] = this.lay0; u[26] = this.sources.length && !this.lay0 ? 2 : 1; u[27] = this.records.length;
    f[28] = Math.exp(-(this.cfg.noiseLoss ?? 0) * this.dt); u[29] = this.every;
    const { left, right, bottom, top } = this.cfg.sponge;
    u[30] = left | (right << 16); u[31] = bottom | (top << 16);
    this.sources.forEach((q, s) => f.set([q.i, q.j, q.force, 0, q.a1, q.a2, q.env, q.norm], 32 + 8 * s));
    this.device.queue.writeBuffer(this.b.params, 0, this.params);
  }
}
