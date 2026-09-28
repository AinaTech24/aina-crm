"use client";

/**
 * §6 Upcoming 7 days — meetings, reviews, follow-ups, tasks, renewals and
 * client occasions, by day. "Day" shows today only; "Week" the next seven.
 * Moving a meeting or a task opens it where the CRM lets it be rescheduled —
 * nothing is moved from here without the record in front of the RM.
 */

import Link from "next/link";
import { useState } from "react";
import { CalendarCheck, CalendarClock, CalendarDays, Gift, ListChecks, PhoneCall, Shield } from "lucide-react";
import type { UpcomingItem } from "@/lib/dashboard/my/desk";
import { cn } from "@/lib/utils";

const KIND: Record<UpcomingItem["kind"], { label: string; icon: React.ReactNode }> = {
  meeting: { label: "Meeting", icon: <CalendarDays className="size-3.5" /> },
  review: { label: "Review", icon: <CalendarCheck className="size-3.5" /> },
  follow_up: { label: "Follow-up", icon: <PhoneCall className="size-3.5" /> },
  task: { label: "Task", icon: <ListChecks className="size-3.5" /> },
  renewal: { label: "Renewal", icon: <Shield className="size-3.5" /> },
  occasion: { label: "Occasion", icon: <Gift className="size-3.5" /> },
};

function dayHeading(iso: string, today: string): string {
  const d = new Date(`${iso}T00:00:00`);
  const base = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short" }).format(d);
  if (iso === today) return `Today · ${base}`;
  const t = new Date(`${today}T00:00:00`);
  t.setDate(t.getDate() + 1);
  const p = (n: number) => String(n).padStart(2, "0");
  const tomorrow = `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`;
  return iso === tomorrow ? `Tomorrow · ${base}` : base;
}

export function UpcomingWeek({ items, today }: { items: UpcomingItem[]; today: string }) {
  const [view, setView] = useState<"day" | "week">("week");
  const shown = view === "day" ? items.filter((i) => i.date === today) : items;
  const days = [...new Set(shown.map((i) => i.date))];

  return (
    <section className="card-surface p-5 sm:p-6" aria-label="Upcoming 7 days">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-border/60 pb-4">
        <div className="min-w-0">
          <h2 className="section-title flex items-center gap-2">
            <CalendarClock className="size-4 text-muted-foreground" aria-hidden /> Upcoming 7 days
          </h2>
          <p className="section-subtitle mt-1">What is coming, day by day — {items.length} item{items.length === 1 ? "" : "s"}.</p>
        </div>
        <div className="flex items-center gap-1" role="group" aria-label="View">
          {(["day", "week"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              aria-pressed={view === v}
              className={cn(
                "inline-flex min-h-6 items-center rounded-md px-2.5 py-1 text-2xs font-semibold transition-colors",
                view === v ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground hover:text-foreground",
              )}
            >
              {v === "day" ? "Day" : "Week"}
            </button>
          ))}
        </div>
      </div>

      {days.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-xs text-muted-foreground">
          {view === "day" ? "Nothing scheduled for today." : "Nothing scheduled in the next seven days."}
        </p>
      ) : (
        <div className="space-y-4">
          {days.map((d) => (
            <div key={d}>
              <h3 className={cn("mb-1.5 text-2xs font-semibold uppercase tracking-wide",
                d === today ? "text-primary" : "text-muted-foreground")}>
                {dayHeading(d, today)}
              </h3>
              <ul className="divide-y divide-border/60 rounded-lg border border-border">
                {shown.filter((i) => i.date === d).map((i) => (
                  <li key={i.key} className="flex items-center gap-3 px-3 py-2 text-xs">
                    <span className="w-16 shrink-0 tabular-nums text-muted-foreground">{i.time ?? "All day"}</span>
                    <span className="inline-flex w-24 shrink-0 items-center gap-1 text-muted-foreground">
                      {KIND[i.kind].icon} {KIND[i.kind].label}
                    </span>
                    <Link href={i.href} className="min-w-0 flex-1 truncate hover:text-primary hover:underline">
                      <span className="font-medium text-foreground">{i.client ?? i.title}</span>
                      {i.client && <span className="text-muted-foreground"> — {i.title}</span>}
                    </Link>
                    {i.rescheduleHref && (
                      <Link href={i.rescheduleHref} className="shrink-0 text-2xs font-medium text-primary hover:underline">
                        Reschedule
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
