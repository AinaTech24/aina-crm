"use client";

/**
 * §5 — the claim lifecycle for claims intimated in the period: how many
 * reached each stage, their claim amount, and the average days from
 * intimation to getting there. Personal / Commercial switch on the client;
 * all three cuts arrive computed.
 */

import { useState } from "react";
import { GitBranch } from "lucide-react";
import type { Funnel } from "@/lib/dashboard/claims/analysis";
import { formatCount, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

type LineKey = "all" | "personal" | "commercial";

export function FunnelPanel({ funnels, periodLabel, lockedLine }: {
  funnels: Record<LineKey, Funnel>; periodLabel: string;
  /** The dashboard's own line filter: the data is already one line. */
  lockedLine: "personal" | "commercial" | null;
}) {
  const [picked, setPicked] = useState<LineKey>("all");
  const line: LineKey = lockedLine ? "all" : picked;
  const f = funnels[line];
  const top = f.stages[0]?.n ?? 0;
  return (
    <section className="card-surface p-5 sm:p-6" aria-label="Claim lifecycle">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-border/60 pb-4">
        <div>
          <h2 className="section-title flex items-center gap-2"><GitBranch className="size-4 text-muted-foreground" /> Claim lifecycle</h2>
          <p className="section-subtitle mt-1">Claims intimated in {periodLabel}{lockedLine ? ` (${lockedLine === "personal" ? "Personal" : "Commercial"} Lines)` : ""} — how far each has got.</p>
        </div>
        {!lockedLine && (
          <div className="inline-flex rounded-lg border border-border bg-secondary/60 p-0.5" role="group" aria-label="Line">
            {([["all", "All"], ["personal", "Personal"], ["commercial", "Commercial"]] as const).map(([k, l]) => (
              <button key={k} type="button" aria-pressed={line === k} onClick={() => setPicked(k)}
                className={cn("inline-flex min-h-7 items-center rounded-md px-2.5 text-xs font-medium", line === k ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                {l}
              </button>
            ))}
          </div>
        )}
      </div>
      {top === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-xs text-muted-foreground">No claim intimated in {periodLabel}.</p>
      ) : (
        <>
          <ol className="space-y-2">
            {f.stages.map((s) => (
              <li key={s.key} className="flex items-center gap-3 text-xs" title={s.hint}>
                <span className="w-36 shrink-0 text-foreground sm:w-44">{s.label}</span>
                <span className="h-4 min-w-0 flex-1 overflow-hidden rounded bg-secondary">
                  {s.n > 0 && <span className="block h-full rounded bg-primary/70" style={{ width: `${Math.max(3, (s.n / top) * 100)}%` }} />}
                </span>
                <span className="w-44 shrink-0 text-right tabular-nums text-muted-foreground sm:w-60">
                  <span className="font-medium text-foreground">{formatCount(s.n)}</span> · {formatMoney(s.amount)}
                  {s.key !== "logged" && <> · {s.avgDays == null ? "—" : `${Math.round(s.avgDays)} d avg`}</>}
                </span>
              </li>
            ))}
          </ol>
          <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
            {[["Still open", f.open], ["Rejected", f.rejected], ["Withdrawn", f.withdrawn]].map(([l, t]) => (
              <div key={l as string} className="rounded-lg border border-border px-3 py-2">
                <div className="text-2xs text-muted-foreground">{l as string}</div>
                <div className="font-semibold tabular-nums">{formatCount((t as { n: number }).n)} <span className="font-normal text-muted-foreground">· {formatMoney((t as { amount: number }).amount)}</span></div>
              </div>
            ))}
          </div>
        </>
      )}
      <p className="mt-3 text-2xs text-muted-foreground">
        There is no approval stage: the CRM&apos;s statuses go from under process to settled. A stage counts as reached from the audit trail and the claim&apos;s own dates, so a settled claim was also submitted. Average days run from intimation to first reaching the stage.
      </p>
    </section>
  );
}
