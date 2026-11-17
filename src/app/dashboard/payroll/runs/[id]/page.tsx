import { notFound } from "next/navigation";
import { and, asc, eq, inArray } from "drizzle-orm";
import { Wallet } from "lucide-react";
import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { EmptyState } from "@/components/common/EmptyState";
import { Badge } from "@/components/ui/Badge";
import { withTenant } from "@/db/client";
import { payRunItems, payRuns, users } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { canManagePayroll, canViewPayroll, isOwner } from "@/lib/payroll/access";
import type { PayResult } from "@/lib/payroll/calc";
import { formatDate } from "@/lib/format";
import { monthLabel } from "@/components/payroll/PayrollShared";
import { RunWorkspace, type ItemRow } from "./RunWorkspace";
import { RUN_STATUS as STATUS } from "@/lib/payroll/labels";

export const dynamic = "force-dynamic";

export default async function PayRunPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  if (!canViewPayroll(session)) {
    return <div className="mt-6"><EmptyState icon={Wallet} title="Payroll is kept by the owner" description="Your own payslips are in My pay." primary={{ href: "/dashboard/my-pay", label: "Open My pay" }} /></div>;
  }
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const data = await withTenant(session.tenantId, async (tx) => {
    const [run] = await tx.select().from(payRuns).where(and(eq(payRuns.tenantId, session.tenantId), eq(payRuns.id, id)));
    if (!run) return null;
    const items = await tx
      .select({ item: payRunItems, name: users.name, code: users.employeeCode })
      .from(payRunItems)
      .innerJoin(users, eq(users.id, payRunItems.userId))
      .where(eq(payRunItems.payRunId, id))
      .orderBy(asc(users.name));
    const ids = [run.preparedBy, run.approvedBy, run.paidBy].filter((x): x is string => !!x);
    const people = ids.length ? await tx.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids)) : [];
    return { run, items, names: new Map(people.map((p) => [p.id, p.name])) };
  });
  if (!data) notFound();
  const { run, items, names } = data;

  const rows: ItemRow[] = items.map(({ item, name, code }) => {
    const r = item.result as unknown as PayResult & { lopWhy?: string };
    const sum = (lines: PayResult["deductions"] | undefined, codes: string[]) => (lines ?? []).filter((l) => codes.includes(l.code)).reduce((t, l) => t + l.amount, 0);
    return {
      id: item.id,
      userId: item.userId,
      name,
      code,
      payableDays: r.payableDays ?? 0,
      baseDays: r.baseDays ?? 0,
      lopDays: Number(item.lopDays),
      lopOverride: item.lopOverride,
      lopWhy: r.lopWhy ?? null,
      onHold: item.onHold,
      adjustments: item.adjustments ?? [],
      gross: Number(item.gross),
      pf: sum(r.deductions, ["pf"]),
      esi: sum(r.deductions, ["esi"]),
      pt: sum(r.deductions, ["pt"]),
      tds: Number(item.tds),
      net: Number(item.net),
      warnings: r.warnings ?? [],
    };
  });
  const t = run.totals ?? {};
  const st = STATUS[run.status] ?? { label: run.status, tone: "neutral" as const };
  const who = (uid: string | null, at: Date | null) => (uid ? `${names.get(uid) ?? "someone"}${at ? `, ${formatDate(at)}` : ""}` : null);

  return (
    <div className="space-y-5">
      <PageHeaderCard
        title={`Payroll — ${monthLabel(String(run.period))}`}
        breadcrumb={[{ label: "Payroll", href: "/dashboard/payroll" }, { label: monthLabel(String(run.period)) }]}
        actions={<Badge tone={st.tone}>{st.label}</Badge>}
      />
      <RunWorkspace
        run={{
          id: run.id,
          status: run.status,
          period: String(run.period),
          preparedBy: who(run.preparedBy, run.createdAt),
          approvedBy: who(run.approvedBy, run.approvedAt),
          paidBy: who(run.paidBy, run.paidAt),
          paidOn: run.paidOn ? String(run.paidOn) : null,
          youPrepared: run.preparedBy === session.userId,
          youAreOwner: isOwner(session),
          totals: {
            employees: Number(t.employees ?? 0), gross: Number(t.gross ?? 0), net: Number(t.net ?? 0), tds: Number(t.tds ?? 0),
            pf: Number(t.pf ?? 0), esi: Number(t.esi ?? 0), pt: Number(t.pt ?? 0), employerCost: Number(t.employerCost ?? 0), onHold: Number(t.onHold ?? 0),
          },
        }}
        rows={rows}
        canManage={canManagePayroll(session)}
      />
    </div>
  );
}
