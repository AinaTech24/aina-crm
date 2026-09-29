"use client";

/**
 * Branded single-field prompt — the replacement for `window.prompt()`.
 *
 * `ConfirmDialog` covers yes/no. The four remaining native dialogs in the app
 * all ask for one short string ("Name your dashboard", "Reason for rejection"),
 * which the browser renders in an unstyled chrome box that says
 * "localhost:3000 says" and gives no room for a label, a hint or validation.
 *
 * Controlled, same shape as ConfirmDialog so the two read alike at call sites.
 * A11y: the input is labelled and autofocused, Enter submits, Escape cancels,
 * and an empty value is rejected unless `optional` is set.
 */

import { useEffect, useId, useState } from "react";
import { MessageSquareText } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/Dialog";

export function PromptDialog({
  open,
  title,
  message,
  label,
  placeholder,
  defaultValue = "",
  confirmLabel = "Save",
  cancelLabel = "Cancel",
  multiline = false,
  optional = false,
  maxLength,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message?: string;
  label?: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  multiline?: boolean;
  optional?: boolean;
  maxLength?: number;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const [value, setValue] = useState(defaultValue);

  // Re-seed whenever a new question is asked, so a reused dialog never opens
  // holding the previous answer.
  useEffect(() => {
    if (open) setValue(defaultValue);
  }, [open, defaultValue]);

  const trimmed = value.trim();
  const canSubmit = optional || trimmed.length > 0;

  function submit() {
    if (!canSubmit) return;
    onConfirm(trimmed);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onCancel(); }}>
      <DialogContent className="max-w-sm" showClose={false}>
        <div className="flex items-start gap-3">
          <div className="size-10 rounded-lg grid place-items-center shrink-0 bg-brand-navy-light text-primary">
            <MessageSquareText className="size-5" />
          </div>
          <DialogHeader className="min-w-0 pr-0">
            <DialogTitle className="text-base">{title}</DialogTitle>
            {message && <DialogDescription className="leading-relaxed">{message}</DialogDescription>}
          </DialogHeader>
        </div>

        <div className="mt-3 space-y-1.5">
          <label htmlFor={id} className="block text-sm font-medium text-foreground">
            {label ?? title}
            {optional && <span className="ml-1 font-normal text-muted-foreground">(optional)</span>}
          </label>
          {multiline ? (
            <textarea
              id={id}
              autoFocus
              rows={3}
              maxLength={maxLength}
              value={value}
              placeholder={placeholder}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                // Enter submits, Shift+Enter keeps its usual newline.
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
              }}
              className="input-base"
            />
          ) : (
            <input
              id={id}
              autoFocus
              type="text"
              maxLength={maxLength}
              value={value}
              placeholder={placeholder}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } }}
              className="input-base"
            />
          )}
        </div>

        <DialogFooter>
          <button type="button" onClick={onCancel} className="btn-secondary text-sm">
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className="text-sm rounded-lg px-3.5 py-2 font-medium bg-primary text-primary-foreground transition-colors hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {confirmLabel}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
