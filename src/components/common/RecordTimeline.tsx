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
 *
 * Every row opens: a task, meeting or service request goes to its own page
 * (`href`); a call, visit, note or message opens a dialog with everything the
 * row recorded and its full text (`detail`). The whole row is the target —
 * clicks on its own controls (the title link, the status menu) stay theirs.
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/Dialog";
import { InlineEmpty } from "@/components/common/EmptyState";
import { formatDate, formatRelative } from "@/lib/format";
import type { TimelineItem } from "@/lib/timeline";
import { cn } from "@/lib/utils";
import { TimelineStatusControl } from "./TimelineStatusControl";

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

/** A click that lands on one of the row's own controls is that control's. */
const OWN_CONTROL = "a, button, select, input, textarea, [role='menu'], [role='menuitem'], [role='listbox'], [data-no-row-click]";

export function RecordTimeline({
  items,
  title = "Activity",
  emptyMessage = "Nothing logged yet. Log a call, add a task or send a message and it shows up here.",
}: {
  items: TimelineItem[];
  title?: string;
  emptyMessage?: string;
}) {
  const router = useRouter();
  const [all, setAll] = useState(false);
  const [opened, setOpened] = useState<TimelineItem | null>(null);
  const shown = all ? items : items.slice(0, INITIAL);
  const open = (it: TimelineItem) => (it.href ? router.push(it.href) : setOpened(it));

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
                const clickable = !!(it.href || it.detail);
                return (
                  <li key={it.id} className="relative">
                    <span
                      className="absolute -left-10 top-0 grid size-8 place-items-center rounded-full border border-border bg-card text-muted-foreground"
                      aria-hidden
                    >
                      <Icon className="size-3.5" />
                    </span>
                    <div
                      className={cn(
                        "min-w-0",
                        clickable && "-mx-2 -my-1 cursor-pointer rounded-lg px-2 py-1 transition-colors hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      )}
                      {...(clickable ? {
                        role: it.href ? "link" : "button",
                        tabIndex: 0,
                        "aria-label": `${it.title} — open`,
                        onClick: (e: React.MouseEvent<HTMLDivElement>) => {
                          // A dialog the status menu opens is portalled, but React
                          // still bubbles its clicks here: only clicks inside the row count.
                          if (!e.currentTarget.contains(e.target as Node)) return;
                          if ((e.target as HTMLElement).closest(OWN_CONTROL)) return;
                          open(it);
                        },
                        onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => {
                          if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
                          e.preventDefault();
                          open(it);
                        },
                      } : {})}
                    >
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        {it.href ? (
                          <Link href={it.href} className="text-sm font-medium text-foreground hover:underline">{it.title}</Link>
                        ) : (
                          <span className="text-sm font-medium text-foreground">{it.title}</span>
                        )}
                        {/* A task's or meeting's status changes right here; the
                            control asks for anything a change needs first. */}
                        {it.control && it.status ? (
                          <TimelineStatusControl control={it.control} label={it.status.label} tone={it.status.tone} />
                        ) : (
                          it.status && <Badge raw tone={it.status.tone}>{it.status.label}</Badge>
                        )}
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
      {opened && <TimelineDetailDialog item={opened} onClose={() => setOpened(null)} />}
    </Card>
  );
}

/** A call, visit, note or message in full — the items that have no page of their own. */
function TimelineDetailDialog({ item, onClose }: { item: TimelineItem; onClose: () => void }) {
  const Icon = ICON[item.kind] ?? ClipboardList;
  const body = item.detail?.body ?? item.body;
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            {item.title}
            {item.status && <Badge raw tone={item.status.tone}>{item.status.label}</Badge>}
          </DialogTitle>
          <DialogDescription>{formatDate(item.at, "dateTime")}</DialogDescription>
        </DialogHeader>
        {item.detail && item.detail.facts.length > 0 && (
          <dl className="mt-4 grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
            {item.detail.facts.map(([k, v]) => (
              <div key={k} className="min-w-0">
                <dt className="text-xs text-muted-foreground">{k}</dt>
                <dd className="break-words font-medium text-foreground">{v}</dd>
              </div>
            ))}
          </dl>
        )}
        {body && (
          <div className="mt-4 max-h-80 overflow-y-auto whitespace-pre-wrap rounded-lg bg-secondary/60 p-3 text-sm leading-relaxed text-foreground">
            {body}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
