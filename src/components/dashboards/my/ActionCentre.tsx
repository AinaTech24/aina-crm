/**
 * §2 Today's Action Centre — the first thing on the page and the largest.
 *
 * Ten cards, each one a count plus the names behind it. The names are the
 * point: "4 follow-ups due" sends the reader off to find out who, while
 * "4 follow-ups due — Aarav Patel, Sneha Shah, …" IS the answer. A card that
 * only shows a number is a signpost; one that shows the work is a worklist.
 *
 * ── The severity budget ─────────────────────────────────────────────────────
 *
 * Red is for overdue and consequential. Amber is for approaching. Everything
 * else, including every empty card, is neutral. Two consequences worth
 * stating:
 *
 *   · An empty card is NOT green. "0 SIP rejections" is not an achievement,
 *     and a row of green ticks for a quiet Tuesday teaches the reader that
 *     colour here means nothing.
 *   · Birthdays are never coloured. A relationship prompt that shouts in the
 *     same voice as a breached SLA devalues the SLA.
 *
 * Cards sort by severity, so what is actually overdue rises to the top left
 * regardless of which section of the brief it came from.
 */

import Link from "next/link";
import {
  AlertTriangle, ArrowUpRight, CalendarClock, CheckCircle2, ChevronRight, Clock,
} from "lucide-react";
import type { ActionCard, Severity } from "@/lib/dashboard/my/actions";
import { formatCount } from "@/lib/format";
import { cn } from "@/lib/utils";

const SEVERITY: Record<Severity, { ring: string; value: string; chip: string; label: string }> = {
  critical: {
    ring: "border-destructive/35 hover:border-destructive/60",
    value: "text-destructive",
    chip: "bg-destructive/10 text-destructive",
    label: "Needs action",
  },
  attention: {
    ring: "border-warning/40 hover:border-warning/70",
    value: "text-warning-foreground",
    chip: "bg-warning/10 text-warning-foreground",
    label: "Due soon",
  },
  normal: {
    ring: "border-border hover:border-primary/40",
    value: "text-foreground",
    chip: "bg-secondary text-secondary-foreground",
    label: "",
  },
};

function Card({ card }: { card: ActionCard }) {
  const s = SEVERITY[card.severity];
  const empty = card.count === 0;
  const unknown = card.count == null;

  return (
    <Link
      href={card.href}
      className={cn(
        "group flex flex-col rounded-xl border bg-card p-4 transition-colors",
        // An empty card stays quiet whatever its severity rules say — there is
        // nothing to be alarmed about.
        empty || unknown ? SEVERITY.normal.ring : s.ring,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-medium leading-snug text-foreground">{card.label}</span>
        {!empty && !unknown && s.label && (
          <span className={cn("chip shrink-0", s.chip)}>{s.label}</span>
        )}
      </div>

      <div className="mt-2 flex items-baseline gap-2">
        <span
          className={cn(
            "text-[1.75rem] font-semibold leading-none tabular-nums tracking-[-0.03em]",
            unknown ? "text-muted-foreground" : empty ? "text-muted-foreground" : s.value,
          )}
          title={unknown ? card.unavailable : undefined}
        >
          {unknown ? "—" : formatCount(card.count)}
        </span>
        {empty && <CheckCircle2 className="size-3.5 shrink-0 text-muted-foreground/50" aria-hidden />}
      </div>

      {unknown ? (
        <p className="mt-1.5 text-2xs leading-relaxed text-muted-foreground">{card.unavailable}</p>
      ) : (
        card.detail && <p className="mt-1.5 text-2xs leading-relaxed text-muted-foreground">{card.detail}</p>
      )}

      {card.names.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-border/60 pt-2.5">
          {card.names.slice(0, 4).map((n) => (
            <li key={n.id} className="flex items-baseline justify-between gap-2 text-2xs">
              <span className="truncate font-medium text-foreground">{n.name}</span>
              {n.meta && <span className="shrink-0 text-muted-foreground">{n.meta}</span>}
            </li>
          ))}
          {card.names.length > 4 && (
            <li className="text-2xs text-muted-foreground">
              +{card.names.length - 4} more
            </li>
          )}
        </ul>
      )}

      <span className="mt-auto flex items-center gap-0.5 pt-3 text-2xs font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
        Open <ChevronRight className="size-3" aria-hidden />
      </span>
    </Link>
  );
}

export function ActionCentre({ cards, today }: { cards: ActionCard[]; today: string }) {
  const critical = cards.filter((c) => c.severity === "critical" && (c.count ?? 0) > 0);
  const attention = cards.filter((c) => c.severity === "attention" && (c.count ?? 0) > 0);
  const totalCritical = critical.reduce((s, c) => s + (c.count ?? 0), 0);

  return (
    <section className="card-surface p-5 sm:p-6" aria-label="Today's action centre">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-border/60 pb-4">
        <div className="min-w-0">
          <h2 className="section-title flex items-center gap-2">
            <CalendarClock className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            Today&rsquo;s action centre
          </h2>
          
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {totalCritical > 0 ? (
            <span className="chip bg-destructive/10 text-destructive">
              <AlertTriangle className="size-3" aria-hidden />
              {formatCount(totalCritical)} overdue across {critical.length}{" "}
              {critical.length === 1 ? "queue" : "queues"}
            </span>
          ) : (
            <span className="chip bg-secondary text-secondary-foreground">
              <CheckCircle2 className="size-3" aria-hidden /> Nothing overdue
            </span>
          )}
          {attention.length > 0 && (
            <span className="chip bg-warning/10 text-warning-foreground">
              <Clock className="size-3" aria-hidden /> {attention.length} due soon
            </span>
          )}
          <span className="text-2xs text-muted-foreground">{today}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {cards.map((c) => (
          <Card key={c.key} card={c} />
        ))}
      </div>

      <p className="mt-4 flex items-center gap-1.5 text-2xs text-muted-foreground">
        <ArrowUpRight className="size-3 shrink-0" aria-hidden />
        Every card opens the list behind it.
      </p>
    </section>
  );
}
