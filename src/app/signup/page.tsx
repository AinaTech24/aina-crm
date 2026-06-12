"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, ArrowRight, Check, ShieldCheck } from "lucide-react";
import { ToastProvider, useToast } from "@/components/ui/Toast";
import { PasswordInput } from "@/components/ui/PasswordInput";

function SignupForm() {
  const router = useRouter();
  const toast = useToast();
  const [firmName, setFirmName] = useState("");
  const [arn, setArn] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ firmName, arn, ownerName, ownerEmail, password }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast.error(
          j.detail ? `${j.error ?? "Signup failed"} — ${j.detail}` : j.error ?? "Please check your details and try again.",
          "Couldn't create workspace"
        );
        setBusy(false);
        return;
      }
      toast.success("Workspace created — setting things up…", "You're all set");
      setTimeout(() => router.push("/dashboard"), 650);
    } catch {
      toast.error("Something went wrong. Please try again.", "Couldn't create workspace");
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen grid grid-cols-1 lg:grid-cols-2">
      {/* Left — brand + value */}
      <div className="hidden lg:flex relative brand-gradient text-white flex-col justify-between p-12 overflow-hidden">
        <div className="absolute -top-32 -left-32 size-96 rounded-full bg-white/10 blur-3xl" />
        <div className="absolute -bottom-32 -right-32 size-96 rounded-full bg-brand-cyan/20 blur-3xl" />

        <Link href="/" className="relative z-10 inline-flex items-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/aina-logo.png" alt="Aina CRM" className="h-11 w-auto bg-white rounded-xl px-3 py-2 shadow-lg" />
        </Link>

        <div className="relative z-10 space-y-6 max-w-md">
          <h1 className="text-4xl font-bold tracking-tight leading-tight">
            Start growing your practice <span className="text-brand-cyan-light">today</span>.
          </h1>
          <ul className="space-y-3">
            {[
              "Free 14-day trial — no card required",
              "Live in an afternoon, your whole team included",
              "SEBI-compliant automation from day one",
              "Live XIRR, churn AI, SIP tracking & 40+ reports",
            ].map((t) => (
              <li key={t} className="flex items-center gap-3 text-white/90">
                <span className="size-5 rounded-full bg-white/15 grid place-items-center shrink-0">
                  <Check className="size-3 text-brand-cyan-light" />
                </span>
                {t}
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-2 text-sm text-white/70 pt-2">
            <ShieldCheck className="size-4" /> Bank-grade security · DPDP-ready · cancel anytime
          </div>
        </div>

        <div className="relative z-10 text-xs text-white/60">Built by Aina Tech Services LLP · © {new Date().getFullYear()}</div>
      </div>

      {/* Right — form */}
      <div className="flex items-center justify-center p-6 bg-background brand-soft">
        <div className="w-full max-w-sm animate-fade-in">
          <div className="lg:hidden mb-8">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/aina-wordmark.png" alt="Aina CRM" className="h-8 w-auto" />
          </div>

          <h1 className="text-3xl font-bold tracking-tight">Create your workspace</h1>
          <p className="text-muted-foreground mt-1.5 text-sm">14-day free trial. No card required.</p>

          <form onSubmit={submit} className="mt-8 space-y-4">
            <Field label="Firm name" value={firmName} setValue={setFirmName} placeholder="Acme Wealth Advisors" />
            <Field label="ARN" value={arn} setValue={setArn} placeholder="ARN-123456" />
            <Field label="Your name" value={ownerName} setValue={setOwnerName} placeholder="Your full name" />
            <Field label="Work email" value={ownerEmail} setValue={setOwnerEmail} type="email" autoComplete="email" placeholder="you@yourfirm.com" />
            <Field label="Password" value={password} setValue={setPassword} type="password" autoComplete="new-password" placeholder="8+ characters" />

            <button disabled={busy} className="btn-primary w-full mt-2">
              {busy ? (
                <><Loader2 className="size-4 animate-spin" /> Creating…</>
              ) : (
                <>Create workspace <ArrowRight className="size-4" /></>
              )}
            </button>
          </form>

          <div className="mt-6 pt-6 border-t border-border text-center text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link href="/login" className="text-brand-cyan font-semibold hover:underline">Sign in</Link>
          </div>

          <p className="mt-6 text-[11px] text-muted-foreground text-center leading-relaxed">
            By creating a workspace you agree that mutual fund investments are subject to market risks; read all
            scheme related documents carefully.
          </p>
        </div>
      </div>
    </main>
  );
}

export default function SignupPage() {
  return (
    <ToastProvider>
      <SignupForm />
    </ToastProvider>
  );
}

function Field({
  label, value, setValue, type = "text", placeholder, autoComplete,
}: {
  label: string; value: string; setValue: (v: string) => void;
  type?: string; placeholder?: string; autoComplete?: string;
}) {
  return (
    <div>
      <label className="text-xs font-semibold text-foreground/80 block mb-1.5">{label}</label>
      {type === "password" ? (
        <PasswordInput
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          required
        />
      ) : (
        <input
          type={type}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          required
          className="input-base"
        />
      )}
    </div>
  );
}
