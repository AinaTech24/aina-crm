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

// Same sections/order/copy as the web settings hub.
const SECTIONS: Section[] = [
  { icon: "refresh-cw", title: "Sync", desc: "Review pending and failed changes saved on this device.", route: "/sync" },
  // My profile + Organisation profile live in the drawer's profile menu now.
  { icon: "smartphone", title: "App preferences", desc: "Auto-log calls, and how this device behaves for you.", route: "/m/settings-preferences" },
  { icon: "droplet", title: "Appearance & theme", desc: "Re-skin the CRM to your brand — colours, font & density, and your white-label URL.", route: "/m/settings-appearance" },
  { icon: "shield", title: "Risk profile questionnaire", desc: "Customise questions, scoring, and risk-category bands for your firm.", route: "/m/settings-risk-profile" },
  { icon: "bell", title: "Notification templates", desc: "Edit the 18 lead-journey templates — welcome, referral, meeting, proposal, docs, portal.", route: "/m/settings-notification-templates" },
  { icon: "check-square", title: "Onboarding form fields", desc: "Choose which client account-opening / KYC fields your team MUST fill — make any field mandatory or optional.", route: "/m/settings-onboarding-fields" },
  { icon: "users", title: "Team & roles", desc: "Invite team members, assign roles, manage seats.", route: "/m/employees" },
  { icon: "share-2", title: "Desks (sub-branch teams)", desc: "Group each branch into desks (DK, RC, 1…) and assign RMs — drives the monthly MIS roll-ups.", route: "/m/settings-desks" },
  { icon: "git-branch", title: "Auto-assignment rules", desc: "Route new leads & clients to your team automatically — round-robin or load-balanced.", route: "/m/settings-assignment-rules" },
  { icon: "target", title: "Annual quotas", desc: "Annual CRM quotas. Monthly commitments are in Targets & achievement.", route: "/m/settings-targets" },
  { icon: "credit-card", title: "Billing & subscription", desc: "Current plan, payment history, renewal.", route: "/m/billing" },
  { icon: "message-circle", title: "WhatsApp connection", desc: "Your Aina WhatsApp number and Meta template approvals.", route: "/m/settings-whatsapp" },
  { icon: "mail", title: "Email setup", desc: "Sending domain, DKIM, transactional + marketing streams.", route: "/m/settings-email" },
  { icon: "key", title: "Two-factor authentication", desc: "Add a TOTP authenticator code on top of your password. Self-service for your own account.", route: "/m/settings-security" },
  { icon: "link", title: "Integrations", desc: "BSE Star MF, CAMS / KFintech feeds, Razorpay, KYC providers.", route: "/m/settings-integrations" },
];

export default function Settings() {
  const router = useRouter();
  const me = useMe().data;
  const caps = me?.capabilities ?? [];
  const personal = ["/sync", "/m/settings-preferences", "/m/settings-security"];
  const capFor: Record<string, string> = { "/m/employees": "settings.users", "/m/billing": "settings.billing", "/m/settings-desks": "settings.desks", "/m/settings-assignment-rules": "settings.desks", "/m/settings-targets": "dashboard.view.owner" };
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
