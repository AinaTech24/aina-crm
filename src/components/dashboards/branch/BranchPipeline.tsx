/**
 * §11 lead funnel, §12 proposals, §13 meetings, §14 client reviews — branch
 * versions. Each is the personal cockpit's section (same loader, same
 * definitions) plus the RM breakdown a branch head needs to ask "whose".
 */

import Link from "next/link";
import { CalendarCheck, CalendarDays, FileText, Filter } from "lucide-react";
import type { LeadFunnel, MeetingDesk, ProposalDesk } from "@/lib/dashboard/my/pipeline";
import type { ReviewDesk } from "@/lib/dashboard/my/clients";
import type { RmLedgerRow } from "@/lib/dashboard/branch/rm-ledger";
import { ratio } from "@/lib/dashboard/branch/targets";
import { CategoryTag, Num, Section, SectionLink, Stat, StatGrid, Table, Unavailable } from "@/components/dashboards/my/Shared";
import { FunnelBars } from "@/components/dashboards/my/MyPipeline";
import type { Voice } from "@/components/dashboards/my/voice";
import { formatDate, formatMoney, formatPercent, humanise, pluralDays } from "@/lib/format";
import { cn } from "@/lib/utils";
import { RmTable, rmRows, type RmCol } from "./RmTable";

const sumOf = (f: (r: RmLedgerRow) => number | null) => (rs: RmLedgerRow[]) => rs.reduce((s, r) => s + (f(r) ?? 0), 0);

/* ─────────────────────────── §11 lead funnel ─────────────────────────── */

export function BranchFunnel({
  funnel, ledger, voice, rmHref,
}: {
  funnel: LeadFunnel;
  ledger: RmLedgerRow[];
  voice: Voice;
  rmHref: (id: string) => string;
}) {
  const top = funnel.steps[0]?.reached ?? 0;
  const people = ledger.filter((r) => r.kind === "person" && ((r.leadsOpen ?? 0) + (r.leadsNew ?? 0) + (r.leadsConverted ?? 0) > 0 || r.isRm));
  return (
    <Section
      title={voice.title("lead funnel")}
      subtitle={voice.say("Where my prospects are, and where they stop.", "Where the branch's prospects are, where they stop, and which RM converts.")}
      icon={<Filter className="size-4" />}
      action={<SectionLink href={voice.leads()}>All leads</SectionLink>}
      note={`Each bar counts leads that reached that step or went past it, so the funnel narrows. Stale means no activity of any kind for ${funnel.staleAfterDays} days — the threshold is set in Settings → Dashboard thresholds.`}
    >
      {top === 0 ? (
        <Unavailable>{voice.say("No leads are owned by you, so there is no funnel to draw.", "No leads are recorded against this branch, so there is no funnel to draw.")}</Unavailable>
      ) : (
        <FunnelBars funnel={funnel} />
      )}
      <div className="mt-4">
        <StatGrid cols={6}>
          <Stat label="Leads" value={funnel.total} href={voice.leads()} />
          <Stat label="Onboarded" value={funnel.steps[funnel.steps.length - 1]?.reached ?? 0} tone="good" />
          <Stat label="Lost / not proceeding" value={funnel.lost} />
          <Stat label={`Stale (${funnel.staleAfterDays}d+)`} value={funnel.stale} tone={funnel.stale > 0 ? "warn" : "neutral"}
                hint={funnel.staleValue > 0 ? `${formatMoney(funnel.staleValue)} potential` : undefined} href={voice.leads()} />
          <Stat label="Without follow-up" value={funnel.withoutFollowUp} tone={funnel.withoutFollowUp > 0 ? "warn" : "neutral"}
                hint="never followed up" href={voice.leads()} />
          <Stat label="No next action" value={funnel.noNextAction} tone={funnel.noNextAction > 0 ? "warn" : "neutral"}
                hint="no follow-up date set" href={voice.leads()} />
        </StatGrid>
      </div>
      {voice.showRm && (
        <div className="mt-4">
          <h3 className="mb-2 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Conversion by RM</h3>
          <RmTable
            rows={people}
            rmHref={rmHref}
            cols={[
              { key: "open", label: "Open leads", get: (r) => r.leadsOpen },
              { key: "new", label: "New in period", get: (r) => r.leadsNew },
              { key: "fu", label: "Follow-ups", get: (r) => r.leadFollowUps },
              { key: "conv", label: "Converted", get: (r) => r.leadsConverted, tone: (v) => (v ? "good" : "neutral") },
              {
                key: "rate", label: "Converted ÷ new",
                title: "Leads converted in the period ÷ leads created in it. A flow ratio: an older lead converting now counts, so it can pass 100%.",
                get: (r) => ratio(r.leadsConverted, r.leadsNew), format: "percent",
                total: (rs) => ratio(sumOf((r) => r.leadsConverted)(rs), sumOf((r) => r.leadsNew)(rs)),
              },
            ]}
          />
        </div>
      )}
    </Section>
  );
}

/* ─────────────────────────── §12 proposals ─────────────────────────── */

export function BranchProposals({
  desk, ledger, voice, rmHref, periodLabel, ageingDays,
}: {
  desk: ProposalDesk;
  ledger: RmLedgerRow[];
  voice: Voice;
  rmHref: (id: string) => string;
  periodLabel: string;
  ageingDays: number;
}) {
  const people = ledger.filter((r) => r.kind === "person" && ((r.proposals ?? 0) > 0 || (r.proposalsLive ?? 0) > 0 || r.isRm));
  const agePeak = Math.max(1, ...desk.ageing.map((a) => a.count));
  return (
    <Section
      title={voice.title("proposals")}
      subtitle={`Written in ${periodLabel}, what converted, and what is still waiting on a client.`}
      icon={<FileText className="size-4" />}
      action={<SectionLink href="/dashboard/proposals">All proposals</SectionLink>}
      note="Conversion is measured against DECIDED proposals — accepted or rejected. Counting undecided ones as losses would make a healthy pipeline look like a bad month."
    >
      {desk.created == null ? (
        <Unavailable>{voice.say("You have not created a proposal yet.", "No one in this view has created a proposal yet.")}</Unavailable>
      ) : (
        <>
          <StatGrid cols={6}>
            <Stat label="Created" value={desk.created} />
            <Stat label="Proposal amount" value={desk.amount} format="currency" />
            <Stat label="Shared" value={desk.shared} />
            <Stat label="Follow-up pending" value={desk.followUpPending} tone={desk.followUpPending > 0 ? "warn" : "neutral"}
                  href="/dashboard/proposals?status=sent" />
            <Stat label="Converted" value={desk.converted} tone={desk.converted > 0 ? "good" : "neutral"} />
            <Stat label="Lost / not proceeding" value={desk.lost} />
          </StatGrid>
          <p className="mt-2 text-2xs text-muted-foreground">
            Conversion:{" "}
            <span className="font-semibold text-foreground">
              {desk.conversionPct == null ? "— (nothing decided yet)" : formatPercent(desk.conversionPct * 100, 0)}
            </span>{" "}
            of decided proposals.
          </p>

          <h3 className="mb-2 mt-4 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
            Waiting on a client &mdash; by days since sent
          </h3>
          <div className="grid grid-cols-5 gap-2">
            {desk.ageing.map((a, i) => (
              <div key={a.key} className="rounded-lg border border-border p-2 text-center">
                <div className={cn(
                  "text-base font-semibold tabular-nums",
                  a.count === 0 ? "text-muted-foreground" : i >= 2 ? "text-warning-foreground" : "text-foreground",
                )}>{a.count}</div>
                <div className="text-2xs text-muted-foreground">{a.label}</div>
                <div className="mt-1 h-1 rounded-full bg-secondary" aria-hidden>
                  <span className="block h-full rounded-full bg-primary/60" style={{ width: `${(a.count / agePeak) * 100}%` }} />
                </div>
                {a.value > 0 && <div className="mt-1 text-2xs tabular-nums text-muted-foreground">{formatMoney(a.value)}</div>}
              </div>
            ))}
          </div>
        </>
      )}
      {voice.showRm && desk.created != null && (
        <div className="mt-4">
          <h3 className="mb-2 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">By RM</h3>
          <RmTable
            rows={people}
            rmHref={rmHref}
            cols={[
              { key: "n", label: "Proposals", get: (r) => r.proposals },
              { key: "v", label: "Value", get: (r) => r.proposalValue, format: "currency" },
              { key: "c", label: "Converted", get: (r) => r.proposalsConverted, tone: (v) => (v ? "good" : "neutral") },
              {
                key: "rate", label: "Conversion", title: "Accepted ÷ decided, for proposals written in the period.",
                get: (r) => ratio(r.proposalsConverted, r.proposalsDecided), format: "percent",
                total: (rs) => ratio(sumOf((r) => r.proposalsConverted)(rs), sumOf((r) => r.proposalsDecided)(rs)),
              },
              { key: "live", label: "Pending", title: "Sent, viewed or ready — whenever written.", get: (r) => r.proposalsLive,
                tone: (v) => (v ? "warn" : "neutral") },
              {
                key: "age", label: "Avg days pending", get: (r) => r.proposalAvgDaysPending == null ? null : Math.round(r.proposalAvgDaysPending),
                tone: (v) => (v != null && v > ageingDays ? "warn" : "neutral"), total: "none",
              },
            ]}
          />
        </div>
      )}
      {desk.rows.length > 0 && (
        <div className="mt-4">
          <h3 className="mb-2 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Latest proposals</h3>
          <Table
            rows={desk.rows.length}
            empty="No proposals beyond draft."
            head={
              <>
                <th scope="col">Client</th>
                {voice.showRm && <th scope="col">Prepared by</th>}
                <th scope="col">Product</th>
                <th scope="col" className="text-right">Amount</th>
                <th scope="col">Shared</th>
                <th scope="col">Status</th>
                <th scope="col" className="text-right">Ageing</th>
                <th scope="col">Next follow-up</th>
              </>
            }
          >
            {desk.rows.map((r) => (
              <tr key={r.id}>
                <td className="py-2.5">
                  <Link href={`/dashboard/proposals/${r.id}`} className="font-medium hover:text-primary hover:underline">{r.client}</Link>
                </td>
                {voice.showRm && <td className="py-2.5 text-xs">{r.preparedBy ?? <span className="text-muted-foreground">—</span>}</td>}
                <td className="py-2.5 text-xs">{humanise(r.product)}</td>
                <Num>{formatMoney(r.amount)}</Num>
                <td className="whitespace-nowrap py-2.5 text-xs">{r.date ? formatDate(r.date) : "—"}</td>
                <td className="py-2.5">
                  <span className={cn(
                    "chip",
                    ["accepted", "executed", "partially_approved"].includes(r.status) ? "bg-success/10 text-success"
                    : ["rejected", "expired"].includes(r.status) ? "bg-secondary text-secondary-foreground"
                    : "bg-warning/10 text-warning-foreground",
                  )}>{humanise(r.status)}</span>
                </td>
                <Num tone={r.daysPending != null && r.daysPending > ageingDays ? "warn" : "neutral"}>
                  {r.daysPending == null ? <span className="text-muted-foreground">—</span> : `${r.daysPending}d`}
                </Num>
                <td className="whitespace-nowrap py-2.5 text-xs">
                  {/* A proposal carries no follow-up date; the follow-up falls
                      due N days after it was shared (the firm's threshold). */}
                  {r.date && ["sent", "viewed", "ready"].includes(r.status)
                    ? (() => {
                        const d = new Date(r.date);
                        d.setDate(d.getDate() + ageingDays);
                        const late = r.daysPending != null && r.daysPending > ageingDays;
                        return <span className={late ? "font-semibold text-destructive" : undefined}>{formatDate(d.toISOString())}</span>;
                      })()
                    : <span className="text-muted-foreground">—</span>}
                </td>
              </tr>
            ))}
          </Table>
        </div>
      )}
    </Section>
  );
}

/* ─────────────────────────── §13 meetings ─────────────────────────── */

export function BranchMeetings({
  desk, ledger, voice, rmHref, periodLabel, phase, staffIds,
}: {
  desk: MeetingDesk;
  ledger: RmLedgerRow[];
  voice: Voice;
  rmHref: (id: string) => string;
  periodLabel: string;
  /** Share of an annual meetings target the period carries; null = no period target. */
  phase: number | null;
  staffIds: string;
}) {
  const people = ledger.filter((r) => r.kind === "person" && (r.isRm || (r.meetingsHeld ?? 0) > 0));
  const target = (r: RmLedgerRow) => (r.targets.meetings != null && phase != null ? r.targets.meetings * phase : null);
  const cols: RmCol[] = [
    { key: "new", label: "New meetings", get: (r) => r.newMeetings },
    { key: "rev", label: "Review meetings", get: (r) => r.reviewMeetings },
    { key: "tot", label: "Total held", get: (r) => r.meetingsHeld },
    { key: "can", label: "Cancelled", get: (r) => r.meetingsCancelled },
    { key: "tgt", label: "Target", title: "The RM's annual meetings target, phased to the period.",
      get: (r) => (target(r) == null ? null : Math.round((target(r) as number) * 10) / 10), total: "none" },
    {
      key: "ach", label: "Achievement", get: (r) => ratio(r.meetingsHeld, target(r)), format: "percent", total: "none",
      tone: (v) => (v == null ? "neutral" : v >= 1 ? "good" : "neutral"),
    },
  ];
  return (
    <Section
      title={voice.title("meetings")}
      subtitle={`Meetings the branch's people held in ${periodLabel}.`}
      icon={<CalendarDays className="size-4" />}
      action={<SectionLink href={`/dashboard/review-meetings?rm=${staffIds}`}>All meetings</SectionLink>}
      note="Meeting → proposal and meeting → client conversion are not shown: the CRM does not record which proposal or which new client came out of which meeting, so any such rate would be a guess."
    >
      {desk.total == null ? (
        <Unavailable>No meeting has ever been logged by anyone in this view.</Unavailable>
      ) : (
        <StatGrid cols={6}>
          <Stat label="New meetings" value={desk.newMeetings} />
          <Stat label="Review meetings" value={desk.reviewMeetings} />
          <Stat label="Total" value={desk.total} />
          <Stat label="Completed" value={desk.completed} tone={(desk.completed ?? 0) > 0 ? "good" : "neutral"} />
          <Stat label="Cancelled" value={desk.cancelled} tone={(desk.cancelled ?? 0) > 0 ? "warn" : "neutral"} />
          <Stat label="Follow-up pending" value={desk.followUpsPending} tone={(desk.followUpsPending ?? 0) > 0 ? "warn" : "neutral"}
                hint="met, nothing booked after" />
        </StatGrid>
      )}
      {/* With no meeting ever logged, a table of zeros would state "nobody met
          anyone" — the CRM does not know that. */}
      {voice.showRm && desk.total != null && (
        <div className="mt-4">
          <RmTable rows={people} cols={cols} rmHref={rmHref} />
        </div>
      )}
    </Section>
  );
}

/* ─────────────────────────── §14 client reviews ─────────────────────────── */

export function BranchReviews({
  data, ledger, voice, rmHref,
}: {
  data: ReviewDesk;
  ledger: RmLedgerRow[];
  voice: Voice;
  rmHref: (id: string) => string;
}) {
  // No meeting ever logged: completed reviews are UNKNOWN, not zero, so the
  // completed and completion columns read "—" rather than 0 and 0%.
  const logged = data.completedThisMonth != null;
  const done = (r: RmLedgerRow) => (logged ? r.reviewMeetings : null);
  const due = (r: RmLedgerRow) => (done(r) ?? 0) + r.reviewsDueInPeriod;
  return (
    <Section
      title={voice.say("Review meeting management", "Client review management")}
      subtitle="Who is owed a review — worst first: days overdue, then category, then AUM."
      icon={<CalendarCheck className="size-4" />}
      action={<SectionLink href={voice.clients("review=overdue")}>Overdue reviews</SectionLink>}
      note="Clients with no review date are counted as never reviewed, not as overdue — nobody has missed a date that was never set. The order is plain: days overdue, then A before B before C, then AUM. No hidden score."
    >
      <div id="reviews" className="scroll-mt-40" />
      <StatGrid cols={6}>
        <Stat label="Due today" value={data.dueToday} tone={data.dueToday > 0 ? "warn" : "neutral"} href={voice.clients("review=due")} />
        <Stat label="Due this week" value={data.dueThisWeek} />
        <Stat label="Due this month" value={data.dueThisMonth} />
        <Stat label="Overdue" value={data.overdue} tone={data.overdue > 0 ? "bad" : "neutral"} href={voice.clients("review=overdue")} />
        <Stat label="Completed MTD" value={data.completedThisMonth} tone={(data.completedThisMonth ?? 0) > 0 ? "good" : "neutral"}
              unavailable="No meeting has ever been logged in this view, so completed reviews cannot be counted." />
        <Stat label="Never reviewed" value={data.neverReviewed} tone={data.neverReviewed > 0 ? "warn" : "neutral"} hint="no review on record" />
      </StatGrid>

      {voice.showRm && (
        <div className="mt-4">
          <h3 className="mb-2 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Review completion by RM</h3>
          <RmTable
            rows={rmRows(ledger)}
            rmHref={rmHref}
            cols={[
              { key: "due", label: "Due", title: "Reviews held in the period plus reviews still due by its end.",
                get: (r) => (r.kind === "person" ? due(r) : r.reviewsDueInPeriod) },
              { key: "done", label: "Completed", title: "Review meetings the RM held in the period.", get: done,
                tone: (v) => (v ? "good" : "neutral") },
              { key: "pend", label: "Pending", title: "Clients whose review date falls on or before the period end and has not moved on.",
                get: (r) => r.reviewsDueInPeriod },
              { key: "od", label: "Overdue", get: (r) => r.reviewsOverdue, tone: (v) => (v ? "bad" : "neutral") },
              {
                key: "pct", label: "Completion", title: "Completed ÷ due.",
                get: (r) => (r.kind === "person" && logged ? ratio(r.reviewMeetings, due(r)) : null), format: "percent",
                total: (rs) => (logged ? ratio(sumOf(done)(rs), sumOf((r) => (r.kind === "person" ? due(r) : r.reviewsDueInPeriod))(rs)) : null),
              },
              { key: "never", label: "Never reviewed", get: (r) => r.neverReviewed },
            ]}
          />
        </div>
      )}

      <div className="mt-4">
        <h3 className="mb-2 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Priority list</h3>
        <Table
          rows={data.rows.length}
          empty="No review is overdue or due in the next 30 days."
          head={
            <>
              <th scope="col">Client</th>
              <th scope="col">Category</th>
              {voice.showRm && <th scope="col">RM</th>}
              <th scope="col" className="text-right">AUM</th>
              <th scope="col">Last review</th>
              <th scope="col">Next review</th>
              <th scope="col" className="text-right">Days due / overdue</th>
              <th scope="col">Status</th>
              {voice.book === "mine" && <th scope="col" className="text-right">Action</th>}
            </>
          }
        >
          {data.rows.map((r) => {
            const over = r.daysOverdue != null && r.daysOverdue > 0;
            const ab = r.category === "A" || r.category === "B";
            return (
              <tr key={r.id}>
                <td className="py-2.5">
                  <Link href={`/dashboard/investors/${r.id}`} className="font-medium hover:text-primary hover:underline">{r.name}</Link>
                </td>
                <td className="py-2.5"><CategoryTag value={r.category} /></td>
                {voice.showRm && <td className="py-2.5 text-xs">{r.rm ?? <span className="text-muted-foreground">No RM</span>}</td>}
                <Num>{formatMoney(r.aum)}</Num>
                <td className="py-2.5 text-xs">
                  {r.lastReview ? formatDate(r.lastReview) : <span className="text-muted-foreground">Never</span>}
                </td>
                <td className="py-2.5 text-xs">
                  {r.nextReview ? formatDate(r.nextReview) : <span className="text-muted-foreground">Not scheduled</span>}
                </td>
                <Num tone={over && ab ? "bad" : over ? "warn" : "neutral"}>
                  {r.daysOverdue == null ? <span className="text-muted-foreground">—</span>
                    : over ? `${pluralDays(r.daysOverdue)} over`
                    : r.daysOverdue === 0 ? "Due today" : `in ${pluralDays(-r.daysOverdue)}`}
                </Num>
                <td className="py-2.5 text-xs">
                  {r.booked ? <span className="chip bg-success/10 text-success">Meeting booked</span>
                    : over ? <span className="chip bg-destructive/10 text-destructive">Overdue</span>
                    : r.nextReview ? <span className="chip bg-secondary text-secondary-foreground">Due</span>
                    : <span className="text-muted-foreground">Not scheduled</span>}
                </td>
                {voice.book === "mine" && (
                  <td className="py-2.5 text-right">
                    {r.booked ? <span className="text-2xs text-muted-foreground">Booked</span> : (
                      <Link href={`/dashboard/review-meetings/new?investorId=${r.id}&category=review`}
                            className="text-xs font-medium text-primary hover:underline">Schedule review</Link>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </Table>
      </div>
    </Section>
  );
}
