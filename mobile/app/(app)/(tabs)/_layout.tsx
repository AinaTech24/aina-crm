/**
 * Bottom tabs: Home · Leads · Clients · Activities · More. Every other module
 * lives in More (grouped, capability-gated — src/navigation/menu.ts). There is
 * no drawer any more: it duplicated More and could only be opened from 2 of the
 * 5 tabs.
 *
 * Tasks and Settings are HIDDEN tabs, opened from More / the profile menu. They
 * get a back button, and `backBehavior="history"` makes back return to wherever
 * the user came from instead of jumping to Home.
 *
 * Header-right on every tab root is search + notifications + avatar.
 */

import React from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Pressable, type ColorValue } from "react-native";
import { Tabs, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { Feather } from "@expo/vector-icons";
import { palette, spacing, fontWeight, TOUCH_MIN } from "../../../src/theme/tokens";
import { useBrand } from "../../../src/theme/brand";
import { HeaderActions } from "../../../src/components/HeaderActions";
import { useMe } from "../../../src/api/me";
import { setSentryUser } from "../../../src/lib/sentry";

function BackButton() {
  const router = useRouter();
  return (
    <Pressable
      onPress={() => router.back()}
      hitSlop={12}
      accessibilityRole="button"
      accessibilityLabel="Back"
      style={{ width: TOUCH_MIN, height: TOUCH_MIN, justifyContent: "center", marginLeft: spacing.sm }}
    >
      <Feather name="chevron-left" size={26} color={palette.ink} />
    </Pressable>
  );
}

export default function TabsLayout() {
  const { brand } = useBrand();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  // Only mounted once signed in — tag crash reports with the (opaque) user id.
  const userId = useMe().data?.user.id ?? null;
  React.useEffect(() => { setSentryUser(userId); }, [userId]);

  const icon = (name: React.ComponentProps<typeof Feather>["name"]) =>
    ({ color, size }: { color: ColorValue; size: number }) => <Feather name={name} size={size} color={color} />;

  return (
    <Tabs
      backBehavior="history"
      screenOptions={{
        // Cross-fade+shift between tabs instead of an instant snap.
        animation: "shift",
        tabBarActiveTintColor: brand,
        tabBarInactiveTintColor: palette.faint,
        tabBarStyle: { borderTopColor: palette.line, height: 60 + insets.bottom, paddingBottom: Math.max(8, insets.bottom), paddingTop: 6 },
        tabBarLabelStyle: { fontSize: 12, fontWeight: fontWeight.medium },
        headerStyle: { backgroundColor: palette.surface, shadowColor: "transparent", elevation: 0, borderBottomWidth: 0 },
        headerTitleStyle: { fontWeight: fontWeight.bold, color: palette.ink, fontSize: 18 },
        // Left-aligned on both platforms (iOS centres by default) so the Tabs
        // header lines up with ScreenHeader on the list tabs.
        headerTitleAlign: "left",
        headerRight: () => <HeaderActions />,
      }}
    >
      <Tabs.Screen name="home" options={{ title: t("tabs.home"), tabBarIcon: icon("home") }} />
      {/* List tabs render their own ScreenHeader (title + live count + actions). */}
      <Tabs.Screen name="leads" options={{ title: t("tabs.leads"), headerShown: false, tabBarIcon: icon("trending-up") }} />
      <Tabs.Screen name="clients" options={{ title: t("tabs.clients"), headerShown: false, tabBarIcon: icon("users") }} />
      <Tabs.Screen name="activities" options={{ title: "Work", tabBarIcon: icon("check-square") }} />
      <Tabs.Screen name="more" options={{ title: t("tabs.more"), tabBarIcon: icon("grid") }} />
      {/* Hidden tabs, reached from More. */}
      <Tabs.Screen name="tasks" options={{ title: t("tabs.tasks"), href: null, headerLeft: () => <BackButton /> }} />
      <Tabs.Screen name="settings" options={{ title: t("tabs.settings"), href: null, headerLeft: () => <BackButton /> }} />
    </Tabs>
  );
}
