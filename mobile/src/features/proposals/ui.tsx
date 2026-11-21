/**
 * Small pieces the proposal screens share: a card header, a notice banner, a
 * fact tile, a number field that keeps what is typed, and the scheme picker
 * (the firm's Scheme Master, Regular plans only — pick, never type).
 */

import React from "react";
import { View, Pressable, ScrollView, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { Text } from "../../components/ui/Text";
import { TextField } from "../../components/ui/TextField";
import { SelectField } from "../../components/ui/SelectField";
import { SearchBar } from "../../components/ui/SearchBar";
import { BottomSheet } from "../../components/ui/BottomSheet";
import { useAmcs, useSchemeSearch, type SchemeHit } from "./api";
import { spacing, palette, radius, fontWeight } from "../../theme/tokens";
import { toneColors, type Tone } from "../../theme";

export function CardHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: React.ReactNode }) {
  return (
    <View style={styles.header}>
      <View style={{ flex: 1 }}>
        <Text variant="subtitle">{title}</Text>
        {subtitle ? <Text variant="caption" tone="muted" style={{ marginTop: 2 }}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}

export function Banner({ tone = "neutral", children, onPress }: { tone?: Tone; children: React.ReactNode; onPress?: () => void }) {
  const c = toneColors(tone);
  const style = [styles.banner, { backgroundColor: c.bg, borderColor: tone === "neutral" ? palette.line : c.fg + "55" }];
  return onPress ? <Pressable onPress={onPress} style={style}>{children}</Pressable> : <View style={style}>{children}</View>;
}

/** `warn`: the client's book is ALREADY outside their band (web Tile). */
export function Tile({ label, value, hint, warn }: { label: string; value: string; hint?: string; warn?: boolean }) {
  return (
    <View style={[styles.tile, warn && { backgroundColor: palette.warningBg }]}>
      <Text variant="caption" tone="muted">{label}</Text>
      <Text style={{ fontWeight: fontWeight.semibold, color: warn ? palette.warning : palette.ink }}>{value}</Text>
      {hint ? <Text variant="caption" style={{ color: warn ? palette.warning : palette.muted }}>{warn ? `above the ${hint.replace(/^band /, "")} band` : hint}</Text> : null}
    </View>
  );
}

/** Two fields side by side. */
export function Pair({ children }: { children: React.ReactNode }) {
  return <View style={{ flexDirection: "row", gap: spacing.md }}>{React.Children.map(children, (c) => <View style={{ flex: 1 }}>{c}</View>)}</View>;
}

/**
 * A number field. It keeps the text as typed ("12." stays "12."), passes the
 * number up, and follows the value when it changes from outside (a projection).
 * `max` / `int` hold it within what the API accepts (it answers 400 beyond).
 */
export function NumField({ label, unit, value, onChange, max, int, disabled }: {
  label: string; unit?: string; value?: number; onChange: (n: number | undefined) => void; max?: number; int?: boolean; disabled?: boolean;
}) {
  const parse = (t: string): number | undefined => {
    if (!t.trim()) return undefined;
    const n = Number(t.replace(/,/g, ""));
    if (!Number.isFinite(n) || n < 0) return undefined;
    const r = int ? Math.round(n) : n;
    return max != null ? Math.min(r, max) : r;
  };
  const [text, setText] = React.useState(value == null ? "" : String(value));
  React.useEffect(() => {
    if (parse(text) !== value) setText(value == null ? "" : String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <TextField
      label={unit ? `${label} (${unit})` : label}
      value={text}
      keyboardType={int ? "number-pad" : "decimal-pad"}
      disabled={disabled}
      onChangeText={(t) => {
        const n = parse(t);
        const raw = Number(t.replace(/,/g, ""));
        setText(n != null && max != null && raw > max ? String(n) : t);
        onChange(n);
      }}
    />
  );
}

/** A scheme field: shows the pick, opens the Scheme Master picker. */
export function SchemeButton({ label, required, value, sub, onPress, disabled, placeholder }: {
  label: string; required?: boolean; value?: string | null; sub?: string; onPress: () => void; disabled?: boolean; placeholder: string;
}) {
  return (
    <View style={{ marginBottom: spacing.lg }}>
      <Text variant="label" tone="muted" style={{ marginBottom: spacing.xs }}>
        {label}{required ? <Text style={{ color: palette.danger }}> *</Text> : null}
      </Text>
      <Pressable style={[styles.scheme, disabled && { opacity: 0.6 }]} onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={label}>
        <Feather name="search" size={15} color={palette.muted} />
        <View style={{ flex: 1 }}>
          <Text variant="body" numberOfLines={2} style={{ color: value ? palette.ink : palette.faint }}>{value || placeholder}</Text>
          {value && sub ? <Text variant="caption" tone="muted" numberOfLines={1}>{sub}</Text> : null}
        </View>
      </Pressable>
    </View>
  );
}

/** The firm's Scheme Master, Regular plans only — pick, never type. */
export function SchemePicker({ amc: initialAmc, onClose, onPick }: { amc?: string | null; onClose: () => void; onPick: (s: SchemeHit) => void }) {
  const [q, setQ] = React.useState("");
  const [amc, setAmc] = React.useState<string | null>(initialAmc ?? null);
  const amcs = useAmcs();
  const res = useSchemeSearch(q, amc);
  const searching = q.trim().length >= 2 || !!amc;
  // Regular plans only — the route filters with plan=regular; a row the master
  // marks Direct is still never offered. And a cleared search shows nothing,
  // not the last search's rows (placeholderData keeps them).
  const rows = searching ? (res.data?.schemes ?? []).filter((s) => s.plan !== "direct") : [];
  const empty = res.data?.masterEmpty || amcs.data?.masterEmpty;
  return (
    <BottomSheet visible onClose={onClose} title="Pick a scheme">
      {empty ? <Text variant="caption" style={{ color: palette.warning, marginBottom: spacing.sm }}>The firm's Scheme Master is empty — sync it in the CRM first.</Text> : null}
      <SelectField label="AMC" value={amc ?? ""} placeholder="Any AMC" options={[{ value: "", label: "Any AMC" }, ...(amcs.data?.amcs ?? []).map((a) => ({ value: a.code, label: a.name }))]} onChange={(v) => setAmc(v || null)} />
      <SearchBar value={q} onChangeText={setQ} placeholder="Search your Scheme Master…" />
      <ScrollView style={{ maxHeight: 340, marginTop: spacing.sm }} keyboardShouldPersistTaps="handled">
        {rows.map((s) => (
          <Pressable key={s.schemeCode} style={styles.pickRow} onPress={() => onPick(s)}>
            <View style={{ flex: 1 }}>
              <Text variant="body" numberOfLines={2}>{s.schemeName}</Text>
              <Text variant="caption" tone="muted" numberOfLines={1}>{[s.amc, s.category, s.risk?.label].filter(Boolean).join(" · ")}</Text>
            </View>
            <Feather name="plus-circle" size={16} color={palette.brand} />
          </Pressable>
        ))}
        {(q.trim().length >= 2 || amc) && !res.isFetching && rows.length === 0 && !empty ? <Text variant="body" tone="muted" style={{ textAlign: "center", padding: spacing.lg }}>No Regular-plan scheme matches.</Text> : null}
      </ScrollView>
    </BottomSheet>
  );
}

export const proposalStyles = StyleSheet.create({
  card: { marginBottom: spacing.md },
  pickRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.lineSoft },
  avatar: { width: 32, height: 32, borderRadius: radius.pill, backgroundColor: palette.brand, alignItems: "center", justifyContent: "center" },
  tiles: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
});

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, marginBottom: spacing.md },
  banner: { borderWidth: 1, borderRadius: radius.md, padding: spacing.md, gap: 4, marginBottom: spacing.md },
  tile: { flexGrow: 1, flexBasis: "45%", borderRadius: radius.md, backgroundColor: palette.surfaceSunken, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: 2 },
  scheme: { flexDirection: "row", alignItems: "center", gap: spacing.sm, borderWidth: 1, borderColor: palette.line, borderRadius: radius.md, padding: spacing.md, backgroundColor: palette.surface },
  pickRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.lineSoft },
});
