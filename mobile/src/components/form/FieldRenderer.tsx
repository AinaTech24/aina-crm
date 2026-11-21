/**
 * FieldRenderer — turns one FieldSpec into the right native control. Central
 * dispatch used by FormScreen (and, recursively, by repeater sub-fields).
 */

import React from "react";
import { View, Switch, Pressable, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { palette, radius, spacing } from "../../theme/tokens";
import { Text } from "../ui/Text";
import { TextField } from "../ui/TextField";
import { SelectField } from "../ui/SelectField";
import { Chip } from "../ui/Chip";
import { Button } from "../ui/Button";
import { DateField } from "./DateField";
import { LookupField } from "./LookupField";
import { TypeaheadField } from "./TypeaheadField";
import { AudienceField } from "./AudienceField";
import type { FieldSpec, Option } from "../../features/forms/types";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";

/** Today as YYYY-MM-DD — computed per render: a module-level constant went stale
 *  overnight, and a "no later than today" date then refused today itself. */
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function normOptions(opts: FieldSpec["options"], form?: Record<string, any>): Option[] {
  const list = typeof opts === "function" ? opts(form ?? {}) : opts;
  return (list ?? []).map((o) => (typeof o === "string" ? { value: o, label: o || "Select" } : o));
}

export function FieldRenderer({
  field,
  value,
  error,
  onChange,
  form,
}: {
  field: FieldSpec;
  value: any;
  error?: string;
  onChange: (v: any) => void;
  form?: Record<string, any>;
}) {
  const type = field.type ?? "text";

  const apply = (v: string) => onChange(field.transform ? field.transform(v) : v);

  switch (type) {
    case "select":
      return (
        <SelectField
          label={field.label}
          value={value ?? ""}
          options={normOptions(field.options, form)}
          onChange={apply}
          placeholder={field.placeholder}
          required={field.required}
          error={error}
          searchable={field.searchable}
        />
      );

    case "date":
      return (
        <DateField
          label={field.label}
          value={value ?? ""}
          onChange={onChange}
          required={field.required}
          error={error}
          max={field.max ?? (field.maxToday ? today() : undefined)}
          min={field.min}
          placeholder={field.placeholder}
          help={field.help}
        />
      );

    case "lookup":
      return <LookupField field={field} value={value ?? ""} onChange={onChange} form={form} error={error} />;

    case "typeahead":
      return <TypeaheadField field={field} value={value ?? ""} onChange={onChange} error={error} displayLabel={field.searchDisplayKey ? (form?.[field.searchDisplayKey] || undefined) : undefined} />;

    case "audience":
      return <AudienceField field={field} value={value ?? ""} onChange={onChange} />;

    case "switch":
      return (
        <View style={styles.switchRow}>
          <View style={{ flex: 1 }}>
            <Text variant="body">{field.label}</Text>
            {field.help ? (
              <Text variant="caption" tone="muted">
                {field.help}
              </Text>
            ) : null}
          </View>
          <Switch
            accessibilityLabel={field.label}
            value={!!value}
            onValueChange={onChange}
            trackColor={{ true: palette.brand, false: palette.line }}
            thumbColor={palette.white}
          />
        </View>
      );

    case "readonly": {
      const text = field.format ? field.format(value, form ?? {}) : String(value ?? "—");
      return (
        <View style={{ marginBottom: spacing.lg }}>
          <Text variant="label" tone="muted" style={{ marginBottom: spacing.xs }}>
            {field.label}
          </Text>
          <View style={styles.readonly}>
            <Text variant="body">{text}</Text>
          </View>
          {field.help ? (
            <Text variant="caption" tone="muted" style={{ marginTop: 4 }}>
              {field.help}
            </Text>
          ) : null}
        </View>
      );
    }

    case "multiselect": {
      // Options from an endpoint (e.g. the team) — lookupEndpoint / lookupEnvelope / lookupLabel / lookupValue.
      if (field.lookupEndpoint) return <MultiLookupField field={field} value={Array.isArray(value) ? value : []} onChange={onChange} form={form} />;
      const selected: string[] = Array.isArray(value) ? value : [];
      const opts = normOptions(field.options, form).filter((o) => o.value !== "");
      const toggle = (v: string) =>
        onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
      return (
        <View style={{ marginBottom: spacing.lg }}>
          <Text variant="label" tone="muted" style={{ marginBottom: spacing.xs }}>
            {field.label}
            {field.required ? <Text style={{ color: palette.danger }}> *</Text> : null}
          </Text>
          <View style={styles.chips}>
            {opts.map((o) => (
              <Chip key={o.value} label={o.label} selected={selected.includes(o.value)} onPress={() => toggle(o.value)} />
            ))}
          </View>
          {field.help ? (
            <Text variant="caption" tone="muted" style={{ marginTop: 4 }}>
              {field.help}
            </Text>
          ) : null}
          {error ? (
            <Text variant="caption" tone="danger" style={{ marginTop: 4, color: palette.danger }}>
              {error}
            </Text>
          ) : null}
        </View>
      );
    }

    case "repeater":
      return <RepeaterField field={field} value={Array.isArray(value) ? value : []} onChange={onChange} />;

    case "textarea":
      return (
        <TextField
          label={field.label}
          value={value ?? ""}
          onChangeText={apply}
          placeholder={field.placeholder}
          required={field.required}
          error={error}
          multiline
        />
      );

    default:
      // text / email / tel / number
      return (
        <TextField
          label={field.label}
          value={value ?? ""}
          onChangeText={apply}
          placeholder={field.placeholder}
          required={field.required}
          error={error}
          keyboardType={
            field.keyboard ??
            (type === "email"
              ? "email-address"
              : type === "tel"
              ? "phone-pad"
              : type === "number"
              ? "decimal-pad"
              : "default")
          }
          autoCapitalize={field.autoCapitalize ?? (type === "email" ? "none" : "sentences")}
        />
      );
  }
}

/** RepeaterField — add/remove rows of a fixed sub-form (nominees, referrals). */
function RepeaterField({
  field,
  value,
  onChange,
}: {
  field: FieldSpec;
  value: any[];
  onChange: (v: any[]) => void;
}) {
  const sub = field.itemFields ?? [];

  const addRow = () => {
    const blank: Record<string, any> = {};
    for (const f of sub) blank[f.key] = f.type === "switch" ? false : "";
    onChange([...value, blank]);
  };
  const removeRow = (i: number) => onChange(value.filter((_, idx) => idx !== i));
  const setCell = (i: number, key: string, v: any) =>
    onChange(value.map((row, idx) => (idx === i ? { ...row, [key]: v } : row)));

  return (
    <View>
      {value.map((row, i) => (
        <View key={i} style={styles.repItem}>
          <View style={styles.repHeader}>
            <Text variant="label" tone="muted">
              {field.itemTitle ? field.itemTitle(row, i) : `#${i + 1}`}
            </Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Remove row" onPress={() => removeRow(i)} style={styles.removeBtn}>
              <Feather name="trash-2" size={16} color={palette.danger} />
            </Pressable>
          </View>
          {sub
            .filter((f) => !f.visibleIf || f.visibleIf(row))
            .map((f) => (
              <FieldRenderer
                key={f.key}
                field={f}
                value={row[f.key]}
                onChange={(v) => setCell(i, f.key, v)}
                form={row}
              />
            ))}
        </View>
      ))}
      <Button
        label={field.addLabel ?? "Add"}
        variant="secondary"
        onPress={addRow}
        icon={<Feather name="plus" size={16} color={palette.ink} />}
      />
    </View>
  );
}

/** A multi-select whose options come from an endpoint (cached), as chips. */
function MultiLookupField({ field, value, onChange, form }: { field: FieldSpec; value: string[]; onChange: (v: string[]) => void; form?: Record<string, any> }) {
  const { data, isLoading } = useQuery({
    queryKey: ["multi-lookup", field.lookupEndpoint],
    queryFn: () => api.get<any>(field.lookupEndpoint!),
    staleTime: 5 * 60_000,
  });
  const raw = data?.[field.lookupEnvelope ?? "rows"];
  const rows: any[] = Array.isArray(raw) ? raw : Array.isArray(data) ? data : [];
  const opts = rows
    .filter((r) => !field.lookupFilter || field.lookupFilter(r, form ?? {}))
    .map((r) => ({ value: field.lookupValue ? field.lookupValue(r) : String(r.id), label: field.lookupLabel ? field.lookupLabel(r) : r.name ?? String(r.id) }));
  const toggle = (v: string) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  return (
    <View style={{ marginBottom: spacing.lg }}>
      <Text variant="label" tone="muted" style={{ marginBottom: spacing.xs }}>{field.label}</Text>
      {isLoading ? <Text variant="caption" tone="muted">Loading…</Text> : (
        <View style={styles.chips}>
          {opts.map((o) => <Chip key={o.value} label={o.label} selected={value.includes(o.value)} onPress={() => toggle(o.value)} />)}
        </View>
      )}
      {field.help ? <Text variant="caption" tone="muted" style={{ marginTop: 4 }}>{field.help}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  readonly: {
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: palette.surfaceAlt,
  },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  repItem: {
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    backgroundColor: palette.surfaceAlt,
  },
  removeBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center", marginRight: -spacing.sm },
  repHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
});
