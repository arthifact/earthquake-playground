// First-arrival times through the ground, for the P and S marks on the seismograms: the shortest path in time
// through a grid twice as coarse as the simulation's (Dijkstra, 16 neighbours). Air stops both waves; a speed
// of 0 (S in liquid) stops that wave.

const STEPS = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
  [1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]];

/** Seconds from cell `from` to each cell in `to` (k = j * nx + i), at `speed` (km/s) on cells `h` km wide. */
export function arrivals(nx: number, nz: number, h: number, speed: Float32Array, from: number, to: number[], coarse = 2): number[] {
  const cx = Math.floor(nx / coarse), cz = Math.floor(nz / coarse), N = cx * cz, hc = h * coarse;
  const slow = new Float32Array(N);
  for (let J = 0; J < cz; J++) for (let I = 0; I < cx; I++) {
    let sum = 0, open = 0;
    for (let b = 0; b < coarse; b++) for (let a = 0; a < coarse; a++) {
      const v = speed[(J * coarse + b) * nx + I * coarse + a];
      if (v > 0) { sum += 1 / v; open++; }
    }
    slow[J * cx + I] = open * 2 >= coarse * coarse ? sum / open : Infinity;
  }
  const node = (k: number) => Math.min(cz - 1, Math.floor(Math.floor(k / nx) / coarse)) * cx + Math.min(cx - 1, Math.floor((k % nx) / coarse));
  const time = new Float64Array(N).fill(Infinity);
  const start = node(from);
  if (!Number.isFinite(slow[start])) return to.map(() => NaN);

  // binary heap of (time, node), stale entries skipped
  let keys = new Float64Array(1024), vals = new Int32Array(1024), size = 0;
  const push = (t: number, v: number) => {
    if (size === keys.length) { const k2 = new Float64Array(size * 2), v2 = new Int32Array(size * 2); k2.set(keys); v2.set(vals); keys = k2; vals = v2; }
    let i = size++;
    while (i > 0) { const up = (i - 1) >> 1; if (keys[up] <= t) break; keys[i] = keys[up]; vals[i] = vals[up]; i = up; }
    keys[i] = t; vals[i] = v;
  };
  const pop = () => {
    const v = vals[0], t = keys[--size], last = vals[size];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= size) break;
      if (c + 1 < size && keys[c + 1] < keys[c]) c++;
      if (keys[c] >= t) break;
      keys[i] = keys[c]; vals[i] = vals[c]; i = c;
    }
    keys[i] = t; vals[i] = last;
    return v;
  };
  const length = STEPS.map(([a, b]) => Math.hypot(a, b) * hc);
  time[start] = 0; push(0, start);
  while (size) {
    const t = keys[0], k = pop();
    if (t > time[k]) continue;
    const I = k % cx, J = (k - I) / cx;
    for (let s = 0; s < 16; s++) {
      const i = I + STEPS[s][0], j = J + STEPS[s][1];
      if (i < 0 || j < 0 || i >= cx || j >= cz) continue;
      const q = j * cx + i;
      if (!Number.isFinite(slow[q])) continue;
      const tq = t + length[s] * 0.5 * (slow[k] + slow[q]);
      if (tq < time[q]) { time[q] = tq; push(tq, q); }
    }
  }
  // a seismometer sits on the surface: if its coarse cell is mostly air, use the one below
  return to.map((k) => {
    for (let q = node(k), d = 0; d < 3 && q < N; d++, q += cx) if (Number.isFinite(time[q])) return time[q];
    return NaN;
  });
}
