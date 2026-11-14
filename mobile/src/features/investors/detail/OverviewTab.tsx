/**
 * Overview tab — client health score, the risk/nominee/KYC/review summary grid,
 * and the review-cadence editor (PATCHes reviewFrequency).
 */

import React, { useState } from "react";
import { View, StyleSheet } from "react-native";
import { Text } from "../../../components/ui/Text";
import { Button } from "../../../components/ui/Button";
import { Segmented } from "../../../components/ui/Segmented";
import { palette, radius, spacing, fontWeight } from "../../../theme/tokens";
import { inr, fmtDate, titleCase, timeAgo } from "../../../lib/format";
import { Section, FieldRow } from "./primitives";
import { useSetReviewCadence } from "../api";
import { canNominate, clientTypeLabel } from "../client-types";
import { ClientOpportunities } from "../../opportunities/ClientOpportunities";
import { RecordNotes } from "../../notes/RecordNotes";

const healthTone = (n: number) => (n >= 70 ? palette.success : n >= 40 ? palette.warning : palette.danger);
const BAND_LABEL: Record<string, string> = { green: "Healthy", amber: "Watch", red: "At risk" };
const BAND_COLOR: Record<string, string> = { green: palette.success, amber: palette.warning, red: palette.danger };
const CADENCE = [
  { key: "monthly", label: "Monthly" },
  { key: "quarterly", label: "Quarterly" },
  { key: "half_yearly", label: "Half-yearly" },
  { key: "annual", label: "Annual" },
];

export function OverviewTab({ d, id, startOpportunity }: { d: any; id: string; startOpportunity?: string }) {
  const inv = d.investor ?? {};
  // The CRM's health card (ClientHealthCard): the live score, its band, and each
  // factor that cost points — label, why, −points. An older server sends no
  // breakdown; then the stored score shows alone.
  const health: { score: number; band: string; factors: Array<{ key: string; label: string; why: string; deduction: number }> } | null = d.health ?? null;
  const score = health ? health.score : inv.healthScore != null ? Number(inv.healthScore) : null;
  const band: string | null = health?.band ?? inv.healthBand ?? null;
  const factors = health?.factors ?? [];

  return (
    <View>
      {/* Client health */}
      <Section title="Client health" icon="heart">
        <View style={styles.healthRow}>
          <View style={[styles.gauge, { borderColor: score != null ? healthTone(score) : palette.line }]}>
            <Text style={{ fontSize: 26, fontWeight: fontWeight.bold, color: score != null ? healthTone(score) : palette.muted }}>{score ?? "—"}</Text>
            <Text variant="caption" tone="muted">/ 100</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: fontWeight.semibold, color: band ? BAND_COLOR[band] ?? palette.ink : palette.muted }}>{band ? BAND_LABEL[band] ?? titleCase(band) : "Not scored"}</Text>
            {health && factors.length === 0 ? (
              <Text variant="caption" style={{ color: palette.success, marginTop: 2 }}>All checks green — nothing flagged.</Text>
            ) : !health && inv.healthScoredAt ? (
              <Text variant="caption" tone="muted">Scored {timeAgo(inv.healthScoredAt)}</Text>
            ) : null}
          </View>
        </View>
        {factors.slice(0, 5).map((f) => (
          <View key={f.key} style={styles.factor}>
            <View style={{ flex: 1 }}>
              <Text variant="caption" style={{ fontWeight: fontWeight.semibold }} numberOfLines={1}>{f.label}</Text>
              <Text variant="caption" tone="muted" numberOfLines={2}>{f.why}</Text>
            </View>
            <Text variant="caption" style={{ color: palette.danger, fontWeight: fontWeight.bold }}>−{f.deduction}</Text>
          </View>
        ))}
        {factors.length > 5 ? <Text variant="caption" tone="muted" style={{ marginTop: 4 }}>+ {factors.length - 5} more</Text> : null}
      </Section>

      {/* Summary grid */}
      <Section title="Risk / nominee / KYC / review" icon="grid">
        <View style={styles.grid}>
          <SummaryCard label="Risk profile" value={inv.riskProfile ? titleCase(inv.riskProfile) : "Not assessed"} sub={inv.riskProfileSignedAt ? `Signed ${fmtDate(inv.riskProfileSignedAt)}` : "Pending"} />
          {canNominate(inv.investorCategory)
            ? <SummaryCard label="Nominee" value={inv.nomineeName || (inv.typeDetails?.nominationOptOut ? "Opted out" : "Not set")} sub={inv.nomineeRelation ? titleCase(inv.nomineeRelation) : "—"} />
            : <SummaryCard label="Client type" value={clientTypeLabel(inv.investorCategory)} sub="No nomination" />}
          <SummaryCard label="KYC" value={titleCase(inv.kycStatus) || "—"} sub={inv.ckycNumber || "No CKYC"} />
          <SummaryCard label="Last review" value={inv.lastReviewAt ? timeAgo(inv.lastReviewAt) : "Never"} sub={inv.nextReviewAt ? `Next ${fmtDate(inv.nextReviewAt)}` : "No next set"} />
        </View>
      </Section>

      <ClientOpportunities investorId={id} startWith={startOpportunity} />

      <RecordNotes type="investor" id={id} limit={5} />

      <ReviewCadence id={id} current={inv.reviewFrequency} family={d.family?.reviewFrequency ? (d.family.familyName ?? "the family") : null} />

      {/* Financial snapshot */}
      <Section title="Financials" icon="dollar-sign">
        <FieldRow label="AUM" value={inr(inv.aum)} />
        <FieldRow label="Monthly SIP" value={inr(inv.activeSipAmount)} />
        <FieldRow label="Lifetime inflow" value={inr(inv.lifetimeInflow)} />
        <FieldRow label="Lifetime outflow" value={inr(inv.lifetimeOutflow)} />
        <FieldRow label="Total lumpsum" value={inr(d.totalLumpsum)} />
      </Section>
    </View>
  );
}

/** A family member's cadence is the family's (the CRM ignores a change here). */
function ReviewCadence({ id, current, family }: { id: string; current?: string; family: string | null }) {
  const [val, setVal] = useState<string>(current ?? "quarterly");
  if (family) {
    return (
      <Section title="Review cadence" icon="repeat">
        <Text style={{ fontWeight: fontWeight.semibold }}>{CADENCE.find((c) => c.key === current)?.label ?? titleCase(current ?? "") ?? "—"}</Text>
        <Text variant="caption" tone="muted">From {family} — change it on the family.</Text>
      </Section>
    );
  }
  const save = useSetReviewCadence(id);
  const changed = val !== (current ?? "");
  return (
    <Section title="Review cadence" icon="repeat">
      <Segmented<string> options={CADENCE} value={val} onChange={setVal} />
      <View style={{ height: spacing.md }} />
      <Button label="Update cadence" onPress={() => save.mutate({ reviewFrequency: val })} loading={save.isPending} disabled={!changed} full />
      {save.isSuccess && !changed ? <Text variant="caption" style={{ color: palette.success, marginTop: spacing.sm }}>Cadence updated — next review recalculated.</Text> : null}
    </Section>
  );
}

function SummaryCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <View style={styles.sum}>
      <Text variant="caption" tone="muted">{label}</Text>
      <Text style={{ fontWeight: fontWeight.semibold }} numberOfLines={1}>{value}</Text>
      <Text variant="caption" tone="faint" numberOfLines={1}>{sub}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  factor: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, paddingVertical: spacing.xs, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.lineSoft },
  healthRow: { flexDirection: "row", alignItems: "center", gap: spacing.lg },
  gauge: { width: 72, height: 72, borderRadius: 36, borderWidth: 3, alignItems: "center", justifyContent: "center", backgroundColor: palette.surfaceAlt },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  sum: { width: "47%", flexGrow: 1, backgroundColor: palette.surfaceAlt, borderRadius: radius.sm, padding: spacing.md },
});
