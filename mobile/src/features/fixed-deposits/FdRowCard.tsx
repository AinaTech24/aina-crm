/** One fixed deposit in a list — the client (or the issuer, on a client's own
 *  page), amount and rate, and when it matures (amber within 30 days, red once
 *  past while still live). */

import React from "react";
import { View, Pressable } from "react-native";
import { Card } from "../../components/ui/Card";
import { Text } from "../../components/ui/Text";
import { StatusPill } from "../../components/ui/StatusPill";
import { inr, fmtDate } from "../../lib/format";
import { palette, spacing, fontWeight } from "../../theme/tokens";
import { STATUS_LABELS, PAYOUT_SHORT, indiaToday, daysBetween, isLive } from "./terms";
import type { FdRow } from "./api";

export function FdRowCard({ r, onPress, showClient }: { r: FdRow; onPress: () => void; showClient?: boolean }) {
  const today = indiaToday();
  const left = daysBetween(today, r.maturityDate);
  const live = isLive(r.status);
  const due = live && left < 0 ? { label: "Past maturity", color: palette.danger } : live && left <= 30 ? { label: `Matures in ${left} day${left === 1 ? "" : "s"}`, color: palette.warning } : null;
  return (
    <Pressable onPress={onPress} accessibilityRole="button">
      <Card style={{ marginBottom: spacing.sm }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <Text variant="body" style={{ flex: 1, fontWeight: fontWeight.semibold }} numberOfLines={1}>{showClient ? r.investorName : r.issuer}</Text>
          <StatusPill label={STATUS_LABELS[r.status] ?? r.status} tone={live ? "success" : r.status === "cancelled" ? "danger" : "neutral"} size="sm" />
        </View>
        <Text variant="caption" tone="muted" numberOfLines={1} style={{ marginTop: 2 }}>
          {showClient ? `${r.issuer} · ` : ""}{inr(r.principal)} @ {r.interestRate}% · {PAYOUT_SHORT[r.payout] ?? r.payout}
        </Text>
        <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: spacing.xs }}>
          <Text variant="caption" style={{ color: due?.color ?? palette.muted }}>{due?.label ?? `Matures ${fmtDate(r.maturityDate)}`}</Text>
          {r.maturityAmount ? <Text variant="caption" tone="faint">{inr(r.maturityAmount)} at maturity</Text> : null}
        </View>
      </Card>
    </Pressable>
  );
}
