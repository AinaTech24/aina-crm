import React, { useState } from "react";
import { View, ScrollView, Pressable, RefreshControl } from "react-native";
import { useRouter } from "expo-router";
import Tasks from "./tasks";
import Activities from "../m/activities/index";
import Meetings from "../m/review-meetings/index";
import { Card, Text, Button } from "../../../src/components/ui";
import { ErrorState, LoadingState } from "../../../src/components/states";
import { useMyDay } from "../../../src/features/dashboard/api";
import { startCall } from "../../../src/features/activities/callAndLog";
import { spacing, palette } from "../../../src/theme/tokens";

export default function Work() {
  const [section, setSection] = useState("Follow-ups");
  return <View style={{ flex: 1, backgroundColor: palette.surfaceAlt }}>
    <View style={{ flexDirection: "row", padding: spacing.sm, gap: spacing.xs }}>
      {["Follow-ups", "Tasks", "Meetings", "Calls"].map(label => <Pressable key={label} accessibilityRole="tab" accessibilityState={{ selected: section === label }} onPress={() => setSection(label)} style={{ flex: 1, minHeight: 48, justifyContent: "center", alignItems: "center", borderBottomWidth: 2, borderBottomColor: section === label ? palette.brand : "transparent" }}><Text variant="caption" tone={section === label ? "brand" : "muted"}>{label}</Text></Pressable>)}
    </View>
    {section === "Tasks" ? <Tasks /> : section === "Meetings" ? <Meetings embedded /> : section === "Calls" ? <Activities embedded /> : <Followups />}
  </View>;
}
function Followups() {
  const router = useRouter();
  const day = useMyDay();
  if (day.isLoading) return <LoadingState />;
  if (day.isError) return <ErrorState onRetry={day.refetch} />;
  const rows = day.data?.followups ?? [];
  return <ScrollView refreshControl={<RefreshControl refreshing={day.isRefetching} onRefresh={() => day.refetch()} />} contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
    <Text variant="subtitle">Due and overdue follow-ups</Text>
    {!rows.length ? <Text tone="muted">No lead follow-ups due. Open Leads to plan your next contact.</Text> : null}
    {rows.map(row => <Card key={row.id} onPress={() => router.push(`/m/leads/${row.id}` as any)}>
      <Text variant="subtitle">{row.name || "Lead"}</Text>
      <Text tone={row.overdue ? "danger" : "muted"}>{row.overdue ? "Overdue" : "Due today"}{row.next_follow_up_at ? ` · ${new Date(row.next_follow_up_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}` : ""}</Text>
      <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm }}>
        {row.phone ? <Button label="Call" variant="secondary" onPress={() => startCall({ subjectType: "lead", subjectId: row.id, name: row.name || "Lead", phone: row.phone! })} /> : null}
        <Button label="Open lead" variant="secondary" onPress={() => router.push(`/m/leads/${row.id}` as any)} />
      </View>
    </Card>)}
    <Button label="All leads" variant="secondary" onPress={() => router.push("/(app)/(tabs)/leads" as any)} />
  </ScrollView>;
}
