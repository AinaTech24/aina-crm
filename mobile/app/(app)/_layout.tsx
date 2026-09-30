/**
 * Authenticated shell. A native STACK is the parent navigator: its base screen
 * is the bottom-tab group, and every module screen (/m/*, search, sync,
 * notifications) PUSHES on top with the platform transition + iOS swipe-back —
 * the tabs never swallow push animations (a drawer used to own every screen, which
 * made all navigation snap with no motion). Guards against a lost session.
 */

import React from "react";
import { Redirect, Stack, useRouter } from "expo-router";
import { useSession } from "../../src/state/session";
import { addNotificationTapListener, getInitialNotificationUrl } from "../../src/push";
import { toMobileRoute } from "../../src/features/command-center/api";
import { useApplyTenantBrand } from "../../src/features/settings/api";
import { CallLogPrompt } from "../../src/features/activities/CallLogPrompt";
import { watchSimCalls } from "../../src/features/activities/simCallSync";
import { OfflineBanner } from "../../src/components/ui/OfflineBanner";
import { AppLock } from "../../src/components/AppLock";
import { useRecentlyViewed } from "../../src/state/recentlyViewed";
import { configurePushHandler, registerForPush } from "../../src/lib/push";
import { useOfflineQueue, watchConnectivityAndFlush } from "../../src/lib/offlineQueue";
import { usePrefs } from "../../src/state/prefs";
import { palette } from "../../src/theme/tokens";

// Deep links into /m/* land with the tab group as the back anchor, so
// the first back press goes Home instead of exiting the app.
export const unstable_settings = { initialRouteName: "(tabs)" };

/** Push payloads carry a web path ("/dashboard/tasks/…") or a full URL; map
 *  it to the native route, or null when this app has no screen for it. */
function routeFromPush(url: string): string | null {
  try {
    const path = /^https?:\/\//i.test(url) ? new URL(url).pathname : url;
    if (path.startsWith("/m/")) return path;
    return toMobileRoute(path);
  } catch {
    return null;
  }
}

export default function AppLayout() {
  const router = useRouter();
  const status = useSession((s) => s.status);
  const token = useSession((s) => s.token);
  const owner = useSession((s) => s.owner);
  const autoLogCalls = usePrefs((s) => s.autoLogCalls);
  React.useEffect(() => status === "authed" && autoLogCalls ? watchSimCalls() : undefined, [status, owner, autoLogCalls]);
  // A tapped notification should land on the thing it's about — both when the
  // app is already running and when the tap cold-started it.
  React.useEffect(() => {
    if (status !== "authed") return;
    const go = (url: string) => { const r = routeFromPush(url); if (r) router.push(r as any); };
    const sub = addNotificationTapListener(go);
    getInitialNotificationUrl().then((u) => { if (u) go(u); });
    return () => sub.remove();
  }, [status, router]);
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
    useOfflineQueue.getState().hydrate().then(() => useOfflineQueue.getState().flush()).catch(() => {});
    return watchConnectivityAndFlush();
  }, [status, owner]);
  // Device preferences (e.g. auto-log calls) must be loaded before the first
  // call returns, or the very first call would use the default instead.
  React.useEffect(() => { usePrefs.getState().hydrate(); }, []);
  if (status !== "authed") return <Redirect href="/login" />;

  return (
    <>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: palette.surfaceAlt },
        }}
      >
        <Stack.Screen name="(tabs)" />
      </Stack>
      {/* Semi-automatic call logging — prompts to log a call on return to the app. */}
      <CallLogPrompt />
      <OfflineBanner />
      {/* Biometric gate (opt-in, App preferences) — last so it paints over everything. */}
      <AppLock />
    </>
  );
}
