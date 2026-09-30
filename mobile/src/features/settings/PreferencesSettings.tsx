/**
 * App preferences — per-device behaviour for THIS user, not firm config. Stored
 * locally, so switching phones doesn't carry them over (deliberate: they
 * describe how you work on this handset).
 */

import React, { useEffect, useState } from "react";
import { View, Pressable, Platform, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { Screen } from "../../components/ui/Screen";
import { Card } from "../../components/ui/Card";
import { Text } from "../../components/ui/Text";
import { ScreenHeader } from "../../components/ui/ScreenHeader";
import { Segmented } from "../../components/ui/Segmented";
import { useTranslation } from "react-i18next";
import { biometricAvailable, biometricLabel, biometricPrompt } from "../../components/AppLock";
import { LANGUAGES } from "../../i18n";
import { usePrefs } from "../../state/prefs";
import { enableSimCalls, syncSimCalls } from "../activities/simCallSync";
import { ACTIVITY_OUTCOMES } from "../activities/api";
import { toast } from "../../lib/toast";
import { spacing, palette, radius, fontWeight } from "../../theme/tokens";
import { toneColors } from "../../theme";
import { errorMessage } from "../../lib/errors";

export function PreferencesSettings() {
  const autoLogCalls = usePrefs((s) => s.autoLogCalls);
  const autoLogOutcome = usePrefs((s) => s.autoLogOutcome);
  const appLock = usePrefs((s) => s.appLock);
  const language = usePrefs((s) => s.language);
  const setPref = usePrefs((s) => s.set);
  const { t } = useTranslation();

  // null = still checking; false = no enrolled biometrics on this device.
  const [bioOk, setBioOk] = useState<boolean | null>(Platform.OS === "web" ? false : null);
  const [bioName, setBioName] = useState("biometrics");
  useEffect(() => {
    if (Platform.OS === "web") return;
    biometricAvailable().then(setBioOk);
    biometricLabel().then(setBioName);
  }, []);

  const toggleAuto = async () => {
    if (autoLogCalls) { setPref("autoLogCalls", false); toast.success("Automatic call logging off"); return; }
    try {
      if (await enableSimCalls()) toast.success("CRM call logging enabled from now");
      else toast.info("Call log permission was not granted. You can still log calls manually.");
    } catch (e) { toast.error(errorMessage(e)); }
  };

  // Turning the lock ON requires passing the check once, so a user with a
  // flaky sensor can't enable it and immediately be locked out.
  const toggleLock = async () => {
    if (appLock) {
      setPref("appLock", false);
      toast.success("App lock turned off");
      return;
    }
    if (!bioOk) return toast.error(`Set up ${bioName} in your phone's settings first.`);
    const ok = await biometricPrompt(`Confirm ${bioName} to turn on app lock`);
    if (!ok) return;
    setPref("appLock", true);
    toast.success(`App lock on — ${bioName} required to open Aina CRM`);
  };

  return (
    <View style={{ flex: 1, backgroundColor: palette.surfaceAlt }}>
      <ScreenHeader title={t("prefs.title")} subtitle={t("prefs.subtitle")} />
      <Screen scroll padded contentStyle={{ paddingTop: spacing.lg, paddingBottom: spacing["3xl"] }}>
        <Text variant="caption" tone="faint" style={styles.label}>{t("prefs.language")}</Text>
        <Card flat style={{ marginBottom: spacing.xl }}>
          <Text>English</Text>
          <Text variant="caption" tone="faint" style={{ marginTop: spacing.sm }}>English, Hindi and Gujarati call recordings can be summarized in English.</Text>
        </Card>

        <Text variant="caption" tone="faint" style={styles.label}>SECURITY</Text>
        <Card flat style={{ marginBottom: spacing.xl }}>
          <Pressable style={styles.row} onPress={toggleLock} disabled={bioOk === null} accessibilityRole="switch" accessibilityState={{ checked: appLock, disabled: bioOk === false }}>
            <View style={{ flex: 1 }}>
              <Text variant="body" style={{ fontWeight: fontWeight.semibold }}>Require {bioName} to open</Text>
              <Text variant="caption" tone="muted" style={{ marginTop: 2 }}>
                {bioOk === false
                  ? `No ${bioName} set up on this phone — add one in your device settings to use app lock.`
                  : appLock
                  ? "Locks on launch and after 30 seconds in the background. Client data stays hidden until you unlock."
                  : "Client portfolios and contacts are visible to anyone holding your unlocked phone. Turn this on to add a check."}
              </Text>
            </View>
            <View style={[styles.switch, appLock && styles.switchOn, bioOk === false && { opacity: 0.4 }]}>
              <View style={[styles.knob, appLock && styles.knobOn]} />
            </View>
          </Pressable>
        </Card>

        <Text variant="caption" tone="faint" style={styles.label}>CALL LOGGING</Text>

        <Card flat>
          <Pressable style={styles.row} onPress={toggleAuto} accessibilityRole="switch" accessibilityState={{ checked: autoLogCalls }}>
            <View style={{ flex: 1 }}>
              <Text variant="body" style={{ fontWeight: fontWeight.semibold }}>Log calls automatically</Text>
              <Text variant="caption" tone="muted" style={{ marginTop: 2 }}>
                {autoLogCalls
                  ? "Matching incoming, outgoing and missed SIM calls sync when you open this app."
                  : "You'll be asked to log each call when you return to the app."}
              </Text>
            </View>
            <View style={[styles.switch, autoLogCalls && styles.switchOn]}>
              <View style={[styles.knob, autoLogCalls && styles.knobOn]} />
            </View>
          </Pressable>

          {autoLogCalls ? (
            <View style={styles.sub}>
              <Text variant="caption" tone="faint" style={{ marginTop: spacing.sm }}>
                Duration and direction come from Android. Only uniquely matched CRM numbers are uploaded. No audio is recorded.
              </Text>
              <Pressable accessibilityRole="button" onPress={() => syncSimCalls().then(() => toast.success("Call sync checked")).catch((e) => toast.error(e.message))} style={{ paddingVertical: spacing.md }}><Text tone="brand">Sync calls now</Text></Pressable>
            </View>
          ) : null}
        </Card>

        {/* Being straight about the limits beats a surprise later. */}
        <View style={styles.note}>
          <Feather name="info" size={13} color={toneColors("info").fg} />
          <Text variant="caption" tone="muted" style={{ flex: 1 }}>
            Requires Android call-log permission. To summarize a discussion, open its call activity and choose a recording after the participants have consented to recording and AI processing.
          </Text>
        </View>
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { letterSpacing: 0.6, marginBottom: spacing.sm },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  switch: { width: 46, height: 27, borderRadius: 14, backgroundColor: palette.line, padding: 3, justifyContent: "center" },
  switchOn: { backgroundColor: palette.brand },
  knob: { width: 21, height: 21, borderRadius: 11, backgroundColor: palette.white },
  knobOn: { alignSelf: "flex-end" },
  sub: { marginTop: spacing.lg, paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.line },
  note: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, marginTop: spacing.lg, backgroundColor: palette.surface, borderRadius: radius.md, padding: spacing.md },
});
