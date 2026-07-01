/**
 * Business entry detail. Client, product, AMC/folio, amounts, status, notes.
 * From GET /api/business-entries/[id].
 */

import React from "react";
import { View, ScrollView, StyleSheet } from "react-native";
import { useLocalSearchParams } from "expo-router";
import Animated, { FadeInUp } from "react-native-reanimated";
import { ScreenHeader } from "../../../../src/components/ui/ScreenHeader";
import { Card } from "../../../../src/components/ui/Card";
import { Text } from "../../../../src/components/ui/Text";
import { StatusPill } from "../../../../src/components/ui/StatusPill";
import { LoadingState, ErrorState } from "../../../../src/components/states";
import { useBusinessEntry } from "../../../../src/features/business-entries/api";
import { entryStatusBadge } from "../../../../src/lib/status";
import { inr, inrFull, titleCase, fmtDate } from "../../../../src/lib/format";
import { palette, spacing } from "../../../../src/theme/tokens";

export default function BusinessEntryDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: e, isLoading, isError, error, refetch } = useBusinessEntry(id);

  if (isLoading)
    return (
      <View style={styles.screen}>
        <ScreenHeader title="Entry" />
        <LoadingState />
      </View>
    );
  if (isError || !e)
    return (
      <View style={styles.screen}>
        <ScreenHeader title="Entry" />
        <ErrorState message={(error as any)?.message} onRetry={() => refetch()} />
      </View>
    );

  const st = entryStatusBadge(e.status);

  return (
    <View style={styles.screen}>
      <ScreenHeader title={e.clientName ?? "Business Entry"} subtitle={titleCase(e.productType) || undefined} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["4xl"] }} showsVerticalScrollIndicator={false}>
        <Animated.View entering={FadeInUp.duration(280)}>
          <Card>
            <Text variant="caption" tone="faint">
              TOTAL AMOUNT
            </Text>
            <Text variant="title" tone="brand">
              {inrFull(e.totalAmount)}
            </Text>
            <View style={{ marginTop: spacing.md }}>
              <StatusPill label={st.label} tone={st.tone} />
            </View>
          </Card>

          <Card flat style={{ padding: 0, marginTop: spacing.lg }}>
            <Field label="Client" value={e.clientName} />
            <Field label="Product" value={titleCase(e.productType)} />
            <Field label="Platform" value={titleCase(e.platform)} />
            <Field label="AMC" value={e.amcName} />
            <Field label="Folio" value={e.folioNo} />
            <Field label="Liquid (net)" value={e.liquidNet ? inr(e.liquidNet) : "—"} />
            <Field label="Emailed" value={fmtDate(e.emailedAt)} last />
          </Card>

          {e.notes ? (
            <Card style={{ marginTop: spacing.lg }}>
              <Text variant="caption" tone="faint">
                NOTES
              </Text>
              <Text variant="body" style={{ marginTop: 4 }}>
                {e.notes}
              </Text>
            </Card>
          ) : null}
        </Animated.View>
      </ScrollView>
    </View>
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
  field: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: spacing.lg, gap: spacing.md },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line },
});
