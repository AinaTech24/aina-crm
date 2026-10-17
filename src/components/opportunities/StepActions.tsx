"use client";

/**
 * The current step's actions on an opportunity card — what each step asks
 * for, as the lead journey does (lib/opportunities/steps.ts has the rules).
 * Each button opens a short pop-up with only what that step needs and the
 * next follow-up date; no notes box (the firm's rule for journey pop-ups).
 *
 * "Schedule meeting" creates the meeting through the Meetings API — the same
 * double-booking check, reminder and attendees as a meeting made there — and
 * then links it to the opportunity.
 */

import { useState } from "react";
import { CalendarClock, CalendarPlus, CheckCircle2, ChevronRight, Phone, Sparkles, UserCog } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { SelectField } from "@/components/ui/SelectField";
import { DateField } from "@/components/ui/DateField";
import { DateTimeField } from "@/components/ui/DateTimeField";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/Dialog";
import { notify } from "@/components/ui/Toast";
import { formatDate, formatMoney } from "@/lib/format";
import type { OpportunityView } from "@/lib/opportunities/journey";
import type { Staff } from "./OpportunitiesPanel";

type Action =
  | "log_call" | "schedule_meeting" | "reschedule_meeting" | "meeting_done" | "quote_shared" | "record_acceptance"
  | "assign_ops" | "order_placed"
  | "form_submitted" | "underwriting_cleared" | "policy_issued" | "executed" | "move";

type FieldKey = "on" | "outcome" | "meeting" | "assignee" | "amount" | "orderNo" | "formNo" | "policyNo";

type Spec = {
  action: Action;
  label: string;
  title: string;
  icon?: React.ReactNode;
  primary?: boolean;
  /** Moves the journey on — so the next step's gate applies. */
  moves: boolean;
  fields: FieldKey[];
  onLabel?: string;
  /** Ask for the next follow-up (not when the step ends the journey). */
  followUp: boolean;
};

const MODES: Array<[string, string]> = [["office", "At the office"], ["client_place", "At the client's place"], ["online", "Video call"], ["phone", "Phone call"]];
const OPS_TITLE: Record<string, string> = {
  mf_transaction: "Place the order",
  ins_proposal_form: "Submit the proposal form", ins_underwriting: "Track underwriting", gen_executed: "Execute the investment",
};

const istDay = (n = 0) => new Date(Date.now() + 5.5 * 36e5 + n * 864e5).toISOString().slice(0, 10);
const dayOf = (iso: string) => new Date(new Date(iso).getTime() + 5.5 * 36e5).toISOString().slice(0, 10);

/** The actions the opportunity's current step offers. */
function specsFor(o: OpportunityView): Spec[] {
  const nextName = o.next?.name ?? "";
  const ends = o.next?.key === "won";
  const assign: Spec = {
    action: "assign_ops", label: "Assign to operations", title: OPS_TITLE[o.current.key] ?? "Assign to operations",
    icon: <UserCog className="size-4" />, moves: false, fields: ["assignee"], followUp: false,
  };
  const meetingOn = !!o.meeting && ["scheduled", "confirmed", "rescheduled", "in_progress"].includes(o.meeting.status);
  switch (o.current.key) {
    case "identified":
      return [
        { action: "schedule_meeting", label: "Schedule meeting", title: "Schedule a meeting", icon: <CalendarPlus className="size-4" />, primary: true, moves: true, fields: ["meeting"], followUp: true },
        { action: "log_call", label: "Log call", title: "Log a call", icon: <Phone className="size-4" />, moves: true, fields: ["on", "outcome"], onLabel: "Called on", followUp: true },
      ];
    case "discussion":
      return meetingOn
        ? [
            { action: "meeting_done", label: "Meeting done", title: "Meeting done", icon: <CheckCircle2 className="size-4" />, primary: true, moves: true, fields: ["on"], onLabel: "Held on", followUp: true },
            { action: "reschedule_meeting", label: "Reschedule", title: "Reschedule the meeting", icon: <CalendarClock className="size-4" />, moves: false, fields: ["meeting"], followUp: true },
          ]
        : [
            { action: "meeting_done", label: "Meeting done", title: "Meeting done", icon: <CheckCircle2 className="size-4" />, primary: true, moves: true, fields: ["on"], onLabel: "Held on", followUp: true },
            { action: "schedule_meeting", label: "Schedule meeting", title: "Schedule a meeting", icon: <CalendarPlus className="size-4" />, moves: false, fields: ["meeting"], followUp: true },
            { action: "log_call", label: "Log call", title: "Log a call", icon: <Phone className="size-4" />, moves: false, fields: ["on", "outcome"], onLabel: "Called on", followUp: true },
          ];
    case "proposal":
      return [{ action: "quote_shared", label: "Quote shared outside the CRM", title: "Quote shared", moves: true, fields: ["on"], onLabel: "Shared on", followUp: true }];
    case "accepted":
      return [{ action: "record_acceptance", label: "Client accepted", title: "Client accepted", icon: <CheckCircle2 className="size-4" />, primary: true, moves: true, fields: ["on"], onLabel: "Accepted on", followUp: true }];
    case "mf_transaction":
      return [{ action: "order_placed", label: "Order placed", title: "Order placed", icon: <CheckCircle2 className="size-4" />, primary: true, moves: true, fields: ["amount", "on", "orderNo"], onLabel: "Placed on", followUp: true }, assign];
    case "ins_proposal_form":
      return [{ action: "form_submitted", label: "Proposal form submitted", title: "Proposal form submitted", icon: <CheckCircle2 className="size-4" />, primary: true, moves: true, fields: ["formNo", "on"], onLabel: "Submitted on", followUp: true }, assign];
    case "ins_underwriting":
      return [{ action: "underwriting_cleared", label: "Underwriting cleared", title: "Underwriting cleared", icon: <CheckCircle2 className="size-4" />, primary: true, moves: true, fields: ["on"], onLabel: "Cleared on", followUp: true }, assign];
    case "ins_issued":
      return [{ action: "policy_issued", label: "Policy issued", title: "Policy issued", icon: <Sparkles className="size-4" />, primary: true, moves: true, fields: ["policyNo", "on"], onLabel: "Issued on", followUp: false }];
    case "gen_executed":
      return [{ action: "executed", label: "Executed", title: "Executed", icon: <Sparkles className="size-4" />, primary: true, moves: true, fields: ["on"], onLabel: "Executed on", followUp: false }, assign];
    case "txn_review":
      return [];
    default:
      return o.next
        ? [{ action: "move", label: ends ? "Mark won" : `Move to: ${nextName}`, title: ends ? "Mark won" : `Move to: ${nextName}`,
             icon: ends ? <Sparkles className="size-4" /> : <ChevronRight className="size-4" />, primary: true, moves: true,
             fields: ["on"], onLabel: "Done on", followUp: !ends }]
        : [];
  }
}

export function StepActions({ o, staff, gateOpen, onChange }: {
  o: OpportunityView; staff: Staff[]; gateOpen: boolean; onChange: (v: OpportunityView | undefined) => void;
}) {
  const [open, setOpen] = useState<Spec | null>(null);
  const specs = specsFor(o);
  if (!specs.length) return null;
  return (
    <>
      {specs.map((s) => (
        <Button key={s.action} size="sm" variant={s.primary ? "primary" : "secondary"} icon={s.icon}
          disabled={s.moves && gateOpen} onClick={() => setOpen(s)}>
          {s.label}
        </Button>
      ))}
      {open && <StepDialog o={o} spec={open} staff={staff} onClose={() => setOpen(null)}
        onDone={(v) => { setOpen(null); onChange(v); }} />}
    </>
  );
}

function StepDialog({ o, spec, staff, onClose, onDone }: {
  o: OpportunityView; spec: Spec; staff: Staff[]; onClose: () => void; onDone: (v: OpportunityView) => void;
}) {
  const today = istDay();
  const has = (k: FieldKey) => spec.fields.includes(k);
  const defaultFollowUp = o.followUpAt && dayOf(o.followUpAt) > today ? dayOf(o.followUpAt) : istDay(2);
  const [on, setOn] = useState(today);
  const [outcome, setOutcome] = useState<"spoke" | "no_answer">("spoke");
  const [meetingAt, setMeetingAt] = useState(() => {
    const base = o.meeting ? new Date(o.meeting.at) : new Date(Date.now() + 864e5);
    if (!o.meeting) base.setHours(11, 0, 0, 0);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${base.getFullYear()}-${pad(base.getMonth() + 1)}-${pad(base.getDate())}T${pad(base.getHours())}:${pad(base.getMinutes())}`;
  });
  const [mode, setMode] = useState(o.meeting?.mode ?? "office");
  const [assigneeId, setAssigneeId] = useState("");
  const [dueOn, setDueOn] = useState(istDay(2));
  const [amount, setAmount] = useState(o.expectedValue ? String(o.expectedValue) : "");
  const [orderNo, setOrderNo] = useState("");
  const [formNo, setFormNo] = useState("");
  const [policyNo, setPolicyNo] = useState("");
  // A meeting's day is the follow-up unless another is picked (steps.ts).
  const [followUpOn, setFollowUpOn] = useState(has("meeting") ? "" : defaultFollowUp);
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);
  const noAnswer = has("outcome") && outcome === "no_answer";

  async function step(extra: Record<string, unknown>) {
    const res = await fetch(`/api/opportunities/${o.id}/step`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: spec.action, followUpOn: spec.followUp && followUpOn ? followUpOn : null, ...extra }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      notify.error(j.error ?? "Could not save");
      if (j.opportunity) onDone(j.opportunity);
      return;
    }
    notify.success(j.moved
      ? (j.stage === "won" ? "Marked won" : j.skipped?.length ? `Moved on — ${j.skipped.length} step${j.skipped.length === 1 ? "" : "s"} already on file` : "Moved on")
      : "Saved");
    onDone(j.opportunity);
  }

  async function save(force = false) {
    if (noAnswer && !followUpOn) return notify.error("Pick when to try again.");
    if (has("assignee") && !assigneeId) return notify.error("Pick who does it.");
    if (has("amount") && !(Number(amount) > 0)) return notify.error("Enter the amount.");
    if (has("policyNo") && !policyNo.trim()) return notify.error("Enter the policy number.");
    setBusy(true);
    try {
      if (has("meeting")) {
        const when = new Date(meetingAt);
        if (Number.isNaN(when.getTime()) || when.getTime() < Date.now() - 5 * 6e4) return notify.error("Pick a date and time from now on.");
        let meetingId = o.meeting?.id ?? null;
        if (spec.action === "reschedule_meeting" && meetingId) {
          const r = await fetch(`/api/review-meetings/${meetingId}`, {
            method: "PATCH", headers: { "content-type": "application/json" },
            body: JSON.stringify({ meetingDate: when.toISOString(), meetingMode: mode }),
          });
          if (!r.ok) return notify.error((await r.json().catch(() => ({}))).error ?? "Could not move the meeting");
        } else {
          const r = await fetch(`/api/review-meetings`, {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({
              investorId: o.investorId, category: "new", meetingType: "new_investment_discussion",
              subject: `${o.productLabel} — discussion`, meetingDate: when.toISOString(), durationMinutes: 30,
              meetingMode: mode, force,
            }),
          });
          const j = await r.json().catch(() => ({}));
          if (r.status === 409 && j.error === "rm_conflict") { setConflict(true); return; }
          if (!r.ok) return notify.error(j.error ?? "Could not schedule the meeting");
          meetingId = j.id;
        }
        await step({ meetingId });
        return;
      }
      await step({
        on: has("on") ? on : null,
        outcome: has("outcome") ? outcome : null,
        assigneeId: has("assignee") ? assigneeId : null,
        dueOn: has("assignee") ? dueOn : null,
        amount: has("amount") ? Number(amount) : null,
        orderNo: has("orderNo") ? orderNo.trim() : null,
        formNo: has("formNo") ? formNo.trim() : null,
        policyNo: has("policyNo") ? policyNo.trim() : null,
      });
    } finally {
      setBusy(false);
    }
  }

  const text = (label: string, value: string, set: (v: string) => void, opts: { required?: boolean; numeric?: boolean; mono?: boolean } = {}) => (
    <Field label={label} required={opts.required} optional={!opts.required}>
      {(id, d) => (
        <input id={id} aria-describedby={d} value={value} inputMode={opts.numeric ? "decimal" : undefined}
          onChange={(e) => set(opts.numeric ? e.target.value.replace(/[^0-9.]/g, "") : e.target.value)}
          className={`input-base w-full${opts.mono ? " font-mono uppercase" : ""}`} />
      )}
    </Field>
  );

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{spec.title} — {o.productLabel}</DialogTitle>
        </DialogHeader>
        <div className="mt-4 space-y-3">
          {has("meeting") && (<>
            <Field label="Date and time" required>
              {(id) => <DateTimeField id={id} aria-label="Meeting date and time" value={meetingAt} onChange={(e) => { setMeetingAt(e.target.value); setConflict(false); }} min={today} />}
            </Field>
            <Field label="Where" required>
              {(id, d) => (
                <SelectField id={id} aria-describedby={d} value={mode} onChange={(e) => setMode(e.target.value)} className="w-full">
                  {MODES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </SelectField>
              )}
            </Field>
            {conflict && (
              <p className="rounded-md bg-warning/10 px-3 py-2 text-xs text-warning-foreground">
                The RM already has a meeting at that time. Pick another time, or schedule it anyway.
              </p>
            )}
          </>)}
          {has("outcome") && (
            <Field label="Outcome" required>
              {(id, d) => (
                <SelectField id={id} aria-describedby={d} value={outcome} onChange={(e) => setOutcome(e.target.value as "spoke" | "no_answer")} className="w-full">
                  <option value="spoke">Spoke to the client</option>
                  <option value="no_answer">No answer</option>
                </SelectField>
              )}
            </Field>
          )}
          {has("assignee") && (<>
            <Field label="Who does it" required>
              {(id, d) => (
                <SelectField id={id} aria-describedby={d} value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className="w-full" placeholder="Pick a person" searchable>
                  <option value="">Pick a person</option>
                  {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </SelectField>
              )}
            </Field>
            <Field label="Due on" required>
              {(id, d) => <DateField id={id} aria-describedby={d} value={dueOn} onChange={(e) => setDueOn(e.target.value)} min={today} />}
            </Field>
          </>)}
          {has("amount") && text("Amount (₹)", amount, setAmount, { required: true, numeric: true })}
          {has("orderNo") && text("Order number", orderNo, setOrderNo, { mono: true })}
          {has("formNo") && text("Proposal form number", formNo, setFormNo, { mono: true })}
          {has("policyNo") && text("Policy number", policyNo, setPolicyNo, { required: true, mono: true })}
          {has("on") && (
            <Field label={spec.onLabel ?? "Date"} required>
              {(id, d) => <DateField id={id} aria-describedby={d} value={on} onChange={(e) => setOn(e.target.value)} max={today} />}
            </Field>
          )}
          {spec.followUp && (
            <Field label={noAnswer ? "Try again on" : "Next follow-up"} required={noAnswer} optional={!noAnswer}
              hint={has("meeting") && !followUpOn ? "The meeting day, unless you pick another." : undefined}>
              {(id, d) => <DateField id={id} aria-describedby={d} value={followUpOn} onChange={(e) => setFollowUpOn(e.target.value)} min={today} />}
            </Field>
          )}
          {has("amount") && o.expectedValue != null && Number(amount) > 0 && Number(amount) !== o.expectedValue && (
            <p className="text-xs text-muted-foreground">Expected was {formatMoney(o.expectedValue)}.</p>
          )}
          {spec.action === "reschedule_meeting" && o.meeting && (
            <p className="text-xs text-muted-foreground">Now on {formatDate(o.meeting.at, "dateTime")}.</p>
          )}
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Cancel</Button>
          {conflict && <Button loading={busy} onClick={() => save(true)}>Schedule anyway</Button>}
          <Button variant="primary" loading={busy} onClick={() => save(false)}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
