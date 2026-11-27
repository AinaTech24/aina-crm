/**
 * Turns the raw rows the `tasks_record_history` trigger writes (migration 0284:
 * `{ "<column>": { from, to } }`) into the lines the task Timeline shows —
 * "Due Date  08 Oct 2026 → 10 Dec 2026". Pure: no database, no React, so the
 * wording and the India-time formatting are tested on their own.
 *
 * Names behind ids (assignee, approver, client, lead, blocking task…) arrive
 * through `lookups`; the loader (lib/tasks/history.ts) fetches them in one go.
 */

export type RawChange = { from: unknown; to: unknown };

export type TimelineLookups = {
  /** user id → name */
  users: Map<string, string>;
  /** client / lead / task / service-request id → display name */
  records: Map<string, string>;
};

export type ChangeLine = {
  field: string;
  label: string;
  /** The old value as text; null = was blank. Unused for `lines` and `event` kinds. */
  from: string | null;
  /** The new value as text; null = now blank. */
  to: string | null;
  /** "set": plain field; "event": a whole-task event (Trash); "lines": a list diff (action points); "comment": a comment added / edited / deleted. */
  kind: "set" | "event" | "lines" | "comment" | "attachment";
  /** Action points: one sentence per item that changed. */
  lines?: string[];
  /** Comments: what happened to it. `from` / `to` carry the text before / after. Attachments: "added" / "removed", the file in `to` / `from`. */
  action?: "added" | "edited" | "deleted" | "removed";
};

const TZ = "Asia/Kolkata";

const FIELD_ORDER = [
  "title", "description", "remarks", "type", "department", "priority", "status", "assignee_id", "collaborator_ids",
  "entry_date", "due_at", "sla_due_at", "remind_at", "completed_at",
  "requires_approval", "approval_status", "approval_note", "approved_by",
  "estimate_minutes", "blocked_by_task_id", "recurrence", "recurrence_until",
  "related_investor_id", "related_lead_id", "related_service_request_id", "related_meeting_id",
  "tags", "checklist", "deleted_at",
];

export const FIELD_LABELS: Record<string, string> = {
  title: "Title",
  description: "Description",
  remarks: "Remarks",
  type: "Task Type",
  department: "Department",
  priority: "Priority",
  status: "Status",
  assignee_id: "Assigned To",
  collaborator_ids: "Collaborators",
  entry_date: "Entry Date",
  due_at: "Due Date",
  sla_due_at: "SLA Due Date",
  remind_at: "Reminder",
  completed_at: "Closed Date",
  requires_approval: "Requires Approval",
  approval_status: "Approval Status",
  approval_note: "Approval Note",
  approved_by: "Approved By",
  estimate_minutes: "Estimated Time",
  blocked_by_task_id: "Blocked By",
  recurrence: "Repeats",
  recurrence_until: "Repeat Until",
  related_investor_id: "Client",
  related_lead_id: "Lead",
  related_service_request_id: "Service Request",
  related_meeting_id: "Meeting",
  tags: "Tags",
  checklist: "Action Points",
  deleted_at: "Task",
};

const ENUM_LABELS: Record<string, Record<string, string>> = {
  status: { open: "Open", in_progress: "In Progress", blocked: "Blocked", completed: "Completed", cancelled: "Cancelled" },
  priority: { low: "Low", normal: "Normal", high: "High", urgent: "Urgent" },
  approval_status: { pending: "Pending", approved: "Approved", rejected: "Rejected" },
};

const USER_FIELDS = new Set(["assignee_id", "approved_by"]);
const RECORD_FIELDS = new Set(["related_investor_id", "related_lead_id", "related_service_request_id", "related_meeting_id", "blocked_by_task_id"]);
const DATE_FIELDS = new Set(["entry_date", "recurrence_until"]);
const DATETIME_FIELDS = new Set(["due_at", "sla_due_at", "remind_at", "completed_at"]);
const TEXT_FIELDS = new Set(["title", "description", "remarks", "approval_note"]);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-06-17" → "17 Jun 2026" (no time zone maths: it is already a calendar day). */
export function formatDay(v: unknown): string | null {
  const m = typeof v === "string" ? /^(\d{4})-(\d{2})-(\d{2})/.exec(v) : null;
  if (!m) return null;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

/** An instant → "10 Dec 2026" when it sits at midnight India time, else "10 Dec 2026, 3:30 pm". */
export function formatInstant(v: unknown): string | null {
  if (typeof v !== "string" && !(v instanceof Date)) return null;
  const d = new Date(v as string);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-IN", {
    timeZone: TZ, day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const day = `${get("day")} ${get("month")} ${get("year")}`;
  const hour24 = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
  if (hour24 === "00:00") return day;
  return `${day}, ${get("hour")}:${get("minute")} ${get("dayPeriod").toLowerCase()}`;
}

/**
 * A due date is picked as a DAY, and the screen stores it at midnight UTC (or, from
 * an older client, midnight India time). Read as an India instant that is "5:30 am",
 * which the task screen never shows — so a day-only value is shown as the day.
 */
export function formatDue(v: unknown): string | null {
  if (typeof v !== "string" && !(v instanceof Date)) return null;
  const d = new Date(v as string);
  if (Number.isNaN(d.getTime())) return null;
  if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0) return formatDay(d.toISOString());
  return formatInstant(d);
}

function humanise(v: string): string {
  const s = v.replace(/[_-]+/g, " ").trim();
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function clip(s: string, max = 240): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

function minutesText(n: number): string {
  if (n < 60) return `${n} min`;
  const h = Math.floor(n / 60), m = n % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

const blank = (v: unknown) => v == null || v === "" || (Array.isArray(v) && v.length === 0);

/** One value as the text shown in the timeline; null = blank. */
export function formatValue(field: string, v: unknown, lookups: TimelineLookups): string | null {
  if (blank(v)) return null;
  if (ENUM_LABELS[field]) return ENUM_LABELS[field][String(v)] ?? humanise(String(v));
  if (USER_FIELDS.has(field)) return lookups.users.get(String(v)) ?? "a removed user";
  if (field === "collaborator_ids" && Array.isArray(v)) {
    return v.map((id) => lookups.users.get(String(id)) ?? "a removed user").join(", ");
  }
  if (RECORD_FIELDS.has(field)) return lookups.records.get(String(v)) ?? "a record that is no longer available";
  if (DATE_FIELDS.has(field)) return formatDay(v) ?? String(v);
  if (field === "due_at" || field === "sla_due_at") return formatDue(v) ?? String(v);
  if (DATETIME_FIELDS.has(field)) return formatInstant(v) ?? String(v);
  if (field === "requires_approval") return v ? "Yes" : "No";
  if (field === "estimate_minutes") return typeof v === "number" ? minutesText(v) : String(v);
  if (field === "tags") return Array.isArray(v) ? v.map(String).join(", ") : String(v);
  if (TEXT_FIELDS.has(field)) return clip(String(v));
  if (field === "type" || field === "department" || field === "recurrence") return humanise(String(v));
  return clip(typeof v === "object" ? JSON.stringify(v) : String(v));
}

// ── Action points ──────────────────────────────────────────────────────────
type Item = {
  id?: string; text?: string; done?: boolean; status?: string; actionDate?: string | null;
  remark?: string; assigneeId?: string | null; assigneeName?: string | null;
};
const SUB_STATUS: Record<string, string> = {
  not_started: "Not started", in_progress: "In progress", completed: "Completed", assigned_to_other: "Assigned to other",
};
const subStatus = (i: Item) => i.status ?? (i.done ? "completed" : "not_started");
const q = (s: string | undefined) => `“${clip(s ?? "an action point", 80)}”`;

/** One sentence per action point that was added, removed or changed. */
export function describeChecklist(from: unknown, to: unknown, lookups: TimelineLookups): string[] {
  const a: Item[] = Array.isArray(from) ? (from as Item[]) : [];
  const b: Item[] = Array.isArray(to) ? (to as Item[]) : [];
  const before = new Map(a.filter((i) => i?.id).map((i) => [i.id as string, i]));
  const after = new Map(b.filter((i) => i?.id).map((i) => [i.id as string, i]));
  const out: string[] = [];
  for (const [id, i] of after) {
    const o = before.get(id);
    if (!o) { out.push(`Added ${q(i.text)}`); continue; }
    if ((o.text ?? "") !== (i.text ?? "")) out.push(`Renamed ${q(o.text)} to ${q(i.text)}`);
    if (subStatus(o) !== subStatus(i)) out.push(`${q(i.text)} marked ${SUB_STATUS[subStatus(i)] ?? humanise(subStatus(i))}`);
    if ((o.assigneeId ?? null) !== (i.assigneeId ?? null)) {
      const who = i.assigneeId ? (lookups.users.get(i.assigneeId) ?? i.assigneeName ?? "a team member") : null;
      out.push(who ? `${q(i.text)} assigned to ${who}` : `${q(i.text)} no longer assigned`);
    }
    if ((o.actionDate ?? null) !== (i.actionDate ?? null)) {
      out.push(`${q(i.text)} action date ${i.actionDate ? `set to ${formatDay(i.actionDate) ?? i.actionDate}` : "cleared"}`);
    }
    if ((o.remark ?? "") !== (i.remark ?? "")) out.push(`Remark ${i.remark ? "updated" : "cleared"} on ${q(i.text)}`);
  }
  for (const [id, i] of before) if (!after.has(id)) out.push(`Removed ${q(i.text)}`);
  return out;
}

/** A comment event (migration 0286): `changes.comment` = { from, to } text. */
export function describeComment(
  event: "comment_added" | "comment_edited" | "comment_deleted",
  changes: Record<string, RawChange> | null | undefined,
): ChangeLine[] {
  const c = changes?.comment ?? { from: null, to: null };
  const text = (v: unknown) => (blank(v) ? null : clip(String(v), 400));
  const action = event === "comment_added" ? "added" : event === "comment_edited" ? "edited" : "deleted";
  return [{ field: "comment", label: "Comment", from: text(c.from), to: text(c.to), kind: "comment", action }];
}

/** 245760 → "240 KB". */
export function formatBytes(n: unknown): string | null {
  const b = typeof n === "number" ? n : typeof n === "string" ? Number(n) : NaN;
  if (!Number.isFinite(b) || b < 0) return null;
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1).replace(/\.0$/, "")} MB`;
}

/** An attachment event (migration 0287): `changes.attachment` = { from, to }, one side { name, size, type }. */
export function describeAttachment(
  event: "attachment_added" | "attachment_removed",
  changes: Record<string, RawChange> | null | undefined,
): ChangeLine[] {
  const c = changes?.attachment ?? { from: null, to: null };
  const file = (v: unknown): string | null => {
    if (!v || typeof v !== "object") return null;
    const f = v as { name?: unknown; size?: unknown };
    const name = typeof f.name === "string" && f.name.trim() ? clip(f.name, 200) : "a file";
    const size = formatBytes(f.size);
    return size ? `${name} (${size})` : name;
  };
  const added = event === "attachment_added";
  return [{
    field: "attachment", label: "Attachment",
    from: added ? null : file(c.from), to: added ? file(c.to) : null,
    kind: "attachment", action: added ? "added" : "removed",
  }];
}

/** Every tracked change of one edit, in a fixed, readable order. */
export function describeChanges(changes: Record<string, RawChange> | null | undefined, lookups: TimelineLookups): ChangeLine[] {
  const src = changes ?? {};
  const keys = Object.keys(src).sort((x, y) => {
    const ix = FIELD_ORDER.indexOf(x), iy = FIELD_ORDER.indexOf(y);
    return (ix < 0 ? 999 : ix) - (iy < 0 ? 999 : iy);
  });
  const out: ChangeLine[] = [];
  for (const field of keys) {
    const { from, to } = src[field] ?? { from: null, to: null };
    const label = FIELD_LABELS[field] ?? humanise(field);
    if (field === "deleted_at") {
      out.push({ field, label, from: null, to: blank(to) ? "Restored from Trash" : "Moved to Trash", kind: "event" });
      continue;
    }
    if (field === "checklist") {
      const lines = describeChecklist(from, to, lookups);
      if (lines.length) out.push({ field, label, from: null, to: null, kind: "lines", lines });
      continue;
    }
    const f = formatValue(field, from, lookups), t = formatValue(field, to, lookups);
    if (f === t) continue; // e.g. two timestamps that read the same minute
    out.push({ field, label, from: f, to: t, kind: "set" });
  }
  return out;
}
