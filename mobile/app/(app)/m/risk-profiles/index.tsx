/**
 * Risk Profiles — the CRM's /dashboard/risk-profiles: the active book in five
 * tabs that add up to it (Not profiled · Due for review · Current · Expired ·
 * Awaiting client confirmation), search by name or PAN narrowing the counts
 * too, and the managers' actions: upload a profile the client already holds,
 * suggest from age (provisional), email the link to everyone not profiled.
 *
 * `?filter=due,expired` (a dashboard's "Risk profiles due") lists both buckets.
 */

import React, { useEffect, useMemo, useState } from "react";
import { View, Pressable, ScrollView, StyleSheet } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { FlashList } from "@shopify/flash-list";
import { Feather } from "@expo/vector-icons";
import { Text } from "../../../../src/components/ui/Text";
import { Chip } from "../../../../src/components/ui/Chip";
import { Skeleton } from "../../../../src/components/ui/Skeleton";
import { ScreenHeader } from "../../../../src/components/ui/ScreenHeader";
import { SearchBar } from "../../../../src/components/ui/SearchBar";
import { BottomSheet } from "../../../../src/components/ui/BottomSheet";
import { FAB } from "../../../../src/components/ui/FAB";
import { ErrorState, PermissionDeniedState } from "../../../../src/components/states";
import { useRiskRegister, useRiskCaps } from "../../../../src/features/risk-profiles/api";
import { RISK_BUCKETS, parseRiskBucket, type RiskBucket } from "../../../../src/features/risk-profiles/rules";
import { RiskRowCard } from "../../../../src/features/risk-profiles/RiskRowCard";
import { BulkSendSheet } from "../../../../src/features/risk-profiles/BulkSendSheet";
import { SuggestByAgeSheet } from "../../../../src/features/risk-profiles/SuggestByAgeSheet";
import { palette, spacing, TOUCH_MIN } from "../../../../src/theme/tokens";

/** What an empty tab says (the web's EMPTY). */
const EMPTY: Record<RiskBucket, string> = {
  not_profiled: "Every client has a signed risk profile.",
  due: "No profile falls due for review in the next month.",
  current: "No client has a current signed profile yet.",
  expired: "No profile has expired.",
  awaiting: "No suggested profile is waiting for a client to confirm it.",
};

const n = (v: number) => v.toLocaleString("en-IN");

export default function RiskProfilesList() {
  const router = useRouter();
  const params = useLocalSearchParams<{ filter?: string }>();
  const { canManage } = useRiskCaps();

  // A deep link may carry several buckets (`due,expired`); a tab tap picks one.
  const initial = useMemo(() => {
    const keys = [...new Set((params.filter ?? "").split(",").map((f) => f.trim()).filter((f) => RISK_BUCKETS.some((b) => b.key === f)))] as RiskBucket[];
    return keys.length ? keys : [parseRiskBucket(params.filter?.split(",")[0])];
  }, [params.filter]);
  const [tabs, setTabs] = useState<RiskBucket[]>(initial);
  useEffect(() => setTabs(initial), [initial]);
  const combined = tabs.length > 1;

  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => { const t = setTimeout(() => setQ(search), 250); return () => clearTimeout(t); }, [search]);

  const [menu, setMenu] = useState(false);
  const [bulkSend, setBulkSend] = useState(false);
  const [byAge, setByAge] = useState(false);

  // Counts, search and order come from the server (the web page's SQL).
  const book = useRiskRegister(tabs, q);
  const counts = book.counts;
  // "Send to all not profiled (N)" — the server's audience ignores a search.
  const notProfiledAll = book.notProfiledAll;
  const rows = book.rows ?? [];

  const header = (
    <View>
      <SearchBar value={search} onChangeText={setSearch} placeholder="Search client name or PAN…" />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
        {combined ? (
          <Chip label={tabs.map((k) => RISK_BUCKETS.find((b) => b.key === k)?.label).join(" + ")} count={tabs.reduce((s, k) => s + counts[k], 0)} selected />
        ) : null}
        {RISK_BUCKETS.map((b) => (
          <Chip key={b.key} label={b.label} count={counts[b.key]} selected={!combined && tabs[0] === b.key} onPress={() => setTabs([b.key])} />
        ))}
      </ScrollView>
    </View>
  );

  const right = canManage ? (
    <Pressable onPress={() => setMenu(true)} hitSlop={10} accessibilityRole="button" accessibilityLabel="More actions" style={styles.more}>
      <Feather name="more-vertical" size={20} color={palette.ink} />
    </Pressable>
  ) : undefined;

  const progressLabel = book.progress && book.progress.total > book.progress.done
    ? `${n(book.progress.done)} of ${n(book.progress.total)}`
    : null;

  return (
    <View style={{ flex: 1, backgroundColor: palette.surfaceAlt }}>
      <ScreenHeader title="Risk Profiles" right={right} />
      {!book.loading && !book.canView ? <PermissionDeniedState /> : book.isError && !book.rows ? (
        <ErrorState message={(book.error as any)?.message} onRetry={book.refetch} />
      ) : book.loading ? (
        <View style={{ padding: spacing.lg }}>
          {progressLabel ? <Text variant="caption" tone="muted" style={{ marginBottom: spacing.sm }}>{progressLabel}</Text> : null}
          <Skeleton width="100%" height={76} />
          <Skeleton width="100%" height={76} style={{ marginTop: spacing.sm }} />
          <Skeleton width="100%" height={76} style={{ marginTop: spacing.sm }} />
        </View>
      ) : (
        <FlashList
          data={rows}
          keyExtractor={(r) => r.id}
          ListHeaderComponent={header}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }}
          onRefresh={book.refetch}
          refreshing={book.isRefetching}
          onEndReached={book.loadMore}
          onEndReachedThreshold={0.4}
          ListEmptyComponent={
            <Text variant="body" tone="muted" style={{ textAlign: "center", marginTop: spacing["2xl"] }}>
              {q ? `No client matching “${q}” in this list.` : combined ? "No client here." : EMPTY[tabs[0]]}
            </Text>
          }
          renderItem={({ item }) => <RiskRowCard r={item} onPress={() => router.push(`/m/risk-profiles/${item.id}` as any)} />}
        />
      )}
      {canManage ? <FAB icon="plus" label="New risk profile" onPress={() => router.push("/m/risk-profiles/new" as any)} /> : null}

      <BottomSheet visible={menu} onClose={() => setMenu(false)} title="Risk profiles">
        <MenuRow icon="upload" label="Upload risk profile" onPress={() => { setMenu(false); router.push("/m/risk-profiles/upload" as any); }} />
        <MenuRow icon="users" label="Suggest from age" onPress={() => { setMenu(false); setByAge(true); }} />
        <MenuRow icon="mail" label={`Send link to all not profiled (${n(notProfiledAll)})`} disabled={notProfiledAll === 0} onPress={() => { setMenu(false); setBulkSend(true); }} />
      </BottomSheet>
      <BulkSendSheet visible={bulkSend} onClose={() => setBulkSend(false)} />
      <SuggestByAgeSheet visible={byAge} onClose={() => setByAge(false)} />
    </View>
  );
}

function MenuRow({ icon, label, onPress, disabled }: { icon: React.ComponentProps<typeof Feather>["name"]; label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={({ pressed }) => [styles.menuRow, pressed && { backgroundColor: palette.surfaceSunken }, disabled && { opacity: 0.45 }]} accessibilityRole="button">
      <Feather name={icon} size={17} color={palette.ink70} />
      <Text variant="body" style={{ flex: 1, color: palette.ink }}>{label}</Text>
      <Feather name="chevron-right" size={16} color={palette.faint} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chips: { gap: spacing.sm, paddingVertical: spacing.md },
  more: { width: TOUCH_MIN, height: TOUCH_MIN, alignItems: "center", justifyContent: "center" },
  menuRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.lineSoft },
});
