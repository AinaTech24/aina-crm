/**
 * Pick the client to profile — the web's /dashboard/risk-profiles/new picker:
 * never-profiled first, then the longest since signing. A minor whose profile
 * is the guardian's is not offered (it is profiled on the guardian's record).
 */

import React, { useEffect, useMemo, useState } from "react";
import { View, Pressable, StyleSheet } from "react-native";
import { FlashList } from "@shopify/flash-list";
import { Text } from "../../components/ui/Text";
import { SearchBar } from "../../components/ui/SearchBar";
import { LoadingState, ErrorState, PermissionDeniedState } from "../../components/states";
import { fmtDate } from "../../lib/format";
import { palette, spacing, fontWeight } from "../../theme/tokens";
import { useRiskRegister, type RiskRow } from "./api";
import { categoryLabel } from "./rules";

export function ClientPicker({ onPick }: { onPick: (r: RiskRow) => void }) {
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => { const t = setTimeout(() => setQ(search), 250); return () => clearTimeout(t); }, [search]);
  // Searched and ordered on the server: never profiled first, then the longest since signing.
  const book = useRiskRegister("all", q);
  const rows = useMemo(() => (book.rows ?? []).filter((r) => !r.guardianId), [book.rows]);

  if (!book.canView && !book.loading) return <PermissionDeniedState />;
  if (book.loading) return <LoadingState label={book.progress && book.progress.total > book.progress.done ? `${book.progress.done.toLocaleString("en-IN")} of ${book.progress.total.toLocaleString("en-IN")}` : undefined} />;
  if (book.isError && !book.rows) return <ErrorState message={(book.error as any)?.message} onRetry={book.refetch} />;

  return (
    <FlashList
      data={rows}
      keyExtractor={(r) => r.id}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }}
      onEndReached={book.loadMore}
      onEndReachedThreshold={0.4}
      ListHeaderComponent={<View style={{ marginBottom: spacing.md }}><SearchBar value={search} onChangeText={setSearch} placeholder="Search clients by name or PAN…" /></View>}
      ListEmptyComponent={<Text variant="body" tone="muted" style={{ textAlign: "center", marginTop: spacing["2xl"] }}>{q ? `No active client matches “${q}”.` : "No active investors yet."}</Text>}
      renderItem={({ item }) => (
        <Pressable onPress={() => onPick(item)} style={({ pressed }) => [styles.row, pressed && { backgroundColor: palette.surfaceSunken }]} accessibilityRole="button">
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text variant="body" numberOfLines={1} style={{ color: palette.ink, fontWeight: fontWeight.semibold }}>{item.name}</Text>
            {item.pan ? <Text variant="caption" tone="muted">{item.pan}</Text> : null}
          </View>
          <View style={{ alignItems: "flex-end" }}>
            {item.category ? (
              <Text variant="caption" style={{ color: palette.ink70 }}>{categoryLabel(item.category)}{item.provisional ? " · suggested" : ""}</Text>
            ) : (
              <Text variant="caption" tone="warning" style={{ fontWeight: fontWeight.semibold }}>Not profiled</Text>
            )}
            <Text variant="caption" tone="faint">{item.signedAt ? `Last ${fmtDate(item.signedAt)}` : "Never"}</Text>
          </View>
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md, paddingHorizontal: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.lineSoft },
});
