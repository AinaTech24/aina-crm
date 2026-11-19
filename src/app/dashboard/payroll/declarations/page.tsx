import { sql } from "drizzle-orm";
import { Wallet } from "lucide-react";
import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { EmptyState } from "@/components/common/EmptyState";
import { PayrollTabs } from "@/components/payroll/PayrollShared";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { canManagePayroll, canViewPayroll } from "@/lib/payroll/access";
import { fyStart } from "@/lib/payroll/run";
import { readDeclaration, readProofs } from "@/lib/payroll/tax";
import { DeclarationsClient, type DeclRow } from "./DeclarationsClient";

export const dynamic = "force-dynamic";

/** Payroll → Tax declarations: everyone's regime and declarations for the year; verify proofs. */
export default async function PayrollDeclarationsPage() {
  const session = await requireSession();
  if (!canViewPayroll(session)) {
    return <div className="mt-6"><EmptyState icon={Wallet} title="Payroll is kept by the owner" description="Your own declaration is in My pay." primary={{ href: "/dashboard/my-pay/tax", label: "Open My pay" }} /></div>;
  }
  const today = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
  const fy = fyStart(today);
  const rows = await withTenant(session.tenantId, async (tx) =>
    (await tx.execute(sql`
      SELECT u.id::text AS user_id, u.name, d.id::text AS id, d.regime, d.declared, d.proofs, d.submitted_at, p.tax_regime
        FROM users u
        LEFT JOIN tax_declarations d ON d.tenant_id = u.tenant_id AND d.user_id = u.id AND d.fy_start = ${fy}::date
        LEFT JOIN payroll_profiles p ON p.tenant_id = u.tenant_id AND p.user_id = u.id
       WHERE u.tenant_id = ${session.tenantId}::uuid AND u.deleted_at IS NULL AND u.status IN ('active', 'offboarding')
         AND NOT (u.roles && ARRAY['platform_admin', 'platform_support', 'investor']::text[])
         AND EXISTS (SELECT 1 FROM employee_salaries s WHERE s.tenant_id = u.tenant_id AND s.user_id = u.id)
       ORDER BY u.name`)).rows as Array<Record<string, unknown>>
  );
  const list: DeclRow[] = rows.map((r) => ({
    userId: String(r.user_id),
    id: r.id ? String(r.id) : null,
    name: String(r.name),
    regime: (r.regime ?? r.tax_regime) === "old" ? "old" : "new",
    submitted: !!r.submitted_at,
    declared: readDeclaration(r.declared),
    proofs: readProofs(r.proofs),
    self: String(r.user_id) === session.userId,
  }));
  const fyLabel = `${fy.slice(0, 4)}-${String((Number(fy.slice(0, 4)) + 1) % 100).padStart(2, "0")}`;
  return (
    <div className="space-y-5">
      <PageHeaderCard title="Payroll" />
      <PayrollTabs active="declarations" />
      <DeclarationsClient rows={list} fyLabel={fyLabel} canManage={canManagePayroll(session)} />
    </div>
  );
}
