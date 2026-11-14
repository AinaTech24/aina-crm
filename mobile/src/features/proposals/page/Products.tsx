/**
 * The proposal page's Products list (web proposal page ProductDetails): each
 * line with its kind, what the client took of it, its facts, its rationale,
 * and the reason recorded for a line kept above the risk band.
 */

import React from "react";
import { View, StyleSheet } from "react-native";
import { Text } from "../../../components/ui/Text";
import { StatusPill } from "../../../components/ui/StatusPill";
import type { ProposalLine } from "../api";
import { itemAmountText, itemKindLabel, itemName } from "../shared/items";
import { spacing, palette, radius, fontWeight } from "../../../theme/tokens";

const KIND_LABEL: Record<string, string> = { mf: "Mutual Fund", insurance: "Insurance", pms: "PMS", aif: "AIF", other: "Other Product" };
const fmt = (n: unknown) => `₹${Math.round(Number(n)).toLocaleString("en-IN")}`;

export function ProductList({ products, acceptedItems }: { products: ProposalLine[]; acceptedItems: number[] | null }) {
  const accepted = Array.isArray(acceptedItems) ? new Set(acceptedItems) : null;
  if (products.length === 0) return <Text variant="caption" tone="muted" center style={{ paddingVertical: spacing.lg }}>No line items.</Text>;
  return (
    <View style={{ gap: spacing.md }}>
      {products.map((it, i) => (
        <View key={i} style={styles.item}>
          <View style={styles.head}>
            {accepted ? <StatusPill size="sm" dot={false} tone={accepted.has(i) ? "success" : "neutral"} label={accepted.has(i) ? "Accepted" : "Not taken"} /> : null}
            <StatusPill size="sm" dot={false} tone={it.kind === "mf" ? "success" : it.kind === "insurance" ? "info" : it.kind === "pms" ? "warning" : it.kind === "other" ? "neutral" : "danger"}
              label={it.kind === "mf" ? `Mutual Fund · ${itemKindLabel(it)}` : KIND_LABEL[it.kind] ?? it.kind} />
          </View>
          <Text variant="body" style={{ color: palette.ink, fontWeight: fontWeight.semibold, marginBottom: spacing.sm }}>{itemName(it)}</Text>
          <Details it={it} />
          {it.notes ? <Text variant="caption" tone="muted" style={{ fontStyle: "italic", marginTop: spacing.sm }}>{it.notes}</Text> : null}
          {it.kind === "mf" && it.suitabilityReason ? <Text variant="caption" style={{ color: palette.warning, marginTop: 4 }}>Kept above the risk band: {it.suitabilityReason}</Text> : null}
        </View>
      ))}
    </View>
  );
}

function Details({ it }: { it: any }) {
  const kv: [string, string][] = [];
  if (it.kind === "mf") {
    if (it.amcName) kv.push(["AMC", it.amcName]);
    if (it.category) kv.push(["Category", it.category]);
    if (it.recommendationType === "swp" || it.recommendationType === "stp") kv.push([it.recommendationType.toUpperCase(), itemAmountText(it)]);
    if (it.corpusRequired) kv.push(["Corpus", fmt(it.corpusRequired)]);
    if (it.lumpsum) kv.push(["Lumpsum", fmt(it.lumpsum)]);
    if (it.monthlyAmount) kv.push(["SIP", `${fmt(it.monthlyAmount)}/mo`]);
    if (it.stepUpPct) kv.push(["Step-up", `${it.stepUpPct}% a year`]);
    if (it.goal) kv.push(["Goal", it.goal]);
    if (it.planType) kv.push(["Plan", it.planType === "direct" ? "Direct" : "Regular"]);
    if (it.sipTermYears) kv.push(["Term", `${it.sipTermYears} yrs`]);
    if (it.expectedReturn) kv.push(["Expected return", `${it.expectedReturn}% p.a.`]);
    if (it.riskRating) kv.push(["Risk", String(it.riskRating).replace(/_/g, " ")]);
    if (it.projectedCorpus) kv.push(["Projected", fmt(it.projectedCorpus)]);
  } else if (it.kind === "insurance") {
    if (it.insurer) kv.push(["Insurer", it.insurer]);
    if (it.policyType) kv.push(["Type", String(it.policyType).replace(/_/g, " ")]);
    if (it.sumAssured) kv.push(["Sum assured", fmt(it.sumAssured)]);
    if (it.annualPremium) kv.push(["Annual premium", fmt(it.annualPremium)]);
    if (it.termYears) kv.push(["Term", `${it.termYears} yrs`]);
  } else if (it.kind === "pms") {
    if (it.manager) kv.push(["Manager", it.manager]);
    if (it.minInvestment) kv.push(["Min", fmt(it.minInvestment)]);
    if (it.proposedAmount) kv.push(["Proposed", fmt(it.proposedAmount)]);
    if (it.expectedReturn) kv.push(["Expected return", `${it.expectedReturn}% p.a.`]);
    if (it.termYears) kv.push(["Horizon", `${it.termYears} yrs`]);
    const proj = Number(it.proposedAmount ?? 0) * Math.pow(1 + Number(it.expectedReturn ?? 0) / 100, Number(it.termYears ?? 0));
    if (proj) kv.push(["Projected", fmt(Math.round(proj))]);
  } else if (it.kind === "aif") {
    if (it.manager) kv.push(["Manager", it.manager]);
    if (it.category) kv.push(["Category", String(it.category).toUpperCase()]);
    if (it.minInvestment) kv.push(["Min", fmt(it.minInvestment)]);
    if (it.proposedAmount) kv.push(["Proposed", fmt(it.proposedAmount)]);
    if (it.lockInYears) kv.push(["Lock-in", `${it.lockInYears} yrs`]);
    if (it.targetIrr) kv.push(["Target IRR", `${it.targetIrr}% p.a.`]);
    const proj = Number(it.proposedAmount ?? 0) * Math.pow(1 + Number(it.targetIrr ?? 0) / 100, Number(it.lockInYears ?? 0));
    if (proj) kv.push(["Projected", fmt(Math.round(proj))]);
  } else if (it.kind === "other") {
    if (it.company) kv.push(["Company", it.company]);
    if (it.amount) kv.push(["Amount", fmt(it.amount)]);
    if (it.expectedReturn) kv.push(["Expected return", `${it.expectedReturn}% p.a.`]);
    if (it.termYears) kv.push(["Term", `${it.termYears} yrs`]);
    const fv = Number(it.amount ?? 0) > 0 && Number(it.expectedReturn ?? 0) > 0 && Number(it.termYears ?? 0) > 0
      ? Number(it.amount) * Math.pow(1 + Number(it.expectedReturn) / 100, Number(it.termYears)) : 0;
    if (fv) kv.push(["Expected FV", fmt(Math.round(fv))]);
    if (it.remarks) kv.push(["Remarks", it.remarks]);
  }
  if (kv.length === 0) return null;
  return (
    <View style={styles.grid}>
      {kv.map(([k, v]) => (
        <View key={k} style={styles.kv}>
          <Text variant="caption" tone="muted" style={{ fontSize: 11, letterSpacing: 0.4 }}>{k.toUpperCase()}</Text>
          <Text variant="caption" style={{ color: palette.ink, fontWeight: fontWeight.semibold }}>{v}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  item: { borderWidth: 1, borderColor: palette.line, borderRadius: radius.lg, padding: spacing.md, backgroundColor: palette.surface },
  head: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginBottom: spacing.sm },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  kv: { flexGrow: 1, flexBasis: "47%", backgroundColor: palette.surfaceSunken, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 6 },
});
