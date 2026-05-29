import Link from "next/link";
import { notFound } from "next/navigation";
import { sql, eq, desc } from "drizzle-orm";
import { ChevronLeft, Building2, Users, TrendingUp } from "lucide-react";
import { withPlatformAdmin } from "@/db/client";
import { tenants, subscriptions, subscriptionEvents, users, investors, packages } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { formatDate, formatRelative, formatINR } from "@/lib/utils";
import { TenantActions } from "@/components/super-admin/TenantActions";
import { TenantAccessControl } from "@/components/super-admin/TenantAccessControl";

const STATUS_COLORS: Record<string, string> = {
  trial: "bg-blue-50 text-blue-700",
  active: "bg-emerald-50 text-emerald-700",
  past_due: "bg-amber-50 text-amber-700",
  suspended: "bg-rose-50 text-rose-700",
  expired: "bg-rose-50 text-rose-700",
  cancelled: "bg-gray-50 text-gray-700",
};

export const dynamic = "force-dynamic";

export default async function TenantDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();

  const data = await withPlatformAdmin(session.userId, async (tx) => {
    const tenant = (await tx.select().from(tenants).where(eq(tenants.id, id)).limit(1))[0];
    if (!tenant) return null;
    const sub = (await tx.select().from(subscriptions).where(eq(subscriptions.tenantId, id)).limit(1))[0];
    const pkg = sub ? (await tx.select().from(packages).where(eq(packages.id, sub.packageId)).limit(1))[0] : null;
    const events = await tx
      .select()
      .from(subscriptionEvents)
      .where(eq(subscriptionEvents.tenantId, id))
      .orderBy(desc(subscriptionEvents.at))
      .limit(20);
    const usage = await tx.execute(sql`
      SELECT
        (SELECT COUNT(*)::int FROM users WHERE tenant_id = ${id} AND status = 'active') AS active_users,
        (SELECT COUNT(*)::int FROM investors WHERE tenant_id = ${id}) AS total_investors,
        (SELECT COUNT(*)::int FROM leads WHERE tenant_id = ${id}) AS total_leads,
        (SELECT COUNT(*)::int FROM transactions WHERE tenant_id = ${id}
           AND created_at >= now() - interval '30 days') AS tx_30d,
        (SELECT COUNT(*)::int FROM workflow_runs WHERE tenant_id = ${id}
           AND created_at >= now() - interval '30 days') AS runs_30d,
        (SELECT COALESCE(SUM(aum::numeric),0) FROM investors WHERE tenant_id = ${id}) AS aum
    `);
    return { tenant, subscription: sub, package: pkg, events, usage: usage.rows[0] as any };
  });

  if (!data) notFound();

  return (
    <div className="space-y-6 max-w-7xl">
      <Link
        href="/super-admin/tenants"
        className="text-sm text-muted-foreground hover:underline flex items-center gap-1"
      >
        <ChevronLeft className="size-4" /> Back to tenants
      </Link>

      {/* Header */}
      <div className="border rounded-lg bg-card p-6">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div className="size-12 rounded-lg bg-primary/10 grid place-items-center">
              <Building2 className="size-6 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">{data.tenant.legalName}</h1>
              <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
                <span className="font-mono">{data.tenant.arn}</span>
                {data.subscription && (
                  <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[data.subscription.status] ?? ""}`}>
                    {data.subscription.status}
                  </span>
                )}
                <span className="text-xs uppercase">{data.subscription?.packageKey ?? "no package"}</span>
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                Created {formatDate(data.tenant.createdAt)} · {data.tenant.email ?? "no contact email"}
              </div>
            </div>
          </div>
          <TenantActions tenantId={id} currentStatus={data.subscription?.status ?? "trial"} />
        </div>
      </div>

      <div className="grid grid-cols-5 gap-3">
        <Kpi icon={Users} label="Active users" value={data.usage.active_users} />
        <Kpi icon={Users} label="Investors" value={data.usage.total_investors} />
        <Kpi label="Leads" value={data.usage.total_leads} />
        <Kpi label="Transactions (30d)" value={data.usage.tx_30d} />
        <Kpi label="Workflow runs (30d)" value={data.usage.runs_30d} icon={TrendingUp} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="border rounded-lg bg-card p-5">
          <h2 className="font-semibold">Subscription</h2>
          {data.subscription ? (
            <dl className="mt-3 text-sm">
              <Row label="Package" value={data.subscription.packageKey ?? "—"} />
              <Row label="Status" value={data.subscription.status} />
              <Row label="Billing cycle" value={data.subscription.billingCycle ?? "—"} />
              <Row label="License start" value={data.subscription.licenseStartAt ? formatDate(data.subscription.licenseStartAt) : "—"} />
              <Row label="License end" value={data.subscription.licenseEndAt ? formatDate(data.subscription.licenseEndAt) : "—"} />
              <Row label="Trial ends" value={data.subscription.trialEndsAt ? formatDate(data.subscription.trialEndsAt) : "—"} />
              <Row label="Next renewal" value={data.subscription.nextRenewalAt ? formatDate(data.subscription.nextRenewalAt) : "—"} />
              <Row label="Suspended reason" value={data.subscription.suspendedReason ?? "—"} />
              <Row label="AUM" value={formatINR(Number(data.usage.aum))} />
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground mt-3">No subscription on file.</p>
          )}
        </div>

        <div className="border rounded-lg bg-card p-5">
          <h2 className="font-semibold">Activity timeline</h2>
          {data.events.length === 0 ? (
            <p className="text-sm text-muted-foreground mt-3">No events yet.</p>
          ) : (
            <ul className="mt-3 space-y-2 text-sm">
              {data.events.map((e) => (
                <li key={e.id} className="border-l-2 border-muted pl-3 py-1">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{e.eventType.replace(/_/g, " ")}</span>
                    <span className="text-xs text-muted-foreground">{formatRelative(e.at)}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {e.actor} · {e.fromStatus ? `${e.fromStatus} → ` : ""}{e.toStatus ?? ""}
                  </div>
                  {e.notes && <div className="text-xs mt-0.5">{e.notes}</div>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {data.subscription && (
        <TenantAccessControl
          tenantId={id}
          packageModules={(data.package?.enabledModules as string[]) ?? []}
          initialModulesOverride={data.subscription.modulesOverride as string[] | null}
          initialAllowedFields={data.subscription.allowedFields as string[] | null}
        />
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-2 py-1.5 border-b last:border-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

function Kpi({ label, value, icon: Icon }: { label: string; value: number; icon?: any }) {
  return (
    <div className="border rounded-lg p-4 bg-card">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        {Icon && <Icon className="size-3" />}
      </div>
      <div className="text-2xl font-bold mt-1">{value}</div>
    </div>
  );
}
