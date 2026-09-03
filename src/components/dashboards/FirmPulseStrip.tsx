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
import { ArrowDownRight, ArrowUpRight, ExternalLink, Minus } from "lucide-react";
import { Sparkline } from "./Sparkline";
import type { ActivityRange, ActivityTile, Delta, PulseMetric } from "@/lib/dashboard/firm-pulse";
import { ACTIVITY_RANGES } from "@/lib/dashboard/firm-pulse";

/** Indian-notation short money: ₹1238.64 Cr · ₹71.35 Lakh · ₹3,000. */
function money(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(2)} Cr`;
  if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(2)} Lakh`;
  return `${sign}₹${Math.round(abs).toLocaleString("en-IN")}`;
}

const HREF: Record<PulseMetric["key"], string> = {
  aum: "/dashboard/portfolio-intelligence",
  invested: "/dashboard/transactions",
  sip_book: "/dashboard/sips",
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
  const tone = up ? "text-emerald-600" : "text-rose-600";
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
}: {
  metrics: PulseMetric[];
  tiles: ActivityTile[];
  range: ActivityRange;
  /** Where the range chips link back to (query params are appended). */
  baseHref?: string;
}) {
  return (
    <section className="space-y-4">
      {/* ── Headline KPIs ────────────────────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {metrics.map((m) => (
          <div
            key={m.key}
            className="group relative rounded-xl border border-border bg-card p-4 transition hover:border-brand-cyan/40 hover:shadow-sm"
          >
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-sm font-semibold text-brand-cyan-deep">{m.label}</h3>
              <Link
                href={HREF[m.key]}
                aria-label={`Open ${m.label}`}
                className="text-muted-foreground/50 hover:text-brand-cyan transition"
              >
                <ExternalLink className="size-3.5" />
              </Link>
            </div>

            <div className="mt-1.5 flex items-end justify-between gap-3">
              <div className="text-2xl font-bold tracking-tight tabular-nums">{money(m.value)}</div>
              {m.series.length > 1 && (
                <Sparkline
                  data={m.series}
                  width={96}
                  height={34}
                  strokeClass={
                    m.series[m.series.length - 1] >= m.series[0] ? "text-emerald-500" : "text-rose-500"
                  }
                />
              )}
            </div>

            <div className="mt-3 space-y-1.5 border-t border-border/60 pt-2.5 text-xs">
              {m.footnote ? (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">{m.footnote.label}</span>
                  <span className="tabular-nums font-medium">{money(m.footnote.value)}</span>
                </div>
              ) : (
                <DeltaRow label="Day" d={m.day} />
              )}
              <DeltaRow label="MoM" d={m.mom} />
            </div>
          </div>
        ))}
      </div>

      {/* ── Activity ─────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-card p-4">
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
                    : "border-border bg-secondary/20 hover:border-brand-cyan/40"
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
      </div>
    </section>
  );
}
