/**
 * One-time swipe hints ("Swipe right to complete, left to snooze") — shown
 * once per PHONE, not per account, and gone for good after a tap on the hint
 * or the first swipe. AsyncStorage (bulkStorage): it is not a secret.
 */

import { useEffect } from "react";
import { create } from "zustand";
import { bulkGet, bulkSet } from "../../lib/bulkStorage";

export type SwipeHintKey = "tasks" | "clients";
const KEY = "swipe_hints_v1";

export function parseSeenHints(raw: string | null | undefined): Partial<Record<SwipeHintKey, true>> {
  try {
    const v = raw ? JSON.parse(raw) : null;
    const out: Partial<Record<SwipeHintKey, true>> = {};
    for (const k of ["tasks", "clients"] as const) if (v && v[k] === true) out[k] = true;
    return out;
  } catch {
    return {};
  }
}

interface HintState {
  hydrated: boolean;
  seen: Partial<Record<SwipeHintKey, true>>;
  hydrate: () => Promise<void>;
  markSeen: (k: SwipeHintKey) => void;
}

let hydrating: Promise<void> | null = null;

export const useSwipeHints = create<HintState>((set, get) => ({
  hydrated: false,
  seen: {},
  hydrate: () => {
    if (get().hydrated) return Promise.resolve();
    hydrating ??= bulkGet(KEY)
      .then((raw) => set((s) => ({ hydrated: true, seen: { ...parseSeenHints(raw), ...s.seen } })))
      // Storage unreadable: say nothing rather than nag on every launch.
      .catch(() => set((s) => ({ hydrated: true, seen: { tasks: true, clients: true, ...s.seen } })));
    return hydrating;
  },
  markSeen: (k) => {
    if (get().seen[k]) return;
    const seen = { ...get().seen, [k]: true as const };
    set({ seen });
    bulkSet(KEY, JSON.stringify(seen)).catch(() => {});
  },
}));

/** Whether to show this hint now, and how to put it away. */
export function useSwipeHint(key: SwipeHintKey): { visible: boolean; dismiss: () => void } {
  const hydrated = useSwipeHints((s) => s.hydrated);
  const seen = useSwipeHints((s) => !!s.seen[key]);
  useEffect(() => {
    if (!hydrated) void useSwipeHints.getState().hydrate();
  }, [hydrated]);
  return { visible: hydrated && !seen, dismiss: () => useSwipeHints.getState().markSeen(key) };
}

export const markSwipeHintSeen = (key: SwipeHintKey) => useSwipeHints.getState().markSeen(key);
