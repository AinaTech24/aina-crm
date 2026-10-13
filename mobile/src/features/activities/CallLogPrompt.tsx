/**
 * CallLogPrompt — turns a call placed from inside the app into a logged activity.
 * Mounted once at the app shell.
 *
 * Manual mode prompts for outcome, actual duration and discussion. When
 * Android metadata import is enabled and permitted, startCall does not arm
 * this prompt. Time away from the app is never used as call duration.
 */

import React, { useEffect, useRef, useState } from "react";
import { View, AppState, type AppStateStatus } from "react-native";
import { Feather } from "@expo/vector-icons";
import { BottomSheet } from "../../components/ui/BottomSheet";
import { Text } from "../../components/ui/Text";
import { Button } from "../../components/ui/Button";
import { TextField } from "../../components/ui/TextField";
import { SelectField } from "../../components/ui/SelectField";
import { useCallIntent } from "../../state/callIntent";
import { useLogActivity, ACTIVITY_OUTCOMES } from "./api";
import { toast } from "../../lib/toast";
import { palette, spacing, radius } from "../../theme/tokens";
import { errorMessage } from "../../lib/errors";

// Below this, the "call" was almost certainly cancelled before connecting —
// don't nag. Above it, prompt to log.
const MIN_CALL_MS = 5000;

export function CallLogPrompt() {
  const pending = useCallIntent((s) => s.pending);
  const clear = useCallIntent((s) => s.clear);
  const log = useLogActivity();
  const appState = useRef<AppStateStatus>(AppState.currentState);
  const [show, setShow] = useState(false);
  const [outcome, setOutcome] = useState("answered");
  const [durationMin, setDurationMin] = useState("");
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState<string | null>(null);

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
    if (show) { setOutcome(""); setDurationMin(""); setNotes(""); setErr(null); }
  }, [show]);

  const dismiss = () => { setShow(false); clear(); };

  const save = async () => {
    if (!pending) return dismiss();
    setErr(null);
    const min = parseFloat(durationMin);
    if (durationMin.trim() && (!Number.isFinite(min) || min < 0 || min > 1440)) return setErr("Enter the actual duration between 0 and 1,440 minutes, or leave it blank.");
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
      });
      if (saved !== null) toast.success(`Call with ${pending.name} logged`);
      else toast.info(`Call with ${pending.name} saved on this phone; awaiting sync`);
      dismiss();
    } catch (e) {
      setErr(errorMessage(e, "Could not log the call."));
    }
  };

  if (!pending) return null;

  return (
    <BottomSheet visible={show} onClose={dismiss} title="Log this call?">
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
