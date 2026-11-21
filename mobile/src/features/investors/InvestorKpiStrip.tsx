/**
 * InvestorKpiStrip — the 8-tile Clients KPI strip (mobile parity with the web
 * InvestorKpiStrip): Total clients, Total AUM, Monthly SIP book, A-tier, Reviews
 * due, KYC expiring 30d, Nominee missing, Dormant. Horizontally scrollable.
 * A count tile is tappable: it filters the list to the clients it counts
 * (active clients + the server's quick filter of the same definition), and
 * Total clients clears it.
 */

import React from "react";
import { View, ScrollView, Pressable, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { Text } from "../../components/ui/Text";
import { inr } from "../../lib/format";
import { palette, radius, spacing, fontWeight } from "../../theme/tokens";
import { useInvestorKpis } from "./api";
import { asIcon } from "../../lib/icons";

export type KpiQuick = "" | "tier_a" | "reviews_due" | "kyc_expiring" | "no_nominee" | "dormant";

function Tile({ icon, tone, label, value, sub, onPress, selected }: { icon: string; tone: string; label: string; value: string; sub: string; onPress?: () => void; selected?: boolean }) {
  const body = (
    <View style={[styles.tile, selected && { borderColor: tone, borderWidth: 2, padding: spacing.md - 1 }]}>
      <View style={styles.head}>
        <Feather name={asIcon(icon)} size={13} color={tone} />
        <Text variant="caption" tone="muted" numberOfLines={1}>{label}</Text>
      </View>
      <Text style={{ fontSize: 17, fontWeight: fontWeight.bold }} numberOfLines={1}>{value}</Text>
      <Text variant="caption" tone="faint" numberOfLines={1}>{sub}</Text>
    </View>
  );
  return onPress ? (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: !!selected }} accessibilityLabel={`${label}: ${value}`}>
      {body}
    </Pressable>
  ) : body;
}

export function InvestorKpiStrip({ active = "", onSelect }: { active?: KpiQuick; onSelect?: (q: KpiQuick) => void } = {}) {
  const { data: k } = useInvestorKpis();
  if (!k) return null;
  const tap = (q: KpiQuick) => (onSelect ? () => onSelect(active === q ? "" : q) : undefined);
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
      <Tile icon="users" tone={palette.brand} label="Total clients" value={String(k.totalActive)} sub={`${k.totalAll} all-time`} onPress={onSelect ? () => onSelect("") : undefined} />
      <Tile icon="dollar-sign" tone={palette.success} label="Total AUM" value={inr(k.totalAum)} sub="active clients" />
      <Tile icon="trending-up" tone={palette.success} label="Monthly SIP" value={inr(k.sipBook)} sub="active SIPs" />
      <Tile icon="award" tone={palette.violet} label="A-tier clients" value={String(k.tierA)} sub={`${k.tierAPct}% of book`} onPress={tap("tier_a")} selected={active === "tier_a"} />
      <Tile icon="calendar" tone={palette.warning} label="Reviews due" value={String(k.reviewsDue)} sub="schedule meetings" onPress={tap("reviews_due")} selected={active === "reviews_due"} />
      <Tile icon="shield" tone={palette.danger} label="KYC expiring 30d" value={String(k.kycExpiring)} sub="renew or refresh" onPress={tap("kyc_expiring")} selected={active === "kyc_expiring"} />
      <Tile icon="user-x" tone={palette.warning} label="Nominee missing" value={String(k.nomineeMissing)} sub="transmission risk" onPress={tap("no_nominee")} selected={active === "no_nominee"} />
      <Tile icon="moon" tone={palette.muted} label="Dormant" value={String(k.dormant)} sub="no tx in 180d" onPress={tap("dormant")} selected={active === "dormant"} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  strip: { gap: spacing.sm, paddingVertical: spacing.sm },
  tile: { width: 128, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line, borderRadius: radius.md, padding: spacing.md, gap: 2 },
  head: { flexDirection: "row", alignItems: "center", gap: 4 },
});
