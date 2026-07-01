/**
 * LeadCard — one lead. Two densities: full (list) and compact (board column).
 */

import React from "react";
import { View, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { Card } from "../ui/Card";
import { Text } from "../ui/Text";
import { StatusPill } from "../ui/StatusPill";
import { palette, radius, spacing } from "../../theme/tokens";
import { inr, initials, titleCase, fmtDate } from "../../lib/format";
import { leadStageBadge } from "../../lib/status";
import type { Lead } from "../../features/leads/api";

export function LeadCard({ lead, onPress, compact }: { lead: Lead; onPress: () => void; compact?: boolean }) {
  const stage = leadStageBadge(lead.stage);
  const overdue = !!lead.nextFollowUpAt && new Date(lead.nextFollowUpAt).getTime() < Date.now() && !lead.convertedAt;

  if (compact) {
    return (
      <Card onPress={onPress} style={styles.compact} padded={false}>
        <Text variant="label" numberOfLines={1}>
          {lead.name ?? "Lead"}
        </Text>
        <Text variant="caption" tone="muted" numberOfLines={1}>
          {inr(lead.intendedAmount)} · {titleCase(lead.source)}
        </Text>
        {overdue ? <StatusPill label="Overdue" tone="danger" size="sm" dot={false} /> : null}
      </Card>
    );
  }

  return (
    <Card onPress={onPress} style={{ marginBottom: spacing.md }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
        <View style={styles.avatar}>
          <Text style={{ color: palette.brandDark, fontWeight: "700" }}>{initials(lead.name)}</Text>
        </View>
        <View style={{ flex: 1, gap: 3 }}>
          <Text variant="subtitle" numberOfLines={1}>
            {lead.name ?? "Lead"}
          </Text>
          <Text variant="caption" tone="muted">
            {titleCase(lead.source) || "—"}
            {lead.city ? ` · ${lead.city}` : ""}
          </Text>
          <View style={styles.badges}>
            <StatusPill label={stage.label} tone={stage.tone} size="sm" />
            {overdue ? <StatusPill label="Follow-up overdue" tone="danger" size="sm" dot={false} /> : null}
          </View>
        </View>
        <View style={{ alignItems: "flex-end", gap: 2 }}>
          <Text variant="caption" tone="faint">
            Intended
          </Text>
          <Text variant="subtitle">{inr(lead.intendedAmount)}</Text>
          {lead.nextFollowUpAt ? (
            <Text variant="caption" tone={overdue ? "danger" : "muted"}>
              {fmtDate(lead.nextFollowUpAt)}
            </Text>
          ) : null}
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  avatar: { width: 46, height: 46, borderRadius: radius.pill, backgroundColor: palette.brandLight, alignItems: "center", justifyContent: "center" },
  badges: { flexDirection: "row", gap: spacing.xs, flexWrap: "wrap", marginTop: 2 },
  compact: { marginBottom: spacing.sm, padding: spacing.md, gap: 4, width: 200 },
});
