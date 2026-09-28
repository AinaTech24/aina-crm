"use client";

/**
 * §5 Today's client worklist — every due and overdue action as ONE table,
 * built for working through, not for reading.
 *
 * Order is the brief's, and it is visible: overdue first, then due today,
 * then client category (A before B before C before D), then due time. Each row
 * says WHY it sits where it does ("12 days overdue · A category"), so there is
 * no hidden score to trust.
 *
 * Quick actions appear only where they are real:
 *   · Call / WhatsApp / Email open the RM's OWN dialer, WhatsApp and mail
 *     (ContactQuickActions) — the app's compliance-safe personal channel, not
 *     the templated send pipeline — and only when a number or address exists.
 *   · Add note, Complete task and Schedule render only for a viewer holding
 *     the capability; the API behind each is still the gate.
 */

import Link from "next/link";
import { useMemo, useState } from "react";
import { CalendarPlus, CalendarClock, ExternalLink } from "lucide-react";
import type { WorkItem } from "@/lib/dashboard/my/desk";
import { ContactQuickActions } from "@/components/common/ContactQuickActions";
import { LogActivityButton } from "@/components/activities/ActivityLogger";
import { formatDate, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CompleteTaskButton } from "./CompleteTaskButton";

const ACTIVITIES: Array<{ key: WorkItem["activity"] | "all"; label: string }> = [
  { key: "all", label: "All" },
  { key: "meeting", label: "Meetings" },
  { key: "review", label: "Reviews" },
  { key: "follow_up", label: "Follow-ups" },
  { key: "proposal", label: "Proposals" },
  { key: "task", label: "Tasks" },
  { key: "query", label: "Queries" },
  { key: "sip", label: "SIP" },
  { key: "insurance", label: "Renewals" },
];
const STATUSES: Array<{ key: WorkItem["bucket"] | "all"; label: string }> = [
  { key: "all", label: "Any" },
  { key: "overdue", label: "Overdue" },
  { key: "today", label: "Due today" },
  { key: "tomorrow", label: "Tomorrow" },
];
const CATEGORIES = ["all", "A", "B", "C", "D", "none"] as const;

/** The brief's alert levels (§38). Red is spent only on critical. */
const PRIORITY: Record<WorkItem["priority"], { label: string; tone: string }> = {
  critical: { label: "Critical", tone: "bg-destructive/10 text-destructive" },
  attention: { label: "Attention", tone: "bg-warning/10 text-warning-foreground" },
  normal: { label: "Normal", tone: "bg-secondary text-secondary-foreground" },
};

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex min-h-6 items-center rounded-md px-2 py-1 text-2xs font-medium transition-colors",
        active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

type Perms = { canComplete: boolean; canNote: boolean; canSchedule: boolean };

/** Who the row is about: a link into the client or lead, or why there is none. */
function ClientCell({ i, compact = false }: { i: WorkItem; compact?: boolean }) {
  const profile = i.clientId ? `/dashboard/investors/${i.clientId}` : i.leadId ? `/dashboard/leads/${i.leadId}` : null;
  const name = i.client == null ? (
    <span className="text-xs text-muted-foreground">No client linked</span>
  ) : profile ? (
    <Link href={profile} className="font-medium hover:text-primary hover:underline">{i.client}</Link>
  ) : <span className="font-medium">{i.client}</span>;
  const meta = !i.clientId && !i.leadId ? (
    i.client != null && (
      <span title="This task is about a client outside your book. Open the task to work it.">Not in your book</span>
    )
  ) : (
    <>
      {i.category
        ? <span className="chip bg-secondary text-secondary-foreground">{i.category}</span>
        : i.clientId ? <span title="No category set for this client.">No category</span> : <span>Lead</span>}
      {i.aum != null && i.aum > 0 && <span className="tabular-nums">{formatMoney(i.aum)}</span>}
    </>
  );
  return compact ? (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs">
      {name}
      <span className="flex items-center gap-1.5 text-2xs text-muted-foreground">{meta}</span>
    </div>
  ) : (
    <>
      {name}
      <div className="mt-0.5 flex items-center gap-1.5 text-2xs text-muted-foreground">{meta}</div>
    </>
  );
}

/** The quick actions a viewer may take on this row — only the real ones. */
function RowActions({ i, perms }: { i: WorkItem; perms: Perms }) {
  const name = i.client ?? "this record";
  const subject = i.clientId
    ? { type: "investor" as const, id: i.clientId, name, phone: i.phone }
    : i.leadId ? { type: "lead" as const, id: i.leadId, name, phone: i.phone } : null;
  return (
    <span className="flex items-center justify-end gap-0.5">
      <ContactQuickActions phone={i.phone} email={i.email} show={["call", "whatsapp", "email"]} />
      {perms.canNote && subject && <LogActivityButton subject={subject} iconOnly defaultKind="note" label={`Add note — ${name}`} />}
      {perms.canComplete && i.taskId && <CompleteTaskButton taskId={i.taskId} title={i.action} />}
      {perms.canSchedule && i.meetingId && (
        <Link href={`/dashboard/review-meetings/${i.meetingId}`} aria-label="Reschedule or update the meeting" title="Reschedule / update"
              className="inline-grid size-7 place-items-center rounded text-muted-foreground hover:bg-secondary hover:text-foreground">
          <CalendarClock className="size-3.5" />
        </Link>
      )}
      {perms.canSchedule && !i.meetingId && i.clientId && (
        <Link href={`/dashboard/review-meetings/new?investorId=${i.clientId}${i.kind === "review" ? "&category=review" : ""}`}
              aria-label={`Schedule a meeting with ${name}`} title="Schedule meeting"
              className="inline-grid size-7 place-items-center rounded text-muted-foreground hover:bg-secondary hover:text-foreground">
          <CalendarPlus className="size-3.5" />
        </Link>
      )}
    </span>
  );
}

function Related({ i }: { i: WorkItem }) {
  return (
    <Link href={i.related.href} className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
      {i.related.label} <ExternalLink className="size-3" aria-hidden />
    </Link>
  );
}

export function Worklist({
  items, truncated, dayWord, canComplete, canNote, canSchedule, firstName,
}: {
  items: WorkItem[];
  truncated: boolean;
  dayWord: "today" | "tomorrow";
  canComplete: boolean;
  canNote: boolean;
  canSchedule: boolean;
  firstName: string;
}) {
  const [activity, setActivity] = useState<(typeof ACTIVITIES)[number]["key"]>("all");
  const [status, setStatus] = useState<(typeof STATUSES)[number]["key"]>("all");
  const [cat, setCat] = useState<(typeof CATEGORIES)[number]>("all");
  const [all, setAll] = useState(false);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: items.length };
    for (const i of items) c[i.activity] = (c[i.activity] ?? 0) + 1;
    return c;
  }, [items]);

  const shown = items.filter((i) =>
    (activity === "all" || i.activity === activity)
    && (status === "all" || i.bucket === status)
    && (cat === "all" || (cat === "none" ? !i.category : i.category === cat)));
  const visible = all ? shown : shown.slice(0, 20);
  const overdue = items.filter((i) => i.bucket === "overdue").length;

  return (
    <section className="card-surface p-5 sm:p-6" aria-label="Today's client worklist">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-border/60 pb-4">
        <div className="min-w-0">
          <h2 className="section-title">{dayWord === "today" ? "Today's client worklist" : "Tomorrow's client worklist"}</h2>
          <p className="section-subtitle mt-1">
            {items.length === 0
              ? `Nothing due ${dayWord} and nothing overdue.`
              : `${items.length}${truncated ? "+" : ""} action${items.length === 1 ? "" : "s"}${overdue ? ` — ${overdue} overdue` : ""}. Overdue first, then due ${dayWord}, then A → D, then time.`}
          </p>
        </div>
      </div>

      <div className="mb-3 space-y-1.5">
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Activity">
          <span className="w-16 shrink-0 text-2xs text-muted-foreground">Activity</span>
          {ACTIVITIES.filter((a) => a.key === "all" || counts[a.key]).map((a) => (
            <Chip key={a.key} active={activity === a.key} onClick={() => setActivity(a.key)}>
              {a.label}{counts[a.key] ? <span className="ml-1 tabular-nums opacity-70">{counts[a.key]}</span> : null}
            </Chip>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Status and category">
          <span className="w-16 shrink-0 text-2xs text-muted-foreground">Status</span>
          {STATUSES.filter((s) => s.key !== "tomorrow" || dayWord === "tomorrow").map((s) => (
            <Chip key={s.key} active={status === s.key} onClick={() => setStatus(s.key)}>{s.label}</Chip>
          ))}
          <span className="mx-1 h-4 w-px bg-border" aria-hidden />
          <span className="text-2xs text-muted-foreground">Category</span>
          {CATEGORIES.map((c) => (
            <Chip key={c} active={cat === c} onClick={() => setCat(c)}>
              {c === "all" ? "All" : c === "none" ? "Uncategorised" : c}
            </Chip>
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-xs text-muted-foreground">
          {items.length === 0 ? `A clear desk, ${firstName}. Nothing is due ${dayWord} and nothing is overdue.` : "Nothing matches these filters."}
        </p>
      ) : (
        <>
        {/* Phone: one card per action with its quick actions on the card. A
            table would park call / WhatsApp / complete behind a sideways
            scroll, and the brief wants every action one or two taps away. */}
        <ul className="space-y-2 md:hidden">
          {visible.map((i) => (
            <li key={i.key} className="rounded-lg border border-border p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 text-xs font-medium text-foreground">{i.action}</div>
                <span className={cn("shrink-0 text-2xs tabular-nums",
                  i.bucket === "overdue" ? "font-semibold text-destructive" : "text-muted-foreground")}>
                  {i.dueText}
                </span>
              </div>
              <div className="mt-1"><ClientCell i={i} compact /></div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-2xs text-muted-foreground">
                {i.why.length > 0 && <span>{i.why.join(" · ")}</span>}
                <Related i={i} />
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-1.5">
                  <span className={cn("chip", PRIORITY[i.priority].tone)}>{PRIORITY[i.priority].label}</span>
                  <span className="text-2xs text-muted-foreground">{i.status}</span>
                </span>
                <RowActions i={i} perms={{ canComplete, canNote, canSchedule }} />
              </div>
            </li>
          ))}
        </ul>
        <div className="table-scroll hidden md:block">
          <table className="w-full">
            <thead>
              <tr>
                <th scope="col">Client</th>
                <th scope="col">Action required · related record</th>
                <th scope="col">Due</th>
                <th scope="col">Last interaction</th>
                <th scope="col">Priority · status</th>
                <th scope="col" className="text-right">Quick action</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((i) => (
                  <tr key={i.key}>
                    <td className="py-2.5">
                      <ClientCell i={i} />
                    </td>
                    <td className="max-w-sm py-2.5">
                      <div className="text-xs font-medium text-foreground">{i.action}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-2xs text-muted-foreground">
                        {i.why.length > 0 && <span>{i.why.join(" · ")}</span>}
                        <Related i={i} />
                      </div>
                    </td>
                    <td className={cn("whitespace-nowrap py-2.5 text-xs tabular-nums",
                      i.bucket === "overdue" ? "font-semibold text-destructive" : "text-foreground")}>
                      {i.dueText}
                    </td>
                    <td className="whitespace-nowrap py-2.5 text-xs">
                      {i.lastInteraction ? formatDate(i.lastInteraction) : <span className="text-muted-foreground">Not recorded</span>}
                    </td>
                    <td className="py-2.5">
                      <span className={cn("chip", PRIORITY[i.priority].tone)}>{PRIORITY[i.priority].label}</span>
                      <div className="mt-0.5 whitespace-nowrap text-2xs text-muted-foreground">{i.status}</div>
                    </td>
                    <td className="py-2.5">
                      <RowActions i={i} perms={{ canComplete, canNote, canSchedule }} />
                    </td>
                  </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}
      {shown.length > 20 && (
        <div className="mt-3 flex justify-center">
          <button type="button" onClick={() => setAll((v) => !v)}
                  className="inline-flex min-h-6 items-center rounded-md px-3 py-1 text-xs font-medium text-primary hover:bg-accent">
            {all ? "Show the first 20" : `Show all ${shown.length}`}
          </button>
        </div>
      )}
      <p className="mt-3 text-2xs text-muted-foreground">
        Actions are CRM workflow steps only — call, schedule, complete, follow up, update. Nothing here recommends a
        product. Call, WhatsApp and email open your own phone, WhatsApp and mail.
      </p>
    </section>
  );
}
