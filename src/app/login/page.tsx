"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Loader2, ArrowRight, ShieldCheck } from "lucide-react";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") ?? "/dashboard";

  // Platform-admin (AINA) staff land on the admin console; everyone else goes to
  // the MFD app. Honour an explicit `next` only when it already points at the
  // right surface, so an admin who was bounced from /dashboard still ends up home.
  function destFor(roles: unknown): string {
    const r = Array.isArray(roles) ? roles.map(String) : [];
    const isAdmin = r.includes("platform_admin") || r.includes("platform_support");
    if (isAdmin) return next.startsWith("/super-admin") ? next : "/super-admin";
    return next.startsWith("/super-admin") ? "/dashboard" : next;
  }
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // 2FA step: set once the password leg returns a challenge.
  const [challenge, setChallenge] = useState<string | null>(null);
  const [twoFaCode, setTwoFaCode] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(j.error ?? "Sign-in failed");
        return;
      }
      if (j.require2fa) {
        // Password OK — switch to the second-factor step.
        setChallenge(j.challenge);
        return;
      }
      router.push(destFor(j.user?.roles));
    } finally {
      setBusy(false);
    }
  }

  async function submit2fa(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const res = await fetch("/api/auth/2fa/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ challenge, code: twoFaCode.trim() }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(j.error ?? "Verification failed");
        return;
      }
      router.push(destFor(j.user?.roles));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen grid grid-cols-1 lg:grid-cols-2">
      {/* Left — brand panel */}
      <div className="hidden lg:flex relative brand-gradient text-white flex-col justify-between p-12 overflow-hidden">
        {/* Decorative orbs */}
        <div className="absolute -top-32 -left-32 size-96 rounded-full bg-white/10 blur-3xl" />
        <div className="absolute -bottom-32 -right-32 size-96 rounded-full bg-brand-cyan/20 blur-3xl" />

        <div className="relative z-10">
          <Link href="/" className="inline-flex items-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/aina-logo.png" alt="Aina CRM" className="h-11 w-auto bg-white rounded-xl px-3 py-2 shadow-lg" />
          </Link>
        </div>

        <div className="relative z-10 space-y-5 max-w-md">
          <h1 className="text-4xl font-bold tracking-tight leading-tight">
            The practice operating system for India's <span className="text-brand-cyan-light">top MFDs</span>.
          </h1>
          <p className="text-white/80 text-lg leading-relaxed">
            Workflows, compliance, broadcasts, dashboards. Everything an MFD firm needs to scale —
            without hiring an ops team.
          </p>
          <div className="grid grid-cols-2 gap-3 pt-4">
            {[
              "23 modules out of the box",
              "25 pre-built automations",
              "AMFI + SEBI compliant",
              "AiSensy · Resend · MSG91",
            ].map((t) => (
              <div key={t} className="flex items-center gap-2 text-sm text-white/90">
                <div className="size-1.5 rounded-full bg-brand-cyan-light" />
                {t}
              </div>
            ))}
          </div>
        </div>

        <div className="relative z-10 text-xs text-white/60">
          Built by Aina Tech Services LLP · © {new Date().getFullYear()}
        </div>
      </div>

      {/* Right — sign-in card */}
      <div className="flex items-center justify-center p-6 bg-background brand-soft">
        <div className="w-full max-w-sm animate-fade-in">
          <div className="lg:hidden mb-8">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/aina-wordmark.png" alt="Aina CRM" className="h-8 w-auto" />
          </div>

          <h1 className="text-3xl font-bold tracking-tight">
            {challenge ? "Two-factor verification" : "Welcome back"}
          </h1>
          <p className="text-muted-foreground mt-1.5 text-sm">
            {challenge
              ? "Enter the 6-digit code from your authenticator app"
              : "Sign in to your firm's workspace"}
          </p>

          {/* 2FA step */}
          {challenge ? (
            <form onSubmit={submit2fa} className="mt-8 space-y-4">
              <div>
                <label className="text-xs font-semibold text-foreground/80 block mb-1.5">
                  Authentication code
                </label>
                <input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                  value={twoFaCode}
                  onChange={(e) => setTwoFaCode(e.target.value.replace(/[^\dA-Za-z-]/g, "").slice(0, 11))}
                  placeholder="123456"
                  className="input-base text-center text-lg tracking-[0.3em] font-mono"
                  required
                />
                <p className="text-[11px] text-muted-foreground mt-1.5">
                  Lost your device? Enter one of your backup codes instead.
                </p>
              </div>

              {err && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                  {err}
                </div>
              )}

              <button disabled={busy} className="btn-primary w-full mt-2">
                {busy ? (
                  <>
                    <Loader2 className="size-4 animate-spin" /> Verifying…
                  </>
                ) : (
                  <>
                    <ShieldCheck className="size-4" /> Verify & sign in
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => {
                  setChallenge(null);
                  setTwoFaCode("");
                  setErr(null);
                }}
                className="text-xs text-muted-foreground hover:underline w-full text-center"
              >
                ← Back to sign in
              </button>
            </form>
          ) : (

          <form onSubmit={submit} className="mt-8 space-y-4">
            <div>
              <label className="text-xs font-semibold text-foreground/80 block mb-1.5">Work email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
                placeholder="you@yourfirm.com"
                className="input-base"
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-semibold text-foreground/80">Password</label>
                <Link href="/forgot-password" className="text-xs text-brand-cyan hover:underline font-medium">
                  Forgot?
                </Link>
              </div>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
                placeholder="••••••••"
                className="input-base"
              />
            </div>

            {err && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {err}
              </div>
            )}

            <button disabled={busy} className="btn-primary w-full mt-2">
              {busy ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> Signing in…
                </>
              ) : (
                <>
                  Sign in <ArrowRight className="size-4" />
                </>
              )}
            </button>
          </form>
          )}

          <div className="mt-6 pt-6 border-t border-border text-center text-sm text-muted-foreground">
            Don't have a workspace yet?{" "}
            <Link href="/signup" className="text-brand-cyan font-semibold hover:underline">
              Create one
            </Link>
          </div>

          <p className="mt-8 text-[11px] text-muted-foreground text-center">
            Dev mode? Set <code className="bg-secondary px-1.5 py-0.5 rounded">NO_AUTH=1</code> in
            <code className="bg-secondary px-1.5 py-0.5 rounded ml-1">.env</code> to bypass login.
          </p>
        </div>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen grid place-items-center brand-soft">
          <Loader2 className="size-6 animate-spin text-brand-cyan" />
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
