"use client";

import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { useState } from "react";
import Link from "next/link";
import { Copy, RefreshCw } from "lucide-react";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { generatePassword, passwordProblem } from "@/lib/auth/password-gen";
import { usernameProblem } from "@/lib/auth/username-login";

const ROLES = [
  { key: "rm", label: "Relationship Manager" },
  { key: "back_office", label: "Back Office" },
  { key: "marketing", label: "Marketing" },
  { key: "compliance", label: "Compliance / DDQ" },
  { key: "branch_head", label: "Branch Head" },
  { key: "team_member", label: "Limited Team Member" },
];

/** "email": an invite link the person accepts. "username": the login is made now, with no email. */
type Mode = "email" | "username";

export default function AddTeamMemberPage() {
  const [mode, setMode] = useState<Mode>("email");
  const [form, setForm] = useState({ name: "", email: "", username: "", password: "", phone: "", roles: ["rm"] });
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [created, setCreated] = useState<{ username: string; password: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function toggleRole(key: string) {
    setForm((s) => ({
      ...s,
      roles: s.roles.includes(key) ? s.roles.filter((r) => r !== key) : [...s.roles, key],
    }));
  }

  const usernameHint = form.username ? usernameProblem(form.username) : null;
  const passwordHint = form.password ? passwordProblem(form.password) : null;
  const ready =
    form.roles.length > 0 &&
    (mode === "email"
      ? !!form.email
      : form.name.trim().length >= 2 && !!form.username && !usernameHint && !!form.password && !passwordHint);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const body =
        mode === "email"
          ? { name: form.name || undefined, email: form.email, roles: form.roles }
          : { name: form.name, username: form.username, password: form.password, phone: form.phone || undefined, roles: form.roles };
      const res = await fetch(mode === "email" ? "/api/employees/invite" : "/api/employees/create-login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(j.error ?? "Failed");
        return;
      }
      if (mode === "email") setInviteUrl(j.inviteUrl);
      else setCreated({ username: j.username, password: form.password });
    } catch {
      setErr("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const input = "w-full border rounded-md px-3 py-2 text-sm bg-background";
  const signInDetails = created
    ? `Sign in at ${typeof window === "undefined" ? "" : window.location.origin}/login\nUsername: ${created.username}\nPassword: ${created.password}`
    : "";

  return (
    <div className="space-y-4 max-w-2xl">
      <PageHeaderCard title={<>Add team member</>} />

      {inviteUrl ? (
        <div className="border rounded-lg bg-card p-5 space-y-3">
          <div className="text-sm font-medium text-emerald-600">✓ Invite link generated. Share with {form.email}:</div>
          <div className="flex gap-2">
            <input readOnly value={inviteUrl} aria-label="Invite link" className="flex-1 border rounded-md px-3 py-2 text-xs font-mono bg-muted" />
            <button onClick={() => navigator.clipboard.writeText(inviteUrl)} className="rounded-md border px-3 text-sm flex items-center gap-1">
              <Copy className="size-3.5" /> Copy
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            Valid for 7 days. The invitee will set their own password when they click the link.
          </p>
          <div className="flex flex-wrap justify-end gap-2 pt-2 border-t">
            <Link href="/dashboard/employees" className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium">Done</Link>
          </div>
        </div>
      ) : created ? (
        <div className="border rounded-lg bg-card p-5 space-y-3">
          <div className="text-sm font-medium text-emerald-600">✓ Login created for {form.name}. Give them these details:</div>
          <pre className="whitespace-pre-wrap break-all rounded-md border bg-muted px-3 py-2 text-sm font-mono">{signInDetails}</pre>
          <p className="text-xs text-muted-foreground">
            The password is shown only now — copy it before you leave. You can set a new one any time from the team list.
          </p>
          <div className="flex flex-wrap justify-end gap-2 pt-2 border-t">
            <button onClick={() => navigator.clipboard.writeText(signInDetails)} className="rounded-md border px-4 py-2 text-sm flex items-center gap-1">
              <Copy className="size-3.5" /> Copy
            </button>
            <Link href="/dashboard/employees" className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium">Done</Link>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="border rounded-lg bg-card p-5 space-y-3">
          <div role="radiogroup" aria-label="How they sign in" className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {([
              ["email", "Invite by email", "They get a link and set their own password."],
              ["username", "Username & password", "No email needed. You set both and hand them over."],
            ] as const).map(([key, label, hint]) => (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={mode === key}
                onClick={() => { setMode(key); setErr(null); }}
                className={`rounded-lg border px-3 py-2 text-left ${mode === key ? "border-primary bg-primary/10" : "border-border hover:bg-accent"}`}
              >
                <div className="text-sm font-semibold">{label}</div>
                <div className="text-2xs text-muted-foreground">{hint}</div>
              </button>
            ))}
          </div>

          <label className="block">
            <div className="text-xs font-medium mb-1">Name{mode === "username" && <span className="text-destructive">*</span>}</div>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={input} />
          </label>

          {mode === "email" ? (
            <label className="block">
              <div className="text-xs font-medium mb-1">Work email<span className="text-destructive">*</span></div>
              <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={input} />
            </label>
          ) : (
            <>
              <label className="block">
                <div className="text-xs font-medium mb-1">Username<span className="text-destructive">*</span></div>
                <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value.replace(/\s/g, "").toLowerCase() })} autoComplete="off" autoCapitalize="none" maxLength={40} placeholder="e.g. ravi.shah" className={input} />
                <div className={`mt-1 text-2xs ${usernameHint ? "text-destructive" : "text-muted-foreground"}`}>
                  {usernameHint ?? "They type this instead of an email on the sign-in page."}
                </div>
              </label>
              <div>
                <label className="block">
                  <div className="text-xs font-medium mb-1">Password<span className="text-destructive">*</span></div>
                  <PasswordInput value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="new-password" placeholder="At least 10 characters" />
                </label>
                <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                  <span className={`text-2xs ${passwordHint ? "text-destructive" : "text-muted-foreground"}`}>
                    {passwordHint ?? "Upper-case, lower-case letters and digits."}
                  </span>
                  <button type="button" onClick={() => setForm((s) => ({ ...s, password: generatePassword() }))} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                    <RefreshCw className="size-3" /> Generate one
                  </button>
                </div>
              </div>
              <label className="block">
                <div className="text-xs font-medium mb-1">Mobile (optional)</div>
                <input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} maxLength={20} className={input} />
              </label>
              <p className="rounded-md border bg-secondary/40 px-3 py-2 text-xs text-muted-foreground">
                Without an email address they get no CRM emails (reminders, reports) and cannot reset a forgotten password themselves — you set a new one from the team list. In-app notifications still reach them.
              </p>
            </>
          )}

          <div>
            <div className="text-xs font-medium mb-2">Roles (one or more)</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {ROLES.map((r) => (
                <label key={r.key} className="flex items-center gap-2 border rounded-md p-2 cursor-pointer hover:bg-accent">
                  <input
                    type="checkbox"
                    checked={form.roles.includes(r.key)}
                    onChange={() => toggleRole(r.key)}
                    className="size-3.5"
                  />
                  <span className="text-sm">{r.label}</span>
                </label>
              ))}
            </div>
          </div>
          {err && <div className="text-sm text-destructive">{err}</div>}
          <div className="flex flex-wrap justify-end gap-2 pt-2 border-t">
            <Link href="/dashboard/employees" className="rounded-md border px-4 py-2 text-sm">Cancel</Link>
            <button disabled={busy || !ready} className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium disabled:opacity-50">
              {busy ? "Working…" : mode === "email" ? "Generate invite link" : "Create login"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
