/**
 * Fixed deposits — every FD the viewer can see (access follows the client):
 * the live book, what matures in the next 30 days, and the ones past maturity
 * whose status still needs updating. Tap one for its details; + records one.
 */

import React, { useEffect, useState } from "react";
import { View, Pressable, ScrollView, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { FlashList } from "@shopify/flash-list";
import { Text } from "../../../../src/components/ui/Text";
import { Skeleton } from "../../../../src/components/ui/Skeleton";
import { ScreenHeader } from "../../../../src/components/ui/ScreenHeader";
import { SearchBar } from "../../../../src/components/ui/SearchBar";
import { FAB } from "../../../../src/components/ui/FAB";
import { ErrorState } from "../../../../src/components/states";
import { useFds, type FdFilters } from "../../../../src/features/fixed-deposits/api";
import { FdRowCard } from "../../../../src/features/fixed-deposits/FdRowCard";
import { inr } from "../../../../src/lib/format";
import { spacing, palette, radius, fontWeight } from "../../../../src/theme/tokens";

const FILTERS: Array<{ key: string; label: string; f: FdFilters }> = [
  { key: "live", label: "Live", f: { status: "live" } },
  { key: "m30", label: "Maturing in 30 days", f: { status: "live", within: 30 } },
  { key: "all", label: "All", f: { status: "all" } },
];

export default function FixedDepositsList() {
  const router = useRouter();
  const [filter, setFilter] = useState("live");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => { const t = setTimeout(() => setQ(search), 300); return () => clearTimeout(t); }, [search]);
  const active = FILTERS.find((x) => x.key === filter)!;
  const { data, isLoading, isError, refetch, isRefetching } = useFds({ ...active.f, q });
  const rows = data?.rows ?? [];
  const t = data?.totals;

  const header = (
    <View>
      {t ? (
        <View style={styles.ribbon}>
          <Metric label="Live" value={String(t.liveCount)} sub={t.livePrincipal ? inr(t.livePrincipal) : undefined} />
          <Metric label="Matures in 30d" value={String(t.maturing30)} sub={t.maturing30Amount ? inr(t.maturing30Amount) : undefined} />
          <Metric label="Past maturity" value={String(t.overdue)} alarm={t.overdue > 0} />
        </View>
      ) : null}
      <SearchBar value={search} onChangeText={setSearch} placeholder="Search client, bank or FD number…" />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {FILTERS.map((x) => (
          <Pressable key={x.key} onPress={() => setFilter(x.key)} style={[styles.chip, filter === x.key && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: filter === x.key }}>
            <Text variant="caption" style={{ color: filter === x.key ? palette.white : palette.muted, fontWeight: fontWeight.semibold }}>{x.label}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: palette.surfaceAlt }}>
      <ScreenHeader title="Fixed Deposits" />
      {isError && !data ? <ErrorState onRetry={refetch} /> : isLoading && !data ? (
        <View style={{ padding: spacing.lg }}><Skeleton width="100%" height={72} /><Skeleton width="100%" height={72} style={{ marginTop: spacing.sm }} /></View>
      ) : (
        <FlashList
          data={rows}
          keyExtractor={(r) => r.id}
          ListHeaderComponent={header}
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }}
          onRefresh={refetch}
          refreshing={isRefetching}
          ListEmptyComponent={<Text variant="body" tone="muted" style={{ textAlign: "center", marginTop: spacing["2xl"] }}>No fixed deposits here.</Text>}
          renderItem={({ item }) => <FdRowCard r={item} onPress={() => router.push(`/m/fixed-deposits/${item.id}?name=${encodeURIComponent(item.investorName)}` as any)} showClient />}
        />
      )}
      <FAB icon="plus" label="Record FD" onPress={() => router.push("/m/fixed-deposits/new" as any)} />
    </View>
  );
}

function Metric({ label, value, sub, alarm }: { label: string; value: string; sub?: string; alarm?: boolean }) {
  return (
    <View style={{ flex: 1, alignItems: "center" }}>
      <Text style={{ fontSize: 17, fontWeight: fontWeight.bold, color: alarm ? palette.danger : value === "0" ? palette.faint : palette.ink }}>{value}</Text>
      <Text variant="caption" tone="muted" numberOfLines={1}>{label}</Text>
      {sub ? <Text variant="caption" tone="faint" numberOfLines={1}>{sub}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  ribbon: { flexDirection: "row", alignItems: "flex-start", backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line, borderRadius: radius.md, paddingVertical: spacing.md, marginBottom: spacing.md },
  chips: { gap: spacing.sm, paddingVertical: spacing.md },
  chip: { paddingHorizontal: spacing.lg, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line },
  chipOn: { backgroundColor: palette.brand, borderColor: palette.brand },
});
