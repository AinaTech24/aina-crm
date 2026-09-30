/**
 * AppLock — biometric gate over the signed-in app. When the "Require Face ID /
 * fingerprint" preference is on, the app locks on cold start and whenever it
 * comes back from the background after LOCK_AFTER_MS. A full-screen modal sits
 * over everything (so nothing behind is readable or tappable) until the OS
 * biometric prompt succeeds. "Sign out" is the escape hatch for a lost
 * biometric (new phone face, changed fingerprints) — it never bypasses the lock.
 *
 * Only `background` (not iOS `inactive`) arms the timer: the biometric prompt
 * itself flips the app inactive→active, which would otherwise re-lock in a loop.
 */

import React, { useEffect, useRef, useState } from "react";
import { View, Modal, Pressable, AppState, Platform, StyleSheet, type AppStateStatus } from "react-native";
import * as LocalAuthentication from "expo-local-authentication";
import { Feather } from "@expo/vector-icons";
import { BrandLogo } from "./BrandLogo";
import { Text } from "./ui/Text";
import { usePrefs } from "../state/prefs";
import { useSession } from "../state/session";
import { palette, spacing, radius, fontWeight } from "../theme/tokens";

/** Quick app switches (a call, a WhatsApp reply) shouldn't demand a face scan. */
const LOCK_AFTER_MS = 30_000;

export async function biometricAvailable(): Promise<boolean> {
  if (Platform.OS === "web") return false;
  try {
    return (await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync());
  } catch {
    return false;
  }
}

/** "Face ID" / "Touch ID" / "fingerprint" — for labels, matched to the device. */
export async function biometricLabel(): Promise<string> {
  try {
    const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
    if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) return Platform.OS === "ios" ? "Face ID" : "face unlock";
    if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) return Platform.OS === "ios" ? "Touch ID" : "fingerprint";
  } catch { /* fall through */ }
  return "biometrics";
}

export async function biometricPrompt(reason: string): Promise<boolean> {
  try {
    const r = await LocalAuthentication.authenticateAsync({ promptMessage: reason, cancelLabel: "Cancel", disableDeviceFallback: false });
    return r.success;
  } catch {
    return false;
  }
}

export function AppLock() {
  const appLock = usePrefs((s) => s.appLock);
  const hydrated = usePrefs((s) => s.hydrated);
  const status = useSession((s) => s.status);
  const signOut = useSession((s) => s.signOut);
  const [locked, setLocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState("biometrics");
  const bgAt = useRef<number | null>(null);
  const coldStartDone = useRef(false);

  const enabled = Platform.OS !== "web" && hydrated && appLock && status === "authed";

  // Cold start: the first time we know the pref is on for a signed-in user, lock.
  useEffect(() => {
    if (!enabled || coldStartDone.current) return;
    coldStartDone.current = true;
    setLocked(true);
  }, [enabled]);

  useEffect(() => { if (enabled) biometricLabel().then(setLabel); }, [enabled]);

  // Background → foreground after the grace period → lock.
  useEffect(() => {
    if (!enabled) return;
    const sub = AppState.addEventListener("change", (next: AppStateStatus) => {
      if (next === "background") bgAt.current = Date.now();
      if (next === "active" && bgAt.current != null) {
        const away = Date.now() - bgAt.current;
        bgAt.current = null;
        if (away >= LOCK_AFTER_MS) setLocked(true);
      }
    });
    return () => sub.remove();
  }, [enabled]);

  const unlock = async () => {
    if (busy) return;
    setBusy(true);
    const ok = await biometricPrompt("Unlock Aina CRM");
    setBusy(false);
    if (ok) setLocked(false);
  };

  // Prompt the moment the lock screen appears — the user shouldn't have to tap first.
  useEffect(() => { if (locked && enabled) unlock(); }, [locked, enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!enabled || !locked) return null;

  return (
    <Modal visible animationType="fade" statusBarTranslucent onRequestClose={() => {}}>
      <View style={styles.root}>
        <BrandLogo size={72} />
        <Text variant="title" center style={{ marginTop: spacing.lg }}>Aina CRM is locked</Text>
        <Text variant="body" tone="muted" center style={{ marginTop: spacing.sm }}>Use {label} to continue.</Text>

        <Pressable onPress={unlock} disabled={busy} style={[styles.unlock, busy && { opacity: 0.6 }]} accessibilityRole="button">
          <Feather name="unlock" size={18} color={palette.white} />
          <Text style={{ color: palette.white, fontWeight: fontWeight.semibold }}>Unlock</Text>
        </Pressable>

        <Pressable onPress={() => { setLocked(false); signOut(); }} hitSlop={8} style={{ marginTop: spacing.xl }} accessibilityRole="button">
          <Text variant="caption" tone="muted">Can't unlock? Sign out</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing["2xl"], backgroundColor: palette.surfaceAlt },
  unlock: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing["2xl"], backgroundColor: palette.brand, paddingHorizontal: spacing["2xl"], paddingVertical: spacing.md, borderRadius: radius.md },
});
