/**
 * Root layout — wraps the whole app in the providers every screen needs:
 * gesture root (drawer + swipe), safe-area (with initial metrics so insets are
 * correct on the FIRST paint — no post-mount padding jump), the TanStack Query
 * cache (persisted to disk, so a cold start paints from the last good data),
 * crash reporting, localisation, and a one-time session hydration that decides
 * login vs app. The boot screen shows the "A" logo + version while the session
 * hydrates.
 */

import "react-native-gesture-handler";
import React, { useEffect, useMemo } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { View, Pressable, ActivityIndicator, StyleSheet } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider, initialWindowMetrics } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import Constants from "expo-constants";
import Animated, { FadeIn, FadeInDown, Easing, useSharedValue, useAnimatedStyle, withDelay, withTiming } from "react-native-reanimated";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { Stack, type ErrorBoundaryProps } from "expo-router";
import { queryClient } from "../src/api/queryClient";
import { createQueryPersister, shouldPersistQuery, CACHE_MAX_AGE_MS } from "../src/api/queryPersist";
import { initSentry, captureException, withSentry } from "../src/lib/sentry";
import { initI18n, setLanguage } from "../src/i18n";
import { useSession } from "../src/state/session";
import { usePrefs } from "../src/state/prefs";
import { setPushHandler } from "../src/push";
import { BrandLogo } from "../src/components/BrandLogo";
import { ToastHost } from "../src/components/ui/ToastHost";
import { Text } from "../src/components/ui/Text";
import { palette, spacing, fontWeight } from "../src/theme/tokens";

// Module-scope, once: crash reporting first so even a boot failure is reported.
initSentry();
initI18n("en");
setPushHandler();

const VERSION = Constants.expoConfig?.version ?? "1.0.0";

function BootScreen() {
  // "Aina CRM" reveal: the wordmark fades up, then a red underline wipes in.
  const underline = useSharedValue(0);
  useEffect(() => {
    underline.value = withDelay(340, withTiming(1, { duration: 620, easing: Easing.out(Easing.cubic) }));
  }, []);
  const underlineStyle = useAnimatedStyle(() => ({ transform: [{ scaleX: underline.value }], opacity: underline.value }));

  return (
    <View style={styles.splash}>
      <View style={styles.brandWrap}>
        <Animated.View entering={FadeIn.duration(420)}>
          <BrandLogo size={92} />
        </Animated.View>
        <Animated.Text entering={FadeInDown.delay(260).duration(520)} style={styles.wordmark}>Aina CRM</Animated.Text>
        <Animated.View style={[styles.underline, underlineStyle]} />
        <Animated.Text entering={FadeIn.delay(720).duration(400)} style={styles.tagline}>Your practice, in your pocket</Animated.Text>
      </View>
      <ActivityIndicator color={palette.brand} style={{ position: "absolute", bottom: 96 }} />
      <Text variant="caption" tone="faint" style={styles.version}>v{VERSION}</Text>
    </View>
  );
}

function RootLayout() {
  const status = useSession((s) => s.status);
  const hydrate = useSession((s) => s.hydrate);
  const language = usePrefs((s) => s.language);
  const prefsHydrated = usePrefs((s) => s.hydrated);
  const owner = useSession((s) => s.owner);
  const persister = useMemo(() => owner ? createQueryPersister(owner) : null, [owner]);

  useEffect(() => {
    hydrate();
    // Prefs are needed before login (language), not just inside the app shell.
    usePrefs.getState().hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (prefsHydrated) setLanguage(language);
  }, [prefsHydrated, language]);

  const content = <>
    <StatusBar style="dark" />
    {status === "loading" ? <BootScreen /> : (
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: palette.surfaceAlt } }}>
        <Stack.Screen name="index" /><Stack.Screen name="login" /><Stack.Screen name="(app)" />
      </Stack>
    )}
    <ToastHost />
  </>;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        {owner && persister && status === "authed" ? <PersistQueryClientProvider
          key={owner}
          client={queryClient}
          persistOptions={{
            persister,
            maxAge: CACHE_MAX_AGE_MS,
            // A new app version invalidates the snapshot — shapes may have changed.
            buster: `${VERSION}.${owner}`,
            dehydrateOptions: { shouldDehydrateQuery: shouldPersistQuery },
          }}
        >
          {content}
        </PersistQueryClientProvider> : <QueryClientProvider client={queryClient}>{content}</QueryClientProvider>}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

export default withSentry(RootLayout);

/**
 * Last line of defence: a render crash anywhere below the root used to take the
 * whole app down (release builds just close). expo-router mounts this around
 * the tree instead, so the user gets a way back — and the crash is reported.
 * Deliberately built from RN primitives only — anything fancier could be the
 * thing that just crashed.
 */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  useEffect(() => {
    captureException(error, { where: "root-error-boundary" });
  }, [error]);

  return (
    <View style={styles.crash}>
      <BrandLogo size={64} />
      <Text variant="title" center style={{ marginTop: spacing.lg }}>Something went wrong</Text>
      <Text variant="body" tone="muted" center style={{ marginTop: spacing.sm }}>
        The screen hit an error it couldn't recover from. Your data is safe — try again, or restart the app if it keeps happening.
      </Text>
      {__DEV__ ? <Text variant="caption" tone="danger" center style={{ marginTop: spacing.md }} selectable>{String(error?.message ?? error)}</Text> : null}
      <Pressable onPress={retry} style={styles.retryBtn} accessibilityRole="button">
        <Text style={{ color: palette.white, fontWeight: fontWeight.semibold }}>Try again</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  splash: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#FFFFFF" },
  crash: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing["2xl"], backgroundColor: palette.surfaceAlt },
  retryBtn: { marginTop: spacing.xl, backgroundColor: palette.brand, paddingHorizontal: spacing["2xl"], paddingVertical: spacing.md, borderRadius: 12 },
  brandWrap: { alignItems: "center" },
  wordmark: { fontSize: 30, fontWeight: fontWeight.bold, color: palette.ink, letterSpacing: -0.5, marginTop: spacing.md },
  underline: { width: 92, height: 3, borderRadius: 2, backgroundColor: palette.brand, marginTop: spacing.sm },
  tagline: { fontSize: 13, color: palette.muted, marginTop: spacing.md },
  version: { position: "absolute", bottom: spacing.xl },
});
