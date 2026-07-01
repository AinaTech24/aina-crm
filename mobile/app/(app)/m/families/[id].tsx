/**
 * Family detail. Household head + health + review cadence and key fields, from
 * GET /api/families/[id]. Member management maps to the web add/remove APIs next.
 */

import React from "react";
import { View, ScrollView, StyleSheet } from "react-native";
import { useLocalSearchParams } from "expo-router";
import Animated, { FadeInUp } from "react-native-reanimated";
import { Feather } from "@expo/vector-icons";
import { ScreenHeader } from "../../../../src/components/ui/ScreenHeader";
import { Card } from "../../../../src/components/ui/Card";
import { Text } from "../../../../src/components/ui/Text";
import { StatusPill } from "../../../../src/components/ui/StatusPill";
import { LoadingState, ErrorState } from "../../../../src/components/states";
import { useFamily } from "../../../../src/features/families/api";
import { titleCase, fmtDate } from "../../../../src/lib/format";
import { healthBadge } from "../../../../src/lib/status";
import { palette, radius, spacing } from "../../../../src/theme/tokens";

export default function FamilyDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: f, isLoading, isError, error, refetch } = useFamily(id);

  if (isLoading)
    return (
      <View style={styles.screen}>
        <ScreenHeader title="Family" />
        <LoadingState />
      </View>
    );
  if (isError || !f)
    return (
      <View style={styles.screen}>
        <ScreenHeader title="Family" />
        <ErrorState message={(error as any)?.message} onRetry={() => refetch()} />
      </View>
    );

  const health = healthBadge(f.healthBand);
  const title = f.headName ?? f.familyName ?? "Family";

  return (
    <View style={styles.screen}>
      <ScreenHeader title={title} subtitle={f.familyCode ?? undefined} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["4xl"] }} showsVerticalScrollIndicator={false}>
        <Animated.View entering={FadeInUp.duration(280)}>
          <Card>
            <View style={{ flexDirection: "row", gap: spacing.md, alignItems: "center" }}>
              <View style={styles.avatar}>
                <Feather name="home" size={26} color={palette.violet} />
              </View>
              <View style={{ flex: 1 }}>
                <Text variant="title" numberOfLines={1}>
                  {title}
                </Text>
                <Text variant="caption" tone="muted">
                  Health {f.healthScore ?? "—"}/100
                </Text>
              </View>
            </View>
            <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.lg }}>
              <StatusPill label={health.label} tone={health.tone} />
              {f.familyCategory ? <StatusPill label={titleCase(f.familyCategory)} tone="neutral" dot={false} /> : null}
            </View>
          </Card>

          <Card flat style={{ padding: 0, marginTop: spacing.lg }}>
            <Field label="Family code" value={f.familyCode} />
            <Field label="Category" value={titleCase(f.familyCategory)} />
            <Field label="Review frequency" value={titleCase(f.reviewFrequency)} />
            <Field label="Last review" value={fmtDate(f.lastReviewAt)} />
            <Field label="Next review" value={fmtDate(f.nextReviewAt)} />
            <Field label="First meeting" value={fmtDate(f.firstMeetingDate)} last />
          </Card>

          {f.notes ? (
            <Card style={{ marginTop: spacing.lg }}>
              <Text variant="caption" tone="faint">
                NOTES
              </Text>
              <Text variant="body" style={{ marginTop: 4 }}>
                {f.notes}
              </Text>
            </Card>
          ) : null}
        </Animated.View>
      </ScrollView>
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
  avatar: { width: 60, height: 60, borderRadius: radius.pill, backgroundColor: palette.violetBg, alignItems: "center", justifyContent: "center" },
  field: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: spacing.lg },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line },
});
