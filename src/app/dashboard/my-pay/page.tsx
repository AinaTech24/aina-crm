import Link from "next/link";
import { and, desc, eq, inArray } from "drizzle-orm";
import { ReceiptText } from "lucide-react";
import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { EmptyState } from "@/components/common/EmptyState";
import { withTenant } from "@/db/client";
import { payRunItems, payRuns } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { monthLabel, rupees } from "@/components/payroll/PayrollShared";

export const dynamic = "force-dynamic";

/** My pay — each person's own payslips, from approved and paid pay runs. */
export default async function MyPayPage() {
  const session = await requireSession();
  const slips = await withTenant(session.tenantId, (tx) =>
    tx
      .select({ runId: payRuns.id, period: payRuns.period, status: payRuns.status, gross: payRunItems.gross, net: payRunItems.net, onHold: payRunItems.onHold })
      .from(payRunItems)
      .innerJoin(payRuns, eq(payRuns.id, payRunItems.payRunId))
      .where(and(eq(payRunItems.tenantId, session.tenantId), eq(payRunItems.userId, session.userId), inArray(payRuns.status, ["approved", "paid"])))
      .orderBy(desc(payRuns.period))
      .limit(36)
  );
  return (
    <div className="max-w-3xl space-y-5">
      <PageHeaderCard title="My pay" />
      {slips.length === 0 ? (
        <EmptyState icon={ReceiptText} title="No payslips yet" description="Your payslip appears here once your firm approves the month's payroll." />
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border bg-card">
          {slips.map((s) => (
            <li key={s.runId}>
              <Link href={`/dashboard/my-pay/${s.runId}`} className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-secondary/50">
                <span className="font-medium">{monthLabel(String(s.period))}</span>
                <span className="text-sm text-muted-foreground">{s.onHold ? "On hold" : s.status === "paid" ? "Paid" : "Approved"}</span>
                <span className="ml-auto text-sm text-muted-foreground">Gross {rupees(s.gross)}</span>
                <span className="font-semibold tabular-nums">Net {rupees(s.net)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
