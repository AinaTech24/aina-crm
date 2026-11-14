/**
 * Suitability & Compliance (web ProposalSuitabilityPanel + RiskAlignmentBanner):
 * the risk profile suitability check of the MF lines, the suitability note the
 * send route requires (drafted from the proposal while none is saved), and the
 * owner's override reason. Both stay editable after sending — they describe
 * the proposal's life, not its content.
 */

import React from "react";
import { View, Pressable } from "react-native";
import { Feather } from "@expo/vector-icons";
import { Card } from "../../../components/ui/Card";
import { Text } from "../../../components/ui/Text";
import { Button } from "../../../components/ui/Button";
import { TextField } from "../../../components/ui/TextField";
import { useUpdateProposal, type Proposal } from "../api";
import { checkAlignment, type ClientProfile, type SchemeLine } from "../shared/risk-alignment";
import { Banner, CardHeader, proposalStyles } from "../ui";
import { toast } from "../../../lib/toast";
import { spacing, palette, fontWeight } from "../../../theme/tokens";

export function SuitabilityPanel({ proposal: p, suggestedNote, profile, canWrite }: {
  proposal: Proposal;
  suggestedNote: string;
  profile: ClientProfile;
  canWrite: boolean;
}) {
  const update = useUpdateProposal(p.id);
  const saved = p.suitabilityNote ?? "";
  const prefilled = !saved.trim() && !!suggestedNote;
  const [note, setNote] = React.useState(prefilled ? suggestedNote : saved);
  const [override, setOverride] = React.useState(p.suitabilityOverrideReason ?? "");
  const touched = React.useRef(false);

  // Follow the saved note (a send that asked for it saved it), and a draft that arrives late.
  React.useEffect(() => {
    if (saved.trim()) { setNote(saved); touched.current = false; }
    else if (!touched.current && suggestedNote) setNote(suggestedNote);
  }, [saved, suggestedNote]);
  React.useEffect(() => { setOverride(p.suitabilityOverrideReason ?? ""); }, [p.suitabilityOverrideReason]);

  const schemes: SchemeLine[] = (p.products ?? []).filter((it) => it.kind === "mf").map((it: any) => ({ name: it.schemeName, riskRating: it.riskRating }));

  const save = () =>
    update.mutate(
      { suitabilityNote: note.trim() || null, suitabilityOverrideReason: override.trim() || null },
      { onSuccess: () => toast.success("Compliance details saved — you can now send the proposal.") }
    );

  return (
    <Card style={proposalStyles.card}>
      <CardHeader title="Suitability & Compliance" right={<Feather name="shield" size={18} color={palette.muted} />} />
      {schemes.length > 0 ? (
        <View style={{ marginBottom: spacing.md }}>
          <Text variant="caption" tone="muted" style={{ letterSpacing: 0.6, fontWeight: fontWeight.semibold, marginBottom: spacing.xs }}>RISK PROFILE SUITABILITY CHECK</Text>
          <AlignmentBanner profile={profile} schemes={schemes} />
        </View>
      ) : null}
      <TextField
        label="Suitability Note (Required to Send)"
        value={note}
        onChangeText={(v) => { touched.current = true; setNote(v.slice(0, 2000)); }}
        multiline
        disabled={!canWrite}
        placeholder="Describe why this portfolio structure aligns with the client's goals and risk profile..."
      />
      <Text variant="caption" tone="muted" style={{ marginTop: -spacing.md, marginBottom: spacing.lg }}>
        {prefilled && note === suggestedNote
          ? "Drafted from this proposal — read it, add anything specific to this client, then save."
          : "Must detail the recommendations' alignment with client goals (e.g. tax planning, wealth creation)."}
      </Text>
      <TextField
        label="Owner Override Reason (Optional)"
        value={override}
        onChangeText={(v) => setOverride(v.slice(0, 2000))}
        multiline
        disabled={!canWrite}
        placeholder="Owner justification for bypassing suitability check warning..."
      />
      <Text variant="caption" style={{ color: palette.warning, marginTop: -spacing.md, marginBottom: spacing.lg }}>
        Required only if suitability note is missing and you have owner rights to override compliance warning.
      </Text>
      {canWrite ? <Button label="Save Compliance Details" size="sm" loading={update.isPending} onPress={save} icon={<Feather name="save" size={14} color={palette.white} />} style={{ alignSelf: "flex-end" }} /> : null}
    </Card>
  );
}

function AlignmentBanner({ profile, schemes }: { profile: ClientProfile; schemes: SchemeLine[] }) {
  const r = checkAlignment(profile, schemes);
  const [open, setOpen] = React.useState(r.overall !== "ok");
  if (r.overall === "ok") {
    return (
      <Banner tone="success">
        <View style={{ flexDirection: "row", gap: spacing.sm, alignItems: "center" }}>
          <Feather name="check-circle" size={14} color={palette.success} />
          <Text variant="caption" style={{ flex: 1, color: palette.success }}>{r.summary}</Text>
        </View>
      </Banner>
    );
  }
  const tone = r.overall === "block" ? "danger" : "warning";
  const fg = r.overall === "block" ? palette.danger : palette.warning;
  return (
    <Banner tone={tone}>
      <Pressable onPress={() => setOpen((v) => !v)} style={{ flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" }} accessibilityRole="button" accessibilityLabel={open ? "Hide details" : "Show details"}>
        <Feather name={r.overall === "block" ? "x-octagon" : "alert-triangle"} size={14} color={fg} style={{ marginTop: 2 }} />
        <Text variant="caption" style={{ flex: 1, color: fg, fontWeight: fontWeight.semibold }}>{r.summary}</Text>
        <Feather name={open ? "chevron-up" : "chevron-down"} size={14} color={fg} />
      </Pressable>
      {open ? r.findings.map((f, i) => (
        <View key={i} style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.xs }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, marginTop: 5, backgroundColor: f.severity === "ok" ? palette.success : f.severity === "warn" ? palette.warning : palette.danger }} />
          <View style={{ flex: 1 }}>
            <Text variant="caption" style={{ color: palette.ink, fontWeight: fontWeight.semibold }}>{f.schemeName}{f.schemeRisk ? ` (${f.schemeRisk}-risk)` : ""}</Text>
            <Text variant="caption" tone="muted">{f.message}</Text>
          </View>
        </View>
      )) : null}
    </Banner>
  );
}
