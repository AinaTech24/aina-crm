/**
 * Opportunities — every opportunity the viewer can see (the CRM's module at
 * /dashboard/opportunities): the headline figures, then the list, filtered by
 * follow-up and status. Access follows the client. Tap a row for its journey;
 * "New opportunity" picks the client first.
 */

import React, { useEffect, useState } from "react";
import { View, Pressable, ScrollView, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { FlashList } from "@shopify/flash-list";
import { Card } from "../../../../src/components/ui/Card";
import { Text } from "../../../../src/components/ui/Text";
import { StatusPill } from "../../../../src/components/ui/StatusPill";
import { Skeleton } from "../../../../src/components/ui/Skeleton";
import { ScreenHeader } from "../../../../src/components/ui/ScreenHeader";
import { SearchBar } from "../../../../src/components/ui/SearchBar";
import { BottomSheet } from "../../../../src/components/ui/BottomSheet";
import { FAB } from "../../../../src/components/ui/FAB";
import { ErrorState } from "../../../../src/components/states";
import { useSearch } from "../../../../src/features/search/api";
import { useOpportunityBoard, useClientOpportunities, assigneeList, istDay, istDayOf, BOARD_COLUMNS, type BoardRow, type BoardFilters } from "../../../../src/features/opportunities/api";
import { NewOpportunitySheet } from "../../../../src/features/opportunities/ClientOpportunities";
import { inr, fmtDate } from "../../../../src/lib/format";
import { spacing, palette, radius, fontWeight } from "../../../../src/theme/tokens";

const FILTERS: Array<{ key: string; label: string; f: BoardFilters }> = [
  { key: "open", label: "Open", f: {} },
  { key: "overdue", label: "Overdue", f: { fu: "overdue" } },
  { key: "today", label: "Due today", f: { fu: "today" } },
  { key: "none", label: "No follow-up", f: { fu: "none" } },
  { key: "mine", label: "Mine", f: { mine: true } },
  { key: "won", label: "Won", f: { status: "won" } },
  { key: "lost", label: "Lost", f: { status: "lost" } },
];

export default function OpportunitiesList() {
  const router = useRouter();
  const [filter, setFilter] = useState("open");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [picking, setPicking] = useState(false);
  const [clientId, setClientId] = useState<string | null>(null);
  useEffect(() => { const t = setTimeout(() => setQ(search), 300); return () => clearTimeout(t); }, [search]);

  const active = FILTERS.find((x) => x.key === filter)!;
  const { data, isLoading, isError, error, refetch, isRefetching } = useOpportunityBoard({ ...active.f, q });
  // The board's list endpoint ships with this app version; an older CRM server
  // answers 404. Each client's own Opportunities section works either way.
  const notOnServer = (error as any)?.status === 404;
  const rows = data?.rows ?? [];
  const k = data?.kpis;

  const header = (
    <View>
      {k ? (
        <View style={styles.ribbon}>
          <Metric label="Open" value={String(k.open)} sub={k.openValue ? inr(k.openValue) : undefined} />
          <Metric label="Overdue" value={String(k.overdue)} alarm={k.overdue > 0} />
          <Metric label="Today" value={String(k.dueToday)} />
          <Metric label="Later" value={String(k.later)} />
          <Metric label="Won (month)" value={String(k.wonThisMonth)} />
        </View>
      ) : null}
      <SearchBar value={search} onChangeText={setSearch} placeholder="Search client or product…" />
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
      <ScreenHeader title="Opportunities" />
      {isError && !data ? (
        <ErrorState
          message={notOnServer ? "The Opportunities board needs the latest CRM server update. Until then, open a client to see and work their opportunities." : (error as any)?.message}
          onRetry={refetch}
        />
      ) : isLoading && !data ? (
        <View style={{ padding: spacing.lg }}><Skeleton width="100%" height={72} /><Skeleton width="100%" height={72} style={{ marginTop: spacing.sm }} /></View>
      ) : (
        <FlashList
          data={rows}
          keyExtractor={(r) => r.id}
          ListHeaderComponent={header}
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }}
          onRefresh={refetch}
          refreshing={isRefetching}
          ListEmptyComponent={<Text variant="body" tone="muted" style={{ textAlign: "center", marginTop: spacing["2xl"] }}>No opportunities here.</Text>}
          renderItem={({ item }) => <Row r={item} onPress={() => router.push(`/m/opportunities/${item.id}?name=${encodeURIComponent(item.investorName)}` as any)} />}
        />
      )}
      {data?.canWork ? <FAB icon="plus" label="New opportunity" onPress={() => setPicking(true)} /> : null}
      <ClientPicker visible={picking} onClose={() => setPicking(false)} onPick={(id) => { setPicking(false); setClientId(id); }} />
      {clientId ? <NewForClient investorId={clientId} onClose={() => setClientId(null)} onCreated={(id) => router.push(`/m/opportunities/${id}` as any)} /> : null}
    </View>
  );
}

function Row({ r, onPress }: { r: BoardRow; onPress: () => void }) {
  const today = istDay();
  const due = r.followUpAt ? istDayOf(r.followUpAt) : null;
  const col = BOARD_COLUMNS.find((c) => c.key === r.column)?.label ?? r.stageName;
  return (
    <Pressable onPress={onPress} accessibilityRole="button">
      <Card style={{ marginBottom: spacing.sm }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <Text variant="body" style={{ flex: 1, fontWeight: fontWeight.semibold }} numberOfLines={1}>{r.investorName}</Text>
          {r.status === "won" ? <StatusPill label="Won" tone="success" size="sm" />
            : r.status === "lost" ? <StatusPill label="Lost" tone="danger" size="sm" />
            : <StatusPill label={r.later ? "Later" : col} tone={r.later ? "neutral" : r.delayed ? "danger" : "info"} size="sm" dot={false} />}
        </View>
        <Text variant="caption" tone="muted" numberOfLines={1} style={{ marginTop: 2 }}>
          {r.productLabel}{r.status === "open" && !r.later && r.column === "processing" ? ` · ${r.stageName}` : ""}{r.expectedValue ? ` · ${inr(r.expectedValue)}` : ""}
        </Text>
        <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: spacing.xs }}>
          <Text variant="caption" style={{ color: r.status !== "open" ? palette.muted : r.later ? palette.muted : !due ? palette.warning : due < today ? palette.danger : due === today ? palette.warning : palette.muted }}>
            {r.status === "won" ? `Won ${fmtDate(r.closedAt)}` : r.status === "lost" ? (r.lostReason ?? "Lost") : r.later ? `Revisit ${fmtDate(r.later.revisitOn)}` : due ? `Follow up ${fmtDate(due)}` : "No follow-up set"}
          </Text>
          {r.ownerName ? <Text variant="caption" tone="faint" numberOfLines={1}>{r.ownerName}</Text> : null}
        </View>
      </Card>
    </Pressable>
  );
}

function ClientPicker({ visible, onClose, onPick }: { visible: boolean; onClose: () => void; onPick: (id: string) => void }) {
  const [q, setQ] = useState("");
  const search = useSearch(q);
  return (
    <BottomSheet visible={visible} onClose={onClose} title="Which client?">
      <SearchBar value={q} onChangeText={setQ} placeholder="Search a client…" />
      <ScrollView style={{ maxHeight: 360, marginTop: spacing.sm }} keyboardShouldPersistTaps="handled">
        {(search.data?.investors ?? []).map((i) => (
          <Pressable key={i.id} style={styles.pick} onPress={() => { setQ(""); onPick(i.id); }} accessibilityRole="button">
            <Text variant="body" numberOfLines={1}>{i.name}</Text>
            {i.phone ? <Text variant="caption" tone="muted">{i.phone}</Text> : null}
          </Pressable>
        ))}
      </ScrollView>
    </BottomSheet>
  );
}

/** The client's assignees come with their opportunities (GET …/opportunities). */
function NewForClient({ investorId, onClose, onCreated }: { investorId: string; onClose: () => void; onCreated: (id: string) => void }) {
  const q = useClientOpportunities(investorId);
  return <NewOpportunitySheet investorId={investorId} visible onClose={onClose} assignees={assigneeList(q.data?.assignees)} me={q.data?.me} onCreated={onCreated} />;
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
  pick: { paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.lineSoft },
});
