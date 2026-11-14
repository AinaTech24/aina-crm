/**
 * Where the fact-find and the client / lead record disagree — usually the
 * client correcting their own details on the link. The app's copy of the CRM's
 * components/discovery/RecordChanges.tsx: the RM ticks what is right and
 * applies it; the server copies the fact-find's STORED values, never what the
 * app sends. PAN changes go through the client's edit screen.
 */

import React, { useEffect, useState } from "react";
import { View, Pressable, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { Text } from "../../components/ui/Text";
import { Button } from "../../components/ui/Button";
import { toast } from "../../lib/toast";
import { palette, radius, spacing, fontWeight } from "../../theme/tokens";
import { useApplyRecordChanges } from "./api";
import type { RecordDiff } from "./record-diff";

export function RecordChanges({
  discoveryId,
  diffs,
  subjectType,
  subjectId,
  canEdit,
}: {
  discoveryId: string;
  diffs: RecordDiff[];
  subjectType: string;
  subjectId: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const apply = useApplyRecordChanges(discoveryId, { type: subjectType, id: subjectId });
  const applicable = diffs.filter((d) => d.applicable);
  const sig = applicable.map((d) => d.field).join(",");
  const [picked, setPicked] = useState<Set<string>>(() => new Set(applicable.map((d) => d.field)));
  // A fresh set of differences (after an apply) starts all ticked again.
  useEffect(() => { setPicked(new Set(sig ? sig.split(",") : [])); }, [sig]);
  if (!diffs.length) return null;

  const editHref = subjectType === "lead" ? `/m/leads/${subjectId}` : `/m/investors/new?editId=${subjectId}`;
  const toggle = (f: string) => setPicked((p) => { const n = new Set(p); if (n.has(f)) n.delete(f); else n.add(f); return n; });

  return (
    <View style={styles.box}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        <Feather name="refresh-cw" size={15} color={palette.warning} />
        <Text variant="subtitle">Different from the {subjectType === "lead" ? "lead" : "client"} record</Text>
      </View>
      {diffs.map((d) => {
        const on = picked.has(d.field);
        const tickable = canEdit && d.applicable;
        return (
          <Pressable
            key={d.field}
            disabled={!tickable}
            onPress={() => toggle(d.field)}
            accessibilityRole={tickable ? "checkbox" : undefined}
            accessibilityState={tickable ? { checked: on } : undefined}
            style={styles.row}
          >
            {canEdit ? (
              <View style={{ width: 24, paddingTop: 2 }}>
                {d.applicable ? <Feather name={on ? "check-square" : "square"} size={18} color={on ? palette.brandDark : palette.muted} /> : null}
              </View>
            ) : null}
            <View style={{ flex: 1 }}>
              <Text variant="label" style={{ color: palette.ink, fontWeight: fontWeight.semibold }}>{d.label}</Text>
              <Text variant="caption" tone="muted">On record: {d.record || "—"}</Text>
              <Text variant="caption" style={{ color: palette.ink }}>In the fact-find: {d.factFind}</Text>
              {!d.applicable ? (
                <Text variant="caption" tone="brand" style={{ marginTop: 2, fontWeight: fontWeight.semibold }} onPress={() => router.push(editHref as any)}>
                  Change on the record
                </Text>
              ) : null}
            </View>
          </Pressable>
        );
      })}
      {canEdit && applicable.length > 0 ? (
        <Button
          label="Update the record"
          variant="secondary"
          size="sm"
          loading={apply.isPending}
          disabled={picked.size === 0}
          onPress={() => apply.mutate([...picked], { onSuccess: (r) => toast.success(r.applied.length ? "Record updated" : "Nothing to update") })}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: 1, borderColor: "#fcd34d", backgroundColor: palette.warningBg, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md },
  row: { flexDirection: "row", gap: spacing.sm, paddingTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#fde68a" },
});
