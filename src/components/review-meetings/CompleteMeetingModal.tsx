"use client";

/**
 * Complete-meeting popup — opened from a lead's blueprint when "Meeting Done"
 * needs a meeting marked completed. Loads ONLY this lead's meetings, lets the RM
 * capture what the meeting module captures — the agenda (discussion points)
 * and the next actions — and mark the scheduled meeting
 * completed inline (PATCH status=completed), without leaving the lead page.
 * Completing a meeting auto-advances the blueprint to "Meeting Done".
 *
 * Once a meeting is completed the popup asks whether to send the client the
 * minutes of meeting (MomComposer): agenda, an editable preview, attachments,
 * send. Closing it at any point still refreshes the host — the meeting IS done.
 *
 * Next actions are the meeting's action items: each one becomes a task for the
 * person it is given to (`syncActionItemTasks` on the server). The list starts
 * with the meeting's existing items and is sent back whole — the server cancels
 * the task of any item missing from it, so existing items must never be
 * dropped from the PATCH.
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Calendar, X, Loader2, CheckCircle2, ExternalLink, Plus, Trash2 } from "lucide-react";
import { SelectField } from "@/components/ui/SelectField";
import { DateField } from "@/components/ui/DateField";
import { MomComposer, type MomActionItem } from "@/components/review-meetings/MomComposer";

type ActionItem = { title: string; assigneeId?: string; dueAt?: string; taskId?: string };

type Meeting = {
  id: string;
  subject?: string | null;
  meeting_date?: string | null;
  status?: string | null;
  meeting_mode?: string | null;
  investor_name?: string | null;
  rm_id?: string | null;
  discussion_points?: string | null;
  action_items?: ActionItem[] | null;
};

type TeamMember = { id: string; name: string };

export function CompleteMeetingModal({
  open,
  leadId,
  onClose,
  onSuccess,
}: {
  open: boolean;
  leadId: string;
  onClose: () => void;
  onSuccess?: () => void;
}) {
  const [meetings, setMeetings] = useState<Meeting[] | null>(null);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [me, setMe] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  /** The meeting just completed — the MOM step runs for it. */
  const [mom, setMom] = useState<{ meeting: Meeting; agenda: string; items: MomActionItem[] } | null>(null);

  // The meeting is already completed once `mom` is set, so any way out of the
  // popup must let the host refresh the journey.
  const close = () => {
    if (mom) { setMom(null); onSuccess?.(); } else onClose();
  };

  useEffect(() => {
    if (!open) { setMeetings(null); setErr(null); setMom(null); return; }
    let alive = true;
    (async () => {
      try {
        const [res, teamRes] = await Promise.all([
          fetch(`/api/review-meetings?leadId=${leadId}`),
          fetch(`/api/review-meetings/team`),
        ]);
        const j = await res.json();
        const t = await teamRes.json().catch(() => ({}));
        if (!alive) return;
        if (!res.ok) { setErr(j.error ?? "Could not load meetings."); return; }
        setMeetings((j.meetings ?? []) as Meeting[]);
        setTeam(Array.isArray(t.team) ? t.team : []);
        setMe(t.me ?? null);
      } catch {
        if (alive) setErr("Could not load meetings.");
      }
    })();
    return () => { alive = false; };
  }, [open, leadId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!open) return null;

  // Open meetings (not yet completed/cancelled) — the ones the RM completes here.
  const openMeetings = (meetings ?? []).filter((m) => m.status === "scheduled" || m.status === "confirmed");

  // Rendered at the top of the page, not inside the host: a card with a
  // transform / filter (the lead journey) made `fixed` relative to the card,
  // so the form opened squeezed inside it.
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-start justify-center overflow-y-auto p-4 sm:p-6" onClick={close}>
      <div className="card-surface w-full max-w-2xl my-4 sm:my-8" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 p-5 border-b">
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-lg bg-brand-cyan-light grid place-items-center">
              <Calendar className="size-5 text-brand-cyan" />
            </div>
            <div>
              <h2 className="text-lg font-bold tracking-tight">{mom ? "Minutes of meeting" : "Mark meeting completed"}</h2>
              
            </div>
          </div>
          <button onClick={close} className="text-muted-foreground hover:text-foreground" aria-label="Close">
            <X className="size-5" />
          </button>
        </div>

        <div className="p-5 space-y-3">
          {err && <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">{err}</div>}

          {mom ? (
            <MomComposer
              leadId={leadId}
              meeting={mom.meeting}
              agenda={mom.agenda}
              items={mom.items}
              team={team}
              me={me}
              onFinish={close}
            />
          ) : !meetings ? (
            !err && (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Loading meetings…
              </div>
            )
          ) : openMeetings.length === 0 ? (
            <div className="text-center py-8 space-y-2">
              <div className="text-sm text-muted-foreground">No scheduled meeting found for this lead to complete.</div>
              <a href={`/dashboard/review-meetings?leadId=${leadId}`} className="btn-secondary text-xs inline-flex items-center gap-1">
                Open meetings page <ExternalLink className="size-3" />
              </a>
            </div>
          ) : (
            openMeetings.map((m) => (
              <MeetingCompleteCard
                key={m.id}
                meeting={m}
                team={team}
                defaultAssignee={m.rm_id ?? me ?? undefined}
                onDone={(agenda, items) => setMom({ meeting: m, agenda, items })}
              />
            ))
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function MeetingCompleteCard({
  meeting: m,
  team,
  defaultAssignee,
  onDone,
}: {
  meeting: Meeting;
  team: TeamMember[];
  defaultAssignee?: string;
  onDone: (agenda: string, items: MomActionItem[]) => void;
}) {
  const [agenda, setAgenda] = useState(m.discussion_points ?? "");
  const [items, setItems] = useState<ActionItem[]>(Array.isArray(m.action_items) ? m.action_items : []);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const patchItem = (i: number, k: keyof ActionItem, v: string) =>
    setItems((s) => s.map((it, idx) => (idx === i ? { ...it, [k]: v } : it)));

  async function markCompleted() {
    // A next action needs a title the server accepts (2+ characters); blank
    // rows the user added and left empty are simply dropped.
    const kept = items.filter((it) => it.taskId || it.title.trim());
    const short = kept.find((it) => it.title.trim().length < 2);
    if (short) { setErr("Each next action needs a short description (at least 2 characters)."); return; }

    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/review-meetings/${m.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status: "completed",
          discussionPoints: agenda,
          actionItems: kept.map((it) => ({
            title: it.title.trim(),
            assigneeId: it.assigneeId || undefined,
            dueAt: it.dueAt || undefined,
            taskId: it.taskId || undefined,
          })),
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(j.error ?? "Could not mark completed."); return; }
      // Completing auto-advances the blueprint to Meeting Done; the host is
      // refreshed when the MOM step (next) ends.
      onDone(agenda, kept.map((it) => ({ title: it.title.trim(), assigneeId: it.assigneeId, dueAt: it.dueAt })));
    } catch (e: any) {
      setErr(e?.message ?? "Could not mark completed.");
    } finally {
      setBusy(false);
    }
  }

  const when = m.meeting_date
    ? new Date(m.meeting_date).toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" })
    : "—";

  return (
    <div className="rounded-lg border border-border p-4 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium text-sm truncate">{m.subject || "Meeting"}</div>
          <div className="text-2xs text-muted-foreground">
            {when}{m.meeting_mode ? ` · ${m.meeting_mode}` : ""} · <span className="capitalize">{m.status}</span>
          </div>
        </div>
        <a href={`/dashboard/review-meetings/${m.id}`} className="text-2xs text-brand-cyan-deep hover:underline inline-flex items-center gap-0.5 shrink-0" title="Open full editor">
          Full editor <ExternalLink className="size-3" />
        </a>
      </div>

      <div>
        <label htmlFor={`agenda-${m.id}`} className="mb-1 block text-xs font-medium">Meeting agenda</label>
        <textarea
          id={`agenda-${m.id}`}
          value={agenda}
          onChange={(e) => setAgenda(e.target.value)}
          rows={3}
          placeholder="What was discussed with the client…"
          className="input-base text-sm w-full"
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-xs font-medium">Next actions ({items.length})</div>
          <button
            type="button"
            onClick={() => setItems((s) => [...s, { title: "", assigneeId: defaultAssignee }])}
            className="btn-ghost text-xs"
          >
            <Plus className="size-3.5" /> Add next action
          </button>
        </div>
        {items.length === 0 ? (
          <p className="text-xs text-muted-foreground">None yet. Each next action becomes a task for the person you give it to.</p>
        ) : (
          <ul className="space-y-2">
            {items.map((it, i) => (
              <li key={it.taskId ?? `new-${i}`} className="grid grid-cols-6 items-center gap-2 rounded-lg bg-secondary/50 p-2">
                <input
                  value={it.title}
                  onChange={(e) => patchItem(i, "title", e.target.value)}
                  placeholder="e.g. Send SIP recommendation"
                  aria-label="Next action"
                  className="input-base col-span-6 text-sm"
                />
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
                <div className="col-span-1 flex justify-end">
                  <button
                    type="button"
                    onClick={() => setItems((s) => s.filter((_, idx) => idx !== i))}
                    className="btn-icon text-muted-foreground hover:text-destructive"
                    aria-label={it.taskId ? "Remove (cancels its task)" : "Remove"}
                    title={it.taskId ? "Remove — its task is cancelled" : "Remove"}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="text-2xs text-muted-foreground">Each one appears in Tasks for the person assigned. No due date means a week from today.</p>
      </div>

      {err && <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">{err}</div>}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={markCompleted}
          disabled={busy}
          className="btn-primary text-sm !bg-emerald-600 hover:!bg-emerald-700 text-white font-semibold inline-flex items-center gap-1.5 disabled:opacity-50"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
          Mark completed
        </button>
      </div>
    </div>
  );
}
