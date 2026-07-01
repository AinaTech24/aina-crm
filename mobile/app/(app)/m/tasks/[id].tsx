/**
 * Task detail. Complete / change status (PATCH /api/tasks/[id]) via a bottom
 * sheet, plus priority/type/due/description and a link to the related client or
 * lead. From GET /api/tasks/[id].
 */

import React, { useState } from "react";
import { View, ScrollView, StyleSheet, Pressable } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import Animated, { FadeInUp } from "react-native-reanimated";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { ScreenHeader } from "../../../../src/components/ui/ScreenHeader";
import { Card } from "../../../../src/components/ui/Card";
import { Text } from "../../../../src/components/ui/Text";
import { Button } from "../../../../src/components/ui/Button";
import { StatusPill } from "../../../../src/components/ui/StatusPill";
import { BottomSheet } from "../../../../src/components/ui/BottomSheet";
import { LoadingState, ErrorState } from "../../../../src/components/states";
import { useTask, useUpdateTask, TASK_PRIORITY_TONE } from "../../../../src/features/tasks/api";
import { titleCase, fmtDate } from "../../../../src/lib/format";
import { taskStatusBadge } from "../../../../src/lib/status";
import { palette, radius, spacing } from "../../../../src/theme/tokens";

const STATUSES = ["open", "in_progress", "blocked", "completed", "cancelled"];

export default function TaskDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { data: task, isLoading, isError, error, refetch } = useTask(id);
  const update = useUpdateTask(id!);
  const [sheet, setSheet] = useState(false);

  if (isLoading)
    return (
      <View style={styles.screen}>
        <ScreenHeader title="Task" />
        <LoadingState />
      </View>
    );
  if (isError || !task)
    return (
      <View style={styles.screen}>
        <ScreenHeader title="Task" />
        <ErrorState message={(error as any)?.message} onRetry={() => refetch()} />
      </View>
    );

  const status = taskStatusBadge(task.status);
  const done = task.status === "completed";
  const setStatus = (s: string) => {
    setSheet(false);
    Haptics.selectionAsync().catch(() => {});
    update.mutate({ status: s });
  };

  const relatedHref = task.relatedInvestorId
    ? `/m/investors/${task.relatedInvestorId}`
    : task.relatedLeadId
    ? `/m/leads/${task.relatedLeadId}`
    : null;

  return (
    <View style={styles.screen}>
      <ScreenHeader title="Task" subtitle={titleCase(task.type) || undefined} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["4xl"] }} showsVerticalScrollIndicator={false}>
        <Animated.View entering={FadeInUp.duration(280)}>
          <Card>
            <Text variant="title">{task.title}</Text>
            <Pressable onPress={() => setSheet(true)} style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.md }}>
              <StatusPill label={status.label} tone={status.tone} />
              {task.priority ? <StatusPill label={titleCase(task.priority)} tone={TASK_PRIORITY_TONE[task.priority] ?? "neutral"} dot={false} /> : null}
              <Feather name="edit-2" size={14} color={palette.faint} />
            </Pressable>
          </Card>

          {!done ? (
            <View style={{ marginTop: spacing.lg }}>
              <Button label="Mark complete" icon={<Feather name="check" size={16} color={palette.white} />} onPress={() => setStatus("completed")} loading={update.isPending} full />
            </View>
          ) : null}

          <Card flat style={{ padding: 0, marginTop: spacing.lg }}>
            <Field label="Type" value={titleCase(task.type)} />
            <Field label="Priority" value={titleCase(task.priority)} />
            <Field label="Department" value={titleCase(task.department)} />
            <Field label="Due" value={fmtDate(task.dueAt)} />
            <Field label="SLA due" value={fmtDate(task.slaDueAt)} />
            <Field label="Completed" value={fmtDate(task.completedAt)} last />
          </Card>

          {task.description ? (
            <Card style={{ marginTop: spacing.lg }}>
              <Text variant="caption" tone="faint">
                DESCRIPTION
              </Text>
              <Text variant="body" style={{ marginTop: 4 }}>
                {task.description}
              </Text>
            </Card>
          ) : null}

          {relatedHref ? (
            <Pressable onPress={() => router.push(relatedHref as any)} style={{ marginTop: spacing.lg }}>
              <Card flat style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
                <Feather name={task.relatedInvestorId ? "user" : "trending-up"} size={18} color={palette.brandDark} />
                <Text variant="body" style={{ flex: 1, color: palette.ink }}>
                  Open related {task.relatedInvestorId ? "client" : "lead"}
                </Text>
                <Feather name="chevron-right" size={16} color={palette.faint} />
              </Card>
            </Pressable>
          ) : null}
        </Animated.View>
      </ScrollView>

      <BottomSheet visible={sheet} onClose={() => setSheet(false)} title="Set status">
        <View style={{ gap: spacing.xs }}>
          {STATUSES.map((s) => (
            <Pressable key={s} onPress={() => setStatus(s)} style={styles.option}>
              <Text variant="body" style={{ color: task.status === s ? palette.brandDark : palette.ink }}>
                {titleCase(s)}
              </Text>
              {task.status === s ? <Feather name="check" size={18} color={palette.brand} /> : null}
            </Pressable>
          ))}
        </View>
      </BottomSheet>
    </View>
  );
}

function Field({ label, value, last }: { label: string; value?: string | null; last?: boolean }) {
  return (
    <View style={[styles.field, !last && styles.divider]}>
      <Text variant="label" tone="muted">
        {label}
      </Text>
      <Text variant="body" style={{ color: palette.ink }}>
        {value || "—"}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.surfaceAlt },
  field: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: spacing.lg },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line },
  option: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: spacing.md, paddingHorizontal: spacing.sm },
});
