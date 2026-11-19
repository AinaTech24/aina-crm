import Link from "next/link";
import { sql } from "drizzle-orm";
import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { MyPayTabs } from "@/components/payroll/PayrollShared";
import { ClaimsTable } from "@/components/payroll/ClaimsTable";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { canManagePayroll } from "@/lib/payroll/access";
import { loadClaims } from "@/lib/payroll/claims-list";
import { NewClaim } from "./NewClaim";

export const dynamic = "force-dynamic";

/** My pay → Expense claims: claim an expense; a reporting manager also decides their team's here. */
export default async function MyClaimsPage() {
  const session = await requireSession();
  const manage = canManagePayroll(session);
  const { mine, team } = await withTenant(session.tenantId, async (tx) => {
    const mine = await loadClaims(tx, session.tenantId, sql`c.user_id = ${session.userId}::uuid`);
    const team = await loadClaims(
      tx,
      session.tenantId,
      sql`c.status = 'submitted' AND u.reporting_manager_id = ${session.userId}::uuid AND c.user_id <> ${session.userId}::uuid`,
      { userId: session.userId, payrollManager: manage }
    );
    return { mine, team };
  });
  return (
    <div className="max-w-4xl space-y-5">
      <PageHeaderCard title="My pay" />
      <MyPayTabs active="claims" />
      {team.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Your team&apos;s claims to approve</h2>
          <ClaimsTable rows={team} mode="decide" empty="" />
          {manage && <Link href="/dashboard/payroll/claims" className="text-sm text-primary hover:underline">Every claim in Payroll → Claims</Link>}
        </section>
      )}
      <NewClaim />
      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Your claims</h2>
        <ClaimsTable rows={mine} mode="mine" empty="No claims yet. Approved claims are repaid with your next salary, tax-free." />
      </section>
    </div>
  );
}
