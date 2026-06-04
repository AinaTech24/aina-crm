"use client";

import { useState } from "react";
import Link from "next/link";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [devLink, setDevLink] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch("/api/auth/forgot", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const j = await res.json();
      setDone(true);
      if (j.devResetUrl) setDevLink(j.devResetUrl);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen grid place-items-center px-4">
      <div className="w-full max-w-sm">
        <Link href="/" className="inline-flex items-center mb-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/aina-wordmark.png" alt="Aina CRM" className="h-7 w-auto" />
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">Forgot password</h1>
        <p className="text-sm text-muted-foreground mt-1">
          We'll email a reset link to your work address. The link is good for 1 hour.
        </p>

        {!done ? (
          <form onSubmit={submit} className="mt-6 space-y-3">
            <div>
              <label className="text-xs font-medium block mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                className="w-full border rounded-md px-3 py-2 text-sm bg-background"
              />
            </div>
            <button
              disabled={busy}
              className="w-full rounded-md bg-primary text-primary-foreground px-3 py-2 text-sm font-medium disabled:opacity-50"
            >
              {busy ? "Sending…" : "Send reset link"}
            </button>
          </form>
        ) : (
          <div className="mt-6 border rounded-md p-4 bg-emerald-50 border-emerald-300 text-sm text-emerald-900">
            If an account exists for <strong>{email}</strong>, a reset link is on the way. Check your inbox.
            {devLink && (
              <>
                <hr className="my-3 border-emerald-200" />
                <div className="text-xs text-emerald-800">
                  <strong>Dev mode:</strong> use this link directly:
                </div>
                <Link
                  href={devLink}
                  className="block mt-1 text-xs font-mono break-all text-emerald-800 underline"
                >
                  {devLink}
                </Link>
              </>
            )}
          </div>
        )}

        <p className="mt-4 text-xs text-muted-foreground">
          <Link href="/login" className="hover:underline">Back to sign in</Link>
        </p>
      </div>
    </main>
  );
}
