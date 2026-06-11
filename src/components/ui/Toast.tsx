"use client";

/**
 * Custom toaster — branded, top-center, with success / error / warning / info
 * variants and a dismiss (X) button on every toast. Replaces ad-hoc inline
 * error banners and any reliance on the browser's alert().
 *
 * Usage:
 *   const toast = useToast();
 *   toast.success("Task updated");
 *   toast.error("Could not save", "Save failed");
 *
 * The <ToastProvider> is mounted once in the dashboard layout, wrapping the
 * whole shell, so any client component below can call useToast().
 */

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { CheckCircle2, AlertTriangle, XCircle, Info, X } from "lucide-react";

type ToastType = "success" | "error" | "warning" | "info";
type ToastItem = { id: number; type: ToastType; message: string; title?: string };

type PushArgs = { type?: ToastType; message: string; title?: string; duration?: number };

export type ToastApi = {
  toast: (t: PushArgs) => void;
  success: (message: string, title?: string) => void;
  error: (message: string, title?: string) => void;
  warning: (message: string, title?: string) => void;
  info: (message: string, title?: string) => void;
  dismiss: (id: number) => void;
};

const ToastCtx = createContext<ToastApi | null>(null);

const NOOP: ToastApi = {
  toast() {},
  success() {},
  error() {},
  warning() {},
  info() {},
  dismiss() {},
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const counter = useRef(0);

  const dismiss = useCallback((id: number) => {
    setItems((p) => p.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (t: PushArgs) => {
      const id = ++counter.current;
      const type = t.type ?? "info";
      setItems((p) => [...p.slice(-4), { id, type, message: t.message, title: t.title }]);
      const duration = t.duration ?? (type === "error" ? 7000 : type === "warning" ? 5500 : 4000);
      if (duration > 0) setTimeout(() => dismiss(id), duration);
    },
    [dismiss]
  );

  const api: ToastApi = {
    toast: push,
    success: (message, title) => push({ type: "success", message, title }),
    error: (message, title) => push({ type: "error", message, title }),
    warning: (message, title) => push({ type: "warning", message, title }),
    info: (message, title) => push({ type: "info", message, title }),
    dismiss,
  };

  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] flex flex-col items-center gap-2 w-[min(92vw,26rem)] pointer-events-none print:hidden">
        {items.map((t) => (
          <ToastCard key={t.id} item={t} onDismiss={dismiss} />
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/** Safe in any client component — falls back to a no-op if no provider mounted. */
export function useToast(): ToastApi {
  return useContext(ToastCtx) ?? NOOP;
}

const META: Record<
  ToastType,
  { icon: any; ring: string; bg: string; text: string; iconC: string }
> = {
  success: { icon: CheckCircle2, ring: "border-emerald-200 dark:border-emerald-900", bg: "bg-emerald-50 dark:bg-emerald-950/80", text: "text-emerald-900 dark:text-emerald-200", iconC: "text-emerald-600 dark:text-emerald-400" },
  error: { icon: XCircle, ring: "border-rose-200 dark:border-rose-900", bg: "bg-rose-50 dark:bg-rose-950/80", text: "text-rose-900 dark:text-rose-200", iconC: "text-rose-600 dark:text-rose-400" },
  warning: { icon: AlertTriangle, ring: "border-amber-200 dark:border-amber-900", bg: "bg-amber-50 dark:bg-amber-950/80", text: "text-amber-900 dark:text-amber-200", iconC: "text-amber-600 dark:text-amber-400" },
  info: { icon: Info, ring: "border-sky-200 dark:border-sky-900", bg: "bg-sky-50 dark:bg-sky-950/80", text: "text-sky-900 dark:text-sky-200", iconC: "text-sky-600 dark:text-sky-400" },
};

function ToastCard({ item, onDismiss }: { item: ToastItem; onDismiss: (id: number) => void }) {
  const m = META[item.type];
  const Icon = m.icon;
  return (
    <div
      role="status"
      aria-live="polite"
      className={`pointer-events-auto w-full rounded-xl border ${m.ring} ${m.bg} shadow-lg px-3.5 py-2.5 flex items-start gap-2.5 animate-scale-in`}
    >
      <Icon className={`size-5 ${m.iconC} mt-0.5 shrink-0`} />
      <div className="min-w-0 flex-1">
        {item.title && <div className={`text-sm font-semibold ${m.text}`}>{item.title}</div>}
        <div className={`text-xs ${m.text} ${item.title ? "mt-0.5 opacity-90" : "font-medium"} break-words`}>
          {item.message}
        </div>
      </div>
      <button
        type="button"
        onClick={() => onDismiss(item.id)}
        className={`${m.iconC} hover:opacity-70 shrink-0 -mr-0.5`}
        aria-label="Dismiss"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
