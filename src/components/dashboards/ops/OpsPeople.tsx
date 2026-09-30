/**
 * People and ownership sections of the Operations page: team
 * workload and its distribution (§17–18), productivity (§19), the financial,
 * non-financial and approval queues (§20–22), back-office work (§25), and
 * the branch- and RM-wise views (§26–27).
 *
 * Workload is for balancing, never a ranking (§17–18): executives are listed
 * alphabetically, with no score and no "top performer".
 */

import Link from "next/link";
import { BarChart3, Briefcase, ClipboardCheck, GitPullRequestArrow, ListChecks, Network, Stamp, UsersRound } from "lucide-react";
import { Num, Section, Stat, StatGrid, Table, Unavailable } from "../my/Shared";
import { Badge } from "@/components/ui/Badge";
import { formatCount, formatMoney, formatPercent } from "@/lib/format";
import { fmtHours, fmtIstDay, STATUS_TONE, inPeriod, periodNoun } from "@/lib/dashboard/ops/fmt";
import { STATUS_LABEL } from "@/lib/dashboard/ops/window";
import type { Approvals, BoRow, BranchRow, ExecRow, Productivity, RmRow, TaskQueue } from "@/lib/dashboard/ops/people";
import { cn } from "@/lib/utils";

/* ───────────────────────────── §17–18 ───────────────────────────── */

export function TeamPanel({ rows, hrefFor }: { rows: ExecRow[]; hrefFor: Record<string, string> }) {
  const maxPending = Math.max(1, ...rows.map((r) => r.pending));
  const maxValue = Math.max(1, ...rows.map((r) => r.value));
  const maxBreach = Math.max(1, ...rows.map((r) => r.overdue));
  return (
    <Section
      title="Team workload"
      icon={<UsersRound className="size-4" />}
      note="Transaction complexity differs, so counts are not a performance score. Average TAT covers requests each person completed in the period."
    >
      <Table rows={rows.length} empty="No one in the operations team yet." head={<>
        <th scope="col">Executive</th>
        <th scope="col" className="text-right">Pending</th>
        <th scope="col" className="text-right">Received today</th>
        <th scope="col" className="text-right">Completed today</th>
        <th scope="col" className="text-right">Overdue</th>
        <th scope="col" className="text-right">Avg TAT</th>
        <th scope="col" className="text-right">Oldest case</th>
      </>}>
        {rows.map((r) => (
          <tr key={r.id ?? "none"}>
            <td className="py-2.5 text-xs font-medium">
              {r.id ? <Link href={hrefFor[r.id] ?? "#queue"} className="hover:text-primary hover:underline">{r.name}</Link>
                : <Link href={hrefFor.none ?? "#queue"} className="text-warning-foreground hover:underline">{r.name}</Link>}
              {r.id && !r.isOps && <div className="text-2xs font-normal text-muted-foreground">outside operations</div>}
            </td>
            <Num>{formatCount(r.pending)}</Num>
            <Num>{formatCount(r.receivedToday)}</Num>
            <Num tone={r.completedToday ? "good" : "neutral"}>{formatCount(r.completedToday)}</Num>
            <Num tone={r.overdue ? "bad" : "neutral"}>{formatCount(r.overdue)}</Num>
            <Num>{fmtHours(r.avgTat)}</Num>
            <Num tone={r.oldestDays != null && r.oldestDays > 7 ? "warn" : "neutral"}>{r.oldestDays == null ? "—" : `${r.oldestDays} d`}</Num>
          </tr>
        ))}
      </Table>

      {rows.length > 0 && (
        <>
          <h3 className="mb-2 mt-5 text-xs font-semibold text-foreground">Workload distribution — for balancing, not scoring</h3>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <DistList title="Pending cases" rows={rows.map((r) => ({ key: r.id ?? "none", name: r.name, value: r.pending, label: formatCount(r.pending) }))}
                      max={maxPending} tone="bg-primary/60" />
            <DistList title="Pending value ₹" rows={rows.map((r) => ({ key: r.id ?? "none", name: r.name, value: r.value, label: r.valued ? formatMoney(r.value) : "not recorded" }))}
                      max={maxValue} tone="bg-primary/40" />
            <DistList title="SLA breaches" rows={rows.map((r) => ({ key: r.id ?? "none", name: r.name, value: r.overdue, label: formatCount(r.overdue) }))}
                      max={maxBreach} tone="bg-destructive/70" />
            <div>
              <div className="mb-1.5 text-xs font-medium text-foreground">Request type mix</div>
              <ul className="space-y-1.5">
                {rows.filter((r) => r.mix.length > 0).map((r) => (
                  <li key={r.id ?? "none"} className="text-2xs">
                    <div className="truncate font-medium text-foreground">{r.name}</div>
                    <div className="mt-0.5 flex flex-wrap gap-1">
                      {r.mix.slice(0, 4).map((m) => (
                        <span key={m.kind} className="chip bg-secondary text-secondary-foreground">{m.label} {m.n}</span>
                      ))}
                    </div>
                  </li>
                ))}
                {rows.every((r) => r.mix.length === 0) && <li className="text-2xs text-muted-foreground">Nothing pending.</li>}
              </ul>
            </div>
          </div>
        </>
      )}
    </Section>
  );
}

function DistList({ title, rows, max, tone }: {
  title: string; rows: Array<{ key: string; name: string; value: number; label: string }>; max: number; tone: string;
}) {
  return (
    <div>
      <div className="mb-1.5 text-xs font-medium text-foreground">{title}</div>
      <ul className="space-y-1.5">
        {rows.map((r) => (
          <li key={r.key} className="text-2xs">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-foreground">{r.name}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">{r.label}</span>
            </div>
            <div className="mt-0.5 h-1.5 overflow-hidden rounded bg-secondary">
              <div className={cn("h-full rounded", tone)} style={{ width: `${r.value > 0 ? Math.max(4, (r.value / max) * 100) : 0}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ───────────────────────────── §19 ───────────────────────────── */

export function ProductivityPanel({ p }: { p: Productivity }) {
  const cell = (c: number, prev: number) => {
    const d = c - prev;
    return <>{formatCount(c)} <span className={cn("text-2xs", d === 0 ? "text-muted-foreground" : "text-foreground")}>
      ({d > 0 ? "+" : d < 0 ? "−" : "±"}{formatCount(Math.abs(d))})</span></>;
  };
  return (
    <Section
      title="Productivity"
      subtitle={`Today against the previous working day (${fmtIstDay(p.previousDay)}), and this week against last.`}
      icon={<BarChart3 className="size-4" />}
      note="The previous working day skips Sunday. Records updated counts requests, service requests and SIP rejections edited — a measure of movement, not of effort."
    >
      <Table rows={p.day.length} empty="—" head={<>
        <th scope="col">Measure</th>
        <th scope="col" className="text-right">Previous working day</th>
        <th scope="col" className="text-right">Today</th>
        <th scope="col" className="text-right">Last week</th>
        <th scope="col" className="text-right">This week</th>
      </>}>
        {p.day.map((r, k) => {
          const wk = p.week[k];
          return (
            <tr key={r.key}>
              <td className="py-2.5 text-xs font-medium" title={r.note}>{r.label}</td>
              <Num>{formatCount(r.previous)}</Num>
              <Num>{cell(r.current, r.previous)}</Num>
              <Num>{formatCount(wk.previous)}</Num>
              <Num>{cell(wk.current, wk.previous)}</Num>
            </tr>
          );
        })}
      </Table>
    </Section>
  );
}

/* ───────────────────────────── §20–22 ───────────────────────────── */

export function TaskQueuePanel({ q, financial, periodLabel, href }: { q: TaskQueue; financial: boolean; periodLabel: string; href: string }) {
  return (
    <Section
      title={financial ? "Financial tasks" : "Non-financial tasks"}
      icon={financial ? <ClipboardCheck className="size-4" /> : <ListChecks className="size-4" />}
      note={`Created and completed cover ${periodNoun(periodLabel)}; completion is completed ÷ (pending at the start + created).`}
    >
      <StatGrid cols={5}>
        <Stat label="Created" value={q.created} />
        <Stat label="Completed" value={q.completed} tone={q.completed ? "good" : "neutral"} />
        <Stat label="Pending" value={q.pending} href={href} hint={`${q.assigned} assigned`} />
        <Stat label="Overdue" value={q.overdue} tone={q.overdue ? "bad" : "neutral"} href={href} />
        <Stat label="Completion" display={q.completionPct == null ? "—" : formatPercent(q.completionPct * 100, 0)} />
      </StatGrid>
      <div className="mt-4">
        <Table rows={q.rows.length} empty="Nothing pending." head={<>
          <th scope="col">Task</th>
          <th scope="col">Client · RM · branch</th>
          <th scope="col">Assigned to</th>
          <th scope="col">Start</th>
          <th scope="col">Due</th>
          <th scope="col">Status</th>
          <th scope="col" className="text-right">Ageing</th>
        </>}>
          {q.rows.map((r) => (
            <tr key={r.id} className={cn(r.overdue && "bg-destructive/5")}>
              <td className="py-2.5 text-xs">
                <div className="w-56 whitespace-normal">
                  <Link href={`/dashboard/tasks?task=${r.id}`} className="font-medium hover:text-primary hover:underline">{r.title}</Link>
                  <div className="text-2xs text-muted-foreground">{r.kindLabel}</div>
                </div>
              </td>
              <td className="py-2.5 text-xs">
                {r.investorId ? <Link href={`/dashboard/investors/${r.investorId}`} className="hover:text-primary hover:underline">{r.client}</Link>
                  : <span className="text-muted-foreground">{r.client ?? "No client linked"}</span>}
                <div className="text-2xs text-muted-foreground">{[r.rm ?? "No RM", r.branch ?? "No branch"].join(" · ")}</div>
              </td>
              <td className="py-2.5 text-xs">{r.assignee ?? <span className="text-warning-foreground">Not assigned</span>}</td>
              <td className="whitespace-nowrap py-2.5 text-xs">{fmtIstDay(r.created)}</td>
              <td className={cn("whitespace-nowrap py-2.5 text-xs", r.overdue && "font-semibold text-destructive")}>{r.due ? fmtIstDay(r.due) : "—"}</td>
              <td className="py-2.5"><Badge raw tone={STATUS_TONE[r.status] ?? "neutral"}>{STATUS_LABEL[r.status] ?? r.status}</Badge></td>
              <Num>{r.ageDays} d</Num>
            </tr>
          ))}
        </Table>
        {q.more > 0 && <p className="mt-2 text-center text-2xs text-muted-foreground">{q.more} more — <Link href={href} className="text-primary hover:underline">open the list</Link>.</p>}
      </div>
    </Section>
  );
}

export function ApprovalsPanel({ a }: { a: Approvals }) {
  return (
    <Section
      title="Approval pending"
      icon={<Stamp className="size-4" />}
      note="Link-not-approved and similar sign-offs are requests marked for approval in the task module; the approver is whoever raised the request."
    >
      <Table rows={a.rows.length} empty="No request is awaiting approval." head={<>
        <th scope="col">Request</th>
        <th scope="col">Client</th>
        <th scope="col">Submitted by</th>
        <th scope="col">Approver</th>
        <th scope="col" className="text-right">Waiting</th>
      </>}>
        {a.rows.map((r) => (
          <tr key={r.id}>
            <td className="py-2.5 text-xs"><Link href={`/dashboard/tasks?approval=pending&task=${r.id}`} className="font-medium hover:text-primary hover:underline">{r.title}</Link></td>
            <td className="py-2.5 text-xs">{r.client ?? "—"}</td>
            <td className="py-2.5 text-xs">{r.assignee ?? "—"}</td>
            <td className="py-2.5 text-xs">{r.approver ?? "—"}</td>
            <Num tone={r.waitingDays != null && r.waitingDays > 1 ? "warn" : "neutral"}>{r.waitingDays == null ? "—" : `${r.waitingDays} d`}</Num>
          </tr>
        ))}
      </Table>
    </Section>
  );
}

/* ───────────────────────────── §25 ───────────────────────────── */

export function BackOfficePanel({ d, periodLabel }: { d: { rows: BoRow[]; any: boolean }; periodLabel: string }) {
  const anyUnrecorded = d.rows.some((r) => r.unrecorded.count > 0);
  const cell = (c: BoRow["online"]) => c.count === 0 ? <span className="text-muted-foreground">—</span> : (
    <div className="text-right">
      <div className="tabular-nums">{formatCount(c.count)} · {c.value ? formatMoney(c.value) : "₹ not recorded"}</div>
      <div className="text-2xs text-muted-foreground">{c.completed} done · {c.pending} pending</div>
    </div>
  );
  return (
    <Section
      title="Back-office work"
      subtitle={`Received ${inPeriod(periodLabel)} or still open.`}
      icon={<Briefcase className="size-4" />}
      action={<Link href="/dashboard/reports/back-office-work" className="text-xs font-medium text-primary hover:underline">Report ↗</Link>}
      note="Categories and channels are exactly what the back-office quick-add records."
    >
      {!d.any ? <Unavailable>No back-office work recorded in this period or still open.</Unavailable> : (
        <Table rows={d.rows.length} empty="—" head={<>
          <th scope="col">Category</th>
          <th scope="col" className="text-right">Online</th>
          <th scope="col" className="text-right">Offline</th>
          {anyUnrecorded && <th scope="col" className="text-right">Channel not recorded</th>}
        </>}>
          {d.rows.map((r) => (
            <tr key={r.key}>
              <td className="py-2.5 text-xs font-medium">{r.label}</td>
              <td className="py-2.5 text-xs">{cell(r.online)}</td>
              <td className="py-2.5 text-xs">{cell(r.offline)}</td>
              {anyUnrecorded && <td className="py-2.5 text-xs">{cell(r.unrecorded)}</td>}
            </tr>
          ))}
        </Table>
      )}
    </Section>
  );
}

/* ───────────────────────────── §26–27 ───────────────────────────── */

export function BranchRmPanel({ branches, rms, periodLabel, branchHref, rmHref }: {
  branches: BranchRow[]; rms: RmRow[]; periodLabel: string;
  branchHref: (id: string | null) => string; rmHref: (id: string | null) => string;
}) {
  return (
    <Section
      title="Branch-wise and RM-wise"
      subtitle={`Received and completed ${inPeriod(periodLabel)}; pending now.`}
      icon={<Network className="size-4" />}
      note="A request's branch is its client's branch, or the assignee's where no client is linked. Awaiting RM and awaiting client are follow-ups for the RM, not operations delays."
    >
      <h3 className="mb-2 text-xs font-semibold text-foreground">By branch</h3>
      <Table rows={branches.length} empty="No branch activity." head={<>
        <th scope="col">Branch</th>
        <th scope="col" className="text-right">Received</th>
        <th scope="col" className="text-right">Completed</th>
        <th scope="col" className="text-right">Pending</th>
        <th scope="col" className="text-right">Rejected</th>
        <th scope="col" className="text-right">SLA breach</th>
        <th scope="col" className="text-right">Avg TAT</th>
      </>}>
        {branches.map((b) => (
          <tr key={b.id ?? "none"}>
            <td className="py-2.5 text-xs font-medium">
              {b.id ? <Link href={branchHref(b.id)} className="hover:text-primary hover:underline">{b.name}</Link> : <span className="text-muted-foreground">{b.name}</span>}
            </td>
            <Num>{formatCount(b.received)}</Num>
            <Num tone={b.completed ? "good" : "neutral"}>{formatCount(b.completed)}</Num>
            <Num>{formatCount(b.pending)}</Num>
            <Num tone={b.rejected ? "bad" : "neutral"}>{formatCount(b.rejected)}</Num>
            <Num tone={b.breached ? "bad" : "neutral"}>{formatCount(b.breached)}</Num>
            <Num>{fmtHours(b.avgTat)}</Num>
          </tr>
        ))}
      </Table>
      <h3 className="mb-2 mt-5 flex items-center gap-1.5 text-xs font-semibold text-foreground">
        <GitPullRequestArrow className="size-3 text-muted-foreground" aria-hidden /> By RM
      </h3>
      <Table rows={rms.length} empty="No RM has work in this view." head={<>
        <th scope="col">RM</th>
        <th scope="col" className="text-right">Requests raised</th>
        <th scope="col" className="text-right">Completed</th>
        <th scope="col" className="text-right">Pending</th>
        <th scope="col" className="text-right">Awaiting RM</th>
        <th scope="col" className="text-right">Awaiting client</th>
        <th scope="col" className="text-right">Rejected</th>
        <th scope="col" className="text-right">SLA breach</th>
      </>}>
        {rms.map((r) => (
          <tr key={r.id ?? "none"}>
            <td className="py-2.5 text-xs font-medium">
              {r.id ? <Link href={rmHref(r.id)} className="hover:text-primary hover:underline">{r.name}</Link> : <span className="text-muted-foreground">{r.name}</span>}
            </td>
            <Num>{formatCount(r.raised)}</Num>
            <Num tone={r.completed ? "good" : "neutral"}>{formatCount(r.completed)}</Num>
            <Num>{formatCount(r.pending)}</Num>
            <Num tone={r.awaitingRm ? "warn" : "neutral"}>{formatCount(r.awaitingRm)}</Num>
            <Num tone={r.awaitingClient ? "warn" : "neutral"}>{formatCount(r.awaitingClient)}</Num>
            <Num tone={r.rejected ? "bad" : "neutral"}>{formatCount(r.rejected)}</Num>
            <Num tone={r.breached ? "bad" : "neutral"}>{formatCount(r.breached)}</Num>
          </tr>
        ))}
      </Table>
    </Section>
  );
}
