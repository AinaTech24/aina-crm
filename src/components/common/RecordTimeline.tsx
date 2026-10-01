"use client";

/**
 * RecordTimeline — the activity history on a lead or client page, drawn from
 * the plain items @/lib/timeline builds.
 *
 * The client page used to keep this list inside a fixed-height box with the
 * scrollbar hidden, which is how the ninth event and everything older
 * disappeared (the same trap CLAUDE.md records for `.table-scroll`). The list
 * now shows its latest few in full and grows on "Show all".
 *
 * Colour is a signal: the icon chips are neutral, and only a status that asks
 * for attention (overdue, failed, not sent) is tinted.
 */

import { useState } from "react";
import Link from "next/link";
import {
  Calendar,
  ClipboardList,
  ListChecks,
  Mail,
  MapPin,
  MessageSquare,
  Phone,
  StickyNote,
  Ticket,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { InlineEmpty } from "@/components/common/EmptyState";
import { formatDate, formatRelative } from "@/lib/format";
import type { TimelineItem } from "@/lib/timeline";

const ICON: Record<TimelineItem["kind"], LucideIcon> = {
  call: Phone,
  visit: MapPin,
  note: StickyNote,
  message: MessageSquare,
  email: Mail,
  task: ListChecks,
  meeting: Calendar,
  ticket: Ticket,
  other: ClipboardList,
};

const INITIAL = 8;

export function RecordTimeline({
  items,
  title = "Activity",
  emptyMessage = "Nothing logged yet. Log a call, add a task or send a message and it shows up here.",
}: {
  items: TimelineItem[];
  title?: string;
  emptyMessage?: string;
}) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, INITIAL);

  return (
    <Card>
      <CardHeader
        title={title}
        action={<span className="text-xs tabular-nums text-muted-foreground">{items.length}</span>}
      />
      <CardBody>
        {items.length === 0 ? (
          <InlineEmpty message={emptyMessage} />
        ) : (
          <>
            <ol className="relative space-y-4 pl-10 before:absolute before:bottom-3 before:left-4 before:top-3 before:w-px before:bg-border">
              {shown.map((it) => {
                const Icon = ICON[it.kind] ?? ClipboardList;
                const when = formatDate(it.at, "dateTime");
                return (
                  <li key={it.id} className="relative">
                    <span
                      className="absolute -left-10 top-0 grid size-8 place-items-center rounded-full border border-border bg-card text-muted-foreground"
                      aria-hidden
                    >
                      <Icon className="size-3.5" />
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        {it.href ? (
                          <Link href={it.href} className="text-sm font-medium text-foreground hover:underline">{it.title}</Link>
                        ) : (
                          <span className="text-sm font-medium text-foreground">{it.title}</span>
                        )}
                        {it.status && <Badge raw tone={it.status.tone}>{it.status.label}</Badge>}
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        <time dateTime={it.at} title={when}>{formatRelative(it.at)}</time>
                        {it.meta && <span> · {it.meta}</span>}
                      </div>
                      {it.body && (
                        <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-foreground/80">{it.body}</p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
            {items.length > INITIAL && (
              <button
                type="button"
                onClick={() => setAll((v) => !v)}
                className="mt-4 text-sm font-medium text-primary hover:underline"
              >
                {all ? "Show fewer" : `Show all ${items.length}`}
              </button>
            )}
          </>
        )}
      </CardBody>
    </Card>
  );
}
