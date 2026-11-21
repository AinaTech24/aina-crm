/**
 * Toast — lightweight global snackbar. Call `toast.success(msg)` /
 * `toast.error(msg)` / `toast.info(msg)` from anywhere (React or not). A single
 * <ToastHost/> mounted at the app root renders + auto-dismisses them.
 *
 * `toast.undo(msg, onUndo)` (or `toast.action`) shows ONE toast with a button
 * for ~5 s — "Task completed · Undo" — instead of asking before a change. It is
 * kept apart from `items` and drawn by <UndoToastHost/>
 * (src/features/lists/UndoToastHost.tsx); a newer one replaces it. Its timer
 * lives here, so it expires on time whichever screen is showing.
 */

import { create } from "zustand";

export type ToastTone = "success" | "danger" | "info";
export interface ToastItem { id: number; message: string; tone: ToastTone }

/** A toast with one action button (Undo). */
export interface ActionToast {
  id: number;
  message: string;
  tone: ToastTone;
  actionLabel: string;
  /** ms before it goes by itself. */
  duration: number;
  onAction: () => void;
}

interface ToastState {
  items: ToastItem[];
  push: (message: string, tone: ToastTone) => void;
  dismiss: (id: number) => void;
  /** The one action toast on screen, if any. */
  action: ActionToast | null;
  showAction: (t: Omit<ActionToast, "id">) => number;
  /** Close it (only that one, when an id is given). */
  dismissAction: (id?: number) => void;
  /** Press its button: closes it, then runs the action once. */
  runAction: (id: number) => void;
}

let seq = 1;
let actionTimer: ReturnType<typeof setTimeout> | null = null;
const clearActionTimer = () => {
  if (actionTimer) clearTimeout(actionTimer);
  actionTimer = null;
};

export const DEFAULT_ACTION_MS = 5000;

export const useToastStore = create<ToastState>((set, get) => ({
  items: [],
  push: (message, tone) => set((s) => {
    // Collapse duplicate back-to-back messages.
    if (s.items.some((t) => t.message === message)) return s;
    return { items: [...s.items, { id: seq++, message, tone }].slice(-3) };
  }),
  dismiss: (id) => set((s) => ({ items: s.items.filter((t) => t.id !== id) })),

  action: null,
  showAction: (t) => {
    const id = seq++;
    clearActionTimer();
    set({ action: { ...t, id } });
    actionTimer = setTimeout(() => get().dismissAction(id), t.duration);
    return id;
  },
  dismissAction: (id) => {
    const cur = get().action;
    if (!cur || (id != null && cur.id !== id)) return;
    clearActionTimer();
    set({ action: null });
  },
  runAction: (id) => {
    const cur = get().action;
    if (!cur || cur.id !== id) return; // already gone or replaced: never run twice
    clearActionTimer();
    set({ action: null });
    try { cur.onAction(); } catch { /* the action reports its own failure */ }
  },
}));

export interface ActionOpts { label: string; onPress: () => void; tone?: ToastTone; duration?: number }

export const toast = {
  success: (m: string) => useToastStore.getState().push(m, "success"),
  error: (m: string) => useToastStore.getState().push(m, "danger"),
  info: (m: string) => useToastStore.getState().push(m, "info"),
  /** A toast with one button. Returns its id. */
  action: (m: string, o: ActionOpts): number =>
    useToastStore.getState().showAction({ message: m, tone: o.tone ?? "info", actionLabel: o.label, duration: o.duration ?? DEFAULT_ACTION_MS, onAction: o.onPress }),
  /** "Done · Undo" for ~5 s — the change is already made; Undo reverses it. */
  undo: (m: string, onUndo: () => void, o: { tone?: ToastTone; duration?: number } = {}): number =>
    toast.action(m, { label: "Undo", onPress: onUndo, tone: o.tone, duration: o.duration }),
};
