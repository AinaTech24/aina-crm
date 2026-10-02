/**
 * Cross-sell — existing clients taking another product. Every figure is
 * lib/metrics/opportunities.ts over ctx.scope. Hidden when the firm has never
 * opened an opportunity and no client has a Cross-sell card filled in.
 */

import Link from "next/link";
import type { ReactNode } from "react";
import type { Tx } from "@/db/client";
import { getOpportunityMetrics } from "@/lib/metrics";
import { formatCount, formatMoney, formatPercent } from "@/lib/format";
import { productLabel } from "@/lib/opportunities/products";
import type { WidgetCtx, WidgetImpl } from "../types";

function Tile({ label, value, hint, href }: { label: string; value: ReactNode; hint?: string; href?: string }) {
  const inner = (
    <>
      <div className="text-xl font-semibold tabular-nums leading-tight tracking-tight text-foreground">{value}</div>
      <div className="mt-1 text-xs leading-snug text-muted-foreground">{label}</div>
    </>
  );
  return href
    ? <Link href={href} className="dash-tile" title={hint}>{inner}</Link>
    : <div className="dash-tile" title={hint}>{inner}</div>;
}

async function crossSell(tx: Tx, ctx: WidgetCtx) {
  const m = await getOpportunityMetrics(tx, ctx.scope, ctx.period);
  if (!m.open && !m.won && !m.lost && !m.clientsWithCard) return { body: null };
  const max = Math.max(1, ...m.byProduct.map((b) => b.open));
  return {
    body: (
      <div className="space-y-4">
        <div className="dash-stats" style={{ ["--cols-sm" as string]: 3, ["--cols-lg" as string]: 5 }}>
          <Tile label={`Open opportunities${m.openValue ? ` · ${formatMoney(m.openValue)}` : ""}`} value={formatCount(m.open)} />
          <Tile label={`Won in the period${m.wonValue ? ` · ${formatMoney(m.wonValue)}` : ""}`} value={formatCount(m.won)} />
          <Tile label="Conversion (won ÷ closed)" value={m.conversion == null ? "—" : formatPercent(m.conversion * 100, 0)}
            hint={m.conversion == null ? "Nothing was won or lost in the period." : `${m.won} won, ${m.lost} lost in the period.`} />
          <Tile label="Products held per client" value={m.productsPerClient == null ? "—" : m.productsPerClient.toFixed(1)}
            hint={m.productsPerClient == null ? "No live client in this view." : `Across ${formatCount(m.clientsWithCard)} live clients.`} />
          <Tile label="Clients with one product" value={m.clientsWithCard ? formatCount(m.singleProduct) : "—"}
            hint="The cross-sell base: one product held with the firm." />
        </div>
        {m.byProduct.length > 0 && (
          <ul className="grid gap-x-8 gap-y-2.5 sm:grid-cols-2">
            {m.byProduct.map((b) => (
              <li key={b.product} className="space-y-1">
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="truncate">{productLabel(b.product)}</span>
                  <span className="whitespace-nowrap tabular-nums text-muted-foreground">
                    {formatCount(b.open)} open{b.value ? ` · ${formatMoney(b.value)}` : ""}
                  </span>
                </div>
                <div className="dash-bar" aria-hidden><span style={{ width: `${Math.max(3, (b.open / max) * 100)}%` }} /></div>
              </li>
            ))}
          </ul>
        )}
      </div>
    ),
    subtitle: `${formatCount(m.open)} open`,
    info: "Opportunities are existing clients who want another product. Won and lost count those closed in the period; conversion is won ÷ (won + lost). Products per client counts the lines each live client holds with the firm: mutual funds when AUM is above zero, an insurance line per in-force policy, FD / Bonds / NCD for a live fixed deposit, and the Cross-sell card's \"Held with us\".",
  };
}

export const opportunityWidgets: WidgetImpl[] = [
  {
    key: "cross_sell",
    render: crossSell,
    csv: async (tx, ctx) => {
      const m = await getOpportunityMetrics(tx, ctx.scope, ctx.period);
      return {
        columns: ["Product", "Open opportunities", "Expected value"],
        rows: m.byProduct.map((b) => [productLabel(b.product), b.open, b.value]),
      };
    },
  },
];
