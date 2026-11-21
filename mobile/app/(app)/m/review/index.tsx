/**
 * Monthly Review — "how did my month go." Composes the growth-MIS blueprint:
 * effort inputs (plan vs actual), SIP-book health, and net sales for the period.
 * A month toggle lets an RM or manager review this month or step back. Read-only
 * self-review; scopes firm-wide for managers, own-book for RMs.
 */

import React from "react";
import { View, Pressable, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { Screen } from "../../../../src/components/ui/Screen";
import { Card } from "../../../../src/components/ui/Card";
import { Text } from "../../../../src/components/ui/Text";
import { Skeleton } from "../../../../src/components/ui/Skeleton";
import { ScreenHeader } from "../../../../src/components/ui/ScreenHeader";
import { useEfforts, useSipHealth, useNetSales, currentPeriod, prevPeriod, num, type EffortRow } from "../../../../src/features/business/api";
import { inr, monthLabel } from "../../../../src/lib/format";
import { ApiError } from "../../../../src/api/client";
import { spacing, palette, radius, fontWeight } from "../../../../src/theme/tokens";
import { toneColors, type Tone } from "../../../../src/theme";

const periodLabel = (p: string) => monthLabel(p);
/** Positive green, negative red, nothing grey — "₹0 net" is not an achievement. */
const signTone = (n: number): Tone => (n > 0 ? "success" : n < 0 ? "danger" : "neutral");
const whyMissing = (e: unknown) =>
  e instanceof ApiError && e.status === 403 ? "Needs the business Reports permission." : "Couldn't load this — pull to refresh.";

export default function MonthlyReview() {
  const thisMonth = React.useMemo(() => currentPeriod(), []);
  const [period, setPeriod] = React.useState(thisMonth);
  const efforts = useEfforts(period);
  const sip = useSipHealth(period);
  const net = useNetSales(period);

  const isCurrent = period === thisMonth;
  const refetch = () => { efforts.refetch(); sip.refetch(); net.refetch(); };
  const ns = net.data?.total;
  const sh = sip.data;
  // A month with no business entries has no business figure — "—", not ₹0.
  const noEntries = !!ns && num(ns.gross) === 0 && num(ns.redemption) === 0;
  const money = (v: unknown) => (noEntries ? "—" : inr(num(v)));

  return (
    <View style={{ flex: 1, backgroundColor: palette.surfaceAlt }}>
      <ScreenHeader title="Monthly Review" subtitle={periodLabel(period)} />
      <Screen scroll padded onRefresh={refetch} refreshing={efforts.isRefetching || sip.isRefetching || net.isRefetching} contentStyle={{ paddingTop: spacing.lg, paddingBottom: spacing["3xl"] }}>
        {/* Month stepper */}
        <View style={styles.stepper}>
          <Pressable style={styles.stepBtn} onPress={() => setPeriod(prevPeriod(period))} accessibilityRole="button" accessibilityLabel="Previous month">
            <Feather name="chevron-left" size={18} color={palette.ink} />
            <Text variant="caption" style={{ color: palette.ink }}>Prev</Text>
          </Pressable>
          <Text variant="body" style={{ fontWeight: fontWeight.semibold }}>{periodLabel(period)}</Text>
          <Pressable style={[styles.stepBtn, isCurrent && { opacity: 0.3 }]} onPress={() => !isCurrent && setPeriod(thisMonth)} disabled={isCurrent} accessibilityRole="button" accessibilityLabel="This month" accessibilityState={{ disabled: isCurrent }}>
            <Text variant="caption" style={{ color: palette.ink }}>This month</Text>
            <Feather name="chevron-right" size={18} color={palette.ink} />
          </Pressable>
        </View>

        {/* Net sales */}
        <SectionLabel icon="trending-up" text="NET SALES" />
        <Card>
          {net.isLoading ? <Skeleton width="100%" height={50} /> : !ns ? (
            <Text variant="body" tone="muted">{whyMissing(net.error)}</Text>
          ) : (
            <>
              <View style={styles.threeUp}>
                <Big label="Gross" value={money(ns.gross)} tone="neutral" />
                <Big label="Redemption" value={money(ns.redemption)} tone={noEntries || num(ns.redemption) === 0 ? "neutral" : "warning"} />
                <Big label="Net" value={money(ns.net)} tone={noEntries ? "neutral" : signTone(num(ns.net))} />
              </View>
              {noEntries ? <Text variant="caption" tone="faint" style={{ marginTop: spacing.sm }}>No business booked in this month.</Text> : null}
            </>
          )}
        </Card>

        {/* SIP health */}
        <SectionLabel icon="repeat" text="SIP BOOK HEALTH" />
        <Card>
          {sip.isLoading ? <Skeleton width="100%" height={50} /> : sip.isError ? (
            <Text variant="body" tone="muted">{whyMissing(sip.error)}</Text>
          ) : sh ? (
            <>
              <View style={styles.threeUp}>
                <Big label="Live SIP" value={inr(num(sh.liveSip?.amount))} tone="neutral" hint={`${num(sh.liveSip?.count)} SIPs`} />
                <Big label="Fresh" value={inr(num(sh.fresh?.amount))} tone="neutral" hint={`${num(sh.fresh?.count)} new`} />
                <Big label="Net SIP" value={inr(num(sh.netSip))} tone={signTone(num(sh.netSip))} />
              </View>
              <View style={styles.sipMeta}>
                <Mini label="Stopped" value={`${inr(num(sh.stopped?.amount))} · ${num(sh.stopped?.count)}`} />
                <Mini label="Maturing" value={String(num(sh.maturing?.count))} />
                <Mini label="Bounced" value={String(num(sh.bounced?.count))} tone={num(sh.bounced?.count) > 0 ? "danger" : "neutral"} />
              </View>
            </>
          ) : <Text variant="body" tone="muted">No SIP data for this month.</Text>}
        </Card>

        {/* Efforts plan vs actual */}
        <SectionLabel icon="check-square" text="EFFORTS · PLAN VS ACTUAL" />
        <Card flat style={{ padding: 0, overflow: "hidden" }}>
          {efforts.isLoading ? (
            <View style={{ padding: spacing.lg }}><Skeleton width="100%" height={40} /></View>
          ) : efforts.isError ? (
            <View style={{ padding: spacing.lg }}><Text variant="body" tone="muted">{whyMissing(efforts.error)}</Text></View>
          ) : (efforts.data?.rows?.length ?? 0) === 0 ? (
            <View style={{ padding: spacing.lg }}><Text variant="body" tone="muted">No effort targets set for this month.</Text></View>
          ) : (
            (efforts.data?.rows ?? []).map((r, i, arr) => <EffortRowView key={r.key} row={r} last={i === arr.length - 1} />)
          )}
        </Card>
      </Screen>
    </View>
  );
}

function EffortRowView({ row, last }: { row: EffortRow; last: boolean }) {
  const actual = row.auto ? num(row.computed) : num(row.actual);
  const planned = num(row.planned);
  const pct = planned > 0 ? Math.min(100, Math.round((actual / planned) * 100)) : 0;
  const tone: Tone = planned === 0 ? "neutral" : pct >= 75 ? "success" : pct >= 50 ? "warning" : "danger";
  return (
    <View style={[styles.effRow, !last && styles.divider]}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <Text variant="body" numberOfLines={1} style={{ flex: 1 }}>{row.label}</Text>
        <Text variant="caption" style={{ color: palette.ink, fontWeight: fontWeight.semibold }}>
          {actual}{planned > 0 ? <Text variant="caption" tone="faint"> / {planned}</Text> : null}
        </Text>
      </View>
      {planned > 0 ? <View style={styles.track}><View style={[styles.fill, { width: `${Math.max(2, pct)}%`, backgroundColor: toneColors(tone).fg }]} /></View> : null}
    </View>
  );
}

function Big({ label, value, tone, hint }: { label: string; value: string; tone: Tone; hint?: string }) {
  return <View style={{ flex: 1 }}><Text variant="caption" tone="muted" numberOfLines={1}>{label}</Text><Text style={{ fontSize: 15, fontWeight: fontWeight.bold, color: toneColors(tone).fg }} numberOfLines={1}>{value}</Text>{hint ? <Text variant="caption" tone="faint" numberOfLines={1}>{hint}</Text> : null}</View>;
}
function Mini({ label, value, tone }: { label: string; value: string; tone?: Tone }) {
  return <View style={{ flex: 1 }}><Text variant="caption" tone="faint" numberOfLines={1}>{label}</Text><Text variant="caption" style={{ fontWeight: fontWeight.semibold, color: tone ? toneColors(tone).fg : palette.ink }} numberOfLines={1}>{value}</Text></View>;
}
function SectionLabel({ icon, text }: { icon: any; text: string }) {
  return <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs, marginTop: spacing.xl, marginBottom: spacing.sm }}><Feather name={icon} size={13} color={palette.muted} /><Text variant="caption" tone="faint" style={{ letterSpacing: 0.6 }}>{text}</Text></View>;
}

const styles = StyleSheet.create({
  stepper: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  stepBtn: { flexDirection: "row", alignItems: "center", gap: 2, minHeight: 44, paddingHorizontal: spacing.xs },
  threeUp: { flexDirection: "row", gap: spacing.md },
  sipMeta: { flexDirection: "row", gap: spacing.md, marginTop: spacing.lg, paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.line },
  effRow: { paddingVertical: spacing.md, paddingHorizontal: spacing.lg },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line },
  track: { height: 6, borderRadius: 3, backgroundColor: palette.surfaceSunken, overflow: "hidden" },
  fill: { height: 6, borderRadius: 3 },
});
