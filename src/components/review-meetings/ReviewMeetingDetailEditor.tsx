"use client";

/**
 * Detail / edit pane for a single review meeting.
 *
 * Sections:
 *   - Status updater (7 states)
 *   - Discussion points / agenda
 *   - Meeting notes
 *   - Action items (add / remove rows; on save → server fans out to tasks)
 *   - Attachments (URL-pasted; in a future turn we add a real S3 upload)
 *   - Next review date
 *
 * "Mark completed" runs the full automation chain server-side:
 *   - sets investor.lastReviewAt + nextReviewAt
 *   - creates one task per action item
 *   - creates a "write up your notes" task if notes are empty
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save, Plus, Trash2, CheckCircle2, X, Sparkles } from "lucide-react";

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
  rescheduled: "bg-slate-50 text-slate-700",
  cancelled: "bg-gray-50 text-gray-700",
  no_show: "bg-rose-50 text-rose-700",
};

type ActionItem = { title: string; dueAt?: string; taskId?: string };
type Attachment = { name: string; url: string };

export function ReviewMeetingDetailEditor({
  meeting,
  investorName,
}: {
  meeting: any;
  investorName: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<string>(meeting.status);
  const [discussion, setDiscussion] = useState(meeting.discussionPoints ?? "");
  const [notes, setNotes] = useState(meeting.meetingNotes ?? "");
  const [items, setItems] = useState<ActionItem[]>(
    (meeting.actionItems as ActionItem[] | null) ?? []
  );
  const [atts, setAtts] = useState<Attachment[]>(
    (meeting.attachments as Attachment[] | null) ?? []
  );
  const [nextReview, setNextReview] = useState(
    meeting.nextReviewDate ? String(meeting.nextReviewDate).slice(0, 10) : defaultNextReview()
  );
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // AI summary state
  const [aiBusy, setAiBusy] = useState(false);
  const [aiPreview, setAiPreview] = useState<null | {
    summary: string;
    keyPoints: string[];
    decisions: string[];
    actionItems: Array<{ title: string; owner?: string; dueHint?: string }>;
    nextSteps: string[];
  }>(null);
  const [aiErr, setAiErr] = useState<string | null>(null);

  async function runAiSummary() {
    setAiBusy(true);
    setAiErr(null);
    setAiPreview(null);
    try {
      const res = await fetch("/api/ai/meeting-summary", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          notes,
          agenda: discussion || undefined,
          meetingType: meeting.meetingType,
          durationMinutes: meeting.durationMinutes
            ? Number(meeting.durationMinutes)
            : undefined,
          clientName: investorName,
        }),
      });
      const j = await res.json();
      if (!res.ok) {
        setAiErr(j.error ?? `AI failed (${res.status})`);
        return;
      }
      setAiPreview(j);
    } catch (e: any) {
      setAiErr(e?.message ?? "AI request failed");
    } finally {
      setAiBusy(false);
    }
  }

  function acceptAiSummary() {
    if (!aiPreview) return;
    // Replace notes with the AI-formatted summary block.
    const formatted = [
      aiPreview.summary,
      aiPreview.keyPoints.length
        ? "\n\nKey points:\n" + aiPreview.keyPoints.map((p) => `  • ${p}`).join("\n")
        : "",
      aiPreview.decisions.length
        ? "\n\nDecisions:\n" + aiPreview.decisions.map((p) => `  • ${p}`).join("\n")
        : "",
      aiPreview.nextSteps.length
        ? "\n\nNext steps:\n" + aiPreview.nextSteps.map((p) => `  • ${p}`).join("\n")
        : "",
    ]
      .filter(Boolean)
      .join("");
    setNotes(formatted.trim());
    // Append action items to the existing list (don't replace — preserves
    // anything the RM already typed).
    if (aiPreview.actionItems.length) {
      setItems((prev) => [
        ...prev,
        ...aiPreview.actionItems.map((a) => ({ title: a.title })),
      ]);
    }
    setAiPreview(null);
    setOk("AI summary applied — review + save when ready.");
  }

  function addItem() {
    setItems((s) => [...s, { title: "" }]);
  }
  function patchItem(i: number, k: keyof ActionItem, v: string) {
    setItems((s) => s.map((it, idx) => (idx === i ? { ...it, [k]: v } : it)));
  }
  function removeItem(i: number) {
    setItems((s) => s.filter((_, idx) => idx !== i));
  }

  function addAttachment() {
    setAtts((s) => [...s, { name: "", url: "" }]);
  }
  function patchAttachment(i: number, k: keyof Attachment, v: string) {
    setAtts((s) => s.map((it, idx) => (idx === i ? { ...it, [k]: v } : it)));
  }
  function removeAttachment(i: number) {
    setAtts((s) => s.filter((_, idx) => idx !== i));
  }

  async function save(overrideStatus?: string) {
    setBusy(true);
    setErr(null);
    setOk(null);
    try {
      const payload: any = {
        status: overrideStatus ?? status,
        discussionPoints: discussion || undefined,
        meetingNotes: notes || undefined,
        actionItems: items.filter((i) => i.title.trim().length > 0),
        attachments: atts.filter((a) => a.url.trim().length > 0),
        nextReviewDate: nextReview || undefined,
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
      if (overrideStatus === "completed" || j.completed) {
        setStatus("completed");
        setOk(
          `Marked completed · action items became tasks · ${investorName}'s next review set to ${nextReview}.`
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
          <label className="text-xs font-semibold text-muted-foreground">Status</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className={`chip ${STATUS_TONE[status] ?? ""} font-medium border-0 outline-none cursor-pointer pr-1`}
          >
            {STATUSES.map(([k, l]) => (
              <option key={k} value={k} className="bg-white text-foreground">
                {l}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
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

      {/* Discussion points */}
      <div className="card-surface p-5 space-y-2">
        <h3 className="font-semibold">Discussion points (agenda)</h3>
        <textarea
          value={discussion}
          onChange={(e) => setDiscussion(e.target.value)}
          rows={3}
          placeholder="What you plan to cover with the client…"
          className="input-base"
        />
      </div>

      {/* Meeting notes */}
      <div className="card-surface p-5 space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Meeting notes</h3>
          <button
            onClick={runAiSummary}
            disabled={aiBusy || notes.trim().length < 20}
            title={
              notes.trim().length < 20
                ? "Write at least 20 chars of notes first"
                : "Claude summarises your notes into key points + action items"
            }
            className="btn-ghost text-xs"
          >
            {aiBusy ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Sparkles className="size-3.5" />
            )}
            AI summarise
          </button>
        </div>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={6}
          placeholder="What was actually discussed, decisions made, mood of the client, follow-up needed…"
          className="input-base"
        />
        <p className="text-[11px] text-muted-foreground">
          When you mark this meeting completed without notes, a 24-hour high-priority "write up your notes"
          task is auto-created.
        </p>

        {aiErr && (
          <div className="border border-destructive/30 bg-destructive/5 text-destructive rounded-lg px-3 py-2 text-sm">
            {aiErr}
          </div>
        )}

        {aiPreview && (
          <div className="mt-3 border border-violet-200 bg-violet-50/60 rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-medium text-violet-900">
                <Sparkles className="size-3.5" /> AI draft (review before applying)
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setAiPreview(null)}
                  className="btn-ghost text-xs"
                >
                  <X className="size-3.5" /> Discard
                </button>
                <button onClick={acceptAiSummary} className="btn-primary text-xs">
                  <CheckCircle2 className="size-3.5" /> Apply
                </button>
              </div>
            </div>
            <div className="space-y-2 text-sm">
              <p className="text-foreground">{aiPreview.summary}</p>
              {aiPreview.keyPoints.length > 0 && (
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-violet-700 font-medium mt-2">
                    Key points
                  </div>
                  <ul className="list-disc ml-5 text-foreground">
                    {aiPreview.keyPoints.map((p, i) => (
                      <li key={i}>{p}</li>
                    ))}
                  </ul>
                </div>
              )}
              {aiPreview.decisions.length > 0 && (
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-violet-700 font-medium mt-2">
                    Decisions
                  </div>
                  <ul className="list-disc ml-5 text-foreground">
                    {aiPreview.decisions.map((p, i) => (
                      <li key={i}>{p}</li>
                    ))}
                  </ul>
                </div>
              )}
              {aiPreview.actionItems.length > 0 && (
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-violet-700 font-medium mt-2">
                    Action items — will be appended below
                  </div>
                  <ul className="list-disc ml-5 text-foreground">
                    {aiPreview.actionItems.map((a, i) => (
                      <li key={i}>
                        {a.title}
                        {a.owner && (
                          <span className="text-muted-foreground"> · {a.owner}</span>
                        )}
                        {a.dueHint && (
                          <span className="text-muted-foreground"> · {a.dueHint}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {aiPreview.nextSteps.length > 0 && (
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-violet-700 font-medium mt-2">
                    Next steps
                  </div>
                  <ul className="list-disc ml-5 text-foreground">
                    {aiPreview.nextSteps.map((p, i) => (
                      <li key={i}>{p}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            <p className="text-[11px] text-violet-700">
              AI is advisory. Edit the draft after applying — nothing saves until you hit Save above.
            </p>
          </div>
        )}
      </div>

      {/* Action items */}
      <div className="card-surface p-5 space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">
            Action items ({items.length}){" "}
            {meeting.follow_up_task_created === "true" && (
              <span className="text-xs text-emerald-600 ml-1">· tasks created ✓</span>
            )}
          </h3>
          <button onClick={addItem} className="btn-ghost text-xs">
            <Plus className="size-3.5" /> Add item
          </button>
        </div>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-3">
            None yet. Each action item you add becomes a task for the RM when this meeting is marked completed.
          </p>
        ) : (
          <ul className="space-y-2">
            {items.map((it, i) => (
              <li key={i} className="flex items-center gap-2">
                <input
                  value={it.title}
                  onChange={(e) => patchItem(i, "title", e.target.value)}
                  placeholder="e.g. Send tax-saving fund recommendation by next Tuesday"
                  className="input-base flex-1"
                />
                <input
                  type="date"
                  value={it.dueAt ?? ""}
                  onChange={(e) => patchItem(i, "dueAt", e.target.value)}
                  className="input-base w-40"
                />
                {it.taskId ? (
                  <span className="chip bg-emerald-50 text-emerald-700 text-[10px]">task ✓</span>
                ) : (
                  <button
                    onClick={() => removeItem(i)}
                    className="p-2 text-muted-foreground hover:text-rose-600 hover:bg-rose-50 rounded-md"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Attachments */}
      <div className="card-surface p-5 space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Attachments ({atts.length})</h3>
          <button onClick={addAttachment} className="btn-ghost text-xs">
            <Plus className="size-3.5" /> Add link
          </button>
        </div>
        {atts.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-3">
            Paste a link to a presentation, report, or signed document.
          </p>
        ) : (
          <ul className="space-y-2">
            {atts.map((a, i) => (
              <li key={i} className="flex items-center gap-2">
                <input
                  value={a.name}
                  onChange={(e) => patchAttachment(i, "name", e.target.value)}
                  placeholder="Display name"
                  className="input-base w-1/3"
                />
                <input
                  value={a.url}
                  onChange={(e) => patchAttachment(i, "url", e.target.value)}
                  placeholder="https://…"
                  className="input-base flex-1"
                />
                <button
                  onClick={() => removeAttachment(i)}
                  className="p-2 text-muted-foreground hover:text-rose-600 hover:bg-rose-50 rounded-md"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Next review */}
      <div className="card-surface p-5 space-y-2">
        <h3 className="font-semibold">Next review date</h3>
        <input
          type="date"
          value={nextReview}
          onChange={(e) => setNextReview(e.target.value)}
          className="input-base w-60"
        />
        <p className="text-[11px] text-muted-foreground">
          On completion, the client's <code>nextReviewAt</code> is set to this date and the
          per-tier auto-cadence recipe takes over.
        </p>
      </div>
    </div>
  );
}

function defaultNextReview(): string {
  const d = new Date();
  d.setMonth(d.getMonth() + 6); // 6-month default cadence
  return d.toISOString().slice(0, 10);
}
