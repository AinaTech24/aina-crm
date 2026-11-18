/**
 * Start a Razorpay checkout for an AUM-priced package — the server decides
 * what is being bought and what it costs; the browser only opens Checkout.
 *
 * What is bought (`kind`):
 *  - first         a firm that has not paid yet (new from /pricing, or a lapsed
 *                  legacy firm moving to AUM pricing): the cycle starts now;
 *                  priced from the AUM the owner declares.
 *  - renewal       a renewal paid within the grace period: the cycle runs from
 *                  the ORIGINAL due date; no extra charge.
 *  - late_renewal  a renewal paid after the grace period: the cycle starts
 *                  today, plus the grace days pro-rata (+ GST) as its own line.
 *  Renewals are priced from the AUM the renewal review took from the CRM
 *  (lib/billing/renewal-review.ts), never from a typed figure.
 *
 * Which cycles may be bought (`cyclesOffered`): a FIRST purchase gets the
 * 6-month commitment or yearly only; everyone else the three standard cycles.
 * The server decides from the database (lib/billing/first-purchase.ts), so a
 * crafted monthly / half-yearly first purchase is refused here.
 *
 * How it is collected: ONE Razorpay subscription per checkout. Its plan is the
 * cycle total (incl. GST) on the cycle's period (monthly ×1, monthly ×6,
 * yearly); `start_at` is the END of the period being bought, and the period
 * itself (plus any late charge) is an upfront add-on charged with the mandate
 * authorisation. So the money for now is taken now, and the first automatic
 * debit lands exactly on the next renewal date. For the commitment the plan is
 * the MONTHLY plan the firm continues on when it has not chosen another cycle
 * by the commitment's end — the commitment itself is the upfront add-on.
 */

import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { subscriptions, tenants } from "@/db/schema";
import {
  addMonths,
  cycleLabel,
  cyclesOffered,
  AFTER_COMMITMENT_DEFAULT,
  lateProRataCharge,
  quoteCycle,
  razorpayPeriod,
  razorpayTotalCount,
  tierFor,
  type CycleKey,
  type PricingSettings,
} from "./aum-pricing";
import { createRazorpayPlan, createRazorpaySubscription, razorpayConfigured, razorpayPublicKeyId } from "./razorpay";
import { renewalState } from "./renewal";
import { loadFirstPurchase } from "./first-purchase";
import type { NextCycle, PendingCheckout } from "./payments";

export class CheckoutError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string
  ) {
    super(message);
  }
}

export type CheckoutChoice = { cycle: CycleKey; users: number; aumCrore?: number | null };

export type CheckoutPlan = Omit<PendingCheckout, "id" | "razorpaySubscriptionId" | "razorpayPlanId" | "razorpayPlanPaise" | "createdAt" | "createdBy" | "previousRazorpaySubscriptionId">;

type SubState = {
  status: string;
  pricingModel: string | null;
  licenseEndAt: Date | null;
  declaredAumCrore: number | null;
  aumCroreInForce: number | null;
  aumSource: string | null;
  aumAsOf: string | null;
  nextCycle: NextCycle | null;
  /** Never bought before (lib/billing/first-purchase.ts) — the commitment rule applies. */
  firstPurchase: boolean;
};

/** The message when a cycle is not on offer to this firm. */
export function cycleNotOffered(firstPurchase: boolean, s: PricingSettings): CheckoutError {
  const months = s.cycles.commitment.months;
  return firstPurchase && s.firstPurchaseCommitment
    ? new CheckoutError(400, `Your first purchase is the ${months}-month commitment or yearly. Monthly billing is available after the first ${months} months.`, "cycle_not_offered")
    : new CheckoutError(400, "Choose monthly, half-yearly or yearly.", "cycle_not_offered");
}

/**
 * Pure: what a checkout made now would buy and charge. Throws CheckoutError
 * when there is nothing to pay now (an active firm changes its package from
 * the next renewal instead — lib/billing/change.ts).
 */
export function planCheckout(sub: SubState, choice: CheckoutChoice, now: Date, s: PricingSettings): CheckoutPlan {
  const isAum = sub.pricingModel === "aum";
  const unpaid = sub.status === "pending" || (!isAum && ["trial", "expired", "cancelled", "suspended"].includes(sub.status)) || (isAum && !sub.licenseEndAt);
  const offered = cyclesOffered(unpaid && sub.firstPurchase, s);
  if (!offered.includes(choice.cycle)) throw cycleNotOffered(unpaid && sub.firstPurchase, s);
  const months = s.cycles[choice.cycle].months;

  if (unpaid) {
    const aum = choice.aumCrore ?? sub.declaredAumCrore;
    if (aum == null || !Number.isFinite(aum) || aum < 0) throw new CheckoutError(400, "Please enter your AUM in ₹ crore.", "aum");
    const quote = quoteCycle({ aumCrore: aum, users: choice.users, cycle: choice.cycle }, s);
    return {
      kind: "first",
      cycle: choice.cycle,
      users: quote.users,
      aumCrore: aum,
      aumSource: "declared",
      aumAsOf: null,
      tierKey: quote.tierKey,
      tierLabel: quote.tierLabel,
      quote,
      late: null,
      periodStart: now.toISOString(),
      periodEnd: addMonths(now, months).toISOString(),
      dueAt: null,
      chargePaise: quote.totalPaise,
    };
  }

  if (!isAum) {
    throw new CheckoutError(409, "Your firm is on a custom plan. Please contact Aina to move to this price.", "legacy");
  }
  const st = renewalState(sub.licenseEndAt!, now, s.graceDays);
  if (st.phase === "current") {
    throw new CheckoutError(409, "Your subscription is paid up. A change takes effect from your next renewal.", "not_due");
  }
  // The renewal is priced from the AUM the review took from the CRM.
  const nc = sub.nextCycle;
  const aum = nc?.aumCrore ?? sub.aumCroreInForce ?? sub.declaredAumCrore ?? 0;
  const aumSource = (nc?.aumSource ?? (sub.aumSource as PendingCheckout["aumSource"] | null) ?? "declared") as PendingCheckout["aumSource"];
  const quote = quoteCycle({ aumCrore: aum, users: choice.users, cycle: choice.cycle }, s);
  const due = sub.licenseEndAt!;
  const late = st.phase === "lapsed" ? lateProRataCharge(quote.monthlyBasePaise, s) : null;
  const start = late ? now : due;
  return {
    kind: late ? "late_renewal" : "renewal",
    cycle: choice.cycle,
    users: quote.users,
    aumCrore: aum,
    aumSource,
    aumAsOf: nc?.aumAsOf ?? sub.aumAsOf,
    tierKey: tierFor(aum, s).key,
    tierLabel: quote.tierLabel,
    quote,
    late,
    periodStart: start.toISOString(),
    periodEnd: addMonths(start, months).toISOString(),
    dueAt: due.toISOString(),
    chargePaise: quote.totalPaise + (late?.totalPaise ?? 0),
  };
}

export type CheckoutStartResult = {
  keyId: string;
  subscriptionId: string;
  amountPaise: number;
  description: string;
  plan: CheckoutPlan;
};

export async function startCheckout(
  tenantId: string,
  choice: CheckoutChoice,
  s: PricingSettings,
  actorUserId: string | null
): Promise<CheckoutStartResult> {
  if (!(await razorpayConfigured())) {
    throw new CheckoutError(503, "Online payments are not switched on yet. Please contact Aina.", "payments_off");
  }
  const ctx = await withTenant(tenantId, async (tx) => {
    const [sub] = await tx.select().from(subscriptions).where(eq(subscriptions.tenantId, tenantId)).limit(1);
    const [t] = await tx.select({ name: tenants.displayName }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
    return { sub, firmName: t?.name ?? "Your firm", firstPurchase: await loadFirstPurchase(tx, tenantId) };
  });
  if (!ctx.sub) throw new CheckoutError(404, "No subscription to bill.");
  const sub = ctx.sub;
  const now = new Date();
  const plan = planCheckout(
    {
      status: sub.status,
      pricingModel: sub.pricingModel ?? null,
      licenseEndAt: sub.licenseEndAt ? new Date(sub.licenseEndAt) : null,
      declaredAumCrore: sub.declaredAumCrore != null ? Number(sub.declaredAumCrore) : null,
      aumCroreInForce: sub.aumCroreInForce != null ? Number(sub.aumCroreInForce) : null,
      aumSource: sub.aumSource ?? null,
      aumAsOf: sub.aumAsOf ?? null,
      nextCycle: (sub.nextCycle as NextCycle | null) ?? null,
      firstPurchase: ctx.firstPurchase,
    },
    choice,
    now,
    s
  );

  const checkoutId = crypto.randomUUID();
  const notes = { tenant_id: tenantId, checkout_id: checkoutId, kind: plan.kind };
  // The plan is what auto-debits from the end of this period: the cycle bought,
  // or — after a commitment — the monthly cycle the firm continues on.
  const planCycle = plan.cycle === "commitment" ? AFTER_COMMITMENT_DEFAULT : plan.cycle;
  const planQuote = planCycle === plan.cycle ? plan.quote : quoteCycle({ aumCrore: plan.aumCrore, users: plan.users, cycle: planCycle }, s);
  const { period, interval } = razorpayPeriod(planCycle);
  const rzPlan = await createRazorpayPlan({
    amountPaise: planQuote.totalPaise,
    period,
    interval,
    name: `Aina CRM — ${cycleLabel(planCycle)} · ${plan.users} user${plan.users === 1 ? "" : "s"} · ${plan.tierLabel}`,
    notes,
  });
  const periodEnd = new Date(plan.periodEnd);
  const label = cycleLabel(plan.cycle, plan.quote.months);
  const addons = [{ name: plan.cycle === "commitment" ? `${label} (incl. GST)` : `${label} subscription (incl. GST)`, amountPaise: plan.quote.totalPaise }];
  if (plan.late) addons.push({ name: `Late renewal — ${plan.late.graceDays} grace days (incl. GST)`, amountPaise: plan.late.totalPaise });
  const rzSub = await createRazorpaySubscription({
    planId: rzPlan.id,
    totalCount: razorpayTotalCount(planCycle),
    customerNotify: true,
    startAtUnix: Math.floor(periodEnd.getTime() / 1000),
    addons,
    notes,
  });

  const pending: PendingCheckout = {
    ...plan,
    id: checkoutId,
    razorpaySubscriptionId: rzSub.id,
    razorpayPlanId: rzPlan.id,
    razorpayPlanPaise: planQuote.totalPaise,
    previousRazorpaySubscriptionId: sub.razorpaySubscriptionId ?? null,
    createdAt: now.toISOString(),
    createdBy: actorUserId,
  };
  await withTenant(tenantId, async (tx) => {
    await tx
      .update(subscriptions)
      .set({ pendingCheckout: pending as unknown as Record<string, unknown>, mandateStatus: sub.mandateStatus === "active" ? "active" : "pending", updatedAt: new Date() })
      .where(eq(subscriptions.tenantId, tenantId));
  });

  return {
    keyId: await razorpayPublicKeyId(),
    subscriptionId: rzSub.id,
    amountPaise: plan.chargePaise,
    description: `${ctx.firmName} · ${label} · ${plan.users} user${plan.users === 1 ? "" : "s"}${plan.late ? " · incl. late charge" : ""}`,
    plan,
  };
}
