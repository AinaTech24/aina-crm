/**
 * Compact inputs for the fact-find — the native versions of DiscoveryForm's
 * T / N / S boxes: a label, the box, and the field's check message under it.
 * Values are kept as the strings typed, exactly as the web form stores them.
 */

import React, { useState } from "react";
import { View, TextInput, Pressable, ScrollView, StyleSheet, type KeyboardTypeOptions, type DimensionValue } from "react-native";
import { Feather } from "@expo/vector-icons";
import { Text } from "../../components/ui/Text";
import { BottomSheet } from "../../components/ui/BottomSheet";
import { palette, radius, spacing, fontSize } from "../../theme/tokens";
import { useBrand } from "../../theme/brand";

/** ₹12.50 L / ₹1.20 Cr — under the box, so a missing zero is visible (web `inWords`). */
export function inWords(v: unknown): string | null {
  const x = Number(v);
  if (!Number.isFinite(x) || Math.abs(x) < 1e5) return null;
  return Math.abs(x) >= 1e7 ? `₹${(x / 1e7).toFixed(2)} Cr` : `₹${(x / 1e5).toFixed(2)} L`;
}

const str = (v: unknown) => (v == null ? "" : String(v));

export function Field({ label, error, hint, half, children }: { label: string; error?: string; hint?: string | null; half?: boolean; children: React.ReactNode }) {
  const width: DimensionValue = half ? "48%" : "100%";
  return (
    <View style={{ width, marginBottom: spacing.md }}>
      <Text variant="label" tone="muted" style={{ marginBottom: spacing.xs }} numberOfLines={2}>{label}</Text>
      {children}
      {hint ? <Text variant="caption" tone="faint" style={{ marginTop: 2 }}>{hint}</Text> : null}
      {error ? <Text variant="caption" tone="danger" style={{ marginTop: 2 }}>{error}</Text> : null}
    </View>
  );
}

export function TextBox({ label, value, onChange, error, half, keyboardType, autoCapitalize = "sentences", mono }: {
  label: string; value: unknown; onChange: (v: string) => void; error?: string; half?: boolean;
  keyboardType?: KeyboardTypeOptions; autoCapitalize?: "none" | "sentences" | "words" | "characters"; mono?: boolean;
}) {
  return (
    <Field label={label} error={error} half={half}>
      <TextInput
        style={[styles.box, mono && { fontVariant: ["tabular-nums"], letterSpacing: 1 }, error ? { borderColor: palette.danger } : null]}
        value={str(value)}
        onChangeText={onChange}
        accessibilityLabel={label}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        placeholderTextColor={palette.faint}
      />
    </Field>
  );
}

/** A number box. `money` adds the lakh / crore reading under it. */
export function NumBox({ label, value, onChange, error, half, money, integer }: {
  label: string; value: unknown; onChange: (v: string) => void; error?: string; half?: boolean; money?: boolean; integer?: boolean;
}) {
  return (
    <Field label={label} error={error} half={half} hint={money ? inWords(value) : null}>
      <TextInput
        style={[styles.box, { fontVariant: ["tabular-nums"] }, error ? { borderColor: palette.danger } : null]}
        value={str(value)}
        onChangeText={onChange}
        accessibilityLabel={label}
        keyboardType={integer ? "number-pad" : "decimal-pad"}
        placeholderTextColor={palette.faint}
      />
    </Field>
  );
}

/** A dropdown over a fixed list, with a way back to blank (the web's "Select…"). */
export function SelectBox({ label, value, onChange, options, half, error }: {
  label: string; value: unknown; onChange: (v: string) => void; options: readonly string[]; half?: boolean; error?: string;
}) {
  const [open, setOpen] = useState(false);
  const { brand, brandDark } = useBrand();
  const v = str(value);
  return (
    <Field label={label} error={error} half={half}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${v || "not selected"}`} style={[styles.box, styles.select]} onPress={() => setOpen(true)}>
        <Text style={{ flex: 1, fontSize: fontSize.base, color: v ? palette.ink : palette.faint }} numberOfLines={1}>{v || "Select…"}</Text>
        <Feather name="chevron-down" size={16} color={palette.faint} />
      </Pressable>
      <BottomSheet visible={open} onClose={() => setOpen(false)} title={label}>
        <ScrollView style={{ maxHeight: 420 }} keyboardShouldPersistTaps="handled">
          {v ? (
            <Pressable style={styles.option} accessibilityRole="button" onPress={() => { onChange(""); setOpen(false); }}>
              <Text variant="body" tone="muted">Clear</Text>
            </Pressable>
          ) : null}
          {options.map((o) => (
            <Pressable key={o} style={styles.option} accessibilityRole="button" accessibilityState={{ selected: o === v }} onPress={() => { onChange(o); setOpen(false); }}>
              <Text variant="body" style={{ flex: 1, color: o === v ? brandDark : palette.ink }}>{o}</Text>
              {o === v ? <Feather name="check" size={18} color={brand} /> : null}
            </Pressable>
          ))}
        </ScrollView>
      </BottomSheet>
    </Field>
  );
}

const styles = StyleSheet.create({
  box: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: fontSize.base,
    color: palette.ink,
    backgroundColor: palette.surface,
  },
  select: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  option: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.lineSoft,
  },
});
