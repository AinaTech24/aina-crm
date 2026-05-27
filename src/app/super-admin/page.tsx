import Link from "next/link";
import { sql } from "drizzle-orm";
import { Building2, Activity, AlertTriangle, TrendingUp, Package } from "lucide-react";
import { withPlatformAdmin } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { formatRelative } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function SuperAdminOverview() {
  const session = await requireSession();
  const data = await withPlatformAdmin(session.userId, async (tx) => {
    const stats = await tx.execute(sql`
      SELECT
        (SELECT COUNT(*)::int FROM tenants) AS total_tenants,
        (SELECT COUNT(*)::int FROM subscriptions WHERE status = 'active') AS active_subs,
        (SELECT COUNT(*)::int FROM subscriptions WHERE status = 'trial') AS trial_subs,
        (SELECT COUNT(*)::int FROM subscriptions WHERE status IN ('past_due', 'suspended', 'expired')) AS at_risk_subs,
        (SELECT COUNT(*)::int FROM subscriptions WHERE status = 'active'
            AND next_renewal_at IS NOT NULL
            AND next_renewal_at <= now() + interval '30 days') AS renewals_30d,
        (SELECT COUNT(*)::int FROM packages WHERE is_active = true) AS active_packages,
        (SELECT COUNT(*)::int FROM support_tickets WHERE status IN ('open', 'in_progress')) AS open_tickets
    `);
    const s = stats.rows[0] as any;

    const newTenants = await tx.execute(sql`
      SELECT t.id, t.legal_name, t.arn, t.created_at,
             s.status AS sub_status, s.package_key, s.trial_ends_at
      FROM tenants t
      LEFT JOIN subscriptions s ON s.tenant_id = t.id
      ORDER BY t.created_at DESC
      LIMIT 10
    `);

    const atRisk = await tx.execute(sql`
      SELECT t.id, t.legal_name, t.arn, s.status, s.next_renewal_at, s.license_end_at,
             s.suspended_reason
      FROM subscriptions s
      JOIN tenants t ON t.id = s.tenant_id
      WHERE s.status IN ('past_due', 'suspended', 'expired')
         OR (s.status = 'active' AND s.next_renewal_at <= now() + interval '14 days')
      ORDER BY s.next_renewal_at NULLS FIRST
      LIMIT 10
    `);

    return {
      totalTenants: Number(s.total_tenants),
      activeSubs: Number(s.active_subs),
      trialSubs: Number(s.trial_subs),
      atRiskSubs: Number(s.at_risk_subs),
      renewals30d: Number(s.renewals_30d),
      activePackages: Number(s.active_packages),
      openTickets: Number(s.open_tickets),
      newTenants: newTenants.rows as any[],
      atRisk: atRisk.rows as any[],
    };
  });

  return (
    <div className="space-y-6 max-w-7xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Platform overview</h1>
        <p className="text-muted-foreground text-sm">
          All MFD accounts across the platform. AINA-only view.
        </p>
      </div>

      <div className="grid grid-cols-4 gap-3">
        <Kpi label="Total tenants" value={data.totalTenants} icon={Building2} />
        <Kpi label="Active" value={data.activeSubs} tone="emerald" icon={Activity} />
        <Kpi label="Trial" value={data.trialSubs} tone="blue" icon={TrendingUp} />
        <Kpi label="At-risk" value={data.atRiskSubs} tone={data.atRiskSubs > 0 ? "rose" : "muted"} icon={AlertTriangle} />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Kpi label="Renewals in 30 days" value={data.renewals30d} />
        <Kpi label="Active packages" value={data.activePackages} />
        <Kpi label="Open support tickets" value={data.openTickets} tone={data.openTickets > 0 ? "amber" : "muted"} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="border rounded-lg bg-card p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">New tenants</h2>
            <Link href="/super-admin/tenants" className="text-xs text-muted-foreground hover:underline">
              View all →
            </Link>
          </div>
          {data.newTenants.length === 0 ? (
            <p className="text-sm text-muted-foreground mt-3 text-center py-6">
              No tenants yet.{" "}
              <Link href="/super-admin/tenants/new" className="text-primary hover:underline">
                Create one
              </Link>
              .
            </p>
          ) : (
            <ul className="divide-y mt-3">
              {data.newTenants.map((t: any) => (
                <li key={t.id} className="py-2 flex items-center justify-between text-sm">
                  <div>
                    <Link href={`/super-admin/tenants/${t.id}`} className="font-medium hover:underline">
                      {t.legal_name}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      {t.arn} · {t.package_key ?? "no package"} · {t.sub_status ?? "no subscription"}
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground">{formatRelative(t.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border rounded-lg bg-card p-5">
          <h2 className="font-semibold flex items-center gap-2">
            <AlertTriangle className="size-4 text-rose-600" /> At-risk subscriptions
          </h2>
          {data.atRisk.length === 0 ? (
            <p className="text-sm text-muted-foreground mt-3 text-center py-6">No at-risk subscriptions. ✓</p>
          ) : (
            <ul className="divide-y mt-3">
              {data.atRisk.map((s: any) => (
                <li key={s.id} className="py-2 flex items-center justify-between text-sm">
                  <div>
                    <Link href={`/super-admin/tenants/${s.id}`} className="font-medium hover:underline">
                      {s.legal_name}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      {s.status} · {s.suspended_reason ?? ""}
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {s.next_renewal_at ? formatRelative(s.next_renewal_at) : "—"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function Kpi({
  label,
  value,
  tone,
  icon: Icon,
}: {
  label: string;
  value: number;
  tone?: "rose" | "amber" | "emerald" | "blue" | "muted";
  icon?: any;
}) {
  const color = {
    rose: "text-rose-600",
    amber: "text-amber-600",
    emerald: "text-emerald-600",
    blue: "text-blue-600",
    muted: "text-muted-foreground",
  }[tone ?? "muted"];
  return (
    <div className="border rounded-lg p-5 bg-card">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        {Icon && <Icon className="size-3.5" />}
      </div>
      <div className={`text-2xl font-bold mt-1 ${value > 0 ? color : ""}`}>{value}</div>
    </div>
  );
}
