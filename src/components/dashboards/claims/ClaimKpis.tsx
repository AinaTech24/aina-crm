/**
 * §1 executive claim KPI strip · §2 claim value summary. Server components;
 * every tile opens the claims it counts.
 */

import Link from "next/link";
import type { ReactNode } from "react";
import { AlarmClock, CheckCircle2, FilePlus, FileQuestion, FolderOpen, Hourglass, IndianRupee, Wallet, XCircle } from "lucide-react";
import type { kpiStrip, valueSummary } from "@/lib/dashboard/claims/analysis";
import { InfoTip, Section, Stat, StatGrid } from "@/components/dashboards/my/Shared";
import { formatCount, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

function Kpi({ title, value, children, href, tone = "neutral", hint, zero = false, icon, hue }: {
  title: string; value: ReactNode; children?: ReactNode; href: string; tone?: "neutral" | "bad" | "warn" | "good"; hint?: string;
  /** The tile's icon chip and its hue — the same anatomy as every other dashboard's headline tile. */
  icon?: ReactNode; hue?: "indigo" | "violet" | "emerald" | "cyan" | "amber" | "rose";
  /** A real zero: shown grey, so it does not compete with the figures that moved. */
  zero?: boolean;
}) {
  return (
    <Link href={href} title={hint}
      className={cn("card-surface flex h-full flex-col p-4",
        tone === "bad" ? "border-destructive/50 bg-destructive/5" : tone === "warn" && "border-warning/50")}
      style={hue ? { ["--c" as string]: `hsl(var(--metric-${hue}))` } : undefined}>
      <div className="flex items-start justify-between gap-2">
        <div className="text-xs font-medium leading-snug text-muted-foreground">{title}</div>
        {icon && <span className="dash-kpi-chip" aria-hidden>{icon}</span>}
      </div>
      <div className={cn("mt-1 text-2xl tabular-nums leading-tight tracking-tight",
        zero ? "font-medium text-muted-foreground/60"
        : cn("font-semibold", tone === "bad" ? "text-destructive" : tone === "warn" ? "text-warning-foreground" : tone === "good" ? "text-success" : "text-foreground"))}>{value}</div>
      {children && <dl className="mt-auto space-y-0.5 border-t border-border/60 pt-2.5 text-2xs text-muted-foreground">{children}</dl>}
    </Link>
  );
}
function Fact({ k, v }: { k: string; v: ReactNode }) {
  return <div className="flex justify-between gap-2"><dt>{k}</dt><dd className="whitespace-nowrap tabular-nums text-foreground">{v}</dd></div>;
}

export function KpiStrip({ k, periodLabel, hrefs }: { k: ReturnType<typeof kpiStrip>; periodLabel: string; hrefs: Record<string, string> }) {
  return (
    <section aria-label="Claim KPIs">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="section-title">Claims today</h2>
        <p className="flex items-center gap-1 text-2xs text-muted-foreground">
          Settled and rejected: {periodLabel}
          <InfoTip>Open, pending and SLA are as of today. Settled and rejected cover {periodLabel}. Claim amount is the claimed amount; settled amount is what was paid.</InfoTip>
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi icon={<FilePlus className="size-4" />} hue="indigo" title="Claims logged" value={formatCount(k.loggedToday.n)} zero={k.loggedToday.n === 0} href={hrefs.logged} hint="Claims intimated (or keyed, where there is no intimation date)">
          <Fact k="Today" v={`${formatCount(k.loggedToday.n)} · ${formatMoney(k.loggedToday.amount)}`} />
          <Fact k="Month to date" v={`${formatCount(k.loggedMtd.n)} · ${formatMoney(k.loggedMtd.amount)}`} />
          <Fact k="FY to date" v={`${formatCount(k.loggedFytd.n)} · ${formatMoney(k.loggedFytd.amount)}`} />
        </Kpi>
        <Kpi icon={<FolderOpen className="size-4" />} hue="cyan" title="Open claims" value={formatCount(k.open.n)} zero={k.open.n === 0} href={hrefs.open}>
          <Fact k="Claim amount" v={formatMoney(k.open.amount)} />
          <Fact k="Grievance cases" v={formatCount(k.legalOpen)} />
        </Kpi>
        <Kpi icon={<CheckCircle2 className="size-4" />} hue="emerald" title="Claims settled" value={formatCount(k.settled.n)} zero={k.settled.n === 0} href={hrefs.settled} tone={k.settled.n ? "good" : "neutral"}>
          <Fact k="Settled amount" v={formatMoney(k.settled.amount)} />
        </Kpi>
        <Kpi icon={<Hourglass className="size-4" />} hue="amber" title="Claims pending" value={formatCount(k.pending.n)} zero={k.pending.n === 0} href={hrefs.pending} hint="Open claims in process — everything open except file not received">
          <Fact k="Claim amount" v={formatMoney(k.pending.amount)} />
        </Kpi>
        <Kpi icon={<FileQuestion className="size-4" />} hue="amber" title="File / documents not received" value={formatCount(k.fnr.n)} zero={k.fnr.n === 0} href={hrefs.fnr} tone={k.fnr.n ? "warn" : "neutral"} hint="Status File awaited, or no status set">
          <Fact k="Claim amount" v={formatMoney(k.fnr.amount)} />
        </Kpi>
        <Kpi icon={<XCircle className="size-4" />} hue="rose" title="Claims rejected" value={formatCount(k.rejected.n)} zero={k.rejected.n === 0} href={hrefs.rejected} hint="The insurer's decision — not a verdict on the claim or the team">
          <Fact k="Claim amount" v={formatMoney(k.rejected.amount)} />
        </Kpi>
        <Kpi icon={<Wallet className="size-4" />} hue="violet" title="Settlement pending" value={<span className="text-base font-medium text-muted-foreground">Not recorded</span>} href={hrefs.settlement}
          hint="The CRM has no approval step: a claim goes from under process to settled, so approved-but-unpaid cannot be counted." />
        <Kpi icon={<AlarmClock className="size-4" />} hue="rose" title="SLA breached" value={formatCount(k.slaBreached.n)} zero={k.slaBreached.n === 0} href={hrefs.sla} tone={k.slaBreached.n ? "bad" : "neutral"}>
          <Fact k="Claim amount" v={formatMoney(k.slaBreached.amount)} />
        </Kpi>
      </div>
    </section>
  );
}

export function ValueSummary({ v, periodLabel }: { v: ReturnType<typeof valueSummary>; periodLabel: string }) {
  return (
    <Section title="Claim value summary" icon={<IndianRupee className="size-4" />}
      note={`Outstanding is the claimed amount on claims still open, never claimed less settled across the book — rejected and withdrawn claims would distort that. The CRM has no approved amount.${v.claimedMissing ? ` ${formatCount(v.claimedMissing)} claim${v.claimedMissing === 1 ? " has" : "s have"} no claimed amount.` : ""}`}>
      <StatGrid cols={5}>
        <Stat label={`Claimed (${periodLabel})`} value={v.claimed} format="currency" hint="On claims intimated in the period" />
        <Stat label={`Settled (${periodLabel})`} value={v.settled} format="currency" tone={v.settled ? "good" : "neutral"} hint="Paid on claims settled in the period" />
        <Stat label="Outstanding" value={v.outstanding} format="currency" hint="Claimed on open claims, today" />
        <Stat label={`Rejected (${periodLabel})`} value={v.rejected} format="currency" hint="Claimed on claims rejected in the period" />
        <Stat label="Approved but unsettled" value={null} format="currency" unavailable="The CRM has no approval step or approved amount." />
      </StatGrid>
    </Section>
  );
}
