import { notFound } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";
import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { withTenant } from "@/db/client";
import { payRunItems, payRuns, tenants } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import type { PayResult } from "@/lib/payroll/calc";
import { Payslip, monthLabel } from "@/components/payroll/PayrollShared";
import { PrintButton } from "@/components/payroll/PrintButton";

export const dynamic = "force-dynamic";

/** One of my own payslips — only from an approved or paid run, only my own row. */
export default async function MyPayslipPage({ params }: { params: Promise<{ runId: string }> }) {
  const session = await requireSession();
  const { runId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(runId)) notFound();
  const data = await withTenant(session.tenantId, async (tx) => {
    const [row] = await tx
      .select({ period: payRuns.period, result: payRunItems.result })
      .from(payRunItems)
      .innerJoin(payRuns, eq(payRuns.id, payRunItems.payRunId))
      .where(and(eq(payRunItems.tenantId, session.tenantId), eq(payRunItems.payRunId, runId), eq(payRunItems.userId, session.userId), inArray(payRuns.status, ["approved", "paid"])));
    const [t] = await tx.select({ name: tenants.displayName }).from(tenants).where(eq(tenants.id, session.tenantId));
    return row ? { ...row, firm: t?.name ?? "" } : null;
  });
  if (!data) notFound();
  const result = data.result as unknown as PayResult & { employee?: { name?: string; employeeCode?: string; department?: string; workState?: string } };
  const period = String(data.period);
  return (
    <div className="max-w-3xl space-y-5">
      <div className="print:hidden">
        <PageHeaderCard title={`Payslip — ${monthLabel(period)}`} breadcrumb={[{ label: "My pay", href: "/dashboard/my-pay" }, { label: monthLabel(period) }]} actions={<PrintButton />} />
      </div>
      <Payslip firm={data.firm} period={period} employee={{ name: result.employee?.name ?? session.name ?? "", employeeCode: result.employee?.employeeCode, department: result.employee?.department, workState: result.employee?.workState }} result={result} />
    </div>
  );
}
