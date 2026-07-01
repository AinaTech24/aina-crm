/**
 * FamilyCard — one household in the Families list. Head name, family code /
 * category, health band, and a review-due flag.
 */

import React from "react";
import { View, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { Card } from "../ui/Card";
import { Text } from "../ui/Text";
import { StatusPill } from "../ui/StatusPill";
import { palette, radius, spacing } from "../../theme/tokens";
import { initials, titleCase, fmtDate } from "../../lib/format";
import { healthBadge } from "../../lib/status";
import type { Family } from "../../features/families/api";

export function FamilyCard({ family, onPress }: { family: Family; onPress: () => void }) {
  const health = healthBadge(family.healthBand);
  const reviewDue = !!family.nextReviewAt && new Date(family.nextReviewAt).getTime() <= Date.now();
  const title = family.headName ?? family.familyName ?? "Family";

  return (
    <Card onPress={onPress} style={{ marginBottom: spacing.md }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
        <View style={styles.avatar}>
          <Feather name="home" size={20} color={palette.violet} />
        </View>
        <View style={{ flex: 1, gap: 3 }}>
          <Text variant="subtitle" numberOfLines={1}>
            {title}
          </Text>
          <Text variant="caption" tone="muted">
            {family.familyCode ?? "No code"}
            {family.familyCategory ? ` · ${titleCase(family.familyCategory)}` : ""}
          </Text>
          <View style={styles.badges}>
            <StatusPill label={health.label} tone={health.tone} size="sm" />
            {reviewDue ? <StatusPill label="Review due" tone="warning" size="sm" dot={false} /> : null}
          </View>
        </View>
        {family.nextReviewAt ? (
          <View style={{ alignItems: "flex-end" }}>
            <Text variant="caption" tone="faint">
              Next review
            </Text>
            <Text variant="label">{fmtDate(family.nextReviewAt)}</Text>
          </View>
        ) : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  avatar: { width: 46, height: 46, borderRadius: radius.pill, backgroundColor: palette.violetBg, alignItems: "center", justifyContent: "center" },
  badges: { flexDirection: "row", gap: spacing.xs, flexWrap: "wrap", marginTop: 2 },
});
