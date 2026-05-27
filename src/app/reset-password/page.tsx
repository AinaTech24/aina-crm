"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

function ResetPasswordInner() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (password !== confirm) {
      setErr("Passwords don't match");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/auth/reset", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const j = await res.json();
      if (!res.ok) {
        setErr(j.error ?? "Reset failed");
        return;
      }
      router.push("/dashboard");
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <main className="min-h-screen grid place-items-center">
        <div className="max-w-sm text-center">
          <h1 className="text-xl font-bold">Invalid link</h1>
          <p className="text-sm text-muted-foreground mt-2">No reset token provided.</p>
          <Link href="/login" className="text-sm text-primary hover:underline mt-4 inline-block">Back to sign in</Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen grid place-items-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-bold tracking-tight">Reset your password</h1>
        <form onSubmit={submit} className="mt-6 space-y-3">
          <div>
            <label className="text-xs font-medium block mb-1">New password (8+)</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="new-password"
              className="w-full border rounded-md px-3 py-2 text-sm bg-background"
            />
          </div>
          <div>
            <label className="text-xs font-medium block mb-1">Confirm</label>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              autoComplete="new-password"
              className="w-full border rounded-md px-3 py-2 text-sm bg-background"
            />
          </div>
          {err && <div className="text-sm text-rose-600">{err}</div>}
          <button
            disabled={busy || password.length < 8}
            className="w-full rounded-md bg-primary text-primary-foreground px-3 py-2 text-sm font-medium disabled:opacity-50"
          >
            {busy ? "Resetting…" : "Set new password"}
          </button>
        </form>
      </div>
    </main>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordInner />
    </Suspense>
  );
}
