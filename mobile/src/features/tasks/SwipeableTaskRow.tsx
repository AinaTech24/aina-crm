/**
 * SwipeableTaskRow — a task in the list with swipe actions, for working the
 * list one-handed: swipe right → Complete; swipe left → Snooze (to tomorrow)
 * and Open the client / lead. The swipe only REVEALS the buttons; nothing
 * happens until one is tapped, so a scroll can never complete a task.
 *
 * Writes go through the offline queue (a basement, a lift, a village branch):
 * applied at once when online, replayed when the signal returns. Completing a
 * task that needs approval sends it for approval, as everywhere else.
 */

import React, { useRef } from "react";
import { View, Pressable, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import ReanimatedSwipeable, { type SwipeableMethods } from "react-native-gesture-handler/ReanimatedSwipeable";
import { useQueryClient } from "@tanstack/react-query";
import { TaskCard } from "../../components/domain/TaskCard";
import { Text } from "../../components/ui/Text";
import { queuedPatch } from "../../lib/offlineQueue";
import { toast } from "../../lib/toast";
import { errorMessage } from "../../lib/errors";
import { palette, spacing, radius, fontWeight } from "../../theme/tokens";
import type { Task } from "./api";
import { snoozeTarget } from "./snooze";

const OPEN = new Set(["open", "in_progress", "blocked"]);

export function SwipeableTaskRow({ task }: { task: Task }) {
  const router = useRouter();
  const qc = useQueryClient();
  const ref = useRef<SwipeableMethods>(null);
  const open = () => router.push(`/m/tasks/${task.id}` as any);
  if (!OPEN.has(task.status ?? "open")) return <TaskCard task={task} onPress={open} />;

  const clientId = task.relatedInvestorId ?? (task.subjectType === "investor" ? task.subjectId : null);
  const leadId = task.relatedLeadId ?? (task.subjectType === "lead" ? task.subjectId : null);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["tasks"] });
    qc.invalidateQueries({ queryKey: ["task-kpis"] });
    qc.invalidateQueries({ queryKey: ["task", task.id] });
  };
  const write = async (body: Record<string, unknown>, done: (r: any) => string) => {
    ref.current?.close();
    Haptics.selectionAsync().catch(() => {});
    try {
      const r = await queuedPatch<any>(`/api/tasks/${task.id}`, body, "Task update");
      toast.success(r === null ? "Saved on this phone; it syncs when you're back online" : done(r));
    } catch (e) {
      toast.error(errorMessage(e, "Couldn't update the task"));
    } finally {
      refresh();
    }
  };
  const complete = () => write({ status: "completed" }, (r) =>
    r?.status !== "completed" && r?.approvalStatus === "pending" ? "Sent for approval" : "Task completed");
  const snooze = () => {
    const at = snoozeTarget(task.dueAt);
    write({ dueAt: at }, () => "Snoozed to tomorrow");
  };
  const openRecord = () => {
    ref.current?.close();
    if (clientId) router.push(`/m/investors/${clientId}` as any);
    else if (leadId) router.push(`/m/leads/${leadId}` as any);
  };

  return (
    <ReanimatedSwipeable
      ref={ref}
      friction={2}
      leftThreshold={48}
      rightThreshold={48}
      overshootLeft={false}
      overshootRight={false}
      renderLeftActions={() => (
        <View style={styles.actions}>
          <Action icon="check" label="Complete" color={palette.success} onPress={complete} />
        </View>
      )}
      renderRightActions={() => (
        <View style={styles.actions}>
          <Action icon="clock" label="Tomorrow" color={palette.warning} onPress={snooze} />
          {clientId || leadId ? <Action icon={clientId ? "user" : "user-plus"} label={clientId ? "Client" : "Lead"} color={palette.brand} onPress={openRecord} /> : null}
        </View>
      )}
    >
      <View
        accessible
        accessibilityActions={[
          { name: "complete", label: "Complete" },
          { name: "snooze", label: "Snooze to tomorrow" },
          ...(clientId || leadId ? [{ name: "record", label: clientId ? "Open client" : "Open lead" }] : []),
        ]}
        onAccessibilityAction={(e) => {
          const a = e.nativeEvent.actionName;
          if (a === "complete") complete();
          else if (a === "snooze") snooze();
          else if (a === "record") openRecord();
        }}
      >
        <TaskCard task={task} onPress={open} />
      </View>
    </ReanimatedSwipeable>
  );
}

function Action({ icon, label, color, onPress }: { icon: React.ComponentProps<typeof Feather>["name"]; label: string; color: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.action, { backgroundColor: color }]} accessibilityRole="button" accessibilityLabel={label}>
      <Feather name={icon} size={18} color={palette.white} />
      <Text variant="caption" style={{ color: palette.white, fontWeight: fontWeight.semibold }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: "row", alignItems: "stretch", gap: spacing.xs, marginBottom: spacing.md, paddingHorizontal: spacing.xs },
  action: { width: 84, borderRadius: radius.md, alignItems: "center", justifyContent: "center", gap: 4 },
});
