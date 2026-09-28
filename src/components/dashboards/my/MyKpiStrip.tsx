/**
 * §1 My business KPIs — ten tiles.
 *
 * Each tile is an INDEPENDENT measure, so each takes the money unit its own
 * magnitude deserves. Pinning the row to one unit was tried on the firm
 * cockpit and rendered an ₹8 Lakh SIP book as "₹0.09 Cr". `pickMoneyScale()`
 * is for the other case — several figures of the same measure side by side,
 * such as a column of category AUMs.
 *
 * Two labels do a lot of work here:
 *
 *   "Stock"  the tile is a BALANCE. Its change is mostly the market.
 *   "Flow"   the tile is money that MOVED in the selected period.
 *
 * Without them, a director reads "My AUM +6.9%" as sales they made. The brief
 * says it outright — "Do not treat AUM movement as net business" — and a badge
 * on the tile is the only place that instruction survives contact with a
 * screenshot.
 */

import Link from "next/link";
import {
  ArrowDownRight, ArrowUpRight, CalendarCheck, Minus, Repeat, Shield, TrendingDown, TrendingUp,
  UserPlus, Wallet, XCircle,
} from "lucide-react";
import type { MyKpi } from "@/lib/dashboard/my/kpis";
import { formatCount, formatMoney, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

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
  if (!d) {
    return (
      <span className="inline-flex items-center gap-1 text-muted-foreground" title={
        kpi.kind === "stock"
          ? "No recorded snapshot from a month ago yet. Balances cannot be recomputed after the fact, so this fills in once the nightly snapshot has a month of history."
          : "Nothing recorded in the comparison period."
      }>
        <Minus className="size-3.5 opacity-50" aria-hidden /> —
      </span>
    );
  }
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

function Tile({ kpi }: { kpi: MyKpi }) {
  const unknown = kpi.value == null;
  const notes = kpi.notes.filter((n) => n.label);

  return (
    <Link
      href={kpi.href}
      className="metric-tile card-surface flex h-full flex-col p-4 transition-colors hover:border-primary/30"
      style={{ ["--c" as string]: `hsl(var(--metric-${HUE[kpi.key]}))` }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <span className="block text-xs font-medium leading-snug text-muted-foreground">{kpi.label}</span>
          <span
            className="mt-1 inline-block text-2xs uppercase tracking-wide text-muted-foreground/70"
            title={
              kpi.kind === "stock"
                ? "A balance as it stands now. Its movement includes the market, not just your sales."
                : "Money that moved during the selected period."
            }
          >
            {kpi.kind}
          </span>
        </div>
        <span
          className="grid size-8 shrink-0 place-items-center rounded-lg"
          style={{ background: "color-mix(in srgb, var(--c) 8%, transparent)", color: "var(--c)" }}
          aria-hidden
        >
          {ICON[kpi.key]}
        </span>
      </div>

      <div
        className={cn(
          "mt-2.5 text-[1.6rem] font-semibold leading-none tabular-nums tracking-[-0.035em]",
          unknown ? "text-muted-foreground" : "text-foreground",
        )}
        title={unknown ? "Data unavailable — nothing has been recorded against this yet." : undefined}
      >
        {fmt(kpi, kpi.value)}
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs">
        <Delta kpi={kpi} />
        <span className="text-muted-foreground">{kpi.compareLabel}</span>
      </div>

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
        ) : (
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

export function MyKpiStrip({ kpis, periodLabel, title = "My business" }: {
  kpis: MyKpi[];
  periodLabel: string;
  title?: string;
}) {
  return (
    <section aria-label={`${title} figures`} className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="section-title">{title}</h2>
        <p className="text-2xs text-muted-foreground">
          Flow figures cover <span className="font-medium text-foreground">{periodLabel}</span>;
          balances are as they stand now.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {kpis.map((k) => (
          <Tile key={k.key} kpi={k} />
        ))}
      </div>
    </section>
  );
}
