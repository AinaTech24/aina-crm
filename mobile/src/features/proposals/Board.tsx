/**
 * Proposals as a pipeline (web ProposalsBoard): Draft → Sent → Viewed →
 * Accepted → Executed. A card turns red when the client has had it longer
 * than the Proposal Sent stage's follow-up window without deciding. Columns
 * total in rupees as well as counts; rupee values are first-year values (a
 * year of SIPs plus one-time money: shared/items proposalValue).
 */

import React from "react";
import { View, Pressable, ScrollView, StyleSheet } from "react-native";
import { Text } from "../../components/ui/Text";
import type { Proposal } from "./api";
import { itemKindLabel, proposalValue } from "./shared/items";
import { spacing, palette, radius, fontWeight } from "../../theme/tokens";

/** The Proposal Sent stage's follow-up window (blueprint SLA). */
const DECISION_SLA_DAYS = 3;

const COLUMNS: Array<{ key: string; label: string; statuses: string[] }> = [
  { key: "draft", label: "Draft", statuses: ["draft", "ready"] },
  { key: "sent", label: "Sent", statuses: ["sent", "changes_requested"] },
  { key: "viewed", label: "Viewed", statuses: ["viewed"] },
  { key: "accepted", label: "Accepted", statuses: ["accepted", "partially_approved"] },
  { key: "executed", label: "Executed", statuses: ["executed"] },
];

export const lakhs = (n: number) =>
  n >= 1e7 ? `₹${(n / 1e7).toFixed(2)} Cr` : n >= 1e5 ? `₹${(n / 1e5).toFixed(1)} L` : `₹${Math.round(n).toLocaleString("en-IN")}`;

/** Value of what the client took (accepted lines), else of the whole proposal. */
function valueOf(r: Proposal): number {
  const items = Array.isArray(r.products) ? r.products : [];
  const taken = Array.isArray(r.acceptedItems) ? items.filter((_, i) => r.acceptedItems!.includes(i)) : items;
  return proposalValue(taken);
}

const ageDays = (d?: string | null) => (d ? Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 864e5)) : null);

export function boardTotals(rows: Proposal[]): { count: number; proposed: number; executed: number } {
  let proposed = 0, executed = 0, count = 0;
  for (const r of rows) {
    if (r.status === "draft" || r.status === "ready") continue;
    count++;
    proposed += valueOf(r);
    executed += Number(r.executedAmount ?? 0);
  }
  return { count, proposed, executed };
}

export function ProposalsBoard({ rows, preparedBy, onOpen }: { rows: Proposal[]; preparedBy: (id: string | null) => string | null; onOpen: (p: Proposal) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.sm }}>
      {COLUMNS.map((c) => {
        const items = rows.filter((r) => c.statuses.includes(r.status));
        const total = items.reduce((s, r) => s + (c.key === "executed" ? Number(r.executedAmount ?? 0) : valueOf(r)), 0);
        return (
          <View key={c.key} style={styles.col} accessibilityLabel={`${c.label} proposals`}>
            <View style={styles.colHead}>
              <Text variant="label" style={{ fontWeight: fontWeight.semibold, color: palette.ink }}>{c.label}</Text>
              <Text variant="caption" tone="muted">{items.length}{total > 0 ? ` · ${lakhs(total)}` : ""}</Text>
            </View>
            {items.length === 0 ? <Text variant="caption" tone="muted" style={{ padding: spacing.sm }}>None.</Text> : null}
            {items.map((r) => <BoardCard key={r.id} r={r} column={c.key} by={preparedBy(r.preparedByUserId)} onPress={() => onOpen(r)} />)}
          </View>
        );
      })}
    </ScrollView>
  );
}

function BoardCard({ r, column, by, onPress }: { r: Proposal; column: string; by: string | null; onPress: () => void }) {
  const items = Array.isArray(r.products) ? r.products : [];
  const kinds = [...new Set(items.map((i) => itemKindLabel(i)))].slice(0, 2).join(" + ") || "—";
  const value = valueOf(r);
  const waiting = column === "sent" || column === "viewed";
  const age = waiting ? ageDays(r.sentAt) : null;
  const late = waiting && r.status !== "changes_requested" && age != null && age > DECISION_SLA_DAYS;

  let right: string | null = null;
  let rightColor: string = palette.muted;
  if (r.status === "changes_requested") { right = "changes asked"; rightColor = palette.warning; }
  else if (waiting && age != null) { right = late && column === "sent" ? `${age} d, not opened` : `${age} d`; if (late) rightColor = palette.danger; }
  else if (r.status === "partially_approved") right = `${(r.acceptedItems ?? []).length} of ${items.length}`;
  else if (column === "executed") {
    const invested = Number(r.executedAmount ?? 0);
    right = value > 0 ? `${Math.round((invested / value) * 100)}%` : null;
  }

  return (
    <Pressable onPress={onPress} style={[styles.card, late && { borderLeftWidth: 4, borderLeftColor: palette.danger }]} accessibilityRole="button">
      <Text variant="body" numberOfLines={1} style={{ color: palette.ink, fontWeight: fontWeight.semibold }}>{r.recipientName}</Text>
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: spacing.sm, marginTop: 2 }}>
        <Text variant="caption" tone="muted" numberOfLines={1} style={{ flex: 1 }}>
          {column === "executed" ? `${lakhs(Number(r.executedAmount ?? 0))} of ${lakhs(value)}` : `${kinds}${value > 0 ? ` · ${lakhs(value)}` : ""}`}
        </Text>
        {right ? <Text variant="caption" style={{ color: rightColor, fontWeight: late || r.status === "changes_requested" ? fontWeight.semibold : fontWeight.medium }}>{right}</Text> : null}
      </View>
      <Text variant="caption" tone="muted" numberOfLines={1} style={{ marginTop: 4, fontSize: 11 }}>
        {r.proposalNumber}{(r.version ?? 1) > 1 ? ` · v${r.version}` : ""}{by ? ` · ${by}` : ""}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  col: { width: 250, backgroundColor: palette.surfaceSunken, borderRadius: radius.lg, padding: spacing.sm, gap: spacing.sm },
  colHead: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", paddingHorizontal: 4, paddingTop: 4 },
  card: { backgroundColor: palette.surface, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, borderColor: palette.line, padding: spacing.md },
});
