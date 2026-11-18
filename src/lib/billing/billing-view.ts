/**
 * Everything the Billing page shows about an AUM-priced subscription, in one
 * read: the package in force, where the renewal stands (grace / lapsed), the
 * AUM the next renewal will be priced from, the three packages pre-filled for
 * a re-quote, and the firm's tax invoices.
 */

import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { lateProRataCharge, parseCycle, quoteAll, quoteCycle, type CycleKey, type CycleQuote, type LateCharge, type PricingSettings } from "./aum-pricing";
import { firmAumForPricing, type FirmAum } from "./firm-aum";
import { renewalState, type RenewalState } from "./renewal";
import type { NextCycle } from "./payments";

export type BillingInvoiceRow = {
  id: string;
  invoiceNo: string;
  issuedAt: string;
  kind: string;
  totalPaise: number;
  periodStart: string | null;
  periodEnd: string | null;
  emailStatus: string;
};

export type AumBillingView = {
  status: string;
  /** What Billing should offer: pay now (first / renewal) or change from next renewal. */
  mode: "pay_first" | "pay_renewal" | "change";
  cycle: CycleKey;
  users: number;
  declaredAumCrore: number | null;
  inForce: { aumCrore: number | null; tierKey: string | null; tierLabel: string | null; source: string | null; asOf: string | null; cycleTotalPaise: number | null; quote: CycleQuote | null };
  licenseStartAt: string | null;
  licenseEndAt: string | null;
  mandateStatus: string;
  renewal: RenewalState | null;
  /** The renewal review's decision, or what it would decide today. */
  nextRenewal: { decided: boolean; aum: FirmAum; tierLabel: string; quote: CycleQuote; razorpayAction: string | null; renewalOn: string | null } | null;
  late: LateCharge | null;
  /** The three packages for the re-quote, pre-filled. */
  quotes: CycleQuote[];
  quoteAumCrore: number;
  scheduledChange: { cycle: CycleKey; users: number } | null;
  pendingCheckout: boolean;
};

type Sub = {
  status: string;
  pricing_model: string | null;
  billing_cycle: string | null;
  seats_override: number | null;
  declared_aum_crore: string | null;
  aum_crore_in_force: string | null;
  aum_tier_key: string | null;
  aum_source: string | null;
  aum_as_of: string | null;
  cycle_total_paise: number | null;
  cycle_quote: CycleQuote | null;
  license_start_at: string | null;
  license_end_at: string | null;
  mandate_status: string | null;
  next_cycle: NextCycle | null;
  scheduled_change: { cycle?: string; users?: number } | null;
  pending_checkout: unknown;
};

export async function loadInvoices(tx: Tx, tenantId: string): Promise<BillingInvoiceRow[]> {
  const rows = (await tx.execute(sql`
    SELECT id, invoice_no, issued_at, kind, total_paise, period_start::text AS period_start, period_end::text AS period_end, email_status
      FROM billing_invoices WHERE tenant_id = ${tenantId}::uuid ORDER BY issued_at DESC LIMIT 100
  `)).rows as Array<{ id: string; invoice_no: string; issued_at: string; kind: string; total_paise: number; period_start: string | null; period_end: string | null; email_status: string }>;
  return rows.map((r) => ({
    id: r.id,
    invoiceNo: r.invoice_no,
    issuedAt: new Date(r.issued_at).toISOString(),
    kind: r.kind,
    totalPaise: Number(r.total_paise),
    periodStart: r.period_start,
    periodEnd: r.period_end,
    emailStatus: r.email_status,
  }));
}

/** Null for a legacy (package-priced) subscription that is already paid up. */
export async function loadAumBillingView(tx: Tx, tenantId: string, s: PricingSettings, now = new Date()): Promise<AumBillingView | null> {
  const sub = (await tx.execute(sql`
    SELECT status, pricing_model, billing_cycle, seats_override, declared_aum_crore, aum_crore_in_force, aum_tier_key, aum_source,
           aum_as_of::text AS aum_as_of, cycle_total_paise, cycle_quote, license_start_at, license_end_at, mandate_status,
           next_cycle, scheduled_change, pending_checkout
      FROM subscriptions WHERE tenant_id = ${tenantId}::uuid LIMIT 1
  `)).rows[0] as Sub | undefined;
  if (!sub) return null;
  const isAum = sub.pricing_model === "aum";
  const legacyUnpaid = !isAum && ["pending", "trial", "expired", "cancelled", "suspended"].includes(sub.status);
  if (!isAum && !legacyUnpaid) return null;

  const cycle = parseCycle(sub.scheduled_change?.cycle) ?? parseCycle(sub.billing_cycle) ?? "yearly";
  const users = Math.max(s.minUsers, Number(sub.scheduled_change?.users ?? sub.seats_override ?? s.minUsers));
  const declared = sub.declared_aum_crore != null ? Number(sub.declared_aum_crore) : null;
  const end = sub.license_end_at ? new Date(sub.license_end_at) : null;
  const renewal = isAum && end && sub.status !== "pending" ? renewalState(end, now, s.graceDays) : null;
  const unpaid = sub.status === "pending" || legacyUnpaid || (isAum && !end);
  const mode: AumBillingView["mode"] = unpaid ? "pay_first" : renewal && renewal.phase !== "current" ? "pay_renewal" : "change";

  // The AUM the next renewal is priced from.
  let nextRenewal: AumBillingView["nextRenewal"] = null;
  if (isAum && !unpaid) {
    if (sub.next_cycle) {
      const n = sub.next_cycle;
      nextRenewal = { decided: true, aum: { aumCrore: n.aumCrore, source: n.aumSource, asOf: n.aumAsOf }, tierLabel: n.tierLabel, quote: n.quote, razorpayAction: n.razorpayAction, renewalOn: n.renewalOn };
    } else {
      const aum = await firmAumForPricing(tx, tenantId, declared ?? Number(sub.aum_crore_in_force ?? 0));
      const q = quoteCycle({ aumCrore: aum.aumCrore, users, cycle }, s);
      nextRenewal = { decided: false, aum, tierLabel: q.tierLabel, quote: q, razorpayAction: null, renewalOn: end ? end.toISOString().slice(0, 10) : null };
    }
  }

  const quoteAum = mode === "pay_first" ? declared ?? 0 : nextRenewal?.aum.aumCrore ?? Number(sub.aum_crore_in_force ?? declared ?? 0);
  const quotes = quoteAll({ aumCrore: quoteAum, users }, s);
  const late = renewal?.phase === "lapsed" ? lateProRataCharge(quotes.find((q) => q.cycle === cycle)!.monthlyBasePaise, s) : null;

  return {
    status: sub.status,
    mode,
    cycle,
    users,
    declaredAumCrore: declared,
    inForce: {
      aumCrore: sub.aum_crore_in_force != null ? Number(sub.aum_crore_in_force) : null,
      tierKey: sub.aum_tier_key,
      tierLabel: sub.cycle_quote?.tierLabel ?? s.tiers.find((t) => t.key === sub.aum_tier_key)?.label ?? null,
      source: sub.aum_source,
      asOf: sub.aum_as_of,
      cycleTotalPaise: sub.cycle_total_paise,
      quote: sub.cycle_quote,
    },
    licenseStartAt: sub.license_start_at ? new Date(sub.license_start_at).toISOString() : null,
    licenseEndAt: end ? end.toISOString() : null,
    mandateStatus: sub.mandate_status ?? "none",
    renewal,
    nextRenewal,
    late,
    quotes,
    quoteAumCrore: quoteAum,
    scheduledChange: sub.scheduled_change?.cycle ? { cycle: parseCycle(sub.scheduled_change.cycle) ?? cycle, users: Number(sub.scheduled_change.users ?? users) } : null,
    pendingCheckout: !!sub.pending_checkout,
  };
}
