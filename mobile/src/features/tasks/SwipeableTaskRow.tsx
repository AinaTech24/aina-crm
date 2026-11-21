/**
 * SwipeableTaskRow — a task in the list with swipe actions, for working the
 * list one-handed: swipe right → Complete; swipe left → Snooze (to tomorrow)
 * and Open the client / lead. The swipe only REVEALS the buttons; nothing
 * happens until one is tapped, so a scroll can never complete a task.
 *
 * No "are you sure?": the change is made at once and the toast offers Undo for
 * ~5 s, which puts the task back through the same API (status back — and the
 * next occurrence a recurring task spawned goes to Trash — or the due date
 * back). See features/lists/taskUndo.ts for when Undo is not offered.
 *
 * Writes go through the offline queue (a basement, a lift, a village branch):
 * applied at once when online, replayed when the signal returns. Completing a
 * task that needs approval sends it for approval, as everywhere else.
 */

import React, { useEffect, useRef } from "react";
import { View, Pressable, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import ReanimatedSwipeable, { type SwipeableMethods } from "react-native-gesture-handler/ReanimatedSwipeable";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { TaskCard } from "../../components/domain/TaskCard";
import { Text } from "../../components/ui/Text";
import { api } from "../../api/client";
import { queuedPatch } from "../../lib/offlineQueue";
import { toast } from "../../lib/toast";
import { errorMessage } from "../../lib/errors";
import { palette, spacing, radius, fontWeight } from "../../theme/tokens";
import type { Task } from "./api";
import { snoozeTarget } from "./snooze";
import { dueUndo, statusMessage, statusUndo, type TaskUndoPlan } from "../lists/taskUndo";
import { SwipeHint } from "../lists/SwipeHint";
import { markSwipeHintSeen, useSwipeHint } from "../lists/swipeHintStore";

const OPEN = new Set(["open", "in_progress", "blocked"]);

/** Refresh everything a task change shows up in. */
export function refreshTaskQueries(qc: QueryClient, taskId?: string) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: ["tasks"] }),
    qc.invalidateQueries({ queryKey: ["task-kpis"] }),
    ...(taskId ? [qc.invalidateQueries({ queryKey: ["task", taskId] })] : []),
  ]);
}

/** Put a task back as it was (the toast's Undo). */
export async function undoTaskChange(qc: QueryClient, taskId: string, plan: TaskUndoPlan): Promise<void> {
  try {
    await queuedPatch(`/api/tasks/${taskId}`, plan.body, "Task update");
    // Completing a recurring task made its next occurrence; undoing the
    // completion must not leave a twin behind. To Trash, so it is recoverable.
    if (plan.trashId) await api.del(`/api/tasks/${plan.trashId}`).catch(() => {});
  } catch (e) {
    toast.error(errorMessage(e, "Couldn't undo"));
  } finally {
    await refreshTaskQueries(qc, taskId);
  }
}

export function SwipeableTaskRow({ task, hintCandidate }: { task: Task; /** The first open row: carries the one-time swipe hint. */ hintCandidate?: boolean }) {
  const router = useRouter();
  const qc = useQueryClient();
  const ref = useRef<SwipeableMethods>(null);
  const hint = useSwipeHint("tasks");
  // FlashList recycles rows: a row left open must not open on another task.
  useEffect(() => { ref.current?.reset(); }, [task.id]);
  const open = () => router.push(`/m/tasks/${task.id}` as any);
  if (!OPEN.has(task.status ?? "open")) return <TaskCard task={task} onPress={open} />;

  const clientId = task.relatedInvestorId ?? (task.subjectType === "investor" ? task.subjectId : null);
  const leadId = task.relatedLeadId ?? (task.subjectType === "lead" ? task.subjectId : null);

  const write = async (body: Record<string, unknown>, done: (r: any) => { message: string; undo: TaskUndoPlan | null }) => {
    ref.current?.close();
    Haptics.selectionAsync().catch(() => {});
    try {
      const r = await queuedPatch<any>(`/api/tasks/${task.id}`, body, "Task update");
      if (r === null) {
        toast.success("Saved on this phone; it syncs when you're back online");
        return;
      }
      const { message, undo } = done(r);
      if (undo) toast.undo(message, () => void undoTaskChange(qc, task.id, undo));
      else toast.success(message);
    } catch (e) {
      toast.error(errorMessage(e, "Couldn't update the task"));
    } finally {
      refreshTaskQueries(qc, task.id);
    }
  };
  const complete = () => write({ status: "completed" }, (r) => ({
    message: statusMessage("completed", r, "Completed"),
    undo: statusUndo(task.status, "completed", r),
  }));
  const snooze = () => {
    const at = snoozeTarget(task.dueAt);
    write({ dueAt: at }, (r) => ({ message: "Snoozed to tomorrow", undo: dueUndo(task.dueAt, r) }));
  };
  const openRecord = () => {
    ref.current?.close();
    if (clientId) router.push(`/m/investors/${clientId}` as any);
    else if (leadId) router.push(`/m/leads/${leadId}` as any);
  };

  return (
    <View>
      {hintCandidate && hint.visible ? <SwipeHint text="Swipe right to complete, left to snooze" onDismiss={hint.dismiss} /> : null}
      <ReanimatedSwipeable
        ref={ref}
        friction={2}
        leftThreshold={48}
        rightThreshold={48}
        overshootLeft={false}
        overshootRight={false}
        onSwipeableWillOpen={() => markSwipeHintSeen("tasks")}
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
    </View>
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
