/**
 * Device preferences — per-phone, per-user settings that aren't firm config.
 * Persisted locally (not on the server) because they describe how THIS person
 * wants the app to behave on THIS device.
 */

import { create } from "zustand";
import { storageGet, storageSet } from "../lib/storage";
import type { LanguagePref } from "../i18n";
import { getAccountScope, onAccountChange } from "../lib/accountScope";

const KEY = "device_prefs_v1";

export interface Prefs {
  /**
   * Import actual Android call metadata for uniquely matched CRM contacts,
   * while the app is open or on resume. Opt-in is scoped to account and device.
   */
  autoLogCalls: boolean;
  /** Legacy preference retained for stored-payload compatibility. */
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

const DEFAULTS: Prefs = { autoLogCalls: false, autoLogOutcome: "", appLock: false, language: "en" };

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
          autoLogOutcome: pick(p, "autoLogOutcome"),
          appLock: pick(p, "appLock"),
          language: "en",
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
    if (key === "autoLogCalls" && getAccountScope().owner) storageSet(`sim_enabled.${getAccountScope().owner}`, String(value)).catch(() => {});
    const { autoLogCalls, autoLogOutcome, appLock, language } = get();
    storageSet(KEY, JSON.stringify({ autoLogCalls, autoLogOutcome, appLock, language })).catch(() => {});
  },
}));
onAccountChange(() => {
  const scope = getAccountScope();
  usePrefs.setState({ autoLogCalls: false });
  if (scope.owner) void storageGet(`sim_enabled.${scope.owner}`).then(value => {
    if (getAccountScope().generation === scope.generation) usePrefs.setState({ autoLogCalls: value === "true" });
  }).catch(() => {});
});
