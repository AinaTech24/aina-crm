"use client";

/**
 * Plan selection for a brand-new (status='pending') workspace. Picking a plan
 * calls /api/onboarding/select-plan:
 *   - activated → no charge (payments not configured / free plan): log out, go to login.
 *   - needsPayment → open Razorpay checkout; on success log out, go to login.
 * After login the (now active) tenant lands on their dashboard with the plan's modules.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Check, Sparkles } from "lucide-react";

export type Plan = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  monthlyPaise: number;
  yearlyPaise: number;
  setupPaise: number;
  perUserMonthlyPaise: number;
  badge: string | null;
  moduleKeys: string[];
  maxUsers: number;
  maxInvestors: number;
  storageGb: number;
  trialDays: number;
};

function inr(paise: number): string {
  return "₹" + Math.round(paise / 100).toLocaleString("en-IN");
}

/** "client_master" → "Client Master" */
function humanizeModule(k: string): string {
  return k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function loadScript(src: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve(true);
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });
}

export function ChoosePlanClient({ plans, firmName }: { plans: Plan[]; firmName: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function goToLogin() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    router.push("/login?onboarded=1");
  }

  async function openRazorpay(j: any, plan: Plan) {
    const ok = await loadScript("https://checkout.razorpay.com/v1/checkout.js");
    if (!ok || !(window as any).Razorpay) {
      setErr("Couldn't load the payment window. Please retry.");
      setBusy(null);
      return;
    }
    const rzp = new (window as any).Razorpay({
      key: j.keyId,
      subscription_id: j.razorpaySubscriptionId,
      name: firmName || "Your workspace",
      description: `${plan.name} plan`,
      handler: () => {
        // Razorpay confirms the mandate; our webhook flips the subscription to
        // active. Send the owner to login — by the time they sign in it's active.
        void goToLogin();
      },
      modal: { ondismiss: () => setBusy(null) },
      theme: { color: "#0e2557" },
    });
    rzp.open();
  }

  async function choose(plan: Plan) {
    setBusy(plan.id);
    setErr(null);
    try {
      const res = await fetch("/api/onboarding/select-plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ packageId: plan.id }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (j.alreadyActive) return router.push("/dashboard");
        setErr(j.error ?? "Couldn't select that plan.");
        setBusy(null);
        return;
      }
      if (j.activated) return goToLogin();
      if (j.needsPayment) return openRazorpay(j, plan);
      setErr("Unexpected response — please retry.");
      setBusy(null);
    } catch (e: any) {
      setErr(e?.message ?? "Something went wrong.");
      setBusy(null);
    }
  }

  return (
    <div className="min-h-screen bg-secondary/30 px-4 py-10">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-cyan-deep bg-brand-cyan-light/60 rounded-full px-3 py-1 mb-3">
            <Sparkles className="size-3.5" /> Workspace created
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Choose your plan</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Pick the package that fits {firmName ? `${firmName}` : "your firm"}. You'll confirm, then sign in to your dashboard.
          </p>
        </div>

        {err && <div className="max-w-md mx-auto mb-4 text-sm text-rose-600 text-center">{err}</div>}

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 items-stretch">
          {plans.map((p) => (
            <div key={p.id} className="relative flex flex-col rounded-2xl border border-border bg-card p-5 shadow-sm">
              {p.badge && (
                <span className="absolute -top-2.5 right-4 text-[10px] font-bold uppercase tracking-wide bg-primary text-primary-foreground rounded-full px-2 py-0.5">
                  {p.badge}
                </span>
              )}
              <div className="font-bold text-lg">{p.name}</div>
              {p.description && <div className="text-xs text-muted-foreground mt-0.5">{p.description}</div>}
              <div className="mt-3">
                <span className="text-2xl font-extrabold">{p.monthlyPaise > 0 ? inr(p.monthlyPaise) : "Free"}</span>
                {p.monthlyPaise > 0 && <span className="text-xs text-muted-foreground">/mo</span>}
                {p.yearlyPaise > 0 && (
                  <div className="text-[11px] text-muted-foreground">or {inr(p.yearlyPaise)}/yr (billed yearly)</div>
                )}
                <div className="text-[11px] text-muted-foreground mt-0.5 space-x-2">
                  {p.setupPaise > 0 && <span>One-time setup {inr(p.setupPaise)}</span>}
                  {p.perUserMonthlyPaise > 0 && <span>+ {inr(p.perUserMonthlyPaise)}/extra user/mo</span>}
                </div>
              </div>

              {/* Limits */}
              <ul className="mt-3 space-y-1.5 text-xs">
                <li className="flex items-center gap-1.5"><Check className="size-3.5 text-emerald-600 shrink-0" /> Up to {p.maxUsers} user{p.maxUsers === 1 ? "" : "s"}</li>
                <li className="flex items-center gap-1.5"><Check className="size-3.5 text-emerald-600 shrink-0" /> Up to {p.maxInvestors.toLocaleString("en-IN")} clients</li>
                <li className="flex items-center gap-1.5"><Check className="size-3.5 text-emerald-600 shrink-0" /> {p.storageGb} GB document storage</li>
                {p.trialDays > 0 && <li className="flex items-center gap-1.5"><Check className="size-3.5 text-emerald-600 shrink-0" /> {p.trialDays}-day trial window</li>}
              </ul>

              {/* Actual modules included in this package (admin-configured) */}
              <div className="mt-3 flex-1">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
                  {p.moduleKeys.length} modules included
                </div>
                <div className="flex flex-wrap gap-1 max-h-32 overflow-y-auto scrollbar-thin">
                  {p.moduleKeys.length === 0 ? (
                    <span className="text-[11px] text-muted-foreground">No modules configured</span>
                  ) : (
                    p.moduleKeys.map((k) => (
                      <span key={k} className="text-[10px] bg-secondary rounded px-1.5 py-0.5 text-muted-foreground">
                        {humanizeModule(k)}
                      </span>
                    ))
                  )}
                </div>
              </div>
              <button
                onClick={() => choose(p)}
                disabled={!!busy}
                className="mt-4 btn-primary w-full justify-center disabled:opacity-50"
              >
                {busy === p.id ? <Loader2 className="size-4 animate-spin" /> : null}
                {busy === p.id ? "Setting up…" : p.monthlyPaise > 0 ? "Choose & pay" : "Choose plan"}
              </button>
            </div>
          ))}
        </div>

        <p className="text-center text-[11px] text-muted-foreground mt-6">
          You're signed in to set this up. After confirming your plan, you'll be taken to the login page to enter your new dashboard.
        </p>
      </div>
    </div>
  );
}
