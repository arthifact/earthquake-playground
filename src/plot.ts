// Colours (Earth Forge's) and small drawing helpers shared by the views.

export const INK = "#252722", MUTED = "#64675e", PAPER = "#faf9f6", LINE = "#deded4";
export const RUST = "#a4462a", OCHRE = "#cc8f3d", NAVY = "#123f62", TEAL = "#338c9e", ACCENT = "#4c6246";
export type RGB = [number, number, number];

export const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
export function ramp(stops: string[]) {
  const c = stops.map(hex);
  return (t: number): RGB => {
    const s = Math.min(1, Math.max(0, t)) * (c.length - 1), i = Math.min(c.length - 2, Math.floor(s)), f = s - i;
    return [0, 1, 2].map((k) => c[i][k] + (c[i + 1][k] - c[i][k]) * f) as RGB;
  };
}
/** Earth Forge's earth ramp (dark blue, teal, green, olive, ochre, sand), for rock speed. */
export const earth = ramp(["#0b1d4f", "#123f62", "#1b5b66", "#2f7064", "#57804f", "#88903c", "#b99a3e", "#dba65a", "#ebc488", "#f4e2bd"]);
/** Seismogram colours: navy for negative, paper for zero, rust for positive. */
export const seismic = ramp([NAVY, "#6f8fa8", PAPER, "#c98a6f", RUST]);
export const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const css = (c: RGB) => `rgb(${c.map((x) => Math.round(x)).join(",")})`;
export const PAPER_RGB = hex(PAPER);

/** Size a 2D canvas to its layout times the pixel ratio and clear it. */
export function surface(canvas: HTMLCanvasElement) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr)), h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const c = canvas.getContext("2d")!;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, w, h);
  c.scale(dpr, dpr);
  return { c, w: canvas.clientWidth, h: canvas.clientHeight, dpr };
}

export const MONO = (px = 10) => `${px}px ui-monospace, SFMono-Regular, Consolas, monospace`;
export const SERIF = (px = 15) => `${px}px Georgia, "Times New Roman", serif`;
export const SANS = (px = 12) => `${px}px Arial, Helvetica, sans-serif`;

/** A five-pointed star (the quake's focus). */
export function star(c: CanvasRenderingContext2D, x: number, y: number, r: number) {
  c.beginPath();
  for (let k = 0; k < 10; k++) {
    const a = -Math.PI / 2 + (k * Math.PI) / 5, rr = k % 2 ? r * 0.45 : r;
    c.lineTo(x + rr * Math.cos(a), y + rr * Math.sin(a));
  }
  c.closePath();
}

/** Text on a paper halo, so labels read over the picture. */
export function label(c: CanvasRenderingContext2D, text: string, x: number, y: number, colour = INK) {
  c.lineJoin = "round"; c.lineWidth = 3.5; c.strokeStyle = "rgba(250,249,246,0.9)";
  c.strokeText(text, x, y);
  c.fillStyle = colour; c.fillText(text, x, y);
}
