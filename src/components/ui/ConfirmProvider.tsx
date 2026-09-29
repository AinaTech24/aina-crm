"use client";

/**
 * Promise-based confirmation — the app-wide replacement for `window.confirm()`.
 *
 * The native dialog is a browser chrome box titled "localhost:3000 says", it
 * cannot be styled or branded, it blocks the whole tab, and its OK/Cancel
 * buttons never say what is about to happen. <ConfirmDialog> already existed as
 * the branded alternative, but it is *controlled* — every call site had to grow
 * its own `open` state and a pending-action ref, which is why 20-odd files
 * never migrated and still call the native one.
 *
 * This keeps the ergonomics of `confirm()` — ask, get a boolean, carry on — so
 * a call site changes by exactly one line:
 *
 *   if (!confirm("Delete this rule?")) return;              // before
 *   if (!(await confirm("Delete this rule?"))) return;      // after
 *
 * and gains a branded dialog, a real title/body split, a labelled action
 * button, and Escape/outside-click handling. Pass an object when the action is
 * destructive so the button turns red and says what it does:
 *
 *   await confirm({ title: "Delete this rule?", message: "…", confirmLabel: "Delete", tone: "danger" })
 *
 * If no provider is mounted above the caller (a surface that doesn't use the
 * dashboard shell), it degrades to `window.confirm` rather than throwing — the
 * question still gets asked.
 */

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { PromptDialog } from "@/components/ui/PromptDialog";

export type ConfirmOptions = {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
};

export type ConfirmFn = (options: string | ConfirmOptions) => Promise<boolean>;

/**
 * One-field ask — the replacement for `window.prompt()`. Resolves to the
 * trimmed string, or null when cancelled, so a call site reads:
 *
 *   const name = await promptDialog({ title: "Name your dashboard" });
 *   if (name === null) return;
 */
export type PromptOptions = {
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
};

export type PromptFn = (options: string | PromptOptions) => Promise<string | null>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

function normalise(options: string | ConfirmOptions): ConfirmOptions {
  return typeof options === "string" ? { title: options } : options;
}

function normalisePrompt(options: string | PromptOptions): PromptOptions {
  return typeof options === "string" ? { title: options } : options;
}

/**
 * The mounted provider's confirm, published module-side.
 *
 * Most `window.confirm()` call sites live in event handlers and helper
 * functions, not at the top of a component body where a hook may be called.
 * Rather than restructure each one, they import `confirmDialog` and await it.
 * There is exactly one provider per surface, so the singleton is well defined;
 * before it mounts (or with no provider at all) this falls back to the native
 * dialog, so the question is never silently skipped.
 */
let mountedConfirm: ConfirmFn | null = null;
let mountedPrompt: PromptFn | null = null;

export function confirmDialog(options: string | ConfirmOptions): Promise<boolean> {
  if (mountedConfirm) return mountedConfirm(options);
  if (typeof window === "undefined") return Promise.resolve(false);
  return Promise.resolve(window.confirm(normalise(options).title));
}

/** Branded `window.prompt()`. Resolves to the trimmed answer, or null if cancelled. */
export function promptDialog(options: string | PromptOptions): Promise<string | null> {
  if (mountedPrompt) return mountedPrompt(options);
  if (typeof window === "undefined") return Promise.resolve(null);
  const o = normalisePrompt(options);
  return Promise.resolve(window.prompt(o.title, o.defaultValue ?? "")?.trim() ?? null);
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<ConfirmOptions | null>(null);
  const [asking, setAsking] = useState<PromptOptions | null>(null);
  const answerPromptRef = useRef<((answer: string | null) => void) | null>(null);
  // The resolver for the promise handed to the caller. Held in a ref so
  // answering the dialog never depends on a re-render having flushed.
  const resolveRef = useRef<((answer: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((options) => {
    return new Promise<boolean>((resolve) => {
      // A second ask while one is open resolves the first as "cancelled" so no
      // caller is left awaiting a promise that can never settle.
      resolveRef.current?.(false);
      resolveRef.current = resolve;
      setPending(normalise(options));
    });
  }, []);

  const answer = useCallback((value: boolean) => {
    const resolve = resolveRef.current;
    resolveRef.current = null;
    setPending(null);
    resolve?.(value);
  }, []);

  const ask = useCallback<PromptFn>((options) => {
    return new Promise<string | null>((resolve) => {
      answerPromptRef.current?.(null);
      answerPromptRef.current = resolve;
      setAsking(normalisePrompt(options));
    });
  }, []);

  const answerPrompt = useCallback((result: string | null) => {
    const resolve = answerPromptRef.current;
    answerPromptRef.current = null;
    setAsking(null);
    resolve?.(result);
  }, []);

  const value = useMemo(() => confirm, [confirm]);

  // Publish for the imperative `confirmDialog()` used by handlers that can't
  // call a hook. Set during render rather than in an effect so a click handler
  // that fires before effects flush still gets the branded dialog.
  mountedConfirm = value;
  mountedPrompt = ask;

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      <ConfirmDialog
        open={pending !== null}
        title={pending?.title ?? ""}
        message={pending?.message}
        confirmLabel={pending?.confirmLabel ?? "Confirm"}
        cancelLabel={pending?.cancelLabel ?? "Cancel"}
        tone={pending?.tone ?? "default"}
        onConfirm={() => answer(true)}
        onCancel={() => answer(false)}
      />
      <PromptDialog
        open={asking !== null}
        title={asking?.title ?? ""}
        message={asking?.message}
        label={asking?.label}
        placeholder={asking?.placeholder}
        defaultValue={asking?.defaultValue ?? ""}
        confirmLabel={asking?.confirmLabel ?? "Save"}
        cancelLabel={asking?.cancelLabel ?? "Cancel"}
        multiline={asking?.multiline ?? false}
        optional={asking?.optional ?? false}
        maxLength={asking?.maxLength}
        onConfirm={(v) => answerPrompt(v)}
        onCancel={() => answerPrompt(null)}
      />
    </ConfirmContext.Provider>
  );
}

/**
 * Returns an async `confirm(...)`. Shadowing the global name on purpose: the
 * call sites read the same as before, just awaited.
 */
export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  return (
    ctx ??
    // No provider above us — ask natively rather than silently proceeding.
    ((options) => Promise.resolve(window.confirm(normalise(options).title)))
  );
}
