/**
 * More — the single home for every module that isn't a bottom tab. It replaced
 * the drawer, which duplicated this list and could only be opened from two of
 * the five tabs. Groups come from src/navigation/menu.ts and are gated on the
 * same capabilities the server enforces; items that ARE tabs are left out.
 */

import React from "react";
import { Pressable, View, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { Screen, Text, Card } from "../../../src/components/ui";
import { useMe, hasAnyCap } from "../../../src/api/me";
import { useOfflineQueue } from "../../../src/lib/offlineQueue";
import { MENU, type MenuItem } from "../../../src/navigation/menu";
import { palette, spacing, radius, fontWeight } from "../../../src/theme/tokens";

/** Menu entries that are bottom tabs now — listing them here would push a second copy. */
const TAB_KEYS = new Set(["investors", "leads", "activities"]);

const WORK: MenuItem[] = [
  { key: "tasks", label: "Tasks & follow-ups", icon: "check-square", route: "/tasks" },
  { key: "business-entries", label: "Business entries", icon: "file-text", route: "/m/business-entries" },
  { key: "mobile-targets", label: "Targets & achievement", icon: "target", route: "/m/mobile-targets" },
];
const APP: MenuItem[] = [
  { key: "sync", label: "Offline sync", icon: "refresh-cw", route: "/sync" },
  { key: "settings", label: "Settings", icon: "settings", route: "/settings" },
];

export default function More() {
  const router = useRouter();
  const caps = useMe().data?.capabilities;
  const pending = useOfflineQueue((s) => s.items.length);

  const groups = [
    { title: "Your work", items: WORK },
    ...MENU.map((g) => ({ title: g.title, items: g.items.filter((it) => !TAB_KEYS.has(it.key) && (!it.anyCap || hasAnyCap(caps, it.anyCap))) })),
    { title: "App", items: APP },
  ].filter((g) => g.items.length > 0);

  return (
    <Screen scroll padded contentStyle={{ paddingTop: spacing.md, paddingBottom: spacing["3xl"] }}>
      {groups.map((g) => (
        <View key={g.title} style={{ marginBottom: spacing.lg }}>
          <Text variant="caption" tone="faint" style={styles.groupTitle}>{g.title.toUpperCase()}</Text>
          <Card flat style={{ padding: 0, overflow: "hidden" }}>
            {g.items.map((it, i) => {
              const badge = it.key === "sync" && pending > 0 ? pending : 0;
              return (
                <Pressable
                  key={it.key}
                  accessibilityRole="button"
                  accessibilityLabel={badge ? `${it.label}, ${badge} pending` : it.label}
                  onPress={() => router.push(it.route as any)}
                  style={({ pressed }) => [styles.row, i < g.items.length - 1 && styles.divider, pressed && { backgroundColor: palette.surfaceSunken }]}
                >
                  <View style={styles.icon}><Feather name={it.icon} size={17} color={palette.brandDark} /></View>
                  <Text variant="body" style={{ flex: 1, color: palette.ink }}>{it.label}</Text>
                  {badge ? (
                    <View style={styles.badge}><Text variant="caption" style={{ color: palette.white, fontWeight: fontWeight.bold }}>{badge}</Text></View>
                  ) : null}
                  <Feather name="chevron-right" size={16} color={palette.faint} />
                </Pressable>
              );
            })}
          </Card>
        </View>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  groupTitle: { letterSpacing: 0.6, marginBottom: spacing.sm },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md, paddingHorizontal: spacing.lg },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line },
  icon: { width: 34, height: 34, borderRadius: radius.md, backgroundColor: palette.brandLight, alignItems: "center", justifyContent: "center" },
  badge: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 6, backgroundColor: palette.warning, alignItems: "center", justifyContent: "center" },
});
