// Drawing a simulation: the ground's colours with the waves over them (three looks), and for the particle look
// a lattice of dots that move with the ground (displacement, exaggerated).

struct Draw {
  mode: f32, glow: f32, exag: f32, dot: f32,
  w: f32, h: f32, cw: f32, ch: f32,
  nx: f32, n: f32, x0: f32, z0: f32,
  cols: f32, rows: f32, spacing: f32, pad: f32,
};
@group(0) @binding(0) var<uniform> d: Draw;
@group(0) @binding(1) var smp: sampler;
@group(0) @binding(2) var rock: texture_2d<f32>;
@group(0) @binding(3) var wave: texture_2d<f32>;
@group(0) @binding(4) var<storage, read> fld: array<f32>;
@group(0) @binding(5) var<storage, read> mat: array<f32>;

const PAPER = vec3f(0.980, 0.976, 0.965);
const INK = vec3f(0.145, 0.153, 0.133);
const RUST = vec3f(0.643, 0.275, 0.165);
const OCHRE = vec3f(0.800, 0.561, 0.239);
const NAVY = vec3f(0.071, 0.247, 0.384);
const TEAL = vec3f(0.200, 0.549, 0.620);

struct Full { @builtin(position) pos: vec4f, @location(0) uv: vec2f };

@vertex fn vfull(@builtin(vertex_index) i: u32) -> Full {
  let xy = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  var o: Full;
  o.pos = vec4f(xy * 2.0 - 1.0, 0.0, 1.0);
  o.uv = vec2f(xy.x, 1.0 - xy.y);
  return o;
}

fn heat(t: f32) -> vec3f {
  let a = mix(PAPER, vec3f(0.86, 0.65, 0.35), smoothstep(0.0, 0.3, t));
  let b = mix(a, RUST, smoothstep(0.25, 0.65, t));
  return mix(b, vec3f(0.30, 0.10, 0.05), smoothstep(0.65, 1.0, t));
}

@fragment fn ffull(i: Full) -> @location(0) vec4f {
  let g = textureSample(rock, smp, i.uv);            // rgb: the ground's colour (paper in the sky), a: ground
  let v = textureSample(wave, smp, i.uv) * d.glow;   // x: P, y: S, z: shaking
  let p = 1.0 - exp(-abs(v.x));
  let s = 1.0 - exp(-abs(v.y));
  let pc = select(OCHRE, RUST, v.x < 0.0);            // rust squeezed, ochre stretched
  let sc = select(TEAL, NAVY, v.y < 0.0);
  var c = g.rgb;
  if (d.mode > 1.5) {                                 // particles: faint waves under the dots
    c = mix(c, PAPER, 0.3 * g.a);
    c = mix(c, pc, 0.35 * p);
    c = mix(c, sc, 0.35 * s);
  } else if (d.mode > 0.5) {                          // shaking: how fast the ground moves
    let grey = dot(c, vec3f(0.3, 0.5, 0.2));
    c = mix(c, vec3f(grey), 0.55 * g.a);
    let m = 1.0 - exp(-v.z);
    c = mix(c, heat(m), clamp(m * 3.0, 0.0, 1.0) * g.a);
  } else {                                            // P and S waves
    c = mix(c, pc, 0.92 * p);
    c = mix(c, sc, 0.92 * s);
  }
  return vec4f(c, 1.0);
}

struct Dot { @builtin(position) pos: vec4f, @location(0) q: vec2f, @location(1) hl: f32 };

@vertex fn vdot(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> Dot {
  var corners = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0), vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0));
  var o: Dot;
  let q = corners[vi];
  o.q = q;
  let cols = u32(d.cols);
  let cx = ii % cols; let cy = ii / cols;
  let px = (f32(cx) + 0.5) * d.spacing; let py = (f32(cy) + 0.5) * d.spacing;
  let n = u32(d.n);
  let k = (u32(py) + u32(d.z0)) * u32(d.nx) + u32(px) + u32(d.x0);
  o.hl = select(0.0, 1.0, cx % 5u == 2u && cy % 3u == 1u);   // a few rust dots to follow
  if (mat[6u * n + k] < 0.5) { o.pos = vec4f(2.0, 2.0, 0.0, 1.0); return o; }
  let lim = d.spacing * 0.9;
  let ux = clamp(fld[5u * n + k] * d.exag, -lim, lim);
  let uz = clamp(fld[6u * n + k] * d.exag, -lim, lim);
  let x = (px + ux) / d.w * 2.0 - 1.0;
  let y = 1.0 - (py + uz) / d.h * 2.0;
  let r = d.dot * (1.0 + 0.6 * o.hl);
  o.pos = vec4f(x + q.x * r / d.cw * 2.0, y + q.y * r / d.ch * 2.0, 0.0, 1.0);
  return o;
}

@fragment fn fdot(i: Dot) -> @location(0) vec4f {
  let a = (1.0 - smoothstep(0.65, 1.0, length(i.q))) * 0.9;
  return vec4f(mix(INK, RUST, i.hl) * a, a);
}
