"use client";

/**
 * AutoPaySetup — lets an MFD owner authorize a Razorpay e-mandate so their
 * yearly subscription auto-debits. Calls /api/billing/subscribe to create the
 * Razorpay subscription, then opens Razorpay Checkout to capture the mandate
 * (UPI Autopay / card / netbanking). Razorpay drives the rest via webhook.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck, Loader2, CreditCard, AlertTriangle } from "lucide-react";

const inr = (paise: number) => `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;

function loadCheckoutScript(): Promise<boolean> {
  return new Promise((resolve) => {
    if ((window as any).Razorpay) return resolve(true);
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });
}

export function AutoPaySetup({
  configured,
  mandateStatus,
  status,
  amountPaise,
  seats,
  canManage,
}: {
  configured: boolean;
  mandateStatus: string;
  status: string;
  amountPaise: number;
  seats: number;
  canManage: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const active = mandateStatus === "active";

  async function setup() {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/billing/subscribe", { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);

      const ok = await loadCheckoutScript();
      if (!ok) throw new Error("Could not load the payment window. Check your connection and retry.");

      const rzp = new (window as any).Razorpay({
        key: j.keyId,
        subscription_id: j.subscriptionId,
        name: "Aina CRM",
        description: `Yearly subscription · ${seats} user${seats === 1 ? "" : "s"} · ${inr(j.amountPaise ?? amountPaise)}/yr`,
        theme: { color: "#C5202A" },
        handler: () => {
          // Mandate authorized — Razorpay's webhook will flip us to active.
          router.refresh();
        },
        modal: { ondismiss: () => setBusy(false) },
      });
      rzp.on("payment.failed", (resp: any) => setErr(resp?.error?.description ?? "Authorization failed."));
      rzp.open();
    } catch (e: any) {
      setErr(e?.message ?? "Could not start auto-pay setup.");
      setBusy(false);
    }
  }

  if (!configured) {
    return (
      <div className="border rounded-lg bg-card p-6">
        <h2 className="font-semibold flex items-center gap-2">
          <CreditCard className="size-4" /> Auto-pay
        </h2>
        <p className="text-sm text-muted-foreground mt-2">
          Online auto-pay isn&rsquo;t enabled on this environment yet. Your license is managed manually by AINA.
        </p>
      </div>
    );
  }

  return (
    <div className="border rounded-lg bg-card p-6">
      <h2 className="font-semibold flex items-center gap-2">
        <ShieldCheck className={`size-4 ${active ? "text-emerald-600" : "text-muted-foreground"}`} /> Auto-pay (yearly)
      </h2>

      {active ? (
        <p className="text-sm text-emerald-700 mt-2 flex items-center gap-1.5">
          <ShieldCheck className="size-4" /> Auto-debit mandate is active — {inr(amountPaise)}/year will be charged automatically.
        </p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground mt-2">
            Set up a one-time mandate (UPI Autopay, card, or netbanking) and your{" "}
            <strong>{inr(amountPaise)}/year</strong> renews automatically — no manual payments.
            {status === "trial" && " You won't be charged until your trial ends."}
          </p>
          {mandateStatus === "pending" && (
            <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2.5 py-1.5 mt-2">
              A setup was started but not finished. Click below to complete it.
            </p>
          )}
          {err && (
            <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded px-2.5 py-1.5 mt-2 flex items-start gap-1.5">
              <AlertTriangle className="size-3.5 mt-px shrink-0" /> {err}
            </p>
          )}
          {canManage ? (
            <button
              type="button"
              onClick={setup}
              disabled={busy}
              className="mt-3 rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
              {busy ? "Opening…" : "Set up auto-pay"}
            </button>
          ) : (
            <p className="text-xs text-muted-foreground mt-3">Only the firm owner can set up auto-pay.</p>
          )}
        </>
      )}
    </div>
  );
}
