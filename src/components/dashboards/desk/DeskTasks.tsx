/**
 * §24 Task dashboard — financial and non-financial side by side, and the
 * open tasks as a table with a complete action where the viewer may use it.
 *
 * Two kinds of figure, labelled as such: TODAY'S BACKLOG (due today, pending,
 * overdue, completed this month — whenever the task was raised) and the
 * period's COMPLETION RATE (of the tasks raised in the period, how many
 * closed), which is the only rate that cannot pass 100% in a catch-up month.
 */

import Link from "next/link";
import { ClipboardList } from "lucide-react";
import type { MyTasks, TaskBacklog } from "@/lib/dashboard/my/pipeline";
import { humanStatus } from "@/lib/dashboard/my/desk";
import { Num, Section, SectionLink, Table } from "@/components/dashboards/my/Shared";
import { formatCount, formatDate, formatPercent, pluralDays } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CompleteTaskButton } from "./CompleteTaskButton";

function Side({ title, hint, backlog, cohort }: {
  title: string; hint: string; backlog: TaskBacklog; cohort: MyTasks["financial"];
}) {
  const cells: Array<[string, number | string, "neutral" | "bad" | "warn"]> = [
    ["Assigned", cohort.assigned, "neutral"],
    ["Due today", backlog.dueToday, backlog.dueToday > 0 ? "warn" : "neutral"],
    ["Completed MTD", backlog.completedMtd, "neutral"],
    ["Pending", backlog.open, "neutral"],
    ["Overdue", backlog.overdue, backlog.overdue > 0 ? "bad" : "neutral"],
  ];
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="text-xs font-semibold text-foreground">{title}</h4>
        <span className="text-sm font-semibold tabular-nums"
              title={cohort.pct == null ? "Nothing was raised in the period, so there is no completion rate." : "Of the tasks raised in the period."}>
          {cohort.pct == null ? <span className="text-muted-foreground">—</span> : formatPercent(cohort.pct * 100, 0)}
          <span className="ml-1 text-2xs font-normal text-muted-foreground">completion</span>
        </span>
      </div>
      <p className="mt-0.5 text-2xs text-muted-foreground">{hint}</p>
      <dl className="mt-2.5 grid grid-cols-5 gap-2 text-2xs">
        {cells.map(([label, value, tone]) => (
          <div key={label}>
            <dt className="text-muted-foreground">{label}</dt>
            <dd className={cn("font-semibold tabular-nums",
              tone === "bad" ? "text-destructive" : tone === "warn" ? "text-warning-foreground" : "text-foreground")}>
              {typeof value === "number" ? formatCount(value) : value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function DeskTasks({ data, periodLabel, staffIds, canComplete }: {
  data: MyTasks; periodLabel: string; staffIds: string; canComplete: boolean;
}) {
  return (
    <Section
      title="My tasks"
      subtitle="Financial and non-financial work — today's backlog, and how much of this period's work closed."
      icon={<ClipboardList className="size-4" />}
      action={<SectionLink href={`/dashboard/tasks?assignee=${staffIds}`}>All my tasks</SectionLink>}
      note={`"Assigned" and completion cover tasks raised in ${periodLabel}; due today, pending, overdue and completed MTD are today's backlog, whenever raised. Financial tasks are the ones where money moves.`}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Side title="Financial" hint="Transactions, mandates, SIP instructions" backlog={data.backlog.financial} cohort={data.financial} />
        <Side title="Non-financial" hint="KYC, nominee, bank and record changes" backlog={data.backlog.nonFinancial} cohort={data.nonFinancial} />
      </div>
      <div className="mt-4">
        <Table
          rows={data.openRows.length}
          empty="No open task."
          head={
            <>
              <th scope="col">Task</th>
              <th scope="col">Client</th>
              <th scope="col">Type</th>
              <th scope="col">Assigned</th>
              <th scope="col">Due</th>
              <th scope="col" className="text-right">Ageing</th>
              <th scope="col">Status</th>
              {/* relative: an sr-only label is absolutely positioned, and without a
                  positioned cell it escapes the table's scroll box and widens the
                  whole page on a phone. */}
              {canComplete && <th scope="col" className="relative text-right"><span className="sr-only">Complete</span></th>}
            </>
          }
        >
          {data.openRows.map((t) => (
            <tr key={t.id}>
              <td className="py-2.5">
                <Link href={`/dashboard/tasks?task=${t.id}`} className="font-medium hover:text-primary hover:underline">{t.title}</Link>
                {t.financial && <span className="ml-1.5 chip bg-secondary text-secondary-foreground">Financial</span>}
              </td>
              <td className="py-2.5 text-xs">
                {t.clientId ? <Link href={`/dashboard/investors/${t.clientId}`} className="hover:text-primary hover:underline">{t.client}</Link>
                  : <span className="text-muted-foreground">—</span>}
              </td>
              <td className="py-2.5 text-xs">{humanStatus(t.type)}</td>
              <td className="whitespace-nowrap py-2.5 text-xs">{formatDate(t.created)}</td>
              <td className={cn("whitespace-nowrap py-2.5 text-xs", t.overdue && "font-semibold text-destructive")}>
                {t.due ? formatDate(t.due) : <span className="text-muted-foreground">No due date</span>}
              </td>
              <Num>{pluralDays(t.ageDays)}</Num>
              <td className="py-2.5 text-xs">{t.overdue ? <span className="text-destructive">Overdue</span> : humanStatus(t.status)}</td>
              {canComplete && (
                <td className="py-2.5 text-right"><CompleteTaskButton taskId={t.id} title={t.title} /></td>
              )}
            </tr>
          ))}
        </Table>
      </div>
    </Section>
  );
}
