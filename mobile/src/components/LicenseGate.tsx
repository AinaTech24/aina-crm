/**
 * LicenseGate — the app's copy of the web dashboard's license lock.
 *
 * The web layout shows a lapsed firm (license pending / suspended / expired /
 * cancelled — `license.isRestricted` from /api/me) only Billing and Support;
 * the API itself does not refuse, so without this the phone kept the whole CRM
 * open to a firm whose subscription had ended. Billing and Sync stay reachable
 * (pay, or rescue changes saved on this phone); everything else is covered.
 * Platform admins are never restricted (the server says so too).
 */

import React from "react";
import { View, Linking, StyleSheet } from "react-native";
import { usePathname, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useMe, hasCap } from "../api/me";
import { useSession } from "../state/session";
import { API_BASE_URL } from "../config";
import { Text } from "./ui/Text";
import { Button } from "./ui/Button";
import { palette, spacing, radius } from "../theme/tokens";

const OPEN_WHEN_RESTRICTED = ["/m/billing", "/sync"];

export function LicenseGate() {
  const { data: me } = useMe();
  const pathname = usePathname();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const signOut = useSession((s) => s.signOut);
  const license = me?.license;
  if (!me || !license?.isRestricted || me.user.isPlatformAdmin) return null;
  if (OPEN_WHEN_RESTRICTED.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return null;

  const pending = license.status === "pending";
  const canBill = hasCap(me.capabilities, "settings.billing");
  return (
    <View style={[StyleSheet.absoluteFill, styles.root, { paddingTop: insets.top + spacing["2xl"], paddingBottom: insets.bottom + spacing.xl }]} accessibilityViewIsModal>
      <View style={styles.icon}><Feather name="alert-triangle" size={28} color={palette.warning} /></View>
      <Text variant="title" center style={{ marginTop: spacing.lg }}>
        {pending ? "Finish your payment to open your CRM" : `Your license is ${license.status.replace(/_/g, " ")}`}
      </Text>
      <Text variant="body" tone="muted" center style={{ marginTop: spacing.sm, maxWidth: 320 }}>
        {canBill
          ? "Your subscription needs attention before the app can be used. Renew it from Billing."
          : "Your firm's subscription needs attention. Ask your firm's owner to renew it."}
      </Text>
      <View style={{ gap: spacing.md, marginTop: spacing["2xl"], alignSelf: "stretch" }}>
        {canBill ? <Button label="Open billing" full onPress={() => router.push("/m/billing" as any)} /> : null}
        {canBill ? <Button label="Pay on the web" variant="secondary" full onPress={() => Linking.openURL(`${API_BASE_URL}/dashboard/billing`).catch(() => {})} /> : null}
        <Button label="Sign out" variant="ghost" full onPress={() => signOut()} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: palette.surfaceAlt, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing["2xl"], zIndex: 50, elevation: 50 },
  icon: { width: 64, height: 64, borderRadius: radius.xl, backgroundColor: palette.warningBg, alignItems: "center", justifyContent: "center" },
});
