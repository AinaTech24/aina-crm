/**
 * §1 My business KPIs — ten tiles.
 *
 * Each tile is an INDEPENDENT measure, so each takes the money unit its own
 * magnitude deserves. Pinning the row to one unit was tried on the firm
 * cockpit and rendered an ₹8 Lakh SIP book as "₹0.09 Cr". `pickMoneyScale()`
 * is for the other case — several figures of the same measure side by side,
 * such as a column of category AUMs.
 *
 * A balance tile (AUM, the SIP book) says "Balance today" under its name.
 * Its change is mostly the market; every other tile is money that MOVED in
 * the period named above the row. Without the marker, a director reads
 * "My AUM +6.9%" as sales they made. The brief says it outright — "Do not
 * treat AUM movement as net business" — and a label on the tile is the only
 * place that instruction survives contact with a screenshot. It used to say
 * "stock" and "flow"; nobody outside finance reads those words that way.
 *
 * Quiet by default: no comparison line when there is nothing to compare, and
 * a zero is grey rather than a bold figure competing with the real ones.
 */

import Link from "next/link";
import {
  ArrowDownRight, ArrowUpRight, CalendarCheck, Minus, Repeat, Shield, TrendingDown, TrendingUp,
  UserPlus, Wallet, XCircle,
} from "lucide-react";
import type { MyKpi } from "@/lib/dashboard/my/kpis";
import { formatCount, formatMoney, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Sparkline } from "@/components/dashboards/system/Sparkline";

const ICON: Record<MyKpi["key"], React.ReactNode> = {
  aum: <TrendingUp className="size-4" />,
  sip_book: <Repeat className="size-4" />,
  gross_sip: <TrendingUp className="size-4" />,
  sip_stop: <XCircle className="size-4" />,
  net_sip: <Repeat className="size-4" />,
  gross_investment: <Wallet className="size-4" />,
  redemption: <TrendingDown className="size-4" />,
  net_business: <TrendingUp className="size-4" />,
  new_clients: <UserPlus className="size-4" />,
  insurance: <Shield className="size-4" />,
  meetings: <CalendarCheck className="size-4" />,
};

const HUE: Record<MyKpi["key"], string> = {
  aum: "indigo",
  sip_book: "violet",
  gross_sip: "violet",
  sip_stop: "rose",
  net_sip: "violet",
  gross_investment: "emerald",
  redemption: "rose",
  net_business: "emerald",
  new_clients: "cyan",
  insurance: "amber",
  meetings: "cyan",
};

function fmt(k: MyKpi, v: number | null | undefined) {
  if (v == null) return "—";
  return k.format === "count" ? formatCount(v) : formatMoney(v);
}

function Delta({ kpi }: { kpi: MyKpi }) {
  const d = kpi.compare;
  if (!d) return null;
  // No movement is not a rise. "↗ ₹0" in red on a stopped-SIP tile read as a
  // deterioration that never happened.
  if (d.abs === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-muted-foreground">
        <Minus className="size-3.5 opacity-50" aria-hidden /> no change
      </span>
    );
  }
  // Direction, not size, decides the colour — and for redemption and stopped
  // SIPs, UP is the bad direction.
  const rising = d.abs > 0;
  const good = kpi.inverse ? !rising : rising;
  const Icon = rising ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={cn("inline-flex items-center gap-1 font-medium tabular-nums", good ? "text-success" : "text-destructive")}>
      <Icon className="size-3.5" aria-hidden />
      {kpi.format === "count" ? formatCount(Math.abs(d.abs)) : formatMoney(Math.abs(d.abs))}
      {d.pct != null && <span className="font-normal">({formatPercent(Math.abs(d.pct) * 100, 1)})</span>}
    </span>
  );
}

function Tile({ kpi, className, spark }: { kpi: MyKpi; className?: string; spark?: number[] }) {
  const unknown = kpi.value == null;
  const zero = kpi.value === 0;
  const notes = kpi.notes.filter((n) => n.label);

  return (
    <Link
      href={kpi.href}
      className={cn("metric-tile card-surface flex h-full flex-col p-4", className)}
      style={{ ["--c" as string]: `hsl(var(--metric-${HUE[kpi.key]}))` }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <span className="block text-xs font-medium leading-snug text-muted-foreground">{kpi.label}</span>
          {kpi.kind === "stock" && (
            <span
              className="mt-1 inline-block text-2xs text-muted-foreground/70"
              title="A balance as it stands now. Its movement includes the market, not just sales."
            >
              Balance today
            </span>
          )}
        </div>
        <span className="dash-kpi-chip" aria-hidden>
          {ICON[kpi.key]}
        </span>
      </div>

      <div
        className={cn(
          // Two tiles to a row on a phone: one size down so "₹2.46 Lakh" keeps to one line.
          "mt-2.5 text-xl leading-tight tabular-nums tracking-tight sm:text-2xl",
          unknown || zero ? "font-medium text-muted-foreground/60" : "font-semibold text-foreground",
        )}
        title={unknown ? "Data unavailable — nothing has been recorded against this yet." : undefined}
      >
        {fmt(kpi, kpi.value)}
      </div>

      {(kpi.compare && !(zero && kpi.compare.abs === 0)) || (spark && spark.length >= 3) ? (
        <div className="mt-2.5 flex items-end justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-2xs">
            {kpi.compare && !(zero && kpi.compare.abs === 0) && (
              <>
                <Delta kpi={kpi} />
                <span className="text-muted-foreground">{kpi.compareLabel}</span>
              </>
            )}
          </div>
          {/* This FY's months so far: the shape, not the values. */}
          {spark && spark.length >= 3 && (
            <Sparkline values={spark} width={60} height={22} className="shrink-0" style={{ color: "var(--c)" }} />
          )}
        </div>
      ) : null}

      <div className="mt-auto space-y-1 border-t border-border/60 pt-2.5 text-2xs">
        {kpi.fytd != null && (
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-muted-foreground">FY to date</span>
            <span className="font-medium tabular-nums text-foreground">{fmt(kpi, kpi.fytd)}</span>
          </div>
        )}
        {kpi.target ? (
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-muted-foreground">
              Target {fmt(kpi, kpi.target.value)}
            </span>
            <span
              className={cn(
                "font-semibold tabular-nums",
                kpi.target.pace == null
                  ? kpi.target.pct >= 1 ? "text-success" : "text-foreground"
                  : kpi.target.pct >= kpi.target.pace ? "text-success" : "text-warning-foreground",
              )}
              title={kpi.target.pace == null
                ? "A closing target — measured against today's balance, not paced through the year."
                : `${(kpi.target.pace * 100).toFixed(0)}% of the financial year has elapsed.`}
            >
              {formatPercent(kpi.target.pct * 100, 0)}
            </span>
          </div>
        ) : null}
        {kpi.target && (
          // The share reached, with a tick where the year should be today.
          <div className="relative pt-0.5" aria-hidden>
            <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
              <div className="h-full rounded-full" style={{ width: `${Math.max(2, Math.min(100, kpi.target.pct * 100))}%`, background: "var(--c)" }} />
            </div>
            {kpi.target.pace != null && (
              <span className="absolute -top-0.5 h-3 w-0.5 -translate-x-1/2 rounded-full bg-foreground" style={{ left: `${Math.min(100, kpi.target.pace * 100)}%` }} />
            )}
          </div>
        )}
        {kpi.target ? null : (
          notes.length > 0 && (
            <div className="space-y-0.5">
              {notes.slice(0, 2).map((n) => (
                <div key={n.label} className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-muted-foreground">{n.label}</span>
                  {n.value && (
                    <span className="shrink-0 font-medium tabular-nums text-foreground">
                      {/^\d+$/.test(n.value)
                        ? Number(n.value) >= 1000
                          ? formatMoney(Number(n.value))
                          : formatCount(Number(n.value))
                        : n.value}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )
        )}
      </div>
    </Link>
  );
}

/** Width of a tile on a short last row of 1, 2 or 3 (twelve-column grid, wide screens). */
const LAST_ROW: Record<number, string> = { 1: "xl:col-span-12", 2: "xl:col-span-6", 3: "xl:col-span-4" };

export function MyKpiStrip({ kpis, periodLabel, title = "My business", sparks }: {
  kpis: MyKpi[];
  periodLabel: string;
  title?: string;
  /** This FY's months so far, per tile key (kpiSparks). */
  sparks?: Partial<Record<string, number[]>>;
}) {
  // Ten tiles sit five to a row. Any other count goes four to a row, and the
  // tiles left over share the last row equally — eleven used to wrap 5 + 5 + 1
  // and leave one tile alone under the headline.
  const fives = kpis.length % 5 === 0;
  const left = kpis.length % 4;
  const lastRowFrom = kpis.length - left;
  const oddLast = (i: number) => kpis.length % 2 === 1 && i === kpis.length - 1;
  return (
    <section aria-label={`${title} figures`} className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="section-title">{title}</h2>
        <p className="text-2xs text-muted-foreground">{periodLabel}</p>
      </div>
      {fives ? (
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
          {kpis.map((k) => (
            <Tile key={k.key} kpi={k} spark={sparks?.[k.key]} />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-12 gap-3">
          {kpis.map((k, i) => (
            // Two to a row below xl (one per row made eleven tiles 1,600px tall
            // on a phone; three per row at a 1024px screen left one alone), and
            // an odd last tile takes the whole row.
            <Tile key={k.key} kpi={k} spark={sparks?.[k.key]} className={cn(
              oddLast(i) ? "col-span-12" : "col-span-6",
              i >= lastRowFrom ? LAST_ROW[left] : "xl:col-span-3",
            )} />
          ))}
        </div>
      )}
    </section>
  );
}
