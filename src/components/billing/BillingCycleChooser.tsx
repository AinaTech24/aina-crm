"use client";

/**
 * BillingCycleChooser — lets an MFD owner pick Monthly or Yearly billing.
 * Shows the full per-cycle price (base + seats × per-user) and the yearly
 * saving, and saves the choice to the subscription. When Razorpay auto-debit
 * is live, the selected cycle drives the recurring charge.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, CalendarDays, CalendarRange } from "lucide-react";

const inr = (paise: number) => `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;

export function BillingCycleChooser({
  current,
  seats,
  monthlyPaise,
  yearlyPaise,
  perUserMonthlyPaise,
  perUserYearlyPaise,
  canManage,
}: {
  current: "monthly" | "yearly" | "custom" | null;
  seats: number;
  monthlyPaise: number;
  yearlyPaise: number;
  perUserMonthlyPaise: number;
  perUserYearlyPaise: number;
  canManage: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"monthly" | "yearly" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [selected, setSelected] = useState(current);

  const monthlyTotal = monthlyPaise + seats * perUserMonthlyPaise;
  const yearlyTotal = yearlyPaise + seats * perUserYearlyPaise;
  const yearlySavings = monthlyTotal * 12 - yearlyTotal;
  const savingsPct = monthlyTotal * 12 > 0 ? Math.round((yearlySavings / (monthlyTotal * 12)) * 100) : 0;

  async function choose(cycle: "monthly" | "yearly") {
    if (!canManage || cycle === selected) return;
    setBusy(cycle);
    setErr(null);
    try {
      const r = await fetch("/api/billing/cycle", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cycle }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setSelected(cycle);
      router.refresh();
    } catch (e: any) {
      setErr(e?.message ?? "Could not update billing cycle");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="border rounded-lg bg-card p-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="font-semibold">Choose how you pay</h2>
        {seats > 0 && (perUserMonthlyPaise > 0 || perUserYearlyPaise > 0) && (
          <span className="text-xs text-muted-foreground">Priced for {seats} user{seats === 1 ? "" : "s"}</span>
        )}
      </div>

      <div className="grid sm:grid-cols-2 gap-3 mt-4">
        <CycleCard
          icon={<CalendarDays className="size-4" />}
          title="Monthly"
          price={inr(monthlyTotal)}
          unit="/ month"
          sub={perUserMonthlyPaise > 0 ? `${inr(monthlyPaise)} base + ${inr(perUserMonthlyPaise)}/user` : "billed every month"}
          active={selected === "monthly"}
          loading={busy === "monthly"}
          disabled={!canManage}
          onClick={() => choose("monthly")}
        />
        <CycleCard
          icon={<CalendarRange className="size-4" />}
          title="Yearly"
          price={inr(yearlyTotal)}
          unit="/ year"
          sub={perUserYearlyPaise > 0 ? `${inr(yearlyPaise)} base + ${inr(perUserYearlyPaise)}/user` : "billed once a year"}
          badge={yearlySavings > 0 ? `Save ${inr(yearlySavings)}/yr · ${savingsPct}%` : undefined}
          active={selected === "yearly"}
          loading={busy === "yearly"}
          disabled={!canManage}
          onClick={() => choose("yearly")}
        />
      </div>

      {err && <p className="text-xs text-rose-600 mt-3">{err}</p>}
      {!canManage && <p className="text-2xs text-muted-foreground mt-3">Only the firm owner can change the billing cycle.</p>}
      <p className="text-2xs text-muted-foreground mt-2">
        Auto-debit (Razorpay) uses your chosen cycle — switch any time before the next renewal.
      </p>
    </div>
  );
}

function CycleCard({
  icon,
  title,
  price,
  unit,
  sub,
  badge,
  active,
  loading,
  disabled,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  price: string;
  unit: string;
  sub: string;
  badge?: string;
  active: boolean;
  loading: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || active}
      className={`relative text-left rounded-xl border p-4 transition-colors ${
        active
          ? "border-brand-cyan ring-2 ring-brand-cyan/30 bg-brand-cyan-light/30"
          : disabled
            ? "border-border opacity-80 cursor-default"
            : "border-border hover:border-brand-cyan/50 hover:bg-secondary/40"
      }`}
    >
      {badge && (
        <span className="absolute -top-2 right-3 text-2xs font-semibold bg-emerald-600 text-white px-2 py-0.5 rounded-full">
          {badge}
        </span>
      )}
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        {icon} {title}
        {active && <span className="ml-auto inline-flex items-center gap-1 text-brand-cyan-deep"><Check className="size-3.5" /> Current</span>}
        {loading && <Loader2 className="ml-auto size-3.5 animate-spin" />}
      </div>
      <div className="mt-2 text-2xl font-bold tabular-nums">
        {price} <span className="text-sm font-normal text-muted-foreground">{unit}</span>
      </div>
      <div className="text-2xs text-muted-foreground mt-1">{sub}</div>
    </button>
  );
}
