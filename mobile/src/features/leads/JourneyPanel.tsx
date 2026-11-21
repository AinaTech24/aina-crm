/**
 * "Next step" on a lead — the CRM's guided journey (web GuidedStageActions).
 * The buttons are the current stage's actions from journey.ts; each one checks
 * the server's prerequisites first (GET can-advance) and then does what the
 * web does: log the call / meeting (the server moves the stage on), open the
 * meeting form, the proposal, the Won product picker, or move the stage
 * (asking for the next follow-up on a call loop and the reason on a close).
 */

import React, { useState } from "react";
import { View, Pressable, Alert, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Feather } from "@expo/vector-icons";
import { Text } from "../../components/ui/Text";
import { Button } from "../../components/ui/Button";
import { TextField } from "../../components/ui/TextField";
import { BottomSheet } from "../../components/ui/BottomSheet";
import { SelectField } from "../../components/ui/SelectField";
import { FollowUpField } from "../../components/form/FollowUpField";
import { Section, Empty } from "../investors/detail/primitives";
import { api } from "../../api/client";
import { toast } from "../../lib/toast";
import { fmtDate, titleCase } from "../../lib/format";
import { palette, radius, spacing, fontWeight } from "../../theme/tokens";
import { leadSourceLabel } from "./api";
import {
  LEAD_JOURNEY, LEAD_PHASE, NEXT_TOUCH_STAGES, LOST_REASONS, LEAD_PRODUCTS, journeyStage,
  useLeadBlueprint, useLeadProposal, useRefreshLead, canAdvance, advanceLead, markLeadWon, proposalAware, ctaToMobile,
  type JourneyAction, type Prereq, type MissingField,
} from "./journey";

const isMeetingHref = (href: string) => /\/review-meetings\/new\b/.test(href);
const isCompleteMeetingHref = (href: string) => /\/review-meetings\?leadId=/.test(href);
const errMsg = (e: any, fallback: string) => e?.body?.error ?? e?.message ?? fallback;

export function JourneyPanel({ leadId, leadStage, onLog }: {
  leadId: string;
  leadStage?: string | null;
  /** Open the Log activity sheet set to a call / meeting. */
  onLog: (type: "call" | "meeting") => void;
}) {
  const router = useRouter();
  const bp = useLeadBlueprint(leadId);
  // The blueprint's own step; until it arrives, the lead's stored stage read
  // through the legacy aliases ("contacted" IS Contacted).
  const stage = journeyStage(bp.data?.current?.key ?? leadStage);
  const pipeline = bp.data?.pipeline ?? "mf";
  const hasProposalStep = (LEAD_JOURNEY[stage] ?? []).some((a) => a.behaviour.kind === "proposal");
  const proposal = useLeadProposal(leadId, hasProposalStep);
  const refresh = useRefreshLead(leadId);

  const [busy, setBusy] = useState<string | null>(null);
  const [needs, setNeeds] = useState<{ label: string; items: Prereq[] } | null>(null);
  const [transition, setTransition] = useState<{ action: JourneyAction; missing: MissingField[] } | null>(null);
  const [wonOpen, setWonOpen] = useState(false);
  const [completeOpen, setCompleteOpen] = useState(false);

  // The pipeline (MF / insurance) decides which Won actions show, so don't
  // offer buttons for a guessed one while the journey is still loading.
  if (bp.isLoading) {
    return (
      <Section title="Next step" icon="zap">
        <Text variant="caption" tone="muted">Loading…</Text>
      </Section>
    );
  }

  // After Won the journey is client onboarding — run in the CRM.
  if (!LEAD_PHASE.has(stage)) {
    return (
      <Section title="Next step" icon="zap">
        <Text variant="body" style={{ fontWeight: fontWeight.semibold }}>{bp.data?.current?.name ?? titleCase(stage)}</Text>
        <Text variant="caption" tone="muted" style={{ marginTop: 2 }}>Client onboarding continues in the CRM.</Text>
      </Section>
    );
  }

  const actions = (LEAD_JOURNEY[stage] ?? [])
    .filter((a) => !a.pipelines || a.pipelines.includes(pipeline))
    // "View Proposal" needs a proposal to open (web GuidedStageActions) — with
    // none it used to start a brand-new one.
    .filter((a) => !(a.behaviour.kind === "proposal" && a.behaviour.step === "open" && !proposal.data))
    .map((a) => proposalAware(a, proposal.data));

  const scheduleMeeting = () => router.push(`/m/review-meetings/new?leadId=${leadId}` as any);

  const move = async (to: string, label: string) => {
    try {
      await advanceLead(leadId, { toStageKey: to, remarks: `Action: ${label}` });
      refresh();
    } catch (e) {
      toast.error(errMsg(e, "Couldn't move to this step. Please try again."));
    }
  };

  const proposalStep = (action: JourneyAction, step: "create_or_send" | "open" | "accept") => {
    const p = proposal.data;
    if (step !== "accept") {
      const reusable = p && !["rejected", "expired"].includes(p.status);
      router.push((reusable ? `/m/proposals/${p!.id}` : `/m/proposals/new?leadId=${leadId}`) as any);
      return;
    }
    // Moved to Proposal Sent by hand, with nothing on file: pick the product.
    if (!p) { setWonOpen(true); return; }
    if (p.status === "draft" || p.status === "ready") {
      toast.error(`Proposal ${p.number} has not been sent to the client yet. Open it and send it first.`);
      return;
    }
    if (!["sent", "viewed", "changes_requested"].includes(p.status)) {
      router.push(`/m/proposals/${p.id}` as any);
      return;
    }
    Alert.alert(`Mark proposal ${p.number} approved?`, "The lead becomes Won and the client is sent the document checklist to start onboarding.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Yes, client approved",
        onPress: async () => {
          setBusy(action.key);
          try {
            await api.patch(`/api/proposals/${p.id}`, { status: "accepted" });
            toast.success("Lead won");
            refresh();
          } catch (e) {
            toast.error(errMsg(e, "Could not mark the proposal approved."));
          } finally {
            setBusy(null);
          }
        },
      },
    ]);
  };

  const run = async (action: JourneyAction) => {
    const b = action.behaviour;
    if (b.kind === "proposal") { proposalStep(action, b.step); return; }

    setBusy(action.key);
    try {
      const forward = action.targetStage !== stage;
      if (forward) {
        let pre: Awaited<ReturnType<typeof canAdvance>>;
        try {
          pre = await canAdvance(leadId, action.targetStage);
        } catch (e) {
          toast.error(errMsg(e, "Couldn't check this step. Please try again."));
          return;
        }
        if (!pre.ok) {
          // The only thing missing is the meeting itself → straight to it.
          const open = pre.items.filter((p) => !p.satisfied);
          if (open.length && open.every((p) => p.cta && isMeetingHref(p.cta.href))) { scheduleMeeting(); return; }
          if (open.length && open.every((p) => p.cta && isCompleteMeetingHref(p.cta.href))) { setCompleteOpen(true); return; }
          setNeeds({ label: action.label, items: pre.items });
          return;
        }
        if (b.kind === "advance") {
          const missing = pre.missingFields ?? [];
          if (missing.length || NEXT_TOUCH_STAGES.has(action.targetStage) || action.targetStage === "not_qualified") {
            setTransition({ action, missing });
            return;
          }
        }
      }

      switch (b.kind) {
        case "log": onLog(b.activityType); break;
        case "schedule_meeting": scheduleMeeting(); break;
        case "won_product": setWonOpen(true); break;
        case "advance": if (forward) await move(action.targetStage, action.label); break;
        case "call_api": {
          try {
            const r = await api.post<any>(b.endpoint.replace("{id}", leadId), {});
            if (b.afterStage) await advanceLead(leadId, { toStageKey: b.afterStage });
            if (typeof r?.summary === "string") toast.success(r.summary);
            refresh();
          } catch (e) {
            toast.error(errMsg(e, "The action could not be completed."));
          }
          break;
        }
      }
    } finally {
      setBusy(null);
    }
  };

  const current = bp.data?.current;
  return (
    <Section title="Next step" icon="zap">
      {current ? (
        <View style={styles.current}>
          <Text style={{ fontWeight: fontWeight.semibold, flex: 1 }}>{current.name}</Text>
          {current.isDelayed ? <Text variant="caption" style={{ color: palette.danger, fontWeight: fontWeight.semibold }}>Overdue</Text> : null}
        </View>
      ) : null}
      {actions.length === 0 ? (
        <Empty text={stage === "not_qualified" ? "This lead is closed." : "No action for this step."} />
      ) : (
        <View style={{ gap: spacing.sm }}>
          {actions.map((a) => (
            <Button
              key={a.key}
              label={a.label}
              size="sm"
              full
              variant={a.tone === "danger" ? "secondary" : a.tone === "secondary" ? "secondary" : "primary"}
              loading={busy === a.key}
              disabled={!!busy && busy !== a.key}
              onPress={() => run(a)}
              style={a.tone === "danger" ? { borderColor: palette.danger } : undefined}
            />
          ))}
        </View>
      )}

      <NeedsSheet needs={needs} leadId={leadId} onClose={() => setNeeds(null)} onGo={(href) => { setNeeds(null); router.push(href as any); }} />
      <TransitionSheet leadId={leadId} transition={transition} onClose={() => setTransition(null)} onDone={() => { setTransition(null); refresh(); }} />
      <WonProductSheet leadId={leadId} visible={wonOpen} onClose={() => setWonOpen(false)} onDone={() => { setWonOpen(false); refresh(); }} />
      <CompleteMeetingSheet leadId={leadId} visible={completeOpen} onClose={() => setCompleteOpen(false)}
        onLog={() => { setCompleteOpen(false); onLog("meeting"); }}
        onDone={() => { setCompleteOpen(false); refresh(); }} />
    </Section>
  );
}

/** "Before moving on" — the server's unmet prerequisites, each with its link. */
function NeedsSheet({ needs, leadId, onClose, onGo }: { needs: { label: string; items: Prereq[] } | null; leadId: string; onClose: () => void; onGo: (href: string) => void }) {
  return (
    <BottomSheet visible={!!needs} onClose={onClose} title="Before moving on">
      {needs?.items.map((p, i) => {
        const href = p.cta ? ctaToMobile(p.cta.href, leadId) : null;
        return (
          <View key={i} style={styles.prereq}>
            <Feather name={p.satisfied ? "check-circle" : "circle"} size={15} color={p.satisfied ? palette.success : palette.warning} />
            <View style={{ flex: 1 }}>
              <Text variant="caption" style={{ fontWeight: fontWeight.medium }}>{p.label}</Text>
              {p.hint && !p.satisfied ? <Text variant="caption" tone="muted">{p.hint}</Text> : null}
            </View>
            {!p.satisfied && p.cta && href ? <Text variant="caption" tone="brand" onPress={() => onGo(href)}>{p.cta.label}</Text> : null}
          </View>
        );
      })}
    </BottomSheet>
  );
}

/** A direct stage move that needs input: the next follow-up on a call loop,
 *  the reason on a close, or a field the step requires. No remarks box. */
function TransitionSheet({ leadId, transition, onClose, onDone }: { leadId: string; transition: { action: JourneyAction; missing: MissingField[] } | null; onClose: () => void; onDone: () => void }) {
  const [callBackAt, setCallBackAt] = useState("");
  const [reason, setReason] = useState<string | null>(null);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const target = transition?.action.targetStage ?? "";
  const needsNextTouch = NEXT_TOUCH_STAGES.has(target);
  const closing = target === "not_qualified";

  const reset = () => { setCallBackAt(""); setReason(null); setVals({}); };
  const close = () => { reset(); onClose(); };

  const submit = async () => {
    if (!transition) return;
    for (const f of transition.missing) {
      if (!vals[f.key]?.trim()) { toast.error(`Please fill in ${f.label}`); return; }
    }
    const when = callBackAt ? new Date(callBackAt) : null;
    if (needsNextTouch && (!when || !Number.isFinite(when.getTime()))) { toast.error("Pick when to follow up — you'll be reminded then."); return; }
    if (closing && !reason) { toast.error("Pick why this lead is being closed."); return; }
    setSaving(true);
    try {
      await advanceLead(leadId, {
        toStageKey: target,
        remarks: `Transitioned to ${target}`,
        fields: { ...vals, ...(closing ? { lostReason: reason, lostAt: new Date().toISOString() } : {}) },
        callBackAt: needsNextTouch && when ? when.toISOString() : undefined,
      });
      reset();
      onDone();
    } catch (e) {
      toast.error(errMsg(e, "Failed to complete the step."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <BottomSheet visible={!!transition} onClose={close} title={transition?.action.label ?? ""}>
      {transition?.missing.map((f) =>
        f.options?.length ? (
          <SelectField key={f.key} label={f.label} value={vals[f.key] ?? null}
            // A source reads as the web names it; "existing_client" is a second Client Referral (retired).
            options={(f.key === "source" ? f.options.filter((o) => o !== "existing_client") : f.options).map((o) => ({ value: o, label: f.key === "source" ? leadSourceLabel(o) : titleCase(o) }))}
            onChange={(v) => setVals((s) => ({ ...s, [f.key]: v }))} />
        ) : (
          <TextField key={f.key} label={f.label} value={vals[f.key] ?? ""} onChangeText={(v) => setVals((s) => ({ ...s, [f.key]: v }))}
            keyboardType={f.type === "number" || f.type === "currency" ? "numeric" : f.type === "email" ? "email-address" : f.type === "phone" ? "phone-pad" : "default"} />
        ),
      )}
      {needsNextTouch ? <FollowUpField label="Follow up on" value={callBackAt} onChange={setCallBackAt} /> : null}
      {closing ? (
        <View>
          <Text variant="label" tone="muted" style={{ marginBottom: spacing.xs }}>Reason</Text>
          {LOST_REASONS.map((r) => (
            <Pressable key={r} style={styles.option} onPress={() => setReason(r)} accessibilityRole="radio" accessibilityState={{ selected: reason === r }}>
              <Feather name={reason === r ? "check-circle" : "circle"} size={16} color={reason === r ? palette.brand : palette.faint} />
              <Text style={{ flex: 1 }}>{r}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <View style={{ height: spacing.md }} />
      <Button label={closing ? "Close lead" : "Save"} variant={closing ? "danger" : "primary"} full loading={saving} onPress={submit} />
    </BottomSheet>
  );
}

/** Won without a proposal: which product(s) the client is investing in. */
function WonProductSheet({ leadId, visible, onClose, onDone }: { leadId: string; visible: boolean; onClose: () => void; onDone: () => void }) {
  const [picked, setPicked] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const toggle = (v: string) => setPicked((s) => (s.includes(v) ? s.filter((x) => x !== v) : [...s, v]));
  const submit = async () => {
    if (!picked.length) { toast.error("Pick at least one product"); return; }
    setSaving(true);
    try {
      await markLeadWon(leadId, picked, picked[0]);
      toast.success("Lead won");
      setPicked([]);
      onDone();
    } catch (e) {
      toast.error(errMsg(e, "Couldn't mark the lead won."));
    } finally {
      setSaving(false);
    }
  };
  return (
    <BottomSheet visible={visible} onClose={onClose} title="Won — which product?">
      {LEAD_PRODUCTS.map((p) => {
        const on = picked.includes(p.value);
        return (
          <Pressable key={p.value} style={styles.option} onPress={() => toggle(p.value)} accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
            <Feather name={on ? "check-square" : "square"} size={16} color={on ? palette.brand : palette.faint} />
            <Text style={{ flex: 1 }}>{p.label}</Text>
            {on && picked[0] === p.value && picked.length > 1 ? <Text variant="caption" tone="muted">Primary</Text> : null}
          </Pressable>
        );
      })}
      <View style={{ height: spacing.md }} />
      <Button label="Mark won" full loading={saving} onPress={submit} />
    </BottomSheet>
  );
}

/** Meeting Done needs a completed meeting: complete one of the lead's
 *  meetings here (completing it moves the lead on), or log the one that
 *  happened when none was scheduled. */
function CompleteMeetingSheet({ leadId, visible, onClose, onLog, onDone }: { leadId: string; visible: boolean; onClose: () => void; onLog: () => void; onDone: () => void }) {
  const q = useQuery({
    queryKey: ["lead-meetings", leadId],
    queryFn: () => api.get<{ meetings: any[] }>("/api/review-meetings", { leadId }).then((r) => r.meetings ?? []),
    enabled: visible,
  });
  const [saving, setSaving] = useState<string | null>(null);
  const open = (q.data ?? []).filter((m) => ["scheduled", "confirmed", "in_progress"].includes(m.status));
  const complete = async (id: string) => {
    setSaving(id);
    try {
      await api.patch(`/api/review-meetings/${id}`, { status: "completed" });
      toast.success("Meeting completed");
      onDone();
    } catch (e) {
      toast.error(errMsg(e, "Could not mark completed."));
    } finally {
      setSaving(null);
    }
  };
  return (
    <BottomSheet visible={visible} onClose={onClose} title="Complete the meeting">
      {q.isLoading ? <Text variant="caption" tone="muted">Loading meetings…</Text> : open.length === 0 ? (
        <Empty text="No scheduled meeting with this lead." />
      ) : open.map((m) => (
        <View key={m.id} style={styles.prereq}>
          <Feather name="calendar" size={15} color={palette.brand} />
          <View style={{ flex: 1 }}>
            <Text variant="caption" style={{ fontWeight: fontWeight.medium }}>{titleCase(m.meeting_type ?? m.meetingType) || "Meeting"}</Text>
            <Text variant="caption" tone="muted">{fmtDate(m.meeting_date ?? m.meetingDate)}</Text>
          </View>
          <Button label="Mark completed" size="sm" loading={saving === m.id} disabled={!!saving} onPress={() => complete(m.id)} />
        </View>
      ))}
      <View style={{ height: spacing.md }} />
      <Button label="Log a meeting that happened" variant="secondary" full onPress={onLog} />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  current: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.sm, paddingBottom: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.lineSoft },
  prereq: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.lineSoft },
  option: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.lineSoft, borderRadius: radius.sm },
});
