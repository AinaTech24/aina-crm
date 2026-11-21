/**
 * InvestorCard — one client in the Clients list, in two lines so six or seven
 * fit a phone screen:
 *   ● Name ............................. AUM
 *     ••••••234F · RM Priya Shah    KYC Hold
 * The dot is the health band (grey ring: not scored). AUM with nothing on
 * record is "—", never ₹0. The KYC flag appears only when KYC needs action.
 * Tap opens the 360° detail; long-press raises row actions. Call and WhatsApp
 * are a swipe away (features/lists/SwipeableClientRow).
 */

import React from "react";
import { View, StyleSheet } from "react-native";
import { Card } from "../ui/Card";
import { Text } from "../ui/Text";
import { palette, spacing, fontWeight } from "../../theme/tokens";
import { toneColors } from "../../theme";
import { kycBadge } from "../../lib/status";
import { aumLabel, clientSubLine, kycNeedsAttention } from "../../features/lists/clientRow";
import type { Investor } from "../../features/investors/api";

export const HEALTH_DOT: Record<string, string> = { green: palette.success, amber: palette.warning, red: palette.danger };

export function InvestorCard({ investor, onPress, onLongPress, rmName }: {
  investor: Investor;
  onPress: () => void;
  onLongPress?: () => void;
  /** The client's RM, when the list knows the name. */
  rmName?: string | null;
}) {
  const dot = investor.healthBand ? HEALTH_DOT[investor.healthBand] : undefined;
  const aum = aumLabel(investor.aum);
  const kyc = kycNeedsAttention(investor.kycStatus) ? kycBadge(investor.kycStatus) : null;

  return (
    <Card onPress={onPress} onLongPress={onLongPress} padded={false} style={styles.card}>
      <View style={styles.line}>
        <View style={[styles.dot, dot ? { backgroundColor: dot, borderColor: dot } : null]} />
        <Text variant="subtitle" numberOfLines={1} style={{ flex: 1 }}>{investor.name}</Text>
        <Text variant="subtitle" style={aum === "—" ? { color: palette.muted } : undefined} numberOfLines={1}>{aum}</Text>
      </View>
      <View style={[styles.line, styles.sub]}>
        <Text variant="caption" tone="muted" numberOfLines={1} style={{ flex: 1 }}>{clientSubLine(investor.pan, rmName)}</Text>
        {kyc ? <Text variant="caption" style={{ color: toneColors(kyc.tone).fg, fontWeight: fontWeight.semibold }} numberOfLines={1}>{kyc.label}</Text> : null}
      </View>
    </Card>
  );
}

const DOT = 10;

const styles = StyleSheet.create({
  card: { marginBottom: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.md - 2 },
  line: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  sub: { marginTop: 2, paddingLeft: DOT + spacing.sm },
  dot: { width: DOT, height: DOT, borderRadius: DOT / 2, borderWidth: 1.5, borderColor: palette.line },
});
