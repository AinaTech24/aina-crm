/**
 * The Opportunities board — one column per step of the journey (lib/
 * opportunities/board.ts), a card per opportunity that opens its page.
 * Plain module: rendered on the server, nothing here needs the browser.
 *
 * A card says what the owner needs to know at a glance: the client, the
 * product and amount, who owns it, how long it has sat in this step, and
 * the next follow-up — red when overdue, amber when it is today, and "No
 * follow-up" (amber) when nothing is planned, because an open opportunity
 * nobody will call back is the one that quietly dies.
 */

import Link from "next/link";
import { CalendarClock, Clock } from "lucide-react";
import { formatDate, formatMoney } from "@/lib/format";
import type { BoardRow } from "@/lib/opportunities/board";
import { cn } from "@/lib/utils";

const istDay = (d: Date) => new Date(d.getTime() + 5.5 * 36e5).toISOString().slice(0, 10);

export function followUpState(row: Pick<BoardRow, "status" | "followUpAt">): { label: string; tone: "danger" | "warning" | "neutral" } | null {
  if (row.status !== "open") return null;
  if (!row.followUpAt) return { label: "No follow-up", tone: "warning" };
  const today = istDay(new Date());
  const due = istDay(new Date(row.followUpAt));
  if (due < today) return { label: `Overdue · ${formatDate(row.followUpAt)}`, tone: "danger" };
  if (due === today) return { label: "Follow up today", tone: "warning" };
  return { label: formatDate(row.followUpAt), tone: "neutral" };
}

export function daysInStage(row: Pick<BoardRow, "stageEnteredAt">): number | null {
  if (!row.stageEnteredAt) return null;
  return Math.max(0, Math.floor((Date.now() - new Date(row.stageEnteredAt).getTime()) / 864e5));
}

export function OpportunityBoard({ columns, rows }: {
  columns: ReadonlyArray<{ key: string; label: string }>;
  rows: BoardRow[];
}) {
  return (
    <div className="overflow-x-auto pb-2">
      <div className="flex min-w-max gap-3">
        {columns.map((col) => {
          const items = rows.filter((r) => r.column === col.key);
          const value = items.reduce((s, r) => s + (r.expectedValue ?? 0), 0);
          return (
            <section key={col.key} className="flex w-64 shrink-0 flex-col rounded-xl bg-secondary/50 p-2" aria-label={col.label}>
              <header className="flex items-baseline justify-between gap-2 px-1.5 pb-2 pt-1">
                <h3 className="text-sm font-semibold text-foreground">{col.label}</h3>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {items.length}{value > 0 ? ` · ${formatMoney(value)}` : ""}
                </span>
              </header>
              <ol className="flex flex-col gap-2">
                {items.length === 0 && <li className="dash-empty px-2 py-3 text-xs">Nothing here</li>}
                {items.map((r) => {
                  const fu = followUpState(r);
                  const days = daysInStage(r);
                  return (
                    <li key={r.id}>
                      <Link
                        href={`/dashboard/opportunities/${r.id}`}
                        className={cn(
                          "block rounded-lg border bg-card p-3 text-sm shadow-sm transition-colors hover:border-primary/40",
                          r.delayed ? "border-warning/50" : "border-border/70",
                        )}
                      >
                        <div className="truncate font-medium text-foreground">{r.investorName}</div>
                        <div className="mt-0.5 flex items-center justify-between gap-2 text-xs">
                          <span className="truncate text-muted-foreground">{r.productLabel}</span>
                          {r.expectedValue != null && (
                            <span className="shrink-0 font-semibold tabular-nums text-foreground">
                              {formatMoney(r.expectedValue)}{r.investmentMode === "sip" ? "/mo" : ""}
                            </span>
                          )}
                        </div>
                        {col.key === "processing" && <div className="mt-1 text-xs text-muted-foreground">{r.stageName}</div>}
                        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs">
                          {fu && (
                            <span className={cn(
                              "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-medium",
                              fu.tone === "danger" && "bg-destructive/10 text-destructive",
                              fu.tone === "warning" && "bg-warning/15 text-warning-foreground",
                              fu.tone === "neutral" && "bg-secondary text-muted-foreground",
                            )}>
                              <CalendarClock className="size-3" aria-hidden /> {fu.label}
                            </span>
                          )}
                          {r.status === "open" && days != null && (
                            <span className={cn("inline-flex items-center gap-1", r.delayed ? "font-medium text-warning-foreground" : "text-muted-foreground")}>
                              <Clock className="size-3" aria-hidden /> {days === 0 ? "today" : `${days}d`}
                            </span>
                          )}
                          {r.status === "lost" && r.lostReason && <span className="truncate text-muted-foreground">{r.lostReason}</span>}
                          {r.ownerName && <span className="ml-auto truncate text-muted-foreground">{r.ownerName}</span>}
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ol>
            </section>
          );
        })}
      </div>
    </div>
  );
}
