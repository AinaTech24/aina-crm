"use client";

/**
 * Billing for an AUM-priced firm: pay (a first purchase, or a renewal that is
 * due — with the late charge after the grace period) or change the package
 * from the next renewal. The cards are priced by the server
 * (GET /api/billing/quote) and charged at the server's figure — the
 * commitment and yearly for a first purchase, else the three. A firm in its
 * commitment uses "change" to choose how it continues (else monthly).
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { notify } from "@/components/ui/Toast";
import { confirmDialog } from "@/components/ui/ConfirmProvider";
import { PackageCards } from "./PackageCards";
import { openRazorpayCheckout, verifyCheckout, type CheckoutStart } from "./razorpay-checkout";
import { CYCLE_LABEL, cycleLabel, inr, type CycleKey, type CycleQuote, type LateCharge } from "@/lib/billing/aum-pricing";

export type AumPanelProps = {
  mode: "pay_first" | "pay_renewal" | "change";
  cycle: CycleKey;
  users: number;
  aumCrore: number;
  quotes: CycleQuote[];
  late: LateCharge | null;
  canManage: boolean;
  paymentsOn: boolean;
  renewalDueLabel: string | null;
  scheduledChange: { cycle: CycleKey; users: number } | null;
  minUsers: number;
  maxUsers: number;
  /** In a commitment: its length and the date it ends (the change then picks how the firm continues). */
  commitment?: { months: number; endsLabel: string | null } | null;
};

export function AumBillingPanel(p: AumPanelProps) {
  const router = useRouter();
  const [aum, setAum] = useState(String(p.aumCrore || ""));
  const [users, setUsers] = useState(String(p.users));
  const [quotes, setQuotes] = useState<CycleQuote[]>(p.quotes);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<CycleKey | null>(null);
  const first = useRef(true);
  const aumEditable = p.mode !== "pay_renewal";

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(async () => {
      const u = Number(users);
      const a = Number(aum);
      if (!Number.isInteger(u) || u < p.minUsers || u > p.maxUsers || !Number.isFinite(a) || a < 0 || aum === "") return;
      const r = await fetch(`/api/billing/quote?aumCrore=${encodeURIComponent(a)}&users=${u}`);
      const j = await r.json().catch(() => ({}));
      if (r.ok) {
        setQuotes(j.cycles as CycleQuote[]);
        setErr(null);
      } else setErr(j.error ?? "Could not price that.");
    }, 400);
    return () => clearTimeout(t);
  }, [aum, users, p.minUsers, p.maxUsers]);

  async function choose(cycle: CycleKey) {
    setBusy(cycle);
    setErr(null);
    try {
      const body = JSON.stringify({ cycle, users: Number(users), aumCrore: aumEditable && aum !== "" ? Number(aum) : null });
      if (p.mode === "change") {
        const q = quotes.find((x) => x.cycle === cycle)!;
        const ok = await confirmDialog({
          title: `${p.commitment ? "Continue" : "Switch to"} ${CYCLE_LABEL[cycle].toLowerCase()}, ${users} user${users === "1" ? "" : "s"}?`,
          message: `From your next renewal${p.renewalDueLabel ? ` (${p.renewalDueLabel})` : ""}: ${inr(q.totalPaise)} incl. GST. Nothing is charged now. The AUM tier at renewal is set from your CRM data.`,
          confirmLabel: p.commitment ? `Continue ${CYCLE_LABEL[cycle].toLowerCase()}` : "Switch from next renewal",
        });
        if (!ok) return;
        const r = await fetch("/api/billing/change", { method: "POST", headers: { "content-type": "application/json" }, body });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error ?? "Could not change the package.");
        notify.success("Saved — your package changes from the next renewal.");
        router.refresh();
        return;
      }
      const r = await fetch("/api/billing/checkout", { method: "POST", headers: { "content-type": "application/json" }, body });
      const j = (await r.json().catch(() => ({}))) as CheckoutStart & { error?: string };
      if (!r.ok) throw new Error(j.error ?? "Could not start the payment.");
      const res = await openRazorpayCheckout(j);
      if (res.status === "paid") {
        const v = await verifyCheckout(res);
        if (!v.ok) throw new Error(v.error);
        window.location.assign(v.next);
        return;
      }
      if (res.status === "failed") throw new Error(res.error);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  }

  const title =
    p.mode === "pay_first"
      ? "Choose your package and pay"
      : p.mode === "pay_renewal"
        ? "Renew your subscription"
        : p.commitment
          ? `After your ${p.commitment.months}-month commitment`
          : "Change your package";
  const subtitle =
    p.mode === "pay_first"
      ? "Your firm's account is ready — pay to start using the CRM. Auto-pay renews it every cycle."
      : p.mode === "pay_renewal"
        ? p.late
          ? `Paid after the grace period, so the ${p.late.graceDays} grace days are added: ${inr(p.late.taxablePaise)} + GST = ${inr(p.late.totalPaise)}. The new cycle starts today.`
          : `Pay within the grace period at no extra cost — the new cycle runs from your renewal date${p.renewalDueLabel ? ` (${p.renewalDueLabel})` : ""}.`
        : p.commitment
          ? `Choose how you continue from ${p.commitment.endsLabel ?? "the end of your commitment"}: monthly, half-yearly or yearly. If you do not choose, it continues monthly. Nothing is charged now.`
          : "Takes effect from your next renewal. Nothing is charged now.";

  return (
    <Card>
      <CardHeader title={title} subtitle={subtitle} />
      <CardBody className="space-y-4">
        {!p.paymentsOn && p.mode !== "change" && (
          <p className="rounded-lg border border-warning/50 bg-warning/5 p-3 text-sm">Online payment is not switched on yet. Please contact Aina to pay.</p>
        )}
        {p.scheduledChange && p.mode === "change" && (
          <p className="text-sm text-muted-foreground">
            Already scheduled: {cycleLabel(p.scheduledChange.cycle)}, {p.scheduledChange.users} user{p.scheduledChange.users === 1 ? "" : "s"} from the next renewal.
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-2 max-w-xl">
          <Field label="AUM (₹ crore)" hint={aumEditable ? (p.mode === "change" ? "Used only if your CRM has no AUM data at renewal." : "Your firm's assets under management.") : "Set from your CRM data for renewals."}>
            {(id, d) => <input id={id} aria-describedby={d} inputMode="decimal" className="input-base" value={aum} disabled={!aumEditable || !p.canManage} onChange={(e) => setAum(e.target.value)} />}
          </Field>
          <Field label="CRM users" hint="Seats bought are the number of people who can sign in.">
            {(id, d) => <input id={id} aria-describedby={d} inputMode="numeric" className="input-base" value={users} disabled={!p.canManage} onChange={(e) => setUsers(e.target.value.replace(/\D/g, ""))} />}
          </Field>
        </div>
        {err && (
          <p role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
            <AlertTriangle className="size-4 mt-0.5 shrink-0" /> {err}
          </p>
        )}
        <PackageCards
          quotes={quotes}
          tierLabel={quotes[0]?.tierLabel ?? ""}
          onChoose={p.canManage ? choose : undefined}
          busy={busy}
          chooseLabel={p.mode === "change" ? (p.commitment ? "Continue" : "Switch to") : "Pay for"}
          disabled={!p.paymentsOn && p.mode !== "change"}
        />
        {!p.canManage && <p className="text-sm text-muted-foreground">Only the firm owner can pay or change the package.</p>}
      </CardBody>
    </Card>
  );
}
