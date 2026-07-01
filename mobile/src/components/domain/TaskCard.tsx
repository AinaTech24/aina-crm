/**
 * TaskCard — one task. Title, status + priority badges, type, and due date with
 * an overdue flag. A left color rail encodes priority at a glance.
 */

import React from "react";
import { View, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { Card } from "../ui/Card";
import { Text } from "../ui/Text";
import { StatusPill } from "../ui/StatusPill";
import { palette, radius, spacing } from "../../theme/tokens";
import { titleCase, fmtDate } from "../../lib/format";
import { taskStatusBadge } from "../../lib/status";
import { TASK_PRIORITY_TONE, type Task } from "../../features/tasks/api";
import { toneColors } from "../../theme";

const TYPE_ICON: Record<string, React.ComponentProps<typeof Feather>["name"]> = {
  call: "phone",
  email: "mail",
  meeting: "calendar",
  followup: "corner-up-right",
  proposal: "file-text",
  document: "file",
  other: "check-square",
};

export function TaskCard({ task, onPress }: { task: Task; onPress: () => void }) {
  const status = taskStatusBadge(task.status);
  const priTone = TASK_PRIORITY_TONE[task.priority ?? ""] ?? "neutral";
  const rail = toneColors(priTone).fg;
  const overdue = ["open", "in_progress", "blocked"].includes(task.status ?? "") && !!task.dueAt && new Date(task.dueAt).getTime() < Date.now();
  const done = task.status === "completed";

  return (
    <Card onPress={onPress} style={{ marginBottom: spacing.md, overflow: "hidden" }}>
      <View style={[styles.rail, { backgroundColor: rail }]} />
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, paddingLeft: spacing.sm }}>
        <View style={styles.icon}>
          <Feather name={done ? "check" : TYPE_ICON[task.type ?? "other"] ?? "check-square"} size={18} color={done ? palette.success : palette.muted} />
        </View>
        <View style={{ flex: 1, gap: 3 }}>
          <Text variant="subtitle" numberOfLines={2} style={done ? { textDecorationLine: "line-through", color: palette.faint } : undefined}>
            {task.title ?? "Task"}
          </Text>
          <View style={styles.badges}>
            <StatusPill label={status.label} tone={status.tone} size="sm" />
            {task.priority ? <StatusPill label={titleCase(task.priority)} tone={priTone} size="sm" dot={false} /> : null}
          </View>
        </View>
        {task.dueAt ? (
          <View style={{ alignItems: "flex-end" }}>
            <Text variant="caption" tone="faint">
              Due
            </Text>
            <Text variant="label" tone={overdue ? "danger" : "muted"}>
              {fmtDate(task.dueAt)}
            </Text>
          </View>
        ) : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  rail: { position: "absolute", left: 0, top: 0, bottom: 0, width: 4 },
  icon: { width: 40, height: 40, borderRadius: radius.pill, backgroundColor: palette.surfaceSunken, alignItems: "center", justifyContent: "center" },
  badges: { flexDirection: "row", gap: spacing.xs, flexWrap: "wrap", marginTop: 2 },
});
