import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { CreditCard, Package, Users, FolderOpen, HardDrive, MessageSquare, Clock, AlertTriangle, FileText } from "lucide-react";
import { withTenant } from "@/db/client";
import { subscriptions, packages, subscriptionEvents } from "@/db/schema";
import { desc } from "drizzle-orm";
import { requireSession } from "@/lib/auth/session";
import { formatDate, formatRelative } from "@/lib/utils";
import { BillingCycleChooser } from "@/components/billing/BillingCycleChooser";
import { AutoPaySetup } from "@/components/billing/AutoPaySetup";
import { computeAnnualAmountPaise, razorpayConfigured } from "@/lib/billing/razorpay";
import { getBillingUsage, type UsageMetric } from "@/lib/billing/usage";
import { StatusChip, type Tone } from "@/components/common/StatusChip";

const STATUS_TONE: Record<string, Tone> = {
  trial: "info",
  active: "success",
  past_due: "warning",
  suspended: "danger",
  expired: "danger",
  cancelled: "neutral",
};

export const dynamic = "force-dynamic";

export default async function BillingPage() {
  const session = await requireSession();
  const { sub, pkg, events, usage } = await withTenant(session.tenantId, async (tx) => {
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
    const u = p
      ? await getBillingUsage(tx, session.tenantId, {
          seatLimit: s?.seatsOverride ?? p.maxUsers,
          investorLimit: p.maxInvestors,
          storageGb: p.storageLimitGb,
          messageCap: Number((p.featureFlags as any)?.maxMessagesPerMonth ?? 0),
        })
      : null;
    return { sub: s, pkg: p, events: ev, usage: u };
  });

  const razorpayReady = await razorpayConfigured();

  // Trial / expiry countdown.
  const endDate = sub?.licenseEndAt ? new Date(sub.licenseEndAt) : null;
  const daysLeft = endDate ? Math.ceil((endDate.getTime() - Date.now()) / 86_400_000) : null;
  const isTrial = sub?.status === "trial";
  const nextDebit = pkg && sub ? computeAnnualAmountPaise(pkg as any, sub as any).amountPaise : 0;

  return (
    <div className="space-y-6 max-w-4xl">
      <PageHeaderCard title={<>Billing & Subscription</>} />

      {sub && pkg ? (
        <>
          {/* Trial / expiry countdown */}
          {isTrial && daysLeft != null && (
            <div className={`rounded-lg border p-4 flex items-start gap-3 ${daysLeft <= 14 ? "border-amber-300 bg-amber-50" : "border-blue-200 bg-blue-50/60"}`}>
              <Clock className={`size-5 mt-0.5 ${daysLeft <= 14 ? "text-amber-600" : "text-blue-600"}`} />
              <div className="flex-1">
                <div className="font-semibold text-sm">
                  {daysLeft > 0 ? `Your trial ends in ${daysLeft} day${daysLeft === 1 ? "" : "s"}` : "Your trial has ended"}
                  {endDate ? ` · ${formatDate(endDate)}` : ""}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Set up auto-pay below to keep uninterrupted access — when a license lapses, the workspace is limited to
                  billing &amp; support until payment resumes.
                </p>
              </div>
              <a href="#autopay" className="btn-primary text-xs whitespace-nowrap print:hidden">Set up auto-pay</a>
            </div>
          )}

          {/* Usage vs plan limits */}
          {usage && (
            <div className="border rounded-lg bg-card p-6">
              <h2 className="font-semibold flex items-center gap-2 mb-4">Plan usage</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4">
                <UsageRow icon={Users} label="Users" m={usage.users} unit="" />
                <UsageRow icon={FolderOpen} label="Clients" m={usage.investors} unit="" />
                <UsageRow icon={HardDrive} label="Storage" m={usage.storage} unit=" GB" />
                <UsageRow icon={MessageSquare} label="Messages this month" m={usage.messages} unit="" />
              </div>
            </div>
          )}

          <div className="border rounded-lg bg-card p-6">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-xs text-muted-foreground">Current package</div>
                <h2 className="text-xl font-bold mt-1 flex items-center gap-2">
                  <Package className="size-5" /> {pkg.name}
                </h2>
                <p className="text-sm text-muted-foreground mt-1 max-w-md">{pkg.description}</p>
              </div>
              <StatusChip tone={STATUS_TONE[sub.status] ?? "neutral"} className="text-sm px-3 py-1 capitalize">
                {sub.status}
              </StatusChip>
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

          <div id="autopay" className="scroll-mt-20 space-y-2">
            {nextDebit > 0 && (
              <p className="text-xs text-muted-foreground px-1">
                {(sub as any).mandateStatus === "active"
                  ? `Auto-pay is active — ₹${(nextDebit / 100).toLocaleString("en-IN")} will be debited on ${sub.nextRenewalAt ? formatDate(sub.nextRenewalAt) : "renewal"} via your saved mandate.`
                  : `Next charge: ₹${(nextDebit / 100).toLocaleString("en-IN")} on ${sub.nextRenewalAt ? formatDate(sub.nextRenewalAt) : "renewal"}. Set up auto-pay so it's collected automatically.`}
              </p>
            )}
            <AutoPaySetup
              configured={razorpayReady}
              mandateStatus={(sub as any).mandateStatus ?? "none"}
              status={sub.status}
              amountPaise={computeAnnualAmountPaise(pkg as any, sub as any).amountPaise}
              seats={computeAnnualAmountPaise(pkg as any, sub as any).seats}
              canManage={(session.roles ?? []).includes("owner")}
            />
          </div>

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
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">
                        {e.eventType.replace(/_/g, " ")}
                        {e.amountPaise != null && (
                          <span className="text-muted-foreground font-normal"> · ₹{(e.amountPaise / 100).toLocaleString("en-IN")}</span>
                        )}
                      </span>
                      <span className="flex items-center gap-2">
                        {e.amountPaise != null && (
                          <Link href={`/dashboard/billing/receipt/${e.id}`} className="text-xs text-brand-cyan-deep hover:underline inline-flex items-center gap-1">
                            <FileText className="size-3" /> Receipt
                          </Link>
                        )}
                        <span className="text-xs text-muted-foreground">{formatRelative(e.at)}</span>
                      </span>
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

function UsageRow({ icon: Icon, label, m, unit }: { icon: any; label: string; m: UsageMetric; unit: string }) {
  const fmt = (n: number) => n.toLocaleString("en-IN");
  const pct = m.pct;
  const tone = pct == null ? "bg-brand-cyan" : pct >= 90 ? "bg-rose-500" : pct >= 75 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div>
      <div className="flex items-center justify-between text-sm">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <Icon className="size-3.5" /> {label}
        </span>
        <span className="tabular-nums font-medium">
          {fmt(m.used)}{unit}
          {m.limit != null ? <span className="text-muted-foreground font-normal"> / {fmt(m.limit)}{unit}</span> : <span className="text-muted-foreground font-normal"> · unlimited</span>}
        </span>
      </div>
      <div className="h-2 rounded-full bg-secondary overflow-hidden mt-1.5">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct ?? 4}%` }} />
      </div>
      {pct != null && pct >= 90 && (
        <div className="text-2xs text-rose-600 mt-0.5">{pct}% used — approaching your plan limit</div>
      )}
    </div>
  );
}
