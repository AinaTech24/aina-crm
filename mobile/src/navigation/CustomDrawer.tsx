/**
 * The drawer ("sidebar") — every module that isn't a bottom tab, grouped and
 * shown only if the user's capabilities allow it (same gate as the server).
 * Header shows who's signed in; footer signs out.
 */

import React from "react";
import { View, Pressable, StyleSheet } from "react-native";
import { DrawerContentScrollView, type DrawerContentComponentProps } from "expo-router/drawer";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { palette, spacing, radius, fontWeight } from "../theme/tokens";
import { Text } from "../components/ui/Text";
import { useMe, hasAnyCap } from "../api/me";
import { useSession } from "../state/session";
import { MENU } from "./menu";

export function CustomDrawer(props: DrawerContentComponentProps) {
  const router = useRouter();
  const { data: me } = useMe();
  const signOut = useSession((s) => s.signOut);
  const caps = me?.capabilities;

  const go = (route: string) => {
    props.navigation.closeDrawer();
    router.push(route as any);
  };

  return (
    <View style={styles.container}>
      {/* Profile header */}
      <View style={styles.header}>
        <View style={styles.avatar}>
          <Text style={{ color: palette.white, fontWeight: fontWeight.bold }}>
            {(me?.user.name ?? "?").slice(0, 1).toUpperCase()}
          </Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="subtitle" numberOfLines={1}>
            {me?.user.name ?? "Loading…"}
          </Text>
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {me?.user.roleLabel ?? ""}
          </Text>
        </View>
      </View>

      <DrawerContentScrollView {...props} contentContainerStyle={{ paddingTop: spacing.sm }}>
        {MENU.map((group) => {
          const items = group.items.filter((it) => !it.anyCap || hasAnyCap(caps, it.anyCap));
          if (items.length === 0) return null;
          return (
            <View key={group.title} style={styles.group}>
              <Text variant="caption" tone="faint" style={styles.groupTitle}>
                {group.title.toUpperCase()}
              </Text>
              {items.map((it) => (
                <Pressable key={it.key} onPress={() => go(it.route)} style={styles.item}>
                  <Feather name={it.icon} size={18} color={palette.muted} />
                  <Text variant="body" style={{ color: palette.ink, flex: 1 }}>
                    {it.label}
                  </Text>
                  <Feather name="chevron-right" size={16} color={palette.faint} />
                </Pressable>
              ))}
            </View>
          );
        })}
      </DrawerContentScrollView>

      {/* Footer */}
      <Pressable style={styles.signOut} onPress={() => signOut()}>
        <Feather name="log-out" size={18} color={palette.danger} />
        <Text variant="body" style={{ color: palette.danger, fontWeight: fontWeight.medium }}>
          Sign out
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.surface },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingTop: 56,
    paddingBottom: spacing.lg,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.line,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: palette.brand,
    alignItems: "center",
    justifyContent: "center",
  },
  group: { marginBottom: spacing.lg },
  groupTitle: { paddingHorizontal: spacing.lg, marginBottom: spacing.xs, letterSpacing: 0.6 },
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  signOut: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: palette.line,
  },
});
