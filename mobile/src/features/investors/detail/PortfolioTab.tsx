/**
 * Portfolio tab — live valuation + holdings, churn-risk scorecard, asset-class
 * allocation, SIP health, the transaction ledger, and cross-sell opportunities.
 */

import React from "react";
import { View, StyleSheet, Alert } from "react-native";
import { Text } from "../../../components/ui/Text";
import { palette, radius, spacing, fontWeight } from "../../../theme/tokens";
import { inr, fmtDate, titleCase } from "../../../lib/format";
import { Section, FieldRow, AllocBar, Badge, Empty } from "./primitives";
import { ClientFixedDeposits } from "../../fixed-deposits/ClientFixedDeposits";
import { api } from "../../../api/client";
import { toast } from "../../../lib/toast";

const churnTone = (b?: string) => (b === "high" ? palette.danger : b === "medium" ? palette.warning : palette.success);
const num = (v: any) => (v == null ? 0 : Number(v));
/** A null is not a zero: an amount the valuation could not work out (no NAV,
 *  an incomplete history) reads "—", never ₹0. */
const money = (v: any) => (v == null || v === "" || !Number.isFinite(Number(v)) ? "—" : inr(v));

// A processed switch / STP / SWP can be confirmed to the client by email (web
// TransactionLedger): POST record-email sends the vendor template about THIS
// record — its scheme, amount, folio and date — through the comms pipeline.
const EMAILABLE_TYPES = ["switch", "stp", "swp"];
const EMAILABLE_STATUSES = ["processed", "successful"];
function emailRecord(investorId: string, name: string, t: any) {
  Alert.alert(`Email ${name} about this ${titleCase(t.type)}?`, `${t.schemeName ?? "Scheme"}${t.amount ? ` · ${inr(t.amount)}` : ""}`, [
    { text: "Cancel", style: "cancel" },
    {
      text: "Send email",
      onPress: () => api.post<{ email?: string }>(`/api/investors/${investorId}/record-email`, { kind: "transaction", recordId: t.id })
        .then((r) => toast.success(r?.email ? `Emailed ${r.email}` : "Email sent"))
        .catch((e: any) => toast.error(e?.message ?? "The email was not sent")),
    },
  ]);
}

export function PortfolioTab({ d }: { d: any }) {
  const v = d.valuation ?? {};
  const exp = d.exposure ?? {};
  const sh = d.sipHealth ?? {};
  const tx = d.recentTransactions ?? [];
  const holdings = v.holdings ?? [];

  return (
    <View>
      {/* Valuation */}
      <Section title="Live portfolio value" icon="pie-chart" right={v.asOf ? <Text variant="caption" tone="faint">as of {fmtDate(v.asOf)}</Text> : undefined}>
        <View style={styles.valGrid}>
          <ValCell label="Current value" value={inr(v.currentValue)} />
          <ValCell label="Invested" value={money(v.investedNet)} />
          <ValCell label="Gain" value={money(v.gain)} tone={v.gain == null ? undefined : num(v.gain) < 0 ? palette.danger : palette.success} sub={v.absoluteReturn != null ? `${Number(v.absoluteReturn).toFixed(1)}%` : undefined} />
          <ValCell label="XIRR" value={v.xirr != null ? `${Number(v.xirr).toFixed(1)}%` : "—"} tone={num(v.xirr) < 0 ? palette.danger : palette.success} />
        </View>
        {holdings.length > 0 ? (
          <View style={{ marginTop: spacing.sm }}>
            {holdings.slice(0, 10).map((h: any, i: number) => (
              <View key={i} style={styles.holding}>
                <View style={{ flex: 1 }}>
                  <Text variant="caption" style={{ fontWeight: fontWeight.medium }} numberOfLines={1}>{h.schemeName ?? h.schemeCode ?? "Scheme"}</Text>
                  <Text variant="caption" tone="faint" numberOfLines={1}>{h.amcName ?? "—"}</Text>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Text variant="caption" style={{ fontWeight: fontWeight.semibold }}>{money(h.currentValue)}</Text>
                  {h.gain != null ? (
                    <Text variant="caption" style={{ color: num(h.gain) < 0 ? palette.danger : palette.success }}>{num(h.gain) >= 0 ? "+" : ""}{inr(h.gain)}</Text>
                  ) : null}
                </View>
              </View>
            ))}
            {holdings.length > 10 ? <Text variant="caption" tone="faint" style={{ marginTop: spacing.xs }}>+ {holdings.length - 10} more</Text> : null}
            {num(v.unpricedSchemes) > 0 ? <Text variant="caption" tone="warning" style={{ marginTop: spacing.xs }}>{num(v.unpricedSchemes)} scheme{num(v.unpricedSchemes) === 1 ? "" : "s"} couldn't be priced.</Text> : null}
          </View>
        ) : (
          <Text variant="caption" tone="muted" style={{ marginTop: spacing.sm }}>No priced holdings yet.</Text>
        )}
      </Section>

      {/* Churn */}
      <Section title="Churn risk" icon="alert-triangle" right={<Badge label={titleCase(d.churn?.band) || "—"} tone={churnTone(d.churn?.band)} />}>
        <Text variant="caption" tone="muted">{d.churn?.headline ?? "No churn signals."}</Text>
        {(d.churn?.factors ?? []).slice(0, 4).map((f: any, i: number) => (
          <View key={i} style={styles.factor}>
            <View style={[styles.dot, { backgroundColor: churnTone(d.churn?.band) }]} />
            <Text variant="caption" style={{ flex: 1 }}>{f.label}</Text>
            <Text variant="caption" tone="faint">+{f.points}</Text>
          </View>
        ))}
      </Section>

      {/* Allocation */}
      <Section title="Portfolio allocation" icon="layers">
        {num(exp.classifiedPct) > 0 ? (
          <>
            <AllocBar label="Equity" pct={num(exp.equityPct)} value={exp.equity} tone={palette.brand} />
            <AllocBar label="Defensive (debt/hybrid)" pct={exp.equityPct != null ? 100 - num(exp.equityPct) : 0} value={exp.defensive} tone={palette.info} />
            <Text variant="caption" tone="faint" style={{ marginTop: 2 }}>Classified {Number(exp.classifiedPct).toFixed(0)}% of measured value.</Text>
          </>
        ) : (
          <Empty text="Not enough priced holdings to compute allocation." />
        )}
      </Section>

      {/* SIP health */}
      <Section title="SIP health" icon="repeat">
        <View style={styles.valGrid}>
          <ValCell label="Active SIPs" value={String(sh.activeSips ?? 0)} />
          <ValCell label="Committed/mo" value={inr(sh.monthlyCommitted)} />
          <ValCell label="Bounces (6mo)" value={String(sh.bounces6mo ?? 0)} tone={num(sh.bounces6mo) > 0 ? palette.danger : undefined} />
          <ValCell label="Worst streak" value={String(sh.maxConsecutiveFailures ?? 0)} tone={num(sh.maxConsecutiveFailures) > 0 ? palette.warning : undefined} />
        </View>
      </Section>

      {/* Transaction ledger */}
      <Section title="Transaction history" icon="list" right={<Text variant="caption" tone="faint">latest {Math.min(tx.length, 30)} of {d.txCount ?? tx.length}</Text>}>
        {tx.length === 0 ? <Empty text="No transactions yet." /> : tx.slice(0, 30).map((t: any) => (
          <View key={t.id} style={styles.txRow}>
            <View style={{ flex: 1 }}>
              <Text variant="caption" style={{ fontWeight: fontWeight.medium }} numberOfLines={1}>{t.schemeName ?? "—"}</Text>
              <Text variant="caption" tone="faint">{titleCase(t.type)} · {fmtDate(t.orderDate ?? t.createdAt)}</Text>
            </View>
            <View style={{ alignItems: "flex-end" }}>
              <Text variant="caption" style={{ fontWeight: fontWeight.semibold }}>{inr(t.amount)}</Text>
              <Text variant="caption" tone="faint">{titleCase(t.status)}</Text>
              {d.investor?.id && EMAILABLE_TYPES.includes(t.type) && EMAILABLE_STATUSES.includes(t.status) ? (
                <Text variant="caption" tone="brand" onPress={() => emailRecord(d.investor.id, d.investor.name, t)}>Email client</Text>
              ) : null}
            </View>
          </View>
        ))}
      </Section>

      {d.investor?.id ? <ClientFixedDeposits investorId={d.investor.id} name={d.investor.name} /> : null}

      {/* Cross-sell */}
      <Section title="Cross-sell / holdings" icon="shopping-bag">
        {(d.crossSell ?? []).length === 0 ? <Empty text="No cross-sell opportunities flagged." /> : (d.crossSell ?? []).map((c: any, i: number) => (
          <FieldRow key={i} label={titleCase(c.label ?? c.product ?? c.key ?? "Product")} value={titleCase(c.status ?? c.reason ?? "opportunity")} />
        ))}
      </Section>
    </View>
  );
}

function ValCell({ label, value, tone, sub }: { label: string; value: string; tone?: string; sub?: string }) {
  return (
    <View style={styles.valCell}>
      <Text variant="caption" tone="muted">{label}</Text>
      <Text style={{ fontWeight: fontWeight.bold, color: tone ?? palette.ink }} numberOfLines={1}>{value}</Text>
      {sub ? <Text variant="caption" tone="faint">{sub}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  valGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  valCell: { width: "47%", flexGrow: 1, backgroundColor: palette.surfaceAlt, borderRadius: radius.sm, padding: spacing.md },
  holding: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.xs, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.lineSoft },
  factor: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.xs },
  dot: { width: 7, height: 7, borderRadius: 4 },
  txRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.xs, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.lineSoft },
});
