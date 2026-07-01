/**
 * Clients (Investors) list. Debounced search + segment filter chips + a
 * virtualized infinite list of InvestorCards, with pull-to-refresh, skeleton /
 * empty / error states, and a create FAB. All data from GET /api/investors.
 */

import React, { useState, useEffect, useCallback } from "react";
import { View, StyleSheet } from "react-native";
import { FlashList } from "@shopify/flash-list";
import { useRouter } from "expo-router";
import { ScreenHeader } from "../../../../src/components/ui/ScreenHeader";
import { SearchBar } from "../../../../src/components/ui/SearchBar";
import { Chip } from "../../../../src/components/ui/Chip";
import { FAB } from "../../../../src/components/ui/FAB";
import { SkeletonList } from "../../../../src/components/ui/Skeleton";
import { EmptyState, SearchEmptyState, ErrorState, NetworkErrorState } from "../../../../src/components/states";
import { InvestorCard } from "../../../../src/components/domain/InvestorCard";
import { useInvestors, flattenInvestors } from "../../../../src/features/investors/api";
import { ApiError } from "../../../../src/api/client";
import { palette, spacing } from "../../../../src/theme/tokens";

const SEGMENTS = ["HNI", "Affluent", "Retail", "NRI", "Corporate"];

function useDebounced<T>(value: T, delay = 350): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

export default function InvestorsList() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [segment, setSegment] = useState<string>("");
  const debounced = useDebounced(search);

  const query = useInvestors({ q: debounced, segment });
  const { rows, total } = flattenInvestors(query.data);

  const onEndReached = useCallback(() => {
    if (query.hasNextPage && !query.isFetchingNextPage) query.fetchNextPage();
  }, [query]);

  const header = (
    <View style={styles.controls}>
      <SearchBar value={search} onChangeText={setSearch} placeholder="Search name, PAN, phone…" />
      <View style={styles.chips}>
        <Chip label="All" selected={segment === ""} onPress={() => setSegment("")} />
        {SEGMENTS.map((s) => (
          <Chip key={s} label={s} selected={segment === s} onPress={() => setSegment(segment === s ? "" : s)} />
        ))}
      </View>
    </View>
  );

  const renderBody = () => {
    if (query.isLoading) {
      return (
        <>
          {header}
          <SkeletonList count={8} />
        </>
      );
    }
    if (query.isError) {
      const net = query.error instanceof ApiError && query.error.kind !== "http";
      return net ? <NetworkErrorState onRetry={() => query.refetch()} /> : <ErrorState message={(query.error as any)?.message} onRetry={() => query.refetch()} />;
    }
    return (
      <FlashList
        data={rows}
        keyExtractor={(it) => it.id}
        renderItem={({ item }) => (
          <InvestorCard investor={item} onPress={() => router.push(`/m/investors/${item.id}`)} />
        )}
        ListHeaderComponent={header}
        contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: 96 }}
        onEndReached={onEndReached}
        onEndReachedThreshold={0.4}
        refreshing={query.isRefetching}
        onRefresh={() => query.refetch()}
        ListEmptyComponent={
          debounced ? <SearchEmptyState query={debounced} /> : <EmptyState icon="users" title="No clients yet" message="Add your first client to get started." actionLabel="Add client" onAction={() => router.push("/m/investors/new" as any)} />
        }
        ListFooterComponent={query.isFetchingNextPage ? <SkeletonList count={2} /> : null}
      />
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: palette.surfaceAlt }}>
      <ScreenHeader title="Clients" subtitle={query.isLoading ? undefined : `${total} client${total === 1 ? "" : "s"}`} />
      <View style={{ flex: 1 }}>{renderBody()}</View>
      <FAB onPress={() => router.push("/m/investors/new" as any)} />
    </View>
  );
}

const styles = StyleSheet.create({
  controls: { paddingTop: spacing.md, paddingBottom: spacing.sm, gap: spacing.md },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
});
