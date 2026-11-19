import { sql } from "drizzle-orm";
import { Wallet } from "lucide-react";
import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { EmptyState } from "@/components/common/EmptyState";
import { PayrollTabs } from "@/components/payroll/PayrollShared";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { canManagePayroll, canViewPayroll } from "@/lib/payroll/access";
import type { IncentiveSlab, MeasureKey } from "@/lib/payroll/incentive-rules";
import { IncentivesClient, type PlanRow, type StatementRow } from "./IncentivesClient";

export const dynamic = "force-dynamic";

/** Payroll → Incentives: plans on CRM figures, statements per person, approval into the pay run. */
export default async function PayrollIncentivesPage() {
  const session = await requireSession();
  if (!canViewPayroll(session)) {
    return <div className="mt-6"><EmptyState icon={Wallet} title="Payroll is kept by the owner" description="Your own payslips are in My pay." primary={{ href: "/dashboard/my-pay", label: "Open My pay" }} /></div>;
  }
  const data = await withTenant(session.tenantId, async (tx) => {
    const plans = (await tx.execute(sql`
      SELECT id::text, name, measure, period_kind, slab_on, payout, slabs, cap::float AS cap, roles, user_ids::text[] AS user_ids, active
        FROM incentive_plans WHERE tenant_id = ${session.tenantId}::uuid ORDER BY active DESC, name`)).rows as Array<{
      id: string; name: string; measure: string; period_kind: string; slab_on: string; payout: PlanRow["payout"];
      slabs: IncentiveSlab[] | null; cap: number | null; roles: string[] | null; user_ids: string[] | null; active: boolean;
    }>;
    const statements = (await tx.execute(sql`
      SELECT s.id::text, s.user_id::text AS user_id, u.name, p.name AS plan, s.period_start::text AS ps, s.period_end::text AS pe,
             s.measure_value::float AS value, s.target_value::float AS target, s.achievement_pct::float AS pct, s.amount::float AS amount,
             s.working, s.status, r.period::text AS run_period, r.status AS run_status, p.measure
        FROM incentive_statements s
        JOIN incentive_plans p ON p.id = s.plan_id
        JOIN users u ON u.id = s.user_id
        LEFT JOIN pay_runs r ON r.id = s.pay_run_id
       WHERE s.tenant_id = ${session.tenantId}::uuid
       ORDER BY s.period_start DESC, (s.status = 'calculated') DESC, u.name
       LIMIT 300`)).rows as Array<{
      id: string; user_id: string; name: string; plan: string; ps: string; pe: string; value: number | null; target: number | null;
      pct: number | null; amount: number; working: { summary?: string; decisionNote?: string } | null; status: string;
      run_period: string | null; run_status: string | null; measure: string;
    }>;
    const staff = (await tx.execute(sql`
      SELECT id::text AS id, name FROM users
       WHERE tenant_id = ${session.tenantId}::uuid AND deleted_at IS NULL AND status IN ('active', 'offboarding')
         AND NOT (roles && ARRAY['platform_admin', 'platform_support', 'investor']::text[])
       ORDER BY name`)).rows as Array<{ id: string; name: string }>;
    return { plans, statements, staff };
  });
  const plans: PlanRow[] = data.plans.map((p) => ({
    id: p.id,
    name: p.name,
    measure: p.measure as MeasureKey,
    periodKind: p.period_kind === "month" ? "month" : "quarter",
    slabOn: p.slab_on === "value" ? "value" : "achievement",
    payout: p.payout,
    slabs: (p.slabs ?? []) as IncentiveSlab[],
    cap: p.cap ?? null,
    roles: p.roles ?? [],
    userIds: p.user_ids ?? [],
    active: !!p.active,
  }));
  const statements: StatementRow[] = data.statements.map((s) => ({
    id: s.id,
    name: s.name,
    self: s.user_id === session.userId,
    plan: s.plan,
    measure: s.measure as MeasureKey,
    periodStart: s.ps,
    periodEnd: s.pe,
    value: s.value,
    target: s.target,
    pct: s.pct,
    amount: Number(s.amount),
    summary: s.working?.summary ?? "",
    note: s.working?.decisionNote ?? null,
    status: s.status,
    inRun: s.run_period && s.run_status !== "draft" ? String(s.run_period) : null,
  }));
  return (
    <div className="space-y-5">
      <PageHeaderCard title="Payroll" />
      <PayrollTabs active="incentives" />
      <IncentivesClient plans={plans} statements={statements} staff={data.staff} canManage={canManagePayroll(session)} />
    </div>
  );
}
