import { eq } from "drizzle-orm";
import { CreditCard, Package } from "lucide-react";
import { withTenant } from "@/db/client";
import { subscriptions, packages, subscriptionEvents } from "@/db/schema";
import { desc } from "drizzle-orm";
import { requireSession } from "@/lib/auth/session";
import { formatDate, formatRelative } from "@/lib/utils";
import { BillingCycleChooser } from "@/components/billing/BillingCycleChooser";
import { AutoPaySetup } from "@/components/billing/AutoPaySetup";
import { computeAnnualAmountPaise, razorpayConfigured } from "@/lib/billing/razorpay";

const STATUS_COLORS: Record<string, string> = {
  trial: "bg-blue-50 text-blue-700",
  active: "bg-emerald-50 text-emerald-700",
  past_due: "bg-amber-50 text-amber-700",
  suspended: "bg-rose-50 text-rose-700",
  expired: "bg-rose-50 text-rose-700",
  cancelled: "bg-gray-50 text-gray-700",
};

export const dynamic = "force-dynamic";

export default async function BillingPage() {
  const session = await requireSession();
  const { sub, pkg, events } = await withTenant(session.tenantId, async (tx) => {
    const s = (await tx.select().from(subscriptions).where(eq(subscriptions.tenantId, session.tenantId)).limit(1))[0] ?? null;
    const p = s ? (await tx.select().from(packages).where(eq(packages.id, s.packageId)).limit(1))[0] ?? null : null;
    const ev = s
      ? await tx
          .select()
          .from(subscriptionEvents)
          .where(eq(subscriptionEvents.tenantId, session.tenantId))
          .orderBy(desc(subscriptionEvents.at))
          .limit(20)
      : [];
    return { sub: s, pkg: p, events: ev };
  });

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Billing & Subscription</h1>
        <p className="text-muted-foreground text-sm">Your license, package, and payment history.</p>
      </div>

      {sub && pkg ? (
        <>
          <div className="border rounded-lg bg-card p-6">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-xs text-muted-foreground">Current package</div>
                <h2 className="text-xl font-bold mt-1 flex items-center gap-2">
                  <Package className="size-5" /> {pkg.name}
                </h2>
                <p className="text-sm text-muted-foreground mt-1 max-w-md">{pkg.description}</p>
              </div>
              <span className={`text-sm px-3 py-1 rounded-full ${STATUS_COLORS[sub.status] ?? ""}`}>
                {sub.status}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-4 mt-4 pt-4 border-t text-sm">
              <Row label="Billing cycle" value={sub.billingCycle ?? "—"} />
              <Row label="Setup (one-time)" value={`₹${(pkg.setupCostPaise / 100).toLocaleString("en-IN")}`} />
              <Row label="Users" value={String(sub.seatsOverride ?? pkg.maxUsers)} />
              <Row label="Max investors" value={String(pkg.maxInvestors)} />
              <Row label="Storage" value={`${pkg.storageLimitGb} GB`} />
              <Row label="Next renewal" value={sub.nextRenewalAt ? formatDate(sub.nextRenewalAt) : "—"} />
              <Row label="License start" value={sub.licenseStartAt ? formatDate(sub.licenseStartAt) : "—"} />
              <Row label="License end" value={sub.licenseEndAt ? formatDate(sub.licenseEndAt) : "—"} />
            </div>
          </div>

          <BillingCycleChooser
            current={sub.billingCycle ?? null}
            seats={sub.seatsOverride ?? pkg.maxUsers}
            monthlyPaise={pkg.monthlyPricePaise}
            yearlyPaise={pkg.yearlyPricePaise}
            perUserMonthlyPaise={pkg.perUserMonthlyPaise}
            perUserYearlyPaise={pkg.perUserYearlyPaise}
            canManage={(session.roles ?? []).includes("owner")}
          />

          <AutoPaySetup
            configured={razorpayConfigured()}
            mandateStatus={(sub as any).mandateStatus ?? "none"}
            status={sub.status}
            amountPaise={computeAnnualAmountPaise(pkg as any, sub as any).amountPaise}
            seats={computeAnnualAmountPaise(pkg as any, sub as any).seats}
            canManage={(session.roles ?? []).includes("owner")}
          />

          <div className="border rounded-lg bg-card p-6">
            <h2 className="font-semibold">Modules enabled</h2>
            <div className="flex flex-wrap gap-2 mt-3">
              {(pkg.enabledModules as string[]).map((m) => (
                <span key={m} className="text-xs px-2 py-1 rounded bg-muted">
                  {m.replace(/_/g, " ")}
                </span>
              ))}
            </div>
          </div>

          <div className="border rounded-lg bg-card p-6">
            <h2 className="font-semibold flex items-center gap-2">
              <CreditCard className="size-4" /> Activity history
            </h2>
            {events.length === 0 ? (
              <p className="text-sm text-muted-foreground mt-3">No events yet.</p>
            ) : (
              <ul className="mt-3 space-y-2 text-sm">
                {events.map((e) => (
                  <li key={e.id} className="border-l-2 border-muted pl-3 py-1">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{e.eventType.replace(/_/g, " ")}</span>
                      <span className="text-xs text-muted-foreground">{formatRelative(e.at)}</span>
                    </div>
                    {e.notes && <div className="text-xs text-muted-foreground mt-0.5">{e.notes}</div>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      ) : (
        <div className="border rounded-lg bg-card p-12 text-center">
          <Package className="size-12 mx-auto text-muted-foreground/50" />
          <h2 className="text-lg font-semibold mt-3">No active subscription</h2>
          <p className="text-sm text-muted-foreground mt-2">Contact AINA support to provision your license.</p>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-medium mt-0.5 capitalize">{value}</div>
    </div>
  );
}
