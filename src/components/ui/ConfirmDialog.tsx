"use client";

/**
 * Branded confirmation dialog — a custom replacement for window.confirm().
 * Controlled: the parent owns `open` and supplies onConfirm / onCancel.
 *
 *   const [open, setOpen] = useState(false);
 *   <ConfirmDialog open={open} title="Log out?" message="…"
 *      confirmLabel="Log out" tone="danger"
 *      onConfirm={doLogout} onCancel={() => setOpen(false)} />
 */

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
        className="relative card-elevated w-full max-w-sm p-5 animate-scale-in"
      >
        <div className="flex items-start gap-3">
          <div
            className={`size-10 rounded-xl grid place-items-center shrink-0 ${
              danger ? "bg-rose-50 text-rose-600" : "bg-brand-cyan-light text-brand-cyan-deep"
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
          <button type="button" onClick={onCancel} disabled={busy} className="btn-secondary text-sm disabled:opacity-50">
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
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
