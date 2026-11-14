/**
 * Discovery (Fact-find) — every fact-find whose client or lead the viewer can
 * see, newest first, with its status and health score (the CRM's
 * /dashboard/discovery). Tap one to open the editor; + starts one.
 */

import React, { useMemo, useState } from "react";
import { View, Pressable, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { FlashList } from "@shopify/flash-list";
import { Card } from "../../../../src/components/ui/Card";
import { Text } from "../../../../src/components/ui/Text";
import { StatusPill } from "../../../../src/components/ui/StatusPill";
import { Skeleton } from "../../../../src/components/ui/Skeleton";
import { ScreenHeader } from "../../../../src/components/ui/ScreenHeader";
import { SearchBar } from "../../../../src/components/ui/SearchBar";
import { FAB } from "../../../../src/components/ui/FAB";
import { ErrorState } from "../../../../src/components/states";
import { useDiscoveries, STATUS_TONE, type DiscoveryRow } from "../../../../src/features/discovery/api";
import { NewDiscoverySheet } from "../../../../src/features/discovery/NewDiscoverySheet";
import { scoreColor } from "../../../../src/features/discovery/HealthSnapshot";
import { timeAgo, titleCase } from "../../../../src/lib/format";
import { spacing, palette, radius, fontWeight } from "../../../../src/theme/tokens";

/** Every word must match the title (the client / lead's name) or the review type. */
function matches(r: DiscoveryRow, words: string[]): boolean {
  const hay = `${r.title ?? ""} ${r.reviewType ?? ""}`.toLowerCase();
  return words.every((w) => hay.includes(w));
}

export default function DiscoveryList() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [starting, setStarting] = useState(false);
  const { data, isLoading, isError, refetch, isRefetching } = useDiscoveries();
  const all = data ?? [];
  const q = search.trim().toLowerCase();
  const rows = useMemo(() => {
    const words = q.split(/\s+/).filter(Boolean).slice(0, 6);
    return words.length ? all.filter((r) => matches(r, words)) : all;
  }, [all, q]);
  const submitted = all.filter((r) => r.status === "submitted").length;

  const header = (
    <View>
      {submitted > 0 ? (
        <View style={styles.banner}>
          <Text variant="label" style={{ color: "#92400e" }}>
            {submitted} discovery{submitted === 1 ? "" : "s"} submitted by clients and awaiting your review.
          </Text>
        </View>
      ) : null}
      <SearchBar value={search} onChangeText={setSearch} placeholder="Search by client, lead or title…" />
      <View style={{ height: spacing.md }} />
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: palette.surfaceAlt }}>
      <ScreenHeader title="Discovery (Fact-find)" />
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
          ListEmptyComponent={
            <Text variant="body" tone="muted" style={{ textAlign: "center", marginTop: spacing["2xl"] }}>
              {q ? `No discoveries match “${search.trim()}”.` : "No discoveries yet."}
            </Text>
          }
          renderItem={({ item }) => <Row r={item} onPress={() => router.push(`/m/discovery/${item.id}` as any)} />}
        />
      )}
      <FAB icon="plus" label="New discovery" onPress={() => setStarting(true)} />
      <NewDiscoverySheet
        visible={starting}
        onClose={() => setStarting(false)}
        onCreated={(id) => { setStarting(false); router.push(`/m/discovery/${id}` as any); }}
      />
    </View>
  );
}

function Row({ r, onPress }: { r: DiscoveryRow; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button">
      <Card style={{ marginBottom: spacing.sm }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <View style={{ flex: 1 }}>
            <Text variant="body" style={{ color: palette.ink, fontWeight: fontWeight.semibold }} numberOfLines={1}>{r.title || "Untitled discovery"}</Text>
            {r.reviewType ? <Text variant="caption" tone="muted" numberOfLines={1}>{r.reviewType}</Text> : null}
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={{ fontSize: 18, fontWeight: fontWeight.bold, color: r.healthScore != null ? scoreColor(r.healthScore) : palette.faint }}>
              {r.healthScore != null ? r.healthScore : "—"}
            </Text>
            <Text variant="caption" tone="faint">Health</Text>
          </View>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.sm }}>
          <StatusPill label={titleCase(r.status)} tone={STATUS_TONE[r.status] ?? "neutral"} size="sm" />
          <Text variant="caption" tone="muted">{r.subjectType === "lead" ? "Lead" : "Client"}</Text>
          <Text variant="caption" tone="faint" style={{ marginLeft: "auto" }}>{timeAgo(r.updatedAt)}</Text>
        </View>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: { borderWidth: 1, borderColor: "#fde68a", backgroundColor: palette.warningBg, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, marginBottom: spacing.md },
});
