/**
 * Business Entries list. Search + status chips over GET /api/business-entries.
 */

import React, { useState, useMemo } from "react";
import { View, StyleSheet } from "react-native";
import { FlashList } from "@shopify/flash-list";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { ScreenHeader } from "../../../../src/components/ui/ScreenHeader";
import { SearchBar } from "../../../../src/components/ui/SearchBar";
import { Chip } from "../../../../src/components/ui/Chip";
import { Card } from "../../../../src/components/ui/Card";
import { Text } from "../../../../src/components/ui/Text";
import { StatusPill } from "../../../../src/components/ui/StatusPill";
import { FAB } from "../../../../src/components/ui/FAB";
import { SkeletonList } from "../../../../src/components/ui/Skeleton";
import { EmptyState, SearchEmptyState, ErrorState } from "../../../../src/components/states";
import { useBusinessEntries, filterEntries, ENTRY_STATUSES, type BusinessEntry } from "../../../../src/features/business-entries/api";
import { entryStatusBadge } from "../../../../src/lib/status";
import { inr, titleCase } from "../../../../src/lib/format";
import { palette, radius, spacing } from "../../../../src/theme/tokens";

function EntryCard({ entry, onPress }: { entry: BusinessEntry; onPress: () => void }) {
  const st = entryStatusBadge(entry.status);
  return (
    <Card onPress={onPress} style={{ marginBottom: spacing.md }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
        <View style={styles.icon}>
          <Feather name="edit-3" size={18} color={palette.brandDark} />
        </View>
        <View style={{ flex: 1, gap: 3 }}>
          <Text variant="subtitle" numberOfLines={1}>
            {entry.clientName ?? "Entry"}
          </Text>
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {titleCase(entry.productType)}
            {entry.amcName ? ` · ${entry.amcName}` : ""}
          </Text>
          <StatusPill label={st.label} tone={st.tone} size="sm" />
        </View>
        <View style={{ alignItems: "flex-end", gap: 2 }}>
          <Text variant="caption" tone="faint">
            Amount
          </Text>
          <Text variant="subtitle">{inr(entry.totalAmount)}</Text>
        </View>
      </View>
    </Card>
  );
}

export default function BusinessEntriesList() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const { data, isLoading, isError, error, refetch, isRefetching } = useBusinessEntries();
  const entries = useMemo(() => filterEntries(data?.entries ?? [], search, status), [data, search, status]);

  const header = (
    <View style={styles.controls}>
      <SearchBar value={search} onChangeText={setSearch} placeholder="Search client, AMC, folio…" />
      <View style={styles.chips}>
        <Chip label="All" selected={status === ""} onPress={() => setStatus("")} />
        {ENTRY_STATUSES.map((s) => (
          <Chip key={s} label={titleCase(s)} selected={status === s} onPress={() => setStatus(status === s ? "" : s)} />
        ))}
      </View>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: palette.surfaceAlt }}>
      <ScreenHeader title="Business Entries" subtitle={isLoading ? undefined : `${entries.length} entr${entries.length === 1 ? "y" : "ies"}`} />
      {isLoading ? (
        <>
          {header}
          <SkeletonList count={6} />
        </>
      ) : isError ? (
        <ErrorState message={(error as any)?.message} onRetry={() => refetch()} />
      ) : (
        <FlashList
          data={entries}
          keyExtractor={(e) => e.id}
          renderItem={({ item }) => <EntryCard entry={item} onPress={() => router.push(`/m/business-entries/${item.id}`)} />}
          ListHeaderComponent={header}
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: 96 }}
          refreshing={isRefetching}
          onRefresh={() => refetch()}
          ListEmptyComponent={search ? <SearchEmptyState query={search} /> : <EmptyState icon="edit-3" title="No entries" message="Manually-entered business transactions will appear here." />}
        />
      )}
      <FAB onPress={() => router.push("/m/business-entries" as any)} />
    </View>
  );
}

const styles = StyleSheet.create({
  controls: { paddingTop: spacing.md, paddingBottom: spacing.sm, gap: spacing.md },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  icon: { width: 44, height: 44, borderRadius: radius.pill, backgroundColor: palette.brandLight, alignItems: "center", justifyContent: "center" },
});
