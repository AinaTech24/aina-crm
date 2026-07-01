/**
 * Authenticated shell. A Drawer ("sidebar") is the parent navigator: its default
 * area is the bottom-tab group, and every other module opens from the drawer
 * (rendered by CustomDrawer, capability-gated). Guards against a lost session.
 */

import React from "react";
import { Redirect } from "expo-router";
import { Drawer } from "expo-router/drawer";
import { useSession } from "../../src/state/session";
import { CustomDrawer } from "../../src/navigation/CustomDrawer";
import { palette } from "../../src/theme/tokens";

export default function AppLayout() {
  const status = useSession((s) => s.status);
  if (status !== "authed") return <Redirect href="/login" />;

  return (
    <Drawer
      drawerContent={(props) => <CustomDrawer {...props} />}
      screenOptions={{
        headerShown: false,
        // Always a slide-out overlay (never the permanent web sidebar) so the
        // mobile layout is consistent across widths.
        drawerType: "front",
        drawerStyle: { width: 320, backgroundColor: palette.surface },
        swipeEdgeWidth: 40,
      }}
    />
  );
}
