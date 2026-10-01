/**
 * Flow sections of the Operations page: volume and value by type
 * (§4–5), the processing funnel (§6), SLA and ageing (§7–8), TAT by type,
 * rework and quality (§33–35), today's timeline and the carry-forward
 * (§36–37), and the weekly / monthly review (§38–39).
 *
 * Counts and rupees never share a column unlabelled (§5): every value column
 * says "₹", every count column says "No.".
 */

import Link from "next/link";
import { Activity, CalendarRange, Clock, GitBranchPlus, Hourglass, Layers3, ShieldCheck, TrendingUp } from "lucide-react";
import { Num, Section, Stat, StatGrid, Table, Unavailable } from "../my/Shared";
import { formatCount, formatMoney, formatPercent } from "@/lib/format";
import { fmtHours, fmtIstDay, inPeriod } from "@/lib/dashboard/ops/fmt";
import type {
  AgeRow, CarryDay, Funnel, Review, SlaView, TatRow, ValueRow, VolumeRow,
} from "@/lib/dashboard/ops/flow";
import type { DayCounts } from "@/lib/dashboard/ops/queue";
import type { QualityIndicator, Rework } from "@/lib/dashboard/ops/exceptions";
import { cn } from "@/lib/utils";

function Toggle({ options, current }: { options: Array<{ key: string; label: string; href: string }>; current: string }) {
  return (
    <div className="dash-seg" role="group">
      {options.map((o) => (
        <Link key={o.key} href={o.href} aria-current={o.key === current ? "page" : undefined}
              className={cn("rounded-md px-2.5 py-1 font-medium", o.key === current ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground")}>
          {o.label}
        </Link>
      ))}
    </div>
  );
}

/* ───────────────────────────── §4–5 ───────────────────────────── */

export function VolumePanel({ rows, horizon, hrefs, horizonLabel }: {
  rows: VolumeRow[]; horizon: string; horizonLabel: string; hrefs: Record<string, string>;
}) {
  const tot = rows.reduce((a, r) => ({ rec: a.rec + r.received, done: a.done + r.completed, pend: a.pend + r.pending }), { rec: 0, done: 0, pend: 0 });
  return (
    <Section
      title="Transaction volume"
      subtitle={`Received and completed ${horizonLabel.toLowerCase()}; pending now.`}
      icon={<Layers3 className="size-4" />}
      action={<Toggle current={horizon} options={[
        { key: "today", label: "Today", href: hrefs.today }, { key: "week", label: "This week", href: hrefs.week },
        { key: "mtd", label: "This month", href: hrefs.mtd },
      ]} />}
      note="Request type is read from the task type, the back-office category, or the operations template the request was raised from; anything else is Other. Rejected is the platform's verdict on the RTA / exchange feed for the matching transaction type — a request task has no rejected state."
    >
      <Table rows={rows.length} empty="No operations request in this view." head={<>
        <th scope="col">Request type</th>
        <th scope="col" className="text-right">Received (No.)</th>
        <th scope="col" className="text-right">Completed (No.)</th>
        <th scope="col" className="text-right">Pending now (No.)</th>
        <th scope="col" className="text-right">Rejected on feed (No.)</th>
      </>}>
        {rows.map((r) => (
          <tr key={r.kind}>
            <td className="py-2.5 text-xs font-medium"><Link href={hrefs[`kind:${r.kind}`] ?? "#queue"} className="hover:text-primary hover:underline">{r.label}</Link></td>
            <Num>{formatCount(r.received)}</Num>
            <Num tone={r.completed ? "good" : "neutral"}>{formatCount(r.completed)}</Num>
            <Num>{formatCount(r.pending)}</Num>
            <Num tone={r.feedRejected ? "bad" : "neutral"}>{r.feedRejected == null ? <span className="text-muted-foreground" title="No feed transaction type matches this request type">—</span> : formatCount(r.feedRejected)}</Num>
          </tr>
        ))}
        {rows.length > 1 && (
          <tr className="font-semibold">
            <td className="py-2.5 text-xs">Total</td>
            <Num>{formatCount(tot.rec)}</Num><Num>{formatCount(tot.done)}</Num><Num>{formatCount(tot.pend)}</Num><Num>{""}</Num>
          </tr>
        )}
      </Table>
    </Section>
  );
}

export function ValuePanel({ data, horizonLabel }: { data: { rows: ValueRow[]; any: boolean }; horizonLabel: string }) {
  return (
    <Section
      title="Transaction value"
      subtitle={`On the RTA / exchange feed, ${horizonLabel.toLowerCase()}.`}
      icon={<Activity className="size-4" />}
      note="From the transaction feed, the only place a reliable amount lives. SIF, AIF and PMS are not on the mutual-fund feed; their business is in Business Entries. Liquid funds are also inside Purchase / Redemption above — shown separately, never added twice."
    >
      {!data.any ? (
        <Unavailable>No feed transaction in this period. Values appear as the RTA / exchange feeds are imported.</Unavailable>
      ) : (
        <Table rows={data.rows.length} empty="No feed transaction." head={<>
          <th scope="col">Type</th>
          <th scope="col" className="text-right">Received ₹ (No.)</th>
          <th scope="col" className="text-right">Completed ₹ (No.)</th>
          <th scope="col" className="text-right">Pending ₹ (No.)</th>
          <th scope="col" className="text-right">Rejected ₹ (No.)</th>
        </>}>
          {data.rows.map((r) => (
            <tr key={r.key} className={cn(r.key === "liquid" && "text-muted-foreground")}>
              <td className="py-2.5 text-xs font-medium">{r.label}</td>
              {([r.received, r.completed, r.pending, r.rejected] as const).map((c, k) => (
                <Num key={k} tone={k === 3 && c.n ? "bad" : k === 1 && c.n ? "good" : "neutral"}>
                  {c.n ? <>{formatMoney(c.v)} <span className="text-2xs text-muted-foreground">({formatCount(c.n)})</span></> : <span className="text-muted-foreground">—</span>}
                </Num>
              ))}
            </tr>
          ))}
        </Table>
      )}
    </Section>
  );
}

/* ───────────────────────────── §6 funnel ───────────────────────────── */

export function FunnelPanel({ funnel, periodLabel }: { funnel: Funnel; periodLabel: string }) {
  const top = funnel.steps[0]?.count ?? 0;
  return (
    <Section
      title="Processing funnel"
      subtitle={`Requests received ${inPeriod(periodLabel)}.`}
      icon={<GitBranchPlus className="size-4" />}
      note={`The CRM records received, assigned, in process${funnel.approvalUsed ? ", submitted for approval, approved" : ""} and completed; it stamps the time only at receipt${funnel.approvalUsed ? ", submission, approval" : ""} and completion, so average time is shown only between those. "Validated" and "confirmed by the platform" are not recorded on a request.`}
    >
      {top === 0 ? (
        <Unavailable>No request received {inPeriod(periodLabel)}.</Unavailable>
      ) : (
        <div className="space-y-1.5">
          {funnel.steps.map((s) => (
            <div key={s.key} className="flex items-center gap-3">
              <span className="w-28 shrink-0 truncate text-xs text-foreground sm:w-40" title={s.label}>{s.label}</span>
              <span className="h-6 min-w-0 flex-1 overflow-hidden rounded-md bg-secondary">
                {s.count > 0 && (
                  <span className={cn("flex h-full items-center rounded-md px-2 text-2xs font-semibold text-primary-foreground", s.key === "completed" ? "bg-success" : "bg-primary/75")}
                        style={{ width: `${Math.max(4, (s.count / Math.max(1, top)) * 100)}%` }}>
                    {formatCount(s.count)}
                  </span>
                )}
              </span>
              <span className="w-20 shrink-0 text-right text-2xs tabular-nums text-muted-foreground sm:w-28">
                {s.valued ? formatMoney(s.value) : "—"}
              </span>
              {/* The per-step average is desktop detail; "SLA and TAT" carries the average on a phone. */}
              <span className="hidden w-24 shrink-0 text-right text-2xs tabular-nums text-muted-foreground sm:block" title={s.note}>
                {s.avgHours == null ? "" : `avg ${fmtHours(s.avgHours)}`}
              </span>
            </div>
          ))}
          <div className="flex flex-wrap gap-1.5 pt-2">
            {funnel.alternates.map((a) => (
              <span key={a.key} className={cn("chip", a.count ? "bg-warning/10 text-warning-foreground" : "bg-secondary text-secondary-foreground")}>
                {a.label}: {formatCount(a.count)}
              </span>
            ))}
          </div>
        </div>
      )}
    </Section>
  );
}

/* ───────────────────────────── §7–8 ───────────────────────────── */

export function SlaPanel({ sla, periodLabel, hrefs }: { sla: SlaView; periodLabel: string; hrefs: Record<string, string> }) {
  const open = sla.within + sla.approaching + sla.breached;
  const pct = (n: number) => (open > 0 ? (n / open) * 100 : 0);
  return (
    <Section
      title="SLA and TAT"
      icon={<Clock className="size-4" />}
      note="SLA is the due time the CRM sets on each request from its priority (urgent 4 h, high 24 h, normal 72 h, low 168 h) unless someone changed it. The CRM has no per-transaction-type SLA table, so none is invented here."
    >
      <StatGrid cols={6}>
        <Stat label="Within SLA" value={sla.within} href={hrefs.within} />
        <Stat label="Approaching SLA" value={sla.approaching} tone={sla.approaching ? "warn" : "neutral"} href={hrefs.approaching} />
        <Stat label="SLA breached" value={sla.breached} tone={sla.breached ? "bad" : "neutral"} href={hrefs.breached} />
        <Stat label="Average TAT" display={fmtHours(sla.avgTat)} hint={sla.measured ? `${sla.measured} completed ${inPeriod(periodLabel)}` : "no completion in the period"} />
        <Stat label="Median TAT" display={fmtHours(sla.medianTat)} />
        <Stat label="Oldest pending" display={sla.oldest ? `${sla.oldest.days} d` : "—"} hint={sla.oldest ? `${sla.oldest.title}${sla.oldest.assignee ? ` · ${sla.oldest.assignee}` : ""}` : undefined} />
      </StatGrid>
      {open > 0 && (
        <div className="mt-4">
          <div className="flex h-3 overflow-hidden rounded-full bg-secondary" role="img"
               aria-label={`Within SLA ${sla.within}, approaching ${sla.approaching}, breached ${sla.breached}`}>
            <span className="bg-primary/40" style={{ width: `${pct(sla.within)}%` }} />
            <span className="bg-warning" style={{ width: `${pct(sla.approaching)}%` }} />
            <span className="bg-destructive" style={{ width: `${pct(sla.breached)}%` }} />
          </div>
          <div className="mt-1.5 flex flex-wrap gap-3 text-2xs text-muted-foreground">
            <span>Within {formatCount(sla.within)}</span><span>Near {formatCount(sla.approaching)}</span><span>Breached {formatCount(sla.breached)}</span>
            {sla.noSla > 0 && <span>· {formatCount(sla.noSla)} open with no SLA set</span>}
          </div>
        </div>
      )}
    </Section>
  );
}

export function AgeingPanel({ rows }: { rows: AgeRow[] }) {
  const any = rows.some((r) => r.count > 0);
  return (
    <Section title="Ageing" icon={<Hourglass className="size-4" />}>
      <Table rows={any ? rows.length : 0} empty="Nothing is open, so nothing is ageing." head={<>
        <th scope="col">Ageing</th>
        <th scope="col" className="text-right">No.</th>
        <th scope="col" className="text-right">Value ₹</th>
        <th scope="col">Oldest record</th>
      </>}>
        {rows.map((r) => (
          <tr key={r.key}>
            <td className="py-2.5 text-xs font-medium">{r.label}</td>
            <Num tone={r.key === "d16" && r.count ? "bad" : r.key === "d8" && r.count ? "warn" : "neutral"}>{formatCount(r.count)}</Num>
            <Num>{r.valued ? formatMoney(r.value) : <span className="text-muted-foreground">—</span>}</Num>
            <td className="py-2.5 text-xs">
              {r.oldest ? <span>{r.oldest.title}{r.oldest.client && !r.oldest.title.includes(r.oldest.client) ? ` · ${r.oldest.client}` : ""} <span className="text-muted-foreground">({r.oldest.days} d)</span></span>
                : <span className="text-muted-foreground">—</span>}
            </td>
          </tr>
        ))}
      </Table>
    </Section>
  );
}

/* ───────────────────────────── §33–35 ───────────────────────────── */

export function TatQualityPanel({ tat, rework, indicators, periodLabel }: {
  tat: TatRow[]; rework: Rework; indicators: QualityIndicator[]; periodLabel: string;
}) {
  return (
    <Section
      title="TAT, rework and quality"
      icon={<ShieldCheck className="size-4" />}
      note="TAT by type covers requests completed in the last 90 days with both timestamps. No synthetic quality score: each measure shows its own definition and base. Internal errors are never inferred from a rejection — the CRM records no documented error reason."
    >
      <Table rows={tat.length} empty="No request completed in the last 90 days with both timestamps." head={<>
        <th scope="col">Request type</th>
        <th scope="col" className="text-right">Completed (No.)</th>
        <th scope="col" className="text-right">Avg TAT</th>
        <th scope="col" className="text-right">Median TAT</th>
        <th scope="col" className="text-right">Within SLA</th>
      </>}>
        {tat.map((r) => (
          <tr key={r.kind}>
            <td className="py-2.5 text-xs font-medium">{r.label}</td>
            <Num>{formatCount(r.count)}</Num>
            <Num>{fmtHours(r.avgHours)}</Num>
            <Num>{fmtHours(r.medianHours)}</Num>
            <Num tone={r.slaPct == null ? "neutral" : r.slaPct >= 0.9 ? "good" : "warn"}>
              {r.slaPct == null ? <span className="text-muted-foreground" title="None of these had an SLA">—</span> : formatPercent(r.slaPct * 100, 0)}
            </Num>
          </tr>
        ))}
      </Table>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div>
          <h3 className="mb-2 text-xs font-semibold text-foreground">Rework — {periodLabel}</h3>
          <StatGrid cols={3}>
            <Stat label="Returned for correction" value={rework.returned} tone={rework.returned ? "warn" : "neutral"} hint="sent back by the approver" />
            <Stat label="Reprocessed" value={rework.reprocessed} hint="SIP repurchases initiated or done" />
            <Stat label="Internal errors" display="Not recorded" hint="no documented error reason in the CRM" />
          </StatGrid>
          {rework.returnedRows.length > 0 && (
            <ul className="mt-2 space-y-1 text-2xs">
              {rework.returnedRows.map((r) => (
                <li key={r.id}><span className="font-medium text-foreground">{r.title}</span> — {r.reason ?? "no reason given"}{r.owner ? ` · ${r.owner}` : ""}</li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h3 className="mb-2 text-xs font-semibold text-foreground">Quality indicators — {periodLabel}</h3>
          <ul className="space-y-2">
            {indicators.map((q) => (
              <li key={q.key} className="rounded-lg border border-border px-3 py-2">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs font-medium">{q.label}</span>
                  <span className="text-sm font-semibold tabular-nums">{q.value == null ? <span className="text-muted-foreground" title="Nothing to measure yet">—</span> : formatPercent(q.value * 100, 1)}</span>
                </div>
                <p className="mt-0.5 text-2xs leading-snug text-muted-foreground">{q.definition}{q.base ? ` Base: ${q.base}.` : ""}</p>
              </li>
            ))}
            <li className="rounded-lg border border-dashed border-border px-3 py-2 text-2xs text-muted-foreground">
              Documentation complete % is not measurable: the CRM has no document-status field on a request.
            </li>
          </ul>
        </div>
      </div>
    </Section>
  );
}

/* ───────────────────────────── §36–37 ───────────────────────────── */

export function TimelinePanel({ counts, days }: { counts: DayCounts; days: CarryDay[] }) {
  const steps = [
    { label: "Morning carry forward", value: counts.carryForward },
    { label: "Received today", value: counts.receivedToday },
    { label: "Completed today", value: counts.completedToday },
    { label: "Still pending", value: counts.pendingNow },
    { label: "End-of-day carry forward", value: counts.pendingNow },
  ];
  const rising = days.length > 1 && days[days.length - 1].closing > days[0].opening;
  return (
    <Section
      title="Today's timeline and the carry-forward"
      subtitle={rising ? "This month, day by day — the backlog is higher now than on the 1st." : "This month, day by day."}
      icon={<CalendarRange className="size-4" />}
      note="Closed means completed, or cancelled — the CRM does not stamp a cancellation time, so a cancelled request counts as closed on its last edit."
    >
      <ol className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {steps.map((s, k) => (
          <li key={s.label} className="rounded-lg border border-border px-3 py-2">
            <div className="text-2xs text-muted-foreground">{k + 1}. {s.label}</div>
            <div className="text-xl font-semibold tabular-nums">{formatCount(s.value)}</div>
          </li>
        ))}
      </ol>
      <Table rows={days.length} empty="No day recorded this month." head={<>
        <th scope="col">Date</th>
        <th scope="col" className="text-right">Opening pending</th>
        <th scope="col" className="text-right">New received</th>
        <th scope="col" className="text-right">Completed</th>
        <th scope="col" className="text-right">Closing pending</th>
      </>}>
        {[...days].reverse().map((d) => (
          <tr key={d.day}>
            <td className="py-2 text-xs">{fmtIstDay(d.day)}</td>
            <Num>{formatCount(d.opening)}</Num>
            <Num>{formatCount(d.received)}</Num>
            <Num tone={d.completed ? "good" : "neutral"}>{formatCount(d.completed)}</Num>
            <Num tone={d.closing > d.opening ? "warn" : "neutral"}>{formatCount(d.closing)}</Num>
          </tr>
        ))}
      </Table>
    </Section>
  );
}

/* ───────────────────────────── §38–39 ───────────────────────────── */

export function ReviewPanel({ review, mode, hrefs }: { review: Review | null; mode: "weekly" | "monthly" | null; hrefs: Record<string, string> }) {
  return (
    <Section
      title="Operations review"
      icon={<TrendingUp className="size-4" />}
      action={<Toggle current={mode ?? ""} options={[
        { key: "weekly", label: "Weekly review", href: hrefs.weekly }, { key: "monthly", label: "Monthly review", href: hrefs.monthly },
      ]} />}
    >
      {!review ? (
        <p className="text-xs text-muted-foreground">Pick Weekly or Monthly review to compare with the previous period.</p>
      ) : (
        <Table rows={review.rows.length} empty="Nothing to compare." head={<>
          <th scope="col">Metric</th>
          <th scope="col" className="text-right">{review.previousLabel}</th>
          <th scope="col" className="text-right">{review.currentLabel}</th>
          <th scope="col" className="text-right">Change</th>
        </>}>
          {review.rows.map((r) => {
            const fmt = (v: number | null) => v == null ? <span className="text-muted-foreground">—</span>
              : r.format === "hours" ? fmtHours(v) : r.format === "percent" ? formatPercent(v * 100, 1)
              : r.format === "currency" ? formatMoney(v) : formatCount(v);
            const change = r.current == null || r.previous == null ? null : r.current - r.previous;
            const bad = change != null && change !== 0 && (r.inverse ? change > 0 : change < 0);
            return (
              <tr key={r.key}>
                <td className="py-2.5 text-xs font-medium" title={r.note}>{r.label}</td>
                <Num>{fmt(r.previous)}</Num>
                <Num>{fmt(r.current)}</Num>
                {/* An absolute difference, so a previous 0 still compares: 0 → 2 is +2. */}
                <Num tone={change == null || change === 0 ? "neutral" : bad ? "warn" : "good"}>
                  {change == null ? "—"
                    : change === 0 ? "No change"
                    : `${change > 0 ? "+" : "−"}${r.format === "hours" ? fmtHours(Math.abs(change))
                        : r.format === "percent" ? `${(Math.abs(change) * 100).toFixed(1)} pts`
                        : r.format === "currency" ? formatMoney(Math.abs(change))
                        : formatCount(Math.abs(change))}`}
                </Num>
              </tr>
            );
          })}
        </Table>
      )}
    </Section>
  );
}
