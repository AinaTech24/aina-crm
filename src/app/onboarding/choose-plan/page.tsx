/**
 * /onboarding/choose-plan — shown to a brand-new (status='pending') owner right
 * after signup. They pick a package; the flow then activates (free) or takes
 * payment (Razorpay), logs them out, and sends them to /login. Tenants that are
 * already set up are bounced to the dashboard.
 */

import { redirect } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { packages, subscriptions } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { ChoosePlanClient, type Plan } from "@/components/onboarding/ChoosePlanClient";

export const dynamic = "force-dynamic";

export default async function ChoosePlanPage() {
  const session = await requireSession();

  const { sub, pkgs } = await withTenant(session.tenantId, async (tx) => {
    const [s] = await tx
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.tenantId, session.tenantId))
      .limit(1);
    const ps = await tx
      .select()
      .from(packages)
      .where(and(eq(packages.isActive, true), eq(packages.isPublic, true)))
      .orderBy(asc(packages.sortOrder));
    return { sub: s, pkgs: ps };
  });

  // Only pending (just-signed-up, unpaid) tenants choose a plan here. Everyone
  // else (already active, or no subscription) goes to the dashboard, where the
  // normal license gate applies.
  if (!sub || sub.status !== "pending") redirect("/dashboard");

  const plans: Plan[] = pkgs.map((p) => ({
    id: p.id,
    key: p.key,
    name: p.name,
    description: p.description,
    monthlyPaise: p.monthlyPricePaise,
    yearlyPaise: p.yearlyPricePaise,
    setupPaise: p.setupCostPaise,
    perUserMonthlyPaise: p.perUserMonthlyPaise,
    badge: p.badge,
    moduleKeys: ((p.enabledModules as string[] | null) ?? []),
    maxUsers: p.maxUsers,
    maxInvestors: p.maxInvestors,
    storageGb: p.storageLimitGb,
    trialDays: p.trialDays,
  }));

  return <ChoosePlanClient plans={plans} firmName={session.name} />;
}
