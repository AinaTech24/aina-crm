/**
 * The RM's risk questionnaire — the web's RiskProfileWizard: the firm's
 * template one question at a time (the age question answers itself from the
 * date of birth), a review with the live band and score, then the client's
 * sign-off by one of two routes, recorded as what actually happened:
 *
 *   OTP        a code to the client's email, verified on the server → client_otp
 *   signature  the physically signed form, attached               → client_physical
 *
 * The server re-checks both; the button state is convenience, not the gate.
 */

import React, { useEffect, useMemo, useState } from "react";
import { View, ScrollView, Pressable, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { ScreenHeader } from "../../components/ui/ScreenHeader";
import { Card } from "../../components/ui/Card";
import { Text } from "../../components/ui/Text";
import { Button } from "../../components/ui/Button";
import { TextField } from "../../components/ui/TextField";
import { Segmented } from "../../components/ui/Segmented";
import { toast } from "../../lib/toast";
import { fmtDate } from "../../lib/format";
import { palette, radius, spacing, fontWeight } from "../../theme/tokens";
import { ageBandOption, ageFromDob } from "./age-band";
import { scoreAnswersAgainst, templateRange, type RiskTemplate } from "./rules";
import {
  shareRiskPdf, useSaveRiskProfile, useSendRiskOtp, useUploadSignedForm, useVerifyRiskOtp, type PickedFile,
} from "./api";

const MAX_SIGNED_BYTES = 10 * 1024 * 1024;

export function RiskWizard({
  investor,
  template,
}: {
  investor: { id: string; name: string; pan: string | null; dob: string | null };
  template: RiskTemplate;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const questions = template.questions;
  const N = questions.length;
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const dobAge = ageFromDob(investor.dob);
  const [age, setAge] = useState<string>(dobAge != null ? String(dobAge) : "");
  const [remarks, setRemarks] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ id: string } | null>(null);

  // Sign-off
  const [signMode, setSignMode] = useState<"otp" | "signature">("otp");
  const [signatureKey, setSignatureKey] = useState<string | null>(null);
  const [signatureName, setSignatureName] = useState<string | null>(null);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const [otpVerified, setOtpVerified] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [needEmail, setNeedEmail] = useState(false);
  const [otpEmail, setOtpEmail] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [maskedEmail, setMaskedEmail] = useState<string | null>(null);
  const [otpErr, setOtpErr] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);

  const sendOtp = useSendRiskOtp();
  const verifyOtp = useVerifyRiskOtp();
  const uploadSigned = useUploadSignedForm();
  const save = useSaveRiskProfile();

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  // The exact age picks the age answer, matched against the firm's own options.
  useEffect(() => {
    if (!age) return;
    const ageQuestion = questions.find((q) => q.key === "age");
    if (!ageQuestion) return;
    const choice = ageBandOption(Number(age), ageQuestion.options);
    if (choice && answers.age !== choice) setAnswers((prev) => ({ ...prev, age: choice }));
  }, [age, questions, answers.age]);

  const live = useMemo(() => scoreAnswersAgainst(template, answers), [template, answers]);
  const range = useMemo(() => templateRange(template), [template]);

  const onReview = step === N;
  const q = onReview ? null : questions[step];
  const progress = onReview ? 100 : Math.round((step / Math.max(1, N)) * 100);
  const canAdvance = q ? !!answers[q.key] : Object.keys(answers).length === N;
  const signOffReady = signMode === "signature" ? Boolean(signatureKey) : otpVerified;
  const firstName = investor.name.split(" ")[0] || "the client";

  const errText = (e: any, fallback: string) => e?.body?.error ?? e?.message ?? fallback;

  function doSendOtp() {
    setOtpErr(null);
    sendOtp.mutate(
      { investorId: investor.id, email: needEmail ? otpEmail.trim() : undefined },
      {
        onSuccess: (j) => { setOtpSent(true); setMaskedEmail(j.maskedEmail ?? null); setResendIn(Number(j.resendInSeconds ?? 60)); },
        onError: (e: any) => {
          if (e?.body?.needEmail) setNeedEmail(true);
          if (e?.body?.retryInSeconds) setResendIn(Number(e.body.retryInSeconds));
          setOtpErr(errText(e, "Couldn't send the code."));
        },
      },
    );
  }

  function doVerifyOtp() {
    setOtpErr(null);
    verifyOtp.mutate(
      { investorId: investor.id, code: otpCode.trim() },
      {
        onSuccess: () => setOtpVerified(true),
        onError: (e: any) => {
          const remaining = e?.body?.remaining;
          setOtpErr(errText(e, "Verification failed.") + (typeof remaining === "number" ? ` (${remaining} attempt${remaining === 1 ? "" : "s"} left)` : ""));
        },
      },
    );
  }

  function attach(f: PickedFile) {
    setUploadErr(null);
    if (f.size && f.size > MAX_SIGNED_BYTES) { setUploadErr("File must be under 10 MB"); return; }
    uploadSigned.mutate(
      { ...f, clientName: investor.name },
      {
        onSuccess: (key) => { setSignatureKey(key); setSignatureName(f.name); },
        onError: (e: any) => { setSignatureKey(null); setSignatureName(null); setUploadErr(errText(e, "Upload failed")); },
      },
    );
  }

  async function pickFile() {
    const r = await DocumentPicker.getDocumentAsync({ type: ["application/pdf", "image/png", "image/jpeg"], copyToCacheDirectory: true });
    if (r.canceled || !r.assets?.[0]) return;
    const a = r.assets[0];
    attach({ uri: a.uri, name: a.name, mime: a.mimeType ?? "application/pdf", size: a.size ?? null });
  }

  async function takePhoto() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) { setUploadErr("Camera permission is needed to photograph the signed form."); return; }
    const r = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.8 });
    if (r.canceled || !r.assets?.[0]) return;
    const a = r.assets[0];
    attach({ uri: a.uri, name: a.fileName ?? `risk-profile-signed-${Date.now()}.jpg`, mime: a.mimeType ?? "image/jpeg", size: a.fileSize ?? null });
  }

  function submit() {
    setErr(null);
    // Only a valid whole age in range is sent — otherwise it is omitted.
    const numAge = Number(age);
    const ageValue = age !== "" && Number.isFinite(numAge) && numAge >= 1 && numAge <= 120 ? Math.round(numAge) : undefined;
    save.mutate(
      {
        investorId: investor.id,
        age: ageValue,
        answers,
        rmRemarks: remarks.trim() || undefined,
        signedByName: investor.name || undefined,
        signOffMethod: signMode,
        documentUrl: signMode === "signature" ? signatureKey ?? undefined : undefined,
      },
      {
        onSuccess: (j) => {
          toast.success("Risk profile saved");
          setDone({ id: String(j.id) });
        },
        onError: (e: any) => {
          const issues = Array.isArray(e?.body?.issues)
            ? e.body.issues.map((i: any) => (Array.isArray(i.path) ? i.path.join(".") : "")).filter(Boolean).join(", ")
            : "";
          setErr(errText(e, "Submit failed") + (issues ? ` — check: ${issues}` : ""));
        },
      },
    );
  }

  // ── Saved ──
  if (done) {
    return (
      <View style={styles.screen}>
        <ScreenHeader title="Risk profile saved" subtitle={investor.name} />
        <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
          <Card style={{ alignItems: "center", gap: spacing.md, paddingVertical: spacing["2xl"] }}>
            <View style={styles.doneIcon}><Feather name="check-circle" size={28} color={palette.success} /></View>
            <Text variant="body" center>
              <Text variant="body" style={{ color: palette.ink, fontWeight: fontWeight.semibold }}>{investor.name}</Text> is now profiled as{" "}
              <Text variant="body" style={{ color: live.band?.color ?? palette.ink, fontWeight: fontWeight.bold }}>{live.band?.label}</Text> ({live.total}/{range.max}).
            </Text>
          </Card>
          <View style={{ gap: spacing.sm, marginTop: spacing.lg }}>
            <Button
              label="Share PDF"
              icon={<Feather name="share-2" size={15} color={palette.white} />}
              onPress={() => shareRiskPdf(done.id, investor.name).catch((e: any) => toast.error(e?.message ?? "Couldn't open the PDF"))}
              full
            />
            <Button label="Go to client" variant="secondary" onPress={() => router.replace(`/m/investors/${investor.id}` as any)} full />
            <Button label="Back to risk profiles" variant="ghost" onPress={() => router.replace("/m/risk-profiles" as any)} full />
          </View>
        </ScrollView>
      </View>
    );
  }

  const bandColor = live.band?.color ?? palette.info;
  const bandTint = /^#[0-9a-f]{6}$/i.test(bandColor) ? `${bandColor}15` : palette.surfaceSunken;

  return (
    <View style={styles.screen}>
      <ScreenHeader title={template.name} subtitle={onReview ? `${investor.name} · Review` : `${investor.name} · Question ${Math.min(step + 1, N)} of ${N}`} />
      <View style={styles.track}><View style={[styles.fill, { width: `${progress}%` }]} /></View>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }} keyboardShouldPersistTaps="handled">
        {step === 0 && !onReview ? (
          <Text variant="caption" tone="muted" style={{ marginBottom: spacing.md }}>
            Ask {firstName} each question as written and record what they say.
          </Text>
        ) : null}

        {q ? (
          <Card>
            <Text variant="subtitle">{q.label}</Text>
            {q.helperText ? <Text variant="caption" tone="muted" style={{ marginTop: 4 }}>{q.helperText}</Text> : null}
            <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
              {q.options.map((opt) => {
                const selected = answers[q.key] === opt.value;
                return (
                  <Pressable
                    key={opt.value}
                    onPress={() => setAnswers((s) => ({ ...s, [q.key]: opt.value }))}
                    style={[styles.option, selected && styles.optionOn]}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                  >
                    <Text variant="body" style={{ flex: 1, color: palette.ink, fontWeight: fontWeight.medium }}>{opt.label}</Text>
                    {selected ? <Feather name="check-circle" size={18} color={palette.brand} /> : null}
                  </Pressable>
                );
              })}
            </View>
            {q.key === "age" ? (
              <View style={{ marginTop: spacing.lg }}>
                <TextField label="Exact age (optional)" value={age} onChangeText={(v) => setAge(v.replace(/[^\d]/g, ""))} keyboardType="number-pad" placeholder="e.g. 42" />
                <Text variant="caption" tone="muted" style={{ marginTop: -spacing.sm }}>
                  {dobAge != null ? `Filled from the client's date of birth (${fmtDate(investor.dob)}).` : "No date of birth on file."}
                </Text>
              </View>
            ) : null}
          </Card>
        ) : null}

        {onReview ? (
          <View style={{ gap: spacing.md }}>
            <View style={[styles.band, { borderColor: bandColor, backgroundColor: bandTint }]}>
              <View style={{ flex: 1 }}>
                <Text variant="caption" style={{ color: bandColor, fontWeight: fontWeight.semibold }}>Final category</Text>
                <Text variant="title" style={{ color: bandColor }}>{live.band?.label}</Text>
                {live.band?.description ? <Text variant="caption" style={{ color: bandColor }}>{live.band.description}</Text> : null}
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text variant="caption" style={{ color: bandColor, fontWeight: fontWeight.semibold }}>Total score</Text>
                <Text variant="title" style={{ color: bandColor }}>{live.total}/{range.max}</Text>
              </View>
            </View>

            <Card>
              <Text variant="subtitle" style={{ marginBottom: spacing.sm }}>Answer breakdown</Text>
              {live.breakdown.map((b, i) => (
                <Pressable key={b.key} onPress={() => setStep(questions.findIndex((x) => x.key === b.key))} style={[styles.answer, i > 0 && styles.sep]}>
                  <View style={{ flex: 1 }}>
                    <Text variant="body" style={{ color: palette.ink, fontWeight: fontWeight.medium }}>{b.question}</Text>
                    <Text variant="caption" tone="muted">{b.answer}</Text>
                  </View>
                  <View style={styles.scoreChip}><Text variant="caption" style={{ color: palette.ink70, fontWeight: fontWeight.semibold }}>+{b.score}</Text></View>
                </Pressable>
              ))}
            </Card>

            <Card>
              <TextField label="RM remarks" value={remarks} onChangeText={setRemarks} multiline placeholder="Observations, special factors, follow-up needed…" />
            </Card>

            <Card>
              <View style={{ flexDirection: "row", alignItems: "center", marginBottom: spacing.md }}>
                <Text variant="subtitle" style={{ flex: 1 }}>Client sign-off</Text>
                {signOffReady ? <Text variant="caption" tone="success" style={{ fontWeight: fontWeight.semibold }}>Ready</Text> : null}
              </View>
              <Segmented<"otp" | "signature">
                options={[{ key: "otp", label: "Verify with OTP" }, { key: "signature", label: "Upload signature" }]}
                value={signMode}
                onChange={setSignMode}
              />

              {signMode === "signature" ? (
                <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
                  <View style={{ flexDirection: "row", gap: spacing.sm }}>
                    <View style={{ flex: 1 }}><Button label="Choose file" variant="secondary" size="sm" icon={<Feather name="paperclip" size={14} color={palette.ink} />} onPress={pickFile} disabled={uploadSigned.isPending} full /></View>
                    <View style={{ flex: 1 }}><Button label="Take photo" variant="secondary" size="sm" icon={<Feather name="camera" size={14} color={palette.ink} />} onPress={takePhoto} disabled={uploadSigned.isPending} full /></View>
                  </View>
                  {uploadSigned.isPending ? <Text variant="caption" tone="muted">Uploading…</Text> : null}
                  {signatureKey ? <Text variant="caption" tone="success">{signatureName} attached</Text> : null}
                  {uploadErr ? <Text variant="caption" tone="danger">{uploadErr}</Text> : null}
                  <Text variant="caption" tone="muted">
                    Recorded as a physically-signed form. Keep the original — this is the audit evidence, and it is not the same as an OTP-verified confirmation.
                  </Text>
                </View>
              ) : otpVerified ? (
                <Text variant="caption" tone="muted" style={{ marginTop: spacing.md }}>{firstName}'s email is verified — you can now submit the profile.</Text>
              ) : (
                <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
                  <Text variant="caption" tone="muted">
                    For compliance, {firstName} confirms this risk profile with a one-time code sent to their email. Verify to enable submit.
                  </Text>
                  {!otpSent ? (
                    <>
                      {needEmail ? (
                        <TextField label="Client email" value={otpEmail} onChangeText={setOtpEmail} keyboardType="email-address" autoCapitalize="none" placeholder="client@example.com" />
                      ) : null}
                      {otpErr ? <Text variant="caption" tone="danger">{otpErr}</Text> : null}
                      <Button label="Send code" variant="secondary" icon={<Feather name="mail" size={14} color={palette.ink} />} onPress={doSendOtp} loading={sendOtp.isPending} disabled={needEmail && !otpEmail.trim()} full />
                    </>
                  ) : (
                    <>
                      <Text variant="caption" tone="muted">
                        Code sent to <Text variant="caption" style={{ color: palette.ink, fontWeight: fontWeight.semibold }}>{maskedEmail}</Text> — ask the client for it (valid 10 minutes).
                      </Text>
                      <TextField label="6-digit code" value={otpCode} onChangeText={(v) => setOtpCode(v.replace(/\D/g, "").slice(0, 8))} keyboardType="number-pad" placeholder="------" />
                      <View style={{ flexDirection: "row", gap: spacing.sm }}>
                        <View style={{ flex: 1 }}><Button label="Verify" onPress={doVerifyOtp} loading={verifyOtp.isPending} disabled={otpCode.length < 4} full /></View>
                        <View style={{ flex: 1 }}><Button label={resendIn > 0 ? `Resend in ${resendIn}s` : "Resend"} variant="ghost" onPress={doSendOtp} disabled={sendOtp.isPending || resendIn > 0} full /></View>
                      </View>
                      {otpErr ? <Text variant="caption" tone="danger">{otpErr}</Text> : null}
                    </>
                  )}
                </View>
              )}
            </Card>

            {err ? <View style={styles.errBox}><Text variant="caption" tone="danger">{err}</Text></View> : null}
          </View>
        ) : null}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
        <Text variant="caption" tone="muted" center style={{ marginBottom: spacing.sm }}>
          Live score: <Text variant="caption" style={{ color: palette.ink, fontWeight: fontWeight.semibold }}>{live.total}</Text> · <Text variant="caption" style={{ color: live.band?.color ?? palette.ink }}>{live.band?.label}</Text>
        </Text>
        <View style={{ flexDirection: "row", gap: spacing.sm }}>
          <View style={{ flex: 1 }}>
            <Button label="Back" variant="secondary" onPress={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0 || save.isPending} full />
          </View>
          <View style={{ flex: 1.4 }}>
            {onReview ? (
              <Button
                label={save.isPending ? "Saving…" : signOffReady ? "Submit profile" : signMode === "signature" ? "Upload signature to submit" : "Verify email to submit"}
                onPress={submit}
                loading={save.isPending}
                disabled={save.isPending || !canAdvance || !signOffReady}
                full
              />
            ) : (
              <Button label={step === N - 1 ? "Review" : "Next"} onPress={() => setStep((s) => Math.min(N, s + 1))} disabled={!canAdvance} full />
            )}
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.surfaceAlt },
  track: { height: 4, backgroundColor: palette.surfaceSunken },
  fill: { height: 4, backgroundColor: palette.brand },
  option: { flexDirection: "row", alignItems: "center", gap: spacing.sm, borderWidth: 2, borderColor: palette.line, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md, backgroundColor: palette.surface },
  optionOn: { borderColor: palette.brand, backgroundColor: palette.brandLight },
  band: { flexDirection: "row", alignItems: "center", gap: spacing.md, borderWidth: 2, borderRadius: radius.md, padding: spacing.lg },
  answer: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, paddingVertical: spacing.sm },
  sep: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.lineSoft },
  scoreChip: { backgroundColor: palette.surfaceSunken, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  errBox: { backgroundColor: palette.dangerBg, borderRadius: radius.md, padding: spacing.md },
  footer: { padding: spacing.lg, paddingTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.line, backgroundColor: palette.surface },
  doneIcon: { width: 56, height: 56, borderRadius: 28, backgroundColor: palette.successBg, alignItems: "center", justifyContent: "center" },
});
