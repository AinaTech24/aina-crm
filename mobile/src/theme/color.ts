/**
 * Colour maths for the theme — pure, dependency-free, safe to run at module
 * load (tokens.ts resolves the palette before the first StyleSheet exists).
 */

export function isHex(h?: string | null): h is string {
  return typeof h === "string" && /^#?[0-9a-fA-F]{6}$/.test(h.trim());
}

export function hexToRgb(h?: string | null): { r: number; g: number; b: number } | null {
  const m = typeof h === "string" ? /^#?([0-9a-fA-F]{6})$/.exec(h.trim()) : null;
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

const clamp255 = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
export const toHex = (r: number, g: number, b: number) =>
  "#" + [r, g, b].map((x) => clamp255(x).toString(16).padStart(2, "0")).join("").toUpperCase();

export function darken(hex: string, amt: number): string {
  const c = hexToRgb(hex);
  return c ? toHex(c.r * (1 - amt), c.g * (1 - amt), c.b * (1 - amt)) : hex;
}

export function lighten(hex: string, amt: number): string {
  const c = hexToRgb(hex);
  return c ? toHex(c.r + (255 - c.r) * amt, c.g + (255 - c.g) * amt, c.b + (255 - c.b) * amt) : hex;
}

/** `amt` of `a` over `b` (0 = all b, 1 = all a). */
export function mix(a: string, b: string, amt: number): string {
  const x = hexToRgb(a), y = hexToRgb(b);
  if (!x || !y) return a;
  return toHex(y.r + (x.r - y.r) * amt, y.g + (x.g - y.g) * amt, y.b + (x.b - y.b) * amt);
}

/** h 0–360, s / l 0–100. */
export function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const c = hexToRgb(hex);
  if (!c) return { h: 0, s: 0, l: 0 };
  const r = c.r / 255, g = c.g / 255, b = c.b / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0, s = 0;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return { h, s: s * 100, l: l * 100 };
}

export function hslToHex(h: number, s: number, l: number): string {
  const S = Math.max(0, Math.min(100, s)) / 100, L = Math.max(0, Math.min(100, l)) / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = S * Math.min(L, 1 - L);
  const f = (n: number) => L - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return toHex(f(0) * 255, f(8) * 255, f(4) * 255);
}

/** WCAG relative luminance, 0 (black) – 1 (white). */
export function luminance(hex: string): number {
  const c = hexToRgb(hex);
  if (!c) return 0;
  const f = (v: number) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}

export function contrast(a: string, b: string): number {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Same hue, saturation at least `minS`, lightness searched until the colour's
 *  luminance is `target` — how one firm colour becomes a dark-mode accent that
 *  reads as text on a dark card AND carries white text as a fill. */
export function withLuminance(hex: string, target: number, minS = 0): string {
  const { h, s } = hexToHsl(hex);
  const sat = Math.max(s, minS);
  let lo = 0, hi = 100;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (luminance(hslToHex(h, sat, mid)) < target) lo = mid; else hi = mid;
  }
  return hslToHex(h, sat, (lo + hi) / 2);
}
