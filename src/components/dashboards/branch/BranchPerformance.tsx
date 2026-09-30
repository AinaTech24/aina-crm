/**
 * §2 target vs achievement, §3 RM scoreboard, §4 RM target matrix,
 * §26 RM one-on-one and §30 FY scorecard — the "am I on target, and who is
 * behind" half of the branch command centre.
 *
 * Every judgement here comes from src/lib/dashboard/branch/targets.ts, so the
 * scoreboard's status column, the matrix's colours and the one-on-one panel
 * cannot disagree about an RM. None of them computes an overall score.
 */

import Link from "next/link";
import { ArrowLeft, CalendarRange, ClipboardCheck, Target, Trophy, UserRound } from "lucide-react";
import type { TargetMeter } from "@/lib/dashboard/my/kpis";
import type { RmLedgerRow } from "@/lib/dashboard/branch/rm-ledger";
import type { ScorecardRow } from "@/lib/dashboard/branch/sections";
import { ratio, targetCells, targetStatus, type Band, type TargetCell } from "@/lib/dashboard/branch/targets";
import { Figure, Meter, Num, Section, SectionLink, Stat, StatGrid, Table, Unavailable } from "@/components/dashboards/my/Shared";
import { formatCount, formatMoney, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import { RmTable, type RmCol } from "./RmTable";

/* ───────────────────────────── shared bits ───────────────────────────── */

const BAND_CHIP: Record<Band, string> = {
  achieved: "bg-success/10 text-success",
  near: "bg-warning/10 text-warning-foreground",
  short: "bg-destructive/10 text-destructive",
};
const BAND_LABEL: Record<Band, string> = { achieved: "Achieved", near: "Near target", short: "Shortfall" };

/** Horizon toggle chips (MTD | QTD | FYTD), each a link so the choice survives a refresh. */
export function ToggleChips<K extends string>({
  options, current, hrefs, label,
}: {
  options: Array<{ key: K; label: string }>;
  current: K;
  hrefs: Record<K, string>;
  label: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1" role="group" aria-label={label}>
      {options.map((o) => (
        <Link
          key={o.key}
          href={hrefs[o.key]}
          scroll={false}
          aria-current={o.key === current ? "true" : undefined}
          className={cn(
            "inline-flex min-h-6 items-center rounded-md px-2.5 py-1 text-2xs font-semibold transition-colors",
            o.key === current ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </Link>
      ))}
    </div>
  );
}

function StatusChips({ cells }: { cells: TargetCell[] }) {
  const s = targetStatus(cells);
  if (s.judged === 0) {
    return <span className="text-2xs text-muted-foreground" title="No target is set for this period, so nothing is judged.">No targets</span>;
  }
  return (
    <span className="inline-flex flex-wrap justify-end gap-1" title="Count of targets in each band for this period. Not a score.">
      {s.achieved > 0 && <span className={cn("chip", BAND_CHIP.achieved)}>{s.achieved} achieved</span>}
      {s.near > 0 && <span className={cn("chip", BAND_CHIP.near)}>{s.near} near</span>}
      {s.short > 0 && <span className={cn("chip", BAND_CHIP.short)}>{s.short} short</span>}
    </span>
  );
}

/* ─────────────────────────── §2 branch targets ─────────────────────────── */

export type Horizon = "wtd" | "mtd" | "qtd" | "fytd";

const HORIZON_WORD: Record<Horizon, string> = {
  wtd: "week to date", mtd: "month to date", qtd: "quarter to date", fytd: "FY to date",
};

export function BranchTargets({
  meters, horizon, hrefs, phasing, fyLabel, oneRm, title, options, personal = false,
}: {
  meters: TargetMeter[];
  horizon: Horizon;
  hrefs: Partial<Record<Horizon, string>>;
  phasing: "linear" | "none";
  fyLabel: string;
  /** Name of the RM when the view is narrowed to one. */
  oneRm: string | null;
  title?: string;
  /** The toggle's horizons — MTD | QTD | FYTD on the branch, Weekly | Monthly | FYTD on the desk. */
  options?: Array<{ key: Horizon; label: string }>;
  /** The RM desk: "Remaining" rather than "Gap", personal-target wording. */
  personal?: boolean;
}) {
  const anyTarget = meters.some((m) => m.annual != null);
  const horizonWord = HORIZON_WORD[horizon];
  const opts = options ?? [{ key: "mtd", label: "MTD" }, { key: "qtd", label: "QTD" }, { key: "fytd", label: "FYTD" }];
  return (
    <Section
      title={title ?? (oneRm ? `Targets — ${oneRm}` : "Branch target vs achievement")}
      subtitle={`Target, actual and ${personal ? "what remains" : "the gap"} for ${horizonWord}.`}
      icon={<Target className="size-4" />}
      action={
        <ToggleChips
          label="Target horizon"
          current={horizon}
          hrefs={hrefs as Record<Horizon, string>}
          options={opts}
        />
      }
      note={phasing === "linear"
        ? `Flow targets are the ${fyLabel} annual target pro-rated by days elapsed in the ${horizonWord} window — the firm's configured phasing. AUM and SIP book are closing balances, held to the annual figure whatever the horizon.`
        : `The firm has target phasing switched off, so a month or a quarter has no target of its own ("Not phased"). FYTD compares with the full annual target. AUM and SIP book are closing balances, held to the annual figure.`}
    >
      {!anyTarget && (
        <Unavailable>
          No {fyLabel} targets are recorded for {personal ? "you" : oneRm ?? "this branch"}, so there is nothing to measure against.
          Actuals are still shown. {personal || oneRm ? "Personal targets are set on the Team scorecard." : "Branch targets are set in Settings → Targets & quota."}
        </Unavailable>
      )}
      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {meters.map((m) => (
          <div key={m.key}>
            <Meter
              label={m.label}
              target={m.target}
              actual={m.actual}
              format={m.format}
              pace={m.pace}
              href={m.href}
              missing={m.missing}
              behindLabel={personal ? "Remaining" : "Gap"}
              neutralShortfall={personal}
            />
            <p className="mt-1 px-1 text-2xs text-muted-foreground">
              {m.annual == null
                ? "No annual target"
                : m.stock
                  ? `Closing target for ${fyLabel}`
                  : m.target != null
                    ? <>FY target <span className="tabular-nums">{m.format === "count" ? formatCount(m.annual) : formatMoney(m.annual)}</span>, phased to date</>
                    : <>FY target <span className="tabular-nums">{m.format === "count" ? formatCount(m.annual) : formatMoney(m.annual)}</span></>}
            </p>
          </div>
        ))}
      </div>
      {!personal && (
        <p className="mt-4 text-2xs text-muted-foreground">
          Equity brokerage has no branch-level record in this CRM, so it has no meter here.
        </p>
      )}
    </Section>
  );
}

/* ─────────────────────────── §3 RM scoreboard ─────────────────────────── */

export type ScoreSort = "aum" | "sip" | "net_business" | "new_clients" | "meetings" | "target" | "overdue_tasks";
export const SCORE_SORTS: Array<{ key: ScoreSort; label: string }> = [
  { key: "aum", label: "AUM" },
  { key: "sip", label: "SIP book" },
  { key: "net_business", label: "Net business" },
  { key: "new_clients", label: "New clients" },
  { key: "meetings", label: "Meetings" },
  { key: "target", label: "Target achievement" },
  { key: "overdue_tasks", label: "Overdue tasks" },
];

export function RmScoreboard({
  rows, phase, near, noPhase, sort, sortHrefs, rmHref, periodLabel,
}: {
  rows: RmLedgerRow[];
  phase: number | null;
  near: number;
  noPhase: string;
  sort: ScoreSort;
  sortHrefs: Record<ScoreSort, string>;
  rmHref: (id: string) => string;
  periodLabel: string;
}) {
  const cellsOf = new Map(rows.map((r) => [r.id, targetCells(r, phase, near, noPhase)]));
  const status = (r: RmLedgerRow) => targetStatus(cellsOf.get(r.id) ?? []);
  const key: Record<ScoreSort, (r: RmLedgerRow) => number> = {
    aum: (r) => r.aum,
    sip: (r) => r.sipBook,
    net_business: (r) => r.grossInvestment - r.redemption,
    new_clients: (r) => r.newClients,
    meetings: (r) => (r.newMeetings ?? 0) + (r.reviewMeetings ?? 0),
    target: (r) => {
      const s = status(r);
      // Achieved first, then near, then fewest shortfalls; unjudged last.
      return s.judged === 0 ? -1 : s.achieved * 1e6 + s.near * 1e3 - s.short;
    },
    overdue_tasks: (r) => r.tasksOverdueNow ?? -1,
  };
  const sorted = [...rows].sort((a, b) =>
    Number(a.kind !== "person") - Number(b.kind !== "person") || key[sort](b) - key[sort](a) || a.name.localeCompare(b.name));

  const aumPct = (r: RmLedgerRow) => ratio(r.aum, r.targets.aum);
  const sipPct = (r: RmLedgerRow) => ratio(r.sipBook, r.targets.sip_book);
  const sum = (f: (r: RmLedgerRow) => number | null) => (rs: RmLedgerRow[]) => rs.reduce((s, r) => s + (f(r) ?? 0), 0);

  const cols: RmCol[] = [
    { key: "aum", label: "AUM", get: (r) => r.aum, format: "currency" },
    { key: "aum_t", label: "AUM target", title: "Current AUM against the RM's closing AUM target for the FY.", get: aumPct, format: "percent", total: "none" },
    { key: "sip", label: "SIP book", get: (r) => r.sipBook, format: "currency" },
    { key: "sip_t", label: "SIP target", title: "Current SIP book against the RM's closing SIP-book target.", get: sipPct, format: "percent", total: "none" },
    { key: "gsip", label: "Gross SIP", get: (r) => r.grossSip, format: "currency" },
    { key: "stop", label: "SIP stop", get: (r) => r.sipStop, format: "currency" },
    { key: "nsip", label: "Net SIP", get: (r) => r.grossSip - r.sipStop, format: "currency", tone: (v) => (v != null && v < 0 ? "bad" : "neutral") },
    { key: "gross", label: "Gross investment", get: (r) => r.grossInvestment, format: "currency" },
    { key: "red", label: "Redemption", get: (r) => r.redemption, format: "currency" },
    { key: "net", label: "Net business", get: (r) => r.grossInvestment - r.redemption, format: "currency", tone: (v) => (v != null && v < 0 ? "warn" : "neutral") },
    { key: "newc", label: "New clients", get: (r) => r.newClients },
    { key: "newm", label: "New meetings", get: (r) => r.newMeetings },
    { key: "revm", label: "Review meetings", get: (r) => r.reviewMeetings },
    {
      key: "conv", label: "Proposal conv.", title: "Accepted ÷ decided (accepted + rejected). Undecided proposals are not counted as losses.",
      get: (r) => ratio(r.proposalsConverted, r.proposalsDecided), format: "percent",
      total: (rs) => ratio(sum((r) => r.proposalsConverted)(rs), sum((r) => r.proposalsDecided)(rs)),
    },
    {
      key: "ticket", label: "Avg ticket", title: "Lump-sum and additional purchases only — SIP instalments are left out.",
      get: (r) => ratio(r.buyValue, r.buys), format: "currency",
      total: (rs) => ratio(sum((r) => r.buyValue)(rs), sum((r) => r.buys)(rs)),
    },
    {
      key: "tasks", label: "Tasks done", title: "Of the tasks raised in the period, the share completed.",
      get: (r) => ratio(r.tasksDone, r.tasksAssigned), format: "percent",
      total: (rs) => ratio(sum((r) => r.tasksDone)(rs), sum((r) => r.tasksAssigned)(rs)),
    },
    { key: "od", label: "Overdue tasks", title: "Open tasks past their due date today, whenever they were raised.",
      get: (r) => r.tasksOverdueNow, tone: (v) => (v != null && v > 0 ? "bad" : "neutral") },
    { key: "q", label: "Open service requests", get: (r) => r.queriesOpen, tone: (v) => (v != null && v > 0 ? "warn" : "neutral") },
    { key: "ins", label: "Insurance", get: (r) => r.insurance, format: "currency" },
    {
      key: "status", label: "Target status", title: "How many of this RM's targets are achieved, near or short for the period. A count, not a score.",
      get: () => null, total: "none",
      render: (r) => (r.kind === "person" ? <StatusChips cells={cellsOf.get(r.id) ?? []} /> : <span className="text-muted-foreground">—</span>),
    },
  ];

  return (
    <Section
      title="RM performance scoreboard"
      subtitle={`Every RM's book and business for ${periodLabel}.`}
      icon={<Trophy className="size-4" />}
      note="Client figures (AUM, SIP, flows, new clients, service requests) follow the client's RM within this branch; work figures (meetings, proposals, tasks, insurance booked) follow the person. The last rows hold branch clients whose RM works elsewhere or who have no RM, so every column adds up to the branch total. There is no overall score — only target statuses you can check in the matrix below."
    >
      {/* In the body, not the header's action slot: that slot does not shrink,
          so seven chips ran off the card on a phone. */}
      <div className="mb-3 flex flex-wrap items-center gap-1" role="group" aria-label="Sort RMs by">
          <span className="text-2xs text-muted-foreground">Sort</span>
          {SCORE_SORTS.map((s) => (
            <Link
              key={s.key}
              href={sortHrefs[s.key]}
              scroll={false}
              aria-current={s.key === sort ? "true" : undefined}
              className={cn(
                "inline-flex min-h-6 items-center rounded-md px-2 py-1 text-2xs font-medium transition-colors",
                s.key === sort ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {s.label}
            </Link>
          ))}
      </div>
      <RmTable rows={sorted} cols={cols} rmHref={rmHref} />
    </Section>
  );
}

/* ─────────────────────────── §4 RM target matrix ─────────────────────────── */

const MATRIX_KEYS = ["net_sip", "sip_book", "net_business", "new_clients", "meetings", "reviews", "insurance"] as const;

export function RmTargetMatrix({
  rows, phase, near, noPhase, rmHref, periodLabel, fyLabel,
}: {
  rows: RmLedgerRow[];
  phase: number | null;
  near: number;
  noPhase: string;
  rmHref: (id: string) => string;
  periodLabel: string;
  fyLabel: string;
}) {
  const people = rows.filter((r) => r.kind === "person" && r.isRm);
  const groups = people.map((r) => ({ r, cells: targetCells(r, phase, near, noPhase, [...MATRIX_KEYS]) }));
  return (
    <Section
      title="RM target matrix"
      subtitle={`Each RM against each of their ${fyLabel} targets for ${periodLabel}.`}
      icon={<ClipboardCheck className="size-4" />}
      action={<SectionLink href="/dashboard/team/scorecard/targets">Set targets</SectionLink>}
      note={`Green: target achieved. Amber: at or above ${formatPercent(near * 100, 0)} of target. Red: below that. The ${formatPercent(near * 100, 0)} band is set by the administrator in Settings → Dashboard thresholds; it is not fixed in code.`}
    >
      <div id="rm-targets" className="scroll-mt-40" />
      <Table
        rows={groups.length}
        empty="No relationship managers in this view."
        head={
          <>
            <th scope="col">RM</th>
            <th scope="col">Metric</th>
            <th scope="col" className="text-right">Target</th>
            <th scope="col" className="text-right">Actual</th>
            <th scope="col" className="text-right">Gap</th>
            <th scope="col" className="text-right">Achievement</th>
          </>
        }
      >
        {groups.map(({ r, cells }) => {
          const withTarget = cells.filter((c) => c.annual != null);
          if (withTarget.length === 0) {
            return (
              <tr key={r.id}>
                <td className="py-2.5 font-medium">
                  <Link href={rmHref(r.id)} className="hover:text-primary hover:underline">{r.name}</Link>
                </td>
                <td colSpan={5} className="py-2.5 text-xs text-muted-foreground">
                  No {fyLabel} targets set for this RM.
                </td>
              </tr>
            );
          }
          return withTarget.map((c, i) => (
            <tr key={`${r.id}-${c.key}`} className={i === 0 ? "border-t-2 border-border" : undefined}>
              {i === 0 && (
                <td rowSpan={withTarget.length} className="py-2.5 align-top font-medium">
                  <Link href={rmHref(r.id)} className="hover:text-primary hover:underline">{r.name}</Link>
                  <div className="mt-0.5 text-2xs font-normal text-muted-foreground">
                    {cells.length - withTarget.length > 0 && `${cells.length - withTarget.length} metric${cells.length - withTarget.length === 1 ? "" : "s"} without a target`}
                  </div>
                </td>
              )}
              <td className="py-2.5 text-xs">
                {c.label}
                {c.stock && <span className="ml-1 text-2xs text-muted-foreground">(closing)</span>}
              </td>
              <Num><Figure value={c.target} format={c.format} unavailable={c.missing ?? "Not set"} /></Num>
              <Num><Figure value={c.actual} format={c.format} /></Num>
              <Num tone={c.gap == null ? "neutral" : c.gap < 0 ? "bad" : "good"}>
                {c.gap == null ? <span className="text-muted-foreground">—</span> : (
                  <>{c.gap < 0 ? "−" : "+"}<Figure value={Math.abs(c.gap)} format={c.format} /></>
                )}
              </Num>
              <Num>
                {c.pct == null ? (
                  <span className="text-2xs text-muted-foreground" title={c.missing === "Not phased"
                    ? "Phasing is off, so this period has no target of its own."
                    : c.missing === "Other FY" ? "This period falls outside the current financial year's targets." : "No target set."}>
                    {c.missing ?? "Not set"}
                  </span>
                ) : (
                  <span className={cn("chip", BAND_CHIP[c.band!])} title={BAND_LABEL[c.band!]}>
                    {formatPercent(c.pct * 100, 1)}
                  </span>
                )}
              </Num>
            </tr>
          ));
        })}
      </Table>
    </Section>
  );
}

/* ─────────────────────────── §26 RM one-on-one ─────────────────────────── */

export function RmOneOnOne({
  row, phase, near, noPhase, periodLabel, backHref, links,
}: {
  row: RmLedgerRow;
  phase: number | null;
  near: number;
  noPhase: string;
  periodLabel: string;
  /** Back to the whole branch; null when the viewer may see only this RM. */
  backHref: string | null;
  links: { clients: string; tasks: string; meetings: string; leads: string };
}) {
  const cells = targetCells(row, phase, near, noPhase);
  const status = targetStatus(cells);
  const completeness = ratio(row.recordsComplete, row.clients);
  return (
    <Section
      title={`RM one-on-one — ${row.name}`}
      subtitle={`Everything for a weekly review with ${row.name}, for ${periodLabel}. Client figures cover their clients in this branch.`}
      icon={<UserRound className="size-4" />}
      className="border-primary/30"
      action={
        backHref ? (
          <Link href={backHref} className="inline-flex min-h-6 items-center gap-1 rounded px-1 text-xs font-medium text-primary hover:bg-accent hover:underline">
            <ArrowLeft className="size-3.5" aria-hidden /> Whole branch
          </Link>
        ) : undefined
      }
    >
      <StatGrid cols={6}>
        <Stat label="Current AUM" value={row.aum} format="currency" href={links.clients} />
        <Stat label="SIP book" value={row.sipBook} format="currency" />
        <Stat label="Net SIP" value={row.grossSip - row.sipStop} format="currency" tone={row.grossSip - row.sipStop < 0 ? "bad" : "neutral"} />
        <Stat label="Net business" value={row.grossInvestment - row.redemption} format="currency" />
        <Stat label="New clients" value={row.newClients} />
        <Stat label="Meetings" value={row.meetingsHeld} href={links.meetings} />
        <Stat label="Review meetings" value={row.reviewMeetings} />
        <Stat label="Proposals" value={row.proposals} hint={row.proposalsLive ? `${row.proposalsLive} awaiting reply` : undefined} />
        <Stat label="Pending tasks" value={row.tasksOpenNow} tone={(row.tasksOverdueNow ?? 0) > 0 ? "bad" : "neutral"}
              hint={row.tasksOverdueNow ? `${row.tasksOverdueNow} overdue` : "whenever raised"} href={links.tasks} />
        <Stat label="Overdue reviews" value={row.reviewsOverdue} tone={row.reviewsOverdue > 0 ? "bad" : "neutral"} />
        <Stat label="Open service requests" value={row.queriesOpen} tone={row.queriesOverdue > 0 ? "bad" : "neutral"}
              hint={row.queriesOverdue ? `${row.queriesOverdue} past SLA` : undefined} />
        <Stat label="SIP rejections" value={row.sipRejections} tone={row.sipPending > 0 ? "bad" : "neutral"}
              hint={row.sipRejections ? `${formatMoney(row.sipRejectionValue)} · ${row.sipPending} pending` : undefined} />
        <Stat label="Redemptions" value={row.redemption} format="currency" hint={row.redemptionClients ? `${row.redemptionClients} clients` : undefined} />
        <Stat label="Insurance business" value={row.insurance} format="currency" />
        <Stat label="CRM data complete" value={completeness} format="percent"
              unavailable="No clients, so there are no records to check." />
        <Stat
          label="Target achievement"
          display={status.judged === 0 ? <span className="text-muted-foreground">—</span> : `${status.achieved}/${status.judged}`}
          hint={status.judged === 0 ? "no targets for this period" : `achieved · ${status.near} near · ${status.short} short`}
        />
      </StatGrid>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
        <SectionLink href={links.clients}>Their clients</SectionLink>
        <SectionLink href={links.tasks}>Their tasks</SectionLink>
        <SectionLink href={links.meetings}>Their meetings</SectionLink>
        <SectionLink href={links.leads}>Their leads</SectionLink>
      </div>
    </Section>
  );
}

/* ─────────────────────────── §30 FY scorecard ─────────────────────────── */

export function FyScorecard({
  rows, fyLabel, phasing, elapsed, title,
}: {
  rows: ScorecardRow[];
  fyLabel: string;
  phasing: "linear" | "none";
  /** 0..1 of the FY elapsed, for the note. */
  elapsed: number;
  title?: string;
}) {
  const showExpected = phasing === "linear";
  return (
    <Section
      title={title ?? `FY ${fyLabel} branch scorecard`}
      subtitle="The whole year so far — annual target, actual, what remains."
      icon={<CalendarRange className="size-4" />}
      note={showExpected
        ? `"Expected by today" pro-rates the annual target by days elapsed (${formatPercent(elapsed * 100, 0)} of the year) — the firm's configured phasing. It is an expectation, not a forecast: nothing here projects where the year will end.`
        : "Expected progress is not shown: target phasing is switched off for this firm, so no approved method exists to say where a metric should be by today. Nothing here forecasts where the year will end."}
    >
      <Table
        rows={rows.length}
        empty="No metrics to score."
        head={
          <>
            <th scope="col">Metric</th>
            <th scope="col" className="text-right">Annual target</th>
            <th scope="col" className="text-right">Actual FYTD</th>
            <th scope="col" className="text-right">Remaining</th>
            <th scope="col" className="text-right">Achievement</th>
            {showExpected && <th scope="col" className="text-right">Expected by today</th>}
          </>
        }
      >
        {rows.map((r) => (
          <tr key={r.key}>
            <td className="py-2.5 font-medium">
              {r.label}
              {r.stock && <span className="ml-1 text-2xs font-normal text-muted-foreground">(balance today)</span>}
            </td>
            <Num><Figure value={r.annual} format={r.format} unavailable="No annual target set." /></Num>
            <Num><Figure value={r.actual} format={r.format} /></Num>
            <Num tone={r.remaining != null && r.remaining > 0 ? "warn" : "neutral"}>
              <Figure value={r.remaining} format={r.format} unavailable="No target set." />
            </Num>
            <Num>
              {r.pct == null ? <span className="text-2xs text-muted-foreground">Not set</span> : (
                <span className="font-semibold">{formatPercent(r.pct * 100, 1)}</span>
              )}
            </Num>
            {showExpected && (
              <Num>
                {r.stock ? (
                  <span className="text-2xs text-muted-foreground" title="A closing balance is not phased through the year.">Not phased</span>
                ) : (
                  <Figure value={r.expected} format={r.format} unavailable="No target set." />
                )}
              </Num>
            )}
          </tr>
        ))}
      </Table>
    </Section>
  );
}
