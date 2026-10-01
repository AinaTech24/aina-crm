/**
 * §1 My Day, §36 Today's progress and §2 Needs My Attention — the top of the
 * RM desk. Action before analytics: these three answer "what is due, what is
 * late, how did today go" before a single chart on the page.
 *
 * Colour follows the severity budget: red only for genuinely overdue or
 * failed work, amber for approaching, neutral for everything else — and an
 * empty card is never green ("0 overdue tasks" is not an achievement).
 */

import Link from "next/link";
import {
  AlertOctagon, CalendarCheck, CalendarDays, Gift, Headset, ListChecks, PhoneCall, Repeat, Shield, Sunset,
} from "lucide-react";
import type { DayCard, MyDay, OverdueCard, TodayProgress } from "@/lib/dashboard/my/desk";
import { Section } from "@/components/dashboards/my/Shared";
import { formatCount, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

const ICON: Record<DayCard["key"], React.ReactNode> = {
  meetings: <CalendarDays className="size-4" />,
  followups: <PhoneCall className="size-4" />,
  reviews: <CalendarCheck className="size-4" />,
  sip: <Repeat className="size-4" />,
  tasks: <ListChecks className="size-4" />,
  queries: <Headset className="size-4" />,
  renewals: <Shield className="size-4" />,
  events: <Gift className="size-4" />,
};

/**
 * A card inside a section is a soft fill, not a second hairline box. Only a
 * card that needs action carries a border — and a tint of its severity — so
 * the eye lands on it without reading a single number.
 */
const SURFACE = {
  critical: "border-destructive/30 bg-destructive/5",
  attention: "border-warning/50 bg-warning/5",
  normal: "border-transparent bg-secondary/70",
} as const;

function Toggle({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={active ? "true" : undefined}
      className={cn(
        "inline-flex min-h-6 items-center gap-1 rounded-md px-2.5 py-1 text-2xs font-semibold transition-colors",
        active ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </Link>
  );
}

/* ───────────────────────────── §1 My Day ───────────────────────────── */

export function MyDayPanel({
  data, hrefs, progress, showProgress,
}: {
  data: MyDay;
  hrefs: { today: string; tomorrow: string; progressOn: string; progressOff: string };
  progress: TodayProgress | null;
  showProgress: boolean;
}) {
  return (
    <Section
      title="My Day"
      subtitle={data.isToday
        ? "What falls due today. Anything already late is below, in Needs my attention."
        : "What falls due tomorrow — plan the morning the evening before."}
      icon={<CalendarDays className="size-4" />}
      action={
        <div className="dash-seg flex-wrap" role="group" aria-label="Action day">
          <Toggle href={hrefs.today} active={data.isToday}>Today</Toggle>
          <Toggle href={hrefs.tomorrow} active={!data.isToday}>Tomorrow</Toggle>
          <Toggle href={showProgress ? hrefs.progressOff : hrefs.progressOn} active={showProgress}>
            <Sunset className="size-3" aria-hidden /> Today&apos;s progress
          </Toggle>
        </div>
      }
    >
      {showProgress && progress && <ProgressStrip data={progress} />}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {data.cards.map((c) => (
          <Link
            key={c.key}
            href={c.href}
            className={cn(
              "flex flex-col rounded-xl border p-4 transition-colors hover:border-primary/40 hover:bg-accent",
              SURFACE[c.severity],
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <span className="text-xs font-medium leading-snug text-foreground/80">{c.label}</span>
              <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-card text-muted-foreground" aria-hidden>{ICON[c.key]}</span>
            </div>
            {c.count == null ? (
              <>
                <span className="mt-1 text-2xl font-semibold leading-tight text-muted-foreground" title={c.unavailable}>—</span>
                <span className="text-2xs leading-snug text-muted-foreground">{c.unavailable}</span>
              </>
            ) : (
              <>
                <span className={cn(
                  "mt-1 text-2xl font-semibold tabular-nums leading-tight",
                  c.severity === "critical" && c.count > 0 ? "text-destructive" : "text-foreground",
                )}>
                  {formatCount(c.count)}
                </span>
                {c.parts.length > 0 && (
                  <span className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-2xs">
                    {c.parts.map((p) => (
                      <span key={p.label} className="text-muted-foreground">
                        {p.label}{" "}
                        <span className={cn(
                          "font-semibold tabular-nums",
                          p.tone === "bad" && Number(p.value) > 0 ? "text-destructive"
                          : p.tone === "warn" && Number(p.value) > 0 ? "text-warning-foreground"
                          : "text-foreground",
                        )}>{p.value}</span>
                      </span>
                    ))}
                  </span>
                )}
                {c.detail && <span className="mt-auto pt-2 text-2xs text-muted-foreground">{c.detail}</span>}
              </>
            )}
          </Link>
        ))}
      </div>
    </Section>
  );
}

/* ───────────────────────────── §36 Today's progress ───────────────────────────── */

function ProgressStrip({ data }: { data: TodayProgress }) {
  const pair = (label: string, done: number, due: number, dueWord = "planned") => (
    <div key={label} className="rounded-lg bg-card px-3 py-2">
      <div className="text-2xs text-muted-foreground">{label}</div>
      <div className="text-base font-semibold tabular-nums">
        {formatCount(done)}
        <span className="text-xs font-normal text-muted-foreground"> / {formatCount(due)} {dueWord}</span>
      </div>
    </div>
  );
  const one = (label: string, value: React.ReactNode) => (
    <div key={label} className="rounded-lg bg-card px-3 py-2">
      <div className="text-2xs text-muted-foreground">{label}</div>
      <div className="text-base font-semibold tabular-nums">{value}</div>
    </div>
  );
  return (
    <div className="mb-4 rounded-xl border border-primary/20 bg-primary/5 p-3">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-foreground">
        <Sunset className="size-3.5" aria-hidden /> Today&apos;s progress — close the day
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {pair("Meetings completed", data.meetings.done, data.meetings.planned)}
        {pair("Follow-ups done", data.followUps.done, data.followUps.due, "due")}
        {pair("Tasks completed", data.tasks.done, data.tasks.due, "due")}
        {pair("Reviews completed", data.reviews.done, data.reviews.due, "due")}
        {one("Service requests actioned", formatCount(data.queriesActioned))}
        {one("New leads created", formatCount(data.leadsCreated))}
        {one("Proposals shared", formatCount(data.proposalsShared))}
        {one("Business recorded today", data.business == null
          ? <span className="text-muted-foreground" title="Business Entries has never been used for this book.">—</span>
          : <>{formatMoney(data.business.value)}<span className="text-xs font-normal text-muted-foreground"> · {data.business.entries} entr{data.business.entries === 1 ? "y" : "ies"}</span></>)}
      </div>
      <p className="mt-2 text-2xs text-muted-foreground">
        Follow-ups done counts leads followed up today and clients with an activity logged today. Business recorded
        is from Business Entries logged today.
      </p>
    </div>
  );
}

/* ───────────────────────────── §2 Needs my attention ───────────────────────────── */

export function NeedsMyAttention({ cards }: { cards: OverdueCard[] }) {
  const late = cards.filter((c) => c.count > 0);
  const critical = late.filter((c) => c.severity === "critical").length;
  return (
    <Section
      title="Needs my attention"
      subtitle={late.length === 0
        ? "Nothing is overdue."
        : `${late.length} kind${late.length === 1 ? "" : "s"} of work overdue${critical ? ` — ${critical} critical` : ""}. Oldest first inside every list.`}
      icon={<AlertOctagon className="size-4" />}
      note="Red is reserved for genuinely late or failed work. Each card says how many, how late the oldest is, and the money involved; hover a card for what puts an item there. Thresholds are set in Settings → Dashboard thresholds."
    >
      <div id="attention" className="scroll-mt-40" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((c) => {
          const empty = c.count === 0;
          return (
            <Link
              key={c.key}
              href={c.href}
              title={c.rule}
              className={cn(
                "flex flex-col rounded-xl border p-4 transition-colors hover:border-primary/40 hover:bg-accent",
                empty ? SURFACE.normal : SURFACE[c.severity === "critical" ? "critical" : "attention"],
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <span className={cn("text-xs font-semibold leading-snug", empty ? "text-muted-foreground" : "text-foreground")}>{c.label}</span>
                {!empty && (
                  <span className={cn(
                    "chip shrink-0",
                    c.severity === "critical" ? "bg-destructive/10 text-destructive" : "bg-warning/10 text-warning-foreground",
                  )}>
                    {c.severity === "critical" ? "Critical" : "Attention"}
                  </span>
                )}
              </div>
              {empty ? (
                <span className="mt-2 text-xs text-muted-foreground/80">Nothing overdue</span>
              ) : (
                <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className={cn("text-2xl font-semibold tabular-nums leading-none",
                    c.severity === "critical" ? "text-destructive" : "text-foreground")}>
                    {formatCount(c.count)}
                  </span>
                  {c.value != null && c.value > 0 && (
                    <span className="text-xs font-medium tabular-nums text-muted-foreground">{formatMoney(c.value)}</span>
                  )}
                  {c.oldestDays != null && (
                    <span className="text-2xs text-muted-foreground">
                      oldest <span className="font-semibold text-foreground">{c.oldestDays} day{c.oldestDays === 1 ? "" : "s"}</span>
                    </span>
                  )}
                </div>
              )}
            </Link>
          );
        })}
      </div>
    </Section>
  );
}
