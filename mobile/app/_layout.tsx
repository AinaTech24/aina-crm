/**
 * Root layout — wraps the whole app in the providers every screen needs:
 * gesture root (drawer + swipe), safe-area, the TanStack Query cache, and a
 * one-time session hydration (read keychain + refresh) that decides login vs app.
 */

import "react-native-gesture-handler";
import React, { useEffect } from "react";
import { View, ActivityIndicator, StyleSheet } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { queryClient } from "../src/api/queryClient";
import { useSession } from "../src/state/session";
import { setPushHandler } from "../src/push";
import { palette } from "../src/theme/tokens";

setPushHandler();

export default function RootLayout() {
  const status = useSession((s) => s.status);
  const hydrate = useSession((s) => s.hydrate);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <StatusBar style="dark" />
          {status === "loading" ? (
            <View style={styles.splash}>
              <ActivityIndicator size="large" color={palette.brand} />
            </View>
          ) : (
            <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: palette.surfaceAlt } }}>
              <Stack.Screen name="index" />
              <Stack.Screen name="login" />
              <Stack.Screen name="(app)" />
            </Stack>
          )}
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  splash: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: palette.surfaceAlt },
});
