/**
 * Authenticated shell. A Drawer ("sidebar") is the parent navigator: its default
 * area is the bottom-tab group, and every other module opens from the drawer
 * (rendered by CustomDrawer, capability-gated). Guards against a lost session.
 */

import React from "react";
import { Redirect } from "expo-router";
import { Drawer } from "expo-router/drawer";
import type { DrawerContentComponentProps } from "@react-navigation/drawer";
import { useSession } from "../../src/state/session";
import { CustomDrawer } from "../../src/navigation/CustomDrawer";
import { useApplyTenantBrand } from "../../src/features/settings/api";
import { CallLogPrompt } from "../../src/features/activities/CallLogPrompt";
import { OfflineBanner } from "../../src/components/ui/OfflineBanner";
import { useRecentlyViewed } from "../../src/state/recentlyViewed";
import { configurePushHandler, registerForPush } from "../../src/lib/push";
import { useOfflineQueue, watchConnectivityAndFlush } from "../../src/lib/offlineQueue";

export default function AppLayout() {
  const status = useSession((s) => s.status);
  const token = useSession((s) => s.token);
  // Apply the firm's brand colour app-wide (and live whenever the theme is saved).
  useApplyTenantBrand();
  // Restore the recently-viewed rail once per authenticated session.
  const hydrate = useRecentlyViewed((s) => s.hydrate);
  React.useEffect(() => {
    if (status === "authed") hydrate();
  }, [status, hydrate]);
  // Register for push notifications (best-effort; no-ops until a dev build exists).
  React.useEffect(() => {
    configurePushHandler();
    if (status === "authed" && token) registerForPush(token);
  }, [status, token]);
  // Restore any writes made while offline and replay them the moment we're back.
  React.useEffect(() => {
    if (status !== "authed") return;
    useOfflineQueue.getState().hydrate().then(() => useOfflineQueue.getState().flush());
    return watchConnectivityAndFlush();
  }, [status]);
  if (status !== "authed") return <Redirect href="/login" />;

  return (
    <>
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
      />
      {/* Semi-automatic call logging — prompts to log a call on return to the app. */}
      <CallLogPrompt />
      <OfflineBanner />
    </>
  );
}
