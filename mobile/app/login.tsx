/**
 * Native login. Email/password → /api/auth/mobile-login; if 2FA is on, swaps to
 * the code step (/api/auth/mobile-2fa). On success the token goes into the
 * session store and the gate routes into the app.
 *
 * The last signed-in email is remembered on-device (keychain), so a returning
 * user only types the password. Fields carry the autofill hints the OS keychain
 * / password manager keys off, and the 2FA field accepts the one-time-code
 * autofill from SMS / authenticator apps.
 */

import React, { useEffect, useRef, useState } from "react";
import { View, TextInput, Pressable, Linking, StyleSheet, KeyboardAvoidingView, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import Animated, { FadeInDown } from "react-native-reanimated";
import { Feather } from "@expo/vector-icons";
import { mobileLogin, mobileVerify2fa } from "../src/api";
import { useSession } from "../src/state/session";
import { storageGet, storageSet } from "../src/lib/storage";
import { API_BASE_URL } from "../src/config";
import { Text } from "../src/components/ui/Text";
import { Button } from "../src/components/ui/Button";
import { palette, radius, spacing, fontSize, fontScale } from "../src/theme/tokens";

const LAST_EMAIL_KEY = "last_login_email";

/** The server answers in terse lower-case ("invalid credentials"); say it like a person. */
function friendly(message: string): string {
  const m = message.trim().toLowerCase();
  if (m === "invalid credentials") return "That email and password don't match.";
  if (m === "account inactive") return "This account is not active. Ask your firm's admin.";
  if (m === "invalid code") return "That code didn't work. Check it and try again.";
  if (m === "invalid challenge" || m.startsWith("challenge expired")) return "That sign-in took too long. Enter your password again.";
  if (m === "email + password required") return "Enter your email and password.";
  return message;
}

export default function Login() {
  const router = useRouter();
  const { t } = useTranslation();
  const signIn = useSession((s) => s.signIn);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [code, setCode] = useState("");
  const [challenge, setChallenge] = useState<string | null>(null);
  // Backup codes ("a1b2c-3d4e5") are letters + digits + a dash — the 6-digit
  // number pad could never type one, so a lost phone locked the user out here.
  const [backup, setBackup] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pwRef = useRef<TextInput>(null);

  useEffect(() => {
    storageGet(LAST_EMAIL_KEY).then((v) => { if (v) setEmail(v); }).catch(() => {});
  }, []);

  // Busy stays on through signIn, so a second tap (or the keyboard's Go plus
  // the button) can't start a second sign-in.
  const finish = async (token: string) => {
    storageSet(LAST_EMAIL_KEY, email.trim()).catch(() => {});
    try {
      await signIn(token);
      router.replace("/(app)/(tabs)/home");
    } catch {
      setBusy(false);
      setError("Couldn't save your sign-in on this phone. Try again.");
    }
  };

  const onPassword = async () => {
    if (busy) return;
    if (!email.trim() || !password) return setError(t("login.missing"));
    setBusy(true);
    setError(null);
    const r = await mobileLogin(email.trim(), password);
    if (r.kind === "ok") return finish(r.token);
    setBusy(false);
    if (r.kind === "2fa") { setCode(""); setBackup(false); return setChallenge(r.challenge); }
    // Includes the firm-requires-2FA 403 ("Sign in once on the web to set it up").
    setError(friendly(r.message));
  };

  const onCode = async () => {
    if (!challenge || busy) return;
    const value = backup ? code.trim().toLowerCase() : code.replace(/\s/g, "");
    if (value.length < 6) return setError(backup ? "Enter one of your backup codes." : "Enter the 6-digit code from your authenticator app.");
    setBusy(true);
    setError(null);
    const r = await mobileVerify2fa(challenge, value);
    if (r.kind === "ok") return finish(r.token);
    setBusy(false);
    const message = r.kind === "error" ? r.message : "invalid code";
    // An expired challenge can't be retried — back to the password step.
    if (/challenge/i.test(message)) { setChallenge(null); setCode(""); setPassword(""); }
    setError(friendly(message));
  };

  // Reset lives on the web (it emails a link) — hand off to the same backend.
  const forgot = () => Linking.openURL(`${API_BASE_URL}/forgot-password`).catch(() => {});

  return (
    // Android draws edge to edge (SDK 57), so the OS no longer resizes the window
    // for the keyboard: pad on both platforms and let the card scroll, or the
    // Sign in / Verify button sits under the keyboard on a small phone.
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: palette.surfaceAlt }} behavior="padding">
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <Animated.View entering={FadeInDown.duration(400)} style={styles.card}>
        <Text variant="title" center>
          {t("app.name")}
        </Text>
        <Text variant="body" tone="muted" center style={{ marginTop: 4, marginBottom: spacing.xl }}>
          {challenge ? t("login.codeSubtitle") : t("login.subtitle")}
        </Text>

        {!challenge ? (
          <>
            <TextInput
              style={styles.input}
              placeholder={t("login.email")}
              placeholderTextColor={palette.faint}
              maxFontSizeMultiplier={fontScale.text}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="emailAddress"
              autoComplete="email"
              returnKeyType="next"
              value={email}
              onChangeText={setEmail}
              onSubmitEditing={() => pwRef.current?.focus()}
              blurOnSubmit={false}
              editable={!busy}
              accessibilityLabel={t("login.email")}
            />
            <View style={styles.pwWrap}>
              <TextInput
                ref={pwRef}
                style={[styles.input, styles.pwInput]}
                placeholder={t("login.password")}
                placeholderTextColor={palette.faint}
                maxFontSizeMultiplier={fontScale.text}
                secureTextEntry={!showPw}
                textContentType="password"
                autoComplete="current-password"
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="go"
                value={password}
                onChangeText={setPassword}
                editable={!busy}
                onSubmitEditing={onPassword}
                accessibilityLabel={t("login.password")}
              />
              <Pressable
                onPress={() => setShowPw((s) => !s)}
                hitSlop={10}
                style={styles.eye}
                accessibilityRole="button"
                accessibilityLabel={showPw ? t("login.hidePassword") : t("login.showPassword")}
              >
                <Feather name={showPw ? "eye-off" : "eye"} size={18} color={palette.muted} />
              </Pressable>
            </View>
          </>
        ) : (
          <>
            <TextInput
              key={backup ? "backup" : "totp"}
              style={styles.input}
              placeholder={backup ? "Backup code" : t("login.code")}
              placeholderTextColor={palette.faint}
              maxFontSizeMultiplier={fontScale.text}
              keyboardType={backup ? "default" : "number-pad"}
              textContentType={backup ? "none" : "oneTimeCode"}
              autoComplete={backup ? "off" : "one-time-code"}
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={backup ? 12 : 6}
              value={code}
              onChangeText={setCode}
              editable={!busy}
              onSubmitEditing={onCode}
              autoFocus
              accessibilityLabel={backup ? "Backup code" : t("login.code")}
            />
            <Pressable
              onPress={() => { setBackup((b) => !b); setCode(""); setError(null); }}
              disabled={busy}
              style={styles.linkBtn}
              accessibilityRole="button"
            >
              <Text variant="label" tone="brand">{backup ? "Use the code from your authenticator app" : "Lost your phone? Use a backup code"}</Text>
            </Pressable>
          </>
        )}

        {error ? (
          <Text variant="label" tone="danger" center style={{ marginBottom: spacing.md }}>
            {error}
          </Text>
        ) : null}

        <Button label={challenge ? t("login.verify") : t("login.signIn")} onPress={challenge ? onCode : onPassword} loading={busy} full />

        {challenge ? (
          <Button
            label={t("login.back")}
            variant="ghost"
            disabled={busy}
            onPress={() => {
              setChallenge(null);
              setCode("");
              setBackup(false);
              setError(null);
            }}
          />
        ) : (
          <Pressable onPress={forgot} style={[styles.linkBtn, { marginTop: spacing.sm }]} accessibilityRole="link">
            <Text variant="label" tone="brand">{t("login.forgot")}</Text>
          </Pressable>
        )}
      </Animated.View>
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, justifyContent: "center", padding: spacing["2xl"], backgroundColor: palette.surfaceAlt },
  card: {
    backgroundColor: palette.surface,
    borderRadius: radius.xl,
    padding: spacing["2xl"],
    shadowColor: palette.shadow,
    shadowOpacity: 0.06,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  input: {
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontSize: fontSize.md,
    marginBottom: spacing.md,
    color: palette.ink,
    backgroundColor: palette.surface,
  },
  pwWrap: { position: "relative" },
  pwInput: { paddingRight: 44 },
  eye: { position: "absolute", right: spacing.xs, top: 0, height: 48, width: 44, alignItems: "center", justifyContent: "center" },
  linkBtn: { alignSelf: "center", minHeight: 44, justifyContent: "center", paddingHorizontal: spacing.sm, marginBottom: spacing.sm },
});
