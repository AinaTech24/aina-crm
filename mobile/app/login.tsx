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
import { View, TextInput, Pressable, Linking, StyleSheet, KeyboardAvoidingView, Platform } from "react-native";
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
import { palette, radius, spacing, fontSize } from "../src/theme/tokens";

const LAST_EMAIL_KEY = "last_login_email";

export default function Login() {
  const router = useRouter();
  const { t } = useTranslation();
  const signIn = useSession((s) => s.signIn);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [code, setCode] = useState("");
  const [challenge, setChallenge] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pwRef = useRef<TextInput>(null);

  useEffect(() => {
    storageGet(LAST_EMAIL_KEY).then((v) => { if (v) setEmail(v); }).catch(() => {});
  }, []);

  const finish = async (token: string) => {
    storageSet(LAST_EMAIL_KEY, email.trim()).catch(() => {});
    await signIn(token);
    router.replace("/(app)/(tabs)/home");
  };

  const onPassword = async () => {
    if (!email.trim() || !password) return setError(t("login.missing"));
    setBusy(true);
    setError(null);
    const r = await mobileLogin(email.trim(), password);
    setBusy(false);
    if (r.kind === "ok") return finish(r.token);
    if (r.kind === "2fa") return setChallenge(r.challenge);
    setError(r.message);
  };

  const onCode = async () => {
    if (!challenge) return;
    setBusy(true);
    setError(null);
    const r = await mobileVerify2fa(challenge, code.trim());
    setBusy(false);
    if (r.kind === "ok") return finish(r.token);
    setError(r.kind === "error" ? r.message : "Invalid code");
  };

  // Reset lives on the web (it emails a link) — hand off to the same backend.
  const forgot = () => Linking.openURL(`${API_BASE_URL}/forgot-password`).catch(() => {});

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === "ios" ? "padding" : undefined}>
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
          <TextInput
            style={styles.input}
            placeholder={t("login.code")}
            placeholderTextColor={palette.faint}
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChangeText={setCode}
            editable={!busy}
            onSubmitEditing={onCode}
            autoFocus
            accessibilityLabel={t("login.code")}
          />
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
            onPress={() => {
              setChallenge(null);
              setCode("");
              setError(null);
            }}
          />
        ) : (
          <Pressable onPress={forgot} hitSlop={8} style={{ alignSelf: "center", marginTop: spacing.lg }} accessibilityRole="link">
            <Text variant="label" tone="brand">{t("login.forgot")}</Text>
          </Pressable>
        )}
      </Animated.View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", padding: spacing["2xl"], backgroundColor: palette.surfaceAlt },
  card: {
    backgroundColor: palette.surface,
    borderRadius: radius.xl,
    padding: spacing["2xl"],
    shadowColor: palette.ink,
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
  eye: { position: "absolute", right: spacing.md, top: 0, height: 48, justifyContent: "center" },
});
