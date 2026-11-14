/**
 * One client's risk profile (the route id is the CLIENT's id, as the web list
 * is one row per client): the current category and score, its status by the
 * same rule as the list's tabs, how and when it was taken, the latest answers,
 * every profile on record with its PDF / signed form, and the web's actions —
 * Start / Re-profile, Send link, Upload risk profile.
 *
 * A suggestion from age is shown as one: provisional until the client confirms.
 * A minor linked to a guardian carries the guardian's profile, so it is read
 * only here and profiled on the guardian's record.
 */

import React, { useMemo, useState } from "react";
import { View, ScrollView, RefreshControl, Pressable, StyleSheet } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { ScreenHeader } from "../../../../src/components/ui/ScreenHeader";
import { Card } from "../../../../src/components/ui/Card";
import { Text } from "../../../../src/components/ui/Text";
import { Button } from "../../../../src/components/ui/Button";
import { StatusPill } from "../../../../src/components/ui/StatusPill";
import { LoadingState, ErrorState } from "../../../../src/components/states";
import { FieldRow } from "../../../../src/features/investors/detail/primitives";
import { useInvestorFull } from "../../../../src/features/investors/api";
import { SendFormSheet } from "../../../../src/features/client-forms/SendFormSheet";
import { openSignedForm, shareRiskPdf, useRiskCaps, useRiskCurrent, useRiskTemplate } from "../../../../src/features/risk-profiles/api";
import { BUCKET_PILL, CategoryChip, MinorBadge } from "../../../../src/features/risk-profiles/RiskRowCard";
import { displayPan, isMinorKey } from "../../../../src/features/risk-profiles/pan-display";
import {
  VERIFICATION_LABELS, categoryLabel, profileIsGuardians, riskBucketOf, riskExpiresOn, templateRange,
} from "../../../../src/features/risk-profiles/rules";
import { toast } from "../../../../src/lib/toast";
import { fmtDate } from "../../../../src/lib/format";
import { palette, radius, spacing, fontWeight } from "../../../../src/theme/tokens";

type ResponseRow = {
  id: string;
  profileDate?: string | null;
  finalCategory?: string | null;
  totalScore?: number | null;
  responses?: Array<{ key: string; question: string; answer: string; score: number }> | null;
  documentUrl?: string | null;
  signedAt?: string | null;
  signedByName?: string | null;
  nextReviewAt?: string | null;
  verificationMethod?: string | null;
  rmRemarks?: string | null;
  provisional?: boolean | null;
  basis?: string | null;
};

const dateTime = (s?: string | null) =>
  s ? new Date(s).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";

export default function RiskProfileDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { canManage, canSendForm } = useRiskCaps();
  const full = useInvestorFull(id);
  const current = useRiskCurrent(id);
  const { data: template } = useRiskTemplate();
  const [sendOpen, setSendOpen] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);

  const history = useMemo<ResponseRow[]>(() => {
    const rows = ((full.data?.riskHistory ?? []) as ResponseRow[]).slice();
    // Newest signed first, unsigned last (the web's DESC NULLS LAST).
    const t = (s?: string | null) => (s ? new Date(s).getTime() : -Infinity);
    return rows.sort((a, b) => t(b.signedAt) - t(a.signedAt));
  }, [full.data]);

  if (full.isLoading) return <View style={styles.screen}><ScreenHeader title="Risk profile" /><LoadingState /></View>;
  if (full.isError || !full.data?.investor) {
    return <View style={styles.screen}><ScreenHeader title="Risk profile" /><ErrorState message={(full.error as any)?.message} onRetry={full.refetch} /></View>;
  }

  const inv = full.data.investor as any;
  const name: string = inv.name ?? "Client";
  const pan = displayPan(inv.pan);
  const isMinor = inv.isMinor === true || isMinorKey(inv.pan);
  const guardians = profileIsGuardians(inv);
  const bucket = riskBucketOf(inv);
  const pill = BUCKET_PILL[bucket];
  const exp = riskExpiresOn(inv);
  const latest = history[0];
  const score = latest?.totalScore ?? inv.riskProfileScore ?? null;
  const max = template ? templateRange(template).max : null;
  const answered = history.find((h) => !h.provisional && Array.isArray(h.responses) && h.responses.length > 0);
  const provisional = inv.riskProfileProvisional === true;

  const pdf = (profileId: string) => {
    setOpening(profileId);
    shareRiskPdf(profileId, name).catch((e: any) => toast.error(e?.message ?? "Couldn't open the PDF")).finally(() => setOpening(null));
  };
  const signedForm = (profileId: string) => {
    openSignedForm(profileId).catch((e: any) => toast.error(e?.message ?? "Could not open the signed form"));
  };

  return (
    <View style={styles.screen}>
      <ScreenHeader title={name} subtitle={pan ?? undefined} />
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}
        refreshControl={<RefreshControl refreshing={full.isRefetching} onRefresh={() => { full.refetch(); current.refetch(); }} tintColor={palette.brand} />}
      >
        <Card>
          <View style={styles.headRow}>
            <View style={{ flex: 1, gap: spacing.xs }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
                {inv.riskProfile ? <Text variant="title">{categoryLabel(inv.riskProfile)}</Text> : <Text variant="title" tone="faint">—</Text>}
                {isMinor ? <MinorBadge /> : null}
              </View>
              {provisional ? <CategoryChip category={inv.riskProfile} provisional /> : null}
            </View>
            <StatusPill label={pill.label} tone={pill.tone} />
          </View>
          {provisional ? (
            <Text variant="caption" tone="muted" style={{ marginTop: spacing.sm }}>Suggested from age — the client has not confirmed it yet.</Text>
          ) : null}

          <View style={{ marginTop: spacing.md }}>
            <FieldRow label="Score" value={score != null ? (max ? `${score} / ${max}` : String(score)) : "—"} />
            <FieldRow label="Last signed" value={inv.riskProfileSignedAt ? dateTime(inv.riskProfileSignedAt) : "Not yet"} />
            {exp && !provisional ? <FieldRow label="Expires" value={fmtDate(exp.toISOString())} /> : null}
            {latest?.nextReviewAt ? <FieldRow label="Next review" value={fmtDate(latest.nextReviewAt)} /> : null}
            {latest?.verificationMethod && !latest.provisional ? <FieldRow label="How it was taken" value={VERIFICATION_LABELS[latest.verificationMethod] ?? latest.verificationMethod} /> : null}
            {latest?.signedByName ? <FieldRow label="Signed by" value={latest.signedByName} /> : null}
          </View>
          <Text variant="caption" tone="brand" style={{ marginTop: spacing.sm }} onPress={() => router.push(`/m/investors/${id}` as any)}>Open client →</Text>
        </Card>

        {guardians ? (
          <Card style={{ marginTop: spacing.md }}>
            <View style={styles.noteRow}>
              <Feather name="info" size={14} color={palette.muted} />
              <Text variant="caption" tone="muted" style={{ flex: 1 }}>
                A minor's risk profile is the guardian's{current.data?.minorOf ? ` (${current.data.minorOf})` : ""}.
              </Text>
            </View>
            <View style={{ marginTop: spacing.md }}>
              <Button label="Guardian's risk profile" variant="secondary" onPress={() => router.push(`/m/risk-profiles/${inv.guardianInvestorId}` as any)} full />
            </View>
          </Card>
        ) : null}

        <View style={{ gap: spacing.sm, marginTop: spacing.lg }}>
          {canManage && !guardians ? (
            <Button
              label={bucket === "current" ? "Re-profile" : "Start"}
              icon={<Feather name="clipboard" size={15} color={palette.white} />}
              onPress={() => router.push(`/m/risk-profiles/new?investorId=${id}` as any)}
              full
            />
          ) : null}
          {canSendForm && !guardians ? (
            <Button label="Send link to client" variant="secondary" icon={<Feather name="link" size={15} color={palette.ink} />} onPress={() => setSendOpen(true)} full />
          ) : null}
          {canManage && !isMinor ? (
            <Button label="Upload risk profile" variant="secondary" icon={<Feather name="upload" size={15} color={palette.ink} />} onPress={() => router.push(`/m/risk-profiles/upload?investorId=${id}` as any)} full />
          ) : null}
          {latest ? (
            <Button label="Risk profile PDF" variant="secondary" loading={opening === latest.id} icon={<Feather name="file-text" size={15} color={palette.ink} />} onPress={() => pdf(latest.id)} full />
          ) : null}
          {latest?.documentUrl ? (
            <Button label="Signed form" variant="ghost" icon={<Feather name="paperclip" size={15} color={palette.brandDark} />} onPress={() => signedForm(latest.id)} full />
          ) : null}
        </View>

        {answered?.responses?.length ? (
          <Card style={{ marginTop: spacing.lg }}>
            <Text variant="subtitle" style={{ marginBottom: spacing.sm }}>Answers</Text>
            {answered !== latest ? <Text variant="caption" tone="muted" style={{ marginBottom: spacing.sm }}>{fmtDate(answered.signedAt ?? answered.profileDate ?? null)}</Text> : null}
            {answered.responses.map((b, i) => (
              <View key={`${b.key}-${i}`} style={[styles.answer, i > 0 && styles.sep]}>
                <View style={{ flex: 1 }}>
                  <Text variant="body" style={{ color: palette.ink, fontWeight: fontWeight.medium }}>{b.question}</Text>
                  <Text variant="caption" tone="muted">{b.answer}</Text>
                </View>
                <View style={styles.scoreChip}><Text variant="caption" style={{ color: palette.ink70, fontWeight: fontWeight.semibold }}>+{b.score}</Text></View>
              </View>
            ))}
          </Card>
        ) : null}

        {history.length > 0 ? (
          <Card style={{ marginTop: spacing.lg }}>
            <Text variant="subtitle" style={{ marginBottom: spacing.sm }}>History</Text>
            {history.map((h, i) => (
              <View key={h.id} style={[{ paddingVertical: spacing.sm }, i > 0 && styles.sep]}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                  <View style={{ flex: 1 }}>
                    <Text variant="body" style={{ color: palette.ink, fontWeight: fontWeight.semibold }}>
                      {categoryLabel(h.finalCategory)}{h.totalScore != null ? ` · ${h.totalScore}` : ""}
                    </Text>
                    <Text variant="caption" tone="muted">
                      {[
                        fmtDate(h.signedAt ?? h.profileDate ?? null),
                        h.provisional ? "Suggested from age" : h.basis === "uploaded" ? "Uploaded" : VERIFICATION_LABELS[h.verificationMethod ?? ""] ?? null,
                        h.signedByName,
                      ].filter(Boolean).join(" · ")}
                    </Text>
                    {h.rmRemarks ? <Text variant="caption" tone="faint" numberOfLines={3}>{h.rmRemarks}</Text> : null}
                  </View>
                  <Pressable onPress={() => pdf(h.id)} hitSlop={8} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Risk profile PDF">
                    <Feather name={opening === h.id ? "loader" : "file-text"} size={16} color={palette.ink70} />
                  </Pressable>
                  {h.documentUrl ? (
                    <Pressable onPress={() => signedForm(h.id)} hitSlop={8} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Signed form">
                      <Feather name="paperclip" size={16} color={palette.ink70} />
                    </Pressable>
                  ) : null}
                </View>
              </View>
            ))}
          </Card>
        ) : null}
      </ScrollView>

      <SendFormSheet visible={sendOpen} onClose={() => setSendOpen(false)} subjectType="investor" subjectId={String(id)} name={name} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.surfaceAlt },
  headRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  noteRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  answer: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, paddingVertical: spacing.sm },
  sep: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.lineSoft },
  scoreChip: { backgroundColor: palette.surfaceSunken, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  iconBtn: { width: 36, height: 36, borderRadius: radius.pill, backgroundColor: palette.surfaceSunken, alignItems: "center", justifyContent: "center" },
});
