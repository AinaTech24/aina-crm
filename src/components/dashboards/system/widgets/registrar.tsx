/**
 * Registrar AUM (Phase 3E) — the registrars' own statements, per registrar ×
 * ARN, each with its date, beside the CRM's live-NAV AUM. The firm total is
 * printed only when every statement it would need is full-book, fresh and
 * gap-free; otherwise the card says why. Metric: lib/metrics/registrar-aum.ts.
 */
import type { Tx } from "@/db/client";
import { formatCount, formatDate, formatMoney } from "@/lib/format";
import { getAUM, getAumComposition, getRegistrarAum } from "@/lib/metrics";
import { aumValuationLabel } from "@/lib/metrics/aum-composition";
import type { WidgetCtx, WidgetImpl } from "../types";
import { clientsHref } from "../links";

async function registrarAum(tx: Tx, ctx: WidgetCtx) {
  const [r, live, comp] = [await getRegistrarAum(tx, ctx.scope), await getAUM(tx, ctx.scope), await getAumComposition(tx, ctx.scope)];
  if (!r.cards.length && !r.undatedLegs) return { body: null };
  const navSpan = (p: { oldest: string | null; newest: string | null }) => (p.oldest && p.newest && p.oldest !== p.newest ? `${formatDate(p.oldest)} – ${formatDate(p.newest)}` : p.newest ? formatDate(p.newest) : "undated");
  return {
    body: (
      <div className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="dash-tile">
            <div className="text-xs text-muted-foreground">Registrar statements (firm total)</div>
            <div className="text-lg font-semibold">{r.headline.value != null ? formatMoney(r.headline.value) : "—"}</div>
            <div className="text-2xs text-muted-foreground">
              {r.headline.value != null ? `statements of ${r.headline.asOfDates.map((d) => formatDate(d)).join(", ")}` : "Incomplete — see below"}
            </div>
          </div>
          <div className="dash-tile">
            <div className="text-xs text-muted-foreground">{comp.allLive ? `CRM valuation — ${aumValuationLabel(comp, (d) => formatDate(d))}` : "CRM valuation — mixed dates"}</div>
            <div className="text-lg font-semibold">{formatMoney(live.aum)}</div>
            {comp.allLive ? (
              <div className="text-2xs text-muted-foreground">Units held × the latest AMFI NAV of each mapped scheme — a different figure, on a different date</div>
            ) : (
              <ul className="text-2xs text-muted-foreground">
                <li>{formatMoney(comp.live.value)} at AMFI NAV of {navSpan(comp.live)} ({formatCount(comp.live.holdings)} holdings)</li>
                {comp.registrar.holdings > 0 && (
                  <li className="text-warning-foreground">
                    {formatMoney(comp.registrar.value)} at registrar statement value ({formatCount(comp.registrar.holdings)} holdings, statements of {navSpan(comp.registrar)}) — scheme not mapped yet
                  </li>
                )}
                {comp.stale.holdings > 0 && <li className="text-warning-foreground">{formatMoney(comp.stale.value)} at an older NAV ({navSpan(comp.stale)}; {formatCount(comp.stale.holdings)} holdings)</li>}
              </ul>
            )}
          </div>
        </div>
        {r.cards.length > 0 && (
          <ul className="space-y-1.5">
            {r.cards.map((c) => (
              <li key={`${c.rta}|${c.arn}`} className="dash-row flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="min-w-0">
                  <span className="font-medium">{c.rta === "kfintech" ? "KFintech" : "CAMS"}</span>
                  <span className="text-muted-foreground"> · {c.arn} · statement of {c.mixedDates && c.oldestAsOf ? `${formatDate(c.oldestAsOf)} – ${formatDate(c.asOf!)} (mixed dates)` : c.asOf ? formatDate(c.asOf) : "unknown"}</span>
                  <span className="ml-1 text-2xs text-muted-foreground">
                    {c.fullBook ? "full book" : "partial statement"} · {formatCount(c.positions)} positions ({formatCount(c.zeroPositions)} nil){c.stale ? " · stale" : ""}
                  </span>
                </span>
                <span className="font-medium">{formatMoney(c.sourceValue)}</span>
              </li>
            ))}
          </ul>
        )}
        {r.headline.reasons.length > 0 && (
          <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
            {r.headline.reasons.map((x) => <li key={x}>{x}</li>)}
            {r.legsOnOlderStatements > 0 && <li>{formatCount(r.legsOnOlderStatements)} holding(s) stand on an older statement than their registrar&apos;s latest full book</li>}
            {r.undatedLegs > 0 && <li>{formatCount(r.undatedLegs)} holding(s) carry no dated registrar statement</li>}
          </ul>
        )}
      </div>
    ),
    subtitle: r.headline.value != null ? "Every registrar statement is full-book and current" : "Registrar figures with their dates; the firm total waits for complete statements",
    info: "Each registrar's holdings statement as printed, per ARN, dated by its report date. A statement prints values, not the NAV date behind them: one produced in the morning values at the previous business day's NAV. The CRM valuation re-prices units at the latest AMFI NAV, with that NAV's date, and is shown separately — the two are never added together.",
    href: clientsHref(ctx, { sort: "aum", dir: "desc" }),
    hrefLabel: "Clients",
  };
}

export const registrarWidgets: WidgetImpl[] = [
  { key: "registrar_aum", render: registrarAum },
];
