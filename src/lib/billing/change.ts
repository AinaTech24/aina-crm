/**
 * An active, paid-up firm changes its package (users, cycle, declared AUM)
 * FROM ITS NEXT RENEWAL — never mid-cycle. The choice is kept as
 * `scheduled_change`; the renewal review (lib/billing/renewal-review.ts)
 * prices the next cycle from it and the CRM's AUM, and moves Razorpay to the
 * new amount from the next cycle. Inside the review window the review runs
 * again at once so Billing shows the new figure straight away.
 *
 * Only the three standard cycles: the commitment is a first purchase, never a
 * change. A firm in its commitment uses this to choose how it continues.
 */

import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { recordAudit } from "@/lib/audit";
import { istDayNumber } from "./renewal";
import { reviewRenewal, type ReviewOutcome } from "./renewal-review";
import { CheckoutError } from "./checkout";
import { STANDARD_CYCLES, type CycleKey, type PricingSettings } from "./aum-pricing";

export async function scheduleChange(
  tenantId: string,
  choice: { cycle: CycleKey; users: number; aumCrore?: number | null },
  s: PricingSettings,
  actorUserId: string
): Promise<{ effectiveFrom: string; review: ReviewOutcome | null }> {
  if (!(STANDARD_CYCLES as readonly string[]).includes(choice.cycle)) {
    throw new CheckoutError(400, "Choose monthly, half-yearly or yearly.", "cycle_not_offered");
  }
  const due = await withTenant(tenantId, async (tx) => {
    const sub = (await tx.execute(sql`
      SELECT id, status, pricing_model, license_end_at, billing_cycle, seats_override, declared_aum_crore, scheduled_change
        FROM subscriptions WHERE tenant_id = ${tenantId}::uuid FOR UPDATE
    `)).rows[0] as
      | { id: string; status: string; pricing_model: string | null; license_end_at: string | null; billing_cycle: string | null; seats_override: number | null; declared_aum_crore: string | null; scheduled_change: unknown }
      | undefined;
    if (!sub || sub.pricing_model !== "aum" || !sub.license_end_at || !["active", "past_due"].includes(sub.status)) {
      throw new CheckoutError(409, "There is no paid package to change. Choose a package and pay from Billing.", "not_active");
    }
    const change = { cycle: choice.cycle, users: choice.users, at: new Date().toISOString(), by: actorUserId };
    await tx.execute(sql`
      UPDATE subscriptions
         SET scheduled_change = ${JSON.stringify(change)}::jsonb,
             declared_aum_crore = COALESCE(${choice.aumCrore ?? null}::numeric, declared_aum_crore),
             updated_at = now()
       WHERE id = ${sub.id}::uuid
    `);
    await recordAudit(tx, {
      tenantId,
      actorUserId,
      action: "billing.package_change_scheduled",
      entityType: "subscription",
      entityId: sub.id,
      before: { cycle: sub.billing_cycle, users: sub.seats_override, declaredAumCrore: sub.declared_aum_crore, scheduledChange: sub.scheduled_change as Record<string, unknown> | null },
      after: { cycle: choice.cycle, users: choice.users, declaredAumCrore: choice.aumCrore ?? null, effectiveFrom: sub.license_end_at },
    });
    return new Date(sub.license_end_at);
  });
  const inWindow = istDayNumber(due) - istDayNumber(new Date()) <= s.renewalReviewDays;
  const review = inWindow ? await reviewRenewal(tenantId, { force: true, settings: s, actorUserId }) : null;
  return { effectiveFrom: due.toISOString(), review };
}
