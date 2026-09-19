import { sql } from "drizzle-orm";
import { withPlatformAdmin } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { SubscriptionsTable, type SubscriptionRow } from "@/components/super-admin/SubscriptionsTable";
import { CollapsibleCards } from "@/components/super-admin/CollapsibleCards";
import { AutoRefresh } from "@/components/common/AutoRefresh";

export const dynamic = "force-dynamic";

export default async function SubscriptionsPage() {
  const session = await requireSession();

  const data = await withPlatformAdmin(session.userId, async (tx) => {
    const stats = await tx.execute(sql`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status = 'trial')::int AS trial_n,
        COUNT(*) FILTER (WHERE status = 'active')::int AS active_n,
        COUNT(*) FILTER (WHERE status = 'past_due')::int AS past_due_n,
        COUNT(*) FILTER (WHERE status IN ('suspended', 'expired', 'cancelled'))::int AS dead_n,
        COUNT(*) FILTER (WHERE status = 'active'
          AND next_renewal_at IS NOT NULL
          AND next_renewal_at <= now() + interval '30 days')::int AS renewals_30d,
        COALESCE(SUM(CASE WHEN status = 'active' AND billing_cycle = 'yearly'
          THEN (SELECT yearly_price_paise FROM packages WHERE id = subscriptions.package_id)
          ELSE 0 END), 0)::bigint AS arr_paise
      FROM subscriptions
    `);
    const s = stats.rows[0] as any;

    // Fetch ALL rows once — platform-wide subscriptions are a small set. The
    // client component handles search / filter / sort live, with no reload.
    const rows = await tx.execute(sql`
      SELECT s.id, s.tenant_id, s.package_key, s.status, s.billing_cycle,
             s.license_start_at, s.license_end_at, s.next_renewal_at, s.trial_ends_at,
             s.suspended_reason,
             t.legal_name, t.arn
      FROM subscriptions s
      JOIN tenants t ON t.id = s.tenant_id
      ORDER BY s.updated_at DESC
      LIMIT 1000
    `);

    return {
      stats: s,
      rows: rows.rows as unknown as SubscriptionRow[],
    };
  });

  return (
    <div className="space-y-6 max-w-7xl">
      {/* Live-update the subscriptions view as billing state changes (no manual refresh). */}
      <AutoRefresh intervalMs={15000} />

      <div>
        <h1 className="page-title">Subscriptions</h1>
        <p className="text-muted-foreground text-sm">
          All MFD subscriptions across the platform. Filter and drill into any tenant for actions.
        </p>
      </div>

      <CollapsibleCards label="Key metrics">
        <div className="grid grid-cols-5 gap-3">
          <Kpi label="Total" value={data.stats.total} />
          <Kpi label="Trial" value={data.stats.trial_n} tone="blue" />
          <Kpi label="Active" value={data.stats.active_n} tone="emerald" />
          <Kpi label="Past due" value={data.stats.past_due_n} tone={data.stats.past_due_n > 0 ? "amber" : "muted"} />
          <Kpi label="Suspended/Expired" value={data.stats.dead_n} tone={data.stats.dead_n > 0 ? "rose" : "muted"} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Kpi label="Renewals in 30 days" value={data.stats.renewals_30d} />
          <Kpi label="ARR (active subs)" value={`₹${(Number(data.stats.arr_paise) / 100).toLocaleString("en-IN")}`} tone="emerald" />
        </div>
      </CollapsibleCards>

      <SubscriptionsTable rows={data.rows} />
    </div>
  );
}

function Kpi({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | string;
  tone?: "rose" | "amber" | "emerald" | "blue" | "muted";
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
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${value && value !== 0 ? color : ""}`}>{value}</div>
    </div>
  );
}
