/**
 * The live "Financial Health Snapshot" — the app's copy of the CRM's
 * components/discovery/HealthSnapshot.tsx: score, the six pillars, the
 * headline numbers, the affordability verdict, and the risk profile with
 * product suitability. Pure display over computeDiscovery's result; a score is
 * only claimed once two pillars have data (calc.ts).
 */

import React, { useState } from "react";
import { View, Pressable, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { Card } from "../../components/ui/Card";
import { Text } from "../../components/ui/Text";
import { palette, radius, spacing, fontWeight } from "../../theme/tokens";
import type { DiscoveryComputed } from "./calc";
import { PRODUCTS, PRODUCT_LABELS, type Verdict } from "./risk";

const VERDICT: Record<Verdict, { mark: string; color: string }> = {
  yes: { mark: "✅", color: "#059669" },
  maybe: { mark: "⚠", color: "#f59e0b" },
  no: { mark: "❌", color: "#f43f5e" },
  na: { mark: "—", color: palette.muted },
};

/** The web snapshot's own format: ₹1.20 Cr / ₹12.50 L / ₹45,000. */
export const snapInr = (nv: number) => {
  const v = Math.round(nv);
  if (Math.abs(v) >= 1e7) return `₹${(v / 1e7).toFixed(2)} Cr`;
  if (Math.abs(v) >= 1e5) return `₹${(v / 1e5).toFixed(2)} L`;
  return `₹${v.toLocaleString("en-IN")}`;
};

/** Ring colour for a health score (grey until there is one). */
export function scoreColor(score: number | null | undefined): string {
  if (score == null) return "#94a3b8";
  return score >= 80 ? "#059669" : score >= 60 ? "#0891b2" : score >= 40 ? "#f59e0b" : "#f43f5e";
}

export function HealthSnapshot({ c }: { c: DiscoveryComputed }) {
  const [open, setOpen] = useState<string | null>(null);
  const score = c.healthScore;
  const ring = scoreColor(score);
  const known = c.scoreParts.filter((p) => p.known).length;
  const risk = c.risk;
  const riskShown = risk && (risk.source === "record" || risk.answered > 0);
  const spare = c.affordabilityGap >= 0;

  return (
    <Card>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.lg }}>
        <View style={[styles.ring, { borderColor: ring }]}>
          <Text style={{ fontSize: 22, fontWeight: fontWeight.bold, color: ring }}>{score ?? "—"}</Text>
          {score != null ? <Text variant="caption" tone="muted">/ 100</Text> : null}
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="caption" tone="muted" style={styles.eyebrow}>FINANCIAL HEALTH</Text>
          <Text style={{ fontSize: 19, fontWeight: fontWeight.bold, color: score == null ? palette.muted : ring }}>{c.healthBand}</Text>
          {score == null ? (
            <Text variant="caption" tone="muted">Fill in income, expenses, insurance or goals to see a score</Text>
          ) : known < c.scoreParts.length ? (
            <Text variant="caption" tone="muted">From {known} of {c.scoreParts.length} areas</Text>
          ) : null}
        </View>
      </View>

      {/* Score pillars — tap one for what it is based on (the web's hover title) */}
      <View style={{ marginTop: spacing.lg, gap: spacing.sm }}>
        {c.scoreParts.map((p) => {
          const frac = p.max ? p.score / p.max : 0;
          return (
            <Pressable
              key={p.label}
              onPress={() => setOpen((o) => (o === p.label ? null : p.label))}
              accessibilityRole="button"
              accessibilityLabel={`${p.label}: ${p.known ? `${p.score} of ${p.max}` : "not known"}. ${p.hint}`}
            >
              <View style={styles.between}>
                <Text variant="caption" tone="muted">{p.label}</Text>
                <Text variant="caption" style={{ color: p.known ? palette.ink : palette.muted, fontWeight: fontWeight.semibold }}>{p.known ? `${p.score}/${p.max}` : "—"}</Text>
              </View>
              <View style={styles.track}>
                {p.known ? <View style={[styles.fill, { width: `${frac * 100}%`, backgroundColor: frac >= 0.75 ? "#10b981" : frac >= 0.4 ? "#f59e0b" : "#f43f5e" }]} /> : null}
              </View>
              {open === p.label ? <Text variant="caption" tone="muted" style={{ marginTop: 2 }}>{p.hint}</Text> : null}
            </Pressable>
          );
        })}
      </View>

      {/* Headline numbers */}
      <View style={styles.metrics}>
        <Metric icon="briefcase" label="Net worth" value={snapInr(c.netWorth)} good={c.netWorth >= 0} />
        <Metric icon="trending-up" label="Monthly surplus" value={snapInr(c.monthlySipCapacity)} sub="investable / mo" good={c.monthlySipCapacity >= 0} />
        <Metric icon="shield" label="Life cover gap" value={c.lifeCoverGap > 0 ? snapInr(c.lifeCoverGap) : "Covered"} good={!(c.lifeCoverGap > 0)} />
        <Metric icon="target" label="Goal SIP needed" value={snapInr(c.totalSipNeeded)} sub="per month" />
      </View>

      {/* Affordability verdict */}
      {c.totalSipNeeded > 0 || c.monthlySipCapacity !== 0 ? (
        <View style={[styles.verdict, spare ? { borderColor: "#a7f3d0", backgroundColor: palette.successBg } : { borderColor: "#fde68a", backgroundColor: palette.warningBg }]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Feather name={spare ? "trending-up" : "trending-down"} size={14} color={spare ? palette.success : palette.warning} />
            <Text variant="label" style={{ color: palette.ink, fontWeight: fontWeight.semibold }}>
              {spare ? "Goals are affordable" : "Goals need more than the current surplus"}
            </Text>
          </View>
          <Text variant="caption" tone="muted" style={{ marginTop: 4 }}>
            Investable ~{snapInr(c.monthlySipCapacity)}/mo vs goal SIPs ~{snapInr(c.totalSipNeeded)}/mo
            {spare
              ? ` — ₹${Math.round(c.affordabilityGap).toLocaleString("en-IN")}/mo to spare.`
              : ` — short by ₹${Math.round(Math.abs(c.affordabilityGap)).toLocaleString("en-IN")}/mo. Prioritise goals or extend timelines.`}
          </Text>
        </View>
      ) : null}

      {/* Risk profile + product suitability */}
      {riskShown ? (
        <View style={styles.riskBlock}>
          <View style={[styles.between, { alignItems: "flex-end" }]}>
            <View style={{ flex: 1 }}>
              <Text variant="caption" tone="muted" style={styles.eyebrow}>RISK PROFILE</Text>
              {risk.complete ? (
                <Text style={{ fontSize: 17, fontWeight: fontWeight.bold, color: risk.bandColor }}>{risk.bandLabel}</Text>
              ) : (
                <Text variant="label" tone="muted" style={{ fontWeight: fontWeight.semibold }}>Not complete yet</Text>
              )}
            </View>
            {risk.source === "record" ? (
              <Text variant="caption" tone="muted">On record{risk.score != null ? ` · score ${risk.score}` : ""}</Text>
            ) : (
              <View style={{ alignItems: "flex-end" }}>
                {risk.complete && risk.score != null ? (
                  <Text style={{ fontSize: 19, fontWeight: fontWeight.bold, color: risk.bandColor }}>
                    {risk.score}<Text variant="caption" tone="muted">/{risk.max}</Text>
                  </Text>
                ) : null}
                <Text variant="caption" tone="muted">{risk.answered}/{risk.total} answered</Text>
              </View>
            )}
          </View>
          {risk.source !== "record" && risk.complete && risk.score != null ? (
            <View style={styles.track}><View style={[styles.fill, { width: `${(risk.score / risk.max) * 100}%`, backgroundColor: risk.bandColor }]} /></View>
          ) : null}
          {!risk.complete && risk.missing.length > 0 ? (
            <Text variant="caption" tone="muted">Still needed: {risk.missing.join(", ")}</Text>
          ) : null}

          {risk.suitabilityReady ? (
            <>
              <Text variant="caption" tone="muted" style={[styles.eyebrow, { marginTop: spacing.xs }]}>PRODUCT SUITABILITY</Text>
              <View style={styles.suitGrid}>
                {PRODUCTS.map((p) => {
                  const cell = risk.suitability[p];
                  const vrd = VERDICT[cell.overall];
                  return (
                    <View
                      key={p}
                      style={styles.suitCell}
                      accessible
                      accessibilityLabel={`${PRODUCT_LABELS[p]}: risk ${cell.risk}, horizon ${cell.horizon}, surplus ${cell.surplus}, liquidity ${cell.liquidity}`}
                    >
                      <Text variant="caption" style={{ color: palette.ink, flex: 1 }} numberOfLines={1}>{PRODUCT_LABELS[p]}</Text>
                      <Text variant="caption" style={{ color: vrd.color }}>{vrd.mark}</Text>
                    </View>
                  );
                })}
              </View>
              <Text variant="caption" tone="muted">✅ suitable · ⚠ conditional · ❌ not suitable · — needs more inputs</Text>
            </>
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}

function Metric({ icon, label, value, sub, good }: { icon: React.ComponentProps<typeof Feather>["name"]; label: string; value: string; sub?: string; good?: boolean }) {
  const color = good === true ? "#047857" : good === false ? "#be123c" : palette.ink;
  return (
    <View style={styles.metric}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
        <Feather name={icon} size={12} color={palette.muted} />
        <Text variant="caption" tone="muted" numberOfLines={1} style={{ flex: 1 }}>{label}</Text>
      </View>
      <Text style={{ fontSize: 15, fontWeight: fontWeight.bold, color, marginTop: 2 }} numberOfLines={1}>{value}</Text>
      {sub ? <Text variant="caption" tone="faint">{sub}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  ring: { width: 76, height: 76, borderRadius: 38, borderWidth: 6, alignItems: "center", justifyContent: "center" },
  eyebrow: { letterSpacing: 0.6, fontWeight: fontWeight.semibold },
  between: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.sm },
  track: { height: 6, borderRadius: 3, backgroundColor: palette.surfaceSunken, overflow: "hidden", marginTop: 3 },
  fill: { height: "100%", borderRadius: 3 },
  metrics: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.lg },
  metric: { width: "48%", flexGrow: 1, borderWidth: 1, borderColor: palette.line, borderRadius: radius.md, padding: spacing.sm },
  verdict: { borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.md },
  riskBlock: { marginTop: spacing.lg, paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.line, gap: spacing.sm },
  suitGrid: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  suitCell: { width: "48%", flexGrow: 1, flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderColor: palette.line, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 6 },
});
