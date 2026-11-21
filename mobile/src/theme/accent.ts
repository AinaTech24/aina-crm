/**
 * The app's ONE accent colour, derived from the firm's brand colour — the web
 * CRM's rule (src/lib/branding/theme.ts): buttons, links, the selected pill,
 * active tiles and the tab bar all carry the firm's PRIMARY hue; the firm's
 * secondary colour never becomes a second interactive colour. Red is not an
 * accent here: it only means overdue / urgent (`palette.danger`).
 *
 * A firm with no brand colour (or the old column default #1f2937, which was
 * never a choice) gets the CRM's stock Workspace Blue, everywhere.
 */

import { darken, hexToHsl, hslToHex, isHex, lighten, mix, withLuminance } from "./color";

export type Scheme = "light" | "dark";

/** The web's stock accent (DEFAULT_THEME.primary). */
export const DEFAULT_ACCENT = "#2563EB";
const LEGACY_UNBRANDED = "#1f2937";

/** The firm's chosen primary, or null when it never chose one. */
export function firmPrimary(hex?: string | null): string | null {
  const v = typeof hex === "string" ? hex.trim() : "";
  if (!isHex(v) || v.replace("#", "").toLowerCase() === LEGACY_UNBRANDED.slice(1)) return null;
  return v.startsWith("#") ? v : `#${v}`;
}

export interface AccentTokens {
  /** Fill: buttons, FAB, selected chip / pill, active tab tint. White text sits on it. */
  brand: string;
  /** Brand-coloured TEXT and pressed fills (darker on light, lighter on dark). */
  brandDark: string;
  /** Soft tinted background behind a brand icon. */
  brandLight: string;
  /** Tinted border / ring. */
  brandTint: string;
}

/** Dark-mode card colour the tints are mixed into (tokens.ts dark `surface`). */
const DARK_SURFACE = "#131C2E";

export function accentTokens(primary: string | null, scheme: Scheme): AccentTokens {
  const src = primary ?? DEFAULT_ACCENT;
  if (scheme === "dark") {
    // Luminance ~0.235: ≥4.5:1 as text on a dark card and ~3.7:1 under white.
    const brand = withLuminance(src, 0.235, 45);
    return {
      brand,
      brandDark: withLuminance(src, 0.5, 45),
      brandLight: mix(brand, DARK_SURFACE, 0.22),
      brandTint: mix(brand, DARK_SURFACE, 0.4),
    };
  }
  // The web's "navy family": a firm colour is kept dark enough to carry white
  // text (lightness 14–30), so a bright orange still reads on a button.
  let brand = src.toUpperCase();
  if (primary && primary.toLowerCase() !== DEFAULT_ACCENT.toLowerCase()) {
    const { h, s, l } = hexToHsl(primary);
    const s2 = Math.max(s, 24), l2 = Math.min(30, Math.max(14, l));
    if (Math.abs(s2 - s) > 0.5 || Math.abs(l2 - l) > 0.5) brand = hslToHex(h, s2, l2);
  }
  return { brand, brandDark: darken(brand, 0.18), brandLight: lighten(brand, 0.9), brandTint: lighten(brand, 0.78) };
}
