/**
 * Client 360° detail. Loads GET /api/investors/[id]. Hero (name + badges + AUM),
 * one-tap contact actions (call / WhatsApp / email), and an Overview of the key
 * KYC/segment/tier fields. Activity + Documents tabs wire to their sub-APIs next.
 */

import React, { useState } from "react";
import { View, ScrollView, StyleSheet, Linking, Pressable } from "react-native";
import { useLocalSearchParams } from "expo-router";
import Animated, { FadeInUp } from "react-native-reanimated";
import { Feather } from "@expo/vector-icons";
import { ScreenHeader } from "../../../../src/components/ui/ScreenHeader";
import { Card } from "../../../../src/components/ui/Card";
import { Text } from "../../../../src/components/ui/Text";
import { StatusPill } from "../../../../src/components/ui/StatusPill";
import { LoadingState, ErrorState, EmptyState } from "../../../../src/components/states";
import { useInvestor } from "../../../../src/features/investors/api";
import { inr, initials, titleCase, fmtDate } from "../../../../src/lib/format";
import { investorStatusBadge, kycBadge, healthBadge } from "../../../../src/lib/status";
import { palette, radius, spacing } from "../../../../src/theme/tokens";

type FeatherName = React.ComponentProps<typeof Feather>["name"];
const TABS = ["Overview", "Activity", "Documents"] as const;

export default function InvestorDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, isLoading, isError, error, refetch } = useInvestor(id);
  const [tab, setTab] = useState<(typeof TABS)[number]>("Overview");

  const inv: any = (data as any)?.investor ?? data;

  if (isLoading) {
    return (
      <View style={styles.screen}>
        <ScreenHeader title="Client" />
        <LoadingState />
      </View>
    );
  }
  if (isError || !inv) {
    return (
      <View style={styles.screen}>
        <ScreenHeader title="Client" />
        <ErrorState message={(error as any)?.message} onRetry={() => refetch()} />
      </View>
    );
  }

  const status = investorStatusBadge(inv.status);
  const kyc = kycBadge(inv.kycStatus);
  const health = healthBadge(inv.healthBand);

  const call = () => inv.phone && Linking.openURL(`tel:${inv.phone}`);
  const whatsapp = () => inv.phone && Linking.openURL(`https://wa.me/${String(inv.phone).replace(/[^\d]/g, "")}`);
  const email = () => inv.email && Linking.openURL(`mailto:${inv.email}`);

  return (
    <View style={styles.screen}>
      <ScreenHeader title={inv.name ?? "Client"} subtitle={inv.pan ?? undefined} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["4xl"] }} showsVerticalScrollIndicator={false}>
        <Animated.View entering={FadeInUp.duration(280)}>
          {/* Hero */}
          <Card>
            <View style={{ flexDirection: "row", gap: spacing.md, alignItems: "center" }}>
              <View style={styles.avatar}>
                <Text style={{ color: palette.brandDark, fontWeight: "700", fontSize: 22 }}>{initials(inv.name)}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text variant="title" numberOfLines={1}>
                  {inv.name}
                </Text>
                <Text variant="caption" tone="muted">
                  AUM
                </Text>
                <Text variant="heading" tone="brand">
                  {inr(inv.aum)}
                </Text>
              </View>
            </View>
            <View style={styles.badges}>
              <StatusPill label={status.label} tone={status.tone} />
              <StatusPill label={kyc.label} tone={kyc.tone} dot={false} />
              <StatusPill label={health.label} tone={health.tone} dot={false} />
            </View>
          </Card>

          {/* Contact quick-actions */}
          <View style={styles.actions}>
            <ActionButton icon="phone" label="Call" onPress={call} disabled={!inv.phone} />
            <ActionButton icon="message-circle" label="WhatsApp" onPress={whatsapp} disabled={!inv.phone} />
            <ActionButton icon="mail" label="Email" onPress={email} disabled={!inv.email} />
          </View>

          {/* Tabs */}
          <View style={styles.tabs}>
            {TABS.map((t) => (
              <Pressable key={t} onPress={() => setTab(t)} style={[styles.tab, tab === t && styles.tabActive]}>
                <Text variant="label" style={{ color: tab === t ? palette.brandDark : palette.muted }}>
                  {t}
                </Text>
              </Pressable>
            ))}
          </View>

          {tab === "Overview" ? (
            <Card flat style={{ padding: 0 }}>
              <Field label="PAN" value={inv.pan} />
              <Field label="Phone" value={inv.phone} />
              <Field label="Email" value={inv.email} />
              <Field label="Segment" value={titleCase(inv.segmentTag)} />
              <Field label="Service Tier" value={inv.serviceTier ? `Tier ${String(inv.serviceTier).toUpperCase()}` : "—"} />
              <Field label="Client Type" value={titleCase(inv.clientType ?? inv.investorType)} />
              <Field label="Health Score" value={inv.healthScore != null ? `${inv.healthScore}/100` : "—"} />
              <Field label="Last Review" value={fmtDate(inv.lastReviewAt) || "—"} last />
            </Card>
          ) : (
            <Card>
              <EmptyState
                icon={tab === "Activity" ? "clock" : "folder"}
                title={`${tab} coming next`}
                message={
                  tab === "Activity"
                    ? "Calls, visits and notes for this client — from /api/activities."
                    : "KYC & documents with camera scan — from /api/investors/[id]/documents."
                }
              />
            </Card>
          )}
        </Animated.View>
      </ScrollView>
    </View>
  );
}

function ActionButton({ icon, label, onPress, disabled }: { icon: FeatherName; label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={[styles.action, disabled && { opacity: 0.4 }]}>
      <View style={styles.actionIcon}>
        <Feather name={icon} size={20} color={palette.brandDark} />
      </View>
      <Text variant="caption" tone="muted">
        {label}
      </Text>
    </Pressable>
  );
}

function Field({ label, value, last }: { label: string; value?: string | null; last?: boolean }) {
  return (
    <View style={[styles.field, !last && styles.fieldDivider]}>
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
  avatar: { width: 60, height: 60, borderRadius: radius.pill, backgroundColor: palette.brandLight, alignItems: "center", justifyContent: "center" },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.lg },
  actions: { flexDirection: "row", gap: spacing.md, marginTop: spacing.lg },
  action: { flex: 1, alignItems: "center", gap: spacing.xs },
  actionIcon: { width: 52, height: 52, borderRadius: radius.pill, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line, alignItems: "center", justifyContent: "center" },
  tabs: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.xl, marginBottom: spacing.md },
  tab: { paddingVertical: spacing.sm, paddingHorizontal: spacing.lg, borderRadius: radius.pill, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line },
  tabActive: { backgroundColor: palette.brandLight, borderColor: palette.brandTint },
  field: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: spacing.lg },
  fieldDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line },
});
