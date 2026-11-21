/**
 * A proposal in presenter mode — what the client's own copy shows (the PDF
 * and the /p/<token> page), nothing more: the title, who it is for, the PDF's
 * "At a glance" figures, each recommendation (name, kind, amount, risk-o-meter,
 * goal, AMC), and the PDF's assumptions and Important disclosures in full.
 *
 * Left out on purpose: the RM's notes on each line, the suitability note and
 * any override, the client's risk alignment, status, versions, contact
 * details and every internal id.
 */

import React from "react";
import { View, StyleSheet } from "react-native";
import { Text } from "../../components/ui/Text";
import { useTheme } from "../../theme";
import { spacing, radius, fontWeight } from "../../theme/tokens";
import { inr, fmtDate } from "../../lib/format";
import type { Proposal } from "../proposals/api";
import { itemAmountText, itemKindLabel, itemName, itemRiskLabel } from "../proposals/shared/items";
import { BigFigure, Presenter, useFirm } from "./Presenter";
import {
  AMFI_TAGLINE, DISCLOSURES_LEAD, ILLUSTRATIVE_NOTES, MANDATORY_RISK_DISCLAIMER, proposalAtAGlance, proposalDisclosures,
} from "./disclosures";

export function ProposalPresentation({ visible, onClose, proposal: p }: { visible: boolean; onClose: () => void; proposal: Proposal }) {
  const { color } = useTheme();
  const firm = useFirm();
  const products = (p.products ?? []) as any[];
  const tiles = proposalAtAGlance(products, p);
  const illustrative = tiles.some((t) => t.label.endsWith("*"));
  const disclosures = proposalDisclosures({
    firm: firm.name,
    arn: firm.arnRaw,
    products,
    email: firm.email,
    phone: firm.phone,
    proposalDate: p.preparedAt ?? p.createdAt,
    validUntil: p.validUntil,
    disclaimer: p.disclaimer,
  });
  const subtitle = [`Prepared for ${p.recipientName}`, p.validUntil ? `Valid until ${fmtDate(p.validUntil)}` : null].filter(Boolean).join(" · ");

  return (
    <Presenter
      visible={visible}
      onClose={onClose}
      title={p.title}
      subtitle={subtitle}
      footer={
        <>
          <Text variant="body" tone="muted" style={{ lineHeight: 22 }}>{MANDATORY_RISK_DISCLAIMER}</Text>
          <Text variant="label" tone="muted">{[firm.name, AMFI_TAGLINE, firm.arn].filter(Boolean).join(" · ")}</Text>
        </>
      }
    >
      {tiles.length > 0 ? (
        <View style={styles.tiles}>
          {tiles.map((t) => (
            <View key={t.label} style={styles.tile}>
              <BigFigure label={t.label} value={inr(t.value)} sub={t.sub} />
            </View>
          ))}
        </View>
      ) : null}

      {products.length > 0 ? (
        <>
          <Text variant="heading" style={{ marginTop: spacing.md }}>Recommendations</Text>
          {products.map((it, i) => {
            const facts = [
              it?.amcName ?? it?.insurer ?? it?.manager ?? it?.company ?? null,
              it?.category ?? null,
              itemRiskLabel(it) ? `Risk-o-meter: ${itemRiskLabel(it)}` : null,
              it?.goal ? `Goal: ${it.goal}` : null,
            ].filter(Boolean);
            return (
              <View key={i} style={[styles.item, { backgroundColor: color.surface, borderColor: color.line }]}>
                <Text variant="label" style={{ color: color.brandDark, fontWeight: fontWeight.semibold }}>{itemKindLabel(it)}</Text>
                <Text variant="heading" style={{ marginTop: 2 }}>{itemName(it)}</Text>
                <Text variant="subtitle" style={{ marginTop: spacing.xs }}>{itemAmountText(it)}</Text>
                {facts.length > 0 ? <Text variant="body" tone="muted" style={{ marginTop: spacing.xs }}>{facts.join(" · ")}</Text> : null}
              </View>
            );
          })}
        </>
      ) : null}

      {illustrative ? (
        <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
          {ILLUSTRATIVE_NOTES.map((t) => <Text key={t} variant="body" tone="muted" style={{ lineHeight: 22 }}>{t}</Text>)}
        </View>
      ) : null}

      <Text variant="heading" style={{ marginTop: spacing.lg }}>Important disclosures</Text>
      <Text variant="body" tone="muted" style={{ lineHeight: 22 }}>{DISCLOSURES_LEAD}</Text>
      {disclosures.map(([head, body], i) => (
        <View key={head} style={{ gap: 2 }}>
          <Text variant="subtitle">{`${i + 1}. ${head}`}</Text>
          <Text variant="body" tone="muted" style={{ lineHeight: 22 }}>{body}</Text>
        </View>
      ))}
    </Presenter>
  );
}

const styles = StyleSheet.create({
  tiles: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  tile: { flexGrow: 1, flexBasis: "45%" },
  item: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, padding: spacing.lg },
});
