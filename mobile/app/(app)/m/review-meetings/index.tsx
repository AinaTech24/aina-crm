/**
 * Review Meetings list. Search + status filter chips over GET /api/review-meetings.
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
import { useMeetings, filterMeetings, MEETING_STATUSES, type Meeting } from "../../../../src/features/meetings/api";
import { meetingStatusBadge } from "../../../../src/lib/status";
import { titleCase, fmtDate } from "../../../../src/lib/format";
import { palette, radius, spacing } from "../../../../src/theme/tokens";

function MeetingCard({ meeting, onPress }: { meeting: Meeting; onPress: () => void }) {
  const st = meetingStatusBadge(meeting.status);
  return (
    <Card onPress={onPress} style={{ marginBottom: spacing.md }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
        <View style={styles.icon}>
          <Feather name="calendar" size={18} color={palette.brandDark} />
        </View>
        <View style={{ flex: 1, gap: 3 }}>
          <Text variant="subtitle" numberOfLines={1}>
            {meeting.subject ?? titleCase(meeting.meetingType) ?? "Meeting"}
          </Text>
          <Text variant="caption" tone="muted">
            {titleCase(meeting.meetingMode)}
            {meeting.meetingDate ? ` · ${fmtDate(meeting.meetingDate)}` : ""}
          </Text>
          <StatusPill label={st.label} tone={st.tone} size="sm" />
        </View>
      </View>
    </Card>
  );
}

export default function MeetingsList() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const { data, isLoading, isError, error, refetch, isRefetching } = useMeetings();
  const meetings = useMemo(() => filterMeetings(data?.meetings ?? [], search, status), [data, search, status]);

  const header = (
    <View style={styles.controls}>
      <SearchBar value={search} onChangeText={setSearch} placeholder="Search meetings…" />
      <View style={styles.chips}>
        <Chip label="All" selected={status === ""} onPress={() => setStatus("")} />
        {MEETING_STATUSES.map((s) => (
          <Chip key={s} label={titleCase(s)} selected={status === s} onPress={() => setStatus(status === s ? "" : s)} />
        ))}
      </View>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: palette.surfaceAlt }}>
      <ScreenHeader title="Review Meetings" subtitle={isLoading ? undefined : `${meetings.length} meeting${meetings.length === 1 ? "" : "s"}`} />
      {isLoading ? (
        <>
          {header}
          <SkeletonList count={6} />
        </>
      ) : isError ? (
        <ErrorState message={(error as any)?.message} onRetry={() => refetch()} />
      ) : (
        <FlashList
          data={meetings}
          keyExtractor={(m) => m.id}
          renderItem={({ item }) => <MeetingCard meeting={item} onPress={() => router.push(`/m/review-meetings/${item.id}`)} />}
          ListHeaderComponent={header}
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: 96 }}
          refreshing={isRefetching}
          onRefresh={() => refetch()}
          ListEmptyComponent={search ? <SearchEmptyState query={search} /> : <EmptyState icon="calendar" title="No meetings" message="Scheduled client reviews will appear here." />}
        />
      )}
      <FAB icon="plus" onPress={() => router.push("/m/review-meetings" as any)} />
    </View>
  );
}

const styles = StyleSheet.create({
  controls: { paddingTop: spacing.md, paddingBottom: spacing.sm, gap: spacing.md },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  icon: { width: 44, height: 44, borderRadius: radius.pill, backgroundColor: palette.brandLight, alignItems: "center", justifyContent: "center" },
});
