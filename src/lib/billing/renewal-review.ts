/**
 * Renewal priced from the AUM the CRM holds — the owner's rule B (2026-11-18).
 *
 * The declared AUM sets only the FIRST cycle. `renewalReviewDays` (7) before
 * each renewal, the worker re-decides the tier from the firm's actual AUM
 * (lib/billing/firm-aum.ts: the nightly snapshot, else the live figure, else —
 * no data — the declared AUM, said so). The decision is recorded once per firm
 * per renewal date (billing_renewal_reviews, UNIQUE), audited, and kept on the
 * subscription as `next_cycle`; the price IN FORCE is never touched — it
 * changes when the next cycle's payment arrives (lib/billing/payments.ts).
 *
 * When the amount changes (tier up or down, or the owner's scheduled change of
 * users / cycle), the Razorpay subscription is moved to a new plan FROM THE
 * NEXT CYCLE (schedule_change_at = cycle_end). Razorpay refuses that for some
 * mandates (UPI / e-mandate); the firm is then asked to re-authorise from
 * Billing. The owner is told (in-app + email) when the tier changes.
 *
 * Seats are not changed by this; grace and late rules use the tier in force
 * for the cycle being paid.
 */

import { sql } from "drizzle-orm";
import { withSystem, withTenant } from "@/db/client";
import { recordAudit } from "@/lib/audit";
import { createNotification } from "@/lib/notifications/create";
import { sendSystemEmail, actionEmailHtml } from "@/lib/comms/system-email";
import { LEGAL } from "@/lib/legal/company";
import { CYCLE_LABEL, inr, parseCycle, quoteCycle, razorpayPeriod, type CycleKey, type PricingSettings } from "./aum-pricing";
import { firmAumForPricing, type FirmAum } from "./firm-aum";
import { createRazorpayPlan, updateRazorpaySubscriptionPlan } from "./razorpay";
import { istDate, istDayNumber } from "./renewal";
import type { NextCycle } from "./payments";
import { loadPricingSettings } from "./pricing-settings";

export type ReviewOutcome =
  | { status: "skipped"; reason: "not_aum" | "not_due" | "already_reviewed" | "no_renewal" | "inactive" }
  | { status: "reviewed"; changed: boolean; tierChanged: boolean; next: NextCycle; aum: FirmAum; fromTier: string | null };

/** Human wording for where the AUM came from. */
export function aumSourceText(aum: Pick<FirmAum, "source" | "asOf">): string {
  if (aum.source === "declared") return "the AUM you declared — your CRM has no AUM data yet";
  const d = aum.asOf ? new Date(`${aum.asOf}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "today";
  return `from your CRM data on ${d}`;
}

type Sub = {
  id: string;
  status: string;
  pricing_model: string | null;
  billing_cycle: string | null;
  seats_override: number | null;
  license_end_at: string | null;
  declared_aum_crore: string | null;
  aum_crore_in_force: string | null;
  aum_tier_key: string | null;
  cycle_total_paise: number | null;
  razorpay_subscription_id: string | null;
  mandate_status: string | null;
  scheduled_change: { cycle?: string; users?: number } | null;
};

export async function reviewRenewal(
  tenantId: string,
  opts: { now?: Date; force?: boolean; settings?: PricingSettings; actorUserId?: string | null } = {}
): Promise<ReviewOutcome> {
  const now = opts.now ?? new Date();
  const s = opts.settings ?? (await loadPricingSettings());

  const result = await withTenant(tenantId, async (tx): Promise<ReviewOutcome & { notify?: { owners: Array<{ id: string; email: string; name: string | null }>; firm: string } }> => {
    const sub = (await tx.execute(sql`
      SELECT id, status, pricing_model, billing_cycle, seats_override, license_end_at, declared_aum_crore, aum_crore_in_force,
             aum_tier_key, cycle_total_paise, razorpay_subscription_id, mandate_status, scheduled_change
        FROM subscriptions WHERE tenant_id = ${tenantId}::uuid FOR UPDATE
    `)).rows[0] as Sub | undefined;
    if (!sub || sub.pricing_model !== "aum") return { status: "skipped", reason: "not_aum" };
    if (!["active", "past_due"].includes(sub.status)) return { status: "skipped", reason: "inactive" };
    if (!sub.license_end_at) return { status: "skipped", reason: "no_renewal" };
    const due = new Date(sub.license_end_at);
    const daysAhead = istDayNumber(due) - istDayNumber(now);
    if (!opts.force && daysAhead > s.renewalReviewDays) return { status: "skipped", reason: "not_due" };
    const renewalOn = istDate(due);

    const declared = Number(sub.declared_aum_crore ?? sub.aum_crore_in_force ?? 0);
    const aum = await firmAumForPricing(tx, tenantId, declared);
    const cycle: CycleKey = parseCycle(sub.scheduled_change?.cycle) ?? parseCycle(sub.billing_cycle) ?? "monthly";
    const users = Number(sub.scheduled_change?.users ?? sub.seats_override ?? s.minUsers);
    const quote = quoteCycle({ aumCrore: aum.aumCrore, users, cycle }, s);
    const tierChanged = quote.tierKey !== sub.aum_tier_key;
    const changed = tierChanged || quote.totalPaise !== sub.cycle_total_paise || cycle !== sub.billing_cycle;

    // Claim this renewal date — once per firm per renewal (a forced re-review,
    // after the owner changes the package, replaces the decision).
    const claimed = (await tx.execute(sql`
      INSERT INTO billing_renewal_reviews (tenant_id, subscription_id, renewal_on, aum_crore_used, aum_source, aum_as_of,
                                           from_tier, to_tier, changed, cycle, users, next_total_paise)
      VALUES (${tenantId}::uuid, ${sub.id}::uuid, ${renewalOn}::date, ${aum.aumCrore}, ${aum.source}, ${aum.asOf}::date,
              ${sub.aum_tier_key}, ${quote.tierKey}, ${changed}, ${cycle}, ${users}, ${quote.totalPaise})
      ON CONFLICT (tenant_id, renewal_on) DO ${opts.force
        ? sql`UPDATE SET aum_crore_used = EXCLUDED.aum_crore_used, aum_source = EXCLUDED.aum_source, aum_as_of = EXCLUDED.aum_as_of,
                         to_tier = EXCLUDED.to_tier, changed = EXCLUDED.changed, cycle = EXCLUDED.cycle, users = EXCLUDED.users,
                         next_total_paise = EXCLUDED.next_total_paise, notified_at = NULL`
        : sql`NOTHING`}
      RETURNING id
    `)).rows[0] as { id: string } | undefined;
    if (!claimed) return { status: "skipped", reason: "already_reviewed" };

    // Move Razorpay to the new amount from the NEXT cycle only.
    let razorpayAction: NextCycle["razorpayAction"] = "none";
    let planId: string | null = null;
    if (changed && sub.razorpay_subscription_id) {
      try {
        const { period, interval } = razorpayPeriod(cycle);
        planId = (await createRazorpayPlan({
          amountPaise: quote.totalPaise,
          period,
          interval,
          name: `Aina CRM — ${CYCLE_LABEL[cycle]} · ${users} user${users === 1 ? "" : "s"} · ${quote.tierLabel}`,
          notes: { tenant_id: tenantId, renewal_on: renewalOn },
        })).id;
        await updateRazorpaySubscriptionPlan(sub.razorpay_subscription_id, planId);
        razorpayAction = "updated";
      } catch (err) {
        console.error("[renewal-review] Razorpay plan switch refused — re-authorisation needed:", (err as Error)?.message);
        razorpayAction = "reauth_required";
      }
    }

    const next: NextCycle = {
      renewalOn,
      cycle,
      users,
      aumCrore: aum.aumCrore,
      aumSource: aum.source,
      aumAsOf: aum.asOf,
      tierKey: quote.tierKey,
      tierLabel: quote.tierLabel,
      quote,
      razorpayPlanId: planId,
      razorpayAction,
      decidedAt: now.toISOString(),
    };
    await tx.execute(sql`UPDATE subscriptions SET next_cycle = ${JSON.stringify(next)}::jsonb, updated_at = now() WHERE id = ${sub.id}::uuid`);
    await tx.execute(sql`UPDATE billing_renewal_reviews SET razorpay_action = ${razorpayAction}, razorpay_plan_id = ${planId} WHERE id = ${claimed.id}::uuid`);

    await recordAudit(tx, {
      tenantId,
      actorUserId: opts.actorUserId ?? null,
      actorType: opts.actorUserId ? "user" : "system",
      action: "billing.renewal_repriced",
      entityType: "subscription",
      entityId: sub.id,
      before: { tier: sub.aum_tier_key, cycleTotalPaise: sub.cycle_total_paise, cycle: sub.billing_cycle, users: sub.seats_override },
      after: { renewalOn, tier: quote.tierKey, aumCrore: aum.aumCrore, aumSource: aum.source, aumAsOf: aum.asOf, cycle, users, nextTotalPaise: quote.totalPaise, razorpayAction },
    });
    if (tierChanged) {
      const up = (s.tiers.findIndex((t) => t.key === quote.tierKey)) > (s.tiers.findIndex((t) => t.key === sub.aum_tier_key));
      await tx.execute(sql`
        INSERT INTO subscription_events (id, subscription_id, tenant_id, event_type, actor, from_package, to_package, amount_paise, notes, meta, at)
        VALUES (gen_random_uuid(), ${sub.id}::uuid, ${tenantId}::uuid, ${up ? "upgraded" : "downgraded"}, 'system:renewal_review',
                ${sub.aum_tier_key}, ${quote.tierKey}, ${quote.totalPaise},
                ${`From the renewal on ${renewalOn}: ₹${aum.aumCrore.toLocaleString("en-IN")} Cr (${aumSourceText(aum)}) → ${quote.tierLabel}, ${inr(quote.totalPaise)} incl. GST`},
                ${JSON.stringify({ renewalOn, aumSource: aum.source, aumAsOf: aum.asOf, razorpayAction })}::jsonb, now())
      `);
    }

    const owners = (await tx.execute(sql`
      SELECT id, lower(email) AS email, name FROM users
       WHERE tenant_id = ${tenantId}::uuid AND 'owner' = ANY(roles) AND status = 'active'
    `)).rows as Array<{ id: string; email: string; name: string | null }>;
    const firm = ((await tx.execute(sql`SELECT display_name FROM tenants WHERE id = ${tenantId}::uuid`)).rows[0] as { display_name: string } | undefined)?.display_name ?? "your firm";
    if (tierChanged || razorpayAction === "reauth_required") {
      for (const o of owners) {
        await createNotification(tx, {
          tenantId,
          userId: o.id,
          kind: "billing.renewal_repriced",
          title: tierChanged ? `Your renewal moves to ${quote.tierLabel}` : "Re-authorise auto-pay for your renewal",
          body: `Renewal on ${renewalOn}: AUM ₹${aum.aumCrore.toLocaleString("en-IN")} Cr (${aumSourceText(aum)}) → ${quote.tierLabel} → ${inr(quote.totalPaise)} incl. GST, ${CYCLE_LABEL[cycle].toLowerCase()}.`,
          linkUrl: "/dashboard/billing",
          severity: razorpayAction === "reauth_required" ? "warning" : "info",
        });
      }
    }
    return { status: "reviewed", changed, tierChanged, next, aum, fromTier: sub.aum_tier_key, notify: tierChanged || razorpayAction === "reauth_required" ? { owners, firm } : undefined };
  });

  // Email after commit; record that it went (best-effort).
  if (result.status === "reviewed" && result.notify?.owners.length) {
    const n = result.next;
    const base = process.env.APP_URL ?? process.env.NEXTAUTH_URL ?? LEGAL.url;
    const line = `Your renewal on ${n.renewalOn}: AUM ₹${n.aumCrore.toLocaleString("en-IN")} Cr (${aumSourceText(result.aum)}) → ${n.tierLabel} → ${inr(n.quote.totalPaise)} incl. GST, ${CYCLE_LABEL[n.cycle].toLowerCase()}.`;
    const reauth = n.razorpayAction === "reauth_required" ? " Please re-authorise auto-pay for the new amount from Billing." : "";
    let sent = false;
    for (const o of result.notify.owners) {
      const r = await sendSystemEmail({
        tenantId,
        to: o.email,
        subject: `Your Aina CRM renewal — ${n.tierLabel}, ${inr(n.quote.totalPaise)} incl. GST`,
        text: `Hello${o.name ? ` ${o.name}` : ""},\n\n${line}${reauth}\nThe change applies from your next cycle only.\n\n${base}/dashboard/billing`,
        html: actionEmailHtml({ heading: "Your renewal price", intro: `${line}${reauth} The change applies from your next cycle only.`, buttonLabel: "Open Billing", buttonUrl: `${base}/dashboard/billing` }),
        idempotencyKey: `renewal-review:${tenantId}:${n.renewalOn}:${n.tierKey}:${o.id}`,
      });
      sent = sent || r.sent;
    }
    if (sent) {
      await withTenant(tenantId, (tx) =>
        tx.execute(sql`UPDATE billing_renewal_reviews SET notified_at = now() WHERE tenant_id = ${tenantId}::uuid AND renewal_on = ${n.renewalOn}::date`)
      );
    }
  }
  if (result.status === "reviewed") {
    const { notify: _n, ...rest } = result;
    void _n;
    return rest;
  }
  return result;
}

/** The worker's daily job: every AUM-priced firm whose renewal falls within the review window. */
export async function runRenewalReviews(now = new Date()): Promise<{ firms: number; reviewed: number; changed: number; failed: number }> {
  const s = await loadPricingSettings();
  const ids = await withSystem(async (tx) =>
    ((await tx.execute(sql`
      SELECT s.tenant_id FROM subscriptions s JOIN tenants t ON t.id = s.tenant_id
       WHERE s.pricing_model = 'aum' AND s.status IN ('active', 'past_due') AND s.license_end_at IS NOT NULL
         AND t.deleted_at IS NULL
         AND s.license_end_at < ${now}::timestamptz + make_interval(days => ${s.renewalReviewDays + 1}::int)
    `)).rows as Array<{ tenant_id: string }>).map((r) => r.tenant_id)
  );
  let reviewed = 0;
  let changed = 0;
  let failed = 0;
  for (const id of ids) {
    try {
      const r = await reviewRenewal(id, { now, settings: s });
      if (r.status === "reviewed") {
        reviewed++;
        if (r.changed) changed++;
      }
    } catch (err) {
      failed++;
      console.error(`[renewal-review] tenant ${id} failed:`, (err as Error)?.message);
    }
  }
  return { firms: ids.length, reviewed, changed, failed };
}
