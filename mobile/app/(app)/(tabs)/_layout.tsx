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
 *
 * The bar's height is its content (icon + one label line + the item padding)
 * PLUS the bottom safe-area inset, so gesture navigation / the home indicator
 * never sits on the labels. Labels grow with the phone's font size only up to
 * `fontScale.dense`, which that height is sized for. Red badges: Work = overdue
 * tasks, Leads = follow-ups due today — the server's own counts (badges.ts).
 */

import React from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Pressable, type ColorValue } from "react-native";
import { Tabs, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { Feather } from "@expo/vector-icons";
import { palette, spacing, fontWeight, fontScale, TOUCH_MIN } from "../../../src/theme/tokens";
import { useBrand } from "../../../src/theme/brand";
import { HeaderActions } from "../../../src/components/HeaderActions";
import { Text } from "../../../src/components/ui/Text";
import { useMe } from "../../../src/api/me";
import { setSentryUser } from "../../../src/lib/sentry";
import { useTabBadges, badgeLabel } from "../../../src/features/dashboard/badges";

/** Item padding (5 top + 5 bottom, the navigator's own) + icon box (28) + one
 *  12px label line at the dense font-scale cap (~19) + slack. */
const TAB_CONTENT = 60;
const TAB_TOP = 4;

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

function TabLabel({ color, children }: { color: ColorValue; children: string }) {
  return (
    <Text
      numberOfLines={1}
      maxFontSizeMultiplier={fontScale.dense}
      style={{ color: color as string, fontSize: 12, lineHeight: 16, fontWeight: fontWeight.medium, marginTop: 1 }}
    >
      {children}
    </Text>
  );
}

export default function TabsLayout() {
  const { brand } = useBrand();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  // Only mounted once signed in — tag crash reports with the (opaque) user id.
  const userId = useMe().data?.user.id ?? null;
  React.useEffect(() => { setSentryUser(userId); }, [userId]);
  const badges = useTabBadges();

  const icon = (name: React.ComponentProps<typeof Feather>["name"]) =>
    ({ color, size }: { color: ColorValue; size: number }) => <Feather name={name} size={size} color={color} />;

  const bottom = Math.max(insets.bottom, spacing.sm);
  const badgeStyle = { backgroundColor: palette.danger, color: palette.white, fontSize: 11, fontWeight: fontWeight.bold } as const;

  return (
    <Tabs
      backBehavior="history"
      screenListeners={{ focus: () => badges.refresh() }}
      screenOptions={{
        // Cross-fade+shift between tabs instead of an instant snap.
        animation: "shift",
        tabBarActiveTintColor: brand,
        tabBarInactiveTintColor: palette.faint,
        tabBarStyle: {
          backgroundColor: palette.surface,
          borderTopColor: palette.line,
          height: TAB_CONTENT + TAB_TOP + bottom,
          paddingTop: TAB_TOP,
          paddingBottom: bottom,
        },
        tabBarLabel: ({ color, children }) => <TabLabel color={color}>{children}</TabLabel>,
        // The badge is a fixed-size bubble; letting its digits scale overflows it.
        tabBarAllowFontScaling: false,
        tabBarBadgeStyle: badgeStyle,
        headerStyle: { backgroundColor: palette.surface, shadowColor: "transparent", elevation: 0, borderBottomWidth: 0 },
        headerTitleStyle: { fontWeight: fontWeight.bold, color: palette.ink, fontSize: 18 },
        headerTitleAllowFontScaling: false,
        // Left-aligned on both platforms (iOS centres by default) so the Tabs
        // header lines up with ScreenHeader on the list tabs.
        headerTitleAlign: "left",
        headerRight: () => <HeaderActions />,
      }}
    >
      <Tabs.Screen name="home" options={{ title: t("tabs.home"), tabBarIcon: icon("home") }} />
      {/* List tabs render their own ScreenHeader (title + live count + actions). */}
      <Tabs.Screen
        name="leads"
        options={{
          title: t("tabs.leads"),
          headerShown: false,
          tabBarIcon: icon("trending-up"),
          tabBarBadge: badgeLabel(badges.leads),
          tabBarAccessibilityLabel: badges.leads ? `${t("tabs.leads")}, ${badges.leads} follow-up${badges.leads === 1 ? "" : "s"} due today` : undefined,
        }}
      />
      <Tabs.Screen name="clients" options={{ title: t("tabs.clients"), headerShown: false, tabBarIcon: icon("users") }} />
      <Tabs.Screen
        name="activities"
        options={{
          title: "Work",
          tabBarIcon: icon("check-square"),
          tabBarBadge: badgeLabel(badges.work),
          tabBarAccessibilityLabel: badges.work ? `Work, ${badges.work} overdue task${badges.work === 1 ? "" : "s"}` : undefined,
        }}
      />
      <Tabs.Screen name="more" options={{ title: t("tabs.more"), tabBarIcon: icon("grid") }} />
      {/* Hidden tabs, reached from More. */}
      <Tabs.Screen name="tasks" options={{ title: t("tabs.tasks"), href: null, headerLeft: () => <BackButton /> }} />
      <Tabs.Screen name="settings" options={{ title: t("tabs.settings"), href: null, headerLeft: () => <BackButton /> }} />
    </Tabs>
  );
}
