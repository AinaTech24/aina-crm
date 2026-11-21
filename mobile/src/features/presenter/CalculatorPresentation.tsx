/**
 * A calculator result in presenter mode: the same ResultBlocks the screen
 * shows (so every figure is the screen's), set in large type — the headline
 * figures, the growth chart, the insights and tables — with every note the
 * calculator carries and the web illustration's disclaimer at the foot.
 */

import React from "react";
import { View, ScrollView, StyleSheet } from "react-native";
import { Text } from "../../components/ui/Text";
import { useTheme, toneColors } from "../../theme";
import { spacing, radius, fontWeight } from "../../theme/tokens";
import { GrowthChart } from "../calculators/GrowthChart";
import type { ResultBlock } from "../calculators/types";
import { BigFigure, Presenter } from "./Presenter";
import { CALC_ILLUSTRATION_DISCLAIMER } from "./disclosures";

export function CalculatorPresentation({ visible, onClose, name, blocks }: {
  visible: boolean;
  onClose: () => void;
  name: string;
  blocks: ResultBlock[];
}) {
  return (
    <Presenter
      visible={visible}
      onClose={onClose}
      title={name}
      footer={<Text variant="body" tone="muted" style={{ lineHeight: 22 }}>{CALC_ILLUSTRATION_DISCLAIMER}</Text>}
    >
      {blocks.map((b, i) => <PresentBlock key={i} block={b} />)}
    </Presenter>
  );
}

const COL_W = 132;
const FIRST_COL_W = 110;

function PresentBlock({ block }: { block: ResultBlock }) {
  const { color } = useTheme();
  if (block.type === "section") {
    return <Text variant="heading" style={{ marginTop: spacing.md }}>{block.text}</Text>;
  }
  if (block.type === "stat") {
    const tc = toneColors((block.tone ?? "neutral") as any);
    return <BigFigure label={block.label} value={block.value} sub={block.hint} fg={block.tone ? tc.fg : undefined} bg={block.tone ? tc.bg : undefined} />;
  }
  if (block.type === "chart") {
    return <GrowthChart spec={block.chart} large />;
  }
  if (block.type === "insight") {
    const tc = toneColors((block.tone ?? "brand") as any);
    return (
      <View style={[styles.insight, { backgroundColor: tc.bg, borderLeftColor: tc.fg }]}>
        <Text variant="body" style={{ color: color.ink, lineHeight: 24 }}>{block.text}</Text>
      </View>
    );
  }
  if (block.type === "note") {
    return <Text variant="body" tone="muted" style={{ lineHeight: 22 }}>{block.text}</Text>;
  }
  // table — body-size type; wide tables scroll sideways with fixed columns.
  const scroll = block.head.length > 2;
  const width = (i: number) => (scroll ? { width: i === 0 ? FIRST_COL_W : COL_W } : { flex: i === 0 ? 1.4 : 1 });
  const last = block.rows.length - 1;
  const body = (
    <View>
      <View style={[styles.tr, { backgroundColor: color.surfaceSunken }]}>
        {block.head.map((h, i) => (
          <Text key={i} variant="label" style={[styles.cell, width(i), i === 0 && styles.first, { color: color.muted }]}>{h}</Text>
        ))}
      </View>
      {block.rows.map((row, ri) => {
        const strong = block.highlightLast && ri === last;
        return (
          <View key={ri} style={[styles.tr, { borderTopColor: color.line, borderTopWidth: StyleSheet.hairlineWidth }, strong && { backgroundColor: color.brandLight }]}>
            {row.map((cell, ci) => (
              <Text key={ci} variant="body" style={[styles.cell, width(ci), ci === 0 && styles.first, { color: ci === 0 ? color.muted : color.ink }, strong && { fontWeight: fontWeight.semibold }]}>{cell}</Text>
            ))}
          </View>
        );
      })}
    </View>
  );
  return (
    <View style={[styles.table, { borderColor: color.line, backgroundColor: color.surface }]}>
      {scroll ? <ScrollView horizontal showsHorizontalScrollIndicator>{body}</ScrollView> : body}
    </View>
  );
}

const styles = StyleSheet.create({
  insight: { borderRadius: radius.md, borderLeftWidth: 4, padding: spacing.lg },
  table: { borderWidth: 1, borderRadius: radius.md, overflow: "hidden" },
  tr: { flexDirection: "row", paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.sm },
  cell: { textAlign: "right" },
  first: { textAlign: "left" },
});
