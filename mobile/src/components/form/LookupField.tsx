/**
 * LookupField — a SelectField whose options are fetched from an endpoint
 * (e.g. /api/employees?role=rm → { rows }). The native equivalent of the web
 * RmSelector and other "assign to / pick a record" dropdowns.
 */

import React from "react";
import { View, Pressable } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { palette, spacing } from "../../theme/tokens";
import { Text } from "../ui/Text";
import { SelectField } from "../ui/SelectField";
import type { FieldSpec, Option } from "../../features/forms/types";

export function LookupField({
  field,
  value,
  onChange,
  form,
  error,
}: {
  field: FieldSpec;
  value: string | null;
  onChange: (v: string) => void;
  form?: Record<string, any>;
  error?: string;
}) {
  const endpoint = field.lookupEndpoint!;
  const envelope = field.lookupEnvelope ?? "rows";
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["lookup", endpoint],
    queryFn: () => api.get<any>(endpoint),
    staleTime: 60_000,
  });

  // An envelope the server doesn't send (or an object where a list was
  // expected) used to reach .filter/.map and crash the whole form.
  const raw = data?.[envelope] ?? data;
  let rows: any[] = Array.isArray(raw) ? raw : [];
  if (field.lookupFilter) rows = rows.filter((r) => field.lookupFilter!(r, form ?? {}));
  const options: Option[] = rows.map((r) => ({
    value: field.lookupValue ? field.lookupValue(r) : String(r.id),
    label: field.lookupLabel ? field.lookupLabel(r) : r.name ?? r.title ?? String(r.id),
  }));
  const withClear: Option[] = [
    { value: "", label: field.placeholder ?? "— None —" },
    ...options,
  ];

  if (isLoading) {
    return (
      <View style={{ marginBottom: spacing.lg }}>
        <Text variant="label" tone="muted" style={{ marginBottom: spacing.xs }}>
          {field.label}
        </Text>
        <Text tone="muted" variant="body">
          Loading…
        </Text>
      </View>
    );
  }
  if (isError) {
    return (
      <View style={{ marginBottom: spacing.lg }}>
        <Text variant="label" tone="muted" style={{ marginBottom: spacing.xs }}>
          {field.label}
        </Text>
        <Pressable accessibilityRole="button" onPress={() => refetch()} style={{ minHeight: 44, justifyContent: "center" }}>
          <Text tone="danger" variant="caption" style={{ color: palette.danger }}>
            Couldn't load options · Tap to retry
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <SelectField
      label={field.label}
      value={value ?? ""}
      options={withClear}
      onChange={onChange}
      placeholder={field.placeholder}
      required={field.required}
      error={error}
    />
  );
}
