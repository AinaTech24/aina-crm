/**
 * Tasks tab — the daily do-list. Search + status filter chips over GET /api/tasks,
 * virtualized cards, tap → task detail, create FAB. (Header comes from the tab.)
 */

import React, { useState, useMemo } from "react";
import { View, StyleSheet } from "react-native";
import { FlashList } from "@shopify/flash-list";
import { useRouter } from "expo-router";
import { SearchBar } from "../../../src/components/ui/SearchBar";
import { Chip } from "../../../src/components/ui/Chip";
import { FAB } from "../../../src/components/ui/FAB";
import { SkeletonList } from "../../../src/components/ui/Skeleton";
import { EmptyState, SearchEmptyState, ErrorState } from "../../../src/components/states";
import { TaskCard } from "../../../src/components/domain/TaskCard";
import { useTasks, filterTasks, type TaskFilter } from "../../../src/features/tasks/api";
import { palette, spacing } from "../../../src/theme/tokens";

const FILTERS: { key: TaskFilter; label: string }[] = [
  { key: "open", label: "Open" },
  { key: "overdue", label: "Overdue" },
  { key: "completed", label: "Done" },
  { key: "all", label: "All" },
];

export default function TasksTab() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<TaskFilter>("open");
  const { data, isLoading, isError, error, refetch, isRefetching } = useTasks();
  const tasks = useMemo(() => filterTasks(data?.tasks ?? [], search, filter), [data, search, filter]);

  const header = (
    <View style={styles.controls}>
      <SearchBar value={search} onChangeText={setSearch} placeholder="Search tasks…" />
      <View style={styles.chips}>
        {FILTERS.map((f) => (
          <Chip key={f.key} label={f.label} selected={filter === f.key} onPress={() => setFilter(f.key)} />
        ))}
      </View>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: palette.surfaceAlt }}>
      {isLoading ? (
        <>
          {header}
          <SkeletonList count={8} />
        </>
      ) : isError ? (
        <ErrorState message={(error as any)?.message} onRetry={() => refetch()} />
      ) : (
        <FlashList
          data={tasks}
          keyExtractor={(t) => t.id}
          renderItem={({ item }) => <TaskCard task={item} onPress={() => router.push(`/m/tasks/${item.id}`)} />}
          ListHeaderComponent={header}
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: 96 }}
          refreshing={isRefetching}
          onRefresh={() => refetch()}
          ListEmptyComponent={search ? <SearchEmptyState query={search} /> : <EmptyState icon="check-square" title="No tasks" message={filter === "open" ? "You're all caught up." : "Nothing here."} />}
        />
      )}
      <FAB onPress={() => router.push("/m/tasks/new" as any)} />
    </View>
  );
}

const styles = StyleSheet.create({
  controls: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm, gap: spacing.md },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
});
