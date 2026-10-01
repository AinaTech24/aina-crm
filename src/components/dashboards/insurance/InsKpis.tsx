/**
 * §1 executive KPI strip · §3 month-on-month · §4 year-on-year · §5 Personal
 * vs Commercial Lines. Server components; every figure links to its records.
 */

import Link from "next/link";
import type { ReactNode } from "react";
import {
  BarChart3, CalendarRange, FileCheck, GitCompareArrows, HeartPulse, IndianRupee, Percent, RefreshCw, Scale, Sparkles, UserPlus, XCircle,
} from "lucide-react";
import type { Money } from "@/lib/dashboard/insurance/business";
import type { Compare } from "@/lib/dashboard/insurance/review";
import type { YoyRow } from "@/lib/dashboard/insurance/business";
import { InfoTip, Num, Section, Table } from "@/components/dashboards/my/Shared";
import { formatCount, formatMoney, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ChangeText, diffText, fmtValue } from "./parts";

/* ───────────────────────── §1 ───────────────────────── */

function Kpi({ title, value, children, href, tone = "neutral", title2, zero = false, icon, hue }: {
  title: string; value: ReactNode; children?: ReactNode; href: string; tone?: "neutral" | "bad" | "good"; title2?: string;
  /** The tile's icon chip and its hue — the same anatomy as every other dashboard's headline tile. */
  icon?: ReactNode; hue?: "indigo" | "violet" | "emerald" | "cyan" | "amber" | "rose";
  /** A real zero: shown grey, so it does not compete with the figures that moved. */
  zero?: boolean;
}) {
  return (
    <Link href={href} title={title2}
      className={cn("card-surface flex h-full flex-col p-4",
        tone === "bad" && "border-destructive/40")}
      style={hue ? { ["--c" as string]: `hsl(var(--metric-${hue}))` } : undefined}>
      <div className="flex items-start justify-between gap-2">
        <div className="text-xs font-medium leading-snug text-muted-foreground">{title}</div>
        {icon && <span className="dash-kpi-chip" aria-hidden>{icon}</span>}
      </div>
      <div className={cn("mt-1 text-2xl tabular-nums leading-tight tracking-tight",
        zero ? "font-medium text-muted-foreground/60"
        : cn("font-semibold", tone === "bad" ? "text-destructive" : tone === "good" ? "text-success" : "text-foreground"))}>{value}</div>
      {children && <dl className="mt-auto space-y-0.5 border-t border-border/60 pt-2.5 text-2xs text-muted-foreground">{children}</dl>}
    </Link>
  );
}
function Fact({ k, v }: { k: string; v: ReactNode }) {
  return <div className="flex justify-between gap-2"><dt>{k}</dt><dd className="whitespace-nowrap tabular-nums text-foreground">{v}</dd></div>;
}
const ach = (actual: number, target: number | null) => (target && target > 0 ? formatPercent((actual / target) * 100, 1) : "—");

export type StripData = {
  periodLabel: string;
  prevLabel: string;
  cur: Money; prev: Money; fy: Money;
  /** `missing` is what a null target reads as: "Not set", or "Not for a filtered view" — firm targets cover the whole book. */
  targets: { newAmt: number | null; renAmt: number | null; newClients: number | null; missing: string };
  retention: { due: number; renewed: number; policyPct: number | null; premiumPct: number | null; duePremium: number; renewedPremium: number } | null;
  newClients: { cur: number; fy: number };
  lost: { count: number; premium: number };
  claims: { open: number; outstanding: number };
  hrefs: Record<string, string>;
};

export function KpiStrip({ d }: { d: StripData }) {
  return (
    <section aria-label="Executive KPI strip">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="section-title">Insurance business</h2>
        <p className="flex items-center gap-1 text-2xs text-muted-foreground">
          {d.periodLabel}
          <InfoTip>Compared with {d.prevLabel}. Premium is annual premium booked plus renewal installments collected.</InfoTip>
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi icon={<IndianRupee className="size-4" />} hue="indigo" title="Total insurance premium" value={formatMoney(d.cur.total)} zero={d.cur.total === 0} href={d.hrefs.booked}>
          <Fact k="FY to date" v={formatMoney(d.fy.total)} />
          <Fact k={d.prevLabel} v={formatMoney(d.prev.total)} />
          <Fact k="Change" v={<ChangeText cur={d.cur.total} prev={d.prev.total} />} />
        </Kpi>
        <Kpi icon={<Sparkles className="size-4" />} hue="emerald" title="New business premium" value={formatMoney(d.cur.newAmt)} zero={d.cur.newAmt === 0} href={d.hrefs.bookedNew}>
          <Fact k="FY to date" v={formatMoney(d.fy.newAmt)} />
          <Fact k="FY target" v={d.targets.newAmt != null ? formatMoney(d.targets.newAmt) : d.targets.missing} />
          <Fact k="Achieved (FY)" v={ach(d.fy.newAmt, d.targets.newAmt)} />
        </Kpi>
        <Kpi icon={<RefreshCw className="size-4" />} hue="violet" title="Renewal premium" value={formatMoney(d.cur.renAmt)} zero={d.cur.renAmt === 0} href={d.hrefs.bookedRenewal}>
          <Fact k="FY to date" v={formatMoney(d.fy.renAmt)} />
          <Fact k="FY target" v={d.targets.renAmt != null ? formatMoney(d.targets.renAmt) : d.targets.missing} />
          <Fact k="Achieved (FY)" v={ach(d.fy.renAmt, d.targets.renAmt)} />
        </Kpi>
        <Kpi icon={<FileCheck className="size-4" />} hue="cyan" title="Policies issued" value={formatCount(d.cur.policies)} zero={d.cur.policies === 0} href={d.hrefs.booked}>
          <Fact k="New policies" v={formatCount(d.cur.newN)} />
          <Fact k="Renewal policies" v={formatCount(d.cur.renN)} />
          <Fact k="FY to date" v={formatCount(d.fy.policies)} />
        </Kpi>
        <Kpi icon={<Percent className="size-4" />} hue="violet" title="Renewal %" href={d.hrefs.retention}
          value={d.retention?.policyPct != null ? formatPercent(d.retention.policyPct * 100, 1) : "—"}
          title2="Policies renewed ÷ renewals that fell due in the period, up to today">
          <Fact k="Renewed / due" v={d.retention ? `${formatCount(d.retention.renewed)} / ${formatCount(d.retention.due)}` : "—"} />
          <Fact k="Premium retention" v={d.retention?.premiumPct != null ? formatPercent(d.retention.premiumPct * 100, 1) : "—"} />
          <Fact k="Premium due" v={d.retention ? formatMoney(d.retention.duePremium) : "—"} />
        </Kpi>
        <Kpi icon={<UserPlus className="size-4" />} hue="cyan" title="New insurance clients" value={formatCount(d.newClients.cur)} zero={d.newClients.cur === 0} href={d.hrefs.newClients}>
          <Fact k="FY to date" v={formatCount(d.newClients.fy)} />
          <Fact k="FY target" v={d.targets.newClients != null ? formatCount(d.targets.newClients) : d.targets.missing} />
          <Fact k="Achieved (FY)" v={ach(d.newClients.fy, d.targets.newClients)} />
        </Kpi>
        <Kpi icon={<XCircle className="size-4" />} hue="rose" title="Lost / cancelled business" value={formatMoney(d.lost.premium)} zero={d.lost.count === 0} href={d.hrefs.lost} tone={d.lost.count > 0 ? "bad" : "neutral"}>
          <Fact k="Policies" v={formatCount(d.lost.count)} />
        </Kpi>
        <Kpi icon={<HeartPulse className="size-4" />} hue="amber" title="Open claims" value={formatCount(d.claims.open)} zero={d.claims.open === 0} href={d.hrefs.claims}>
          <Fact k="Claimed, unpaid" v={formatMoney(d.claims.outstanding)} />
        </Kpi>
      </div>
    </section>
  );
}

/* ───────────────────────── §3 / §42 / §43 comparison table ───────────────────────── */

export function CompareTable({ c, hrefs }: { c: Compare; hrefs?: Record<string, string> }) {
  const two = c.labels.length === 2;
  return (
    <Table rows={c.rows.length} empty="Nothing to compare." head={<>
      <th scope="col">Metric</th>
      {c.labels.map((l) => <th key={l} scope="col" className="text-right">{l}</th>)}
      {two && <th scope="col" className="text-right">Difference</th>}
      <th scope="col" className="text-right">{two ? "Change %" : "vs last month"}</th>
    </>}>
      {c.rows.map((r) => {
        const cur = r.values[r.values.length - 1];
        const prev = r.values[r.values.length - 2];
        return (
          <tr key={r.key}>
            <td className="py-2.5 text-xs font-medium">
              {hrefs?.[r.key] ? <Link href={hrefs[r.key]} className="hover:text-primary hover:underline">{r.label}</Link> : r.label}
            </td>
            {r.values.map((v, i) => <Num key={i}>{fmtValue(v, r.format)}</Num>)}
            {two && <Num>{r.snapshot ? "—" : diffText(cur, prev, r.format)}</Num>}
            <Num>{r.snapshot ? <span className="text-muted-foreground">Now</span> : <ChangeText cur={cur} prev={prev} format={r.format} inverse={r.inverse} />}</Num>
          </tr>
        );
      })}
    </Table>
  );
}

export function MomPanel({ c, hrefs }: { c: Compare; hrefs: Record<string, string> }) {
  return (
    <Section title="Month-on-month performance" subtitle={`${c.labels[1]} against ${c.labels[0]} — the same days, like for like.`}
      icon={<CalendarRange className="size-4" />}
      note="A change on a zero base reads N/A, never a percentage. Lost premium and claims logged are better when lower.">
      <CompareTable c={c} hrefs={hrefs} />
    </Section>
  );
}

/* ───────────────────────── §4 ───────────────────────── */

export function YoyPanel({ rows, fyLabel, pyLabel, lockedLine }: {
  rows: YoyRow[]; fyLabel: string; pyLabel: string; lockedLine?: "personal" | "commercial" | null;
}) {
  const lines = [
    { key: "personal", label: "Personal Lines" },
    { key: "commercial", label: "Commercial Lines" },
  ].filter((l) => !lockedLine || l.key === lockedLine);
  return (
    <Section title="Year-on-year by product" subtitle={`${fyLabel} to date against the same days of ${pyLabel}.`}
      icon={<GitCompareArrows className="size-4" />}
      note="Premium and policy count are shown side by side and never blended. Growth from a zero base reads “New from zero”.">
      <div className="space-y-5">
        {lines.map((l) => {
          const xs = rows.filter((r) => r.line === l.key);
          return (
            <div key={l.key}>
              <h3 className="mb-2 text-2xs font-semibold text-muted-foreground">{l.label}</h3>
              <Table rows={xs.length} empty={`No ${l.label} business in either year.`} head={<>
                <th scope="col">Product</th>
                <th scope="col" className="text-right">Previous FY period</th>
                <th scope="col" className="text-right">Current FY period</th>
                <th scope="col" className="text-right">Change</th>
                <th scope="col" className="text-right">Growth %</th>
                <th scope="col" className="text-right">Policies (prev → now)</th>
              </>}>
                {xs.map((r) => (
                  <tr key={r.grp}>
                    <td className="py-2.5 text-xs font-medium">{r.label}</td>
                    <Num>{formatMoney(r.prevAmt)}</Num>
                    <Num>{formatMoney(r.curAmt)}</Num>
                    <Num>{diffText(r.curAmt, r.prevAmt, "currency")}</Num>
                    <Num><ChangeText cur={r.curAmt} prev={r.prevAmt} newFromZero /></Num>
                    <Num>{formatCount(r.prevN)} → {formatCount(r.curN)}</Num>
                  </tr>
                ))}
              </Table>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

/* ───────────────────────── §5 ───────────────────────── */

export type LineCard = {
  key: "personal" | "commercial"; label: string; money: Money; policyPct: number | null; lostPremium: number; newClients: number;
  href: string; recordsHref: string; active: boolean;
  /** The dashboard is filtered to the OTHER line: this card's figures were filtered out, not zero. */
  filteredOut: boolean;
};

export function LinesPanel({ cards }: { cards: LineCard[] }) {
  return (
    <Section title="Personal vs Commercial Lines"
      icon={<Scale className="size-4" />}
      note="Lines follow the firm's MIS split of the policy-type picklist: motor, home and other general policies are Commercial Lines. The picklist cannot tell a private car from a commercial vehicle.">
      <div className="grid gap-3 md:grid-cols-2">
        {cards.map((c) => c.filteredOut ? (
          <div key={c.key} className="flex flex-col justify-center rounded-xl bg-secondary/40 p-4">
            <h3 className="text-sm font-semibold text-muted-foreground">{c.label}</h3>
            <p className="mt-1 text-xs text-muted-foreground">Filtered out — the dashboard is showing one line only.</p>
            <Link href={c.href} scroll={false} className="mt-2 inline-flex min-h-6 items-center text-xs font-medium text-primary hover:underline">Show {c.label} instead</Link>
          </div>
        ) : (
          <div key={c.key} className={cn("rounded-xl border p-4", c.active ? "border-primary/40 bg-accent" : "border-transparent bg-secondary/70")}>
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-sm font-semibold text-foreground">{c.label}</h3>
              <Link href={c.href} scroll={false} className="inline-flex min-h-6 items-center text-xs font-medium text-primary hover:underline">{c.active ? "Show all insurance" : "Filter to this line"}</Link>
            </div>
            <div className="mt-2 text-2xl font-semibold tabular-nums">{formatMoney(c.money.total)}</div>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
              <Fact k="New premium" v={formatMoney(c.money.newAmt)} />
              <Fact k="Renewal premium" v={formatMoney(c.money.renAmt)} />
              <Fact k="Policies" v={formatCount(c.money.policies)} />
              <Fact k="Renewal % (FY)" v={c.policyPct != null ? formatPercent(c.policyPct * 100, 1) : "—"} />
              <Fact k="Lost business" v={formatMoney(c.lostPremium)} />
              <Fact k="New clients" v={formatCount(c.newClients)} />
            </dl>
            <Link href={c.recordsHref} className="mt-3 inline-flex min-h-6 items-center gap-1 text-2xs font-medium text-primary hover:underline">
              <BarChart3 className="size-3" aria-hidden /> Open the policies
            </Link>
          </div>
        ))}
      </div>
    </Section>
  );
}
