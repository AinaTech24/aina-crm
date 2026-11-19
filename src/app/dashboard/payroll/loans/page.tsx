import { sql } from "drizzle-orm";
import { Wallet } from "lucide-react";
import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { EmptyState } from "@/components/common/EmptyState";
import { PayrollTabs } from "@/components/payroll/PayrollShared";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { canManagePayroll, canViewPayroll } from "@/lib/payroll/access";
import { LoansClient, type LoanRow } from "./LoansClient";

export const dynamic = "force-dynamic";

/** Payroll → Loans: salary loans and advances, recovered by EMI through the pay run. */
export default async function PayrollLoansPage() {
  const session = await requireSession();
  if (!canViewPayroll(session)) {
    return <div className="mt-6"><EmptyState icon={Wallet} title="Payroll is kept by the owner" description="Your own payslips are in My pay." primary={{ href: "/dashboard/my-pay", label: "Open My pay" }} /></div>;
  }
  const data = await withTenant(session.tenantId, async (tx) => {
    const loans = (await tx.execute(sql`
      SELECT l.id::text AS id, l.user_id::text AS user_id, u.name, l.kind, l.principal::float AS principal, l.emi::float AS emi,
             l.start_period::text AS start, l.status, l.note,
             COALESCE((
               SELECT SUM((x->>'amount')::numeric)
                 FROM pay_run_items i JOIN pay_runs r ON r.id = i.pay_run_id,
                      jsonb_array_elements(COALESCE(i.result->'links'->'loans', '[]'::jsonb)) x
                WHERE i.tenant_id = l.tenant_id AND i.user_id = l.user_id AND r.status IN ('approved', 'paid')
                  AND i.on_hold = false AND x->>'id' = l.id::text
             ), 0)::float AS recovered
        FROM payroll_loans l JOIN users u ON u.id = l.user_id
       WHERE l.tenant_id = ${session.tenantId}::uuid
       ORDER BY (l.status = 'active') DESC, l.created_at DESC
       LIMIT 300`)).rows as Array<Record<string, unknown>>;
    const staff = (await tx.execute(sql`
      SELECT id::text AS id, name FROM users
       WHERE tenant_id = ${session.tenantId}::uuid AND deleted_at IS NULL AND status IN ('active', 'offboarding')
         AND NOT (roles && ARRAY['platform_admin', 'platform_support', 'investor']::text[])
       ORDER BY name`)).rows as Array<{ id: string; name: string }>;
    return { loans, staff };
  });
  const rows: LoanRow[] = data.loans.map((l) => ({
    id: String(l.id),
    name: String(l.name),
    kind: l.kind === "advance" ? "advance" : "loan",
    principal: Number(l.principal),
    emi: Number(l.emi),
    start: String(l.start),
    status: String(l.status),
    note: (l.note as string) ?? null,
    recovered: Number(l.recovered),
  }));
  return (
    <div className="space-y-5">
      <PageHeaderCard title="Payroll" />
      <PayrollTabs active="loans" />
      <LoansClient rows={rows} staff={data.staff} canManage={canManagePayroll(session)} />
    </div>
  );
}
