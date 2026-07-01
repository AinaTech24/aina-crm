/**
 * Families list. Search + quick-filter chips (review due / at risk / no RM / no
 * primary) applied client-side over GET /api/families, with the standard states.
 */

import React, { useState, useMemo } from "react";
import { View, StyleSheet } from "react-native";
import { FlashList } from "@shopify/flash-list";
import { useRouter } from "expo-router";
import { ScreenHeader } from "../../../../src/components/ui/ScreenHeader";
import { SearchBar } from "../../../../src/components/ui/SearchBar";
import { Chip } from "../../../../src/components/ui/Chip";
import { SkeletonList } from "../../../../src/components/ui/Skeleton";
import { EmptyState, SearchEmptyState, ErrorState } from "../../../../src/components/states";
import { FamilyCard } from "../../../../src/components/domain/FamilyCard";
import { useFamilies, filterFamilies, type FamilyQuickFilter } from "../../../../src/features/families/api";
import { palette, spacing } from "../../../../src/theme/tokens";

const FILTERS: { key: FamilyQuickFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "review_due", label: "Review Due" },
  { key: "at_risk", label: "At Risk" },
  { key: "no_rm", label: "No RM" },
  { key: "no_primary", label: "No Primary" },
];

export default function FamiliesList() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FamilyQuickFilter>("all");
  const { data, isLoading, isError, error, refetch, isRefetching } = useFamilies();

  const families = useMemo(() => filterFamilies(data?.families ?? [], search, filter), [data, search, filter]);

  const header = (
    <View style={styles.controls}>
      <SearchBar value={search} onChangeText={setSearch} placeholder="Search family, code…" />
      <View style={styles.chips}>
        {FILTERS.map((f) => (
          <Chip key={f.key} label={f.label} selected={filter === f.key} onPress={() => setFilter(f.key)} />
        ))}
      </View>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: palette.surfaceAlt }}>
      <ScreenHeader title="Families" subtitle={isLoading ? undefined : `${families.length} famil${families.length === 1 ? "y" : "ies"}`} />
      {isLoading ? (
        <>
          {header}
          <SkeletonList count={7} />
        </>
      ) : isError ? (
        <ErrorState message={(error as any)?.message} onRetry={() => refetch()} />
      ) : (
        <FlashList
          data={families}
          keyExtractor={(f) => f.id}
          renderItem={({ item }) => <FamilyCard family={item} onPress={() => router.push(`/m/families/${item.id}`)} />}
          ListHeaderComponent={header}
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: 40 }}
          refreshing={isRefetching}
          onRefresh={() => refetch()}
          ListEmptyComponent={
            search ? <SearchEmptyState query={search} /> : <EmptyState icon="home" title="No families" message="Group clients into households to track family wealth and reviews." />
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  controls: { paddingTop: spacing.md, paddingBottom: spacing.sm, gap: spacing.md },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
});
