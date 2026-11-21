/**
 * Tasks tab — web parity. KPI strip (Open / Due today / Overdue / SLA at risk),
 * scope tabs (All / To me / By me / To approve — the web's "Awaiting my
 * approval" view, ?approval=mine), a List / Kanban switch (separate from the
 * scope, as on the web: ?layout=kanban), search + a full filter & sort sheet.
 * The list loads 50 at a time (the API's page) and fetches more on scroll; the
 * board loads up to 300. The Kanban is the web's status board: long-press a
 * card to move it.
 */

import React, { useState, useEffect, useMemo } from "react";
import { View, ScrollView, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { FlashList } from "@shopify/flash-list";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { SearchBar } from "../../../src/components/ui/SearchBar";
import { Segmented } from "../../../src/components/ui/Segmented";
import { FAB } from "../../../src/components/ui/FAB";
import { Text } from "../../../src/components/ui/Text";
import { SkeletonList } from "../../../src/components/ui/Skeleton";
import { EmptyState, SearchEmptyState, ErrorState } from "../../../src/components/states";
import { TaskCard } from "../../../src/components/domain/TaskCard";
import { SwipeableTaskRow } from "../../../src/features/tasks/SwipeableTaskRow";
import { TaskFilters, EMPTY_TASK_FILTERS, countTaskFilters, type UiTaskFilters } from "../../../src/features/tasks/TaskFilters";
import { useTasks, useTaskKpis, tasksOf, TASK_STATUSES, type Task } from "../../../src/features/tasks/api";
import { KanbanBoard } from "../../../src/components/domain/KanbanBoard";
import { LayoutSwitch } from "../../../src/components/ui/LayoutSwitch";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../../../src/api/client";
import { toast } from "../../../src/lib/toast";
import { fmtDate, titleCase } from "../../../src/lib/format";
import { useTeam } from "../../../src/features/team/api";
import { palette, radius, spacing, fontWeight } from "../../../src/theme/tokens";
import { asIcon } from "../../../src/lib/icons";

type TaskView = "" | "to_me" | "by_me" | "approve";
/** The board shows at most this many (the web's Kanban cap). */
const BOARD_CAP = 300;
const ALL_STATUSES = TASK_STATUSES.map((s) => s.key).join(",");
type Due = "" | "today" | "overdue" | "sla_risk";

function useDebounced<T>(value: T, delay = 350): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), delay); return () => clearTimeout(t); }, [value, delay]);
  return v;
}

export default function TasksTab() {
  const router = useRouter();
  const params = useLocalSearchParams<{ due?: string; approval?: string }>();
  const [search, setSearch] = useState("");
  const [view, setView] = useState<TaskView>("");
  const [layout, setLayout] = useState<"list" | "kanban">("list");
  const qc = useQueryClient();
  const [due, setDue] = useState<Due>("");
  useEffect(() => { if (["today", "overdue", "sla_risk"].includes(params.due ?? "")) setDue(params.due as Due); }, [params.due]);
  // A sign-off request links to "Awaiting my approval".
  useEffect(() => { if (params.approval === "mine" || params.approval === "pending") setView("approve"); }, [params.approval]);
  const [filters, setFilters] = useState<UiTaskFilters>({ ...EMPTY_TASK_FILTERS });
  const [sheetOpen, setSheetOpen] = useState(false);
  const debounced = useDebounced(search);
  const rmOptions = useTeam().data?.rows ?? [];
  const isKanban = layout === "kanban";

  const apiFilters = useMemo(() => ({
    q: debounced,
    view: view === "approve" ? "" as const : view,
    approval: view === "approve" ? "mine" as const : "" as const,
    due: isKanban ? "" as Due : due,
    // The board shows every status, like the web's.
    status: filters.status.length ? filters.status.join(",") : isKanban ? ALL_STATUSES : "", priority: filters.priority.join(","), type: filters.type.join(","),
    department: filters.department.join(","), assignee: filters.assignee.join(","),
    created_from: filters.created_from, created_to: filters.created_to, sort: filters.sort,
  }), [debounced, view, due, filters, isKanban]);

  const { data, isLoading, isError, error, refetch, isRefetching, fetchNextPage, hasNextPage, isFetchingNextPage } = useTasks(apiFilters);
  const { data: kpis } = useTaskKpis(apiFilters);
  const tasks = useMemo(() => tasksOf(data), [data]);
  const total = data?.pages?.[0]?.total ?? tasks.length;
  // The board is every status at once: keep loading pages up to the cap.
  useEffect(() => {
    if (isKanban && hasNextPage && !isFetchingNextPage && tasks.length < BOARD_CAP) fetchNextPage().catch(() => {});
  }, [isKanban, hasNextPage, isFetchingNextPage, tasks.length]);
  const loadMore = () => { if (hasNextPage && !isFetchingNextPage) fetchNextPage().catch(() => {}); };
  const activeCount = countTaskFilters(filters);
  const moveTask = async (t: Task, status: string) => {
    try {
      const r: any = await api.patch(`/api/tasks/${t.id}`, { status });
      toast.success(status === "completed" && r?.status !== "completed" && r?.approvalStatus === "pending" ? "Sent for approval" : `Moved to ${TASK_STATUSES.find((s) => s.key === status)?.label ?? status}`);
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't move the task");
    } finally {
      // Awaited, so the board keeps the card where it was dropped until the fresh list lands.
      await Promise.all([qc.invalidateQueries({ queryKey: ["tasks"] }), qc.invalidateQueries({ queryKey: ["task-kpis"] })]);
    }
  };

  const toggleDue = (d: Due) => setDue((cur) => (cur === d ? "" : d));

  const header = (
    <View style={styles.controls}>
      {kpis && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.kpiStrip}>
          <Kpi icon="inbox" tone={palette.brand} label="Open" value={kpis.open} active={due === ""} onPress={() => setDue("")} />
          <Kpi icon="sun" tone={palette.warning} label="Due today" value={kpis.today} active={due === "today"} onPress={() => toggleDue("today")} />
          <Kpi icon="alert-circle" tone={palette.danger} label="Overdue" value={kpis.overdue} active={due === "overdue"} onPress={() => toggleDue("overdue")} />
          <Kpi icon="clock" tone={palette.violet} label="SLA at risk" value={kpis.slaRisk} active={due === "sla_risk"} onPress={() => toggleDue("sla_risk")} />
        </ScrollView>
      )}
      <Segmented<TaskView> options={[{ key: "", label: "All" }, { key: "to_me", label: "To me" }, { key: "by_me", label: "By me" }, { key: "approve", label: "To approve" }]} value={view} onChange={setView} />
      <SearchBar value={search} onChangeText={setSearch} placeholder="Search tasks…" />
      <View style={styles.toolbarRow}>
        <Pressable style={styles.filterBtn} onPress={() => setSheetOpen(true)}>
          <Feather name="sliders" size={15} color={activeCount ? palette.brand : palette.ink} />
          <Text style={{ fontWeight: fontWeight.medium, color: activeCount ? palette.brand : palette.ink }}>Filter & sort{activeCount ? ` · ${activeCount}` : ""}</Text>
        </Pressable>
        {activeCount > 0 ? <Pressable onPress={() => setFilters({ ...EMPTY_TASK_FILTERS })} hitSlop={8}><Text variant="caption" style={{ color: palette.danger }}>Clear</Text></Pressable> : null}
        <LayoutSwitch value={layout} onChange={setLayout} />
      </View>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: palette.surfaceAlt }}>
      {isLoading ? (<><View style={{ paddingHorizontal: spacing.lg }}>{header}</View><SkeletonList count={6} /></>)
      : isError && !tasks.length ? (<><View style={{ paddingHorizontal: spacing.lg }}>{header}</View><ErrorState message={(error as any)?.message} onRetry={() => refetch()} /></>)
      : isKanban ? (
        <View style={{ flex: 1 }}>
          <View style={{ paddingHorizontal: spacing.lg }}>
            {header}
            {total > tasks.length && !hasNextPage ? <Text variant="caption" tone="muted" style={{ marginBottom: spacing.sm }}>Showing {tasks.length} of {total} — narrow the filters to see the rest.</Text> : null}
          </View>
          <KanbanBoard<Task>
            columns={TASK_STATUSES.map((s) => ({ key: s.key, label: s.label, color: toneColor(s.tone) }))}
            items={tasks}
            columnOf={(t) => t.status ?? "open"}
            keyOf={(t) => t.id}
            onOpen={(t) => router.push(`/m/tasks/${t.id}` as any)}
            onMove={moveTask}
            renderCard={(t) => (
              <View style={{ gap: 2 }}>
                <Text variant="caption" style={{ fontWeight: fontWeight.semibold }} numberOfLines={2}>{t.title}</Text>
                {t.investorName || t.leadName ? <Text variant="caption" tone="muted" numberOfLines={1}>{t.investorName ?? t.leadName}</Text> : null}
                <Text variant="caption" style={{ color: t.dueAt && new Date(t.dueAt).getTime() < Date.now() && t.status !== "completed" ? palette.danger : palette.muted }} numberOfLines={1}>
                  {[t.dueAt ? `Due ${fmtDate(t.dueAt)}` : null, t.priority ? titleCase(t.priority) : null, t.assignee].filter(Boolean).join(" · ")}
                </Text>
              </View>
            )}
          />
        </View>
      ) : (
        <FlashList
          data={tasks}
          keyExtractor={(t) => t.id}
          // Swipe right to complete, left to snooze or open the client / lead.
          renderItem={({ item }) => <SwipeableTaskRow task={item} />}
          ListHeaderComponent={header}
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: 96 }}
          refreshing={isRefetching && !isFetchingNextPage}
          onRefresh={() => refetch()}
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          ListFooterComponent={isFetchingNextPage ? <ActivityIndicator style={{ paddingVertical: spacing.lg }} color={palette.brand} /> : null}
          ListEmptyComponent={debounced || activeCount || due ? <SearchEmptyState query={debounced || "these filters"} />
            : view === "approve" ? <EmptyState icon="check-circle" title="Nothing to approve" />
            : <EmptyState icon="check-square" title="No tasks" message="You're all caught up." />}
        />
      )}
      <FAB label="New task" onPress={() => router.push("/m/tasks/new" as any)} />
      <TaskFilters visible={sheetOpen} onClose={() => setSheetOpen(false)} value={filters} onApply={setFilters} rmOptions={rmOptions} />
    </View>
  );
}

function Kpi({ icon, tone, label, value, active, onPress }: { icon: string; tone: string; label: string; value: number; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.kpi, active && { borderColor: tone, backgroundColor: tone + "12" }]}>
      <View style={styles.kpiHead}><Feather name={asIcon(icon)} size={13} color={tone} /><Text variant="caption" tone="muted">{label}</Text></View>
      <Text style={{ fontSize: 20, fontWeight: fontWeight.bold, color: active ? tone : palette.ink }}>{value}</Text>
    </Pressable>
  );
}
function toneColor(t: string): string {
  return t === "success" ? palette.success : t === "warning" ? palette.warning : t === "danger" ? palette.danger : t === "violet" ? palette.violet : t === "info" ? palette.info : palette.muted;
}

const styles = StyleSheet.create({
  controls: { paddingTop: spacing.md, paddingBottom: spacing.sm, gap: spacing.md },
  kpiStrip: { gap: spacing.sm, paddingBottom: spacing.xs },
  kpi: { width: 108, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line, borderRadius: radius.md, padding: spacing.md, gap: 2 },
  kpiHead: { flexDirection: "row", alignItems: "center", gap: 4 },
  toolbarRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  filterBtn: { flexDirection: "row", alignItems: "center", gap: spacing.xs, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
});
