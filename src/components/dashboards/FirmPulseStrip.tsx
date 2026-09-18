/**
 * Firm pulse — the headline KPI strip (Total AUM · Total Investment · SIP Book)
 * and the transaction-activity tiles beneath it.
 *
 * Server component: no client state, so it costs no JS. The range chips on the
 * activity strip are plain links that set `?act=` on the dashboard URL, which is
 * both cheaper and more useful than local state — a chosen range survives a
 * refresh and can be shared or bookmarked.
 *
 * Design notes (the parts that are easy to get wrong):
 *  · Deltas are green/red by DIRECTION, never by whether the number is big.
 *    An outflow tile showing ₹2.25 Cr is not "bad" — it is just outflow — so
 *    tone lives on the tile's identity, not on its value.
 *  · A missing delta renders "—", not "0.00%". A firm with no snapshot history
 *    yet has no yesterday, and inventing a flat 0% reads as a real measurement.
 *  · Every figure is a drill-through. A KPI you cannot open is decoration.
 */

import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, ExternalLink, Minus, Repeat, TrendingUp, Users, Wallet } from "lucide-react";
import { MetricTile, type MetricHue } from "./MetricTile";
import { Sparkline } from "./Sparkline";
import type { ActivityRange, ActivityTile, Delta, PulseMetric } from "@/lib/dashboard/firm-pulse";
import { ACTIVITY_RANGES } from "@/lib/dashboard/firm-pulse";
import { formatINRShort } from "@/lib/utils";

const money = formatINRShort;

const HREF: Record<PulseMetric["key"], string> = {
  aum: "/dashboard/portfolio-intelligence",
  invested: "/dashboard/transactions",
  sip_book: "/dashboard/sips",
  clients: "/dashboard/investors",
};

/** One hue per metric, from the `--metric-*` set. */
const HUE: Record<PulseMetric["key"], MetricHue> = {
  aum: "indigo",
  invested: "emerald",
  sip_book: "violet",
  clients: "cyan",
};

const ICON: Record<PulseMetric["key"], React.ReactNode> = {
  aum: <TrendingUp className="size-[18px]" />,
  invested: <Wallet className="size-[18px]" />,
  sip_book: <Repeat className="size-[18px]" />,
  clients: <Users className="size-[18px]" />,
};

function DeltaRow({ label, d }: { label: string; d: Delta }) {
  if (!d) {
    return (
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <Minus className="size-3.5 opacity-50" /> {label}
        </span>
        <span className="text-muted-foreground" title="No comparable snapshot yet — this fills in once the daily snapshot has run.">
          —
        </span>
      </div>
    );
  }
  const up = d.abs >= 0;
  const tone = up ? "text-success" : "text-destructive";
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <div className="flex items-center justify-between gap-2">
      <span className={`inline-flex items-center gap-1.5 ${tone}`}>
        <Icon className="size-3.5" /> <span className="text-muted-foreground">{label}</span>
      </span>
      <span className={`tabular-nums font-medium ${tone}`}>
        {up ? "" : "-"}
        {money(Math.abs(d.abs))}
        {d.pct != null && <span className="ml-1 font-normal">({up ? "+" : "-"}{(Math.abs(d.pct) * 100).toFixed(2)}%)</span>}
      </span>
    </div>
  );
}

export function FirmPulseStrip({
  metrics,
  tiles,
  range,
  baseHref = "/dashboard",
  showActivity = true,
}: {
  metrics: PulseMetric[];
  tiles: ActivityTile[];
  range: ActivityRange;
  /** Where the range chips link back to (query params are appended). */
  baseHref?: string;
  /**
   * The transaction-activity strip beneath the KPIs. Off on the Overview tab:
   * eight tiles of recent transaction volume is real information, but it is
   * not what an owner opens this page to find out, and the default view is
   * capped at the handful of sections that are. It renders on Insights.
   */
  showActivity?: boolean;
}) {
  return (
    <section className="space-y-5" aria-label="Business snapshot">
      {/* ── Headline KPIs ──────────────────────────────────────────────
          Four tiles, each owning a hue from the `--metric-*` set, with AUM
          leading at a larger size. Every card carries number · delta · trend:
          a bare figure cannot answer "is this good?", which is what a
          dashboard is for. */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
        {metrics.map((m) => {
          // Prefer month-on-month: a firm looks at a dashboard to ask how the
          // month is going, and the day delta is noise at this size.
          const d = m.mom ?? m.day;
          const fmt = m.key === "clients" ? (n: number) => Math.round(n).toLocaleString("en-IN") : money;
          return (
            <MetricTile
              key={m.key}
              hue={HUE[m.key]}
              lead={m.key === "aum"}
              icon={ICON[m.key]}
              label={m.label}
              value={fmt(m.value)}
              href={HREF[m.key]}
              series={m.series}
              delta={
                d
                  ? {
                      value:
                        m.key === "clients" || d.pct == null
                          ? fmt(Math.abs(d.abs))
                          : `${Math.abs(d.pct * 100).toFixed(1)}%`,
                      direction: d.abs > 0 ? "up" : d.abs < 0 ? "down" : "flat",
                      since: "vs last month",
                    }
                  : m.footnote && m.footnote.value != null
                    ? { value: money(m.footnote.value), direction: "flat", since: m.footnote.label }
                    : undefined
              }
            />
          );
        })}
      </div>

      {showActivity && (
      <>
      {/* ── Activity ─────────────────────────────────────────────────── */}
      <div className="card-surface p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div className="inline-flex rounded-lg border border-border bg-secondary/40 p-0.5 gap-0.5 text-xs">
            {ACTIVITY_RANGES.map((d) => (
              <Link
                key={d}
                href={`${baseHref}?act=${d}`}
                scroll={false}
                className={`px-2.5 py-1 rounded-md font-medium transition ${
                  d === range ? "bg-brand-cyan text-white shadow-sm" : "text-muted-foreground hover:bg-secondary"
                }`}
              >
                {d} Days
              </Link>
            ))}
          </div>
          <Link href="/dashboard/transactions" className="text-xs text-muted-foreground hover:text-brand-cyan hover:underline">
            All transactions →
          </Link>
        </div>

        {/* When NOTHING moved in the window, eight tiles all reading Rs 0 is a
            large block of noise that says one thing. Say that one thing instead,
            and keep the link through. */}
        {tiles.every((t) => t.count === 0) ? (
          <div className="rounded-lg border border-border/60 bg-secondary/20 px-3 py-2 text-2xs text-muted-foreground">
            No transactions in the last {range} days.
          </div>
        ) : (
        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
          {tiles.map((t) => {
            const empty = t.count === 0;
            return (
              <Link
                key={t.key}
                href={t.href}
                className={`rounded-lg border p-3 transition hover:shadow-sm ${
                  empty
                    ? "border-border/60 bg-secondary/20 opacity-60 hover:opacity-100"
                    : "border-border bg-secondary/20 hover:border-foreground/25"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-muted-foreground">
                    {t.label}{" "}
                    <span
                      className={
                        empty
                          ? "text-muted-foreground/60"
                          : t.tone === "out"
                            ? "text-rose-600"
                            : t.tone === "in"
                              ? "text-emerald-600"
                              : "text-brand-cyan"
                      }
                    >
                      ({t.count})
                    </span>
                  </span>
                  <ExternalLink className="size-3 text-muted-foreground/40" />
                </div>
                <div className="mt-1 text-base font-bold tabular-nums">{money(t.amount)}</div>
              </Link>
            );
          })}
        </div>
        )}
      </div>
      </>
      )}
    </section>
  );
}
