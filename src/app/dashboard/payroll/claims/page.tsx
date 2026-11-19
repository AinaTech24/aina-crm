import Link from "next/link";
import { sql } from "drizzle-orm";
import { Wallet } from "lucide-react";
import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { EmptyState } from "@/components/common/EmptyState";
import { PayrollTabs } from "@/components/payroll/PayrollShared";
import { ClaimsTable } from "@/components/payroll/ClaimsTable";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { canManagePayroll, canViewPayroll } from "@/lib/payroll/access";
import { loadClaims } from "@/lib/payroll/claims-list";

export const dynamic = "force-dynamic";

const VIEWS = [
  { key: "open", label: "To decide", where: sql`c.status = 'submitted'` },
  { key: "approved", label: "Approved, to pay", where: sql`c.status = 'approved'` },
  { key: "all", label: "All", where: sql`true` },
] as const;

/** Payroll → Claims: every reimbursement claim; approved ones are repaid by the next pay run. */
export default async function PayrollClaimsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const session = await requireSession();
  if (!canViewPayroll(session)) {
    return <div className="mt-6"><EmptyState icon={Wallet} title="Payroll is kept by the owner" description="Your own claims are in My pay." primary={{ href: "/dashboard/my-pay/claims", label: "Open My pay" }} /></div>;
  }
  const { view } = await searchParams;
  const v = VIEWS.find((x) => x.key === view) ?? VIEWS[0];
  const manage = canManagePayroll(session);
  const rows = await withTenant(session.tenantId, (tx) => loadClaims(tx, session.tenantId, v.where, { userId: session.userId, payrollManager: manage }));
  return (
    <div className="space-y-5">
      <PageHeaderCard title="Payroll" />
      <PayrollTabs active="claims" />
      <nav aria-label="Claims" className="dash-seg w-fit">
        {VIEWS.map((x) => (
          <Link key={x.key} href={`/dashboard/payroll/claims?view=${x.key}`} aria-current={x.key === v.key ? "page" : undefined}>{x.label}</Link>
        ))}
      </nav>
      <ClaimsTable rows={rows} mode="decide" empty={v.key === "open" ? "No claims waiting. Team members claim expenses from My pay." : "No claims here."} />
    </div>
  );
}
