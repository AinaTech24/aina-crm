/**
 * TextField — labeled text input for forms. Supports multiline, an error line,
 * and a required marker. Native keyboard types via `keyboardType`.
 */

import React from "react";
import { View, TextInput, StyleSheet, type KeyboardTypeOptions } from "react-native";
import { palette, radius, spacing, fontSize, fontScale } from "../../theme/tokens";
import { Text } from "./Text";

export function TextField({
  label,
  value,
  onChangeText,
  placeholder,
  multiline,
  required,
  error,
  keyboardType,
  autoCapitalize = "sentences",
  secureTextEntry,
  disabled,
  maxLength,
  inputRef,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  required?: boolean;
  error?: string;
  keyboardType?: KeyboardTypeOptions;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  secureTextEntry?: boolean;
  disabled?: boolean;
  /** Hard cap on typed characters (match the server's zod .max()). */
  maxLength?: number;
  /** The underlying TextInput — the form engine focuses the first field with an error. */
  inputRef?: React.Ref<TextInput> | ((r: TextInput | null) => void);
}) {
  return (
    <View style={{ marginBottom: spacing.lg }}>
      <Text variant="label" tone="muted" style={{ marginBottom: spacing.xs }}>
        {label}
        {required ? <Text style={{ color: palette.danger }}> *</Text> : null}
      </Text>
      <TextInput
        ref={inputRef as any}
        style={[styles.input, multiline && styles.multiline, error && { borderColor: palette.danger }, disabled && { opacity: 0.6 }]}
        editable={!disabled}
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={palette.faint}
        maxFontSizeMultiplier={fontScale.text}
        multiline={multiline}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        secureTextEntry={secureTextEntry}
        maxLength={maxLength}
      />
      {error ? (
        <Text variant="caption" tone="danger" style={{ marginTop: 4 }}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  input: {
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontSize: fontSize.md,
    color: palette.ink,
    backgroundColor: palette.surface,
  },
  multiline: { minHeight: 96, textAlignVertical: "top", paddingTop: spacing.md },
});
