/**
 * Restart the JS bundle in place — how a colour change (dark mode, or the
 * firm's colour arriving after the first sign-in) reaches the StyleSheets that
 * were frozen at import time. The session, the offline queue and the saved
 * query cache all live on disk, so the app comes back where it was.
 *
 * `reloadAppAsync` (expo) works in release AND development builds; expo-updates
 * and DevSettings are fallbacks for older runtimes. Returns false when nothing
 * could reload — the caller then asks the user to reopen the app.
 *
 * The app lock (biometric) would otherwise demand a face scan on the reloaded
 * bundle the moment the user changed a setting; `consumeReloadUnlock` lets the
 * reloaded bundle skip that ONE cold-start lock if the reload happened within
 * the last few seconds of an unlocked session.
 */

import { DevSettings, Platform } from "react-native";
import { reloadAppAsync } from "expo";
import * as Updates from "expo-updates";
import { readSync, writeSync } from "./boot";

const UNLOCK_KEY = "ui_reload_unlock_v1";
const UNLOCK_WINDOW_MS = 20_000;

export async function reloadApp(reason: string, opts: { keepUnlocked?: boolean } = {}): Promise<boolean> {
  if (opts.keepUnlocked) writeSync(UNLOCK_KEY, String(Date.now()));
  if (Platform.OS === "web") {
    try { if (typeof window !== "undefined") { window.location.reload(); return true; } } catch { /* fall through */ }
    return false;
  }
  try { await reloadAppAsync(reason); return true; } catch { /* next */ }
  try { await Updates.reloadAsync(); return true; } catch { /* next */ }
  if (__DEV__) {
    try { DevSettings.reload(reason); return true; } catch { /* nothing left */ }
  }
  writeSync(UNLOCK_KEY, null);
  return false;
}

/** True once, right after our own reload of an unlocked session. */
export function consumeReloadUnlock(): boolean {
  const at = Number(readSync(UNLOCK_KEY) || 0);
  if (!at) return false;
  writeSync(UNLOCK_KEY, null);
  return Date.now() - at >= 0 && Date.now() - at < UNLOCK_WINDOW_MS;
}
