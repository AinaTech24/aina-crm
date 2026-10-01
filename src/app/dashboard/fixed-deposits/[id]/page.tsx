/**
 * One fixed deposit: the receipt's terms, what it pays, and the maturity
 * follow-up the CRM scheduled for it (the expected inflow and its reminder).
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import { sql } from "drizzle-orm";
import { BellRing, CalendarClock, RefreshCw } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireInvestorView, loadViewableInvestor } from "@/lib/investors/access";
import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { FdActions } from "@/components/fixed-deposits/FdActions";
import { FdStatusBadge, MaturityNote } from "@/components/fixed-deposits/FdTable";
import { canEditFds, loadViewableFd } from "@/lib/fixed-deposits/service";
import {
  COMPOUNDING_LABELS, HOLDING_LABELS, ISSUER_TYPE_LABELS, PAYOUT_LABELS, TAX_FORM_LABELS, computeMaturity, tenureLabel,
} from "@/lib/fixed-deposits/terms";
import { FD_REMIND_DAYS } from "@/lib/fixed-deposits/hooks";
import { formatDate, formatMoney } from "@/lib/format";

export const dynamic = "force-dynamic";

const INFLOW_STATUS: Record<string, string> = {
  expected: "Expected", confirmed: "Confirmed by the client", invested: "Invested with us",
  partially_invested: "Partly invested with us", lapsed: "Lapsed — went elsewhere", cancelled: "Cancelled",
};

export default async function FixedDepositPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  requireInvestorView(session);

  const data = await withTenant(session.tenantId, async (tx) => {
    const fd = await loadViewableFd(tx, session, id);
    if (!fd) return null;
    const client = await loadViewableInvestor(tx, session, fd.investorId);
    const extra = (await tx.execute(sql`
      SELECT (SELECT name FROM users WHERE id = ${fd.rmId}::uuid) AS rm_name,
             (SELECT name FROM users WHERE id = ${fd.createdBy}::uuid) AS created_by_name,
             e.status AS inflow_status, e.expected_amount AS inflow_amount, e.expected_on::text AS inflow_on,
             t.id AS task_id, t.status AS task_status, t.due_at AS task_due,
             (SELECT name FROM users WHERE id = t.assignee_id) AS task_assignee,
             prev.id AS prev_id, prev.issuer AS prev_issuer, prev.maturity_date::text AS prev_maturity,
             nxt.id AS next_id, nxt.issuer AS next_issuer, nxt.deposit_date::text AS next_deposit
        FROM (SELECT 1) one
        LEFT JOIN expected_inflows e ON e.id = ${fd.inflowId}::uuid
        LEFT JOIN tasks t ON t.id = e.reminder_task_id
        LEFT JOIN fixed_deposits prev ON prev.id = ${fd.renewedFromId}::uuid AND prev.deleted_at IS NULL
        LEFT JOIN LATERAL (
          SELECT id, issuer, deposit_date FROM fixed_deposits
           WHERE tenant_id = ${session.tenantId}::uuid AND renewed_from_id = ${fd.id}::uuid AND deleted_at IS NULL
           ORDER BY created_at DESC LIMIT 1
        ) nxt ON TRUE
    `)).rows[0] as Record<string, any>;
    return { fd, client, extra };
  }, { userId: session.userId, branchId: session.branchId ?? undefined, roles: session.roles });

  if (!data) notFound();
  const { fd, client, extra } = data;
  const principal = Number(fd.principal);
  const maturity = fd.maturityAmount == null ? null : Number(fd.maturityAmount);
  const figures = computeMaturity({
    principal, rate: Number(fd.interestRate), depositDate: String(fd.depositDate), maturityDate: String(fd.maturityDate),
    payout: fd.payout, compounding: fd.compounding,
  });
  const interest = fd.payout === "cumulative" && maturity != null ? maturity - principal : figures?.interest ?? null;

  const facts: Array<[string, React.ReactNode]> = [
    ["Client", client ? <Link href={`/dashboard/investors/${client.id}`} className="font-medium hover:underline">{client.name}</Link> : "—"],
    ["Relationship manager", extra?.rm_name ?? "—"],
    ["Bank / company", fd.issuer],
    ["Issuer type", ISSUER_TYPE_LABELS[fd.issuerType] ?? fd.issuerType],
    ["Scheme", fd.schemeName || "—"],
    ["FD / receipt number", fd.fdNumber || "—"],
    ["Deposit date", formatDate(String(fd.depositDate))],
    ["Tenure", tenureLabel(fd.tenureMonths, fd.tenureDays)],
    ["Maturity date", formatDate(String(fd.maturityDate))],
    ["Interest payout", PAYOUT_LABELS[fd.payout] ?? fd.payout],
    ...(fd.payout === "cumulative" ? [["Compounding", COMPOUNDING_LABELS[fd.compounding] ?? fd.compounding] as [string, React.ReactNode]] : []),
    ["Holding", HOLDING_LABELS[fd.holding] + (fd.holding !== "single" && fd.jointHolders ? ` — ${fd.jointHolders}` : "")],
    ["Nominee", fd.nomineeName || "—"],
    ["Senior-citizen rate", fd.seniorCitizen ? "Yes" : "No"],
    ["Form 15G / 15H", TAX_FORM_LABELS[fd.taxForm] ?? fd.taxForm],
    ["Auto-renew", fd.autoRenew ? "Yes" : "No"],
    ["Commission", fd.commissionAmount != null
      ? `${formatMoney(Number(fd.commissionAmount), { scale: "full" })}${fd.commissionRate != null ? ` (${Number(fd.commissionRate)}%)` : ""}`
      : fd.commissionRate != null ? `${Number(fd.commissionRate)}%` : "—"],
    ...(fd.closedOn ? [["Closed on", formatDate(String(fd.closedOn))] as [string, React.ReactNode]] : []),
    ["Recorded", `${formatDate(fd.createdAt)}${extra?.created_by_name ? ` by ${extra.created_by_name}` : ""}`],
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeaderCard
        title={fd.issuer}
        subtitle={`${formatMoney(principal, { scale: "full" })} at ${Number(fd.interestRate).toFixed(2)}% for ${client?.name ?? "the client"}`}
        breadcrumb={[{ label: "Fixed Deposits", href: "/dashboard/fixed-deposits" }, { label: fd.issuer }]}
        actions={canEditFds(session) ? <FdActions id={fd.id} status={fd.status} investorId={fd.investorId} /> : undefined}
      >
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <FdStatusBadge status={fd.status} />
          <MaturityNote maturityDate={String(fd.maturityDate)} status={fd.status} />
        </div>
      </PageHeaderCard>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Amount deposited", formatMoney(principal, { scale: "full" })],
          ["On maturity", formatMoney(maturity ?? principal, { scale: "full" }) + (fd.maturityAmountEntered ? "" : " (est.)")],
          ["Interest over the tenure", interest == null ? "—" : formatMoney(interest, { scale: "full" })],
          figures?.periodicInterest != null
            ? [`Each ${(PAYOUT_LABELS[fd.payout] ?? "").split(" ")[0].toLowerCase()} payout`, formatMoney(figures.periodicInterest, { scale: "full" })]
            : ["Rate", `${Number(fd.interestRate).toFixed(2)}% a year`],
        ].map(([label, value]) => (
          <div key={label} className="card-surface p-4">
            <div className="text-xl font-semibold tabular-nums tracking-tight">{value}</div>
            <div className="mt-1 text-sm text-muted-foreground">{label}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="card-surface p-5 lg:col-span-2">
          <h2 className="section-title">Deposit details</h2>
          <dl className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2">
            {facts.map(([k, v]) => (
              <div key={k} className="min-w-0">
                <dt className="text-xs text-muted-foreground">{k}</dt>
                <dd className="text-sm">{v}</dd>
              </div>
            ))}
          </dl>
          {fd.remarks && (
            <div className="mt-5 rounded-lg bg-secondary/70 p-3 text-sm">
              <div className="text-xs text-muted-foreground">Remarks</div>
              <p className="mt-1 whitespace-pre-line">{fd.remarks}</p>
            </div>
          )}
        </section>

        <div className="space-y-6">
          <section className="card-surface p-5">
            <h2 className="section-title flex items-center gap-2"><BellRing className="size-4 text-muted-foreground" aria-hidden /> Maturity follow-up</h2>
            {extra?.inflow_status ? (
              <div className="mt-3 space-y-3 text-sm">
                <p>
                  {formatMoney(Number(extra.inflow_amount), { scale: "full" })} is on{" "}
                  <Link href="/dashboard/expected-inflows" className="font-medium hover:underline">Expected Inflows</Link>{" "}
                  for {formatDate(extra.inflow_on)}, the day it matures.
                </p>
                <div className="dash-row flex items-center justify-between gap-3 rounded-lg bg-secondary/70 p-3">
                  <span className="text-muted-foreground">Status</span>
                  <span className="font-medium">{INFLOW_STATUS[extra.inflow_status] ?? extra.inflow_status}</span>
                </div>
                {extra.task_id && (
                  <p className="text-muted-foreground">
                    <CalendarClock className="mr-1 inline size-3.5" aria-hidden />
                    Reminder for {extra.task_assignee ?? "the RM"}
                    {extra.task_due ? ` on ${formatDate(extra.task_due)}` : ""}
                    {extra.task_status && extra.task_status !== "open" ? ` (${String(extra.task_status).replace(/_/g, " ")})` : ""}.{" "}
                    <Link href={`/dashboard/tasks?task=${extra.task_id}`} className="font-medium text-foreground hover:underline">Open task</Link>
                  </p>
                )}
              </div>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">
                {fd.status === "active" || fd.status === "applied"
                  ? "The maturity date has passed, so no reminder is scheduled. Mark the FD matured or renewed."
                  : `None — reminders are set ${FD_REMIND_DAYS} days before maturity for live deposits.`}
              </p>
            )}
          </section>

          {(extra?.prev_id || extra?.next_id) && (
            <section className="card-surface p-5">
              <h2 className="section-title flex items-center gap-2"><RefreshCw className="size-4 text-muted-foreground" aria-hidden /> Renewals</h2>
              <ul className="mt-3 space-y-2 text-sm">
                {extra.prev_id && (
                  <li>Renewal of{" "}
                    <Link href={`/dashboard/fixed-deposits/${extra.prev_id}`} className="font-medium hover:underline">
                      {extra.prev_issuer} FD maturing {formatDate(extra.prev_maturity)}
                    </Link>
                  </li>
                )}
                {extra.next_id && (
                  <li>Renewed as{" "}
                    <Link href={`/dashboard/fixed-deposits/${extra.next_id}`} className="font-medium hover:underline">
                      {extra.next_issuer} FD from {formatDate(extra.next_deposit)}
                    </Link>
                  </li>
                )}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
