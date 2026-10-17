// Scenarios: a whole setup (ground, faults, explosion, seismometers, noise) in a link, so a teacher can prepare an
// experiment and share it. The ground is stored as the cells that differ from its ready-made ground, in runs of
// the same rock; the whole thing is JSON, deflated and written in base64url after ?s= in the address.

export interface ScenarioFault { a: [number, number]; b: [number, number]; magnitude: number; start: number; speed: number; slip: "normal" | "reverse" }
export interface Scenario {
  v: 1;
  preset: string;
  /** Rocks used by the changes: [vp, vs, rho]. */
  rocks: [number, number, number][];
  /** Changed cells: runs of [cells skipped since the last run, length, rock index]. */
  runs: number[];
  faults: ScenarioFault[];
  chosen: number;                       // which fault ruptures (-1 for none)
  kind: "quake" | "blast";
  blast: string;                        // explosion id
  at: [number, number];                 // the explosion's cell
  stations: number[];                   // columns on screen
  noise: number[];                      // added noise per seismometer (m/s)
  sources: [string, number, number][];  // noise sources: kind, column, level
  start: boolean;                       // start the quake when the link opens
}

/** The cells where `now` differs from `base`, as runs of the same rock. */
export function diffGround(base: { vp: Float32Array; vs: Float32Array; rho: Float32Array }, now: { vp: Float32Array; vs: Float32Array; rho: Float32Array }) {
  const rocks: [number, number, number][] = [], index = new Map<string, number>(), runs: number[] = [];
  let last = 0, k = 0;
  const n = base.vp.length;
  while (k < n) {
    if (base.vp[k] === now.vp[k] && base.vs[k] === now.vs[k] && base.rho[k] === now.rho[k]) { k++; continue; }
    const key = `${now.vp[k]},${now.vs[k]},${now.rho[k]}`;
    let r = index.get(key);
    const round = (v: number) => Math.round(v * 1e4) / 1e4;   // the grid keeps 32-bit values; these give them back exactly
    if (r === undefined) { r = rocks.length; index.set(key, r); rocks.push([round(now.vp[k]), round(now.vs[k]), round(now.rho[k])]); }
    let len = 1;
    while (k + len < n && now.vp[k + len] === now.vp[k] && now.vs[k + len] === now.vs[k] && now.rho[k + len] === now.rho[k] &&
      (base.vp[k + len] !== now.vp[k + len] || base.vs[k + len] !== now.vs[k + len] || base.rho[k + len] !== now.rho[k + len])) len++;
    runs.push(k - last, len, r);
    k += len; last = k;
  }
  return { rocks, runs };
}

/** Put the changes back on a ground built from its ready-made ground. */
export function applyGround(g: { vp: Float32Array; vs: Float32Array; rho: Float32Array }, rocks: [number, number, number][], runs: number[]) {
  let k = 0;
  for (let q = 0; q + 2 < runs.length; q += 3) {
    k += runs[q];
    const [vp, vs, rho] = rocks[runs[q + 2]] ?? [0, 0, 0];
    for (let m = 0; m < runs[q + 1] && k < g.vp.length; m++, k++) { g.vp[k] = vp; g.vs[k] = vs; g.rho[k] = rho; }
  }
}

const b64url = (bytes: Uint8Array) => {
  let s = ""; for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const unb64url = (text: string) => {
  const s = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};
async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream) {
  const out = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

export async function encode(s: Scenario) {
  return b64url(await pipe(new TextEncoder().encode(JSON.stringify(s)), new CompressionStream("deflate-raw")));
}
export async function decode(text: string): Promise<Scenario | null> {
  try {
    const s = JSON.parse(new TextDecoder().decode(await pipe(unb64url(text), new DecompressionStream("deflate-raw")))) as Scenario;
    return s && s.v === 1 ? s : null;
  } catch { return null; }
}

/** This page's address with a scenario in it. */
export const linkFor = (code: string) => `${location.origin}${location.pathname}?s=${code}`;
/** The scenario in the address the page opened with, if there is one (read at once: the page tidies its address). */
const opened = new URLSearchParams(location.search).get("s");
export const fromAddress = () => opened;
