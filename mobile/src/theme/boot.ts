/**
 * What the palette is built from, read SYNCHRONOUSLY at module load.
 *
 * Most screens create their StyleSheet when their module is imported, which
 * freezes every colour they read from `palette` at that moment. So the colour
 * scheme (System / Light / Dark — a per-device choice) and the firm's brand
 * colour (the last one this device saw) have to be known before the first
 * StyleSheet exists: tokens.ts calls `resolveBoot()` while it is being
 * evaluated, and a change is applied by reloading the JS bundle (reload.ts).
 *
 * Storage is the keychain's synchronous API on native (tiny values, and the
 * only synchronous store the app has) and localStorage on the web preview.
 * Every read is guarded: a locked keychain or a test environment just means
 * "System, no brand yet".
 */

import { Appearance, Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import { firmPrimary, type Scheme } from "./accent";

export type AppearancePref = "system" | "light" | "dark";

const PREF_KEY = "ui_appearance_v1";
const BRAND_KEY = "ui_brand_v1";

const web = Platform.OS === "web";

export function readSync(key: string): string | null {
  try {
    const v = web
      ? (typeof localStorage !== "undefined" ? localStorage.getItem(key) : null)
      : SecureStore.getItem(key);
    return typeof v === "string" ? v : null;
  } catch {
    return null;
  }
}

export function writeSync(key: string, value: string | null): void {
  try {
    if (web) {
      if (typeof localStorage === "undefined") return;
      if (value == null) localStorage.removeItem(key); else localStorage.setItem(key, value);
      return;
    }
    if (value == null) SecureStore.deleteItemAsync(key).catch(() => {});
    // Readable after the first unlock since boot, so a launch while the phone
    // is locked (a push in the background) still finds the user's choice.
    else SecureStore.setItem(key, value, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK });
  } catch {
    /* best-effort: the worst case is the default look on the next start */
  }
}

export function readAppearancePref(): AppearancePref {
  const v = readSync(PREF_KEY);
  return v === "light" || v === "dark" ? v : "system";
}

// Written synchronously (never deleted) — the bundle may be reloaded on the
// very next line, and an async delete could still be in flight.
export function writeAppearancePref(pref: AppearancePref): void {
  writeSync(PREF_KEY, pref);
}

export function readStoredBrand(): string | null {
  return firmPrimary(readSync(BRAND_KEY));
}

export function writeStoredBrand(primary: string | null): void {
  writeSync(BRAND_KEY, primary ?? "");
}

/** The phone's own setting. `getColorScheme` reports an override this process
 *  set earlier (setNativeScheme), so a JS reload sees the scheme it was pinned to. */
export function systemScheme(): Scheme {
  try {
    return Appearance.getColorScheme() === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

/**
 * Pin native UI (keyboard, alerts, date pickers, the system bars' defaults) to
 * the scheme the JS palette was built with, so the two never disagree for the
 * life of the process. "unspecified" hands it back to the phone.
 */
export function setNativeScheme(scheme: Scheme | "unspecified"): void {
  if (web) return;
  try {
    Appearance.setColorScheme?.(scheme);
  } catch {
    /* older runtimes: native UI follows the phone */
  }
}

export interface BootTheme {
  pref: AppearancePref;
  scheme: Scheme;
  /** The firm's primary colour as last seen on this device, or null. */
  brand: string | null;
}

export function resolveBoot(): BootTheme {
  const pref = readAppearancePref();
  const scheme: Scheme = pref === "system" ? systemScheme() : pref;
  setNativeScheme(scheme);
  return { pref, scheme, brand: readStoredBrand() };
}
