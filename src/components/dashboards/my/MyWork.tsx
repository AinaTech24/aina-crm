/**
 * §15 my tasks and §16 my query tracker.
 *
 * Tasks are split financial / non-financial because in an MFD office they are
 * genuinely different work with different SLAs — a redemption instruction and
 * a nominee update do not belong in one number. The split comes from the task
 * TYPE, not the department; see FINANCIAL_TASK_TYPES for why.
 *
 * Completion is COHORT completion: of the work raised in this period, how much
 * closed. Counting what closed in the period instead pushes the rate past 100%
 * in a catch-up month and flatters a genuinely bad one.
 */

import Link from "next/link";
import { ClipboardList, Headset } from "lucide-react";
import type { MyQueries, MyTasks } from "@/lib/dashboard/my/pipeline";
import { Num, Section, SectionLink, Stat, StatGrid, Table } from "./Shared";
import { formatCount, formatDate, formatPercent, humanise, pluralDays } from "@/lib/format";
import { cn } from "@/lib/utils";

const PRIORITY: Record<string, string> = {
  urgent: "bg-destructive/10 text-destructive",
  high: "bg-warning/10 text-warning-foreground",
  normal: "bg-secondary text-secondary-foreground",
  low: "bg-secondary text-secondary-foreground",
};

export function TaskSide({
  title,
  data,
  hint,
}: {
  title: string;
  data: MyTasks["financial"];
  hint: string;
}) {
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="text-xs font-semibold text-foreground">{title}</h4>
        <span
          className={cn(
            "text-sm font-semibold tabular-nums",
            data.pct == null ? "text-muted-foreground" : data.pct >= 0.7 ? "text-success" : "text-warning-foreground",
          )}
          title={data.pct == null ? "Nothing raised in this period, so there is no completion rate." : undefined}
        >
          {data.pct == null ? "—" : formatPercent(data.pct * 100, 0)}
        </span>
      </div>
      <p className="mt-0.5 text-2xs text-muted-foreground">{hint}</p>
      <dl className="mt-2.5 grid grid-cols-4 gap-2 text-2xs">
        {([
          ["Assigned", data.assigned, "neutral"],
          ["Done", data.completed, data.completed > 0 ? "good" : "neutral"],
          ["Open", data.pending, "neutral"],
          ["Overdue", data.overdue, data.overdue > 0 ? "bad" : "neutral"],
        ] as const).map(([label, value, tone]) => (
          <div key={label}>
            <dt className="text-muted-foreground">{label}</dt>
            <dd
              className={cn(
                "font-semibold tabular-nums",
                tone === "good" ? "text-success" : tone === "bad" ? "text-destructive" : "text-foreground",
              )}
            >
              {formatCount(value)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function MyTaskPanel({ data, periodLabel, staffIds }: {
  data: MyTasks;
  periodLabel: string;
  /** Comma list of the book's people — the tasks list reads `?assignee=a,b,c`. */
  staffIds: string;
}) {
  return (
    <Section
      title="My tasks"
      subtitle={`Work assigned to me and raised in ${periodLabel}.`}
      icon={<ClipboardList className="size-4" />}
      action={<SectionLink href={`/dashboard/tasks?assignee=${staffIds}`}>All my tasks</SectionLink>}
      note="Completion counts the tasks RAISED in this period, not the ones closed in it — otherwise clearing a backlog would read as over 100%."
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <TaskSide title="Financial" data={data.financial} hint="Transactions, mandates, SIP instructions" />
        <TaskSide title="Non-financial" data={data.nonFinancial} hint="KYC, nominee, bank and record changes" />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div>
          <h3 className="mb-2 text-2xs font-semibold text-muted-foreground">
            Due today <span className="font-normal normal-case tracking-normal">&mdash; whenever it was raised</span>
          </h3>
          <Table
            rows={data.today.length}
            empty="Nothing due today."
            head={
              <>
                <th scope="col">Task</th>
                <th scope="col">Client</th>
                <th scope="col">Priority</th>
              </>
            }
          >
            {data.today.map((t) => (
              <tr key={t.id}>
                <td className="py-2.5">
                  <Link href={`/dashboard/tasks?task=${t.id}`} className="font-medium hover:text-primary hover:underline">{t.title}</Link>
                  <span className="ml-1.5 text-2xs text-muted-foreground">{humanise(t.type)}</span>
                </td>
                <td className="py-2.5 text-xs">{t.client ?? <span className="text-muted-foreground">—</span>}</td>
                <td className="py-2.5"><span className={cn("chip", PRIORITY[t.priority] ?? PRIORITY.normal)}>{humanise(t.priority)}</span></td>
              </tr>
            ))}
          </Table>
        </div>
        <div>
          {/* Labelled "whenever raised" because the counters above ARE
              period-scoped. Without it, "0 assigned this month" sitting beside
              a task 78 days late reads as a contradiction rather than as two
              different questions. */}
          <h3 className="mb-2 text-2xs font-semibold text-muted-foreground">
            Overdue <span className="font-normal normal-case tracking-normal">&mdash; whenever it was raised</span>
          </h3>
          <Table
            rows={data.overdue.length}
            empty="Nothing past its due date."
            head={
              <>
                <th scope="col">Task</th>
                <th scope="col">Client</th>
                <th scope="col" className="text-right">Overdue by</th>
              </>
            }
          >
            {data.overdue.map((t) => (
              <tr key={t.id}>
                <td className="py-2.5">
                  <Link href={`/dashboard/tasks?task=${t.id}`} className="font-medium hover:text-primary hover:underline">{t.title}</Link>
                  <span className="ml-1.5 text-2xs text-muted-foreground">{humanise(t.type)}</span>
                </td>
                <td className="py-2.5 text-xs">{t.client ?? <span className="text-muted-foreground">—</span>}</td>
                <Num tone="bad">{pluralDays(t.daysOver)}</Num>
              </tr>
            ))}
          </Table>
        </div>
      </div>
    </Section>
  );
}

export function MyQueryPanel({ data, periodLabel }: { data: MyQueries; periodLabel: string }) {
  return (
    <Section
      title="My clients' service requests"
      subtitle="What my clients are waiting on, however it is being handled."
      icon={<Headset className="size-4" />}
      action={<SectionLink href="/dashboard/service-requests?mine=1">All service requests</SectionLink>}
      note="Service requests are scoped to my clients, not to what is assigned to me — a ticket sitting with ops is still my client waiting. Waiting-on-client is counted separately so an RM is not charged for a delay at the other end."
    >
      <StatGrid cols={6}>
        <Stat label="Open with us" value={data.open} tone={data.open > 0 ? "warn" : "good"} />
        <Stat label="Waiting on client" value={data.waitingClient} hint="ball not in our court" />
        <Stat label="Received" value={data.received} hint={periodLabel} />
        <Stat label="Solved" value={data.solved} hint={periodLabel} tone={data.solved > 0 ? "good" : "neutral"} />
        <Stat label="Past SLA" value={data.overdue} tone={data.overdue > 0 ? "bad" : "good"} />
        <Stat
          label="Avg resolution"
          display={
            data.avgResolutionDays == null ? (
              <span className="text-muted-foreground" title="Nothing was closed in this period, so there is no average.">—</span>
            ) : (
              `${data.avgResolutionDays.toFixed(1)}d`
            )
          }
          hint={data.oldestDays != null ? `oldest open ${Math.round(data.oldestDays)}d` : "raised to resolved"}
        />
      </StatGrid>

      <div className="mt-4">
        <Table
          rows={data.rows.length}
          empty="Nothing open — every service request from your clients has been answered."
          head={
            <>
              <th scope="col">Client</th>
              <th scope="col">Request type</th>
              <th scope="col">Raised</th>
              <th scope="col" className="text-right">Ageing</th>
              <th scope="col">Assigned to</th>
              <th scope="col">Status</th>
              <th scope="col">Remarks</th>
            </>
          }
        >
          {data.rows.map((r) => (
            <tr key={r.id}>
              <td className="py-2.5">
                <Link href={`/dashboard/service-requests/${r.id}`} className="font-medium hover:text-primary hover:underline">{r.client}</Link>
              </td>
              <td className="py-2.5 text-xs">{humanise(r.type)}</td>
              <td className="py-2.5 text-xs">{formatDate(r.created)}</td>
              <Num tone={r.ageDays > 15 ? "bad" : r.ageDays > 7 ? "warn" : "neutral"}>{pluralDays(r.ageDays)}</Num>
              <td className="py-2.5 text-xs">
                {r.assignedTo ?? <span className="text-muted-foreground" title="Nobody has been assigned to this service request.">Unassigned</span>}
              </td>
              <td className="py-2.5">
                <span
                  className={cn(
                    "chip",
                    r.breached ? "bg-destructive/10 text-destructive"
                    : r.status === "waiting_customer" ? "bg-secondary text-secondary-foreground"
                    : "bg-warning/10 text-warning-foreground",
                  )}
                >
                  {humanise(r.status)}
                </span>
              </td>
              <td className="py-2.5 text-xs">{r.remarks ?? <span className="text-muted-foreground">—</span>}</td>
            </tr>
          ))}
        </Table>
      </div>
    </Section>
  );
}
