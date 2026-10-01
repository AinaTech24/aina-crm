"use client";

/**
 * §35 Morning priority view — "Good morning, Pooja", the day in seven numbers,
 * and the handful of records to start on.
 *
 * Open on the first visit of the day; "Hide for today" folds it to one line
 * until tomorrow. The choice is a per-browser convenience in localStorage (it
 * can be missing in a private window, so every read and write is guarded and
 * the brief simply shows open).
 *
 * The top actions are the first rows of the worklist, whose order is a stated
 * rule — overdue, then due today, then category, then time — so the brief
 * never shows an unexplained "AI priority".
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

export type BriefCount = { label: string; value: number | null; href: string };
export type BriefAction = {
  key: string; action: string; client: string | null; why: string; dueText: string; href: string;
  priority: "critical" | "attention" | "normal"; overdue: boolean;
};

export function MorningBrief({
  userKey, today, greeting, counts, top,
}: {
  userKey: string;
  today: string;
  greeting: string;
  counts: BriefCount[];
  top: BriefAction[];
}) {
  const storageKey = `aina.desk.morning-hidden.${userKey}`;
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    try { setHidden(window.localStorage.getItem(storageKey) === today); } catch { /* private window */ }
  }, [storageKey, today]);
  const toggle = () => {
    const next = !hidden;
    setHidden(next);
    try {
      if (next) window.localStorage.setItem(storageKey, today);
      else window.localStorage.removeItem(storageKey);
    } catch { /* ignore */ }
  };

  const overdue = top.filter((t) => t.overdue).length;
  return (
    <section className="card-surface overflow-hidden border-primary/20" aria-label="Morning priorities">
      <div className="flex flex-wrap items-center justify-between gap-3 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent px-5 py-3.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-card text-primary shadow-sm" aria-hidden>
            <Sun className="size-4" />
          </span>
          <h2 className="truncate text-lg font-semibold tracking-tight text-foreground">{greeting}</h2>
          {hidden && (
            <span className="truncate text-xs text-muted-foreground">
              {counts.filter((c) => (c.value ?? 0) > 0).map((c) => `${c.value} ${c.label.toLowerCase()}`).join(" · ") || "a clear day"}
            </span>
          )}
        </div>
        <button type="button" onClick={toggle}
          className="inline-flex min-h-6 items-center gap-1 rounded-md px-2 py-1 text-2xs font-medium text-primary hover:bg-accent">
          {hidden ? <>Show <ChevronDown className="size-3.5" aria-hidden /></> : <>Hide for today <ChevronUp className="size-3.5" aria-hidden /></>}
        </button>
      </div>
      {!hidden && (
        // grid-cols-1, not an implicit track: an implicit auto column grows to
        // the min-content of the truncated action titles and pushes the card
        // past a phone screen.
        <div className="grid grid-cols-1 gap-4 p-5 lg:grid-cols-5">
          <div className="min-w-0 lg:col-span-2">
            <h3 className="mb-2 text-2xs font-semibold text-muted-foreground">Your day</h3>
            {/* Flex, so the seventh tile takes the last row rather than leaving a hole. */}
            <ul className="dash-stats" style={{ ["--cols-sm" as string]: 2, ["--cols-lg" as string]: 2 }}>
              {counts.map((c) => (
                <li key={c.label}>
                  <Link href={c.href} className="flex h-full items-baseline justify-between gap-2 rounded-lg border border-transparent bg-secondary/70 px-3 py-2.5 transition-colors hover:border-primary/25 hover:bg-accent">
                    <span className="text-xs font-medium text-foreground/80">{c.label}</span>
                    <span className={cn("text-lg font-semibold tabular-nums", c.value ? "text-foreground" : "text-muted-foreground/60")}>{c.value ?? "—"}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div className="min-w-0 lg:col-span-3">
            <h3 className="mb-2 text-2xs font-semibold text-muted-foreground"
              title="Overdue first, then due today, then client category, then time. No hidden score.">
              Top actions{overdue ? ` — ${overdue} overdue` : ""}
            </h3>
            {top.length === 0 ? (
              <p className="dash-empty">
                Nothing overdue and nothing due today.
              </p>
            ) : (
              <ol className="divide-y divide-border/60 overflow-hidden rounded-lg border border-border/70">
                {top.map((t, i) => (
                  <li key={t.key}>
                    <Link href={t.href} className="flex items-start gap-3 px-3 py-2 transition-colors hover:bg-accent">
                      <span className={cn("mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-2xs font-semibold",
                        t.priority === "critical" ? "bg-destructive/10 text-destructive"
                        : t.priority === "attention" ? "bg-warning/10 text-warning-foreground" : "bg-secondary text-secondary-foreground")}>
                        {i + 1}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-medium text-foreground">
                          {/* Task titles often carry the name already ("Birthday call — Pooja Shah"). */}
                          {t.action}{t.client && !t.action.includes(t.client) ? ` — ${t.client}` : ""}
                        </span>
                        {t.why && <span className="block truncate text-2xs text-muted-foreground">{t.why}</span>}
                      </span>
                      <span className={cn("shrink-0 text-2xs tabular-nums", t.overdue ? "font-semibold text-destructive" : "text-muted-foreground")}>
                        {t.dueText}
                      </span>
                    </Link>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
