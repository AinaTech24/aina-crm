"use client";

/**
 * §21 Investment flow — gross purchase, redemption and net business by month,
 * for one product at a time, from Business Entries (the only source that
 * records SIF, AIF and PMS and an explicit asset class).
 *
 * Bars go UP for money in and DOWN for money out from a zero line, and the net
 * is a line of its own — a redemption is drawn as what it is, not coloured as
 * a failure (§20: "do not label all redemption as negative"). SVG paints are
 * Tailwind classes on currentColor, never hsl(var(--token)), which renders
 * black when it does not resolve.
 */

import { useState } from "react";
import { ArrowLeftRight } from "lucide-react";
import type { FlowByMonth, FlowProduct } from "@/lib/dashboard/my/desk";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

const PRODUCTS: Array<{ key: FlowProduct; label: string }> = [
  { key: "all_mf", label: "Mutual Fund" },
  { key: "equity", label: "Equity" },
  { key: "debt", label: "Debt" },
  { key: "liquid", label: "Liquid" },
  { key: "sif", label: "SIF" },
  { key: "aif", label: "AIF" },
  { key: "pms", label: "PMS" },
  { key: "other", label: "Other" },
];

const W = 720, H = 200, PAD = { top: 12, right: 10, bottom: 24, left: 10 };

export function FlowChart({ data }: { data: FlowByMonth }) {
  const [product, setProduct] = useState<FlowProduct>("all_mf");
  if (!data.months) {
    return (
      <section className="card-surface p-5 sm:p-6" aria-label="Investment flow">
        <h2 className="section-title flex items-center gap-2"><ArrowLeftRight className="size-4 text-muted-foreground" aria-hidden /> Investment flow</h2>
        <p className="mt-3 rounded-lg border border-dashed border-border bg-secondary/40 px-3 py-2.5 text-2xs text-muted-foreground">
          No business entry has ever been recorded for your book, so there is no product split to chart. The split
          comes from Business Entries; the business trend above uses the RTA feed.
        </p>
      </section>
    );
  }
  const s = data.series[product];
  const nets = s.map((m) => m.purchase - m.redemption);
  const peak = Math.max(1, ...s.map((m) => Math.max(m.purchase, m.redemption)), ...nets.map(Math.abs));
  const innerW = W - PAD.left - PAD.right, innerH = H - PAD.top - PAD.bottom;
  const mid = PAD.top + innerH / 2;
  const scale = (v: number) => (v / peak) * (innerH / 2);
  const slot = innerW / 12;
  const x = (i: number) => PAD.left + slot * i + slot / 2;
  const netPath = nets.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${(mid - scale(v)).toFixed(1)}`).join(" ");
  const sum = (f: { purchase: number; redemption: number }) => ({ gross: f.purchase, red: f.redemption, net: f.purchase - f.redemption });
  const mtd = sum(data.mtd[product]), fytd = sum(data.fytd[product]);
  const empty = s.every((m) => m.purchase === 0 && m.redemption === 0);

  return (
    <section className="card-surface p-5 sm:p-6" aria-label="Investment flow">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-border/60 pb-4">
        <div className="min-w-0">
          <h2 className="section-title flex items-center gap-2">
            <ArrowLeftRight className="size-4 text-muted-foreground" aria-hidden /> Investment flow
          </h2>
          <p className="section-subtitle mt-1">Gross purchase, redemption and net business by month — {PRODUCTS.find((p) => p.key === product)?.label}.</p>
        </div>
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Product">
          {PRODUCTS.map((p) => (
            <button key={p.key} type="button" onClick={() => setProduct(p.key)} aria-pressed={product === p.key}
              className={cn("inline-flex min-h-6 items-center rounded-md px-2 py-1 text-2xs font-medium transition-colors",
                product === p.key ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground")}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <dl className="mb-3 grid grid-cols-2 gap-2 text-2xs sm:grid-cols-6">
        {([["MTD gross", mtd.gross], ["MTD redemption", mtd.red], ["MTD net", mtd.net],
           ["FYTD gross", fytd.gross], ["FYTD redemption", fytd.red], ["FYTD net", fytd.net]] as const).map(([l, v]) => (
          <div key={l} className="rounded-lg border border-border px-2.5 py-1.5">
            <dt className="text-muted-foreground">{l}</dt>
            <dd className={cn("font-semibold tabular-nums", l.endsWith("net") && v < 0 ? "text-warning-foreground" : "text-foreground")}>{formatMoney(v)}</dd>
          </div>
        ))}
      </dl>

      {empty ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-xs text-muted-foreground">
          No {PRODUCTS.find((p) => p.key === product)?.label} business recorded this financial year.
        </p>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Purchase and redemption by month">
          <line x1={PAD.left} y1={mid} x2={W - PAD.right} y2={mid} className="stroke-border" strokeWidth={1} />
          {s.map((m, i) => (
            <g key={i}>
              {m.purchase > 0 && (
                <rect x={x(i) - slot * 0.3} y={mid - scale(m.purchase)} width={slot * 0.28} height={scale(m.purchase)}
                      className="fill-primary/70"><title>{`${data.months![i]} purchase ${formatMoney(m.purchase)}`}</title></rect>
              )}
              {m.redemption > 0 && (
                <rect x={x(i) + slot * 0.02} y={mid} width={slot * 0.28} height={scale(m.redemption)}
                      className="fill-muted-foreground/40"><title>{`${data.months![i]} redemption ${formatMoney(m.redemption)}`}</title></rect>
              )}
            </g>
          ))}
          <path d={netPath} fill="none" className="stroke-foreground/70" strokeWidth={1.5} strokeDasharray="3 3" />
          {data.months.map((m, i) => (
            <text key={m} x={x(i)} y={H - 6} textAnchor="middle" className="fill-current text-2xs text-muted-foreground">{m}</text>
          ))}
        </svg>
      )}
      <p className="mt-2 flex flex-wrap gap-x-4 text-2xs text-muted-foreground">
        <span className="inline-flex items-center gap-1"><span className="size-2 rounded-sm bg-primary/70" aria-hidden /> Purchase</span>
        <span className="inline-flex items-center gap-1"><span className="size-2 rounded-sm bg-muted-foreground/40" aria-hidden /> Redemption</span>
        <span className="inline-flex items-center gap-1"><span className="h-px w-4 border-t border-dashed border-foreground/70" aria-hidden /> Net</span>
        <span>From Business Entries (confirmed and e-mailed); switch and STP count as purchase into the target product.</span>
      </p>
    </section>
  );
}
