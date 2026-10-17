// Elastic waves in a vertical slice of the Earth (P-SV): particle velocity (vx, vz) and stress (sxx, szz, sxz)
// on a staggered grid, fourth order in space (second order within two cells of air), second order in time. Open
// sides end in a convolutional perfectly matched layer (C-PML; Komatitsch and Martin 2007).
// Air is vacuum (no stiffness, no mass), which makes the ground surface free, mountains included. Liquids have
// no shear stiffness, so S waves cannot enter them.
//
// Planes in fld: vx, vz, sxx, szz, sxz, ux, uz (displacement, for the particle view). Two layers of these: the
//                quake's waves, and (when the view has noise sources) the waves of the noise sources, kept apart
//                because the quake's are scaled by magnitude later and the noise is already in m/s.
// Planes in mat: lambda, mu, mu at the cell corner, 1/rho at vx and at vz, second-order flags (1: along x,
//                2: along z; set together, within two cells of air), kind (0 air, 1 liquid, 2 solid), loss factor per step (attenuation, simplified).
// pml: the C-PML's coefficients a, b at whole and half cells along x (4 nx) and z (4 nz), then per layer its 8
//      memory variables, one for each derivative (stored on the whole grid, used only in the layer).
// One step: velocity (with the noise forces), record, stress (with the quake), tick.

struct Params {
  nx: u32, nz: u32, n: u32, samples: u32,
  dt: f32, h: f32, f0: f32, t0: f32,
  si: i32, sj: i32, amp: f32, nst: u32,
  mxx: f32, mzz: f32, mxz: f32, on: f32,
  x0: u32, z0: u32, w: u32, vh: u32,
  gp: f32, gs: f32, gm: f32, nmix: f32,
  nn: u32, lay0: u32, nlayers: u32, rs: u32,     // noise sources; first layer and layers stepped; record stride
  nloss: f32, every: u32, pmlx: u32, pmlz: u32,  // the noise layer's loss per step (rock losing energy, simplified); record every this many steps; PML widths (cells): left | right << 16, bottom | top << 16
  // noise sources: (i, j, force, -) and the filter that colours their random force (a1, a2, envelope, norm)
  ns: array<vec4f, 8>,
};
@group(0) @binding(0) var<uniform> p: Params;
@group(0) @binding(1) var<storage, read_write> fld: array<f32>;
@group(0) @binding(2) var<storage, read> mat: array<f32>;
@group(0) @binding(3) var<storage, read_write> clock: array<u32>;
@group(0) @binding(4) var<storage, read> stations: array<u32>;
@group(0) @binding(5) var<storage, read_write> rec: array<f32>;
@group(0) @binding(6) var picture: texture_storage_2d<rgba16float, write>;
@group(0) @binding(7) var<storage, read_write> noise: array<f32>;   // per source: y1, y2, envelope, force now
// A quake rupturing along a fault: count, box (i0, i1, j0, j1), -, -, -, then per part i, j, delay, mxx, mzz, mxz, share, -.
@group(0) @binding(8) var<storage, read> rupture: array<f32>;
@group(0) @binding(9) var<storage, read_write> pml: array<f32>;

const VX = 0u; const VZ = 1u; const SXX = 2u; const SZZ = 3u; const SXZ = 4u; const UX = 5u; const UZ = 6u;
const LAM = 0u; const MU = 1u; const MUXZ = 2u; const BX = 3u; const BZ = 4u; const LOW = 5u; const KIND = 6u; const DAMP = 7u;
const C1 = 1.125; const C2 = -0.041666667;

var<private> base: u32;   // the layer being stepped: 0 the quake, 7 n the noise
fn F(q: u32, k: i32) -> f32 { return fld[base + q * p.n + u32(k)]; }
fn M(q: u32, k: i32) -> f32 { return mat[q * p.n + u32(k)]; }
fn put(q: u32, k: i32, v: f32) { fld[base + q * p.n + u32(k)] = v; }

// Differences over one cell: forward (k to k+s) and backward (k-s to k), s = 1 along x, nx along z.
fn fwd(q: u32, k: i32, s: i32, lo: bool) -> f32 {
  let a = F(q, k + s) - F(q, k);
  if (lo) { return a; }
  return C1 * a + C2 * (F(q, k + 2 * s) - F(q, k - s));
}
fn bwd(q: u32, k: i32, s: i32, lo: bool) -> f32 {
  let a = F(q, k) - F(q, k - s);
  if (lo) { return a; }
  return C1 * a + C2 * (F(q, k + s) - F(q, k - 2 * s));
}
fn inside(g: vec3u) -> bool { return g.x >= 2u && g.y >= 2u && g.x + 2u < p.nx && g.y + 2u < p.nz; }

// The C-PML: a derivative d at a node becomes d + psi, psi <- b psi + a d (kappa = 1), with a and b for the node's
// position (whole or half cell) along the derivative's direction. q: which of the 8 memory variables.
fn inPml(g: vec3u) -> bool {
  return g.x < (p.pmlx & 0xffffu) || g.x + (p.pmlx >> 16u) >= p.nx || g.y + (p.pmlz & 0xffffu) >= p.nz || g.y < (p.pmlz >> 16u);
}
fn absorb(q: u32, layer: u32, k: i32, d: f32, a: u32, b: u32) -> f32 {
  let o = 4u * (p.nx + p.nz) + (layer * 8u + q) * p.n + u32(k);
  let s = pml[b] * pml[o] + pml[a] * d;
  pml[o] = s;
  return d + s;
}
// Where a and b are kept: along x at cell i (half: at i + 1/2), along z at row j (half: at j + 1/2); b follows a.
fn ax(i: u32, half: u32) -> u32 { return 2u * half * p.nx + i; }
fn az(j: u32, half: u32) -> u32 { return 4u * p.nx + 2u * half * p.nz + j; }

@compute @workgroup_size(16, 16)
fn velocity(@builtin(global_invocation_id) g: vec3u) {
  if (!inside(g)) { return; }
  let layer = g.z + p.lay0; base = layer * 7u * p.n;
  let nx = i32(p.nx); let k = i32(g.y) * nx + i32(g.x);
  let low = u32(M(LOW, k)); let lox = (low & 1u) != 0u; let loz = (low & 2u) != 0u;
  let d = M(DAMP, k) * select(1.0, p.nloss, layer == 1u); let c = p.dt / p.h;
  // Noise sources: a random vertical force at a spot on the surface, as from traffic, machines or ocean waves.
  var fz = 0.0;
  if (layer == 1u) {
    for (var s = 0u; s < p.nn; s++) {
      let a = p.ns[2u * s];
      let di = f32(i32(g.x)) - a.x; let dj = f32(i32(g.y)) - a.y; let r2 = di * di + dj * dj;
      if (r2 <= 9.0) { fz += a.z * noise[4u * s + 3u] * exp(-0.5 * r2); }
    }
  }
  // vx lives at (i + 1/2, j), vz at (i, j + 1/2)
  var sxx_x = fwd(SXX, k, 1, lox); var sxz_z = bwd(SXZ, k, nx, loz);
  var sxz_x = bwd(SXZ, k, 1, lox); var szz_z = fwd(SZZ, k, nx, loz);
  if (inPml(g)) {
    sxx_x = absorb(0u, layer, k, sxx_x, ax(g.x, 1u), ax(g.x, 1u) + p.nx);
    sxz_z = absorb(1u, layer, k, sxz_z, az(g.y, 0u), az(g.y, 0u) + p.nz);
    sxz_x = absorb(2u, layer, k, sxz_x, ax(g.x, 0u), ax(g.x, 0u) + p.nx);
    szz_z = absorb(3u, layer, k, szz_z, az(g.y, 1u), az(g.y, 1u) + p.nz);
  }
  let vx = (F(VX, k) + c * M(BX, k) * (sxx_x + sxz_z)) * d;
  let vz = (F(VZ, k) + c * M(BZ, k) * (sxz_x + szz_z + fz)) * d;
  put(VX, k, vx); put(VZ, k, vz);
  put(UX, k, (F(UX, k) + p.dt * vx) * d);
  put(UZ, k, (F(UZ, k) + p.dt * vz) * d);
}

@compute @workgroup_size(16, 16)
fn stress(@builtin(global_invocation_id) g: vec3u) {
  if (!inside(g)) { return; }
  let layer = g.z + p.lay0; base = layer * 7u * p.n;
  let nx = i32(p.nx); let i = i32(g.x); let j = i32(g.y); let k = j * nx + i;
  let low = u32(M(LOW, k)); let lox = (low & 1u) != 0u; let loz = (low & 2u) != 0u;
  let d = M(DAMP, k) * select(1.0, p.nloss, layer == 1u); let c = p.dt / p.h;
  let lam = M(LAM, k); let mu = M(MU, k); let muxz = M(MUXZ, k);
  // sxx, szz live at (i, j), sxz at the corner (i + 1/2, j + 1/2)
  var dvxdx = bwd(VX, k, 1, lox); var dvzdz = bwd(VZ, k, nx, loz);
  var dvxdz = fwd(VX, k, nx, loz); var dvzdx = fwd(VZ, k, 1, lox);
  if (inPml(g)) {
    dvxdx = absorb(4u, layer, k, dvxdx, ax(g.x, 0u), ax(g.x, 0u) + p.nx);
    dvzdz = absorb(5u, layer, k, dvzdz, az(g.y, 0u), az(g.y, 0u) + p.nz);
    dvxdz = absorb(6u, layer, k, dvxdz, az(g.y, 1u), az(g.y, 1u) + p.nz);
    dvzdx = absorb(7u, layer, k, dvzdx, ax(g.x, 1u), ax(g.x, 1u) + p.nx);
  }
  var sxx = F(SXX, k) + c * ((lam + 2.0 * mu) * dvxdx + lam * dvzdz);
  var szz = F(SZZ, k) + c * (lam * dvxdx + (lam + 2.0 * mu) * dvzdz);
  var sxz = F(SXZ, k) + c * muxz * (dvxdz + dvzdx);
  // The source: a moment tensor (earthquake or explosion) with a Ricker moment rate, spread over a few cells. A moment
  // acts on the stress with the opposite sign (sigma -= dM/dt), so an explosion (M = +I) pushes outward first. The
  // spread is centred on the source for sxx and szz (cell centres) and for sxz too (cell corners, half a cell over).
  if (layer == 0u && p.on > 0.5 && M(KIND, k) > 0.5) {
    let di = f32(i - p.si); let dj = f32(j - p.sj);
    let t = f32(clock[0]) * p.dt - p.t0;
    let a = 3.14159265 * p.f0 * t;
    let w = (1.0 - 2.0 * a * a) * exp(-a * a) * p.amp * p.dt;
    let r2 = di * di + dj * dj; let r2c = (di + 0.5) * (di + 0.5) + (dj + 0.5) * (dj + 0.5);
    if (r2 <= 9.0) { sxx -= w * exp(-0.5 * r2) * p.mxx; szz -= w * exp(-0.5 * r2) * p.mzz; }
    if (r2c <= 9.0 && muxz > 0.0) { sxz -= w * exp(-0.5 * r2c) * p.mxz; }
  }
  // A rupture: each part of the fault slips in turn, as the rupture front reaches it.
  let parts = u32(rupture[0]);
  if (layer == 0u && parts > 0u && M(KIND, k) > 0.5 && f32(i) >= rupture[1] && f32(i) <= rupture[2] && f32(j) >= rupture[3] && f32(j) <= rupture[4]) {
    for (var s = 0u; s < parts; s++) {
      let o = 8u + 8u * s;
      let di = f32(i) - rupture[o]; let dj = f32(j) - rupture[o + 1u];
      let r2 = di * di + dj * dj; let r2c = (di + 0.5) * (di + 0.5) + (dj + 0.5) * (dj + 0.5);
      if (r2 > 9.0 && r2c > 9.0) { continue; }
      let t = f32(clock[0]) * p.dt - p.t0 - rupture[o + 2u];
      let a = 3.14159265 * p.f0 * t;
      let w = (1.0 - 2.0 * a * a) * exp(-a * a) * p.amp * p.dt * rupture[o + 6u];
      if (r2 <= 9.0) { sxx -= w * exp(-0.5 * r2) * rupture[o + 3u]; szz -= w * exp(-0.5 * r2) * rupture[o + 4u]; }
      if (r2c <= 9.0 && muxz > 0.0) { sxz -= w * exp(-0.5 * r2c) * rupture[o + 5u]; }
    }
  }
  put(SXX, k, sxx * d); put(SZZ, k, szz * d); put(SXZ, k, sxz * d);
}

// The clock (quake steps, and noise steps) and the noise sources' forces for the next step: white noise through
// a resonator (a1, a2) that gives each kind of source its own frequencies, optionally swelling and fading
// (traffic: vehicles coming and going), scaled to RMS 1.
fn rand(a: u32) -> f32 {
  var h = a * 747796405u + 2891336453u;
  h = ((h >> ((h >> 28u) + 4u)) ^ h) * 277803737u;
  h = (h >> 22u) ^ h;
  return f32(h) / 4294967296.0 - 0.5;
}
@compute @workgroup_size(1)
fn tick() {
  if (p.lay0 == 0u) { clock[0] = clock[0] + 1u; }
  if (p.nlayers + p.lay0 < 2u) { return; }
  let t = clock[1]; clock[1] = t + 1u;
  for (var s = 0u; s < p.nn; s++) {
    let f = p.ns[2u * s + 1u]; let o = 4u * s;
    let y = f.x * noise[o] - f.y * noise[o + 1u] + rand(t * 16u + 2u * s);
    noise[o + 1u] = noise[o]; noise[o] = y;
    var g = 1.0;
    if (f.z > 0.0) {
      let e = f.z * noise[o + 2u] + sqrt(12.0 * (1.0 - f.z * f.z)) * rand(t * 16u + 2u * s + 1u);
      noise[o + 2u] = e;
      g = (0.4 + e * e) / 1.99;
    }
    noise[o + 3u] = y * f.w * g;
  }
}

// Seismometers: ground velocity at each station's cell, one sample every `every` steps; the noise layer's after the quake's
// (from sample * stations * 2 on).
@compute @workgroup_size(64)
fn record(@builtin(global_invocation_id) g: vec3u) {
  let s = g.x; let c = clock[0];
  if (c % p.every != 0u) { return; }
  let at = c / p.every;
  if (s >= p.nst || at >= p.samples) { return; }
  let k = i32(stations[s]); let nx = i32(p.nx);
  for (var l = 0u; l < p.nlayers; l++) {
    base = l * 7u * p.n;
    let o = l * p.rs + (at * p.nst + s) * 2u;
    rec[o] = 0.5 * (F(VX, k) + F(VX, k - 1));
    rec[o + 1u] = 0.5 * (F(VZ, k) + F(VZ, k - nx));
  }
}

// The picture: P (divergence), S (curl) and shaking (speed of the ground) for each cell on screen, quake and noise.
@compute @workgroup_size(16, 16)
fn show(@builtin(global_invocation_id) g: vec3u) {
  if (g.x >= p.w || g.y >= p.vh) { return; }
  let nx = i32(p.nx); let i = i32(g.x + p.x0); let j = i32(g.y + p.z0); let k = j * nx + i;
  var out = vec4f(0.0);
  if (i > 0 && j > 0 && i + 1 < nx && j + 1 < i32(p.nz) && M(KIND, k) > 0.5) {
    base = 0u;
    out = waves(k, nx);
    // the noise waves (in m/s), brought to the quake's scale
    if (p.nlayers > 1u) { base = 7u * p.n; let w = waves(k, nx); out = vec4f(out.xy + p.nmix * w.xy, sqrt(out.z * out.z + p.nmix * p.nmix * w.z * w.z), 1.0); }
    out = clamp(out * vec4f(p.gp, p.gs, p.gm, 1.0), vec4f(-4000.0), vec4f(4000.0));
  }
  textureStore(picture, vec2i(g.xy), out);
}
// P, S and ground speed at cell k of the current layer.
fn waves(k: i32, nx: i32) -> vec4f {
    let dv = (F(VX, k) - F(VX, k - 1)) + (F(VZ, k) - F(VZ, k - nx));
    let c0 = (F(VX, k + nx) - F(VX, k)) - (F(VZ, k + 1) - F(VZ, k));
    let c1 = (F(VX, k + nx - 1) - F(VX, k - 1)) - (F(VZ, k) - F(VZ, k - 1));
    let c2 = (F(VX, k) - F(VX, k - nx)) - (F(VZ, k - nx + 1) - F(VZ, k - nx));
    let c3 = (F(VX, k - 1) - F(VX, k - 1 - nx)) - (F(VZ, k - nx) - F(VZ, k - 1 - nx));
    let curl = 0.25 * (c0 + c1 + c2 + c3);
    let vx = 0.5 * (F(VX, k) + F(VX, k - 1)); let vz = 0.5 * (F(VZ, k) + F(VZ, k - nx));
    return vec4f(dv, curl, sqrt(vx * vx + vz * vz), 1.0);
}
