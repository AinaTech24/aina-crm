/**
 * Settings tab. Phase A: identity card + the settings index rows + sign-out.
 * Each row routes to its detail screen as those ship (Profile, Security,
 * Appearance, Notifications, Integrations…). Rows are capability-gated.
 */

import React from "react";
import { View, Pressable, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import Animated, { FadeInUp } from "react-native-reanimated";
import { Screen } from "../../../src/components/ui/Screen";
import { Card } from "../../../src/components/ui/Card";
import { Text } from "../../../src/components/ui/Text";
import { Button } from "../../../src/components/ui/Button";
import { useMe, hasAnyCap } from "../../../src/api/me";
import { useSession } from "../../../src/state/session";
import { palette, spacing, radius, fontWeight } from "../../../src/theme/tokens";

type FeatherName = React.ComponentProps<typeof Feather>["name"];
type Row = { icon: FeatherName; label: string; anyCap?: string[] };

const ROWS: Row[] = [
  { icon: "user", label: "Profile" },
  { icon: "lock", label: "Security & 2FA" },
  { icon: "bell", label: "Notifications" },
  { icon: "droplet", label: "Appearance" },
  { icon: "link", label: "Integrations", anyCap: ["settings.masters", "settings.security"] },
  { icon: "users", label: "Team & Users", anyCap: ["settings.users"] },
  { icon: "credit-card", label: "Billing", anyCap: ["settings.billing"] },
  { icon: "help-circle", label: "Help & Support" },
];

export default function Settings() {
  const { data: me } = useMe();
  const signOut = useSession((s) => s.signOut);
  const rows = ROWS.filter((r) => !r.anyCap || hasAnyCap(me?.capabilities, r.anyCap));

  return (
    <Screen scroll padded contentStyle={{ paddingTop: spacing.lg, paddingBottom: spacing["3xl"] }}>
      <Animated.View entering={FadeInUp.duration(280)}>
        <Card style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
          <View style={styles.avatar}>
            <Text style={{ color: palette.white, fontWeight: fontWeight.bold, fontSize: 20 }}>
              {(me?.user.name ?? "?").slice(0, 1).toUpperCase()}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text variant="subtitle">{me?.user.name ?? "—"}</Text>
            <Text variant="caption" tone="muted">
              {me?.user.email}
            </Text>
            <Text variant="caption" tone="brand" style={{ marginTop: 2 }}>
              {me?.user.roleLabel}
            </Text>
          </View>
        </Card>
      </Animated.View>

      <Card flat style={{ marginTop: spacing.lg, padding: 0, overflow: "hidden" }}>
        {rows.map((r, i) => (
          <Pressable key={r.label} style={[styles.row, i < rows.length - 1 && styles.divider]}>
            <Feather name={r.icon} size={18} color={palette.muted} />
            <Text variant="body" style={{ color: palette.ink, flex: 1 }}>
              {r.label}
            </Text>
            <Feather name="chevron-right" size={16} color={palette.faint} />
          </Pressable>
        ))}
      </Card>

      <View style={{ marginTop: spacing.xl }}>
        <Button label="Sign out" variant="secondary" icon={<Feather name="log-out" size={16} color={palette.danger} />} onPress={() => signOut()} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  avatar: { width: 52, height: 52, borderRadius: radius.pill, backgroundColor: palette.brand, alignItems: "center", justifyContent: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.lg, paddingHorizontal: spacing.lg },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line },
});
