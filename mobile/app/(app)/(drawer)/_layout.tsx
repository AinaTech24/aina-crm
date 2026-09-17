/**
 * Drawer shell — wraps ONLY the bottom-tab group. Module screens (/m/*) live in
 * the parent STACK above this drawer, so they push with a real native
 * slide-in and iOS edge-swipe-back. The drawer edge-swipe therefore only
 * exists on the tabs — on a pushed module screen the same gesture goes BACK,
 * which is what a native app does.
 */

import React from "react";
import { Drawer } from "expo-router/drawer";
import type { DrawerContentComponentProps } from "@react-navigation/drawer";
import { CustomDrawer } from "../../../src/navigation/CustomDrawer";
import { useMe } from "../../../src/api/me";
import { setSentryUser } from "../../../src/lib/sentry";

export default function DrawerLayout() {
  // Only mounted once signed in — tag crash reports with the (opaque) user id.
  const userId = useMe().data?.user.id ?? null;
  React.useEffect(() => { setSentryUser(userId); }, [userId]);
  return (
    <Drawer
      drawerContent={(props: DrawerContentComponentProps) => <CustomDrawer {...props} />}
      screenOptions={{
        headerShown: false,
        // Always a slide-out overlay (never the permanent web sidebar) so the
        // mobile layout is consistent across widths.
        drawerType: "front",
        // Transparent container: CustomDrawer paints its own white panel INSIDE
        // the safe area, leaving the status-bar / gesture-bar strips showing the
        // system scrim (not the sidebar's white).
        drawerStyle: { width: 320, backgroundColor: "transparent" },
        swipeEdgeWidth: 40,
      }}
    >
      <Drawer.Screen name="(tabs)" />
    </Drawer>
  );
}
