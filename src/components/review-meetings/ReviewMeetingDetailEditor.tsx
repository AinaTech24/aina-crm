"use client";

/**
 * Detail / edit pane for a single review meeting.
 *
 * Sections:
 *   - Status updater (7 states)
 *   - Attendees — looked up from team, clients and leads (or a typed guest);
 *     the meeting then shows for each of them
 *   - Discussion points / agenda
 *   - Action items — each one is a task: an owner and a due date, created in
 *     the Task module on save
 *   - Attachments (URL-pasted)
 *   - Next review date
 *
 * The meeting-notes box and the Outcome card were removed at the firm's
 * request (2026-10-01).
 *
 * "Mark completed" runs the automation chain server-side:
 *   - sets investor.lastReviewAt + nextReviewAt
 */

import { MeetingAttachments, type MeetingAttachment } from "./MeetingAttachments";
import { useId, useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Save, Plus, Trash2, CheckCircle2, X, ListChecks, CalendarPlus, CalendarClock, ChevronDown, Download, ExternalLink } from "lucide-react";
import { renderReviewAgendaTemplate } from "@/lib/review-meetings/agenda";
import type { MeetingAttendee } from "@/lib/review-meetings/attendee-kinds";
import { SelectField } from "@/components/ui/SelectField";
import { DateField } from "@/components/ui/DateField";
import { AttendeePicker } from "./AttendeePicker";

/** 15-minute time slots across the day, labelled in 12-hour form. */
const TIME_SLOTS: Array<{ value: string; label: string }> = (() => {
  const out: Array<{ value: string; label: string }> = [];
  for (let h = 0; h < 24; h++) {
    for (const m of [0, 15, 30, 45]) {
      const hh = String(h).padStart(2, "0");
      const mm = String(m).padStart(2, "0");
      const ampm = h < 12 ? "AM" : "PM";
      const h12 = h % 12 === 0 ? 12 : h % 12;
      out.push({ value: `${hh}:${mm}`, label: `${h12}:${mm} ${ampm}` });
    }
  }
  return out;
})();

const STATUSES = [
  ["scheduled", "Scheduled"],
  ["confirmed", "Confirmed"],
  ["in_progress", "In progress"],
  ["completed", "Completed"],
  ["rescheduled", "Rescheduled"],
  ["cancelled", "Cancelled"],
  ["no_show", "No-show"],
] as const;

const STATUS_TONE: Record<string, string> = {
  scheduled: "bg-blue-50 text-blue-700",
  confirmed: "bg-cyan-50 text-cyan-700",
  in_progress: "bg-amber-50 text-amber-700",
  completed: "bg-emerald-50 text-emerald-700",
  rescheduled: "bg-secondary text-foreground",
  cancelled: "bg-secondary text-foreground",
  no_show: "bg-rose-50 text-rose-700",
};

const MODES = [
  ["office", "Office"],
  ["client_place", "Client place"],
  ["online", "Online"],
  ["phone", "Phone"],
] as const;

type ActionItem = { title: string; assigneeId?: string; dueAt?: string; taskId?: string };
// Links and uploaded files (lib/review-meetings/files.ts); a file has `fileId`.
type Attachment = MeetingAttachment;
type Attendee = MeetingAttendee;

/** What a looked-up attendee is, in one word. */
const KIND_LABEL: Record<string, string> = { user: "Team", client: "Client", lead: "Lead", guest: "Guest" };

/** Rows saved before the lookup carry only a role. */
const ATTENDEE_ROLE_LABELS: Record<string, string> = {
  rm: "RM (firm)",
  investor: "Investor",
  spouse: "Spouse",
  family: "Family member",
  ca: "CA / Tax advisor",
  amc_rm: "AMC RM",
  sub_distributor: "Sub-distributor",
  back_office: "Back office",
  compliance: "Compliance",
  other: "Other",
};

export function ReviewMeetingDetailEditor({
  meeting,
  investorName,
  team,
}: {
  meeting: any;
  investorName: string;
  /** Active team members — who an action item can be given to. */
  team: Array<{ id: string; name: string }>;
}) {
  const uid = useId();
  const router = useRouter();
  const [status, setStatus] = useState<string>(meeting.status);
  const [subject, setSubject] = useState<string>(meeting.subject ?? "");
  // Reschedule fields — moving the date/time/mode/location after creation.
  const initDT = splitLocal(meeting.meetingDate);
  const [meetingDay, setMeetingDay] = useState<string>(initDT.day);
  const [meetingTime, setMeetingTime] = useState<string>(initDT.time);
  const [meetingMode, setMeetingMode] = useState<string>(meeting.meetingMode ?? "office");
  const [location, setLocation] = useState<string>(meeting.locationOrLink ?? "");
  const [rescheduleReason, setRescheduleReason] = useState<string>("");
  const originalDay = initDT.day;
  const originalTime = initDT.time;
  const dateMoved = !!meetingDay && (meetingDay !== originalDay || meetingTime !== originalTime);
  // "Add to calendar" menu (Google / Outlook / .ics).
  const [calOpen, setCalOpen] = useState(false);
  const calRef = useRef<HTMLDivElement>(null);
  const [discussion, setDiscussion] = useState(meeting.discussionPoints ?? "");
  const [items, setItems] = useState<ActionItem[]>(
    (meeting.actionItems as ActionItem[] | null) ?? []
  );
  const [atts, setAtts] = useState<Attachment[]>(
    (meeting.attachments as Attachment[] | null) ?? []
  );
  const [attendees, setAttendees] = useState<Attendee[]>(
    (meeting.attendees as Attendee[] | null) ?? []
  );
  const takenAttendees = new Set(attendees.filter((a) => a.kind && a.refId).map((a) => `${a.kind}:${a.refId}`));
  // Blank unless chosen: the server then takes the client's review cadence.
  const [nextReview, setNextReview] = useState(
    meeting.nextReviewDate ? String(meeting.nextReviewDate).slice(0, 10) : ""
  );
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Close the "Add to calendar" menu on outside click / Escape.
  useEffect(() => {
    if (!calOpen) return;
    function onDown(e: MouseEvent) {
      if (calRef.current && !calRef.current.contains(e.target as Node)) setCalOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setCalOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [calOpen]);

  // Build "add to calendar" deep links from the current meeting data.
  const calLinks = (() => {
    const start = new Date(meeting.meetingDate);
    const dur = Number(meeting.durationMinutes) || 30;
    const end = new Date(start.getTime() + dur * 60_000);
    const title = (subject || `Meeting with ${investorName}`).trim();
    const details = (discussion || meeting.discussionPoints || "").trim();
    const loc = (location || meeting.locationOrLink || "").trim();
    const valid = !isNaN(start.getTime());
    const gfmt = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const google =
      `https://calendar.google.com/calendar/render?action=TEMPLATE` +
      `&text=${encodeURIComponent(title)}` +
      `&dates=${gfmt(start)}/${gfmt(end)}` +
      `&details=${encodeURIComponent(details)}` +
      `&location=${encodeURIComponent(loc)}`;
    const outlook =
      `https://outlook.live.com/calendar/0/deeplink/compose?path=/calendar/action/compose&rru=addevent` +
      `&subject=${encodeURIComponent(title)}` +
      `&startdt=${encodeURIComponent(start.toISOString())}` +
      `&enddt=${encodeURIComponent(end.toISOString())}` +
      `&body=${encodeURIComponent(details)}` +
      `&location=${encodeURIComponent(loc)}`;
    return { valid, google, outlook, ics: `/api/review-meetings/${meeting.id}/calendar.ics` };
  })();

  function addItem() {
    // A new action item starts with the meeting's RM as its owner.
    setItems((s) => [...s, { title: "", assigneeId: meeting.rmId ?? undefined }]);
  }
  function patchItem(i: number, k: keyof ActionItem, v: string) {
    setItems((s) => s.map((it, idx) => (idx === i ? { ...it, [k]: v } : it)));
  }
  function removeItem(i: number) {
    setItems((s) => s.filter((_, idx) => idx !== i));
  }


  async function save(overrideStatus?: string) {
    setBusy(true);
    setErr(null);
    setOk(null);
    try {
      const payload: any = {
        status: overrideStatus ?? status,
        subject: subject || undefined,
        discussionPoints: discussion || undefined,
        // A title under 2 characters is not a task yet; it stays off the save.
        actionItems: items
          .filter((i) => i.title.trim().length >= 2)
          .map((i) => ({ ...i, title: i.title.trim(), assigneeId: i.assigneeId || undefined, dueAt: i.dueAt || undefined })),
        // An uploaded file has no URL — keep it by its fileId.
        attachments: atts.filter((a) => a.fileId || a.url.trim().length > 0),
        attendees: attendees.filter((a) => a.name.trim().length > 0),
        nextReviewDate: nextReview || undefined,
        meetingMode: meetingMode || undefined,
        locationOrLink: location || undefined,
        // Only send a (reschedule) date + reason when the date actually changed.
        ...(dateMoved
          ? {
              meetingDate: new Date(`${meetingDay}T${meetingTime || "11:00"}:00`).toISOString(),
              rescheduleReason: rescheduleReason || undefined,
            }
          : {}),
      };
      const res = await fetch(`/api/review-meetings/${meeting.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await res.json();
      if (!res.ok) {
        setErr(j.error ?? `Save failed (${res.status})`);
        return;
      }
      // Keep what the server stored: every action item now carries its task,
      // so the next save edits those tasks instead of creating new ones.
      if (Array.isArray(j.actionItems)) setItems(j.actionItems);
      if (Array.isArray(j.attendees)) setAttendees(j.attendees);
      if (overrideStatus === "completed" || j.completed) {
        setStatus("completed");
        // Say who ELSE this covered. The review now lands on the whole
        // household, and an RM who is not told will log a duplicate meeting
        // for each member to clear their due list.
        const also = Array.isArray(j.familyMembers) ? (j.familyMembers as string[]) : [];
        const family =
          also.length === 0
            ? ""
            : ` · also reviewed ${also.length} family member${also.length === 1 ? "" : "s"}: ${
                also.slice(0, 4).join(", ")
              }${also.length > 4 ? ` +${also.length - 4} more` : ""}`;
        setOk(
          `Marked completed · ${investorName}'s next review set ${
            nextReview ? `to ${nextReview}` : "from their review cadence"
          }${family}.`
        );
      } else {
        setOk("Saved.");
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Status bar */}
      <div className="card-surface p-4 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <label htmlFor={`${uid}-status`} className="text-xs font-semibold text-muted-foreground">Status</label>
          <SelectField id={`${uid}-status`} value={status} onChange={(e) => setStatus(e.target.value)} size="sm" className="w-40">
            {STATUSES.map(([k, l]) => (
              <option key={k} value={k}>{l}</option>
            ))}
          </SelectField>
        </div>
        <div className="flex items-center gap-2">
          {/* Add to calendar — adds the event directly to Google/Outlook (opens
              the prefilled event), or downloads an .ics for Apple/other apps. */}
          <div ref={calRef} className="relative">
            <button
              type="button"
              onClick={() => setCalOpen((o) => !o)}
              className="btn-ghost text-xs"
              title="Add this meeting to your calendar"
            >
              <CalendarPlus className="size-3.5" /> Add to calendar
              <ChevronDown className={`size-3 transition-transform ${calOpen ? "rotate-180" : ""}`} />
            </button>
            {calOpen && (
              <div className="absolute right-0 top-full mt-1 z-30 w-52 rounded-lg border border-border bg-white shadow-xl p-1 text-left">
                <a
                  href={calLinks.valid ? calLinks.google : undefined}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => setCalOpen(false)}
                  className="flex items-center gap-2 rounded-md px-2.5 py-2 text-xs font-medium text-foreground/80 hover:bg-secondary"
                >
                  <CalendarPlus className="size-3.5 text-emerald-600" /> Google Calendar
                </a>
                <a
                  href={calLinks.valid ? calLinks.outlook : undefined}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => setCalOpen(false)}
                  className="flex items-center gap-2 rounded-md px-2.5 py-2 text-xs font-medium text-foreground/80 hover:bg-secondary"
                >
                  <CalendarPlus className="size-3.5 text-blue-600" /> Outlook Calendar
                </a>
                <a
                  href={calLinks.ics}
                  onClick={() => setCalOpen(false)}
                  className="flex items-center gap-2 rounded-md px-2.5 py-2 text-xs font-medium text-foreground/80 hover:bg-secondary border-t border-border mt-1 pt-2"
                >
                  <Download className="size-3.5 text-muted-foreground" /> Download .ics (Apple/other)
                </a>
              </div>
            )}
          </div>
          <a
            href={`/dashboard/review-meetings/${meeting.id}/portfolio`}
            className="btn-ghost text-xs"
            title="Open the per-folio review worksheet"
          >
            Portfolio review →
          </a>
          {status !== "completed" && (
            <button
              onClick={() => save("completed")}
              disabled={busy}
              className="btn-accent text-xs"
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
              Mark completed
            </button>
          )}
          <button onClick={() => save()} disabled={busy} className="btn-primary text-xs">
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
            Save
          </button>
        </div>
      </div>

      {ok && (
        <div className="border border-emerald-200 bg-emerald-50 text-emerald-700 rounded-lg px-3 py-2 text-sm">
          {ok}
        </div>
      )}
      {err && (
        <div className="border border-destructive/30 bg-destructive/5 text-destructive rounded-lg px-3 py-2 text-sm">
          {err}
        </div>
      )}

      {/* Subject */}
      <div className="card-surface p-5 space-y-2">
        <h3 className="font-semibold">Subject</h3>
        <input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="e.g. Q1 portfolio review + tax-saving + nominee update"
          className="input-base"
        />
      </div>

      {/* Schedule / reschedule */}
      <div className="card-surface p-5 space-y-3">
        <div className="flex items-center gap-2">
          <CalendarClock className="size-4 text-brand-cyan" />
          <h3 className="font-semibold">Schedule</h3>
          {Number(meeting.rescheduleCount ?? 0) > 0 && (
            <span className="chip bg-amber-50 text-amber-700 text-2xs">
              rescheduled {meeting.rescheduleCount}×
            </span>
          )}
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="block">
            <div className="text-2xs text-muted-foreground mb-0.5">Date</div>
            <DateField value={meetingDay} onChange={(e) => setMeetingDay(e.target.value)} size="sm" className="w-full" />
          </label>
          <label className="block">
            <div className="text-2xs text-muted-foreground mb-0.5">Time</div>
            <SelectField value={meetingTime} onChange={(e) => setMeetingTime(e.target.value)} options={TIME_SLOTS} size="sm" className="w-full" />
          </label>
          <label className="block">
            <div className="text-2xs text-muted-foreground mb-0.5">Mode</div>
            <SelectField value={meetingMode} onChange={(e) => setMeetingMode(e.target.value)} size="sm" className="w-full">
              {MODES.map(([k, l]) => (
                <option key={k} value={k}>{l}</option>
              ))}
            </SelectField>
          </label>
          <label className="block">
            <div className="text-2xs text-muted-foreground mb-0.5">Location / link</div>
            <input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Office / address / video link"
              className="input-base"
            />
          </label>
        </div>
        {dateMoved && (
          <label className="block">
            <div className="text-2xs text-amber-700 mb-0.5 font-medium">Reschedule reason</div>
            <input
              value={rescheduleReason}
              onChange={(e) => setRescheduleReason(e.target.value)}
              placeholder="Why is this being moved? (optional)"
              className="input-base"
            />
            <p className="text-2xs text-amber-600 mt-1">
              Saving moves the T-1 reminder task to the new date and logs a reschedule.
            </p>
          </label>
        )}
      </div>

      {/* Attendees — looked up from team, clients and leads */}
      <div className="card-surface p-5 space-y-3">
        <h3 className="font-semibold">Attendees ({attendees.length})</h3>
        {attendees.length > 0 && (
          <ul className="space-y-1.5">
            {attendees.map((a, i) => {
              const href = a.kind === "client" && a.refId ? `/dashboard/investors/${a.refId}`
                : a.kind === "lead" && a.refId ? `/dashboard/leads/${a.refId}` : null;
              return (
                <li key={`${a.kind ?? "x"}:${a.refId ?? a.name}:${i}`}
                  className="flex items-center justify-between gap-3 rounded-md bg-secondary/60 px-3 py-2">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="chip shrink-0 bg-card text-2xs text-muted-foreground">
                      {a.kind ? KIND_LABEL[a.kind] : ATTENDEE_ROLE_LABELS[a.role] ?? a.role}
                    </span>
                    {href ? (
                      <Link href={href} className="truncate text-sm font-medium hover:text-primary hover:underline">{a.name}</Link>
                    ) : (
                      <span className="truncate text-sm font-medium">{a.name}</span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setAttendees((p) => p.filter((_, idx) => idx !== i))}
                    className="btn-icon shrink-0 text-muted-foreground hover:text-destructive"
                    aria-label={`Remove ${a.name}`}
                  >
                    <X className="size-3.5" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <AttendeePicker taken={takenAttendees} onPick={(a) => setAttendees((p) => [...p, a])} />
        <p className="text-2xs text-muted-foreground">
          A team member added here sees this meeting in their meetings and calendar. Someone outside the CRM can be added as a guest.
        </p>
      </div>

      {/* Discussion points */}
      <div className="card-surface p-5 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold">Discussion points (agenda)</h3>
          {/* Insert the standard Network-FP review agenda (5.1). Appends when
              the field already has content so we never clobber the RM's notes. */}
          <button
            type="button"
            onClick={() => {
              const template = renderReviewAgendaTemplate();
              setDiscussion((cur: string) =>
                cur && cur.trim().length > 0 ? `${cur.trim()}\n\n${template}` : template
              );
            }}
            className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-md border border-brand-cyan/40 bg-brand-cyan-light/50 text-brand-cyan-deep px-2.5 py-1 hover:bg-brand-cyan-light"
            title="Insert the 7-question standard review agenda"
          >
            <ListChecks className="size-3.5" /> Insert standard review agenda
          </button>
        </div>
        <textarea
          value={discussion}
          onChange={(e) => setDiscussion(e.target.value)}
          rows={3}
          placeholder="What you plan to cover with the client… or click 'Insert standard review agenda' to start from the proven 7-question script."
          className="input-base"
        />
      </div>

      {/* Action items — each one is a task in the Task module */}
      <div className="card-surface p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Action items ({items.length})</h3>
          <button onClick={addItem} className="btn-ghost text-xs">
            <Plus className="size-3.5" /> Add item
          </button>
        </div>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            None yet. Each action item becomes a task for the person you give it to.
          </p>
        ) : (
          <ul className="space-y-2">
            {items.map((it, i) => (
              <li key={it.taskId ?? `new-${i}`} className="grid grid-cols-6 items-center gap-2 rounded-lg bg-secondary/50 p-2 lg:grid-cols-12">
                <input
                  value={it.title}
                  onChange={(e) => patchItem(i, "title", e.target.value)}
                  placeholder="e.g. Send tax-saving fund recommendation"
                  aria-label="Action item"
                  className="input-base col-span-6 lg:col-span-5"
                />
                {/* The spans sit on wrappers: SelectField / DateField keep only
                    unprefixed layout classes, so sm:col-span-* on them is dropped. */}
                <div className="col-span-3 min-w-0">
                  <SelectField
                    value={it.assigneeId ?? ""}
                    onChange={(e) => patchItem(i, "assigneeId", e.target.value)}
                    size="sm"
                    aria-label="Assigned to"
                    className="w-full"
                  >
                    <option value="">Assign to…</option>
                    {team.map((u) => (
                      <option key={u.id} value={u.id}>{u.name}</option>
                    ))}
                  </SelectField>
                </div>
                <div className="col-span-2 min-w-0">
                  <DateField
                    value={it.dueAt ? String(it.dueAt).slice(0, 10) : ""}
                    onChange={(e) => patchItem(i, "dueAt", e.target.value)}
                    size="sm"
                    aria-label="Due date"
                    className="w-full"
                  />
                </div>
                <div className="col-span-1 flex items-center justify-end gap-1 lg:col-span-2">
                  {it.taskId && (
                    <Link href={`/dashboard/tasks/${it.taskId}`} className="inline-flex min-h-6 items-center gap-1 rounded px-1 text-xs font-medium text-primary hover:underline">
                      Task <ExternalLink className="size-3" aria-hidden />
                    </Link>
                  )}
                  <button
                    type="button"
                    onClick={() => removeItem(i)}
                    className="btn-icon text-muted-foreground hover:text-destructive"
                    aria-label={it.taskId ? "Remove (cancels its task on save)" : "Remove"}
                    title={it.taskId ? "Remove — its task is cancelled when you save" : "Remove"}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="text-2xs text-muted-foreground">
          Saved items appear in Tasks for the person assigned. No due date means a week from today.
        </p>
      </div>

      {/* Attachments — uploaded files and links */}
      <MeetingAttachments meetingId={meeting.id} items={atts} onChange={setAtts} />

      {/* Next review */}
      <div className="card-surface p-5 space-y-2">
        <h3 className="font-semibold">Next review date</h3>
        <DateField
          value={nextReview}
          onChange={(e) => setNextReview(e.target.value)}
          size="sm"
          className="w-60"
        />
        <p className="text-2xs text-muted-foreground">
          On completion, the client's <code>nextReviewAt</code> is set to this date — or, left
          blank, from the client's review cadence.
        </p>
      </div>
    </div>
  );
}

/** ISO/Date → { day: "yyyy-mm-dd", time: "HH:mm" } in local time. */
function splitLocal(v: any): { day: string; time: string } {
  if (!v) return { day: "", time: "11:00" };
  const d = v instanceof Date ? v : new Date(v);
  if (isNaN(d.getTime())) return { day: "", time: "11:00" };
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    day: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}
