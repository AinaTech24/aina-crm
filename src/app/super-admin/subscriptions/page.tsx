import Link from "next/link";
import { sql } from "drizzle-orm";
import { Activity } from "lucide-react";
import { withPlatformAdmin } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { formatDate, formatRelative } from "@/lib/utils";

const STATUS_COLORS: Record<string, string> = {
  trial: "bg-blue-50 text-blue-700",
  active: "bg-emerald-50 text-emerald-700",
  past_due: "bg-amber-50 text-amber-700",
  suspended: "bg-rose-50 text-rose-700",
  expired: "bg-rose-50 text-rose-700",
  cancelled: "bg-gray-50 text-gray-700",
};

export const dynamic = "force-dynamic";

export default async function SubscriptionsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; package?: string }>;
}) {
  const session = await requireSession();
  const sp = await searchParams;

  const data = await withPlatformAdmin(session.userId, async (tx) => {
    const conditions: string[] = [];
    if (sp.status) conditions.push(`s.status = '${sp.status.replace(/'/g, "")}'`);
    if (sp.package) conditions.push(`s.package_key = '${sp.package.replace(/'/g, "")}'`);
    const whereSql = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

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

    const rows = await tx.execute(sql.raw(`
      SELECT s.id, s.tenant_id, s.package_key, s.status, s.billing_cycle,
             s.license_start_at, s.license_end_at, s.next_renewal_at, s.trial_ends_at,
             s.suspended_reason,
             t.legal_name, t.arn
      FROM subscriptions s
      JOIN tenants t ON t.id = s.tenant_id
      ${whereSql}
      ORDER BY s.updated_at DESC
      LIMIT 200
    `));

    return {
      stats: s,
      rows: rows.rows as any[],
    };
  });

  return (
    <div className="space-y-6 max-w-7xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Subscriptions</h1>
        <p className="text-muted-foreground text-sm">
          All MFD subscriptions across the platform. Filter and drill into any tenant for actions.
        </p>
      </div>

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

      <form className="border rounded-lg bg-card">
        <div className="border-b px-4 py-2.5 flex gap-2">
          <select
            name="status"
            defaultValue={sp.status ?? ""}
            className="text-sm border rounded-md px-2 bg-background"
          >
            <option value="">All statuses</option>
            <option value="trial">Trial</option>
            <option value="active">Active</option>
            <option value="past_due">Past due</option>
            <option value="suspended">Suspended</option>
            <option value="expired">Expired</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <select
            name="package"
            defaultValue={sp.package ?? ""}
            className="text-sm border rounded-md px-2 bg-background"
          >
            <option value="">All packages</option>
            <option value="starter">Starter</option>
            <option value="growth">Growth</option>
            <option value="professional">Professional</option>
            <option value="premium">Premium</option>
            <option value="custom">Custom</option>
          </select>
          <button className="rounded-md border px-3 text-sm">Apply</button>
        </div>

        {data.rows.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            <Activity className="size-8 mx-auto text-muted-foreground/50" />
            <div className="mt-2">No subscriptions match the filter.</div>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground border-b">
              <tr>
                <th className="text-left px-4 py-2 font-medium">MFD</th>
                <th className="text-left py-2 font-medium">Package</th>
                <th className="text-left py-2 font-medium">Status</th>
                <th className="text-left py-2 font-medium">Cycle</th>
                <th className="text-left py-2 font-medium">Started</th>
                <th className="text-left py-2 font-medium pl-3">Renews</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.id} className="border-b last:border-0 hover:bg-accent/40">
                  <td className="px-4 py-3">
                    <Link href={`/super-admin/tenants/${r.tenant_id}`} className="font-medium hover:underline">
                      {r.legal_name}
                    </Link>
                    <div className="text-xs text-muted-foreground font-mono">{r.arn}</div>
                  </td>
                  <td className="py-3 text-xs uppercase text-muted-foreground">{r.package_key}</td>
                  <td className="py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[r.status] ?? ""}`}>
                      {r.status}
                    </span>
                    {r.suspended_reason && (
                      <div className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{r.suspended_reason}</div>
                    )}
                  </td>
                  <td className="py-3 text-xs">{r.billing_cycle ?? "—"}</td>
                  <td className="py-3 text-xs text-muted-foreground">
                    {r.license_start_at ? formatDate(r.license_start_at) : "—"}
                  </td>
                  <td className="py-3 pl-3 text-xs text-muted-foreground">
                    {r.next_renewal_at
                      ? formatRelative(r.next_renewal_at)
                      : r.trial_ends_at
                      ? `trial ends ${formatRelative(r.trial_ends_at)}`
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/super-admin/tenants/${r.tenant_id}`}
                      className="text-xs text-muted-foreground hover:underline"
                    >
                      Manage →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </form>
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
