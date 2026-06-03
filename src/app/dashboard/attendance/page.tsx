import Link from "next/link";
import { sql } from "drizzle-orm";
import { CalendarCheck, CheckCircle2, XCircle, CalendarOff, Grid3x3 } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { FilterBar } from "@/components/common/FilterBar";
import { CustomViews } from "@/components/common/CustomViews";
import { ClockWidget } from "@/components/attendance/ClockWidget";
import { AttendanceTable } from "@/components/attendance/AttendanceTable";
import { ATTENDANCE_STATUS_LABELS } from "@/lib/attendance/policy";

export const dynamic = "force-dynamic";

export default async function AttendancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const statusFilter = (sp.status ?? "").split(",").filter(Boolean);
  const todayOnly = sp.today === "1";
  const canManage = session.roles.some((r) => ["owner", "branch_head"].includes(r));

  const data = await withTenant(session.tenantId, async (tx) => {
    const conds: any[] = [sql`a.tenant_id = ${session.tenantId}::uuid`];
    if (q) conds.push(sql`u.name ILIKE ${`%${q}%`}`);
    if (statusFilter.length) conds.push(sql`a.status IN (${sql.join(statusFilter.map((v) => sql`${v}`), sql`, `)})`);
    if (todayOnly) conds.push(sql`a.attendance_date = current_date`);
    else conds.push(sql`a.attendance_date >= current_date - interval '30 days'`);
    const whereSql = sql`WHERE ${sql.join(conds, sql` AND `)}`;

    const rows = await tx.execute(sql`
      SELECT a.id, a.employee_user_id, a.attendance_date, a.status, a.clock_in_at, a.clock_out_at,
             a.total_minutes, a.note, u.name AS employee_name
      FROM attendance a LEFT JOIN users u ON u.id = a.employee_user_id
      ${whereSql}
      ORDER BY a.attendance_date DESC, u.name ASC
      LIMIT 300
    `);

    const stats = await tx.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE attendance_date = current_date AND status = 'present')::int AS present_today,
        COUNT(*) FILTER (WHERE attendance_date = current_date AND status = 'absent')::int AS absent_today,
        COUNT(*) FILTER (WHERE attendance_date = current_date AND status = 'on_leave')::int AS on_leave_today,
        (SELECT COUNT(*)::int FROM users WHERE tenant_id = ${session.tenantId}::uuid AND status = 'active') AS active_employees
      FROM attendance WHERE tenant_id = ${session.tenantId}::uuid
    `);

    const myToday = await tx.execute(sql`
      SELECT clock_in_at, clock_out_at, total_minutes, status FROM attendance
      WHERE tenant_id = ${session.tenantId}::uuid AND employee_user_id = ${session.userId}::uuid AND attendance_date = current_date
      LIMIT 1
    `);

    return { rows: rows.rows as any[], stats: stats.rows[0] as any, myToday: (myToday.rows[0] as any) ?? null };
  });

  const s = data.stats;

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <CalendarCheck className="size-6 text-brand-cyan" /> Attendance
          </h1>
          <p className="text-muted-foreground text-sm">Daily team attendance · clock in/out · worked hours.</p>
        </div>
        <Link href="/dashboard/attendance/grid" className="btn-secondary text-xs">
          <Grid3x3 className="size-3.5" /> Monthly grid
        </Link>
      </div>

      <ClockWidget today={data.myToday} />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat icon={CheckCircle2} label="Present today" value={`${s.present_today ?? 0} / ${s.active_employees ?? 0}`} tone="emerald" />
        <Stat icon={XCircle} label="Absent today" value={s.absent_today ?? 0} tone={s.absent_today > 0 ? "rose" : "muted"} />
        <Stat icon={CalendarOff} label="On leave today" value={s.on_leave_today ?? 0} tone={s.on_leave_today > 0 ? "amber" : "muted"} />
        <Stat icon={CalendarCheck} label="Active employees" value={s.active_employees ?? 0} />
      </div>

      <FilterBar
        totalCount={data.rows.length}
        filters={[
          { type: "search", key: "q", placeholder: "Search by employee name…" },
          {
            type: "multi",
            key: "status",
            label: "Status",
            options: Object.entries(ATTENDANCE_STATUS_LABELS).map(([value, label]) => ({ value, label })),
          },
          { type: "select", key: "today", label: "Day", options: [{ value: "1", label: "Today only" }] },
        ]}
        rightSlot={
          <CustomViews
            viewsKey="views:attendance"
            presets={[
              { id: "today", name: "Today", params: "today=1" },
              { id: "absent", name: "Absent", params: "status=absent" },
              { id: "on_leave", name: "On leave", params: "status=on_leave" },
            ]}
          />
        }
      />

      <AttendanceTable rows={data.rows} canManage={canManage} />
    </div>
  );
}

function Stat({ icon: Icon, label, value, tone }: { icon: any; label: string; value: number | string; tone?: "rose" | "amber" | "emerald" | "muted" }) {
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
