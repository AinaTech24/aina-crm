/**
 * Leads / Pipeline. Two views (List / Board). List: search + stage filter chips +
 * infinite cards. Board: horizontal swimlanes by stage with compact cards. Both
 * from GET /api/leads. Tap → lead detail.
 */

import React, { useState, useMemo } from "react";
import { View, ScrollView, StyleSheet } from "react-native";
import { FlashList } from "@shopify/flash-list";
import { useRouter } from "expo-router";
import { ScreenHeader } from "../../../../src/components/ui/ScreenHeader";
import { SearchBar } from "../../../../src/components/ui/SearchBar";
import { Chip } from "../../../../src/components/ui/Chip";
import { Segmented } from "../../../../src/components/ui/Segmented";
import { FAB } from "../../../../src/components/ui/FAB";
import { SkeletonList } from "../../../../src/components/ui/Skeleton";
import { Text } from "../../../../src/components/ui/Text";
import { EmptyState, SearchEmptyState, ErrorState } from "../../../../src/components/states";
import { LeadCard } from "../../../../src/components/domain/LeadCard";
import { useLeads, filterLeads, groupByStage, LEAD_STAGES } from "../../../../src/features/leads/api";
import { palette, spacing } from "../../../../src/theme/tokens";

export default function LeadsList() {
  const router = useRouter();
  const [view, setView] = useState<"list" | "board">("list");
  const [search, setSearch] = useState("");
  const [stage, setStage] = useState("");
  const { data, isLoading, isError, error, refetch, isRefetching } = useLeads({ q: search, stage });

  const all = data?.leads ?? [];
  const listLeads = useMemo(() => filterLeads(all, search, stage), [all, search, stage]);
  const columns = useMemo(() => groupByStage(all), [all]);

  const open = (id: string) => router.push(`/m/leads/${id}`);

  return (
    <View style={{ flex: 1, backgroundColor: palette.surfaceAlt }}>
      <ScreenHeader title="Leads" subtitle={isLoading ? undefined : `${all.length} in pipeline`} />
      <View style={styles.controls}>
        <Segmented options={[{ key: "list", label: "List" }, { key: "board", label: "Board" }]} value={view} onChange={setView} />
      </View>

      {isLoading ? (
        <SkeletonList count={8} />
      ) : isError ? (
        <ErrorState message={(error as any)?.message} onRetry={() => refetch()} />
      ) : view === "list" ? (
        <FlashList
          data={listLeads}
          keyExtractor={(l) => l.id}
          renderItem={({ item }) => <LeadCard lead={item} onPress={() => open(item.id)} />}
          ListHeaderComponent={
            <View style={{ gap: spacing.md, paddingBottom: spacing.sm }}>
              <SearchBar value={search} onChangeText={setSearch} placeholder="Search leads…" />
              <View style={styles.chips}>
                <Chip label="All stages" selected={stage === ""} onPress={() => setStage("")} />
                {LEAD_STAGES.map((s) => (
                  <Chip key={s.key} label={s.label} selected={stage === s.key} onPress={() => setStage(stage === s.key ? "" : s.key)} />
                ))}
              </View>
            </View>
          }
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: 96 }}
          refreshing={isRefetching}
          onRefresh={() => refetch()}
          ListEmptyComponent={search ? <SearchEmptyState query={search} /> : <EmptyState icon="trending-up" title="No leads" message="New leads will appear here." />}
        />
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.board}>
          {columns.map((col) => (
            <View key={col.key} style={styles.column}>
              <View style={styles.colHeader}>
                <Text variant="label" numberOfLines={1} style={{ flex: 1 }}>
                  {col.label}
                </Text>
                <View style={styles.countBadge}>
                  <Text variant="caption" tone="muted">
                    {col.leads.length}
                  </Text>
                </View>
              </View>
              <ScrollView showsVerticalScrollIndicator={false}>
                {col.leads.map((l) => (
                  <LeadCard key={l.id} lead={l} compact onPress={() => open(l.id)} />
                ))}
              </ScrollView>
            </View>
          ))}
        </ScrollView>
      )}

      <FAB onPress={() => router.push("/m/leads/new" as any)} />
    </View>
  );
}

const styles = StyleSheet.create({
  controls: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  board: { paddingHorizontal: spacing.lg, paddingBottom: 96, gap: spacing.md },
  column: { width: 220, backgroundColor: palette.surfaceSunken, borderRadius: 14, padding: spacing.sm, marginRight: spacing.md },
  colHeader: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.xs, paddingVertical: spacing.sm },
  countBadge: { backgroundColor: palette.surface, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
});
