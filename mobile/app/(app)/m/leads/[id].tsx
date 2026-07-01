/**
 * Lead detail. Contact quick-actions, a stage-change bottom sheet
 * (POST /api/leads/[id]/stage), convert-to-client (POST /api/leads/[id]/convert),
 * key pipeline fields, interest products, and notes — from GET /api/leads/[id].
 */

import React, { useState } from "react";
import { View, ScrollView, StyleSheet, Linking, Pressable } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import Animated, { FadeInUp } from "react-native-reanimated";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { ScreenHeader } from "../../../../src/components/ui/ScreenHeader";
import { Card } from "../../../../src/components/ui/Card";
import { Text } from "../../../../src/components/ui/Text";
import { Button } from "../../../../src/components/ui/Button";
import { StatusPill } from "../../../../src/components/ui/StatusPill";
import { Chip } from "../../../../src/components/ui/Chip";
import { BottomSheet } from "../../../../src/components/ui/BottomSheet";
import { LoadingState, ErrorState } from "../../../../src/components/states";
import { useLead, useUpdateLeadStage, LEAD_STAGES } from "../../../../src/features/leads/api";
import { api } from "../../../../src/api/client";
import { inr, initials, titleCase, fmtDate } from "../../../../src/lib/format";
import { leadStageBadge } from "../../../../src/lib/status";
import { palette, radius, spacing } from "../../../../src/theme/tokens";

type FeatherName = React.ComponentProps<typeof Feather>["name"];

export default function LeadDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { data: lead, isLoading, isError, error, refetch } = useLead(id);
  const [stageSheet, setStageSheet] = useState(false);
  const stageMut = useUpdateLeadStage(id!);

  const convertMut = useMutation({
    mutationFn: () => api.post<{ investorId?: string; id?: string }>(`/api/leads/${id}/convert`, {}),
    onSuccess: (res) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      qc.invalidateQueries({ queryKey: ["leads"] });
      const invId = res?.investorId ?? res?.id;
      if (invId) router.replace(`/m/investors/${invId}`);
      else router.back();
    },
  });

  if (isLoading)
    return (
      <View style={styles.screen}>
        <ScreenHeader title="Lead" />
        <LoadingState />
      </View>
    );
  if (isError || !lead)
    return (
      <View style={styles.screen}>
        <ScreenHeader title="Lead" />
        <ErrorState message={(error as any)?.message} onRetry={() => refetch()} />
      </View>
    );

  const stage = leadStageBadge(lead.stage);
  const converted = !!lead.convertedAt;
  const call = () => lead.phone && Linking.openURL(`tel:${lead.phone}`);
  const whatsapp = () => lead.phone && Linking.openURL(`https://wa.me/${String(lead.phone).replace(/[^\d]/g, "")}`);
  const email = () => lead.email && Linking.openURL(`mailto:${lead.email}`);

  const changeStage = (s: string) => {
    setStageSheet(false);
    stageMut.mutate(s);
  };

  return (
    <View style={styles.screen}>
      <ScreenHeader title={lead.name ?? "Lead"} subtitle={titleCase(lead.source) || undefined} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["4xl"] }} showsVerticalScrollIndicator={false}>
        <Animated.View entering={FadeInUp.duration(280)}>
          <Card>
            <View style={{ flexDirection: "row", gap: spacing.md, alignItems: "center" }}>
              <View style={styles.avatar}>
                <Text style={{ color: palette.brandDark, fontWeight: "700", fontSize: 22 }}>{initials(lead.name)}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text variant="title" numberOfLines={1}>
                  {lead.name}
                </Text>
                <Text variant="caption" tone="muted">
                  Intended
                </Text>
                <Text variant="heading" tone="brand">
                  {inr(lead.intendedAmount)}
                </Text>
              </View>
            </View>
            <Pressable onPress={() => !converted && setStageSheet(true)} style={{ marginTop: spacing.lg, flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
              <StatusPill label={converted ? "Converted" : stage.label} tone={converted ? "success" : stage.tone} />
              {!converted ? <Feather name="edit-2" size={14} color={palette.faint} /> : null}
            </Pressable>
          </Card>

          <View style={styles.actions}>
            <ActionButton icon="phone" label="Call" onPress={call} disabled={!lead.phone} />
            <ActionButton icon="message-circle" label="WhatsApp" onPress={whatsapp} disabled={!lead.phone} />
            <ActionButton icon="mail" label="Email" onPress={email} disabled={!lead.email} />
          </View>

          {!converted ? (
            <View style={{ marginTop: spacing.lg }}>
              <Button label="Convert to client" icon={<Feather name="user-check" size={16} color={palette.white} />} onPress={() => convertMut.mutate()} loading={convertMut.isPending} full />
              {convertMut.isError ? (
                <Text variant="label" tone="danger" center style={{ marginTop: spacing.sm }}>
                  {(convertMut.error as any)?.message ?? "Convert failed"}
                </Text>
              ) : null}
            </View>
          ) : null}

          <Card flat style={{ padding: 0, marginTop: spacing.lg }}>
            <Field label="Source" value={titleCase(lead.source)} />
            <Field label="City" value={lead.city} />
            <Field label="Expected business" value={lead.expectedBusinessAmount ? inr(lead.expectedBusinessAmount) : "—"} />
            <Field label="Score" value={lead.scoreBand ? `${titleCase(lead.scoreBand)} (${lead.leadScore ?? lead.score ?? 0})` : String(lead.leadScore ?? lead.score ?? "—")} />
            <Field label="Lead type" value={titleCase(lead.leadType)} />
            <Field label="Last contact" value={fmtDate(lead.lastContactAt)} />
            <Field label="Next follow-up" value={fmtDate(lead.nextFollowUpAt)} last />
          </Card>

          {lead.interestProducts?.length ? (
            <Card style={{ marginTop: spacing.lg }}>
              <Text variant="caption" tone="faint" style={{ marginBottom: spacing.sm }}>
                INTERESTED IN
              </Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
                {lead.interestProducts.map((p) => (
                  <Chip key={p} label={titleCase(p)} onPress={() => {}} />
                ))}
              </View>
            </Card>
          ) : null}

          {lead.notes ? (
            <Card style={{ marginTop: spacing.lg }}>
              <Text variant="caption" tone="faint">
                NOTES
              </Text>
              <Text variant="body" style={{ marginTop: 4 }}>
                {lead.notes}
              </Text>
            </Card>
          ) : null}
        </Animated.View>
      </ScrollView>

      <BottomSheet visible={stageSheet} onClose={() => setStageSheet(false)} title="Move to stage">
        <View style={{ gap: spacing.xs }}>
          {LEAD_STAGES.map((s) => (
            <Pressable key={s.key} onPress={() => changeStage(s.key)} style={styles.stageOption}>
              <Text variant="body" style={{ color: lead.stage === s.key ? palette.brandDark : palette.ink }}>
                {s.label}
              </Text>
              {lead.stage === s.key ? <Feather name="check" size={18} color={palette.brand} /> : null}
            </Pressable>
          ))}
        </View>
      </BottomSheet>
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
    <View style={[styles.field, !last && styles.divider]}>
      <Text variant="label" tone="muted">
        {label}
      </Text>
      <Text variant="body" style={{ color: palette.ink, flexShrink: 1, textAlign: "right" }}>
        {value || "—"}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.surfaceAlt },
  avatar: { width: 60, height: 60, borderRadius: radius.pill, backgroundColor: palette.brandLight, alignItems: "center", justifyContent: "center" },
  actions: { flexDirection: "row", gap: spacing.md, marginTop: spacing.lg },
  action: { flex: 1, alignItems: "center", gap: spacing.xs },
  actionIcon: { width: 52, height: 52, borderRadius: radius.pill, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line, alignItems: "center", justifyContent: "center" },
  field: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: spacing.lg, gap: spacing.md },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line },
  stageOption: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: spacing.md, paddingHorizontal: spacing.sm },
});
