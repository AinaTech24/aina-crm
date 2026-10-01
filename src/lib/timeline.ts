/**
 * One record timeline for leads and clients.
 *
 * Both detail pages show "what has happened with this person", and until now
 * each merged its own sources in its own way: the client page joined
 * messages, tasks, tickets and meetings; the lead page joined messages, tasks
 * and the notes blob. Neither read `activities` — the calls, visits and notes
 * the "Log call / visit" button and the mobile call sync write — so the very
 * thing an RM had just logged from the page did not appear on it.
 *
 * The page turns its rows into plain `TimelineItem`s here (server side, so
 * Date and numeric columns never reach the client) and RecordTimeline draws
 * them. Sorted newest first.
 */

import { formatDate, humanise } from "@/lib/format";

export type TimelineTone = "neutral" | "success" | "warning" | "danger";

export type TimelineItem = {
  id: string;
  kind: "call" | "visit" | "note" | "message" | "email" | "task" | "meeting" | "ticket" | "other";
  /** ISO timestamp — when it happened, newest first. */
  at: string;
  title: string;
  /** What was said or done; shown under the title, whitespace kept. */
  body?: string | null;
  /** Small facts: due date, duration, who logged it. */
  meta?: string | null;
  status?: { label: string; tone: TimelineTone } | null;
  href?: string | null;
};

type Row = Record<string, any>;

const iso = (v: unknown): string | null => {
  if (v == null || v === "") return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

const CHANNEL_LABEL: Record<string, string> = { whatsapp: "WhatsApp", email: "Email", sms: "SMS" };

/** Outbound and inbound messages (the `communications` table). */
export function fromCommunications(rows: Row[]): TimelineItem[] {
  return rows.flatMap((c) => {
    const at = iso(c.createdAt);
    if (!at) return [];
    const outbound = c.direction === "outbound";
    const channel = CHANNEL_LABEL[String(c.channel)] ?? humanise(String(c.channel ?? "message"));
    const rendered = c.payload?.rendered;
    const text: string =
      (typeof rendered === "string" ? rendered : rendered?.text ?? rendered?.subject) ??
      c.inboundContent?.text ??
      "";
    const s = String(c.status ?? "");
    const status =
      s === "failed" ? { label: "Failed", tone: "danger" as const }
      : s.startsWith("skipped") ? { label: "Not sent", tone: "warning" as const }
      : s === "sent" || s === "delivered" || s === "read" ? { label: humanise(s), tone: "success" as const }
      : s ? { label: humanise(s), tone: "neutral" as const }
      : null;
    const meta = [c.templateKey ? `Template ${c.templateKey}` : null, c.statusReason ? String(c.statusReason) : null]
      .filter(Boolean)
      .join(" · ");
    return [{
      id: `comm-${c.id}`,
      kind: c.channel === "email" ? "email" : "message",
      at,
      title: `${channel} ${outbound ? "sent" : "received"}`,
      body: text ? String(text).slice(0, 240) : null,
      meta: meta || null,
      status,
    }];
  });
}

/** Tasks about the record — created, or completed, on the timeline's date. */
export function fromTasks(rows: Row[], opts?: { href?: (t: Row) => string }): TimelineItem[] {
  const now = Date.now();
  return rows.flatMap((t) => {
    const at = iso(t.createdAt);
    if (!at) return [];
    const s = String(t.status ?? "open");
    const due = t.dueAt ? new Date(t.dueAt) : null;
    const overdue = due != null && !["completed", "cancelled"].includes(s) && due.getTime() < now;
    const status =
      s === "completed" ? { label: "Completed", tone: "success" as const }
      : s === "cancelled" ? { label: "Cancelled", tone: "neutral" as const }
      : overdue ? { label: "Overdue", tone: "danger" as const }
      : { label: humanise(s), tone: "neutral" as const };
    const meta = [
      t.type ? humanise(String(t.type)) : null,
      t.priority === "high" || t.priority === "urgent" ? humanise(String(t.priority)) : null,
      due ? `Due ${formatDate(due)}` : null,
    ].filter(Boolean).join(" · ");
    return [{
      id: `task-${t.id}`,
      kind: "task",
      at,
      title: String(t.title ?? "Task"),
      body: t.description ? String(t.description) : null,
      meta: meta || null,
      status,
      href: opts?.href ? opts.href(t) : null,
    }];
  });
}

/** Service requests (tickets) raised for a client. */
export function fromServiceRequests(rows: Row[]): TimelineItem[] {
  return rows.flatMap((sr) => {
    const at = iso(sr.createdAt);
    if (!at) return [];
    const s = String(sr.status ?? "open");
    const status =
      s === "resolved" || s === "closed" ? { label: humanise(s), tone: "success" as const }
      : s === "escalated" ? { label: "Escalated", tone: "danger" as const }
      : s === "waiting_customer" ? { label: "Waiting on client", tone: "neutral" as const }
      : { label: humanise(s), tone: "neutral" as const };
    return [{
      id: `sr-${sr.id}`,
      kind: "ticket",
      at,
      title: `Ticket #${sr.ticketNo ?? "—"} · ${sr.subject ?? "Service request"}`,
      body: sr.description ? String(sr.description) : null,
      meta: sr.category ? humanise(String(sr.category)) : null,
      status,
    }];
  });
}

/** Review meetings, scheduled or held. */
export function fromMeetings(rows: Row[]): TimelineItem[] {
  return rows.flatMap((m) => {
    const at = iso(m.meetingDate);
    if (!at) return [];
    const s = String(m.status ?? "scheduled");
    const status =
      s === "completed" ? { label: "Completed", tone: "success" as const }
      : s === "cancelled" ? { label: "Cancelled", tone: "neutral" as const }
      : s === "no_show" ? { label: "No show", tone: "warning" as const }
      : { label: humanise(s), tone: "neutral" as const };
    const meta = [m.meetingMode ? humanise(String(m.meetingMode)) : null, m.durationMinutes ? `${m.durationMinutes} min` : null]
      .filter(Boolean)
      .join(" · ");
    return [{
      id: `meeting-${m.id}`,
      kind: "meeting",
      at,
      title: `Meeting · ${humanise(String(m.meetingType ?? "review"))}`,
      body: m.discussionPoints ? String(m.discussionPoints) : m.outcomeNotes ? String(m.outcomeNotes) : null,
      meta: meta || null,
      status,
    }];
  });
}

/** The interaction log — calls, visits and notes (the `activities` table). */
export function fromActivities(rows: Row[]): TimelineItem[] {
  return rows.flatMap((a) => {
    const at = iso(a.occurredAt ?? a.occurred_at);
    if (!at) return [];
    const kind = String(a.kind ?? "other");
    const direction = String(a.direction ?? "");
    const s = String(a.status ?? "");
    const title =
      kind === "call" ? (direction === "inbound" ? "Incoming call" : "Call")
      : kind === "visit" ? "Visit"
      : kind === "note" ? "Note"
      : kind === "whatsapp" ? "WhatsApp"
      : kind === "email" ? "Email"
      : kind === "sms" ? "SMS"
      : "Activity";
    const status =
      !s ? null
      : ["no_answer", "busy", "failed", "no_show"].includes(s) ? { label: humanise(s), tone: "warning" as const }
      : { label: humanise(s), tone: "neutral" as const };
    const owner = a.ownerName ?? a.owner_name;
    const duration = Number(a.durationSec ?? a.duration_sec ?? 0);
    const followup = a.nextFollowupAt ?? a.next_followup_at;
    const meta = [
      owner ? `by ${owner}` : null,
      duration > 0 ? `${Math.max(1, Math.round(duration / 60))} min` : null,
      a.locationLabel ?? a.location_label ? String(a.locationLabel ?? a.location_label) : null,
      followup ? `Follow up ${formatDate(followup)}` : null,
    ].filter(Boolean).join(" · ");
    const body = [a.subject, a.notes].filter((x) => x && String(x).trim()).join("\n");
    return [{
      id: `act-${a.id}`,
      kind: kind === "call" ? "call" : kind === "visit" ? "visit" : kind === "note" ? "note" : kind === "email" ? "email" : kind === "whatsapp" || kind === "sms" ? "message" : "other",
      at,
      title,
      body: body || null,
      meta: meta || null,
      status,
    }];
  });
}

const NOTE_TITLE: Record<string, string> = {
  call: "Call logged", meeting: "Meeting logged", email: "Email logged", whatsapp: "WhatsApp logged", note: "Note", other: "Activity logged",
};

/**
 * A lead's follow-up notes. The notes route appends one block per activity:
 * `[2026-05-24 10:30 · call · Pooja Shah]` (UTC stamp) then the note, newest
 * first, separated by `---`.
 */
export function fromLeadNotes(text: string | null | undefined): TimelineItem[] {
  if (!text) return [];
  return text.split(/\n\n---\n\n/).flatMap((block, i) => {
    const m = block.match(/^\[(.+?)\]\n([\s\S]*)$/);
    if (!m) return [];
    const header = m[1];
    const body = m[2].trim();
    const parts = header.split(" · ");
    const stamp = parts[0]?.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2})/)?.[1];
    const at = stamp ? new Date(stamp.replace(" ", "T") + ":00Z") : null;
    if (!at || Number.isNaN(at.getTime())) return [];
    const type = (parts[1] ?? "note").trim();
    const author = parts.slice(2).join(" · ").trim();
    return [{
      id: `note-${i}-${at.getTime()}`,
      kind: type === "call" ? "call" : type === "meeting" ? "meeting" : type === "email" ? "email" : type === "whatsapp" ? "message" : "note",
      at: at.toISOString(),
      title: NOTE_TITLE[type] ?? "Activity logged",
      body: body || null,
      meta: author ? `by ${author}` : null,
    }];
  });
}

/**
 * Merge, newest first. A note block and an activity row that carry the same
 * text within two minutes of each other are one event logged into both
 * stores (the lead notes route mirrors into the interaction log); the
 * activity row is kept, as it also knows who logged it and the outcome.
 */
export function mergeTimeline(...groups: TimelineItem[][]): TimelineItem[] {
  const all = groups.flat();
  const activities = all.filter((i) => i.id.startsWith("act-"));
  const out = all.filter((i) => {
    if (!i.id.startsWith("note-") || !i.body) return true;
    const t = Date.parse(i.at);
    return !activities.some(
      (a) => a.body && a.body.trim() === i.body!.trim() && Math.abs(Date.parse(a.at) - t) < 120_000
    );
  });
  return out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}
