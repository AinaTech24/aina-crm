/**
 * Home — the role dashboard. Greeting + license badge (from /api/me), a KPI card
 * grid and a "Today" worklist of actionable counts (from /api/dashboard/home)
 * that deep-link into the relevant filtered lists.
 */

import React from "react";
import { View, Pressable, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import Animated, { FadeInUp } from "react-native-reanimated";
import { Feather } from "@expo/vector-icons";
import { Screen } from "../../../src/components/ui/Screen";
import { Card } from "../../../src/components/ui/Card";
import { Text } from "../../../src/components/ui/Text";
import { StatusPill } from "../../../src/components/ui/StatusPill";
import { Skeleton } from "../../../src/components/ui/Skeleton";
import { useMe } from "../../../src/api/me";
import { useDashboardHome, type Kpi, type WorklistItem } from "../../../src/features/dashboard/api";
import { inr } from "../../../src/lib/format";
import { spacing, palette, radius } from "../../../src/theme/tokens";
import { toneColors, type Tone } from "../../../src/theme";

const LICENSE_TONE: Record<string, Tone> = {
  active: "success", trial: "info", past_due: "warning", suspended: "danger", expired: "danger", pending: "warning", cancelled: "danger", no_subscription: "neutral",
};

export default function Home() {
  const router = useRouter();
  const me = useMe();
  const dash = useDashboardHome();

  const refetch = () => {
    me.refetch();
    dash.refetch();
  };

  return (
    <Screen scroll padded onRefresh={refetch} refreshing={me.isRefetching || dash.isRefetching} contentStyle={{ paddingTop: spacing.lg, paddingBottom: spacing["3xl"] }}>
      <Animated.View entering={FadeInUp.duration(300)}>
        {me.isLoading ? (
          <View style={{ gap: spacing.sm }}>
            <Skeleton width="55%" height={26} />
            <Skeleton width="35%" height={16} />
          </View>
        ) : (
          <>
            <Text variant="title">Hi, {me.data?.user.name?.split(" ")[0] ?? "there"}</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: 6 }}>
              <Text variant="body" tone="muted">
                {me.data?.user.roleLabel}
              </Text>
              {me.data?.license?.status ? (
                <StatusPill label={me.data.license.status.replace("_", " ")} tone={LICENSE_TONE[me.data.license.status] ?? "neutral"} size="sm" />
              ) : null}
            </View>
          </>
        )}
      </Animated.View>

      {/* KPI grid */}
      <View style={styles.kpiGrid}>
        {dash.isLoading
          ? Array.from({ length: 4 }).map((_, i) => (
              <View key={i} style={styles.kpiCard}>
                <Skeleton width="60%" height={12} />
                <Skeleton width="45%" height={24} style={{ marginTop: 8 }} />
              </View>
            ))
          : (dash.data?.kpis ?? []).map((k: Kpi, i) => (
              <Animated.View key={k.key} entering={FadeInUp.delay(80 + i * 60).duration(300)} style={styles.kpiCard}>
                <Text variant="caption" tone="faint">
                  {k.label.toUpperCase()}
                </Text>
                <Text variant="title" style={{ marginTop: 4 }}>
                  {k.format === "inr" ? inr(k.value) : k.value.toLocaleString("en-IN")}
                </Text>
              </Animated.View>
            ))}
      </View>

      {/* Today worklist */}
      <Text variant="caption" tone="faint" style={{ marginTop: spacing.xl, marginBottom: spacing.sm }}>
        TODAY
      </Text>
      {dash.isLoading ? (
        <Card>
          <Skeleton width="70%" height={16} />
          <Skeleton width="50%" height={14} style={{ marginTop: 10 }} />
        </Card>
      ) : (
        (dash.data?.worklist ?? []).map((w: WorklistItem) => (
          <WorklistRow key={w.key} item={w} onPress={() => router.push(w.href as any)} />
        ))
      )}
    </Screen>
  );
}

function WorklistRow({ item, onPress }: { item: WorklistItem; onPress: () => void }) {
  const { fg, bg } = toneColors(item.tone);
  return (
    <Card onPress={onPress} flat style={{ marginBottom: spacing.sm, flexDirection: "row", alignItems: "center", gap: spacing.md }}>
      <View style={[styles.wlIcon, { backgroundColor: bg }]}>
        <Feather name={item.icon as any} size={18} color={fg} />
      </View>
      <Text variant="body" style={{ flex: 1, color: palette.ink }}>
        {item.label}
      </Text>
      <View style={[styles.count, { backgroundColor: item.count > 0 ? bg : palette.surfaceSunken }]}>
        <Text variant="label" style={{ color: item.count > 0 ? fg : palette.muted }}>
          {item.count}
        </Text>
      </View>
      <Feather name="chevron-right" size={16} color={palette.faint} />
    </Card>
  );
}

const styles = StyleSheet.create({
  kpiGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md, marginTop: spacing.xl },
  kpiCard: { flexBasis: "47%", flexGrow: 1, backgroundColor: palette.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: palette.line, padding: spacing.lg },
  wlIcon: { width: 40, height: 40, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  count: { minWidth: 30, alignItems: "center", borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3 },
});
