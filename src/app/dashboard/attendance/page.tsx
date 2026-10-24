import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import Link from "next/link";
import { sql } from "drizzle-orm";
import { CalendarCheck, CheckCircle2, XCircle, CalendarOff, Grid3x3, CalendarDays, Settings, ClipboardCheck, ChevronLeft, ChevronRight } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { dateRangeCond } from "@/lib/filters/date-range";
import { ClockWidget } from "@/components/attendance/ClockWidget";
import { AttendanceTable } from "@/components/attendance/AttendanceTable";
import { AttendanceToolbar } from "@/components/attendance/AttendanceToolbar";
import { ATTENDANCE_STATUS_LABELS, computeAttendanceFlags } from "@/lib/attendance/policy";
import { loadAttendancePolicy } from "@/lib/attendance/settings";
import { ExportButton } from "@/components/export/ExportButton";

const PAGE_SIZE = 50;

/** India wall clock: today's date (yyyy-mm-dd) and the time (HH:MM). */
function indiaNow(now = new Date()) {
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
  return { date, time };
}

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
  const page = Math.max(1, Number(sp.page) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const ist = indiaNow();

  const data = await withTenant(session.tenantId, async (tx) => {
    const policy = await loadAttendancePolicy(tx, session.tenantId);
    // Owners are left out unless the firm tracks them (Attendance settings).
    const ownerOut = policy.trackOwners ? sql`TRUE` : sql`NOT ('owner' = ANY(COALESCE(u.roles, ARRAY[]::text[])))`;
    const conds: any[] = [sql`a.tenant_id = ${session.tenantId}::uuid`, ownerOut];
    if (q) conds.push(sql`u.name ILIKE ${`%${q}%`}`);
    if (statusFilter.length) conds.push(sql`a.status IN (${sql.join(statusFilter.map((v) => sql`${v}`), sql`, `)})`);
    const dr = dateRangeCond(sp, "date", "a.attendance_date");
    if (todayOnly) conds.push(sql`a.attendance_date = current_date`);
    else if (dr) conds.push(dr);
    else conds.push(sql`a.attendance_date >= current_date - interval '30 days'`);
    const whereSql = sql`WHERE ${sql.join(conds, sql` AND `)}`;

    const totalRow = await tx.execute(sql`
      SELECT COUNT(*)::int AS total
      FROM attendance a LEFT JOIN users u ON u.id = a.employee_user_id
      ${whereSql}
    `);
    const total = Number((totalRow.rows[0] as any)?.total ?? 0);

    const rowsRes = await tx.execute(sql`
      SELECT a.id, a.employee_user_id, a.attendance_date, a.status, a.clock_in_at, a.clock_out_at,
             a.total_minutes, a.note, a.source, u.name AS employee_name, u.avatar_url AS employee_avatar_url
      FROM attendance a LEFT JOIN users u ON u.id = a.employee_user_id
      ${whereSql}
      ORDER BY a.attendance_date DESC, u.name ASC
      LIMIT ${PAGE_SIZE} OFFSET ${offset}
    `);
    // The daily seed marks everyone "absent" until they clock in. Before the
    // working day ends that is "Not clocked in", not an absence.
    const dayOver = ist.time >= policy.workEnd;
    // Flag late-in / early-out per row from the tenant's work-hours policy.
    const rows = (rowsRes.rows as any[]).map((r) => {
      const f = computeAttendanceFlags(String(r.attendance_date), r.clock_in_at, r.clock_out_at, policy);
      const day = String(r.attendance_date).slice(0, 10);
      return {
        ...r,
        is_late: f.isLate,
        late_minutes: f.lateMinutes,
        is_early_out: f.isEarlyOut,
        early_minutes: f.earlyMinutes,
        pending: !dayOver && day === ist.date && r.status === "absent" && r.source === "auto" && !r.clock_in_at,
      };
    });

    // Every clock-in / clock-out behind the rows on this page (attendance_punches).
    const ids = rows.map((r) => r.id);
    const punchRows = ids.length
      ? ((await tx.execute(sql`
          SELECT a.id AS attendance_id, p.kind, p.at
          FROM attendance a
          JOIN attendance_punches p ON p.tenant_id = a.tenant_id AND p.employee_user_id = a.employee_user_id
                                   AND p.attendance_date = a.attendance_date
          WHERE a.tenant_id = ${session.tenantId}::uuid AND a.id IN (${sql.join(ids.map((x) => sql`${x}::uuid`), sql`, `)})
          ORDER BY p.at
        `)).rows as Array<{ attendance_id: string; kind: "in" | "out"; at: string }>)
      : [];
    const punchesOf = new Map<string, Array<{ kind: "in" | "out"; at: string }>>();
    for (const pr of punchRows) {
      const list = punchesOf.get(pr.attendance_id) ?? [];
      list.push({ kind: pr.kind, at: pr.at });
      punchesOf.set(pr.attendance_id, list);
    }
    const rowsWithPunches = rows.map((r) => ({ ...r, punches: punchesOf.get(r.id) ?? [] }));

    const stats = await tx.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE a.attendance_date = ${ist.date}::date AND a.status = 'present')::int AS present_today,
        COUNT(*) FILTER (WHERE a.attendance_date = ${ist.date}::date AND a.status = 'absent')::int AS absent_today,
        COUNT(*) FILTER (WHERE a.attendance_date = ${ist.date}::date AND a.status = 'absent'
                           AND a.source = 'auto' AND a.clock_in_at IS NULL)::int AS not_clocked_in,
        COUNT(*) FILTER (WHERE a.attendance_date = ${ist.date}::date AND a.status = 'on_leave')::int AS on_leave_today,
        (SELECT COUNT(*)::int FROM users u WHERE u.tenant_id = ${session.tenantId}::uuid AND u.status = 'active' AND ${ownerOut}) AS active_employees
      FROM attendance a LEFT JOIN users u ON u.id = a.employee_user_id
      WHERE a.tenant_id = ${session.tenantId}::uuid AND ${ownerOut}
    `);

    const myToday = await tx.execute(sql`
      SELECT clock_in_at, clock_out_at, total_minutes, status FROM attendance
      WHERE tenant_id = ${session.tenantId}::uuid AND employee_user_id = ${session.userId}::uuid AND attendance_date = current_date
      LIMIT 1
    `);
    const myPunches = (await tx.execute(sql`
      SELECT kind, at FROM attendance_punches
      WHERE tenant_id = ${session.tenantId}::uuid AND employee_user_id = ${session.userId}::uuid AND attendance_date = current_date
      ORDER BY at, created_at
    `)).rows as Array<{ kind: "in" | "out"; at: string }>;

    return {
      rows: rowsWithPunches,
      total,
      stats: stats.rows[0] as any,
      myToday: myToday.rows[0] ? { ...(myToday.rows[0] as any), punches: myPunches } : null,
      dayOver,
      workEnd: policy.workEnd,
    };
  });

  const s = data.stats;
  const pageCount = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
  const pageHref = (p: number) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (v && k !== "page") params.set(k, v);
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return qs ? `/dashboard/attendance?${qs}` : "/dashboard/attendance";
  };

  return (
    <div className="space-y-6 max-w-7xl">
      <PageHeaderCard title={<><CalendarCheck className="size-6 text-muted-foreground" /> Attendance</>} actions={<><div className="flex items-center gap-1.5 flex-wrap">
          <Link href="/dashboard/attendance/regularizations" className="btn-secondary text-xs">
            <ClipboardCheck className="size-3.5" /> Corrections
          </Link>
          <Link href="/dashboard/attendance/holidays" className="btn-secondary text-xs">
            <CalendarDays className="size-3.5" /> Holidays
          </Link>
          {canManage && (
            <Link href="/dashboard/attendance/settings" className="btn-secondary text-xs">
              <Settings className="size-3.5" /> Settings
            </Link>
          )}
          {/* The grid is every employee's month -- a manager's view, like Settings. */}
          {canManage && (
            <Link href="/dashboard/attendance/grid" className="btn-secondary text-xs">
              <Grid3x3 className="size-3.5" /> Monthly grid
            </Link>
          )}
          <ExportButton module="attendance" />
        </div></>} />

      {/* The people the Daily Job Tracker is for (the same audience as the
          morning briefing) land on it after their first clock-in. */}
      <ClockWidget
        today={data.myToday}
        planAfterClockIn={session.roles.some((r) => ["owner", "branch_head", "rm"].includes(r))}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat icon={CheckCircle2} label="Present today" value={`${s.present_today ?? 0} / ${s.active_employees ?? 0}`} tone="emerald" />
        {data.dayOver ? (
          <Stat icon={XCircle} label="Absent today" value={s.absent_today ?? 0} tone={s.absent_today > 0 ? "rose" : "muted"} />
        ) : (
          // Before the day ends nobody is absent yet — just not clocked in.
          <Stat icon={XCircle} label={`Not clocked in (day ends ${data.workEnd})`} value={s.not_clocked_in ?? 0} tone="muted" />
        )}
        <Stat icon={CalendarOff} label="On leave today" value={s.on_leave_today ?? 0} tone={s.on_leave_today > 0 ? "amber" : "muted"} />
        <Stat icon={CalendarCheck} label="Active employees" value={s.active_employees ?? 0} />
      </div>

      <AttendanceTable
        rows={data.rows}
        canManage={canManage}
        toolbar={
          <AttendanceToolbar
            statusOptions={Object.entries(ATTENDANCE_STATUS_LABELS).map(([value, label]) => ({ value, label }))}
          />
        }
      />

      {pageCount > 1 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            Page {page} of {pageCount} · {data.total} record{data.total === 1 ? "" : "s"}
          </span>
          <div className="flex items-center gap-1.5">
            {page > 1 ? (
              <Link href={pageHref(page - 1)} className="btn-secondary text-xs"><ChevronLeft className="size-3.5" /> Prev</Link>
            ) : (
              <span className="btn-secondary text-xs opacity-40 pointer-events-none"><ChevronLeft className="size-3.5" /> Prev</span>
            )}
            {page < pageCount ? (
              <Link href={pageHref(page + 1)} className="btn-secondary text-xs">Next <ChevronRight className="size-3.5" /></Link>
            ) : (
              <span className="btn-secondary text-xs opacity-40 pointer-events-none">Next <ChevronRight className="size-3.5" /></span>
            )}
          </div>
        </div>
      )}
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
