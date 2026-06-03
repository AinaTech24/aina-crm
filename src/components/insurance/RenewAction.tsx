"use client";

/**
 * RenewAction — "mark renewed" for an insurance policy. Advances the next
 * premium due date by the policy's frequency and stamps last-premium = today
 * via the existing insurance PATCH. The insurance agent's one-click renewal.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, CheckCircle2 } from "lucide-react";

const MONTHS: Record<string, number> = { annual: 12, semi_annual: 6, quarterly: 3, monthly: 1, single: 0 };

export function RenewAction({ policyId, frequency, nextDue }: { policyId: string; frequency: string; nextDue: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function renew() {
    const add = MONTHS[frequency] ?? 12;
    if (add === 0) return;
    const base = nextDue ? new Date(nextDue) : new Date();
    // Advance from the later of the due date or today, so a long-overdue policy lands in the future.
    const from = base.getTime() < Date.now() ? new Date() : base;
    const next = new Date(from);
    next.setMonth(next.getMonth() + add);
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    setBusy(true);
    try {
      const res = await fetch(`/api/insurance/${policyId}`, {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ nextPremiumDueDate: iso(next), lastPremiumDate: iso(new Date()), status: "active" }),
      });
      if (res.ok) { setDone(true); router.refresh(); }
    } finally { setBusy(false); }
  }

  if (frequency === "single") return <span className="text-[10px] text-muted-foreground">single-pay</span>;
  return (
    <button onClick={renew} disabled={busy || done} className="btn-secondary text-xs inline-flex items-center gap-1" title="Mark this premium as paid + advance the due date">
      {busy ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />} {done ? "Renewed ✓" : "Mark renewed"}
    </button>
  );
}
