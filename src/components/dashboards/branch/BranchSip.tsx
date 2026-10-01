/**
 * §6 SIP performance and §7 SIP exception centre.
 *
 * Net SIP is gross new SIP registered LESS the ledger's stop and pause events —
 * the same definition as the KPI strip, the scoreboard and the personal
 * cockpit (see SIP_STOP_TYPES in lib/dashboard/my/window.ts for why the stop
 * side comes from the ledger rather than the register).
 *
 * The exception centre mirrors the branch / RM rejection sheet a branch head
 * reviews by hand: rejected, repurchased, still pending, without remarks, past
 * SLA — per RM, every figure a link into the rejection register.
 */

import Link from "next/link";
import { AlertTriangle, Repeat } from "lucide-react";
import type { SipPerformance } from "@/lib/dashboard/branch/sections";
import type { RmLedgerRow } from "@/lib/dashboard/branch/rm-ledger";
import { sumLedger } from "@/lib/dashboard/branch/rm-ledger";
import { Figure, Section, SectionLink, Stat, StatGrid, Unavailable } from "@/components/dashboards/my/Shared";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { RmTable, rmRows } from "./RmTable";

/* ─────────────────────────── §6 SIP performance ─────────────────────────── */

export function BranchSipPerformance({
  data, rmHref, periodLabel,
}: {
  data: SipPerformance;
  rmHref: (id: string) => string;
  periodLabel: string;
}) {
  const peak = Math.max(1, ...data.byRm.map((r) => Math.abs(r.net)));
  const fy = data.windows.find((x) => x.key === "fytd");
  return (
    <Section
      title="SIP performance"
      subtitle="Gross SIP registered, SIP stopped and the net — this month, last month and the year."
      icon={<Repeat className="size-4" />}
      action={<SectionLink href="/dashboard/reports/sip-health">SIP health report</SectionLink>}
      note="Net SIP = gross new SIP − SIP stopped. SIP-book growth compares each RM's book today with the balance recorded about a month ago; where no such snapshot exists yet it says so, rather than guessing."
    >
      <div id="sip-performance" className="scroll-mt-40" />
      <div className="grid gap-3 sm:grid-cols-3">
        {data.windows.map((x) => (
          <div key={x.key} className="rounded-lg bg-secondary/70 p-3">
            <div className="text-2xs font-semibold text-muted-foreground">{x.label}</div>
            <div className={cn("mt-1 text-xl font-semibold tabular-nums", x.net < 0 ? "text-destructive" : "text-foreground")}>
              {formatMoney(x.net)}
            </div>
            <div className="text-2xs text-muted-foreground">net SIP</div>
            <dl className="mt-2 grid grid-cols-2 gap-2 border-t border-border/60 pt-2 text-2xs">
              <div><dt className="text-muted-foreground">Gross</dt><dd className="font-medium tabular-nums">{formatMoney(x.gross)}</dd></div>
              <div><dt className="text-muted-foreground">Stopped</dt><dd className="font-medium tabular-nums">{formatMoney(x.stop)}</dd></div>
            </dl>
          </div>
        ))}
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-2 rounded-lg border border-border bg-secondary/40 p-3 text-2xs sm:grid-cols-3">
        <div>
          <dt className="text-muted-foreground">FY net-SIP target</dt>
          <dd className="font-semibold tabular-nums"><Figure value={data.target} unavailable="No net-SIP target set for this FY." /></dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Target to date</dt>
          <dd className="font-semibold tabular-nums">
            <Figure value={data.targetToDate} unavailable={data.target == null ? "No target set." : "Target phasing is off, so there is no to-date figure."} />
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">FYTD against it</dt>
          <dd className={cn("font-semibold tabular-nums",
            data.targetToDate == null || !fy ? "" : fy.net >= data.targetToDate ? "text-success" : "text-warning-foreground")}>
            {data.targetToDate == null || !fy ? "—" : `${fy.net >= data.targetToDate ? "+" : "−"}${formatMoney(Math.abs(fy.net - data.targetToDate))}`}
          </dd>
        </div>
      </dl>

      <h3 className="mb-2 mt-5 text-2xs font-semibold text-muted-foreground">
        Net SIP by RM &mdash; {periodLabel}
      </h3>
      {data.byRm.length === 0 ? (
        <Unavailable>No SIP was registered or stopped by any RM in this view in {periodLabel}.</Unavailable>
      ) : (
        <div className="space-y-1.5">
          {data.byRm.map((r) => {
            const w = (Math.abs(r.net) / peak) * 50;
            const person = !r.id.startsWith("__");
            return (
              <div key={r.id} className="grid grid-cols-12 items-center gap-2 text-xs">
                <span className="col-span-3 truncate">
                  {person ? <Link href={rmHref(r.id)} className="hover:text-primary hover:underline">{r.name}</Link>
                          : <span className="text-muted-foreground">{r.name}</span>}
                </span>
                {/* Diverging bar: stops that outweigh new SIPs draw LEFT of the
                    centre line, in red — a negative month must not look like a
                    small positive one. */}
                <span className="relative col-span-5 h-4 rounded bg-secondary" aria-hidden>
                  <span className="absolute inset-y-0 left-1/2 w-px bg-border" />
                  <span
                    className={cn("absolute inset-y-0.5 rounded", r.net < 0 ? "bg-destructive/70" : "bg-primary/70")}
                    style={r.net < 0 ? { right: "50%", width: `${w}%` } : { left: "50%", width: `${w}%` }}
                  />
                </span>
                <span className={cn("col-span-2 text-right tabular-nums font-medium", r.net < 0 && "text-destructive")}>
                  {formatMoney(r.net)}
                </span>
                <span className="col-span-2 text-right text-2xs tabular-nums text-muted-foreground"
                      title="SIP book today against the balance recorded about a month ago.">
                  {r.bookGrowth == null ? "book Δ not recorded" : `book ${r.bookGrowth >= 0 ? "+" : "−"}${formatMoney(Math.abs(r.bookGrowth))}`}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}

/* ─────────────────────────── §7 SIP exception centre ─────────────────────────── */

const PENDING = "pending,client_contacted,bank_issue,mandate_issue";

export function BranchSipExceptions({
  ledger, rmHref, periodLabel, slaDays, book, period,
}: {
  ledger: RmLedgerRow[];
  rmHref: (id: string) => string;
  periodLabel: string;
  slaDays: number;
  /** The view — narrows the rejection register to the same clients. */
  book: { branchId: string; rmId: string | null };
  /** The selected period, applied to the register as rej_from / rej_to. */
  period: { from: string; to: string };
}) {
  // Built with URLSearchParams so a view already narrowed to one RM never
  // repeats rm= (a repeated key reaches the page as an array, not a string).
  const list = (extra?: string, rmId?: string) => {
    const q = new URLSearchParams({ branch: book.branchId, rej_from: period.from, rej_to: period.to });
    const rm = rmId ?? book.rmId;
    if (rm) q.set("rm", rm);
    if (extra) for (const [k, v] of new URLSearchParams(extra)) q.set(k, v);
    return `/dashboard/sip-rejections?${q.toString()}`;
  };
  const rows = rmRows(ledger).filter((r) => r.sipRejections > 0 || r.kind === "person");
  const n = (k: keyof RmLedgerRow) => sumLedger(ledger, k);
  const rmOf = (r: RmLedgerRow) => (r.kind === "person" ? r.id : undefined);
  const cell = (extra?: string) => (r: RmLedgerRow) => (r.kind === "person" ? list(extra, r.id) : null);

  return (
    <Section
      title="SIP exception centre"
      subtitle={`Every bounced SIP debit in ${periodLabel}, and whether it has been won back.`}
      icon={<AlertTriangle className="size-4" />}
      action={<SectionLink href={list()}>Open SIP rejections</SectionLink>}
      note={`Rejections are read from the transaction ledger with the rejection register's recovery status joined on. "Past SLA" means still pending more than ${slaDays} day${slaDays === 1 ? "" : "s"} after the debit bounced — the SLA is set in Settings → Dashboard thresholds.`}
    >
      <StatGrid cols={5}>
        <Stat label="SIP rejections" value={n("sipRejections")} tone={n("sipRejections") > 0 ? "warn" : "neutral"}
              hint={`${formatMoney(n("sipRejectionValue"))} monthly value`} href={list()} />
        <Stat label="Repurchase done" value={n("sipRepurchased")} tone={n("sipRepurchased") > 0 ? "good" : "neutral"}
              hint={formatMoney(n("sipRepurchasedValue"))} href={list("recovery=recovered,reprocessed")} />
        <Stat label="Still pending" value={n("sipPending")} tone={n("sipPending") > 0 ? "bad" : "neutral"}
              hint={formatMoney(n("sipPendingValue"))} href={list(`recovery=${PENDING}`)} />
        <Stat label="Without remarks" value={n("sipNoRemarks")} tone={n("sipNoRemarks") > 0 ? "warn" : "neutral"}
              hint="no context recorded" href={list()} />
        <Stat label="Pending beyond SLA" value={n("sipPastSla")} tone={n("sipPastSla") > 0 ? "bad" : "neutral"}
              hint={`over ${slaDays} day${slaDays === 1 ? "" : "s"}`} href={list(`recovery=${PENDING}`)} />
      </StatGrid>
      <div className="mt-4">
        <RmTable
          rows={rows}
          rmHref={rmHref}
          empty="No SIP debit bounced in this view in the period."
          cols={[
            { key: "n", label: "Rejected", get: (r) => r.sipRejections, href: cell() },
            { key: "v", label: "Rejected value", get: (r) => r.sipRejectionValue, format: "currency" },
            { key: "rep", label: "Repurchased", get: (r) => r.sipRepurchased, href: cell("recovery=recovered,reprocessed"),
              tone: (v) => (v ? "good" : "neutral") },
            { key: "p", label: "Pending", get: (r) => r.sipPending, href: cell(`recovery=${PENDING}`),
              tone: (v) => (v ? "bad" : "neutral") },
            { key: "pv", label: "Pending value", get: (r) => r.sipPendingValue, format: "currency" },
            { key: "nr", label: "Without remarks", get: (r) => r.sipNoRemarks, tone: (v) => (v ? "warn" : "neutral") },
            { key: "sla", label: "Past SLA", get: (r) => r.sipPastSla, tone: (v) => (v ? "bad" : "neutral"),
              href: (r) => (rmOf(r) ? list(`recovery=${PENDING}`, rmOf(r)) : null) },
          ]}
        />
      </div>
    </Section>
  );
}
