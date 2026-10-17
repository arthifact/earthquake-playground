// Signal processing for the seismograms: Butterworth band-pass filters (as ObsPy's), amplitude spectra and
// spectrograms. All on plain arrays at a fixed sampling rate.

/** In-place radix-2 FFT; re and im have a power-of-two length. */
export function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = (-2 * Math.PI) / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const p = i + k, q = p + len / 2, tr = re[q] * cr - im[q] * ci, ti = re[q] * ci + im[q] * cr;
        re[q] = re[p] - tr; im[q] = im[p] - ti; re[p] += tr; im[p] += ti;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}

/** Fourier amplitude spectrum of x[a..b) (Hann taper, zero-padded): frequencies (Hz) and amplitudes (unit · s). */
export function amplitude(x: ArrayLike<number>, sps: number, a = 0, b = x.length) {
  const m = Math.max(0, b - a);
  let n = 64; while (n < m) n <<= 1;
  const re = new Float64Array(n), im = new Float64Array(n);
  let mean = 0; for (let k = a; k < b; k++) mean += x[k] / Math.max(1, m);
  for (let k = 0; k < m; k++) re[k] = (x[a + k] - mean) * (0.5 - 0.5 * Math.cos((2 * Math.PI * (k + 0.5)) / m));
  fft(re, im);
  // the Hann taper keeps half the signal's amplitude on average, so double it back
  const f = new Float64Array(n / 2), amp = new Float64Array(n / 2);
  for (let k = 0; k < n / 2; k++) { f[k] = (k * sps) / n; amp[k] = (2 * Math.hypot(re[k], im[k])) / sps; }
  return { f, amp };
}

/** Spectrogram: power in windows of win samples every hop samples; rows are times (window centres, s). */
export function spectrogram(x: ArrayLike<number>, sps: number, n: number, win = 256, hop = 16) {
  const times: number[] = [], rows: Float64Array[] = [];
  const re = new Float64Array(win), im = new Float64Array(win);
  for (let a = 0; a + win <= n; a += hop) {
    for (let k = 0; k < win; k++) { re[k] = x[a + k] * (0.5 - 0.5 * Math.cos((2 * Math.PI * (k + 0.5)) / win)); im[k] = 0; }
    fft(re, im);
    const p = new Float64Array(win / 2);
    for (let k = 0; k < win / 2; k++) p[k] = re[k] * re[k] + im[k] * im[k];
    rows.push(p); times.push((a + win / 2) / sps);
  }
  return { times, rows, df: sps / win };
}

// ---------------------------------------------------------------- filters
type Biquad = [number, number, number, number, number];   // b0, b1, b2, a1, a2 (a0 = 1)
const BUTTER4_Q = [0.5411961, 1.3065630];                   // the two sections of a 4-pole Butterworth
function section(kind: "low" | "high", fc: number, sps: number, q: number): Biquad {
  const w = (2 * Math.PI * fc) / sps, c = Math.cos(w), alpha = Math.sin(w) / (2 * q), a0 = 1 + alpha;
  const b = kind === "low" ? [(1 - c) / 2, 1 - c, (1 - c) / 2] : [(1 + c) / 2, -(1 + c), (1 + c) / 2];
  return [b[0] / a0, b[1] / a0, b[2] / a0, (-2 * c) / a0, (1 - alpha) / a0];
}
function run(x: Float64Array, s: Biquad) {
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let k = 0; k < x.length; k++) {
    const y = s[0] * x[k] + s[1] * x1 + s[2] * x2 - s[3] * y1 - s[4] * y2;
    x2 = x1; x1 = x[k]; y2 = y1; y1 = y; x[k] = y;
  }
}

/** A 4-pole Butterworth filter: high-pass at lo Hz and low-pass at hi Hz (0 for none). Causal like a real
 *  instrument (onsets stay sharp, phases shift a little), or zero-phase (run forward and back: no shift, but
 *  twice as steep and with ripples before sharp onsets). */
export function bandpass(x: Float32Array, sps: number, lo: number, hi: number, zeroPhase: boolean) {
  const v = Float64Array.from(x);
  const sections = [
    ...(lo > 0 ? BUTTER4_Q.map((q) => section("high", lo, sps, q)) : []),
    ...(hi > 0 && hi < sps / 2 ? BUTTER4_Q.map((q) => section("low", hi, sps, q)) : []),
  ];
  for (const s of sections) run(v, s);
  if (zeroPhase && sections.length) { v.reverse(); for (const s of sections) run(v, s); v.reverse(); }
  return Float32Array.from(v);
}
