/**
 * Meeting detail. Subject, schedule, mode, status + outcome, discussion points,
 * notes and action items. From GET /api/review-meetings/[id].
 */

import React from "react";
import { View, ScrollView, StyleSheet } from "react-native";
import { useLocalSearchParams } from "expo-router";
import Animated, { FadeInUp } from "react-native-reanimated";
import { ScreenHeader } from "../../../../src/components/ui/ScreenHeader";
import { Card } from "../../../../src/components/ui/Card";
import { Text } from "../../../../src/components/ui/Text";
import { StatusPill } from "../../../../src/components/ui/StatusPill";
import { LoadingState, ErrorState } from "../../../../src/components/states";
import { useMeeting } from "../../../../src/features/meetings/api";
import { meetingStatusBadge } from "../../../../src/lib/status";
import { titleCase, fmtDate } from "../../../../src/lib/format";
import { palette, spacing } from "../../../../src/theme/tokens";

export default function MeetingDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: m, isLoading, isError, error, refetch } = useMeeting(id);

  if (isLoading)
    return (
      <View style={styles.screen}>
        <ScreenHeader title="Meeting" />
        <LoadingState />
      </View>
    );
  if (isError || !m)
    return (
      <View style={styles.screen}>
        <ScreenHeader title="Meeting" />
        <ErrorState message={(error as any)?.message} onRetry={() => refetch()} />
      </View>
    );

  const st = meetingStatusBadge(m.status);
  const actions: any[] = Array.isArray(m.actionItems) ? m.actionItems : [];

  return (
    <View style={styles.screen}>
      <ScreenHeader title={m.subject ?? "Meeting"} subtitle={titleCase(m.meetingType) || undefined} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["4xl"] }} showsVerticalScrollIndicator={false}>
        <Animated.View entering={FadeInUp.duration(280)}>
          <Card>
            <Text variant="title">{m.subject ?? titleCase(m.meetingType) ?? "Meeting"}</Text>
            <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.md, flexWrap: "wrap" }}>
              <StatusPill label={st.label} tone={st.tone} />
              {m.outcome ? <StatusPill label={titleCase(m.outcome)} tone="neutral" dot={false} /> : null}
            </View>
          </Card>

          <Card flat style={{ padding: 0, marginTop: spacing.lg }}>
            <Field label="Date" value={fmtDate(m.meetingDate)} />
            <Field label="Mode" value={titleCase(m.meetingMode)} />
            <Field label="Location / Link" value={m.locationOrLink} />
            <Field label="Duration" value={m.durationMinutes ? `${m.durationMinutes} min` : "—"} />
            <Field label="Category" value={titleCase(m.category)} last />
          </Card>

          {m.discussionPoints ? (
            <Section title="DISCUSSION" body={m.discussionPoints} />
          ) : null}
          {m.meetingNotes ? <Section title="NOTES" body={m.meetingNotes} /> : null}
          {m.outcomeNotes ? <Section title="OUTCOME" body={m.outcomeNotes} /> : null}

          {actions.length ? (
            <Card style={{ marginTop: spacing.lg }}>
              <Text variant="caption" tone="faint" style={{ marginBottom: spacing.sm }}>
                ACTION ITEMS
              </Text>
              {actions.map((a, i) => (
                <View key={i} style={styles.actionItem}>
                  <Text variant="body">• {typeof a === "string" ? a : a.title ?? a.text ?? JSON.stringify(a)}</Text>
                </View>
              ))}
            </Card>
          ) : null}
        </Animated.View>
      </ScrollView>
    </View>
  );
}

function Section({ title, body }: { title: string; body: string }) {
  return (
    <Card style={{ marginTop: spacing.lg }}>
      <Text variant="caption" tone="faint">
        {title}
      </Text>
      <Text variant="body" style={{ marginTop: 4 }}>
        {body}
      </Text>
    </Card>
  );
}

function Field({ label, value, last }: { label: string; value?: string | null; last?: boolean }) {
  return (
    <View style={[styles.field, !last && styles.divider]}>
      <Text variant="label" tone="muted">
        {label}
      </Text>
      <Text variant="body" style={{ color: palette.ink, flexShrink: 1, textAlign: "right" }}>
        {value || "—"}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.surfaceAlt },
  field: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: spacing.lg, gap: spacing.md },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line },
  actionItem: { paddingVertical: spacing.xs },
});
