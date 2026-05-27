import Link from "next/link";
import { sql } from "drizzle-orm";
import { Plus, Building2 } from "lucide-react";
import { withPlatformAdmin } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { formatRelative } from "@/lib/utils";

const STATUS_COLORS: Record<string, string> = {
  trial: "bg-blue-50 text-blue-700",
  active: "bg-emerald-50 text-emerald-700",
  past_due: "bg-amber-50 text-amber-700",
  suspended: "bg-rose-50 text-rose-700",
  expired: "bg-rose-50 text-rose-700",
  cancelled: "bg-gray-50 text-gray-700",
};

export const dynamic = "force-dynamic";

export default async function TenantsListPage() {
  const session = await requireSession();
  const rows = await withPlatformAdmin(session.userId, async (tx) => {
    return tx.execute(sql`
      SELECT t.id, t.legal_name, t.arn, t.created_at, t.email, t.phone,
             s.status AS sub_status, s.package_key, s.trial_ends_at, s.next_renewal_at,
             (SELECT COUNT(*)::int FROM users u WHERE u.tenant_id = t.id) AS user_count,
             (SELECT COUNT(*)::int FROM investors i WHERE i.tenant_id = t.id) AS investor_count
      FROM tenants t
      LEFT JOIN subscriptions s ON s.tenant_id = t.id
      ORDER BY t.created_at DESC
    `);
  });

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">MFD tenants</h1>
          <p className="text-muted-foreground text-sm">
            {rows.rows.length} MFD organisation{rows.rows.length === 1 ? "" : "s"} on the platform.
          </p>
        </div>
        <Link
          href="/super-admin/tenants/new"
          className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium flex items-center gap-1.5"
        >
          <Plus className="size-4" /> Create MFD tenant
        </Link>
      </div>

      <div className="border rounded-lg bg-card">
        {rows.rows.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            <Building2 className="size-8 mx-auto text-muted-foreground/50" />
            <div className="mt-2">No tenants yet.</div>
            <Link href="/super-admin/tenants/new" className="text-primary hover:underline mt-2 inline-block">
              Create the first MFD tenant →
            </Link>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground border-b">
              <tr>
                <th className="text-left px-4 py-2 font-medium">MFD</th>
                <th className="text-left py-2 font-medium">ARN</th>
                <th className="text-left py-2 font-medium">Package</th>
                <th className="text-left py-2 font-medium">Status</th>
                <th className="text-right py-2 font-medium">Users</th>
                <th className="text-right py-2 font-medium">Investors</th>
                <th className="text-left py-2 font-medium pl-3">Renewal</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {(rows.rows as any[]).map((t) => (
                <tr key={t.id} className="border-b last:border-0 hover:bg-accent/40">
                  <td className="px-4 py-3">
                    <Link href={`/super-admin/tenants/${t.id}`} className="font-medium hover:underline">
                      {t.legal_name}
                    </Link>
                    <div className="text-xs text-muted-foreground">{t.email}</div>
                  </td>
                  <td className="py-3 font-mono text-xs">{t.arn}</td>
                  <td className="py-3 text-xs uppercase text-muted-foreground">{t.package_key ?? "—"}</td>
                  <td className="py-3">
                    {t.sub_status && (
                      <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[t.sub_status] ?? ""}`}>
                        {t.sub_status}
                      </span>
                    )}
                  </td>
                  <td className="py-3 text-right tabular-nums">{t.user_count}</td>
                  <td className="py-3 text-right tabular-nums">{t.investor_count}</td>
                  <td className="py-3 pl-3 text-xs text-muted-foreground">
                    {t.next_renewal_at
                      ? formatRelative(t.next_renewal_at)
                      : t.trial_ends_at
                      ? `trial ends ${formatRelative(t.trial_ends_at)}`
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/super-admin/tenants/${t.id}`}
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
      </div>
    </div>
  );
}
