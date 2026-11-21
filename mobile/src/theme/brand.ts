/**
 * Runtime accent. The firm's brand colour arrives from the server
 * (useApplyTenantBrand → /api/tenant) after start-up, so this store:
 *
 *  1. holds the live accent for the components that read `useBrand()` (Button,
 *     FAB, Chip, Segmented, LayoutSwitch, the tab bar, Text tone "brand") —
 *     they re-skin the moment the colour is known;
 *  2. writes the same values into `palette`'s accent keys, so inline
 *     `palette.brand` reads on any screen follow on their next render;
 *  3. remembers the colour on the device, so the NEXT start builds every
 *     StyleSheet (frozen at import time) with it — see tokens.ts / boot.ts.
 *
 * ONE accent: the firm's PRIMARY colour, as on the web CRM. `accent*` is kept
 * for the callers that read it and is always the same colour as `brand*`; the
 * firm's secondary colour is not an interactive colour (the web's rule).
 */

import { create } from "zustand";
import { palette, colorScheme, bootBrand } from "./tokens";
import { accentTokens, firmPrimary } from "./accent";
import { writeStoredBrand } from "./boot";

interface BrandState {
  /** The accent fill — buttons, FAB, selected chip / pill, active tab. */
  brand: string;
  /** Accent text / pressed fill. */
  brandDark: string;
  /** Accent-tinted background. */
  brandLight: string;
  /** Same colour as `brand` (one accent); kept for existing callers. */
  accent: string;
  accentDark: string;
  accentLight: string;
  /** The firm primary the accent was derived from (null = stock colour). */
  firm: string | null;
  /** `secondaryHex` is accepted for compatibility and deliberately unused. */
  setBrand: (primaryHex?: string | null, secondaryHex?: string | null) => void;
}

function stateFor(firm: string | null) {
  const t = accentTokens(firm, colorScheme);
  return {
    tokens: t,
    state: { brand: t.brand, brandDark: t.brandDark, brandLight: t.brandLight, accent: t.brand, accentDark: t.brandDark, accentLight: t.brandLight, firm },
  };
}

/** What is on disk, so an unchanged colour is not re-written on every refresh. */
let stored: string | null = bootBrand;

export const useBrand = create<BrandState>((set, get) => ({
  ...stateFor(bootBrand).state,
  setBrand: (primaryHex) => {
    const firm = firmPrimary(primaryHex);
    if (firm === get().firm && palette.brand === get().brand) return;
    const { tokens, state } = stateFor(firm);
    palette.brand = tokens.brand;
    palette.brandDark = tokens.brandDark;
    palette.brandLight = tokens.brandLight;
    palette.brandTint = tokens.brandTint;
    if ((firm ?? "").toLowerCase() !== (stored ?? "").toLowerCase()) {
      stored = firm;
      writeStoredBrand(firm);
    }
    set(state);
  },
}));

/** True when the firm colour now known differs from the one this bundle's
 *  StyleSheets were built with (a reload would change what is on screen). */
export function brandDiffersFromBoot(): boolean {
  return (useBrand.getState().firm ?? "").toLowerCase() !== (bootBrand ?? "").toLowerCase();
}
