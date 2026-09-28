/**
 * §17 RM activity productivity, §18 tasks, §19 client queries.
 *
 * Activity is shown BESIDE its outcome and never coloured on its own. Forty
 * calls that produced nothing and four that opened a ₹50 L relationship are
 * both "activity"; painting the forty green would teach the branch to make
 * calls rather than business.
 */

import Link from "next/link";
import { Activity, ClipboardList, Headset } from "lucide-react";
import type { MyQueries, MyTasks } from "@/lib/dashboard/my/pipeline";
import type { RmLedgerRow } from "@/lib/dashboard/branch/rm-ledger";
import { ratio } from "@/lib/dashboard/branch/targets";
import { Num, Section, SectionLink, Stat, StatGrid, Table, Unavailable } from "@/components/dashboards/my/Shared";
import { TaskSide } from "@/components/dashboards/my/MyWork";
import { formatCount, formatDate, humanise, pluralDays } from "@/lib/format";
import { cn } from "@/lib/utils";
import { RmTable, rmRows, peopleRows } from "./RmTable";

const sumOf = (f: (r: RmLedgerRow) => number | null) => (rs: RmLedgerRow[]) => rs.reduce((s, r) => s + (f(r) ?? 0), 0);

/* ─────────────────────── §17 activity → outcome ─────────────────────── */

export function BranchActivity({
  ledger, rmHref, periodLabel,
}: {
  ledger: RmLedgerRow[];
  rmHref: (id: string) => string;
  periodLabel: string;
}) {
  const rows = peopleRows(ledger, (r) => r.isRm || (r.calls ?? 0) > 0 || (r.tasksDone ?? 0) > 0);
  return (
    <Section
      title="RM activity and outcome"
      subtitle={`What each RM did in ${periodLabel}, next to what it produced.`}
      icon={<Activity className="size-4" />}
      note="Deliberately uncoloured. High activity is not automatically good and low activity is not automatically bad — read the activity columns against the outcome columns on the right, and ask why where they diverge."
    >
      <RmTable
        rows={rows}
        rmHref={rmHref}
        cols={[
          { key: "m", label: "Meetings", get: (r) => r.meetingsHeld },
          { key: "rv", label: "Reviews", get: (r) => r.reviewMeetings },
          { key: "c", label: "Calls", title: "Calls logged as activities.", get: (r) => r.calls },
          { key: "fu", label: "Lead follow-ups", get: (r) => r.leadFollowUps },
          { key: "l", label: "New leads", get: (r) => r.leadsNew },
          { key: "p", label: "Proposals", get: (r) => r.proposals },
          { key: "td", label: "Tasks done", get: (r) => r.tasksDone },
          { key: "nc", label: "→ New clients", title: "Outcome: clients added to the RM's book in this branch.", get: (r) => r.newClients },
          { key: "ns", label: "→ Net SIP", title: "Outcome: gross new SIP less SIP stopped.", get: (r) => r.grossSip - r.sipStop, format: "currency" },
          { key: "nb", label: "→ Net business", title: "Outcome: gross investment less redemption.", get: (r) => r.grossInvestment - r.redemption, format: "currency" },
        ]}
      />
    </Section>
  );
}

/* ─────────────────────────── §18 tasks ─────────────────────────── */

export function BranchTasks({
  data, ledger, rmHref, periodLabel, staffIds,
}: {
  data: MyTasks;
  ledger: RmLedgerRow[];
  rmHref: (id: string) => string;
  periodLabel: string;
  staffIds: string;
}) {
  const rows = peopleRows(ledger, (r) => (r.tasksAssigned ?? 0) > 0 || (r.tasksOpenNow ?? 0) > 0 || r.isRm);
  const oldest = [...data.overdue].sort((a, b) => b.daysOver - a.daysOver);
  return (
    <Section
      title="Task management"
      subtitle={`Work raised for the branch's people in ${periodLabel}, financial and non-financial.`}
      icon={<ClipboardList className="size-4" />}
      action={<SectionLink href={`/dashboard/tasks?assignee=${staffIds}`}>All branch tasks</SectionLink>}
      note="Completion counts the tasks RAISED in the period and how many of those closed — otherwise clearing a backlog would read as over 100%. Pending and overdue NOW are today's backlog, whenever it was raised. Financial tasks are the ones where money moves (transactions, mandates, SIP instructions)."
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <TaskSide title="Financial" data={data.financial} hint="Transactions, mandates, SIP instructions" />
        <TaskSide title="Non-financial" data={data.nonFinancial} hint="KYC, nominee, bank and record changes" />
      </div>
      <div className="mt-4">
        <h3 className="mb-2 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">By person</h3>
        <RmTable
          rows={rows}
          rmHref={rmHref}
          empty="No tasks were raised for anyone in this view in the period."
          cols={[
            { key: "a", label: "Raised in period", get: (r) => r.tasksAssigned,
              href: (r) => (r.kind === "person" ? `/dashboard/tasks?assignee=${r.id}` : null) },
            { key: "d", label: "Completed", title: "Of the tasks raised in the period.", get: (r) => r.tasksDone },
            { key: "pct", label: "Completion", get: (r) => ratio(r.tasksDone, r.tasksAssigned), format: "percent",
              total: (rs) => ratio(sumOf((r) => r.tasksDone)(rs), sumOf((r) => r.tasksAssigned)(rs)) },
            { key: "p", label: "Pending now", title: "All open tasks today, whenever raised.", get: (r) => r.tasksOpenNow },
            { key: "o", label: "Overdue now", title: "Open tasks past their due date today, whenever raised.",
              get: (r) => r.tasksOverdueNow, tone: (v) => (v ? "bad" : "neutral"),
              href: (r) => (r.kind === "person" ? `/dashboard/tasks?assignee=${r.id}&due=overdue` : null) },
            { key: "fo", label: "Financial overdue", title: "Overdue now, on tasks where money moves.",
              get: (r) => r.finTasksOverdueNow, tone: (v) => (v ? "bad" : "neutral") },
          ]}
        />
      </div>
      <div className="mt-4">
        <h3 className="mb-2 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
          Oldest pending <span className="font-normal normal-case tracking-normal">&mdash; whenever raised</span>
        </h3>
        <Table
          rows={oldest.length}
          empty="Nothing is past its due date."
          head={
            <>
              <th scope="col">Task</th>
              <th scope="col">Client</th>
              <th scope="col">Assigned to</th>
              <th scope="col" className="text-right">Overdue by</th>
            </>
          }
        >
          {oldest.map((t) => (
            <tr key={t.id}>
              <td className="py-2.5">
                <Link href={`/dashboard/tasks?task=${t.id}`} className="font-medium hover:text-primary hover:underline">{t.title}</Link>
                <span className="ml-1.5 text-2xs text-muted-foreground">{humanise(t.type)}</span>
              </td>
              <td className="py-2.5 text-xs">{t.client ?? <span className="text-muted-foreground">—</span>}</td>
              <td className="py-2.5 text-xs">{t.assignee ?? <span className="text-muted-foreground">Unassigned</span>}</td>
              <Num tone="bad">{pluralDays(t.daysOver)}</Num>
            </tr>
          ))}
        </Table>
      </div>
    </Section>
  );
}

/* ─────────────────────────── §19 client queries ─────────────────────────── */

function Breakdown({ title, items }: { title: string; items: Array<{ label: string; count: number }> }) {
  const peak = Math.max(1, ...items.map((i) => i.count));
  return (
    <div>
      <h4 className="mb-1.5 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h4>
      {items.length === 0 ? (
        <p className="text-2xs text-muted-foreground">Nothing open.</p>
      ) : (
        <div className="space-y-1">
          {items.map((i) => (
            <div key={i.label} className="grid grid-cols-12 items-center gap-2 text-2xs">
              <span className="col-span-5 truncate">{i.label}</span>
              <span className="col-span-5 h-1.5 rounded-full bg-secondary" aria-hidden>
                <span className="block h-full rounded-full bg-primary/60" style={{ width: `${(i.count / peak) * 100}%` }} />
              </span>
              <span className="col-span-2 text-right font-medium tabular-nums">{formatCount(i.count)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function BranchQueries({
  data, ledger, rmHref, periodLabel, canOpen, showRm,
}: {
  data: MyQueries;
  ledger: RmLedgerRow[];
  rmHref: (id: string) => string;
  periodLabel: string;
  /** The viewer may open the query register — otherwise counts are shown unlinked. */
  canOpen: boolean;
  showRm: boolean;
}) {
  // Past SLA AND with us. A query waiting on the client is not an escalation —
  // the "Overdue" count above excludes it too, so the two agree.
  const escalation = data.rows.filter((r) => r.breached && r.status !== "waiting_customer");
  const link = (id: string) => (canOpen ? `/dashboard/service-requests/${id}` : null);
  return (
    <Section
      title="Client query and service health"
      subtitle="What the branch's clients are waiting on, however it is being handled."
      icon={<Headset className="size-4" />}
      action={canOpen ? <SectionLink href="/dashboard/service-requests?breached=1">Overdue queries</SectionLink> : undefined}
      note="Queries follow the CLIENT — a ticket sitting with operations is still this branch's client waiting. Waiting-on-client is counted apart so an RM is not charged for a delay at the other end."
    >
      <StatGrid cols={6}>
        <Stat label="Received" value={data.received} hint={periodLabel} />
        <Stat label="Solved" value={data.solved} hint={periodLabel} tone={data.solved > 0 ? "good" : "neutral"} />
        <Stat label="Open" value={data.open} tone={data.open > 0 ? "warn" : "neutral"} hint={`${data.waitingClient} waiting on client`} />
        <Stat label="Overdue" value={data.overdue} tone={data.overdue > 0 ? "bad" : "neutral"} hint="past SLA, with us" />
        <Stat
          label="Avg resolution"
          display={data.avgResolutionDays == null
            ? <span className="text-muted-foreground" title="Nothing was closed in the period, so there is no average.">—</span>
            : `${data.avgResolutionDays.toFixed(1)}d`}
          hint="raised to resolved"
        />
        <Stat
          label="Oldest open"
          display={data.oldestDays == null
            ? <span className="text-muted-foreground" title="Nothing is open.">—</span>
            : pluralDays(Math.round(data.oldestDays))}
          tone={data.oldestDays != null && data.oldestDays > 15 ? "bad" : "neutral"}
        />
      </StatGrid>

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <Breakdown title="Ageing" items={data.ageing.map((a) => ({ label: a.label, count: a.count }))} />
        <Breakdown title="Type" items={data.byType.map((t) => ({ label: humanise(t.type), count: t.open }))} />
        <Breakdown title="Status" items={data.byStatus.map((s) => ({ label: humanise(s.status), count: s.count }))} />
      </div>

      {showRm && (
        <div className="mt-4">
          <h3 className="mb-2 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">By RM</h3>
          <RmTable
            rows={rmRows(ledger)}
            rmHref={rmHref}
            cols={[
              { key: "o", label: "Open with us", get: (r) => r.queriesOpen, tone: (v) => (v ? "warn" : "neutral") },
              { key: "w", label: "Waiting on client", get: (r) => r.queriesWaiting },
              { key: "s", label: "Past SLA", get: (r) => r.queriesOverdue, tone: (v) => (v ? "bad" : "neutral") },
            ]}
          />
        </div>
      )}

      <div className="mt-4">
        <h3 className="mb-2 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Escalation — past SLA</h3>
        {escalation.length === 0 && data.overdue > 0 ? (
          <Unavailable>{data.overdue} queries are past SLA; open the register to see them all.</Unavailable>
        ) : (
          <Table
            rows={escalation.length}
            empty="No query is past its SLA."
            head={
              <>
                <th scope="col">Client</th>
                {showRm && <th scope="col">RM</th>}
                <th scope="col">Type</th>
                <th scope="col">Raised</th>
                <th scope="col" className="text-right">Age</th>
                <th scope="col">With</th>
                <th scope="col">Status</th>
              </>
            }
          >
            {escalation.map((r) => {
              const href = link(r.id);
              return (
                <tr key={r.id}>
                  <td className="py-2.5">
                    {href ? <Link href={href} className="font-medium hover:text-primary hover:underline">{r.client}</Link>
                          : <span className="font-medium">{r.client}</span>}
                  </td>
                  {showRm && <td className="py-2.5 text-xs">{r.rm ?? <span className="text-muted-foreground">No RM</span>}</td>}
                  <td className="py-2.5 text-xs">{humanise(r.type)}</td>
                  <td className="py-2.5 text-xs">{formatDate(r.created)}</td>
                  <Num tone="bad">{pluralDays(r.ageDays)}</Num>
                  <td className="py-2.5 text-xs">{r.assignedTo ?? <span className="text-muted-foreground">Unassigned</span>}</td>
                  <td className="py-2.5"><span className={cn("chip bg-destructive/10 text-destructive")}>{humanise(r.status)}</span></td>
                </tr>
              );
            })}
          </Table>
        )}
      </div>
    </Section>
  );
}
