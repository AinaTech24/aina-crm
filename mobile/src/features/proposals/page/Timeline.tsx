/**
 * "What {client} did" — a proposal's life as a timeline (web
 * ProposalTimeline): drafted → sent → opened → decided → executed.
 */

import React from "react";
import { View, StyleSheet } from "react-native";
import { Text } from "../../../components/ui/Text";
import { proposalSteps, type Step } from "../shared/timeline";
import type { Proposal } from "../api";
import { spacing, palette, fontWeight } from "../../../theme/tokens";

const DOT: Record<Step["state"], { bg: string; border: string }> = {
  done: { bg: palette.success, border: palette.success },
  now: { bg: palette.surface, border: palette.brand },
  todo: { bg: palette.surface, border: palette.line },
  warn: { bg: palette.warning, border: palette.warning },
  bad: { bg: palette.danger, border: palette.danger },
};

export function ProposalTimeline({ proposal }: { proposal: Proposal }) {
  const steps = proposalSteps(proposal);
  return (
    <View>
      {steps.map((s, i) => (
        <View key={i} style={styles.row}>
          <View style={styles.rail}>
            <View style={[styles.dot, { backgroundColor: DOT[s.state].bg, borderColor: DOT[s.state].border }]} />
            {i < steps.length - 1 ? <View style={styles.line} /> : null}
          </View>
          <View style={{ flex: 1, paddingBottom: i < steps.length - 1 ? spacing.md : 0 }}>
            <Text variant="body" style={{ color: palette.ink, fontWeight: fontWeight.medium }}>{s.title}</Text>
            {s.detail ? <Text variant="caption" tone="muted">{s.detail}</Text> : null}
          </View>
          {s.when ? <Text variant="caption" tone="muted">{s.when}</Text> : null}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: spacing.md },
  rail: { width: 16, alignItems: "center" },
  dot: { width: 14, height: 14, borderRadius: 7, borderWidth: 2, marginTop: 3 },
  line: { flex: 1, width: 2, backgroundColor: palette.line, marginTop: 2 },
});
