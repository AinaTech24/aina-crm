/**
 * Shared calculator UI: the input row renderer and the ResultBlock renderer.
 * Both are driven purely by the calculator definition, so every calculator
 * screen looks and behaves identically.
 */

import React from "react";
import { View, TextInput, Pressable, ScrollView, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { Text } from "../../components/ui/Text";
import { Segmented } from "../../components/ui/Segmented";
import { SelectField } from "../../components/ui/SelectField";
import { DateField } from "../../components/form/DateField";
import { spacing, palette, radius, fontSize, fontWeight } from "../../theme/tokens";
import { toneColors } from "../../theme";
import { inr } from "./fmt";
import { SchemeInput } from "./SchemeInput";
import { GrowthChart } from "./GrowthChart";
import type { InputSpec, ResultBlock, Tone } from "./types";

const TONE_FALLBACK: Tone = "neutral";

/** Today in India as ISO yyyy-mm-dd (UTC+5:30, whatever the phone's zone). */
const todayIst = (): string => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

const parseNum = (t: string): number => {
  const n = parseFloat(t.replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
};

/** A single numeric field with an inline unit suffix (₹ / % / yrs). */
function NumberInput({ spec, value, onChange }: { spec: InputSpec; value: number; onChange: (n: number) => void }) {
  const [text, setText] = React.useState(value === 0 ? "" : String(value));
  // Sync from the value only when it changed from OUTSIDE this field (a reset,
  // a linked input). Rewriting the text on every keystroke made "0.5" and
  // "7.0" impossible to type: "0" parsed to 0 and the field blanked itself.
  React.useEffect(() => {
    if (parseNum(text) !== value) setText(value === 0 ? "" : String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const unit = spec.type === "money" ? "₹" : spec.type === "percent" ? "%" : spec.type === "years" ? "yrs" : "";
  const commit = (t: string) => {
    setText(t);
    onChange(parseNum(t));
  };
  return (
    <View style={styles.field}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.xs, gap: spacing.sm }}>
        <Text variant="label" tone="muted" style={{ flexShrink: 1 }}>{spec.label}</Text>
        {spec.type === "money" && value >= 1000 ? <Text variant="caption" tone="faint">{inr(value)}</Text> : null}
      </View>
      <View style={styles.inputWrap}>
        {unit === "₹" ? <Text style={styles.unitLead}>₹</Text> : null}
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={commit}
          keyboardType={spec.type === "int" ? "number-pad" : "decimal-pad"}
          placeholder={spec.placeholder ?? "0"}
          placeholderTextColor={palette.faint}
          selectTextOnFocus
          accessibilityLabel={spec.label}
        />
        {unit && unit !== "₹" ? <Text style={styles.unitTrail}>{unit}</Text> : null}
      </View>
      {spec.hint ? <Text variant="caption" tone="faint" style={{ marginTop: 4 }}>{spec.hint}</Text> : null}
    </View>
  );
}

/** Renders any input spec to the right control. */
export function CalcInput({ spec, value, onChange }: { spec: InputSpec; value: any; onChange: (v: any) => void }) {
  const heading = spec.section ? <Text variant="caption" tone="faint" style={styles.inputSection}>{spec.section.toUpperCase()}</Text> : null;
  let control: React.ReactNode;
  if (spec.type === "segmented") {
    control = (
      <View style={styles.field}>
        <Text variant="label" tone="muted" style={{ marginBottom: spacing.xs }}>{spec.label}</Text>
        <Segmented
          options={(spec.options ?? []).map((o) => ({ key: o.value, label: o.label }))}
          value={String(value)}
          onChange={(v) => onChange(v)}
        />
        {spec.hint ? <Text variant="caption" tone="faint" style={{ marginTop: 4 }}>{spec.hint}</Text> : null}
      </View>
    );
  } else if (spec.type === "select") {
    // SelectField carries its own bottom margin.
    control = (
      <View>
        <SelectField label={spec.label} value={value == null ? null : String(value)} options={spec.options ?? []} onChange={(v) => onChange(v)} />
        {spec.hint ? <Text variant="caption" tone="faint" style={{ marginTop: -spacing.sm, marginBottom: spacing.lg }}>{spec.hint}</Text> : null}
      </View>
    );
  } else if (spec.type === "toggle") {
    control = (
      <Pressable style={[styles.field, styles.toggleRow]} onPress={() => onChange(!value)} accessibilityRole="switch" accessibilityState={{ checked: !!value }}>
        <View style={{ flex: 1 }}>
          <Text variant="body">{spec.label}</Text>
          {spec.hint ? <Text variant="caption" tone="faint">{spec.hint}</Text> : null}
        </View>
        <View style={[styles.switch, value && styles.switchOn]}>
          <View style={[styles.knob, value && styles.knobOn]} />
        </View>
      </Pressable>
    );
  } else if (spec.type === "text") {
    control = (
      <View style={styles.field}>
        <Text variant="label" tone="muted" style={{ marginBottom: spacing.xs }}>{spec.label}</Text>
        <View style={styles.inputWrap}>
          <TextInput
            style={[styles.input, { fontWeight: fontWeight.medium, fontSize: fontSize.md }]}
            value={String(value ?? "")}
            onChangeText={onChange}
            placeholder={spec.placeholder ?? ""}
            placeholderTextColor={palette.faint}
            accessibilityLabel={spec.label}
          />
        </View>
        {spec.hint ? <Text variant="caption" tone="faint" style={{ marginTop: 4 }}>{spec.hint}</Text> : null}
      </View>
    );
  } else if (spec.type === "date") {
    control = (
      <View style={styles.field}>
        <DateField label={spec.label} value={String(value ?? "")} onChange={onChange} help={spec.hint} max={spec.maxToday ? todayIst() : undefined} />
      </View>
    );
  } else if (spec.type === "scheme") {
    control = (
      <View style={styles.field}>
        <SchemeInput label={spec.label} value={value ?? null} onChange={onChange} source={spec.source} />
        {spec.hint ? <Text variant="caption" tone="faint" style={{ marginTop: 4 }}>{spec.hint}</Text> : null}
      </View>
    );
  } else {
    control = <NumberInput spec={spec} value={Number(value) || 0} onChange={onChange} />;
  }
  return <>{heading}{control}</>;
}

/** Column widths for a scrolling table: the first (label) column is narrower. */
const COL_W = 104;
const FIRST_COL_W = 96;

/** Renders a single ResultBlock. */
export function ResultBlockView({ block }: { block: ResultBlock }) {
  if (block.type === "section") {
    return <Text variant="caption" tone="faint" style={styles.section}>{block.text.toUpperCase()}</Text>;
  }
  if (block.type === "note") {
    return <Text variant="caption" tone="faint" style={styles.note}>{block.text}</Text>;
  }
  if (block.type === "chart") {
    return <GrowthChart spec={block.chart} />;
  }
  if (block.type === "stat") {
    const tc = toneColors((block.tone ?? TONE_FALLBACK) as any);
    return (
      <View style={[styles.stat, { backgroundColor: tc.bg }]}>
        <Text variant="caption" style={{ color: tc.fg, fontWeight: fontWeight.medium }}>{block.label}</Text>
        <Text style={[styles.statValue, { color: tc.fg }]} adjustsFontSizeToFit numberOfLines={1}>{block.value}</Text>
        {block.hint ? <Text variant="caption" style={{ color: tc.fg, opacity: 0.8 }}>{block.hint}</Text> : null}
      </View>
    );
  }
  if (block.type === "insight") {
    const tc = toneColors((block.tone ?? "brand") as any);
    return (
      <View style={[styles.insight, { backgroundColor: tc.bg, borderLeftColor: tc.fg }]}>
        <Feather name="info" size={14} color={tc.fg} style={{ marginTop: 2 }} />
        <Text variant="caption" style={{ color: palette.ink, flex: 1, lineHeight: 18 }}>{block.text}</Text>
      </View>
    );
  }
  // table — up to three columns fit a phone; wider tables scroll sideways with
  // fixed column widths, so a ₹1,17,91,026 is never cut to "₹1,17,9…".
  const scroll = block.head.length > 3;
  const width = (i: number) => (scroll ? { width: i === 0 ? FIRST_COL_W : COL_W } : { flex: i === 0 ? 1.4 : 1 });
  const lastIdx = block.rows.length - 1;
  const body = (
    <View>
      <View style={[styles.tr, styles.thead]}>
        {block.head.map((h, i) => (
          <Text key={i} variant="caption" style={[styles.th, width(i), i === 0 && styles.thFirst]} numberOfLines={3}>{h}</Text>
        ))}
      </View>
      {block.rows.map((row, ri) => {
        const strong = block.highlightLast && ri === lastIdx;
        return (
          <View key={ri} style={[styles.tr, ri % 2 === 1 && styles.trAlt, strong && styles.trStrong]}>
            {row.map((cell, ci) => (
              <Text key={ci} variant="caption" style={[styles.td, width(ci), ci === 0 && styles.tdFirst, strong && styles.tdStrong]} numberOfLines={2}>{cell}</Text>
            ))}
          </View>
        );
      })}
    </View>
  );
  return (
    <View style={styles.table}>
      {scroll ? <ScrollView horizontal showsHorizontalScrollIndicator>{body}</ScrollView> : body}
    </View>
  );
}

/** The WhatsApp text of a result (pure, in ./share). */
export { resultsToText } from "./share";

const styles = StyleSheet.create({
  field: { marginBottom: spacing.lg },
  inputSection: { letterSpacing: 0.6, marginTop: spacing.sm, marginBottom: spacing.sm, fontWeight: fontWeight.semibold },
  inputWrap: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: palette.line, borderRadius: radius.md, backgroundColor: palette.surface, paddingHorizontal: spacing.lg },
  input: { flex: 1, fontSize: fontSize.lg, color: palette.ink, paddingVertical: spacing.md, fontWeight: fontWeight.semibold },
  unitLead: { fontSize: fontSize.lg, color: palette.muted, marginRight: 4, fontWeight: fontWeight.semibold },
  unitTrail: { fontSize: fontSize.md, color: palette.muted, marginLeft: 4 },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 32 },
  switch: { width: 44, height: 26, borderRadius: 13, backgroundColor: palette.line, padding: 3, justifyContent: "center" },
  switchOn: { backgroundColor: palette.brand },
  knob: { width: 20, height: 20, borderRadius: 10, backgroundColor: palette.white },
  knobOn: { alignSelf: "flex-end" },
  section: { letterSpacing: 0.6, marginTop: spacing.lg, marginBottom: spacing.sm },
  note: { marginTop: spacing.xs, marginBottom: spacing.sm, lineHeight: 17 },
  stat: { borderRadius: radius.md, padding: spacing.lg, marginBottom: spacing.sm },
  statValue: { fontSize: 24, fontWeight: fontWeight.bold, marginTop: 2, letterSpacing: -0.4 },
  insight: { flexDirection: "row", gap: spacing.sm, borderRadius: radius.md, borderLeftWidth: 3, padding: spacing.md, marginBottom: spacing.sm },
  table: { borderWidth: 1, borderColor: palette.line, borderRadius: radius.md, overflow: "hidden", marginBottom: spacing.sm, backgroundColor: palette.surface },
  tr: { flexDirection: "row", paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.sm },
  thead: { backgroundColor: palette.surfaceSunken },
  trAlt: { backgroundColor: palette.surfaceAlt },
  trStrong: { backgroundColor: palette.brandLight },
  th: { textAlign: "right", fontWeight: fontWeight.semibold, color: palette.muted },
  thFirst: { textAlign: "left" },
  td: { textAlign: "right", color: palette.ink },
  tdFirst: { textAlign: "left", color: palette.muted },
  tdStrong: { fontWeight: fontWeight.semibold, color: palette.ink },
});
