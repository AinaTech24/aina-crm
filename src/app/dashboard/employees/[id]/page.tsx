import Link from "next/link";
import { notFound } from "next/navigation";
import { eq, sql } from "drizzle-orm";
import { ChevronLeft, UserCog, Briefcase, Users, IndianRupee, CheckCircle2, AlertTriangle, Calendar } from "lucide-react";
import { withTenant } from "@/db/client";
import { users } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { formatINR, formatDate } from "@/lib/utils";
import { EmployeeEditForm } from "@/components/employees/EmployeeEditForm";

export const dynamic = "force-dynamic";

export default async function EmployeeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;

  const data = await withTenant(session.tenantId, async (tx) => {
    const [emp] = await tx.select().from(users).where(eq(users.id, id));
    if (!emp) return null;

    // All teammates for the "reporting manager" picker
    const teammates = await tx
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .orderBy(users.name);

    const stats = await tx.execute(sql`
      SELECT
        (SELECT COUNT(*)::int FROM investors WHERE rm_id = ${id}::uuid AND status = 'active') AS active_clients,
        (SELECT COALESCE(SUM(aum::numeric),0)::numeric FROM investors WHERE rm_id = ${id}::uuid AND status = 'active') AS my_aum,
        (SELECT COALESCE(SUM(active_sip_amount::numeric),0)::numeric FROM investors WHERE rm_id = ${id}::uuid AND status = 'active') AS my_sip,
        (SELECT COUNT(*)::int FROM tasks WHERE assignee_id = ${id}::uuid AND status IN ('open','in_progress')) AS open_tasks,
        (SELECT COUNT(*)::int FROM tasks WHERE assignee_id = ${id}::uuid AND status IN ('open','in_progress') AND due_at < now()) AS overdue_tasks,
        (SELECT COUNT(*)::int FROM review_meetings WHERE rm_id = ${id}::uuid AND status IN ('scheduled','confirmed') AND meeting_date >= now()) AS upcoming_meetings
    `);

    // Resolve manager name (if any)
    const managerId = (emp as any).reportingManagerId as string | null;
    let manager: { id: string; name: string } | null = null;
    if (managerId) {
      const [m] = await tx
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(eq(users.id, managerId));
      manager = m ?? null;
    }
    return { emp, teammates, stats: stats.rows[0] as any, manager };
  });
  if (!data) notFound();
  const { emp, teammates, stats, manager } = data;

  return (
    <div className="space-y-6 max-w-5xl">
      <Link href="/dashboard/employees" className="text-xs text-muted-foreground hover:underline inline-flex items-center gap-1">
        <ChevronLeft className="size-3" /> Back to employees
      </Link>

      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">
            <UserCog className="size-6 text-brand-cyan" /> {emp.name}
          </h1>
          <p className="page-subtitle">
            {emp.email}
            {emp.phone ? <> · {emp.phone}</> : null}
            {manager ? <> · Reports to <strong>{manager.name}</strong></> : null}
          </p>
        </div>
        <span
          className={`chip ${
            emp.status === "active"
              ? "bg-emerald-50 text-emerald-700"
              : emp.status === "suspended"
                ? "bg-rose-50 text-rose-700"
                : "bg-secondary"
          }`}
        >
          {emp.status}
        </span>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
        <Tile icon={Users} label="Active clients" value={String(stats.active_clients ?? 0)} />
        <Tile icon={IndianRupee} label="AUM" value={Number(stats.my_aum ?? 0) > 0 ? formatINR(Number(stats.my_aum)) : "—"} accent="emerald" />
        <Tile icon={IndianRupee} label="Active SIP" value={Number(stats.my_sip ?? 0) > 0 ? formatINR(Number(stats.my_sip)) : "—"} accent="emerald" />
        <Tile icon={CheckCircle2} label="Open tasks" value={String(stats.open_tasks ?? 0)} />
        <Tile icon={AlertTriangle} label="Overdue" value={String(stats.overdue_tasks ?? 0)} accent={Number(stats.overdue_tasks) > 0 ? "rose" : "muted"} />
        <Tile icon={Calendar} label="Upcoming meetings" value={String(stats.upcoming_meetings ?? 0)} />
      </div>

      {/* Quick HR summary */}
      <div className="grid grid-cols-2 gap-3">
        <SummaryRow icon={Briefcase} label="Department" value={emp.department ? cap(emp.department.replace(/_/g, " ")) : "—"} />
        <SummaryRow icon={Calendar} label="Joining date" value={emp.joiningDate ? formatDate(emp.joiningDate) : "—"} />
        <SummaryRow
          icon={IndianRupee}
          label="Annual target"
          value={(emp as any).annualTarget ? formatINR(Number((emp as any).annualTarget)) : "—"}
        />
        <SummaryRow
          icon={IndianRupee}
          label="Monthly SIP target"
          value={(emp as any).sipMonthlyTarget ? formatINR(Number((emp as any).sipMonthlyTarget)) : "—"}
        />
      </div>

      {/* Edit form */}
      <EmployeeEditForm
        employee={{
          id: emp.id,
          name: emp.name,
          email: emp.email,
          phone: emp.phone ?? "",
          roles: (emp.roles as string[]) ?? [],
          department: (emp as any).department ?? null,
          joiningDate: (emp as any).joiningDate ?? null,
          reportingManagerId: (emp as any).reportingManagerId ?? null,
          annualTarget: (emp as any).annualTarget ? Number((emp as any).annualTarget) : null,
          sipMonthlyTarget: (emp as any).sipMonthlyTarget ? Number((emp as any).sipMonthlyTarget) : null,
          notes: (emp as any).notes ?? "",
          euin: emp.euin ?? "",
          nismCertificateNo: emp.nismCertificateNo ?? "",
          nismExpiryAt: emp.nismExpiryAt ?? null,
          status: emp.status,
        }}
        teammates={teammates.filter((t) => t.id !== id)}
      />
    </div>
  );
}

function Tile({ icon: Icon, label, value, accent }: { icon: any; label: string; value: string; accent?: "emerald" | "rose" | "muted" }) {
  const color = accent === "emerald" ? "text-emerald-600" : accent === "rose" ? "text-rose-600" : "text-foreground";
  return (
    <div className="card-surface p-3">
      <div className="flex items-center justify-between text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
        <span>{label}</span>
        <Icon className="size-3 text-muted-foreground" />
      </div>
      <div className={`text-xl font-bold mt-1 tabular-nums ${color}`}>{value}</div>
    </div>
  );
}

function SummaryRow({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="card-surface p-3 flex items-center gap-3">
      <Icon className="size-4 text-brand-cyan" />
      <div>
        <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">{label}</div>
        <div className="text-sm font-medium">{value}</div>
      </div>
    </div>
  );
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
