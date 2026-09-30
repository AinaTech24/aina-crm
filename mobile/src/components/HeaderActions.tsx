/**
 * Search + notifications + avatar — the global actions on every tab's header.
 * Shared by the Tabs navigator header (Home, More, …) and by ScreenHeader when
 * a list screen is mounted as a tab (Clients, Leads, Activities), so every tab
 * root carries the same three buttons.
 */

import React, { useState } from "react";
import { View, Pressable, Text, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { palette, TOUCH_MIN } from "../theme/tokens";
import { HeaderProfileButton } from "./HeaderProfileButton";
import { NotificationsSheet } from "../features/notifications/NotificationsSheet";
import { useNotifications, isUnread } from "../features/notifications/api";

export function HeaderActions() {
  const router = useRouter();
  const { data } = useNotifications();
  const unread = (data?.notifications ?? []).filter(isUnread).length;
  const [notifOpen, setNotifOpen] = useState(false);
  return (
    <View style={{ flexDirection: "row", alignItems: "center" }}>
      <Pressable
        onPress={() => router.push("/search" as any)}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Search"
        style={styles.btn}
      >
        <Feather name="search" size={20} color={palette.ink} />
      </Pressable>
      <Pressable
        onPress={() => setNotifOpen(true)}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={unread ? `Notifications, ${unread} unread` : "Notifications"}
        style={styles.btn}
      >
        <Feather name="bell" size={20} color={palette.ink} />
        {unread > 0 ? (
          <View style={styles.badge}>
            <Text style={styles.badgeTxt}>{unread > 9 ? "9+" : unread}</Text>
          </View>
        ) : null}
      </Pressable>
      <HeaderProfileButton />
      <NotificationsSheet visible={notifOpen} onClose={() => setNotifOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  btn: { width: TOUCH_MIN, height: TOUCH_MIN, alignItems: "center", justifyContent: "center" },
  badge: { position: "absolute", top: 8, right: 6, minWidth: 16, height: 16, borderRadius: 8, backgroundColor: palette.danger, alignItems: "center", justifyContent: "center", paddingHorizontal: 3 },
  badgeTxt: { color: palette.white, fontSize: 10, fontWeight: "700" },
});
