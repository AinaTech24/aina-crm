/**
 * CallLogPrompt — turns a call placed from inside the app into a logged activity.
 * Mounted once at the app shell.
 *
 * Manual mode prompts for outcome, actual duration, discussion and the next
 * follow-up ("call me Thursday"). When Android metadata import is enabled and
 * permitted, startCall does not arm this prompt. Time away from the app is
 * never used as call duration.
 *
 * The follow-up lands on the RM's desk that day: a client's comes from its
 * latest call's next_followup_at (lib/dashboard/my/desk.ts); a lead's desk
 * reads the lead's own next_follow_up_at, so it is set there too. Due 10:00
 * IST, as the web's follow-ups.
 */

import React, { useEffect, useRef, useState } from "react";
import { View, AppState, type AppStateStatus } from "react-native";
import { Feather } from "@expo/vector-icons";
import { BottomSheet } from "../../components/ui/BottomSheet";
import { Text } from "../../components/ui/Text";
import { Button } from "../../components/ui/Button";
import { TextField } from "../../components/ui/TextField";
import { SelectField } from "../../components/ui/SelectField";
import { Chip } from "../../components/ui/Chip";
import { DateField } from "../../components/form/DateField";
import { queuedPatch } from "../../lib/offlineQueue";
import { useQueryClient } from "@tanstack/react-query";
import { useCallIntent } from "../../state/callIntent";
import { useLogActivity, ACTIVITY_OUTCOMES } from "./api";
import { toast } from "../../lib/toast";
import { palette, spacing, radius } from "../../theme/tokens";
import { errorMessage } from "../../lib/errors";

// Below this, the "call" was almost certainly cancelled before connecting —
// don't nag. Above it, prompt to log.
const MIN_CALL_MS = 5000;

/** Today in India as yyyy-mm-dd, plus `days`. */
function istDay(days = 0): string {
  const d = new Date(Date.now() + 330 * 60_000);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
const FOLLOW_UPS = [
  { label: "Tomorrow", days: 1 },
  { label: "In 3 days", days: 3 },
  { label: "Next week", days: 7 },
];

export function CallLogPrompt() {
  const pending = useCallIntent((s) => s.pending);
  const clear = useCallIntent((s) => s.clear);
  const log = useLogActivity();
  const appState = useRef<AppStateStatus>(AppState.currentState);
  const [show, setShow] = useState(false);
  const [outcome, setOutcome] = useState("answered");
  const [durationMin, setDurationMin] = useState("");
  const [notes, setNotes] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const qc = useQueryClient();

  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      const prev = appState.current;
      appState.current = next;
      if (next === "active" && /inactive|background/.test(prev)) {
        const p = useCallIntent.getState().pending;
        if (!p) return;
        const elapsedMs = Date.now() - p.armedAt;
        if (elapsedMs < MIN_CALL_MS) return clear(); // too quick — treat as cancelled

        // SIM import uses actual Android metadata. Manual mode never guesses
        // whether a call connected or how long the conversation lasted.
        setShow(true);
      }
    });
    return () => sub.remove();
  }, [clear, log]);

  useEffect(() => {
    if (show) { setOutcome(""); setDurationMin(""); setNotes(""); setFollowUp(""); setErr(null); }
  }, [show]);

  const dismiss = () => { setShow(false); clear(); };

  const save = async () => {
    if (!pending) return dismiss();
    setErr(null);
    const min = parseFloat(durationMin);
    if (durationMin.trim() && (!Number.isFinite(min) || min < 0 || min > 1440)) return setErr("Enter the actual duration between 0 and 1,440 minutes, or leave it blank.");
    if (followUp && followUp < istDay(0)) return setErr("The follow-up can't be in the past.");
    const followUpAt = followUp ? new Date(`${followUp}T10:00:00+05:30`).toISOString() : undefined;
    try {
      const saved = await log.mutateAsync({
        subjectType: pending.subjectType,
        subjectId: pending.subjectId,
        kind: "call",
        direction: "outbound",
        subject: `Call with ${pending.name}`,
        status: outcome || undefined,
        notes: notes || undefined,
        durationSec: min > 0 ? Math.round(min * 60) : undefined,
        occurredAt: new Date(pending.armedAt).toISOString(),
        nextFollowupAt: followUpAt,
      });
      // A lead's desk reads the lead's own follow-up date.
      if (followUpAt && pending.subjectType === "lead") {
        await queuedPatch(`/api/leads/${pending.subjectId}`, { nextFollowUpAt: followUpAt }, "Lead follow-up").catch(() => {});
        qc.invalidateQueries({ queryKey: ["lead-full", pending.subjectId] });
        qc.invalidateQueries({ queryKey: ["leads"] });
      }
      if (saved !== null) toast.success(followUp ? `Call with ${pending.name} logged · follow-up ${followUp.split("-").reverse().join("-")}` : `Call with ${pending.name} logged`);
      else toast.info(`Call with ${pending.name} saved on this phone; awaiting sync`);
      dismiss();
    } catch (e) {
      setErr(errorMessage(e, "Could not log the call."));
    }
  };

  if (!pending) return null;

  return (
    <BottomSheet visible={show} onClose={dismiss} title="Log this call?" scroll>
      <View style={styles.who}>
        <View style={styles.avatar}><Feather name="phone-outgoing" size={16} color={palette.white} /></View>
        <View style={{ flex: 1 }}>
          <Text variant="subtitle" numberOfLines={1}>{pending.name}</Text>
          <Text variant="caption" tone="muted">{pending.phone} · outbound</Text>
        </View>
      </View>

      <SelectField label="Outcome" value={outcome} options={[{ value: "", label: "— Not set —" }, ...ACTIVITY_OUTCOMES.map((o) => ({ value: o.value, label: o.label }))]} onChange={setOutcome} />
      <TextField label="Duration (min)" value={durationMin} onChangeText={setDurationMin} keyboardType="numeric" placeholder="e.g. 4" />
      <TextField label="What did you discuss?" value={notes} onChangeText={setNotes} placeholder="Add call notes…" multiline />
      <Text variant="label" tone="muted" style={{ marginBottom: spacing.xs }}>Next follow-up</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.sm }}>
        <Chip label="None" selected={!followUp} onPress={() => setFollowUp("")} />
        {FOLLOW_UPS.map((f) => {
          const day = istDay(f.days);
          return <Chip key={f.label} label={f.label} selected={followUp === day} onPress={() => setFollowUp(day)} />;
        })}
      </View>
      <DateField label="Or pick a date" value={followUp} onChange={setFollowUp} min={istDay(0)} />
      {err ? <Text variant="caption" tone="danger" style={{ marginBottom: spacing.sm }}>{err}</Text> : null}

      <View style={{ flexDirection: "row", gap: spacing.md }}>
        <Button label="Skip" variant="secondary" onPress={dismiss} style={{ flex: 1 }} />
        <Button label="Log call" loading={log.isPending} onPress={save} style={{ flex: 2 }} />
      </View>
    </BottomSheet>
  );
}

const styles = {
  who: { flexDirection: "row" as const, alignItems: "center" as const, gap: spacing.md, backgroundColor: palette.surfaceSunken, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md },
  avatar: { width: 36, height: 36, borderRadius: radius.pill, backgroundColor: palette.brand, alignItems: "center" as const, justifyContent: "center" as const },
};
