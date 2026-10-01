"use client";

/**
 * §6–7 — the product mix of each line: premium by product with a New /
 * Renewal / Total switch, policy count and contribution. Products are the
 * CRM's policy-type picklist grouped on the firm's MIS taxonomy; a product
 * with no business in the period is not drawn.
 */

import Link from "next/link";
import { useState } from "react";
import { PieChart } from "lucide-react";
import type { MixRow } from "@/lib/dashboard/insurance/business";
import { formatCount, formatMoney, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

type Measure = "total" | "newAmt" | "renAmt";

export function InsMix({ rows, periodLabel, hrefs, lockedLine }: {
  rows: MixRow[]; periodLabel: string; hrefs: Record<string, string>;
  /** The dashboard's own line filter: the other line's mix would be an empty card, not a fact. */
  lockedLine?: "personal" | "commercial" | null;
}) {
  const [m, setM] = useState<Measure>("total");
  const val = (r: MixRow) => (m === "total" ? r.newAmt + r.renAmt : r[m]);
  const lines = [
    { key: "personal", label: "Personal Lines product mix" },
    { key: "commercial", label: "Commercial Lines product mix" },
  ].filter((l) => !lockedLine || l.key === lockedLine);
  return (
    <div className={cn("grid gap-6", lines.length > 1 && "2xl:grid-cols-2")}>
      {lines.map((l) => {
        const xs = rows.filter((r) => r.line === l.key).sort((a, b) => val(b) - val(a));
        const total = xs.reduce((a, r) => a + val(r), 0);
        const max = Math.max(0, ...xs.map(val));
        return (
          <section key={l.key} className="card-surface min-w-0 p-5 sm:p-6" aria-label={l.label}>
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-border/60 pb-4">
              <div>
                <h2 className="section-title flex items-center gap-2"><PieChart className="size-4 text-muted-foreground" /> {l.label}</h2>
                <p className="section-subtitle mt-1">{periodLabel} · {formatMoney(total)} across {xs.length} product{xs.length === 1 ? "" : "s"}.</p>
              </div>
              <div className="inline-flex rounded-lg border border-border bg-secondary/60 p-0.5" role="group" aria-label="Measure">
                {([["total", "Total"], ["newAmt", "New"], ["renAmt", "Renewal"]] as const).map(([k, lab]) => (
                  <button key={k} type="button" aria-pressed={m === k} onClick={() => setM(k)}
                    className={cn("inline-flex min-h-7 items-center rounded-md px-2.5 text-xs font-medium",
                      m === k ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                    {lab}
                  </button>
                ))}
              </div>
            </div>
            {xs.length === 0 ? (
              <p className="dash-empty">No {l.label.replace(" product mix", "")} business in {periodLabel}.</p>
            ) : (
              <div className="space-y-1">
                <div className="flex items-center gap-2 pb-1 text-2xs font-semibold text-muted-foreground">
                  <span className="w-24 shrink-0 sm:w-44">Product</span>
                  <span className="flex-1">Premium</span>
                  <span className="hidden w-16 shrink-0 text-right sm:block">Policies</span>
                  <span className="w-14 shrink-0 text-right">Share</span>
                </div>
                {xs.map((r) => (
                  <Link key={r.grp} href={hrefs[r.grp] ?? "#"} scroll={false} className="flex items-center gap-2 rounded py-1 text-xs hover:bg-accent">
                    <span className="w-24 shrink-0 truncate text-foreground sm:w-44" title={r.label}>{r.label}</span>
                    <span className="flex min-w-0 flex-1 items-center gap-2">
                      <span className="h-3.5 min-w-0 flex-1 overflow-hidden rounded bg-secondary">
                        {val(r) > 0 && <span className="block h-full rounded bg-primary/70" style={{ width: `${Math.max(3, (val(r) / max) * 100)}%` }} />}
                      </span>
                      <span className="w-24 shrink-0 text-right tabular-nums text-muted-foreground">{formatMoney(val(r))}</span>
                    </span>
                    <span className="hidden w-16 shrink-0 text-right tabular-nums sm:block">{formatCount(r.policies)}</span>
                    <span className="w-14 shrink-0 text-right tabular-nums text-muted-foreground">{total > 0 ? formatPercent((val(r) / total) * 100, 1) : "—"}</span>
                  </Link>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
