/**
 * The Claims Control Centre's analysis sections, §6–25. Server components:
 * each takes what analysis.ts computed and prints it; claim names open the
 * drawer, cards open the focused worklist.
 */

import Link from "next/link";
import {
  Ban, CalendarClock, CreditCard, FileSearch, FileText, Gavel, Handshake, Hourglass, Layers, MessageSquareWarning, PieChart, Receipt, Scale, Timer,
} from "lucide-react";
import type {
  ageing, byMode, documents, lineSummary, legal, pendingWith, queries, rejected, settlement, slaTat, statusDistribution, TatRow,
} from "@/lib/dashboard/claims/analysis";
import type { ClaimRec } from "@/lib/dashboard/claims/set";
import type { WorklistFocus } from "@/lib/dashboard/claims/params";
import { Num, Section, Stat, StatGrid, Table } from "@/components/dashboards/my/Shared";
import { BarRow, LinkToggle } from "@/components/dashboards/insurance/parts";
import { formatCount, formatMoney, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ClaimList, StatusBadge, type Col, type Names } from "./parts";

type FocusHref = (k: WorklistFocus) => string;
const days = (v: number | null) => (v == null ? "—" : `${Math.round(v)} d`);
const pct = (v: number | null) => (v == null ? "—" : formatPercent(v * 100, 1));

/* ───────────────────────── §6 ───────────────────────── */

export function StatusPanel({ rows, periodLabel }: { rows: ReturnType<typeof statusDistribution>; periodLabel: string }) {
  const open = rows.filter((r) => r.open);
  const closed = rows.filter((r) => !r.open);
  const max = Math.max(0, ...open.map((r) => r.n));
  return (
    <Section title="Claim status" subtitle={`Open claims by status today; closed claims by outcome in ${periodLabel}.`} icon={<Layers className="size-4" />}
      note="The CRM's own twelve statuses. It has no Registered, Approved, Settlement pending, Legal or Closed status, so none is shown.">
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="min-w-0">
          <h3 className="mb-1.5 text-2xs font-semibold text-muted-foreground">Open now</h3>
          {open.map((r) => (
            <BarRow key={r.status} label={<StatusBadge status={r.status} />} value={r.n} max={max} right={<>{formatCount(r.n)} · {formatMoney(r.amount)}</>} />
          ))}
        </div>
        <div className="min-w-0">
          <h3 className="mb-1.5 text-2xs font-semibold text-muted-foreground">Closed in {periodLabel}</h3>
          <Table rows={closed.length} empty="Nothing closed." head={<><th scope="col">Outcome</th><th scope="col" className="text-right">Claims</th><th scope="col" className="text-right">Amount</th></>}>
            {closed.map((r) => (
              <tr key={r.status}>
                <td className="py-2 text-xs"><StatusBadge status={r.status} /></td>
                <Num>{formatCount(r.n)}</Num>
                <Num>{formatMoney(r.amount)}</Num>
              </tr>
            ))}
          </Table>
          <p className="mt-2 text-2xs text-muted-foreground">Settled rows show the settled amount; rejected and withdrawn show the claimed amount.</p>
        </div>
      </div>
    </Section>
  );
}

/* ───────────────────────── §7–8 ───────────────────────── */

export function AgeingPanel({ buckets, rows, names, sort, sortOptions }: {
  buckets: ReturnType<typeof ageing>; rows: ClaimRec[]; names: Names;
  sort: string; sortOptions: Array<{ key: string; label: string; href: string }>;
}) {
  return (
    <Section title="Claim ageing" subtitle="Open claims by days since intimation." icon={<CalendarClock className="size-4" />}
      note="Age runs from the intimation date, or from the day the claim was keyed when there is none. 90+ days is highlighted: those claims are also on the management escalation centre.">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
        {buckets.map((b) => (
          <div key={b.key} className={cn("rounded-lg border p-3", b.key === "a6" && b.n > 0 ? "border-destructive/30 bg-destructive/5" : "border-transparent bg-secondary/70")}>
            <div className={cn("text-xl font-semibold tabular-nums", b.key === "a6" && b.n > 0 && "text-destructive")}>{formatCount(b.n)}</div>
            <div className="text-2xs font-medium text-foreground">{b.label}</div>
            <div className="text-2xs text-muted-foreground">{formatMoney(b.amount)}</div>
          </div>
        ))}
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-2" id="ageing-detail">
        <h3 className="text-2xs font-semibold text-muted-foreground">Ageing detail</h3>
        <LinkToggle current={sort} options={sortOptions} />
      </div>
      <div className="mt-2">
        <ClaimList rows={rows} names={names} limit={15} empty="No open claims."
          cols={["client", "claim", "insurer", "amount", "status", "pendingWith", "age", "updated", "owner"]} />
      </div>
    </Section>
  );
}

/* ───────────────────────── §9–11 ───────────────────────── */

export function SlaPanel({ s, periodLabel, slaDays, warnDays, focusHref }: {
  s: ReturnType<typeof slaTat>; periodLabel: string; slaDays: number; warnDays: number; focusHref: FocusHref;
}) {
  return (
    <Section title="Claim TAT and SLA" subtitle={`SLA today; turnaround on claims closed in ${periodLabel}.`} icon={<Timer className="size-4" />}
      note={`The SLA is the firm's own: ${slaDays} days from intimation, approaching within ${warnDays} days (Settings → Dashboard thresholds). TAT is intimation to settlement or rejection; grievance cases are left out.`}>
      <StatGrid cols={6}>
        <Stat label="Within SLA" value={s.within.n} hint={formatMoney(s.within.amount)} />
        <Stat label="Approaching SLA" value={s.approaching.n} hint={formatMoney(s.approaching.amount)} tone={s.approaching.n ? "warn" : "neutral"} href={focusHref("approaching")} />
        <Stat label="SLA breached" value={s.breached.n} hint={formatMoney(s.breached.amount)} tone={s.breached.n ? "bad" : "neutral"} href={focusHref("sla")} />
        <Stat label="Average TAT" display={days(s.avgTat)} hint={`${formatCount(s.closedN)} closed`} />
        <Stat label="Median TAT" display={days(s.medianTat)} />
        <Stat label="Oldest open claim" display={s.oldest ? `${formatCount(s.oldest.days)} d` : "—"} hint={s.oldest?.client} />
      </StatGrid>
    </Section>
  );
}

export function TatTable({ title, subtitle, rows, keyLabel, icon, note, hrefFor }: {
  title: string; subtitle: string; rows: TatRow[]; keyLabel: string; icon: React.ReactNode; note: string; hrefFor?: (key: string) => string;
}) {
  return (
    <Section title={title} subtitle={subtitle} icon={icon} note={note} className="min-w-0">
      <Table rows={rows.length} empty="No claim in this view." head={<>
        <th scope="col">{keyLabel}</th><th scope="col" className="text-right">Logged</th><th scope="col" className="text-right">Open</th>
        <th scope="col" className="text-right">Settled</th><th scope="col" className="text-right">Avg TAT</th><th scope="col" className="text-right">Median TAT</th>
        <th scope="col" className="text-right">Open past SLA</th>
      </>}>
        {rows.map((r) => (
          <tr key={r.key}>
            <td className="py-2.5 text-xs font-medium">{hrefFor ? <Link href={hrefFor(r.key)} scroll={false} className="hover:text-primary hover:underline">{r.label}</Link> : r.label}</td>
            <Num>{formatCount(r.logged)}</Num>
            <Num>{formatCount(r.open)}</Num>
            <Num>{formatCount(r.settled)}</Num>
            <Num>{days(r.avgTat)}</Num>
            <Num>{days(r.medianTat)}</Num>
            <Num tone={r.breachPct ? "warn" : "neutral"}>{pct(r.breachPct)}</Num>
          </tr>
        ))}
      </Table>
    </Section>
  );
}

/* ───────────────────────── §12, §14, §15 ───────────────────────── */

export function DocumentsPanel({ d, names, periodLabel, docsDays, focusHref }: {
  d: ReturnType<typeof documents>; names: Names; periodLabel: string; docsDays: number; focusHref: FocusHref;
}) {
  return (
    <Section title="Document control centre" subtitle="Files and information awaited from clients, and each claim's checklist." icon={<FileText className="size-4" />}
      note={`Requested and received are status changes in ${periodLabel} (File awaited, Info awaited → File received, Query replied). The checklist follows the policy's product; a document sent to the insurer but not added to the claim shows as missing. Overdue after ${docsDays} days awaiting.`}>
      <StatGrid cols={6}>
        <Stat label={`Requested (${periodLabel})`} value={d.requested} />
        <Stat label={`Received (${periodLabel})`} value={d.received} />
        <Stat label="File awaited now" value={d.pending.n} hint={formatMoney(d.pending.amount)} tone={d.pending.n ? "warn" : "neutral"} href={focusHref("fnr")} />
        <Stat label="Checklist incomplete" value={d.incomplete.n} hint={formatMoney(d.incomplete.amount)} />
        <Stat label="No documents on file" value={d.none.n} hint={formatMoney(d.none.amount)} tone={d.none.n ? "warn" : "neutral"} />
        <Stat label="Document SLA breached" value={d.overdue.n} hint={formatMoney(d.overdue.amount)} tone={d.overdue.n ? "bad" : "neutral"} href={focusHref("docs")} />
      </StatGrid>
      <div className="mt-4">
        <ClaimList rows={d.rows} names={names} empty="No claim is waiting on the client for documents."
          cols={["clientClaim", "missing", "since", "pendingWith", "inStatus", "owner"]} />
      </div>
    </Section>
  );
}

export function PendingWithPanel({ rows, focusHref }: { rows: ReturnType<typeof pendingWith>; focusHref: (pw: string) => string }) {
  return (
    <Section title="Pending with" subtitle="Where every open claim is waiting — inside the firm or outside it." icon={<Hourglass className="size-4" />}
      note="Derived from the status: the CRM has no pending-with field, and it cannot tell the insurer from a TPA, a hospital, a surveyor or a lawyer, or the claims team from the RM.">
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        {rows.map((r) => (
          <Link key={r.key} href={focusHref(r.key)} scroll={false} title={r.hint} className="block rounded-lg border border-transparent bg-secondary/70 p-3 transition-colors hover:border-primary/25 hover:bg-accent">
            <div className="flex items-baseline justify-between">
              <span className="text-xs font-medium">{r.label}</span>
              <span className="text-xl font-semibold tabular-nums">{formatCount(r.n)}</span>
            </div>
            <div className="text-2xs text-muted-foreground">{formatMoney(r.amount)} · {r.avgAge == null ? "—" : `${Math.round(r.avgAge)} d average age`}</div>
            <div className="mt-1 text-2xs text-muted-foreground">{r.hint}</div>
          </Link>
        ))}
      </div>
    </Section>
  );
}

export function QueriesPanel({ q, names, periodLabel, queryDays, focusHref }: {
  q: ReturnType<typeof queries>; names: Names; periodLabel: string; queryDays: number; focusHref: FocusHref;
}) {
  return (
    <Section title="Insurer / TPA queries" subtitle="Queries and information requests from the insurer." icon={<MessageSquareWarning className="size-4" />}
      note={`Raised and answered are status changes in ${periodLabel} (Query or Info awaited, then Query replied). The query's wording is not a field — see the claim's remarks. Overdue after ${queryDays} days.`}>
      <StatGrid cols={5}>
        <Stat label={`Raised (${periodLabel})`} value={q.raised} />
        <Stat label={`Answered (${periodLabel})`} value={q.answered} />
        <Stat label="Pending now" value={q.pending.n} hint={formatMoney(q.pending.amount)} tone={q.pending.n ? "warn" : "neutral"} href={focusHref("query")} />
        <Stat label="Overdue" value={q.overdue.n} hint={formatMoney(q.overdue.amount)} tone={q.overdue.n ? "bad" : "neutral"} href={focusHref("query")} />
        <Stat label="Repeated query" value={q.repeated} hint="Two or more on one claim" tone={q.repeated ? "warn" : "neutral"} href={focusHref("repeat")} />
      </StatGrid>
      <div className="mt-4">
        <ClaimList rows={q.rows} names={names} empty="No query is pending."
          cols={["clientClaim", "insurer", "query", "since", "pendingWith", "inStatus", "owner"]} />
      </div>
    </Section>
  );
}

/* ───────────────────────── §16–18 ───────────────────────── */

export function ModePanel({ mode, m, names, periodLabel }: { mode: "cashless" | "reimbursement"; m: ReturnType<typeof byMode>; names: Names; periodLabel: string }) {
  const cashless = mode === "cashless";
  const cols: Col[] = cashless
    ? ["client", "insurer", "amount", "status", "age"]
    : ["client", "amount", "submitted", "status", "settled", "age"];
  return (
    <Section title={cashless ? "Cashless claims" : "Reimbursement claims"} className="min-w-0"
      subtitle={`Claim mode ${cashless ? "Cashless" : "Reimbursement"} — open today, and closed in ${periodLabel}.`} icon={cashless ? <CreditCard className="size-4" /> : <Receipt className="size-4" />}
      note={cashless
        ? "Pre-authorisation is the claim type Pre-auth. The CRM records no hospital, approved amount or enhancement request, so none is shown."
        : "Approved and settlement-pending are not shown: the CRM has no approval step."}>
      <StatGrid cols={3}>
        <Stat label={`Logged (${periodLabel})`} value={m.logged.n} hint={formatMoney(m.logged.amount)} />
        <Stat label="Open" value={m.open.n} hint={formatMoney(m.open.amount)} />
        {cashless
          ? <Stat label="Pre-authorisation pending" value={m.preAuth.n} hint={formatMoney(m.preAuth.amount)} tone={m.preAuth.n ? "warn" : "neutral"} />
          : <Stat label="Documents pending" value={m.docsPending.n} hint={formatMoney(m.docsPending.amount)} tone={m.docsPending.n ? "warn" : "neutral"} />}
        {!cashless && <Stat label="Submitted (open)" value={m.submitted.n} hint={formatMoney(m.submitted.amount)} />}
        {!cashless && <Stat label="Query pending" value={m.query.n} hint={formatMoney(m.query.amount)} />}
        <Stat label={`Settled (${periodLabel})`} value={m.settled.n} hint={formatMoney(m.settled.amount)} tone={m.settled.n ? "good" : "neutral"} />
        <Stat label={`Rejected (${periodLabel})`} value={m.rejected.n} hint={formatMoney(m.rejected.amount)} />
      </StatGrid>
      <div className="mt-4"><ClaimList rows={m.rows} names={names} cols={cols} limit={10} empty={`No ${cashless ? "cashless" : "reimbursement"} claim in this view.`} /></div>
    </Section>
  );
}

export function ClaimedVsSettledPanel({ rows, names, periodLabel }: { rows: ClaimRec[]; names: Names; periodLabel: string }) {
  const claimed = rows.reduce((a, c) => a + c.claimed, 0);
  const paid = rows.reduce((a, c) => a + c.settled, 0);
  return (
    <Section title="Claim amount vs settled amount" subtitle={`Claims settled in ${periodLabel}: ${formatMoney(paid)} paid against ${formatMoney(claimed)} claimed.`}
      icon={<Scale className="size-4" />} className="min-w-0"
      note="The difference is claimed less settled, and is not a loss or an unfair deduction — policy limits, co-pay and non-payables all show up here. The CRM has no approved amount or deduction reason; the claim's remarks are shown where there are any.">
      <ClaimList rows={rows} names={names} limit={12} empty={`No claim settled in ${periodLabel}.`}
        cols={["clientClaim", "amount", "settled", "diff", "remarks"]} />
    </Section>
  );
}

/* ───────────────────────── §19–20 ───────────────────────── */

export function SettlementPanel({ s, periodLabel }: { s: ReturnType<typeof settlement>; periodLabel: string }) {
  const max = Math.max(0, ...s.ageing.map((b) => b.n));
  return (
    <Section title="Settlement monitoring" subtitle="What was paid, and how long it took." icon={<Handshake className="size-4" />}
      note="The CRM has no approval step, so approved claims and the amount awaiting settlement cannot be shown. Settlement ageing is days from intimation to settlement, for claims settled this FY.">
      <StatGrid cols={5}>
        <Stat label="Settled today" value={s.today.n} hint={formatMoney(s.today.amount)} />
        <Stat label="Settled month to date" value={s.mtd.n} hint={formatMoney(s.mtd.amount)} />
        <Stat label="Settled FY to date" value={s.fytd.n} hint={formatMoney(s.fytd.amount)} />
        <Stat label="Average days to settle" display={s.avgDays == null ? "—" : `${Math.round(s.avgDays)} d`} hint="This FY" />
        <Stat label="Approved, settlement pending" value={null} unavailable="The CRM has no approval status." />
      </StatGrid>
      <div className="mt-4 grid gap-5 lg:grid-cols-2">
        <div className="min-w-0">
          <h3 className="mb-1.5 text-2xs font-semibold text-muted-foreground">Settlement ageing · this FY</h3>
          {s.ageing.map((b) => <BarRow key={b.key} label={b.label} value={b.n} max={max} tone="success" right={<>{formatCount(b.n)} · {formatMoney(b.amount)}</>} />)}
        </div>
        <div className="min-w-0">
          <h3 className="mb-1.5 text-2xs font-semibold text-muted-foreground">Settlement ratio · {periodLabel}</h3>
          <div className="grid grid-cols-2 gap-2.5">
            <div className="rounded-lg bg-secondary/70 p-3" title="Settled claims ÷ claims decided (settled + rejected) in the period. Withdrawn claims are the client's choice and are left out.">
              <div className="text-xl font-semibold tabular-nums">{pct(s.countPct)}</div>
              <div className="text-2xs font-medium">By claim count</div>
              <div className="text-2xs text-muted-foreground">{formatCount(s.settledN)} settled of {formatCount(s.decidedN)} decided</div>
            </div>
            <div className="rounded-lg bg-secondary/70 p-3" title="Settled amount ÷ claimed amount, on the claims that settled in the period. The CRM has no approved amount to use instead.">
              <div className="text-xl font-semibold tabular-nums">{pct(s.amountPct)}</div>
              <div className="text-2xs font-medium">By amount</div>
              <div className="text-2xs text-muted-foreground">{formatMoney(s.period.amount)} of {formatMoney(s.claimedOnSettled)} claimed</div>
            </div>
          </div>
          <p className="mt-2 text-2xs text-muted-foreground">Two measures, never blended. Hover each for its definition.</p>
        </div>
      </div>
    </Section>
  );
}

/* ───────────────────────── §21–23 ───────────────────────── */

export function RejectedPanel({ r, names, periodLabel, focusHref }: { r: ReturnType<typeof rejected>; names: Names; periodLabel: string; focusHref: FocusHref }) {
  return (
    <Section title="Rejected claims" subtitle={`Rejected in ${periodLabel}.`} icon={<Ban className="size-4" />} className="min-w-0"
      note="A rejection is the insurer's decision, not a verdict on the claim or the team. The CRM has no rejection-reason field; the claim's remarks are shown, never read as a reason. Review is a follow-up scheduled on the rejected claim; escalated is claim mode Grievance.">
      <StatGrid cols={4}>
        <Stat label="Rejected" value={r.all.n} hint={formatMoney(r.all.amount)} />
        <Stat label="Under review" value={r.reviewOpen.n} hint="Follow-up open" />
        <Stat label="No review scheduled" value={r.noReview.n} tone={r.noReview.n ? "warn" : "neutral"} href={focusHref("rejected")} />
        <Stat label="Escalated (grievance)" value={r.escalated.n} />
      </StatGrid>
      <div className="mt-4 rounded-lg border border-dashed border-border px-3 py-2 text-xs">
        <div className="font-medium text-foreground">Rejection reasons</div>
        <div className="mt-0.5 text-muted-foreground">
          {r.all.n === 0 ? "No rejection in the period." : `Reason not captured: ${formatCount(r.all.n)} of ${formatCount(r.all.n)} (${formatMoney(r.all.amount)}). The claim form has no reason field, so there is nothing to analyse — a data gap, not a finding.`}
        </div>
      </div>
      <div className="mt-4">
        <ClaimList rows={r.rows} names={names} limit={10} empty="No claim rejected in the period."
          cols={["clientClaim", "insurer", "amount", "closed", "remarks", "next", "owner"]} />
      </div>
    </Section>
  );
}

export function LegalPanel({ l, names, periodLabel }: { l: ReturnType<typeof legal>; names: Names; periodLabel: string }) {
  return (
    <Section title="Grievance and legal claims" subtitle={`Claim mode Grievance — open, and closed in ${periodLabel}.`} icon={<Gavel className="size-4" />} className="min-w-0"
      note="The CRM's only marker for a legal, ombudsman or consumer-court matter is the claim mode Grievance; it records no hearing date or legal stage — the next date shown is the claim's next follow-up. These claims are left out of ordinary TAT.">
      <StatGrid cols={3}>
        <Stat label="Open" value={l.open.n} tone={l.open.n ? "bad" : "neutral"} />
        <Stat label="Claim amount (open)" value={l.open.amount} format="currency" />
        <Stat label={`Closed (${periodLabel})`} value={l.closed.n} />
      </StatGrid>
      <div className="mt-4">
        <ClaimList rows={l.rows} names={names} limit={10} empty="No grievance-mode claim."
          cols={["clientClaim", "insurer", "amount", "status", "next", "owner"]} />
      </div>
    </Section>
  );
}

/* ───────────────────────── §24–25 ───────────────────────── */

export function LinePanel({ line, s, periodLabel, groupHref }: {
  line: "personal" | "commercial"; s: ReturnType<typeof lineSummary>; periodLabel: string; groupHref: (g: string) => string;
}) {
  const personal = line === "personal";
  return (
    <Section title={personal ? "Personal Lines claims" : "Commercial Lines claims"} subtitle={`${periodLabel} flows; open is today.`}
      icon={personal ? <PieChart className="size-4" /> : <FileSearch className="size-4" />} className="min-w-0"
      note="The line comes from the linked policy's type, on the firm's MIS split (motor, home and other general are Commercial). A claim with no policy linked is on neither line.">
      <StatGrid cols={3}>
        <Stat label="Logged" value={s.logged.n} hint={formatMoney(s.logged.amount)} />
        <Stat label="Settled" value={s.settled.n} hint={formatMoney(s.settled.amount)} />
        <Stat label="Pending" value={s.pending.n} hint={formatMoney(s.pending.amount)} />
        {personal
          ? <Stat label="Rejected" value={s.rejected.n} hint={formatMoney(s.rejected.amount)} />
          : <Stat label="File not received" value={s.fnr.n} hint={formatMoney(s.fnr.amount)} tone={s.fnr.n ? "warn" : "neutral"} />}
        <Stat label="Open claim amount" value={s.open.amount} format="currency" />
        <Stat label="Settled amount" value={s.settled.amount} format="currency" />
      </StatGrid>
      <div className="mt-4">
        <Table rows={s.byGroup.length} empty={`No ${personal ? "Personal" : "Commercial"} Lines claim in this view.`} head={<>
          <th scope="col">Product</th><th scope="col" className="text-right">Logged</th><th scope="col" className="text-right">Open</th>
          <th scope="col" className="text-right">Settled</th><th scope="col" className="text-right">Logged amount</th>
          <th scope="col" className="text-right">Open amount</th><th scope="col" className="text-right">Settled amount</th>
        </>}>
          {s.byGroup.map((g) => (
            <tr key={g.key}>
              <td className="py-2.5 text-xs font-medium"><Link href={groupHref(g.key)} scroll={false} className="hover:text-primary hover:underline">{g.label}</Link></td>
              <Num>{formatCount(g.logged)}</Num>
              <Num>{formatCount(g.open)}</Num>
              <Num>{formatCount(g.settled)}</Num>
              <Num>{formatMoney(g.loggedAmount)}</Num>
              <Num>{formatMoney(g.openAmount)}</Num>
              <Num>{formatMoney(g.settledAmount)}</Num>
            </tr>
          ))}
        </Table>
      </div>
    </Section>
  );
}

