/**
 * OfflineBanner — a thin bar under the status bar shown when the API is
 * unreachable (see connectivity store). Auto-hides once a request succeeds.
 */

import React from "react";
import { useRouter } from "expo-router";
import { View, Pressable, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeInDown } from "react-native-reanimated";
import { Feather } from "@expo/vector-icons";
import { useConnectivity } from "../../state/connectivity";
import { useOfflineQueue } from "../../lib/offlineQueue";
import { palette, spacing, fontWeight } from "../../theme/tokens";
import { Text } from "./Text";

export function OfflineBanner() {
  const online = useConnectivity((s) => s.online);
  const items = useOfflineQueue(s => s.items);
  const storageError = useOfflineQueue(s => s.storageError);
  const pending = items.filter(w => w.status === "pending").length;
  const failed = items.filter(w => w.status === "failed").length;
  const router = useRouter();
  const insets = useSafeAreaInsets();
  if (online && !items.length && !storageError) return null;
  const label = storageError ? "Device storage needs attention · Open Sync"
    : failed ? `${failed} change${failed === 1 ? "" : "s"} need attention · Open Sync`
    : pending ? `${pending} saved on this phone · ${online ? "Sync pending" : "Offline"}`
    : "Offline · Some actions need a connection";
  return (
    <Animated.View entering={FadeInDown.duration(200)} style={[styles.bar, { paddingTop: insets.top + 6 }]}>
      <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={() => router.push("/sync" as any)} style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 48, flex: 1, justifyContent: "center" }}>
      <Feather name="wifi-off" size={13} color={palette.white} />
      <Text style={{ color: palette.white, fontWeight: fontWeight.medium, fontSize: 12 }}>{label}</Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bar: { position: "absolute", top: 0, left: 0, right: 0, zIndex: 100, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, paddingBottom: 6, backgroundColor: palette.danger },
});
