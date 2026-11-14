/**
 * Upload Risk Profile — the web's UploadRiskProfileButton dialog: record a risk
 * profile the client already holds (another distributor, a signed paper form)
 * from its PDF instead of asking again. The category, score and dates are what
 * the document says; the firm's questionnaire is not involved.
 *
 * Shows what the client has now and what this does to it; a minor is sent to
 * the guardian's record (a minor's profile is the guardian's). The server
 * re-checks all of it before storing the file.
 */

import React, { useMemo, useState } from "react";
import { View, ScrollView, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { Card } from "../../components/ui/Card";
import { Text } from "../../components/ui/Text";
import { Button } from "../../components/ui/Button";
import { TextField } from "../../components/ui/TextField";
import { SelectField } from "../../components/ui/SelectField";
import { DateField } from "../../components/form/DateField";
import { toast } from "../../lib/toast";
import { fmtDate } from "../../lib/format";
import { palette, radius, spacing, fontWeight } from "../../theme/tokens";
import { useRiskCurrent, useUploadRiskProfile, type PickedFile } from "./api";
import { CATEGORY_LABEL, MAX_PDF_BYTES, UPLOAD_CATEGORIES, categoryLabel, indiaToday, validateUploadDates } from "./rules";

const plusYear = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return "";
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d.toISOString().slice(0, 10);
};

const OPTIONS = UPLOAD_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABEL[c] }));

export function UploadRiskProfileForm({ client }: { client: { id: string; name: string; pan?: string | null } }) {
  const router = useRouter();
  const today = indiaToday();
  const { data: info } = useRiskCurrent(client.id);
  const upload = useUploadRiskProfile();
  const [category, setCategory] = useState("");
  const [score, setScore] = useState("");
  const [assessedOn, setAssessedOn] = useState(today);
  const [expiresOn, setExpiresOn] = useState(plusYear(today));
  const [expiryTouched, setExpiryTouched] = useState(false);
  const [assessedBy, setAssessedBy] = useState("");
  const [remarks, setRemarks] = useState("");
  const [file, setFile] = useState<PickedFile | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const problems = useMemo(() => {
    const p: string[] = [];
    if (info?.minorOf) p.push(`A minor's risk profile is the guardian's — upload it on ${info.minorOf}'s record.`);
    if (!category) p.push("Choose the risk profile.");
    if (score.trim() === "" || !/^\d+$/.test(score.trim())) p.push("Enter the risk score as a whole number.");
    if (!assessedOn) p.push("Enter the date it was assessed.");
    if (!expiresOn) p.push("Enter the Expire On date.");
    if (assessedOn && expiresOn) {
      const dateErr = validateUploadDates(assessedOn, expiresOn, today);
      if (dateErr) p.push(dateErr);
    }
    if (!file) p.push("Attach the risk profile PDF.");
    return p;
  }, [info, category, score, assessedOn, expiresOn, file, today]);

  function changeAssessed(v: string) {
    setAssessedOn(v);
    // Expire On follows Assessed On (a year later) until it is set by hand.
    if (!expiryTouched) setExpiresOn(plusYear(v));
  }

  async function pickPdf() {
    setErr(null);
    const r = await DocumentPicker.getDocumentAsync({ type: ["application/pdf"], copyToCacheDirectory: true });
    if (r.canceled || !r.assets?.[0]) return;
    const a = r.assets[0];
    if (a.size && a.size > MAX_PDF_BYTES) { setErr(`That file is larger than ${MAX_PDF_BYTES / 1024 / 1024} MB.`); return; }
    if ((a.mimeType ?? "") !== "application/pdf" && !/\.pdf$/i.test(a.name)) { setErr("Only a PDF can be uploaded."); return; }
    setFile({ uri: a.uri, name: a.name, mime: "application/pdf", size: a.size ?? null });
  }

  function submit() {
    if (problems.length || !file) return;
    setErr(null);
    upload.mutate(
      {
        investorId: client.id,
        category,
        score: score.trim(),
        assessedOn,
        expiresOn,
        assessedBy: assessedBy.trim() || undefined,
        remarks: remarks.trim() || undefined,
        file,
      },
      {
        onSuccess: (j) => {
          toast.success(
            j.becameCurrent
              ? `${client.name}'s risk profile is recorded${j.alreadyExpired ? " — it has already expired" : ""}.`
              : `Saved to ${client.name}'s history — a newer profile is already current.`,
          );
          router.back();
        },
        onError: (e: any) => setErr(e?.body?.error ?? e?.message ?? "Upload failed"),
      },
    );
  }

  const cur = info?.current;

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing["3xl"] }} keyboardShouldPersistTaps="handled">
      <Card>
        <Text variant="subtitle">{client.name}</Text>
        {client.pan ? <Text variant="caption" tone="muted">{client.pan}</Text> : null}
        {info?.minorOf ? (
          <View style={[styles.note, { backgroundColor: palette.warningBg }]}>
            <Feather name="alert-triangle" size={14} color={palette.warning} />
            <Text variant="caption" style={{ flex: 1, color: palette.ink70 }}>
              {info.name} is a minor: their risk profile is the guardian's. Upload it on <Text variant="caption" style={{ fontWeight: fontWeight.bold, color: palette.ink }}>{info.minorOf}</Text>'s record.
            </Text>
          </View>
        ) : info ? (
          <View style={styles.note}>
            <Feather name="info" size={14} color={palette.muted} />
            <Text variant="caption" tone="muted" style={{ flex: 1 }}>
              {cur
                ? `Now: ${categoryLabel(cur.category)}${cur.score != null ? ` · score ${cur.score}` : ""}${cur.provisional ? " · suggested from age, not confirmed" : cur.signedAt ? ` · signed ${fmtDate(cur.signedAt)}` : ""}${cur.expiresOn && !cur.provisional ? ` · expires ${fmtDate(cur.expiresOn)}` : ""}. This upload becomes the current profile; the earlier one stays in the history.`
                : "No risk profile on record yet — this will be the client's current one."}
            </Text>
          </View>
        ) : null}
      </Card>

      <Card style={{ marginTop: spacing.md }}>
        <SelectField label="Risk Profile" value={category || null} options={OPTIONS} onChange={setCategory} required />
        <TextField label="Risk score" value={score} onChangeText={(v) => setScore(v.replace(/[^\d]/g, ""))} keyboardType="number-pad" required />
        <DateField label="Assessed on" value={assessedOn} onChange={changeAssessed} max={today} required />
        <DateField label="Expire On" value={expiresOn} onChange={(v) => { setExpiryTouched(true); setExpiresOn(v); }} required />
        <TextField label="Assessed by" value={assessedBy} onChangeText={setAssessedBy} placeholder="Distributor or adviser" autoCapitalize="words" />
        <TextField label="Remarks" value={remarks} onChangeText={setRemarks} multiline />

        <Text variant="label" tone="muted" style={{ marginBottom: spacing.xs }}>Risk profile PDF <Text style={{ color: palette.danger }}>*</Text></Text>
        <Button
          label={file ? file.name : "Choose PDF"}
          variant="secondary"
          icon={<Feather name={file ? "file-text" : "paperclip"} size={14} color={palette.ink} />}
          onPress={pickPdf}
          full
        />
      </Card>

      {err ? <View style={[styles.note, { backgroundColor: palette.dangerBg, marginTop: spacing.md }]}><Text variant="caption" tone="danger">{err}</Text></View> : null}
      {problems.length > 0 && !info?.minorOf ?<Text variant="caption" tone="muted" style={{ marginTop: spacing.md }}>{problems[0]}</Text> : null}

      <View style={{ marginTop: spacing.lg }}>
        <Button
          label="Upload"
          icon={<Feather name="upload" size={15} color={palette.white} />}
          onPress={submit}
          loading={upload.isPending}
          disabled={problems.length > 0 || upload.isPending}
          full
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  note: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, backgroundColor: palette.surfaceSunken, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.md },
});
