/**
 * §46 daily claim flow · §47 today's closure · §48–49 weekly / monthly review
 * · §50 FY claim scorecard. There is no settlement target: management has not
 * defined one, so none is drawn.
 */

import { CalendarCheck, CalendarDays, Sigma, Sunset } from "lucide-react";
import type { dailyFlow, fyScorecard, Review } from "@/lib/dashboard/claims/review";
import { Num, Section, Stat, StatGrid, Table } from "@/components/dashboards/my/Shared";
import { LinkToggle } from "@/components/dashboards/insurance/parts";
import { formatCount, formatMoney, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

export function DailyFlowPanel({ d }: { d: ReturnType<typeof dailyFlow> }) {
  const eq = (label: string, v: number, op?: string, tone?: string) => (
    <div className="flex items-center gap-2">
      {op && <span className="text-lg font-semibold text-muted-foreground" aria-hidden>{op}</span>}
      <div className="rounded-lg bg-secondary/70 px-3 py-2">
        <div className={cn("text-xl font-semibold tabular-nums", tone)}>{formatCount(v)}</div>
        <div className="text-2xs text-muted-foreground">{label}</div>
      </div>
    </div>
  );
  return (
    <div className="grid gap-6 2xl:grid-cols-2">
      <Section title="Daily claim flow" subtitle="Today, so far." icon={<CalendarDays className="size-4" />} className="min-w-0"
        note="Opening is the claims open at the end of yesterday. A claim opened and closed today is in both New and Closed.">
        <div className="flex flex-wrap items-center gap-2" aria-label="Opening plus new minus closed equals closing">
          {eq("Opening open", d.opening)}
          {eq("New today", d.newToday, "+")}
          {eq("Closed / settled", d.closedToday, "−")}
          {eq("Closing open", d.closing, "=", "text-primary")}
        </div>
        <div className="mt-4">
          <StatGrid cols={3}>
            <Stat label="New documents pending" value={d.newDocsPending} hint="Moved to File awaited today" />
            <Stat label="New queries" value={d.newQueries} hint="Query or info awaited today" />
            <Stat label="New SLA breaches" value={d.newBreaches} tone={d.newBreaches ? "bad" : "neutral"} hint="Passed their SLA today" />
          </StatGrid>
        </div>
      </Section>
      <Section title="Today's closure" subtitle="The end-of-day picture." icon={<Sunset className="size-4" />} className="min-w-0"
        note="Approvals are not shown: the CRM has no approval step. Carry forward is what stays open tonight.">
        <StatGrid cols={5}>
          <Stat label="Opening claims" value={d.opening} />
          <Stat label="New claims" value={d.newToday} />
          <Stat label="Documents completed" value={d.docsCompleted} hint="Moved to File received" />
          <Stat label="Submitted" value={d.submitted} hint="Submission date today" />
          <Stat label="Queries answered" value={d.queriesAnswered} />
          <Stat label="Settled" value={d.settled} tone={d.settled ? "good" : "neutral"} />
          <Stat label="Rejected" value={d.rejected} />
          <Stat label="Still open" value={d.closing} />
          <Stat label="SLA breached" value={d.slaBreached} tone={d.slaBreached ? "bad" : "neutral"} />
          <Stat label="Carry forward" value={d.closing} />
        </StatGrid>
      </Section>
    </div>
  );
}

function change(r: Review["rows"][number]) {
  const [prev, cur] = [r.values[r.values.length - 2], r.values[r.values.length - 1]];
  if (r.nowOnly) return <span className="text-muted-foreground" title="The CRM keeps no status history per day">Now only</span>;
  if (cur == null || prev == null) return <span className="text-muted-foreground">—</span>;
  const d = cur - prev;
  if (d === 0) return <span className="text-muted-foreground">No change</span>;
  const txt = r.format === "percent" ? `${d > 0 ? "+" : "−"}${(Math.abs(d) * 100).toFixed(1)} pts`
    : r.format === "currency" ? `${d > 0 ? "+" : "−"}${formatMoney(Math.abs(d))}` : `${d > 0 ? "+" : "−"}${formatCount(Math.abs(d))}`;
  const good = r.sense === "neutral" ? null : r.sense === "up" ? d > 0 : d < 0;
  return <span className={good == null ? "text-foreground" : good ? "text-success" : "text-warning-foreground"}>{txt}</span>;
}
const val = (v: number | null, f: Review["rows"][number]["format"]) =>
  v == null ? <span className="text-muted-foreground">—</span> : f === "percent" ? formatPercent(v * 100, 1) : f === "currency" ? formatMoney(v) : formatCount(v);

export function ReviewPanel({ mode, r, toggle }: {
  mode: "weekly" | "monthly"; r: Review; toggle: Array<{ key: string; label: string; href: string }>;
}) {
  return (
    <Section title={mode === "weekly" ? "Weekly claim review" : "Monthly claim review"}
      subtitle={mode === "weekly" ? "This week to date against the same days last week." : "This month to date against the same days last month."}
      icon={<CalendarCheck className="size-4" />} action={<LinkToggle current={mode} options={toggle} />}
      note="Open, ageing and SLA rows are rebuilt for each date from when claims opened and closed. File, document and query rows are today's only: the CRM overwrites a claim's status and keeps no daily history. Rejections are coloured neither way.">
      <Table rows={r.rows.length} empty="Nothing to compare." head={<>
        <th scope="col">Metric</th>
        {r.labels.map((l) => <th key={l} scope="col" className="text-right">{l}</th>)}
        <th scope="col" className="text-right">Change</th>
      </>}>
        {r.rows.map((row) => (
          <tr key={row.key}>
            <td className="py-2.5 text-xs font-medium">{row.label}</td>
            {row.values.map((v, i) => <Num key={i}>{val(v, row.format)}</Num>)}
            <Num>{change(row)}</Num>
          </tr>
        ))}
      </Table>
    </Section>
  );
}

export function FyPanel({ s, fyLabel }: { s: ReturnType<typeof fyScorecard>; fyLabel: string }) {
  return (
    <Section title="FY claim scorecard" subtitle={`${fyLabel} to date.`} icon={<Sigma className="size-4" />}
      note="No settlement target is drawn — management has not defined one. SLA compliance is claims closed within the SLA ÷ claims closed, grievance cases left out.">
      <StatGrid cols={4}>
        <Stat label="Claims logged" value={s.logged} hint={formatMoney(s.claimed)} />
        <Stat label="Claims settled" value={s.settled} hint={formatMoney(s.settledAmt)} tone={s.settled ? "good" : "neutral"} />
        <Stat label="Claims rejected" value={s.rejected} />
        <Stat label="Open now" value={s.open} />
        <Stat label="Total claimed" value={s.claimed} format="currency" />
        <Stat label="Settled amount" value={s.settledAmt} format="currency" />
        <Stat label="Open 90+ days" value={s.aged90} tone={s.aged90 ? "bad" : "neutral"} />
        <Stat label="SLA compliance" value={s.slaPct} format="percent" unavailable="No claim closed yet this FY." />
      </StatGrid>
    </Section>
  );
}
