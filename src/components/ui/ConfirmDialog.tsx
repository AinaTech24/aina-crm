"use client";

/**
 * Branded confirmation dialog — a custom replacement for window.confirm().
 * Controlled: the parent owns `open` and supplies onConfirm / onCancel.
 *
 *   const [open, setOpen] = useState(false);
 *   <ConfirmDialog open={open} title="Log out?" message="…"
 *      confirmLabel="Log out" tone="danger"
 *      onConfirm={doLogout} onCancel={() => setOpen(false)} />
 *
 * A11y: focuses Cancel on open (safe default), Escape cancels, and focus
 * returns to the previously-focused element on close.
 */

import { useEffect, useRef } from "react";
import { AlertTriangle } from "lucide-react";

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "default",
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const cancelCb = useRef(onCancel);
  cancelCb.current = onCancel;

  // Focus management + Escape-to-cancel while open.
  useEffect(() => {
    if (!open) return;
    restoreRef.current = (document.activeElement as HTMLElement) ?? null;
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busyRef.current) {
        e.stopPropagation();
        cancelCb.current();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      restoreRef.current?.focus?.();
    };
  }, [open]);

  if (!open) return null;
  const danger = tone === "danger";
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4 print:hidden">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-[1px]"
        onClick={busy ? undefined : onCancel}
      />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        className="relative card-elevated w-full max-w-sm max-h-[85vh] overflow-y-auto p-5 animate-scale-in"
      >
        <div className="flex items-start gap-3">
          <div
            className={`size-10 rounded-xl grid place-items-center shrink-0 ${
              danger
                ? "bg-rose-50 text-rose-600 dark:bg-rose-950/60 dark:text-rose-400"
                : "bg-brand-cyan-light text-brand-cyan-deep"
            }`}
          >
            <AlertTriangle className="size-5" />
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold text-sm text-foreground">{title}</h3>
            {message && <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{message}</p>}
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="btn-secondary text-sm disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            aria-live="polite"
            className={`text-sm rounded-lg px-3.5 py-2 font-medium text-white transition-colors disabled:opacity-50 ${
              danger ? "bg-rose-600 hover:bg-rose-700" : "bg-brand-cyan hover:opacity-90"
            }`}
          >
            {busy ? "Please wait…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
