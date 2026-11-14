/**
 * One opportunity and its journey — the app's port of the CRM's opportunity
 * card (components/opportunities/OpportunitiesPanel + StepActions +
 * LaterControls). The current step offers what that step asks for (log a
 * call, schedule the meeting, meeting done, order placed, policy issued …);
 * each pop-up asks only for what the step needs and the next follow-up — no
 * notes box (the firm's rule for journey pop-ups). The server applies the
 * compliance gates and the automatic skips; a blocked move comes back with
 * the checklist, which the card shows.
 */

import React, { useState } from "react";
import { View, Pressable, ScrollView, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { Text } from "../../components/ui/Text";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { StatusPill } from "../../components/ui/StatusPill";
import { TextField } from "../../components/ui/TextField";
import { SelectField } from "../../components/ui/SelectField";
import { Segmented } from "../../components/ui/Segmented";
import { BottomSheet } from "../../components/ui/BottomSheet";
import { DateField } from "../../components/form/DateField";
import { api, ApiError } from "../../api/client";
import { toast } from "../../lib/toast";
import { inr, fmtDate } from "../../lib/format";
import { palette, radius, spacing, fontWeight } from "../../theme/tokens";
import {
  useOpportunityWrite, istDay, istDayOf, OPPORTUNITY_LOST_REASONS,
  type OpportunityView, type Staff,
} from "./api";

type Action =
  | "log_call" | "schedule_meeting" | "reschedule_meeting" | "meeting_done" | "quote_shared" | "record_acceptance"
  | "assign_ops" | "order_placed" | "form_submitted" | "underwriting_cleared" | "policy_issued" | "executed" | "move";
type FieldKey = "on" | "outcome" | "meeting" | "assignee" | "amount" | "orderNo" | "formNo" | "policyNo";
type Spec = { action: Action; label: string; primary?: boolean; moves: boolean; fields: FieldKey[]; onLabel?: string; followUp: boolean };

const MODES = [{ value: "office", label: "At the office" }, { value: "client_place", label: "At the client's place" }, { value: "online", label: "Video call" }, { value: "phone", label: "Phone call" }];
const OPS_TITLE: Record<string, string> = {
  mf_transaction: "Place the order", ins_proposal_form: "Submit the proposal form", ins_underwriting: "Track underwriting", gen_executed: "Execute the investment",
};
const TIME_SLOTS = (() => {
  const out: { value: string; label: string }[] = [];
  for (let h = 7; h < 22; h++) for (const m of [0, 30]) {
    const hh = String(h).padStart(2, "0"), mm = String(m).padStart(2, "0");
    out.push({ value: `${hh}:${mm}`, label: `${h % 12 === 0 ? 12 : h % 12}:${mm} ${h < 12 ? "AM" : "PM"}` });
  }
  return out;
})();
const errMsg = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

/** The actions the opportunity's current step offers (web StepActions specsFor). */
function specsFor(o: OpportunityView): Spec[] {
  const ends = o.next?.key === "won";
  const assign: Spec = { action: "assign_ops", label: "Assign to operations", moves: false, fields: ["assignee"], followUp: false };
  const meetingOn = !!o.meeting && ["scheduled", "confirmed", "rescheduled", "in_progress"].includes(o.meeting.status);
  switch (o.current.key) {
    case "identified":
      return [
        { action: "schedule_meeting", label: "Schedule meeting", primary: true, moves: true, fields: ["meeting"], followUp: true },
        { action: "log_call", label: "Log call", moves: true, fields: ["on", "outcome"], onLabel: "Called on", followUp: true },
      ];
    case "discussion":
      return meetingOn
        ? [
            { action: "meeting_done", label: "Meeting done", primary: true, moves: true, fields: ["on"], onLabel: "Held on", followUp: true },
            { action: "reschedule_meeting", label: "Reschedule", moves: false, fields: ["meeting"], followUp: true },
          ]
        : [
            { action: "meeting_done", label: "Meeting done", primary: true, moves: true, fields: ["on"], onLabel: "Held on", followUp: true },
            { action: "schedule_meeting", label: "Schedule meeting", moves: false, fields: ["meeting"], followUp: true },
            { action: "log_call", label: "Log call", moves: false, fields: ["on", "outcome"], onLabel: "Called on", followUp: true },
          ];
    case "proposal":
      return [{ action: "quote_shared", label: "Quote shared outside the CRM", moves: true, fields: ["on"], onLabel: "Shared on", followUp: true }];
    case "accepted":
      return [{ action: "record_acceptance", label: "Client accepted", primary: true, moves: true, fields: ["on"], onLabel: "Accepted on", followUp: true }];
    case "mf_transaction":
      return [{ action: "order_placed", label: "Order placed", primary: true, moves: true, fields: ["amount", "on", "orderNo"], onLabel: "Placed on", followUp: true }, assign];
    case "ins_proposal_form":
      return [{ action: "form_submitted", label: "Proposal form submitted", primary: true, moves: true, fields: ["formNo", "on"], onLabel: "Submitted on", followUp: true }, assign];
    case "ins_underwriting":
      return [{ action: "underwriting_cleared", label: "Underwriting cleared", primary: true, moves: true, fields: ["on"], onLabel: "Cleared on", followUp: true }, assign];
    case "ins_issued":
      return [{ action: "policy_issued", label: "Policy issued", primary: true, moves: true, fields: ["policyNo", "on"], onLabel: "Issued on", followUp: false }];
    case "gen_executed":
      return [{ action: "executed", label: "Executed", primary: true, moves: true, fields: ["on"], onLabel: "Executed on", followUp: false }, assign];
    case "txn_review":
      return [];
    case "rta_check":
      return [{ action: "move", label: "Mark won", primary: !o.gate.some((g) => g.completeTaskId), moves: true, fields: ["on"], onLabel: "Done on", followUp: false }];
    default:
      return o.next
        ? [{ action: "move", label: ends ? "Mark won" : `Move to: ${o.next.name}`, primary: true, moves: true, fields: ["on"], onLabel: "Done on", followUp: !ends }]
        : [];
  }
}

export function OpportunityCard({ o, canWork, staff, showClient, clientName }: {
  o: OpportunityView;
  canWork: boolean;
  /** Who a step can be handed to / an RTA check given to. */
  staff: Staff[];
  /** On the module's detail screen: a link to the client. */
  showClient?: boolean;
  clientName?: string;
}) {
  const router = useRouter();
  const w = useOpportunityWrite(o.id);
  const [spec, setSpec] = useState<Spec | null>(null);
  const [sheet, setSheet] = useState<null | "later" | "lost" | "followup" | "approve" | "reject">(null);
  const open = o.status === "open";
  const gateOpen = o.gate.some((g) => !g.satisfied);
  const rtaTaskId = o.gate.find((g) => g.completeTaskId && !g.satisfied)?.completeTaskId;
  const today = istDay();
  const due = o.followUpAt ? istDayOf(o.followUpAt) : null;
  const statusPill = o.status === "won" ? <StatusPill label="Won" tone="success" size="sm" />
    : o.status === "lost" ? <StatusPill label="Lost" tone="danger" size="sm" />
    : o.later ? <StatusPill label="Later" tone="neutral" size="sm" />
    : <StatusPill label={o.current.name} tone={o.current.delayed ? "danger" : "info"} size="sm" />;

  const resume = async () => {
    try { await w.later.mutateAsync({ action: "resume" }); toast.success("Back to work"); } catch { /* global toast */ }
  };
  const completeRta = async () => {
    if (!rtaTaskId) return;
    try { await w.completeTask.mutateAsync(rtaTaskId); toast.success("RTA data check done"); } catch { /* global toast */ }
  };

  return (
    <Card style={{ marginBottom: spacing.md }}>
      <View style={styles.head}>
        <View style={{ flex: 1 }}>
          <Text variant="body" style={{ fontWeight: fontWeight.semibold }}>{o.productLabel}</Text>
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {[o.expectedValue ? `${inr(o.expectedValue)}${o.investmentMode ? ` ${o.investmentMode === "sip" ? "SIP" : "lumpsum"}` : ""}` : null, o.ownerName ? `Owner ${o.ownerName}` : null].filter(Boolean).join(" · ") || "—"}
          </Text>
          {showClient ? (
            <Text variant="caption" tone="brand" onPress={() => router.push(`/m/investors/${o.investorId}` as any)} style={{ marginTop: 2 }}>{clientName ?? "Open client"} →</Text>
          ) : null}
        </View>
        {statusPill}
      </View>

      {/* The journey */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.stages}>
        {o.stages.map((s) => (
          <View key={s.key} style={[styles.stage, s.status === "current" && styles.stageCur]}>
            <Feather name={s.status === "done" || s.status === "auto" ? "check-circle" : s.status === "skipped" ? "skip-forward" : s.status === "current" ? "circle" : "circle"}
              size={11} color={s.status === "current" ? palette.brand : s.status === "upcoming" ? palette.faint : palette.success} />
            <Text variant="caption" style={{ color: s.status === "current" ? palette.brand : s.status === "upcoming" ? palette.faint : palette.ink, fontWeight: s.status === "current" ? fontWeight.semibold : fontWeight.regular }}>{s.name}</Text>
          </View>
        ))}
      </ScrollView>

      {open && o.later ? (
        <View style={styles.laterBox}>
          <Text variant="caption" style={{ fontWeight: fontWeight.semibold }}>Client wants it later — revisit {fmtDate(o.later.revisitOn)}</Text>
          {o.later.reason ? <Text variant="caption" tone="muted">“{o.later.reason}”</Text> : null}
          {o.later.money ? <Text variant="caption" tone="muted">Waiting for {o.later.money.label}{o.later.money.amount ? ` · ${inr(o.later.money.amount)}` : ""} on {fmtDate(o.later.money.expectedOn)}</Text> : null}
          {canWork ? (
            <View style={styles.row}>
              <Button label="Resume now" size="sm" loading={w.later.isPending} onPress={resume} />
              <Button label="New date" size="sm" variant="secondary" onPress={() => setSheet("later")} />
              <Button label="Close as lost" size="sm" variant="ghost" onPress={() => setSheet("lost")} />
            </View>
          ) : null}
        </View>
      ) : open ? (
        <Pressable style={styles.fu} disabled={!canWork} onPress={() => setSheet("followup")} accessibilityRole="button">
          <Feather name="calendar" size={13} color={!due || due <= today ? (due && due < today ? palette.danger : palette.warning) : palette.muted} />
          <Text variant="caption" style={{ flex: 1, color: due && due < today ? palette.danger : palette.ink }}>
            {due ? `Next follow-up ${fmtDate(due)}` : "No follow-up set"}
          </Text>
          {canWork ? <Text variant="caption" tone="brand">Change</Text> : null}
        </Pressable>
      ) : o.status === "lost" && o.lostReason ? (
        <Text variant="caption" tone="muted" style={{ marginTop: spacing.sm }}>Lost: {o.lostReason}{o.closedAt ? ` · ${fmtDate(o.closedAt)}` : ""}</Text>
      ) : o.closedAt ? (
        <Text variant="caption" tone="muted" style={{ marginTop: spacing.sm }}>Won {fmtDate(o.closedAt)}</Text>
      ) : null}

      {/* What stands in the way of the next step */}
      {open && !o.later && gateOpen ? (
        <View style={styles.gate}>
          <Text variant="caption" style={{ fontWeight: fontWeight.semibold, marginBottom: 2 }}>Before {o.next?.name ?? "moving on"}</Text>
          {o.gate.filter((g) => !g.satisfied).map((g, i) => (
            <View key={i} style={styles.gateRow}>
              <Feather name="alert-circle" size={13} color={palette.warning} />
              <View style={{ flex: 1 }}>
                <Text variant="caption">{g.label}</Text>
                {g.hint ? <Text variant="caption" tone="muted">{g.hint}</Text> : null}
              </View>
            </View>
          ))}
        </View>
      ) : null}

      {open && o.stepTasks.length > 0 ? (
        <View style={{ marginTop: spacing.sm }}>
          {o.stepTasks.map((t, i) => (
            <Text key={i} variant="caption" tone="muted">• {t.title}{t.assigneeName ? ` — ${t.assigneeName}` : ""}{t.dueAt ? `, due ${fmtDate(t.dueAt)}` : ""}</Text>
          ))}
        </View>
      ) : null}

      {canWork && open && !o.later ? (
        <View style={styles.actions}>
          {o.current.key === "txn_review" ? (
            <>
              <Button label="Approve transaction" size="sm" onPress={() => setSheet("approve")} />
              <Button label="Reject transaction" size="sm" variant="secondary" onPress={() => setSheet("reject")} />
            </>
          ) : null}
          {rtaTaskId ? <Button label="Complete RTA data check" size="sm" loading={w.completeTask.isPending} onPress={completeRta} /> : null}
          {o.next && o.current.key !== "txn_review" ? specsFor(o).map((s) => (
            <Button key={s.action} label={s.label} size="sm" variant={s.primary ? "primary" : "secondary"} disabled={s.moves && gateOpen} onPress={() => setSpec(s)} />
          )) : null}
          {(o.current.key === "proposal" || o.next?.key === "proposal") && o.pipeline !== "general" ? (
            <Button label="Create proposal" size="sm" variant="ghost" onPress={() => router.push(`/m/proposals/new?investorId=${o.investorId}&opportunityId=${o.id}` as any)} />
          ) : null}
          <Button label="Client wants it later" size="sm" variant="ghost" onPress={() => setSheet("later")} />
          <Button label="Mark lost" size="sm" variant="ghost" onPress={() => setSheet("lost")} />
        </View>
      ) : null}

      {spec ? <StepSheet o={o} spec={spec} staff={staff} onClose={() => setSpec(null)} /> : null}
      <FollowUpSheet o={o} visible={sheet === "followup"} onClose={() => setSheet(null)} />
      <LaterSheet o={o} visible={sheet === "later"} onClose={() => setSheet(null)} />
      <LostSheet o={o} visible={sheet === "lost"} onClose={() => setSheet(null)} />
      <ApproveSheet o={o} staff={staff} visible={sheet === "approve"} onClose={() => setSheet(null)} />
      <RejectSheet o={o} visible={sheet === "reject"} onClose={() => setSheet(null)} />
    </Card>
  );
}

/* ─────────────────────────────── the step pop-up ─────────────────────────────── */

function StepSheet({ o, spec, staff, onClose }: { o: OpportunityView; spec: Spec; staff: Staff[]; onClose: () => void }) {
  const w = useOpportunityWrite(o.id);
  const today = istDay();
  const has = (k: FieldKey) => spec.fields.includes(k);
  const startAt = o.meeting ? new Date(o.meeting.at) : null;
  const pad = (n: number) => String(n).padStart(2, "0");
  const [on, setOn] = useState(today);
  const [outcome, setOutcome] = useState<"spoke" | "no_answer">("spoke");
  const [mDay, setMDay] = useState(startAt ? `${startAt.getFullYear()}-${pad(startAt.getMonth() + 1)}-${pad(startAt.getDate())}` : istDay(1));
  const [mTime, setMTime] = useState(startAt ? `${pad(startAt.getHours())}:${pad(startAt.getMinutes() - (startAt.getMinutes() % 30))}` : "11:00");
  const [mode, setMode] = useState(o.meeting?.mode ?? "office");
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [dueOn, setDueOn] = useState(istDay(2));
  const [amount, setAmount] = useState(o.expectedValue ? String(o.expectedValue) : "");
  const [orderNo, setOrderNo] = useState("");
  const [formNo, setFormNo] = useState("");
  const [policyNo, setPolicyNo] = useState("");
  const defaultFollowUp = o.followUpAt && istDayOf(o.followUpAt) > today ? istDayOf(o.followUpAt) : istDay(2);
  // A meeting's day is the follow-up unless another is picked (steps.ts).
  const [followUpOn, setFollowUpOn] = useState(has("meeting") ? "" : defaultFollowUp);
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);
  const noAnswer = has("outcome") && outcome === "no_answer";

  const step = async (extra: Record<string, unknown>) => {
    try {
      const r = await w.step.mutateAsync({ action: spec.action, followUpOn: spec.followUp && followUpOn ? followUpOn : null, ...extra });
      toast.success(r.moved ? (r.stage === "won" ? "Marked won" : r.skipped?.length ? `Moved on — ${r.skipped.length} step${r.skipped.length === 1 ? "" : "s"} already on file` : "Moved on") : "Saved");
      onClose();
    } catch { /* the global toast says why; a blocked move refreshes the card's checklist */ }
  };

  const save = async (force = false) => {
    if (noAnswer && !followUpOn) return toast.error("Pick when to try again.");
    if (has("assignee") && !assigneeId) return toast.error("Pick who does it.");
    if (has("amount") && !(Number(amount) > 0)) return toast.error("Enter the amount.");
    if (has("policyNo") && !policyNo.trim()) return toast.error("Enter the policy number.");
    setBusy(true);
    try {
      if (has("meeting")) {
        const when = new Date(`${mDay}T${mTime}:00`);
        if (Number.isNaN(when.getTime()) || when.getTime() < Date.now() - 5 * 6e4) return toast.error("Pick a date and time from now on.");
        let meetingId = o.meeting?.id ?? null;
        try {
          if (spec.action === "reschedule_meeting" && meetingId) {
            await api.patch(`/api/review-meetings/${meetingId}`, { meetingDate: when.toISOString(), meetingMode: mode });
          } else {
            // Through the Meetings API: the same double-booking check, reminder and attendees.
            const r = await api.post<{ id: string }>("/api/review-meetings", {
              investorId: o.investorId, category: "new", meetingType: "new_investment_discussion",
              subject: `${o.productLabel} — discussion`, meetingDate: when.toISOString(), durationMinutes: 30, meetingMode: mode, force,
            });
            meetingId = r.id;
          }
        } catch (e) {
          if (e instanceof ApiError && e.status === 409 && e.body?.error === "rm_conflict") { setConflict(true); return; }
          return toast.error(errMsg(e, "Could not schedule the meeting"));
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
  };

  const title = spec.action === "assign_ops" ? OPS_TITLE[o.current.key] ?? "Assign to operations" : spec.label;
  return (
    <BottomSheet visible onClose={onClose} title={`${title} — ${o.productLabel}`}>
      {has("meeting") ? (
        <>
          <DateField label="Meeting date" value={mDay} onChange={setMDay} />
          <SelectField label="Time" value={mTime} options={TIME_SLOTS} onChange={setMTime} />
          <SelectField label="Where" value={mode} options={MODES} onChange={setMode} />
          {conflict ? (
            <View style={styles.conflict}>
              <Text variant="caption" style={{ color: palette.danger }}>The RM already has a meeting then.</Text>
              <Button label="Schedule anyway" size="sm" variant="secondary" loading={busy} onPress={() => { setConflict(false); save(true); }} />
            </View>
          ) : null}
        </>
      ) : null}
      {has("outcome") ? (
        <View style={{ marginBottom: spacing.md }}>
          <Segmented<"spoke" | "no_answer"> options={[{ key: "spoke", label: "Spoke to the client" }, { key: "no_answer", label: "No answer" }]} value={outcome} onChange={setOutcome} />
        </View>
      ) : null}
      {has("amount") ? <TextField label="Amount (₹)" required value={amount} onChangeText={(v) => setAmount(v.replace(/[^0-9.]/g, ""))} keyboardType="decimal-pad" /> : null}
      {has("formNo") ? <TextField label="Proposal form number" value={formNo} onChangeText={setFormNo} /> : null}
      {has("policyNo") ? <TextField label="Policy number" required value={policyNo} onChangeText={setPolicyNo} autoCapitalize="characters" /> : null}
      {has("orderNo") ? <TextField label="Order number" value={orderNo} onChangeText={setOrderNo} autoCapitalize="characters" /> : null}
      {has("on") ? <DateField label={spec.onLabel ?? "Done on"} value={on} onChange={setOn} max={today} /> : null}
      {has("assignee") ? (
        <>
          <SelectField label="Who does it" value={assigneeId} placeholder="Pick a person" options={staff.map((s) => ({ value: s.id, label: s.name }))} onChange={setAssigneeId} />
          <DateField label="Due on" value={dueOn} onChange={setDueOn} />
        </>
      ) : null}
      {spec.followUp ? (
        <DateField label={noAnswer ? "Try again on" : has("meeting") ? "Next follow-up (optional — the meeting day)" : "Next follow-up"} value={followUpOn} onChange={setFollowUpOn} />
      ) : null}
      <Button label="Save" full loading={busy || w.step.isPending} onPress={() => save(false)} style={{ marginTop: spacing.sm }} />
    </BottomSheet>
  );
}

/* ─────────────────────────────── the other pop-ups ─────────────────────────────── */

function FollowUpSheet({ o, visible, onClose }: { o: OpportunityView; visible: boolean; onClose: () => void }) {
  const w = useOpportunityWrite(o.id);
  const [day, setDay] = useState(o.followUpAt ? istDayOf(o.followUpAt) : istDay(2));
  const save = async () => {
    if (!day || day < istDay()) return toast.error("Pick today or a later day.");
    try { await w.patch.mutateAsync({ followUpOn: day }); toast.success(`Follow-up set for ${fmtDate(day)}`); onClose(); } catch { /* global toast */ }
  };
  return (
    <BottomSheet visible={visible} onClose={onClose} title="Next follow-up">
      <DateField label="Follow up on" value={day} onChange={setDay} />
      <Button label="Save" full loading={w.patch.isPending} onPress={save} />
    </BottomSheet>
  );
}

/** "Client wants it later" — parked to a revisit date (web LaterControls). */
function LaterSheet({ o, visible, onClose }: { o: OpportunityView; visible: boolean; onClose: () => void }) {
  const w = useOpportunityWrite(o.id);
  const [revisitOn, setRevisitOn] = useState(o.later?.revisitOn ?? istDay(90));
  const [reason, setReason] = useState(o.later?.reason ?? "");
  const save = async () => {
    if (!revisitOn || revisitOn <= istDay()) return toast.error("Pick a revisit date after today.");
    try {
      await w.later.mutateAsync({ action: "park", revisitOn, reason: reason.trim() });
      toast.success(`Parked until ${fmtDate(revisitOn)} — you'll be reminded before then`);
      onClose();
    } catch { /* global toast */ }
  };
  return (
    <BottomSheet visible={visible} onClose={onClose} title="Client wants it later">
      <DateField label="Revisit on" value={revisitOn} onChange={setRevisitOn} />
      <TextField label="What the client said" value={reason} onChangeText={setReason} placeholder="e.g. After Diwali / when the FD matures" />
      <Button label="Park it" full loading={w.later.isPending} onPress={save} />
    </BottomSheet>
  );
}

function LostSheet({ o, visible, onClose }: { o: OpportunityView; visible: boolean; onClose: () => void }) {
  const w = useOpportunityWrite(o.id);
  const [reason, setReason] = useState(OPPORTUNITY_LOST_REASONS[0]);
  const [revisitOn, setRevisitOn] = useState("");
  const save = async () => {
    try {
      await w.advance.mutateAsync({ to: "lost", lostReason: reason, revisitOn: revisitOn || null });
      toast.success("Marked lost");
      onClose();
    } catch { /* global toast */ }
  };
  return (
    <BottomSheet visible={visible} onClose={onClose} title={`Mark lost — ${o.productLabel}`}>
      {OPPORTUNITY_LOST_REASONS.map((r) => (
        <Pressable key={r} style={styles.option} onPress={() => setReason(r)} accessibilityRole="radio" accessibilityState={{ selected: reason === r }}>
          <Feather name={reason === r ? "check-circle" : "circle"} size={16} color={reason === r ? palette.brand : palette.faint} />
          <Text style={{ flex: 1 }}>{r}</Text>
        </Pressable>
      ))}
      <View style={{ height: spacing.sm }} />
      <DateField label="Revisit on (optional)" value={revisitOn} onChange={setRevisitOn} help="A follow-up task on that day, to ask again." />
      <Button label="Mark lost" variant="danger" full loading={w.advance.isPending} onPress={save} />
    </BottomSheet>
  );
}

/** Approve the order: the journey moves to "RTA data check" with a task to check it. */
function ApproveSheet({ o, staff, visible, onClose }: { o: OpportunityView; staff: Staff[]; visible: boolean; onClose: () => void }) {
  const w = useOpportunityWrite(o.id);
  const [assigneeId, setAssigneeId] = useState<string | null>(o.ownerId);
  const [dueOn, setDueOn] = useState(istDay(3));
  const save = async () => {
    try {
      await w.review.mutateAsync({ decision: "approve", assigneeId: assigneeId ?? undefined, dueOn });
      toast.success("Transaction approved — RTA data check task created");
      onClose();
    } catch { /* global toast */ }
  };
  return (
    <BottomSheet visible={visible} onClose={onClose} title="Approve transaction — RTA data check">
      <SelectField label="Who checks the RTA data" value={assigneeId} placeholder="The opportunity's owner" options={staff.map((s) => ({ value: s.id, label: s.name }))} onChange={setAssigneeId} />
      <DateField label="Check by" value={dueOn} onChange={setDueOn} />
      <Button label="Approve and create task" full loading={w.review.isPending} onPress={save} />
    </BottomSheet>
  );
}

function RejectSheet({ o, visible, onClose }: { o: OpportunityView; visible: boolean; onClose: () => void }) {
  const w = useOpportunityWrite(o.id);
  const [why, setWhy] = useState("");
  const save = async () => {
    if (!why.trim()) return toast.error("Say why the transaction was rejected.");
    try {
      await w.review.mutateAsync({ decision: "reject", remarks: why.trim() });
      toast.success("Rejected — sent back to Transaction placed");
      setWhy("");
      onClose();
    } catch { /* global toast */ }
  };
  return (
    <BottomSheet visible={visible} onClose={onClose} title="Reject transaction">
      <TextField label="Why was it rejected?" required value={why} onChangeText={setWhy} multiline />
      <Button label="Reject transaction" variant="danger" full loading={w.review.isPending} onPress={save} />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  stages: { gap: spacing.xs, paddingVertical: spacing.sm },
  stage: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: palette.surfaceSunken },
  stageCur: { backgroundColor: palette.brandLight },
  fu: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 36 },
  laterBox: { backgroundColor: palette.surfaceSunken, borderRadius: radius.md, padding: spacing.md, gap: 4, marginTop: spacing.xs },
  gate: { marginTop: spacing.sm, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: palette.warning + "66", backgroundColor: palette.warning + "10" },
  gateRow: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start", paddingVertical: 2 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.md },
  row: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.sm },
  conflict: { gap: spacing.sm, marginBottom: spacing.md },
  option: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.lineSoft },
});
