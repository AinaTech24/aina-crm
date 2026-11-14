/**
 * One client on the Risk Profiles list — the web table's row: name (+ Minor),
 * masked PAN, category (a suggestion is marked as one), score, last signed,
 * next review and the status chip of the tab it sits under.
 */

import React from "react";
import { View, StyleSheet, Platform } from "react-native";
import { Card } from "../../components/ui/Card";
import { Text } from "../../components/ui/Text";
import { StatusPill } from "../../components/ui/StatusPill";
import { toneColors, type Tone } from "../../theme";
import { fmtDate } from "../../lib/format";
import { palette, radius, spacing, fontWeight } from "../../theme/tokens";
import { categoryLabel, type RiskBucket } from "./rules";
import type { RiskRow } from "./api";

/** The status chip — computed by the same rule as the tabs, so a row never disagrees with its tab. */
export const BUCKET_PILL: Record<RiskBucket, { label: string; tone: Tone }> = {
  awaiting: { label: "Awaiting confirmation", tone: "warning" },
  not_profiled: { label: "Not profiled", tone: "warning" },
  expired: { label: "Expired", tone: "danger" },
  due: { label: "Due for review", tone: "warning" },
  current: { label: "Current", tone: "success" },
};

/** The web's CATEGORY_TONE. */
const CATEGORY_TONE: Record<string, Tone> = {
  conservative: "info",
  moderate: "success",
  aggressive: "warning",
  very_aggressive: "danger",
};

export function CategoryChip({ category, provisional }: { category: string | null; provisional: boolean }) {
  if (!category) return <Text variant="caption" tone="faint">—</Text>;
  const c = provisional ? { fg: palette.muted, bg: palette.surfaceSunken } : toneColors(CATEGORY_TONE[category] ?? "neutral");
  return (
    <View style={[styles.cat, { backgroundColor: c.bg }, provisional && styles.catSuggested]}>
      <Text variant="caption" style={{ color: c.fg, fontWeight: fontWeight.semibold }}>
        {categoryLabel(category)}{provisional ? " · suggested" : ""}
      </Text>
    </View>
  );
}

export function MinorBadge() {
  return (
    <View style={styles.minor}>
      <Text variant="caption" style={{ color: palette.ink70, fontWeight: fontWeight.semibold }}>Minor</Text>
    </View>
  );
}

export function RiskRowCard({ r, onPress }: { r: RiskRow; onPress: () => void }) {
  const pill = BUCKET_PILL[r.bucket];
  return (
    <Card onPress={onPress} style={{ marginBottom: spacing.sm }}>
      <View style={styles.top}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={styles.nameRow}>
            <Text variant="subtitle" numberOfLines={1} style={{ flexShrink: 1 }}>{r.name}</Text>
            {r.isMinor ? <MinorBadge /> : null}
          </View>
          {r.pan ? <Text variant="caption" tone="muted" style={styles.mono}>{r.pan}</Text> : null}
        </View>
        <StatusPill label={pill.label} tone={pill.tone} size="sm" />
      </View>
      <View style={styles.meta}>
        <CategoryChip category={r.category} provisional={r.provisional} />
        {r.score != null ? <Text variant="caption" tone="muted">Score {r.score}</Text> : null}
        <Text variant="caption" tone="muted">{r.signedAt ? `Signed ${fmtDate(r.signedAt)}` : "Not yet signed"}</Text>
        {r.nextReviewAt ? <Text variant="caption" tone="muted">Review {fmtDate(r.nextReviewAt)}</Text> : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  nameRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  mono: { fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }), marginTop: 2 },
  meta: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm, marginTop: spacing.sm },
  cat: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.pill },
  catSuggested: { borderWidth: 1, borderStyle: "dashed", borderColor: palette.line },
  minor: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: radius.sm, backgroundColor: palette.surfaceSunken },
});
