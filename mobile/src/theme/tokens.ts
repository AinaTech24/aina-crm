/**
 * Design tokens — the single source of truth for the app's look.
 *
 * Calm neutrals, ONE accent (the firm's brand colour — accent.ts), semantic
 * status colours, generous spacing, soft shadows, rounded cards. Red is never
 * the accent: it means overdue / urgent only (`danger`).
 *
 * Two colour sets (light / dark). The set and the firm's accent are chosen
 * ONCE, while this module is first evaluated (boot.ts reads the device's
 * System / Light / Dark choice and the firm colour it last saw), so every
 * StyleSheet created afterwards — including the ones frozen at import time
 * all over the app — gets the right values. A change of scheme is applied by
 * reloading the bundle (reload.ts); a change of firm colour mid-session updates
 * `palette`'s accent keys in place (brand.ts) so inline reads follow at once.
 */

import { accentTokens, DEFAULT_ACCENT, type Scheme } from "./accent";
import { resolveBoot, type AppearancePref } from "./boot";

const lightColors = {
  // Accent — replaced by the firm's colour (accent.ts). Stock: Workspace Blue.
  brand: DEFAULT_ACCENT,
  brandDark: "#1E51C1",
  brandLight: "#E9EFFD",
  brandTint: "#CFDDFB",

  // Neutrals (slate)
  ink: "#0F172A", // primary text
  ink70: "#334155",
  muted: "#526075", // secondary text — 6.4:1 on white, 5.8:1 on sunken
  faint: "#5F6E84", // tertiary / placeholders — 5.2:1 on white
  line: "#E2E8F0", // borders
  lineSoft: "#EEF2F6",
  surface: "#FFFFFF",
  surfaceAlt: "#F8FAFC", // app background
  surfaceSunken: "#F1F5F9",
  /** A dark bar on a light screen (offline banner, info toast). */
  inverse: "#0F172A",
  /** Secondary text ON a brand / inverse fill. */
  onBrandMuted: "rgba(255,255,255,0.78)",

  // Semantic
  success: "#16A34A",
  successBg: "#ECFDF3",
  warning: "#D97706",
  warningBg: "#FFFBEB",
  danger: "#DC2626",
  dangerBg: "#FEF2F2",
  info: "#0EA5E9",
  infoBg: "#F0F9FF",
  violet: "#7C3AED",
  violetBg: "#F5F3FF",
  pink: "#DB2777",
  pinkBg: "#FCE7F3",

  white: "#FFFFFF",
  black: "#000000",
  overlay: "rgba(15, 23, 42, 0.45)",
  shadow: "#0F172A",
};

export type Palette = { [K in keyof typeof lightColors]: string };

/**
 * Dark set. Semantic colours sit at a luminance that reads as TEXT on a dark
 * card (≥4.5:1) and still carries white text as a FILL (~3.3–3.8:1), because
 * the app uses each one both ways. Backgrounds are the colour mixed into the
 * card, never a pastel.
 */
const darkColors: Palette = {
  brand: "#3B82F6",
  brandDark: "#93B4F8",
  brandLight: "#1A2D50",
  brandTint: "#23407A",

  ink: "#F1F5F9",
  ink70: "#CBD5E1",
  muted: "#A3B0C2", // 7.7:1 on the card
  faint: "#8B98AB", // 5.8:1 on the card
  line: "#2A364B",
  lineSoft: "#1F2A3D",
  surface: "#131C2E",
  surfaceAlt: "#0B1220",
  surfaceSunken: "#1B2639",
  inverse: "#334155",
  onBrandMuted: "rgba(255,255,255,0.8)",

  success: "#16A34A",
  successBg: "#0F281B",
  warning: "#D97706",
  warningBg: "#2C210F",
  danger: "#EF4444",
  dangerBg: "#2E161C",
  info: "#0EA5E9",
  infoBg: "#0E2A3D",
  violet: "#9D74FA",
  violetBg: "#231B3D",
  pink: "#EC4899",
  pinkBg: "#311529",

  white: "#FFFFFF",
  black: "#000000",
  overlay: "rgba(0, 0, 0, 0.6)",
  shadow: "#000000",
};

const boot = resolveBoot();

/** The scheme this bundle was built with (fixed until the next reload). */
export const colorScheme: Scheme = boot.scheme;
/** The device's stored choice that produced it. */
export const appearancePref: AppearancePref = boot.pref;
/** The firm colour the accent was derived from at start-up (null = stock). */
export const bootBrand: string | null = boot.brand;

/**
 * The live palette. Mutable on purpose: only the four accent keys ever change
 * after start-up (brand.ts), and only so inline `palette.brand` reads pick up
 * the firm's colour mid-session. Never reassign other keys at runtime.
 */
export const palette: Palette = {
  ...(colorScheme === "dark" ? darkColors : lightColors),
  ...accentTokens(boot.brand, colorScheme),
};

/** Both sets, for tests and for the rare surface that must show the other one. */
export const PALETTES: { light: Palette; dark: Palette } = { light: lightColors, dark: darkColors };

export const spacing = {
  none: 0,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  "2xl": 24,
  "3xl": 32,
  "4xl": 40,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  pill: 999,
} as const;

export const fontSize = {
  xs: 12,
  sm: 14,
  base: 16,
  md: 17,
  lg: 19,
  xl: 23,
  "2xl": 29,
  "3xl": 35,
} as const;

export const fontWeight = {
  regular: "400",
  medium: "500",
  semibold: "600",
  bold: "700",
} as const;

/**
 * How far text may grow with the phone's font-size setting. Body text follows
 * it (up to `text`); fixed-height, dense UI (tab labels, chips, pills, segmented
 * tabs) stops at `dense` so a large setting enlarges it without clipping.
 */
export const fontScale = { text: 1.35, dense: 1.2 } as const;

/** Soft, layered shadows. iOS uses shadow*, Android uses elevation. */
export const shadow = {
  none: {},
  card: {
    shadowColor: palette.shadow,
    shadowOpacity: colorScheme === "dark" ? 0.3 : 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  raised: {
    shadowColor: palette.shadow,
    shadowOpacity: colorScheme === "dark" ? 0.45 : 0.1,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
} as const;

/** Minimum thumb-friendly touch target. */
export const HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 } as const;
export const TOUCH_MIN = 48;
