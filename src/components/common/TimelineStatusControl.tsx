"use client";

/**
 * Change a task's or meeting's status straight from a record's Activity tab
 * (RecordTimeline). The status chip opens a short list; a change that needs a
 * fact first asks for it in a dialog before anything is saved:
 *
 *   Task    → Blocked     what it is waiting on (kept as a task comment)
 *           → Cancelled   the reason (kept as a task comment)
 *   Meeting → Completed   what was discussed / agreed; for a LEAD meeting also
 *                         the outcome, which moves the lead (ready → won …)
 *           → Rescheduled the new date and time, and why
 *           → Cancelled   the reason
 *
 * Everything else saves at once. A task that needs approval is sent for
 * approval instead of completing (the API's rule) and the toast says so.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Check, Loader2 } from "lucide-react";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/Dialog";
import { ThemeSelect } from "@/components/ui/ThemeSelect";
import { DateTimeField } from "@/components/ui/DateTimeField";
import { buttonClass } from "@/components/ui/button-class";
import { notify } from "@/components/ui/Toast";
import type { TimelineControl } from "@/lib/timeline";

const TASK_STATUSES: Array<[string, string]> = [
  ["open", "Open"],
  ["in_progress", "In progress"],
  ["blocked", "Blocked"],
  ["completed", "Completed"],
  ["cancelled", "Cancelled"],
];
const MEETING_STATUSES: Array<[string, string]> = [
  ["scheduled", "Scheduled"],
  ["confirmed", "Confirmed"],
  ["in_progress", "In progress"],
  ["completed", "Completed"],
  ["rescheduled", "Rescheduled"],
  ["no_show", "No show"],
  ["cancelled", "Cancelled"],
];
const OUTCOMES: Array<[string, string]> = [
  ["ready", "Ready to proceed"],
  ["more_info", "Wants more information / time"],
  ["not_ready", "Not ready right now"],
  ["not_interested", "Not interested"],
];

/** Which changes need something asked first. */
function needs(c: TimelineControl, to: string): "reason" | "complete_meeting" | "reschedule" | null {
  if (c.entity === "task") return to === "blocked" || to === "cancelled" ? "reason" : null;
  if (to === "completed") return "complete_meeting";
  if (to === "rescheduled") return "reschedule";
  if (to === "cancelled") return "reason";
  return null;
}

export function TimelineStatusControl({
  control,
  label,
  tone,
}: {
  control: TimelineControl;
  label: string;
  tone: BadgeTone;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState<{ to: string; kind: NonNullable<ReturnType<typeof needs>> } | null>(null);
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [outcome, setOutcome] = useState("");
  const [when, setWhen] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const options = control.entity === "task" ? TASK_STATUSES : MEETING_STATUSES;
  const labelOf = (k: string) => options.find(([v]) => v === k)?.[1] ?? k;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function choose(to: string) {
    setOpen(false);
    if (to === control.status) return;
    const kind = needs(control, to);
    if (kind) {
      setReason("");
      setNotes("");
      setOutcome("");
      setWhen("");
      setErr(null);
      setAsk({ to, kind });
    } else {
      void save(to, {});
    }
  }

  async function save(to: string, extra: Record<string, unknown>, comment?: string) {
    setBusy(true);
    setErr(null);
    try {
      const url = control.entity === "task" ? `/api/tasks/${control.id}` : `/api/review-meetings/${control.id}`;
      const res = await fetch(url, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: to, ...extra }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = j.error ?? `Could not change the status (${res.status}).`;
        if (ask) setErr(msg);
        else notify.error(msg, "Not changed");
        return;
      }
      // A task's reason is kept on the task as a comment, beside the rest of
      // its conversation.
      if (comment && control.entity === "task") {
        await fetch(`/api/tasks/${control.id}/comments`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ body: comment }),
        }).catch(() => {});
      }
      setAsk(null);
      if (control.entity === "task" && to === "completed" && j.approvalStatus === "pending" && j.status !== "completed") {
        notify.info("This task needs approval — it was sent for sign-off instead of being completed.", "Sent for approval");
      } else if (control.entity === "meeting" && to === "no_show") {
        notify.success("Marked as no show — a re-engage task was created for tomorrow.", "Status changed");
      } else {
        notify.success(`Now ${labelOf(to).toLowerCase()}.`, "Status changed");
      }
      router.refresh();
    } catch {
      const msg = "Could not reach the server. Try again.";
      if (ask) setErr(msg);
      else notify.error(msg, "Not changed");
    } finally {
      setBusy(false);
    }
  }

  function submitAsk() {
    if (!ask) return;
    if (ask.kind === "reason") {
      if (reason.trim().length < 3) return setErr("Please give the reason.");
      if (control.entity === "task") {
        const prefix = ask.to === "blocked" ? "Blocked — waiting on" : "Cancelled — reason";
        return void save(ask.to, {}, `${prefix}: ${reason.trim()}`);
      }
      return void save(ask.to, { outcomeNotes: `Cancelled: ${reason.trim()}` });
    }
    if (ask.kind === "complete_meeting") {
      if (control.lead && !outcome) return setErr("Pick the outcome — it moves the lead to the right stage.");
      if (notes.trim().length < 3) return setErr("Note what was discussed or agreed.");
      return void save(ask.to, { outcomeNotes: notes.trim(), ...(outcome ? { outcome } : {}) });
    }
    if (ask.kind === "reschedule") {
      const d = when ? new Date(when) : null;
      if (!d || Number.isNaN(d.getTime())) return setErr("Pick the new date and time.");
      if (d.getTime() < Date.now()) return setErr("The new time is in the past.");
      if (reason.trim().length < 3) return setErr("Please give the reason for rescheduling.");
      return void save(ask.to, { meetingDate: d.toISOString(), rescheduleReason: reason.trim() });
    }
  }

  const title =
    ask?.kind === "complete_meeting"
      ? "Complete the meeting"
      : ask?.kind === "reschedule"
        ? "Reschedule the meeting"
        : ask?.to === "blocked"
          ? "What is it waiting on?"
          : `Cancel this ${control.entity}`;

  return (
    <>
      <div className="relative inline-flex" ref={ref}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          disabled={busy}
          aria-haspopup="menu"
          aria-expanded={open}
          title="Change status"
          className="inline-flex items-center gap-0.5 rounded-full disabled:opacity-60"
        >
          <Badge raw tone={tone}>
            <span className="inline-flex items-center gap-1">
              {label}
              {busy ? <Loader2 className="size-3 animate-spin" /> : <ChevronDown className="size-3" />}
            </span>
          </Badge>
        </button>
        {open && (
          <div role="menu" className="absolute left-0 top-full z-40 mt-1 w-44 rounded-lg border border-border bg-popover p-1 shadow-lg">
            {options.map(([k, l]) => (
              <button
                key={k}
                type="button"
                role="menuitem"
                onClick={() => choose(k)}
                className="flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-xs hover:bg-secondary"
              >
                {l}
                {k === control.status && <Check className="size-3.5 text-primary" />}
              </button>
            ))}
          </div>
        )}
      </div>

      <Dialog open={!!ask} onOpenChange={(o) => !o && !busy && setAsk(null)}>
        <DialogContent>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="mt-0.5 text-xs">
            {ask ? `Status will change to ${labelOf(ask.to)}.` : ""}
          </DialogDescription>

          <div className="mt-4 space-y-3">
            {ask?.kind === "complete_meeting" && (
              <>
                <label className="block">
                  <div className="mb-1 text-xs font-medium">
                    Outcome {control.lead ? <span className="text-destructive">*</span> : <span className="font-normal text-muted-foreground">· optional</span>}
                  </div>
                  <ThemeSelect value={outcome} onChange={setOutcome} options={[["", "Select the outcome…"], ...OUTCOMES]} />
                </label>
                <label className="block">
                  <div className="mb-1 text-xs font-medium">
                    What was discussed / agreed <span className="text-destructive">*</span>
                  </div>
                  <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} maxLength={2000} autoFocus className="input-base" />
                </label>
              </>
            )}
            {ask?.kind === "reschedule" && (
              <div>
                <div className="mb-1 text-xs font-medium">
                  New date and time <span className="text-destructive">*</span>
                </div>
                <DateTimeField value={when} onChange={(e: any) => setWhen(e.target.value)} aria-label="New date and time" />
              </div>
            )}
            {(ask?.kind === "reason" || ask?.kind === "reschedule") && (
              <label className="block">
                <div className="mb-1 text-xs font-medium">
                  {ask.to === "blocked" ? "Waiting on" : "Reason"} <span className="text-destructive">*</span>
                </div>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  maxLength={500}
                  autoFocus={ask.kind === "reason"}
                  placeholder={ask.to === "blocked" ? "e.g. Client's signed form" : ""}
                  className="input-base"
                />
              </label>
            )}
            {err && (
              <div role="alert" className="text-sm text-destructive">
                {err}
              </div>
            )}
          </div>

          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" onClick={() => setAsk(null)} disabled={busy} className={buttonClass("secondary")}>
              Keep as is
            </button>
            <button type="button" onClick={submitAsk} disabled={busy} className={buttonClass("primary")}>
              {busy && <Loader2 className="size-3.5 animate-spin" />}
              Change to {ask ? labelOf(ask.to) : ""}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
