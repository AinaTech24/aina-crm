import Link from "next/link";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { ReceiptText } from "lucide-react";
import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { EmptyState } from "@/components/common/EmptyState";
import { Badge } from "@/components/ui/Badge";
import { withTenant } from "@/db/client";
import { payRunItems, payRuns } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { INCENTIVE_STATUS, LOAN_STATUS } from "@/lib/payroll/labels";
import { MyPayTabs, monthLabel, rupees } from "@/components/payroll/PayrollShared";

export const dynamic = "force-dynamic";

/** My pay — each person's own payslips (approved and paid runs) and their loans. */
export default async function MyPayPage() {
  const session = await requireSession();
  const { slips, loans, incentives } = await withTenant(session.tenantId, async (tx) => {
    const slips = await tx
      .select({ runId: payRuns.id, period: payRuns.period, status: payRuns.status, gross: payRunItems.gross, net: payRunItems.net, onHold: payRunItems.onHold })
      .from(payRunItems)
      .innerJoin(payRuns, eq(payRuns.id, payRunItems.payRunId))
      .where(and(eq(payRunItems.tenantId, session.tenantId), eq(payRunItems.userId, session.userId), inArray(payRuns.status, ["approved", "paid"])))
      .orderBy(desc(payRuns.period))
      .limit(36);
    const loans = (await tx.execute(sql`
      SELECT l.id::text AS id, l.kind, l.principal::float AS principal, l.emi::float AS emi, l.status,
             COALESCE((
               SELECT SUM((x->>'amount')::numeric)
                 FROM pay_run_items i JOIN pay_runs r ON r.id = i.pay_run_id,
                      jsonb_array_elements(COALESCE(i.result->'links'->'loans', '[]'::jsonb)) x
                WHERE i.tenant_id = l.tenant_id AND i.user_id = l.user_id AND r.status IN ('approved', 'paid')
                  AND i.on_hold = false AND x->>'id' = l.id::text
             ), 0)::float AS recovered
        FROM payroll_loans l
       WHERE l.tenant_id = ${session.tenantId}::uuid AND l.user_id = ${session.userId}::uuid AND l.status <> 'cancelled'
       ORDER BY l.created_at DESC LIMIT 20`)).rows as Array<{ id: string; kind: string; principal: number; emi: number; status: string; recovered: number }>;
    const incentives = (await tx.execute(sql`
      SELECT s.id::text AS id, p.name AS plan, s.period_start::text AS ps, s.period_end::text AS pe, s.amount::float AS amount,
             s.status, s.working->>'summary' AS summary
        FROM incentive_statements s JOIN incentive_plans p ON p.id = s.plan_id
       WHERE s.tenant_id = ${session.tenantId}::uuid AND s.user_id = ${session.userId}::uuid AND s.status <> 'rejected'
       ORDER BY s.period_start DESC LIMIT 12`)).rows as Array<{ id: string; plan: string; ps: string; pe: string; amount: number; status: string; summary: string | null }>;
    return { slips, loans, incentives };
  });
  return (
    <div className="max-w-3xl space-y-5">
      <PageHeaderCard title="My pay" />
      <MyPayTabs active="payslips" />
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
      {incentives.length > 0 && (
        <section className="rounded-xl border border-border bg-card p-4 space-y-2">
          <h2 className="text-sm font-semibold">Incentives</h2>
          <ul className="divide-y divide-border text-sm">
            {incentives.map((i) => (
              <li key={i.id} className="py-2 space-y-0.5">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="font-medium">{i.plan}</span>
                  <span className="text-muted-foreground">{i.ps.slice(0, 7) === i.pe.slice(0, 7) ? monthLabel(i.ps) : `${monthLabel(i.ps)} – ${monthLabel(i.pe)}`}</span>
                  <Badge tone={INCENTIVE_STATUS[i.status]?.tone ?? "neutral"}>{i.status === "calculated" ? "Being reviewed" : INCENTIVE_STATUS[i.status]?.label ?? i.status}</Badge>
                  <span className="ml-auto font-semibold tabular-nums">{rupees(i.amount)}</span>
                </div>
                {i.summary && <div className="text-2xs text-muted-foreground">{i.summary}</div>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {loans.length > 0 && (
        <section className="rounded-xl border border-border bg-card p-4 space-y-2">
          <h2 className="text-sm font-semibold">Loans and advances</h2>
          <ul className="divide-y divide-border text-sm">
            {loans.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center gap-3 py-2">
                <span className="font-medium">{l.kind === "advance" ? "Salary advance" : "Loan"} of {rupees(l.principal)}</span>
                <Badge tone={LOAN_STATUS[l.status]?.tone ?? "neutral"}>{LOAN_STATUS[l.status]?.label ?? l.status}</Badge>
                <span className="ml-auto text-muted-foreground">{rupees(l.emi)} a month</span>
                <span className="tabular-nums">Balance {rupees(Math.max(0, l.principal - l.recovered))}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
