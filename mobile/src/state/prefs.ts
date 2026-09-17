/**
 * Device preferences — per-phone, per-user settings that aren't firm config.
 * Persisted locally (not on the server) because they describe how THIS person
 * wants the app to behave on THIS device.
 */

import { create } from "zustand";
import { storageGet, storageSet } from "../lib/storage";
import type { LanguagePref } from "../i18n";

const KEY = "device_prefs_v1";

export interface Prefs {
  /**
   * Log calls automatically instead of asking. When on, returning to the app
   * after a call places the log immediately (duration ≈ time away), so nothing
   * is ever lost to a dismissed prompt. Notes can be added afterwards from the
   * call's detail screen.
   */
  autoLogCalls: boolean;
  /** Outcome recorded by an auto-log, since we can't detect it. */
  autoLogOutcome: string;
  /**
   * Require Face ID / Touch ID / fingerprint to open the app (cold start and
   * after it's been in the background a while). Off by default — the user opts
   * in from App preferences, and enabling it needs one successful biometric
   * check first so nobody can lock themselves out.
   */
  appLock: boolean;
  /** UI language for the app's own chrome; "system" follows the phone. */
  language: LanguagePref;
}

const DEFAULTS: Prefs = { autoLogCalls: false, autoLogOutcome: "answered", appLock: false, language: "system" };

interface PrefsState extends Prefs {
  hydrated: boolean;
  hydrate: () => Promise<void>;
  set: <K extends keyof Prefs>(key: K, value: Prefs[K]) => void;
}

/** Only accept a stored value when it's the same type as the default — a
 *  corrupt or older payload falls back per-key rather than as a whole. */
function pick<K extends keyof Prefs>(raw: any, key: K): Prefs[K] {
  const v = raw?.[key];
  return typeof v === typeof DEFAULTS[key] ? (v as Prefs[K]) : DEFAULTS[key];
}

export const usePrefs = create<PrefsState>((set, get) => ({
  ...DEFAULTS,
  hydrated: false,

  hydrate: async () => {
    try {
      const raw = await storageGet(KEY);
      if (raw) {
        const p = JSON.parse(raw);
        set({
          autoLogCalls: pick(p, "autoLogCalls"),
          autoLogOutcome: pick(p, "autoLogOutcome"),
          appLock: pick(p, "appLock"),
          language: pick(p, "language"),
        });
      }
    } catch {
      /* corrupt payload — fall back to defaults rather than crash the shell */
    } finally {
      set({ hydrated: true });
    }
  },

  set: (key, value) => {
    set({ [key]: value } as any);
    const { autoLogCalls, autoLogOutcome, appLock, language } = get();
    storageSet(KEY, JSON.stringify({ autoLogCalls, autoLogOutcome, appLock, language })).catch(() => {});
  },
}));
