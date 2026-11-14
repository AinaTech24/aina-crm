/**
 * Step 1's "From the CRM" (web ProposalBuilder SnapshotCard): the risk
 * profile's state, and only the facts the CRM actually holds — a prospect's
 * empty tiles said nothing. An unconfirmed profile offers the risk-profile
 * link (a mutual fund proposal cannot be sent without a confirmed one).
 */

import React from "react";
import { View, ActivityIndicator } from "react-native";
import { Feather } from "@expo/vector-icons";
import { Card } from "../../../components/ui/Card";
import { Text } from "../../../components/ui/Text";
import { Button } from "../../../components/ui/Button";
import { StatusPill } from "../../../components/ui/StatusPill";
import { SendFormSheet } from "../../client-forms/SendFormSheet";
import { PROFILE_LABEL, type ProposalSnapshot } from "../api";
import { CardHeader, Tile, proposalStyles } from "../ui";
import { fmtDate } from "../../../lib/format";
import { spacing, palette } from "../../../theme/tokens";

const rupees = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

export function SnapshotCard({ snapshot: s, loading }: { snapshot: ProposalSnapshot | null | undefined; loading: boolean }) {
  const [linkOpen, setLinkOpen] = React.useState(false);
  if (loading && !s) {
    return (
      <Card style={proposalStyles.card}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <ActivityIndicator size="small" color={palette.muted} />
          <Text variant="caption" tone="muted">Reading what the CRM knows…</Text>
        </View>
      </Card>
    );
  }
  if (!s) return null;

  const tone = s.risk.status === "Completed" || s.riskExempt ? "success" : s.risk.status === "Not completed" ? "neutral" : "warning";
  const tiles = [
    s.risk.category && { label: "Risk category", value: `${PROFILE_LABEL[s.risk.category] ?? s.risk.category}${s.risk.score != null ? ` · ${s.risk.score}` : ""}` },
    s.holdings && { label: "Current AUM", value: rupees(s.holdings.aum) },
    s.holdings && { label: "Running SIPs", value: `${rupees(s.holdings.sipBook)}/mo` },
    s.holdings?.equityPct != null && {
      label: "Equity share",
      value: `${Math.round(s.holdings.equityPct)}%`,
      hint: s.band ? `band ${s.band.floor}–${s.band.ceiling}%` : undefined,
      warn: s.band != null && s.holdings.equityPct > s.band.ceiling,
    },
    s.goals[0] && { label: "Goal", value: `${s.goals[0].name}${s.goals[0].targetYear ? ` ${s.goals[0].targetYear}` : ""}` },
  ].filter(Boolean) as Array<{ label: string; value: string; hint?: string; warn?: boolean }>;
  const needsProfile = s.risk.status !== "Completed" && !s.riskExempt;

  return (
    <Card style={proposalStyles.card}>
      <CardHeader title="From the CRM" />
      <StatusPill
        size="sm"
        tone={tone}
        label={s.risk.status === "Completed" && s.risk.signedAt ? `Risk profile confirmed ${fmtDate(s.risk.signedAt)}` : s.riskExempt ? "Minor — no risk profile needed" : `Risk profile: ${s.risk.status.toLowerCase()}`}
      />
      {needsProfile ? (
        <Button label="Send risk profile link" size="sm" variant="secondary" icon={<Feather name="link" size={14} color={palette.ink} />} onPress={() => setLinkOpen(true)} style={{ marginTop: spacing.md, alignSelf: "flex-start" }} />
      ) : null}
      {tiles.length > 0 ? <View style={[proposalStyles.tiles, { marginTop: spacing.md }]}>{tiles.map((t) => <Tile key={t.label} {...t} />)}</View> : null}
      {needsProfile ? <SendFormSheet visible={linkOpen} onClose={() => setLinkOpen(false)} subjectType={s.kind} subjectId={s.subjectId} name={s.name} /> : null}
    </Card>
  );
}
