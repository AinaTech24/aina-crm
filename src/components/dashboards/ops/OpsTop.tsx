/**
 * The top of the Operations page: the morning stand-up / today's closure
 * (§46–47), the command strip (§1), the attention centre (§2), and the two
 * quick actions (§41). The page has no search box of its own — the global
 * Ctrl+K search covers clients, folios, tasks and tickets — and the
 * escalation rules (§45) sit in the (i) beside the "SLA & escalations" tab.
 *
 * Colour follows the brief's rule and nothing else: red only for a breach, a
 * rejection or an unresolved critical exception; amber for approaching or
 * waiting; green only for completed work; grey for everything neutral. An
 * empty card is never green.
 */

import Link from "next/link";
import type { ReactNode } from "react";
import { AlertOctagon, PlusCircle, Sunrise, Sunset, UserX } from "lucide-react";
import { buttonClass } from "@/components/ui/button-class";
import { formatCount, formatMoney, formatPercent } from "@/lib/format";
import { fmtHours, periodNoun } from "@/lib/dashboard/ops/fmt";
import type { AttentionCard, CommandStrip, DayCounts } from "@/lib/dashboard/ops/queue";
import { cn } from "@/lib/utils";

/* ───────────────────────────── §46–47 ───────────────────────────── */

type DayItem = { label: string; value: number; href: string; tone?: "bad" | "warn" | "good" | "neutral"; hint?: string };

export function StandupPanel({
  counts, eod, hrefs,
}: {
  counts: DayCounts;
  eod: boolean;
  hrefs: Record<string, string>;
}) {
  const morning: DayItem[] = [
    { label: "Yesterday's carry forward", value: counts.carryForward, href: hrefs.queue, hint: "open at the start of today" },
    { label: "SLA breached", value: counts.breached, href: hrefs.breached, tone: counts.breached ? "bad" : "neutral" },
    { label: "Due today", value: counts.dueToday, href: hrefs.queue, tone: counts.dueToday ? "warn" : "neutral" },
    { label: "High-value pending", value: counts.highValue, href: hrefs.highValue, tone: counts.highValue ? "warn" : "neutral" },
    { label: "SIP rejections open", value: counts.sipOpen, href: hrefs.sip, tone: counts.sipOpen ? "warn" : "neutral" },
    { label: "Documents pending", value: counts.documents, href: hrefs.docs },
    { label: "Unassigned", value: counts.unassigned, href: hrefs.unassigned, tone: counts.unassigned ? "warn" : "neutral" },
    { label: "Service requests overdue", value: counts.queriesOverdue, href: hrefs.queries, tone: counts.queriesOverdue ? "bad" : "neutral" },
    { label: "New requests today", value: counts.receivedToday, href: hrefs.queue },
    { label: "Completed today", value: counts.completedToday, href: hrefs.queue, tone: counts.completedToday ? "good" : "neutral" },
  ];
  const closure: DayItem[] = [
    { label: "Opening pending", value: counts.carryForward, href: hrefs.queue },
    { label: "New received", value: counts.receivedToday, href: hrefs.queue },
    { label: "Completed", value: counts.completedToday, href: hrefs.queue, tone: counts.completedToday ? "good" : "neutral" },
    { label: "Rejected on the feed", value: counts.rejectedToday, href: hrefs.rejected, tone: counts.rejectedToday ? "bad" : "neutral" },
    { label: "Pending now", value: counts.pendingNow, href: hrefs.queue },
    { label: "Overdue", value: counts.breached, href: hrefs.breached, tone: counts.breached ? "bad" : "neutral" },
    { label: "Carry forward to tomorrow", value: counts.pendingNow, href: hrefs.queue, hint: "everything still open tonight" },
    { label: "SIP exceptions unresolved", value: counts.sipOpen, href: hrefs.sip, tone: counts.sipOpen ? "warn" : "neutral" },
    { label: "Service requests unresolved", value: counts.queriesOpen, href: hrefs.queries, tone: counts.queriesOverdue ? "bad" : "neutral" },
    { label: "Due and unresolved", value: counts.tasksDueUnresolved, href: hrefs.queue, tone: counts.tasksDueUnresolved ? "warn" : "neutral" },
  ];
  const items = eod ? closure : morning;
  return (
    <section className="card-surface overflow-hidden" aria-label={eod ? "Today's closure" : "Morning stand-up"}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 bg-secondary/40 px-5 py-2.5">
        <h2 className="section-title flex items-center gap-2">
          {eod ? <Sunset className="size-4 text-muted-foreground" aria-hidden /> : <Sunrise className="size-4 text-muted-foreground" aria-hidden />}
          {eod ? "Today's closure" : "Morning stand-up"}
        </h2>
        <div className="inline-flex rounded-lg border border-border bg-card p-0.5 text-xs" role="group" aria-label="View">
          <Link href={hrefs.morning} aria-current={!eod ? "page" : undefined}
                className={cn("rounded-md px-2.5 py-1 font-medium", !eod ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground")}>
            Morning stand-up
          </Link>
          <Link href={hrefs.closure} aria-current={eod ? "page" : undefined}
                className={cn("rounded-md px-2.5 py-1 font-medium", eod ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground")}>
            Today&apos;s closure
          </Link>
        </div>
      </div>
      <ul className="grid grid-cols-2 gap-px bg-border/60 sm:grid-cols-5">
        {items.map((it) => (
          <li key={it.label} className="bg-card">
            <Link href={it.href} className="block h-full px-4 py-3 transition-colors hover:bg-accent">
              <div className={cn("text-2xl font-semibold tabular-nums leading-none",
                it.tone === "bad" ? "text-destructive" : it.tone === "warn" ? "text-warning-foreground"
                : it.tone === "good" ? "text-success" : "text-foreground")}>
                {formatCount(it.value)}
              </div>
              <div className="mt-1.5 text-2xs font-medium leading-snug text-foreground">{it.label}</div>
              {it.hint && <div className="text-2xs text-muted-foreground">{it.hint}</div>}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ───────────────────────────── §1 command strip ───────────────────────────── */

function Tile({ label, value, sub, tone = "neutral", href }: {
  label: string; value: ReactNode; sub?: ReactNode; tone?: "bad" | "warn" | "good" | "neutral"; href: string;
}) {
  return (
    <Link href={href} className={cn(
      "block rounded-xl border bg-card p-4 transition-colors hover:bg-accent",
      tone === "bad" ? "border-destructive/40" : tone === "warn" ? "border-warning/50" : "border-border",
    )}>
      <div className="text-2xs font-medium text-muted-foreground">{label}</div>
      <div className={cn("mt-1.5 text-3xl font-semibold tabular-nums leading-none",
        tone === "bad" ? "text-destructive" : tone === "warn" ? "text-warning-foreground" : tone === "good" ? "text-success" : "text-foreground")}>
        {value}
      </div>
      {sub && <div className="mt-2 space-y-0.5 text-2xs text-muted-foreground">{sub}</div>}
    </Link>
  );
}

/** "₹12.40 Lakh across 6 of 9" — a value only ever over the requests that carry one. */
function valueLine(v: { count: number; value: number; valued: number }) {
  if (v.count === 0) return null;
  if (v.valued === 0) return <div>Value not recorded on these requests</div>;
  return <div>{formatMoney(v.value)}{v.valued < v.count ? <> · on {v.valued} of {v.count} with a value</> : null}</div>;
}

export function CommandStripPanel({ s, periodLabel, hrefs }: { s: CommandStrip; periodLabel: string; hrefs: Record<string, string> }) {
  return (
    <section aria-label="Operations command strip">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="section-title">Operations command strip</h2>
        <p className="text-2xs text-muted-foreground">Received, completed and TAT cover {periodNoun(periodLabel)}; pending, overdue and waiting are as they stand now.</p>
      </div>
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4 xl:grid-cols-8">
        <Tile label="Requests received" value={formatCount(s.received.count)} href={hrefs.queue} sub={valueLine(s.received)} />
        <Tile label="Completed" value={formatCount(s.completed.count)} href={hrefs.queue} tone={s.completed.count ? "good" : "neutral"}
          sub={<>
            {valueLine(s.completed)}
            <div title="Completed ÷ (pending at the start + received)">
              {s.completed.completionPct == null ? "Completion: nothing to complete" : `Completion ${formatPercent(s.completed.completionPct * 100, 0)} of ${s.completed.base}`}
            </div>
          </>} />
        <Tile label="Pending" value={formatCount(s.pending.count)} href={hrefs.queue} sub={valueLine(s.pending)} />
        <Tile label="Overdue · SLA breached" value={formatCount(s.breached.count)} href={hrefs.breached}
          tone={s.breached.count ? "bad" : "neutral"} sub={valueLine(s.breached) ?? <div>Nothing past SLA</div>} />
        <Tile label="Rejected / failed" value={formatCount(s.rejected.count)} href={hrefs.rejected} tone={s.rejected.count ? "bad" : "neutral"}
          sub={<>{s.rejected.count > 0 && <div>{formatMoney(s.rejected.value)}</div>}<div>on the RTA / exchange feed</div></>} />
        <Tile label="Awaiting client / RM" value={formatCount(s.awaitingClient + s.awaitingRm)} href={hrefs.pendingWith}
          tone={s.awaitingClient + s.awaitingRm ? "warn" : "neutral"}
          sub={<><div>Client {formatCount(s.awaitingClient)} · RM {formatCount(s.awaitingRm)}</div><div>not an operations delay</div></>} />
        <Tile label="Documents pending" value={formatCount(s.documents)} href={hrefs.docs}
          sub={<div>document-collection requests open</div>} />
        <Tile label="Average TAT" value={s.tat.avgHours == null ? "—" : fmtHours(s.tat.avgHours)} href={hrefs.tat}
          sub={s.tat.measured === 0
            ? <div>No completion with both timestamps in the period</div>
            : <><div>Median {fmtHours(s.tat.medianHours)}</div><div>over {s.tat.measured} completed</div></>} />
      </div>
    </section>
  );
}

/* ───────────────────────────── §2 attention centre ───────────────────────────── */

export function AttentionPanel({ cards }: { cards: AttentionCard[] }) {
  return (
    <section className="card-surface p-5 sm:p-6" aria-label="Operations attention centre">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2 border-b border-border/60 pb-3">
        <h2 className="section-title flex items-center gap-2"><AlertOctagon className="size-4 text-muted-foreground" aria-hidden /> Needs immediate attention</h2>
      </div>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-5">
        {cards.map((c) => (
          <Link key={c.key} href={c.href} className={cn(
            "flex flex-col rounded-lg border p-3 transition-colors hover:bg-accent",
            c.severity === "critical" ? "border-destructive/40 bg-destructive/5" : c.severity === "attention" ? "border-warning/50" : "border-border",
          )}>
            <div className="flex items-start justify-between gap-2">
              <span className="text-xs font-semibold text-foreground">{c.label}</span>
              {c.count > 0 && (
                <span className={cn("chip shrink-0", c.severity === "critical" ? "bg-destructive/10 text-destructive" : "bg-warning/10 text-warning-foreground")}>
                  {c.severity === "critical" ? "Critical" : "Attention"}
                </span>
              )}
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className={cn("text-2xl font-semibold tabular-nums", c.severity === "critical" ? "text-destructive" : "text-foreground")}>
                {formatCount(c.count)}
              </span>
              {c.value != null && c.count > 0 && <span className="text-xs tabular-nums text-muted-foreground">{formatMoney(c.value)}</span>}
            </div>
            <div className="mt-1 space-y-0.5 text-2xs text-muted-foreground">
              {c.count > 0 && c.oldestDays != null && <div>Oldest {c.oldestDays} day{c.oldestDays === 1 ? "" : "s"}</div>}
              {c.count > 0 && c.owner && <div>Most with {c.owner}</div>}
            </div>
            <p className="mt-auto pt-2 text-2xs leading-snug text-muted-foreground">{c.rule}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}

/* ───────────────────────────── §41 ───────────────────────────── */

/**
 * The page's two actions. The rest of the old row (pending queue, SLA
 * breaches, SIP rejections, documents, service requests, financial tasks,
 * unassigned) is what the tabs below already show.
 */
export function OpsQuickActions({ canCreate, assignHref }: { canCreate: boolean; assignHref: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {canCreate && (
        <Link href="/dashboard/tasks/new" className={buttonClass("primary", "sm")}>
          <PlusCircle className="size-3.5" aria-hidden /> New transaction request
        </Link>
      )}
      <Link href={assignHref} className={buttonClass("secondary", "sm")}>
        <UserX className="size-3.5" aria-hidden /> Assign records
      </Link>
    </div>
  );
}
