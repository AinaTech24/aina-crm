import { notFound } from "next/navigation";
import { and, asc, eq, inArray } from "drizzle-orm";
import { Wallet } from "lucide-react";
import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { EmptyState } from "@/components/common/EmptyState";
import { Badge } from "@/components/ui/Badge";
import { withTenant } from "@/db/client";
import { payRunItems, payRuns, payrollProfiles, users } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { canManagePayroll, canViewPayroll, isOwner } from "@/lib/payroll/access";
import type { PayResult } from "@/lib/payroll/calc";
import { formatDate } from "@/lib/format";
import { monthLabel } from "@/components/payroll/PayrollShared";
import { RunWorkspace, type ItemRow } from "./RunWorkspace";
import { RUN_STATUS as STATUS } from "@/lib/payroll/labels";
import { variance } from "@/lib/payroll/variance";

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
    const loadItems = (runId: string) =>
      tx
        .select({ item: payRunItems, name: users.name, code: users.employeeCode, uan: payrollProfiles.uan, esiNumber: payrollProfiles.esiNumber })
        .from(payRunItems)
        .innerJoin(users, eq(users.id, payRunItems.userId))
        .leftJoin(payrollProfiles, and(eq(payrollProfiles.tenantId, payRunItems.tenantId), eq(payrollProfiles.userId, payRunItems.userId)))
        .where(eq(payRunItems.payRunId, runId))
        .orderBy(asc(users.name));
    const items = await loadItems(id);
    const p = String(run.period);
    const prevPeriod = p.slice(5, 7) === "01" ? `${Number(p.slice(0, 4)) - 1}-12-01` : `${p.slice(0, 4)}-${String(Number(p.slice(5, 7)) - 1).padStart(2, "0")}-01`;
    const [prev] = await tx.select({ id: payRuns.id }).from(payRuns).where(and(eq(payRuns.tenantId, session.tenantId), eq(payRuns.period, prevPeriod)));
    const prevItems = prev ? await loadItems(prev.id) : null;
    const ids = [run.preparedBy, run.approvedBy, run.paidBy].filter((x): x is string => !!x);
    const people = ids.length ? await tx.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids)) : [];
    return { run, items, prevItems, names: new Map(people.map((x) => [x.id, x.name])) };
  });
  if (!data) notFound();
  const { run, items, prevItems, names } = data;
  const toV = (list: typeof items) => list.map(({ item, name }) => ({ userId: item.userId, name, gross: Number(item.gross), net: Number(item.net), onHold: item.onHold }));
  const changes = variance(toV(items), prevItems ? toV(prevItems) : null).filter((r) => r.flags.length > 0);
  const has = (r: unknown, code: string) => ((r as PayResult).deductions ?? []).some((l) => l.code === code && l.amount > 0);
  const noUan = items.filter(({ item, uan }) => !item.onHold && has(item.result, "pf") && !uan).map(({ name }) => name);
  const noEsi = items.filter(({ item, esiNumber }) => !item.onHold && has(item.result, "esi") && !esiNumber).map(({ name }) => name);

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
            arrears: Number(t.arrears ?? 0), incentives: Number(t.incentives ?? 0), claims: Number(t.claims ?? 0), loans: Number(t.loans ?? 0),
          },
        }}
        rows={rows}
        canManage={canManagePayroll(session)}
        checks={{ changes, hasPrevious: !!prevItems, noUan, noEsi }}
      />
    </div>
  );
}
