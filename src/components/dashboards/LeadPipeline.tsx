import Link from "next/link";
import { ArrowRight, Filter } from "lucide-react";

import type { LeadPipeline as LeadPipelineData, LeadStageBucket } from "@/lib/dashboard/lead-pipeline";

/**
 * Lead pipeline — stage occupancy, in pipeline order, with SLA breaches.
 *
 * The competitor's version of this is a plain bar chart of leads per stage. The
 * chart is the easy half; what makes it useful is that each bar is a filtered
 * link and carries the count of leads that have outstayed the stage's SLA — so
 * the answer to "where is my pipeline stuck" comes with the list attached.
 *
 * Dead ends (Won / Not Qualified) are rendered apart from the path rather than
 * as two more bars in it. Mixed in, a tall "Not Qualified" bar reads as the
 * biggest part of the pipeline, when it is the part that has left it.
 */
function StageBar({ b, max }: { b: LeadStageBucket; max: number }) {
  const pctWidth = max > 0 ? Math.round((b.count / max) * 100) : 0;
  return (
    <Link
      href={`/dashboard/leads?stage=${encodeURIComponent(b.key)}`}
      className="group grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 rounded-md px-1.5 py-1 hover:bg-secondary"
      title={
        b.slaDays != null
          ? `${b.name} — SLA ${b.slaDays} day${b.slaDays === 1 ? "" : "s"}`
          : b.name
      }
    >
      <span className="text-2xs truncate text-muted-foreground group-hover:text-foreground">
        {b.name}
      </span>
      <span className="h-2 rounded-full bg-secondary overflow-hidden">
        {/* Zero draws nothing. A minimum-width stub would say a stage holds
            leads when it holds none. */}
        {b.count > 0 && (
          <span
            className="block h-full rounded-full bg-primary"
            style={{ width: `${Math.max(3, pctWidth)}%` }}
          />
        )}
      </span>
      <span className="flex items-baseline gap-2 justify-self-end">
        <span className="text-sm font-semibold tabular-nums">{b.count}</span>
        <span className="w-16 text-right text-2xs tabular-nums">
          {b.overdue > 0 ? (
            <span className="text-destructive">{b.overdue} late</span>
          ) : (
            <span className="text-transparent select-none" aria-hidden>
              —
            </span>
          )}
        </span>
      </span>
    </Link>
  );
}

export function LeadPipeline({ data }: { data: LeadPipelineData }) {
  const { path, loops, closed, openTotal, overdueTotal } = data;
  // One scale across path and loops, so a bar's length means the same thing in
  // both lists.
  const max = Math.max(...[...path, ...loops].map((b) => b.count), 0);

  return (
    <div className="card-surface p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Filter className="size-4 text-muted-foreground" />
            <span className="section-title">Lead pipeline</span>
          </div>
          <p className="text-2xs text-muted-foreground mt-0.5">
            {openTotal === 0
              ? "No open leads. New leads appear here as soon as they are added."
              : overdueTotal > 0
                ? `${openTotal.toLocaleString("en-IN")} open — ${overdueTotal.toLocaleString("en-IN")} past the stage SLA.`
                : `${openTotal.toLocaleString("en-IN")} open, all within their stage SLA.`}
          </p>
        </div>
        <Link
          href="/dashboard/leads"
          className="text-2xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 shrink-0"
        >
          All leads <ArrowRight className="size-3" />
        </Link>
      </div>

      {openTotal === 0 && closed.every((c) => c.count === 0) ? null : (
        <div className="space-y-0.5">
          {path.map((b) => (
            <StageBar key={b.key} b={b} max={max} />
          ))}

          {loops.some((b) => b.count > 0) && (
            <div className="pt-2 mt-1 border-t border-border">
              <div className="px-1.5 pb-1 text-2xs uppercase tracking-wide text-muted-foreground">
                Waiting on the lead
              </div>
              {loops
                .filter((b) => b.count > 0)
                .map((b) => (
                  <StageBar key={b.key} b={b} max={max} />
                ))}
            </div>
          )}

          {closed.some((b) => b.count > 0) && (
            <div className="pt-2 mt-1 border-t border-border flex flex-wrap items-center gap-x-4 gap-y-1 px-1.5">
              {closed
                .filter((b) => b.count > 0)
                .map((b) => (
                  <Link
                    key={b.key}
                    href={`/dashboard/leads?stage=${encodeURIComponent(b.key)}`}
                    className="text-2xs text-muted-foreground hover:text-foreground"
                  >
                    {b.name}{" "}
                    <span className="tabular-nums font-semibold text-foreground">{b.count}</span>
                  </Link>
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
