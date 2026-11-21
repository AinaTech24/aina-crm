"use client";

/**
 * Set a team member's password from an admin screen — Aina Admin (firm →
 * Team) and the firm's own Team Members. A strong password is generated (it
 * can be typed over), set on Confirm, then shown once with a Copy button so
 * the admin can hand it over. The member is signed out everywhere.
 */

import { useEffect, useState } from "react";
import { Check, Copy, Loader2, RefreshCw, X } from "lucide-react";
import { generatePassword, passwordProblem } from "@/lib/auth/password-gen";

export function SetPasswordDialog({ url, name, extraBody, onClose }: { url: string; name: string; extraBody?: Record<string, unknown>; onClose: () => void }) {
  const [pw, setPw] = useState(() => generatePassword());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ noticeSent: boolean } | null>(null);
  const [copied, setCopied] = useState(false);
  const problem = passwordProblem(pw);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...extraBody, password: pw }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) setError(j.error ?? "Could not set the password.");
      else setDone({ noticeSent: !!j.noticeSent });
    } catch {
      setError("Could not set the password.");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(pw);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      (document.getElementById("set-pw-value") as HTMLInputElement | null)?.select();
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/35 p-4" role="dialog" aria-modal="true" aria-label={`Set ${name}'s password`} onClick={() => !busy && onClose()}>
      <div className="w-full max-w-md rounded-xl border bg-card p-5 text-left shadow-xl space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3">
          <h3 className="min-w-0 flex-1 text-base font-semibold">{done ? `Password set for ${name}` : `Set a new password for ${name}`}</h3>
          <button type="button" className="btn-icon" aria-label="Close" disabled={busy} onClick={onClose}><X className="size-4" /></button>
        </div>

        <div>
          <label htmlFor="set-pw-value" className="text-xs font-medium text-muted-foreground">{done ? "Their new password" : "New password"}</label>
          <div className="mt-1 flex gap-2">
            <input
              id="set-pw-value"
              value={pw}
              readOnly={!!done}
              onChange={(e) => setPw(e.target.value)}
              spellCheck={false}
              autoComplete="off"
              className="input-base h-10 w-full font-mono text-base tracking-wide"
            />
            {done ? (
              <button type="button" onClick={copy} className="rounded-md border px-3 text-sm inline-flex items-center gap-1.5 hover:bg-accent whitespace-nowrap">
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />} {copied ? "Copied" : "Copy"}
              </button>
            ) : (
              <button type="button" onClick={() => setPw(generatePassword())} disabled={busy} title="Generate another" aria-label="Generate another password" className="btn-icon h-10 w-10 border">
                <RefreshCw className="size-4" />
              </button>
            )}
          </div>
          {!done && problem && <p className="mt-1 text-xs text-destructive">{problem}</p>}
        </div>

        {done ? (
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>Copy it now — it is not shown again. Share it privately (in person or on a call, not in a group chat), and ask {name} to change it under Settings → Profile after signing in.</p>
            <p>{name} has been signed out of every device{done.noticeSent ? " and emailed that their password was changed." : "."}</p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Setting it signs {name} out of every device and cancels any reset link already sent. You will see the password once, to share with them.
          </p>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex justify-end gap-2">
          {done ? (
            <button type="button" onClick={onClose} className="btn-primary">Done</button>
          ) : (
            <>
              <button type="button" onClick={onClose} disabled={busy} className="btn-secondary">Cancel</button>
              <button type="button" onClick={save} disabled={busy || !!problem} className="btn-primary inline-flex items-center gap-1.5">
                {busy && <Loader2 className="size-4 animate-spin" />} Set password
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
