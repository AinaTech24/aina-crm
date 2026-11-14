/**
 * Step 3 — what the client gets (web builder ReviewStep). The PDF is rendered
 * from what is in the builder (POST /api/proposals/preview-pdf — nothing is
 * saved) and opened in the phone's viewer / share sheet, so what the RM checks
 * is the document the client receives. Below it, the words the client signs,
 * and the firm's own extra disclosure behind "Add a disclosure".
 */

import React from "react";
import { View, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { Card } from "../../../components/ui/Card";
import { Text } from "../../../components/ui/Text";
import { Button } from "../../../components/ui/Button";
import { TextField } from "../../../components/ui/TextField";
import { RISKOMETER_LABEL, type ProposalLine, type Riskometer } from "../api";
import { PROPOSAL_ACCEPTANCE_TEXT } from "../shared/acceptance";
import { itemAmountText, itemKindLabel, itemName } from "../shared/items";
import { previewProposalPdf } from "../pdf";
import { CardHeader, proposalStyles } from "../ui";
import { toast } from "../../../lib/toast";
import { spacing, palette, radius, fontWeight } from "../../../theme/tokens";

/**
 * What the disclaimer box used to start with. The PDF prints the full SEBI /
 * AMFI disclosures itself, so a new proposal starts with no extra one.
 */
export const OLD_DEFAULT_DISCLAIMER =
  "Mutual Fund investments are subject to market risks. Read all scheme-related documents carefully. Past performance is not indicative of future returns. Insurance is the subject matter of solicitation. The information provided here is for illustrative purposes only.";

export function ReviewStep({ name, title, items, previewBody, disclaimer, setDisclaimer, locked }: {
  name: string;
  title: string;
  items: ProposalLine[];
  previewBody: () => Record<string, unknown>;
  disclaimer: string;
  setDisclaimer: (s: string) => void;
  locked: boolean;
}) {
  const first = name.split(" ")[0] || "The client";
  const [busy, setBusy] = React.useState(false);
  const [showDisclaimer, setShowDisclaimer] = React.useState(!!disclaimer.trim() && disclaimer.trim() !== OLD_DEFAULT_DISCLAIMER);

  const open = async () => {
    setBusy(true);
    try {
      await previewProposalPdf(previewBody());
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't render the PDF.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View>
      <Card style={proposalStyles.card}>
        <CardHeader title={`What ${first} receives`} />
        <Text variant="body" style={{ color: palette.ink, fontWeight: fontWeight.semibold }}>{title || "Investment Proposal"}</Text>
        <View style={{ marginTop: spacing.sm }}>
          {items.map((it, i) => {
            const risk = it.kind === "mf" && it.riskRating ? RISKOMETER_LABEL[it.riskRating as Riskometer] : null;
            return (
              <View key={i} style={[styles.line, i === items.length - 1 && { borderBottomWidth: 0 }]}>
                <View style={styles.kind}><Text variant="caption" style={{ color: palette.brandDark, fontWeight: fontWeight.semibold }}>{itemKindLabel(it)}</Text></View>
                <View style={{ flex: 1 }}>
                  <Text variant="body" numberOfLines={2} style={{ color: palette.ink }}>{itemName(it)}</Text>
                  <Text variant="caption" tone="muted">{[itemAmountText(it), risk ? `${risk} risk` : null].filter(Boolean).join(" · ")}</Text>
                </View>
              </View>
            );
          })}
        </View>
        <Button label="Open the PDF" variant="primary" loading={busy} onPress={open} full icon={<Feather name="file-text" size={16} color={palette.white} />} style={{ marginTop: spacing.md }} />
      </Card>

      <Card style={proposalStyles.card}>
        <Text variant="label" style={{ fontWeight: fontWeight.semibold, color: palette.ink, marginBottom: spacing.xs }}>What {first} signs</Text>
        <View style={styles.signs}><Text variant="caption" style={{ color: palette.ink70, lineHeight: 19 }}>{PROPOSAL_ACCEPTANCE_TEXT}</Text></View>
        {showDisclaimer ? (
          <View style={{ marginTop: spacing.md }}>
            <TextField label="Additional disclosure" value={disclaimer} onChangeText={(v) => setDisclaimer(v.slice(0, 2000))} multiline disabled={locked} />
          </View>
        ) : !locked ? (
          <Button label="Add a disclosure" size="sm" variant="ghost" icon={<Feather name="plus" size={14} color={palette.brandDark} />} onPress={() => setShowDisclaimer(true)} style={{ marginTop: spacing.sm, alignSelf: "flex-start" }} />
        ) : null}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  line: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line },
  kind: { backgroundColor: palette.brandLight, borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 2, marginTop: 2 },
  signs: { borderRadius: radius.md, backgroundColor: palette.surfaceSunken, padding: spacing.md },
});
