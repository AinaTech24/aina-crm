/**
 * Settings tab — the admin/config hub. Each row routes to its screen
 * (/m/settings-<x>, or an existing module); sign out at the bottom. Profile
 * lives in the top-header profile menu (not duplicated here).
 */

import React from "react";
import { useMe } from "../../../src/api/me";
import { View, Pressable, Platform, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import * as Application from "expo-application";
import { useTranslation } from "react-i18next";
import { Feather } from "@expo/vector-icons";
import { Screen } from "../../../src/components/ui/Screen";
import { Card } from "../../../src/components/ui/Card";
import { Text } from "../../../src/components/ui/Text";
import { Button } from "../../../src/components/ui/Button";
import { useSession } from "../../../src/state/session";
import { confirmDelete } from "../../../src/lib/confirm";
import { palette, spacing, radius } from "../../../src/theme/tokens";

type FeatherName = React.ComponentProps<typeof Feather>["name"];
type Section = { icon: FeatherName; title: string; desc: string; route: string };

// Same sections and order as the web settings hub (SettingsDirectory), in its
// shorter copy, plus the app-only rows (Sync, App preferences).
const SECTIONS: Section[] = [
  { icon: "refresh-cw", title: "Sync", desc: "Changes saved on this phone.", route: "/sync" },
  // My profile + Organisation profile live in the header's profile menu.
  { icon: "smartphone", title: "App preferences", desc: "Call logging, app lock and this device.", route: "/m/settings-preferences" },
  { icon: "droplet", title: "Appearance & theme", desc: "Colours, font, density and your white-label address.", route: "/m/settings-appearance" },
  { icon: "shield", title: "Risk profile questionnaire", desc: "Questions, scoring and risk-category bands.", route: "/m/settings-risk-profile" },
  { icon: "bell", title: "Notification templates", desc: "The lead-journey messages and what each is for.", route: "/m/settings-notification-templates" },
  { icon: "check-square", title: "Onboarding form fields", desc: "Which account-opening and KYC fields are mandatory.", route: "/m/settings-onboarding-fields" },
  { icon: "users", title: "Team & roles", desc: "Invite team members, assign roles, manage seats.", route: "/m/employees" },
  { icon: "share-2", title: "Teams within a branch", desc: "Group each branch into desks and assign RMs.", route: "/m/settings-desks" },
  { icon: "git-branch", title: "Auto-assignment rules", desc: "Route new leads and clients to your team automatically.", route: "/m/settings-assignment-rules" },
  { icon: "target", title: "Targets & quota", desc: "Business and meeting targets per team member.", route: "/m/settings-targets" },
  { icon: "credit-card", title: "Billing & subscription", desc: "Current plan, payment history, renewal.", route: "/m/billing" },
  { icon: "message-circle", title: "WhatsApp", desc: "Your WhatsApp number and Meta template approvals.", route: "/m/settings-whatsapp" },
  { icon: "mail", title: "Email", desc: "Sending domain, DKIM, mailboxes.", route: "/m/settings-email" },
  { icon: "key", title: "Two-factor authentication", desc: "Add an authenticator code on top of your password.", route: "/m/settings-security" },
  { icon: "link", title: "Integrations", desc: "CAMS / KFintech mailback, BSE Star MF, Razorpay, KYC providers.", route: "/m/settings-integrations" },
];

export default function Settings() {
  const router = useRouter();
  const me = useMe().data;
  const caps = me?.capabilities ?? [];
  const personal = ["/sync", "/m/settings-preferences", "/m/settings-security"];
  // Each tile opens only for the capability its server route checks.
  const capFor: Record<string, string> = { "/m/employees": "settings.users", "/m/billing": "settings.billing", "/m/settings-desks": "settings.desks", "/m/settings-assignment-rules": "settings.desks", "/m/settings-targets": "dashboard.view.owner", "/m/settings-onboarding-fields": "settings.users" };
  const visible = SECTIONS.filter(s => personal.includes(s.route) || caps.includes(capFor[s.route] ?? "settings.masters"));
  const sections = [...visible.filter(s => personal.includes(s.route)), ...visible.filter(s => !personal.includes(s.route))];
  const signOut = useSession((s) => s.signOut);
  const { t } = useTranslation();

  return (
    <Screen scroll padded contentStyle={{ paddingTop: spacing.lg, paddingBottom: spacing["3xl"] }}>
      <Text variant="label" tone="muted" style={{ marginBottom: spacing.sm }}>
        {t("settings.title")}
      </Text>
      <Card flat style={{ padding: 0, overflow: "hidden" }}>
        {sections.map((s, i) => (
          <React.Fragment key={s.title}>
          {i === 0 || (personal.includes(sections[i - 1].route) && !personal.includes(s.route)) ? <Text variant="label" tone="muted" style={{ padding: spacing.lg }}>{personal.includes(s.route) ? "PERSONAL" : "FIRM ADMINISTRATION"}</Text> : null}
          <Pressable
            key={s.title}
            accessibilityRole="button"
            style={[styles.row, i < sections.length - 1 && styles.divider]}
            onPress={() => router.push(s.route as any)}
          >
            <View style={styles.iconWrap}>
              <Feather name={s.icon} size={17} color={palette.brandDark} />
            </View>
            <View style={{ flex: 1 }}><Text variant="body">{s.title}</Text><Text variant="caption" tone="muted" style={{ marginTop: 3 }}>{s.desc}</Text></View>
            <Feather name="chevron-right" size={16} color={palette.faint} />
          </Pressable>
          </React.Fragment>
        ))}
      </Card>

      <View style={{ marginTop: spacing.xl }}>
        <Button
          label={t("settings.signOut")}
          variant="secondary"
          icon={<Feather name="log-out" size={16} color={palette.danger} />}
          onPress={() => confirmDelete({ title: t("settings.signOutQ"), message: t("settings.signOutMsg"), confirmLabel: t("settings.signOut") }, () => signOut())}
        />
      </View>

      {/* The first thing support asks for — keep it where the user can read it out. */}
      <Text variant="caption" tone="faint" center style={{ marginTop: spacing.xl }}>
        Aina CRM v{APP_VERSION} ({BUILD}) · {Platform.OS === "ios" ? "iOS" : Platform.OS === "android" ? "Android" : "Web"}
      </Text>
    </Screen>
  );
}

// Read from the INSTALLED binary. eas.json uses remote versioning, so the build
// number in app config is stale (EAS assigns the real one at build time) and
// expo-constants would report the wrong build. Null on web / Expo Go.
const APP_VERSION = Application.nativeApplicationVersion ?? "dev";
const BUILD = Application.nativeBuildVersion ?? "dev";

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md, paddingHorizontal: spacing.lg },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line },
  iconWrap: { width: 34, height: 34, borderRadius: radius.md, backgroundColor: palette.brandLight, alignItems: "center", justifyContent: "center" },
});
