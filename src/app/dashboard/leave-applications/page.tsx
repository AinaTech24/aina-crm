import Link from "next/link";
import { sql } from "drizzle-orm";
import { Plus, CalendarOff, Clock, CheckCircle2, CalendarDays } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { FilterBar } from "@/components/common/FilterBar";
import { CustomViews } from "@/components/common/CustomViews";
import { LeaveTable } from "@/components/leave/LeaveTable";
import { LEAVE_TYPE_LABELS } from "@/lib/leave/policy";

export const dynamic = "force-dynamic";

export default async function LeaveApplicationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const statusFilter = (sp.status ?? "").split(",").filter(Boolean);
  const typeFilter = (sp.type ?? "").split(",").filter(Boolean);
  const mine = sp.mine === "1";
  const canApprove = session.roles.some((r) => ["owner", "branch_head"].includes(r));

  const data = await withTenant(session.tenantId, async (tx) => {
    const conds: any[] = [sql`la.tenant_id = ${session.tenantId}::uuid`];
    if (q) conds.push(sql`u.name ILIKE ${`%${q}%`}`);
    if (statusFilter.length) conds.push(sql`la.status IN (${sql.join(statusFilter.map((v) => sql`${v}`), sql`, `)})`);
    if (typeFilter.length) conds.push(sql`la.leave_type IN (${sql.join(typeFilter.map((v) => sql`${v}`), sql`, `)})`);
    if (mine) conds.push(sql`la.employee_user_id = ${session.userId}::uuid`);
    const whereSql = sql`WHERE ${sql.join(conds, sql` AND `)}`;

    const rows = await tx.execute(sql`
      SELECT la.id, la.employee_user_id, la.leave_type, la.duration, la.from_date, la.to_date,
             la.no_of_days, la.status, la.reason, la.created_at,
             u.name AS employee_name, a.name AS approver_name
      FROM leave_applications la
      LEFT JOIN users u ON u.id = la.employee_user_id
      LEFT JOIN users a ON a.id = la.approver_user_id
      ${whereSql}
      ORDER BY (la.status = 'requested') DESC, la.from_date DESC
      LIMIT 300
    `);

    const stats = await tx.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'requested')::int AS pending,
        COUNT(*) FILTER (WHERE status = 'approved' AND current_date BETWEEN from_date AND to_date)::int AS on_leave_today,
        COUNT(*) FILTER (WHERE status = 'approved' AND from_date > current_date)::int AS upcoming,
        COUNT(*) FILTER (WHERE status = 'approved' AND decided_at >= date_trunc('month', now()))::int AS approved_mtd
      FROM leave_applications
      WHERE tenant_id = ${session.tenantId}::uuid
    `);
    return { rows: rows.rows as any[], stats: stats.rows[0] as any };
  });

  const s = data.stats;

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <CalendarOff className="size-6 text-brand-cyan" /> Leave Applications
          </h1>
          <p className="text-muted-foreground text-sm">
            Team leave requests · approval workflow · balances · coverage planning.
          </p>
        </div>
        <Link href="/dashboard/leave-applications/new" className="btn-primary">
          <Plus className="size-4" /> New request
        </Link>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat icon={Clock} label="Pending approval" value={s.pending ?? 0} tone={s.pending > 0 ? "amber" : "muted"} />
        <Stat icon={CalendarOff} label="On leave today" value={s.on_leave_today ?? 0} tone={s.on_leave_today > 0 ? "rose" : "muted"} />
        <Stat icon={CalendarDays} label="Upcoming (approved)" value={s.upcoming ?? 0} />
        <Stat icon={CheckCircle2} label="Approved (MTD)" value={s.approved_mtd ?? 0} tone="emerald" />
      </div>

      <FilterBar
        totalCount={data.rows.length}
        filters={[
          { type: "search", key: "q", placeholder: "Search by employee name…" },
          {
            type: "multi",
            key: "status",
            label: "Status",
            options: [
              { value: "requested", label: "Requested" },
              { value: "approved", label: "Approved" },
              { value: "rejected", label: "Rejected" },
              { value: "cancelled", label: "Cancelled" },
            ],
          },
          {
            type: "multi",
            key: "type",
            label: "Leave type",
            options: Object.entries(LEAVE_TYPE_LABELS).map(([value, label]) => ({ value, label })),
          },
          { type: "select", key: "mine", label: "Mine", options: [{ value: "1", label: "My requests" }] },
        ]}
        rightSlot={
          <CustomViews
            viewsKey="views:leave-applications"
            presets={[
              { id: "pending", name: "Pending approval", params: "status=requested" },
              { id: "mine", name: "My requests", params: "mine=1" },
              { id: "approved", name: "Approved", params: "status=approved" },
            ]}
          />
        }
      />

      <LeaveTable rows={data.rows} canApprove={canApprove} currentUserId={session.userId} />
    </div>
  );
}

function Stat({ icon: Icon, label, value, tone }: { icon: any; label: string; value: number; tone?: "rose" | "amber" | "emerald" | "muted" }) {
  const color = tone === "rose" ? "text-rose-600" : tone === "amber" ? "text-amber-600" : tone === "emerald" ? "text-emerald-600" : "text-foreground";
  return (
    <div className="card-surface p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        <Icon className="size-3.5 text-muted-foreground" />
      </div>
      <div className={`text-2xl font-bold mt-1 tabular-nums ${color}`}>{value}</div>
    </div>
  );
}
