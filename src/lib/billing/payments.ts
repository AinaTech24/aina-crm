/**
 * Recording a payment against an AUM-priced subscription — idempotently.
 *
 *  - `recordCheckoutPayment`: the authorisation payment of a checkout the
 *    server started (lib/billing/checkout.ts). Reached from the browser
 *    (POST /api/billing/verify, after the signature check) AND from the webhook;
 *    whichever comes first activates, the other finds the invoice for that
 *    payment id and does nothing.
 *  - `recordRenewalCharge`: an auto-debit (`subscription.charged`) on the
 *    subscription in force — the next cycle, priced as the renewal review
 *    decided (lib/billing/renewal-review.ts) from that cycle's start only.
 *
 * Both run inside withSystem and lock the subscription row first, so two
 * deliveries of the same payment serialise. Every outcome is a
 * subscription_events row, an audit row and exactly one tax invoice.
 */

import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { recordAudit } from "@/lib/audit";
import { CYCLE_LABEL, parseCycle, type CycleKey, type CycleQuote, type LateCharge, type PricingSettings } from "./aum-pricing";
import { issueInvoice } from "./invoice";
import { invoiceFigures } from "./invoice-core";
import { markQuotePaid } from "./quotes";
import { renewalPeriod } from "./renewal";

export type PendingCheckout = {
  id: string;
  kind: "first" | "renewal" | "late_renewal";
  razorpaySubscriptionId: string;
  razorpayPlanId: string;
  previousRazorpaySubscriptionId: string | null;
  cycle: CycleKey;
  users: number;
  aumCrore: number;
  aumSource: "declared" | "crm_snapshot" | "crm_live";
  aumAsOf: string | null;
  tierKey: string;
  tierLabel: string;
  quote: CycleQuote;
  late: LateCharge | null;
  /** ISO instants. */
  periodStart: string;
  periodEnd: string;
  dueAt: string | null;
  chargePaise: number;
  createdAt: string;
  createdBy: string | null;
};

export type NextCycle = {
  renewalOn: string;
  cycle: CycleKey;
  users: number;
  aumCrore: number;
  aumSource: "declared" | "crm_snapshot" | "crm_live";
  aumAsOf: string | null;
  tierKey: string;
  tierLabel: string;
  quote: CycleQuote;
  razorpayPlanId: string | null;
  razorpayAction: "none" | "updated" | "reauth_required" | "failed";
  decidedAt: string;
};

type SubRow = {
  id: string;
  tenant_id: string;
  status: string;
  billing_cycle: string | null;
  seats_override: number | null;
  license_start_at: string | null;
  license_end_at: string | null;
  razorpay_subscription_id: string | null;
  pending_checkout: PendingCheckout | null;
  next_cycle: NextCycle | null;
  cycle_quote: CycleQuote | null;
  cycle_total_paise: number | null;
  aum_tier_key: string | null;
  quote_id: string | null;
  pricing_model: string | null;
};

export type PaymentOutcome =
  | { status: "recorded"; tenantId: string; invoiceId: string; invoiceNo: string; previousRazorpaySubscriptionId: string | null; kind: string }
  | { status: "duplicate"; tenantId: string; invoiceId: string }
  | { status: "unknown" };

async function invoiceForPayment(tx: Tx, paymentId: string) {
  return (await tx.execute(sql`SELECT id, tenant_id FROM billing_invoices WHERE razorpay_payment_id = ${paymentId} LIMIT 1`)).rows[0] as
    | { id: string; tenant_id: string }
    | undefined;
}

async function lockSubByRazorpayId(tx: Tx, razorpaySubscriptionId: string): Promise<SubRow | null> {
  const r = await tx.execute(sql`
    SELECT id, tenant_id, status, billing_cycle, seats_override, license_start_at, license_end_at,
           razorpay_subscription_id, pending_checkout, next_cycle, cycle_quote, cycle_total_paise,
           aum_tier_key, quote_id, pricing_model
      FROM subscriptions
     WHERE razorpay_subscription_id = ${razorpaySubscriptionId}
        OR pending_checkout->>'razorpaySubscriptionId' = ${razorpaySubscriptionId}
     ORDER BY (pending_checkout->>'razorpaySubscriptionId' = ${razorpaySubscriptionId}) DESC NULLS LAST
     LIMIT 1
     FOR UPDATE
  `);
  return (r.rows[0] as SubRow | undefined) ?? null;
}

export async function recordCheckoutPayment(
  tx: Tx,
  a: { razorpaySubscriptionId: string; paymentId: string; paidAt?: Date; source: "checkout" | "webhook"; settings: PricingSettings; actorUserId?: string | null }
): Promise<PaymentOutcome> {
  const sub = await lockSubByRazorpayId(tx, a.razorpaySubscriptionId);
  if (!sub) return { status: "unknown" };
  const dup = await invoiceForPayment(tx, a.paymentId);
  if (dup) return { status: "duplicate", tenantId: dup.tenant_id, invoiceId: dup.id };
  const pc = sub.pending_checkout;
  if (!pc || pc.razorpaySubscriptionId !== a.razorpaySubscriptionId) return { status: "unknown" };

  const paidAt = a.paidAt ?? new Date();
  const start = new Date(pc.periodStart);
  const end = new Date(pc.periodEnd);
  const q = pc.quote;

  await tx.execute(sql`
    UPDATE subscriptions SET
      status = 'active',
      pricing_model = 'aum',
      billing_cycle = ${pc.cycle},
      seats_override = ${pc.users},
      aum_crore_in_force = ${pc.aumCrore},
      aum_source = ${pc.aumSource},
      aum_as_of = ${pc.aumAsOf}::date,
      aum_tier_key = ${pc.tierKey},
      monthly_base_paise = ${q.monthlyBasePaise},
      cycle_total_paise = ${q.totalPaise},
      cycle_quote = ${JSON.stringify(q)}::jsonb,
      license_start_at = ${start},
      license_end_at = ${end},
      next_renewal_at = ${end},
      razorpay_subscription_id = ${pc.razorpaySubscriptionId},
      razorpay_plan_id = ${pc.razorpayPlanId},
      mandate_status = 'active',
      failed_payment_count = 0,
      last_payment_at = ${paidAt},
      last_payment_paise = ${pc.chargePaise},
      suspended_at = NULL, suspended_reason = NULL, cancelled_at = NULL, cancelled_reason = NULL,
      pending_checkout = NULL, next_cycle = NULL, scheduled_change = NULL,
      updated_at = now()
    WHERE id = ${sub.id}::uuid
  `);
  await tx.execute(sql`UPDATE tenants SET status = 'active', updated_at = now() WHERE id = ${sub.tenant_id}::uuid`);

  const figures = invoiceFigures({ quote: q, tierLabel: pc.tierLabel, periodStart: start, periodEnd: end, late: pc.late, lateFrom: pc.dueAt ? new Date(pc.dueAt) : null });
  const inv = await issueInvoice(tx, {
    tenantId: sub.tenant_id,
    subscriptionId: sub.id,
    paymentId: a.paymentId,
    kind: pc.kind,
    figures,
    periodStart: start,
    periodEnd: end,
    sac: a.settings.sacCode,
    paidAt,
  });

  const eventType = pc.kind === "first" ? "activated" : "renewed";
  await tx.execute(sql`
    INSERT INTO subscription_events (id, subscription_id, tenant_id, event_type, actor, from_status, to_status, amount_paise, notes, meta, at)
    VALUES (gen_random_uuid(), ${sub.id}::uuid, ${sub.tenant_id}::uuid, ${eventType}, ${a.source === "webhook" ? "razorpay_webhook" : "system:checkout"},
            ${sub.status}, 'active', ${pc.chargePaise},
            ${`${CYCLE_LABEL[pc.cycle]} · ${pc.users} user(s) · ${pc.tierLabel}${pc.late ? " · late renewal charge" : ""} · invoice ${inv.invoiceNo}`},
            ${JSON.stringify({ paymentId: a.paymentId, razorpaySubscriptionId: pc.razorpaySubscriptionId, invoiceId: inv.id, checkoutId: pc.id, kind: pc.kind, latePaise: pc.late?.totalPaise ?? 0 })}::jsonb, now())
  `);
  if (pc.kind === "first" && sub.quote_id) await markQuotePaid(tx, sub.quote_id);
  await recordAudit(tx, {
    tenantId: sub.tenant_id,
    actorUserId: a.actorUserId ?? null,
    actorType: a.actorUserId ? "user" : "system",
    action: pc.late ? "billing.renewal_paid_late" : pc.kind === "first" ? "billing.subscription_activated" : "billing.renewal_paid",
    entityType: "subscription",
    entityId: sub.id,
    after: {
      cycle: pc.cycle,
      users: pc.users,
      aumCrore: pc.aumCrore,
      tier: pc.tierKey,
      chargePaise: pc.chargePaise,
      latePaise: pc.late?.totalPaise ?? 0,
      periodStart: pc.periodStart,
      periodEnd: pc.periodEnd,
      invoiceNo: inv.invoiceNo,
      paymentId: a.paymentId,
    },
  });
  return { status: "recorded", tenantId: sub.tenant_id, invoiceId: inv.id, invoiceNo: inv.invoiceNo, previousRazorpaySubscriptionId: pc.previousRazorpaySubscriptionId, kind: pc.kind };
}

/** The renewal auto-debit on the subscription in force. */
export async function recordRenewalCharge(
  tx: Tx,
  a: { razorpaySubscriptionId: string; paymentId: string; amountPaise: number; paidAt?: Date; settings: PricingSettings }
): Promise<PaymentOutcome> {
  const r = await tx.execute(sql`
    SELECT id, tenant_id, status, billing_cycle, seats_override, license_start_at, license_end_at,
           razorpay_subscription_id, pending_checkout, next_cycle, cycle_quote, cycle_total_paise,
           aum_tier_key, quote_id, pricing_model
      FROM subscriptions WHERE razorpay_subscription_id = ${a.razorpaySubscriptionId} LIMIT 1 FOR UPDATE
  `);
  const sub = r.rows[0] as SubRow | undefined;
  if (!sub || sub.pricing_model !== "aum") return { status: "unknown" };
  const dup = await invoiceForPayment(tx, a.paymentId);
  if (dup) return { status: "duplicate", tenantId: dup.tenant_id, invoiceId: dup.id };

  const paidAt = a.paidAt ?? new Date();
  const nc = sub.next_cycle;
  const current = sub.cycle_quote;
  // The cycle being paid is priced as the renewal review decided — from this
  // cycle's start, never mid-cycle. If the debit does not match that price
  // (the plan switch did not reach Razorpay), the price in force is used.
  let quote: CycleQuote | null = null;
  let applied: NextCycle | null = null;
  if (nc && nc.quote.totalPaise === a.amountPaise) {
    quote = nc.quote;
    applied = nc;
  } else if (current) {
    quote = current;
  } else if (nc) {
    quote = nc.quote;
    applied = nc;
  }
  if (!quote) return { status: "unknown" };
  const mismatch = quote.totalPaise !== a.amountPaise;

  const cycle = parseCycle(applied?.cycle ?? sub.billing_cycle) ?? "monthly";
  const months = cycle === "yearly" ? 12 : cycle === "half_yearly" ? 6 : 1;
  const due = sub.license_end_at ? new Date(sub.license_end_at) : paidAt;
  const period = renewalPeriod(due, paidAt, months, a.settings.graceDays);

  await tx.execute(sql`
    UPDATE subscriptions SET
      status = 'active',
      license_end_at = ${period.end},
      next_renewal_at = ${period.end},
      mandate_status = 'active',
      failed_payment_count = 0,
      last_payment_at = ${paidAt},
      last_payment_paise = ${a.amountPaise},
      ${applied
        ? sql`billing_cycle = ${applied.cycle}, seats_override = ${applied.users}, aum_crore_in_force = ${applied.aumCrore},
              aum_source = ${applied.aumSource}, aum_as_of = ${applied.aumAsOf}::date, aum_tier_key = ${applied.tierKey},
              monthly_base_paise = ${applied.quote.monthlyBasePaise}, cycle_total_paise = ${applied.quote.totalPaise},
              cycle_quote = ${JSON.stringify(applied.quote)}::jsonb, razorpay_plan_id = COALESCE(${applied.razorpayPlanId}, razorpay_plan_id),
              next_cycle = NULL, scheduled_change = NULL,`
        : sql``}
      updated_at = now()
    WHERE id = ${sub.id}::uuid
  `);

  const tierLabel = applied?.tierLabel ?? quote.tierLabel;
  const figures = invoiceFigures({ quote, tierLabel, periodStart: period.start, periodEnd: period.end });
  // The invoice states what was actually debited.
  if (mismatch) {
    figures.roundOffPaise += a.amountPaise - figures.totalPaise;
    figures.totalPaise = a.amountPaise;
  }
  const inv = await issueInvoice(tx, {
    tenantId: sub.tenant_id,
    subscriptionId: sub.id,
    paymentId: a.paymentId,
    kind: period.late ? "late_renewal" : "renewal",
    figures,
    periodStart: period.start,
    periodEnd: period.end,
    sac: a.settings.sacCode,
    paidAt,
  });
  await tx.execute(sql`
    INSERT INTO subscription_events (id, subscription_id, tenant_id, event_type, actor, from_status, to_status, amount_paise, notes, meta, at)
    VALUES (gen_random_uuid(), ${sub.id}::uuid, ${sub.tenant_id}::uuid, 'renewed', 'razorpay_webhook', ${sub.status}, 'active', ${a.amountPaise},
            ${`Auto-debit renewal · ${CYCLE_LABEL[cycle]} · invoice ${inv.invoiceNo}${applied && applied.tierKey !== sub.aum_tier_key ? ` · new tier ${applied.tierLabel}` : ""}`},
            ${JSON.stringify({ paymentId: a.paymentId, invoiceId: inv.id, appliedNextCycle: !!applied, amountMismatch: mismatch })}::jsonb, now())
  `);
  await recordAudit(tx, {
    tenantId: sub.tenant_id,
    actorType: "system",
    action: "billing.renewal_charged",
    entityType: "subscription",
    entityId: sub.id,
    after: { paymentId: a.paymentId, amountPaise: a.amountPaise, periodStart: period.start.toISOString(), periodEnd: period.end.toISOString(), invoiceNo: inv.invoiceNo, tier: applied?.tierKey ?? sub.aum_tier_key, amountMismatch: mismatch },
  });
  return { status: "recorded", tenantId: sub.tenant_id, invoiceId: inv.id, invoiceNo: inv.invoiceNo, previousRazorpaySubscriptionId: null, kind: period.late ? "late_renewal" : "renewal" };
}

