// Focal mechanism ("beachball"): P-wave first motions on the lower hemisphere, equal-area projection, north up.
// The slice runs east (x) and down (z); its faults strike north, across it. The moment tensor is the one the
// simulation injects, [mxx, mzz, mxz] with z down; compressional quadrants (first motion away from the source)
// are shaded.

import { INK, RUST } from "./plot";

export function beachball(c: CanvasRenderingContext2D, cx: number, cy: number, r: number, m: [number, number, number], fill = RUST) {
  const [mxx, mzz, mxz] = m, size = Math.ceil(2 * r), img = c.createImageData(size, size);
  const [fr, fg, fb] = [parseInt(fill.slice(1, 3), 16), parseInt(fill.slice(3, 5), 16), parseInt(fill.slice(5, 7), 16)];
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    const u = (px + 0.5 - r) / r, v = (r - py - 0.5) / r, q = Math.hypot(u, v);
    if (q > 1) continue;
    // equal-area: q = sqrt(2) sin(i / 2), i the take-off angle from straight down
    const i = 2 * Math.asin(Math.min(1, q / Math.SQRT2)), e = q > 0 ? u / q : 0;
    const dx = Math.sin(i) * e, dz = Math.cos(i);
    const a = mxx * dx * dx + 2 * mxz * dx * dz + mzz * dz * dz, o = 4 * (py * size + px);
    if (a > 0) { img.data[o] = fr; img.data[o + 1] = fg; img.data[o + 2] = fb; } else { img.data[o] = 250; img.data[o + 1] = 249; img.data[o + 2] = 246; }
    img.data[o + 3] = 255;
  }
  const off = new OffscreenCanvas(size, size); off.getContext("2d")!.putImageData(img, 0, 0);
  c.drawImage(off, cx - r, cy - r);
  c.beginPath(); c.arc(cx, cy, r, 0, 2 * Math.PI); c.strokeStyle = INK; c.lineWidth = 1; c.stroke();
}
