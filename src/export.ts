// Seismograms to files: SAC (one file per station and component, ground velocity in nm/s, the format read by SAC,
// ObsPy and most seismology software) and CSV (all traces in m/s), bundled in a zip with a short README.

export interface Trace {
  station: string;
  channel: string;              // e.g. HHZ (up) or HHE (horizontal, along the slice)
  azimuth: number;              // component azimuth and incidence, degrees (SAC CMPAZ, CMPINC)
  incidence: number;
  velocity: Float32Array;       // m/s, starting at the origin time
  distance: number;             // epicentral distance, km
  p?: number; s?: number;       // first-arrival times, s after the origin
}
export interface Quake { name: string; magnitude: number; depth: number; delta: number; origin: Date }

/** One SAC file (little-endian, header version 6). */
export function sac(t: Trace, q: Quake): Uint8Array {
  const n = t.velocity.length, buf = new ArrayBuffer(632 + 4 * n), dv = new DataView(buf), bytes = new Uint8Array(buf);
  const f = (i: number, v: number) => dv.setFloat32(4 * i, v, true), int = (i: number, v: number) => dv.setInt32(4 * i, v, true);
  const text = (offset: number, length: number, s: string) => { bytes.fill(32, offset, offset + length); bytes.set(new TextEncoder().encode(s.slice(0, length)), offset); };
  for (let i = 0; i < 70; i++) f(i, -12345);
  for (let i = 70; i < 110; i++) int(i, -12345);
  text(440, 8, "-12345"); text(448, 16, "-12345");
  for (let o = 464; o < 632; o += 8) text(o, 8, "-12345");

  let min = Infinity, max = -Infinity, sum = 0;
  for (let k = 0; k < n; k++) {
    const v = t.velocity[k] * 1e9;
    dv.setFloat32(632 + 4 * k, v, true);
    min = Math.min(min, v); max = Math.max(max, v); sum += v;
  }
  f(0, q.delta); f(1, min); f(2, max); f(5, 0); f(6, (n - 1) * q.delta); f(7, 0);
  if (t.p !== undefined && Number.isFinite(t.p)) { f(10, t.p); text(488, 8, "P"); }
  if (t.s !== undefined && Number.isFinite(t.s)) { f(11, t.s); text(496, 8, "S"); }
  f(38, q.depth); f(39, q.magnitude); f(50, t.distance); f(56, sum / Math.max(1, n)); f(57, t.azimuth); f(58, t.incidence);
  const o = q.origin, day = Math.floor((Date.UTC(o.getUTCFullYear(), o.getUTCMonth(), o.getUTCDate()) - Date.UTC(o.getUTCFullYear(), 0, 1)) / 864e5) + 1;
  int(70, o.getUTCFullYear()); int(71, day); int(72, o.getUTCHours()); int(73, o.getUTCMinutes()); int(74, o.getUTCSeconds()); int(75, o.getUTCMilliseconds());
  int(76, 6); int(79, n); int(85, 1); int(86, 7); int(87, 11);       // NVHDR, NPTS, time series, velocity, times from the origin
  int(105, 1); int(106, 1); int(107, 1); int(108, 0);                 // evenly sampled, positive polarity, may overwrite, no coordinates
  text(440, 8, t.station); text(448, 16, q.name); text(472, 8, "origin"); text(600, 8, t.channel); text(608, 8, "EP");
  return bytes;
}

/** All traces as one CSV table, in m/s. */
export function csv(traces: Trace[], q: Quake) {
  const head = [
    `# Earthquake Playground synthetic seismograms: ${q.name}, depth ${q.depth.toFixed(1)} km, magnitude ${q.magnitude.toFixed(1)}`,
    `# ground velocity in m/s, ${Math.round(1 / q.delta)} samples per second, time in s after the origin`,
    ...traces.map((t) => `# ${t.station}.${t.channel}: ${t.distance.toFixed(2)} km from the epicentre` +
      (Number.isFinite(t.p) ? `, P at ${t.p!.toFixed(2)} s` : "") + (Number.isFinite(t.s) ? `, S at ${t.s!.toFixed(2)} s` : "")),
    ["time_s", ...traces.map((t) => `${t.station}_${t.channel}`)].join(","),
  ];
  const n = Math.max(0, ...traces.map((t) => t.velocity.length)), rows: string[] = [];
  for (let k = 0; k < n; k++) rows.push([(k * q.delta).toFixed(3), ...traces.map((t) => k < t.velocity.length ? t.velocity[k].toExponential(5) : "")].join(","));
  return new TextEncoder().encode(head.concat(rows).join("\n") + "\n");
}

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
const crc32 = (b: Uint8Array) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

/** A zip file of stored (uncompressed) files. */
export function zip(files: { name: string; data: Uint8Array }[]): Blob {
  const parts: Uint8Array[] = [], central: Uint8Array[] = [];
  let offset = 0;
  for (const { name, data } of files) {
    const nb = new TextEncoder().encode(name), crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true); local.setUint32(22, data.length, true); local.setUint16(26, nb.length, true);
    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, 0x02014b50, true); dir.setUint16(4, 20, true); dir.setUint16(6, 20, true); dir.setUint32(16, crc, true);
    dir.setUint32(20, data.length, true); dir.setUint32(24, data.length, true); dir.setUint16(28, nb.length, true); dir.setUint32(42, offset, true);
    parts.push(new Uint8Array(local.buffer), nb, data);
    central.push(new Uint8Array(dir.buffer), nb);
    offset += 30 + nb.length + data.length;
  }
  const size = central.reduce((a, b) => a + b.length, 0), end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, size, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)] as BlobPart[], { type: "application/zip" });
}

export function save(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
