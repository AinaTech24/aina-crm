import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import React, { useRef, useState } from "react";
import { View, Switch, Platform } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { Card, Text, Button, TextField, SelectField } from "../../components/ui";
import { apiRequest, api, ApiError } from "../../api/client";
import { useFormDraft } from "../../lib/useFormDraft";
import { spacing } from "../../theme/tokens";
import { toast } from "../../lib/toast";
import { errorMessage } from "../../lib/errors";
import { formatSummary, summaryNotes } from "./callSummaryDraft";

const MAX_AUDIO = 12 * 1024 * 1024;
const languageOptions = [{ value: "auto", label: "Auto-detect / mixed languages" }, { value: "en", label: "English" }, { value: "hi", label: "Hindi" }, { value: "gu", label: "Gujarati" }];

export function CallSummary({ activityId, existingNotes, subjectType, subjectId, name }: { activityId: string; existingNotes: string | null; subjectType?: string | null; subjectId?: string | null; name?: string | null }) {
  const local = useFormDraft(`call_summary.${activityId}`, () => ({ text: "", recordingName: "", speechLanguage: "auto" }), true);
  const draft = typeof local.value.text === "string" ? local.value.text : "";
  const speechLanguage = languageOptions.some(o => o.value === local.value.speechLanguage) ? local.value.speechLanguage : "auto";
  const [recording, setRecording] = useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const [consent, setConsent] = useState(false), [busy, setBusy] = useState(false), [saving, setSaving] = useState(false);
  const [error, setError] = useState(""), [followup, setFollowup] = useState("");
  const submission = useRef<{ key: string; body: { notes: string; expectedNotes: string | null } } | null>(null);
  const choosing = useRef(false), generating = useRef(false), saveLock = useRef(false);
  const router = useRouter(), qc = useQueryClient();
  const readiness = useQuery({ queryKey: ["call-summary-ready"], queryFn: () => api.get<{ ready: boolean; safeNotesSave?: boolean; message: string }>("/api/mobile/call-summary"), staleTime: 60_000 });
  const choose = async () => {
    if (choosing.current || busy || saving) return;
    choosing.current = true; setError("");
    try {
      const file = await DocumentPicker.getDocumentAsync({ type: "audio/*", copyToCacheDirectory: true });
      if (file.canceled) return;
      const asset = file.assets[0];
      if (!asset.size || asset.size < 16 || asset.size > MAX_AUDIO) throw new Error("Choose an MP3, WAV, OGG or M4A recording under 12 MB.");
      setRecording(asset); setConsent(false);
      local.setValue(value => ({ ...value, recordingName: asset.name }));
    } catch (e) { setError(errorMessage(e, "Unable to choose a recording")); }
    finally { choosing.current = false; }
  };
  const generate = async () => {
    if (!consent || !recording || !readiness.data?.ready || generating.current || busy || saving) return;
    generating.current = true; setBusy(true); setError("");
    try {
      const form = new FormData();
      form.append("activityId", activityId); form.append("participantConsent", "confirmed"); form.append("speechLanguage", speechLanguage);
      form.append("audio", Platform.OS === "web" ? recording.file! : { uri: recording.uri, name: recording.name, type: recording.mimeType || "audio/mp4" } as any);
      const result = await apiRequest<{ summary: Record<string, string> }>("/api/mobile/call-summary", { method: "POST", form, timeout: 110000 });
      local.setValue(value => ({ ...value, text: formatSummary(result.summary) }));
      submission.current = null; setRecording(null); setConsent(false);
    } catch (e) { setError(errorMessage(e, "Unable to summarize this recording. Your existing draft is preserved.")); }
    finally { generating.current = false; setBusy(false); }
  };
  const complete = async () => {
    setFollowup(draft); submission.current = null;
    try { await local.clear(); }
    catch { toast.info("Summary saved to CRM. The local draft could not be removed."); }
    local.setValue({ text: "", recordingName: "", speechLanguage: "auto" });
    await Promise.all([qc.invalidateQueries({ queryKey: ["activities"] }), qc.invalidateQueries({ queryKey: ["activity", activityId] }), qc.invalidateQueries({ queryKey: ["activity-timeline"] })]);
  };
  const save = async () => {
    if (saveLock.current || !draft.trim()) return;
    saveLock.current = true; setSaving(true); setError("");
    try {
      if (!readiness.data?.safeNotesSave) throw new Error("Your CRM server needs the call-summary update before this draft can be saved. Ask your administrator to deploy it; the draft stays on this phone.");
      if (!submission.current) {
        const latest = await api.get<{ notes: string | null }>(`/api/activities/${activityId}`);
        const next = summaryNotes(latest.notes, draft);
        if (next.alreadySaved) { await complete(); toast.success("Summary already saved to CRM"); return; }
        submission.current = { key: `summary_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`, body: { notes: next.notes, expectedNotes: latest.notes } };
      }
      await api.patch(`/api/activities/${activityId}`, submission.current.body, { headers: { "Idempotency-Key": submission.current.key } });
      await complete(); toast.success("Reviewed summary saved to CRM");
    } catch (e) {
      if (e instanceof ApiError && e.kind === "http" && e.status < 500 && ![408, 425, 429].includes(e.status)) submission.current = null;
      setError(errorMessage(e, "Could not save. Your draft is kept on this phone. Retry when connected."));
    } finally { saveLock.current = false; setSaving(false); }
  };
  return <Card style={{ marginTop: spacing.lg }}>
    <Text variant="subtitle">After-call summary</Text>
    <Text variant="caption" tone="muted" style={{ marginVertical: spacing.sm }}>1. Choose recording · 2. Confirm agreement · 3. Review and save</Text>
    <Text variant="caption" tone="muted">Use a recording created by your phone or recorder. The selected audio is sent to the configured AI service after confirmation. SIM audio is not captured by Aina CRM.</Text>
    <Text tone="muted" style={{ marginVertical: spacing.sm }}>{readiness.isLoading ? "Checking summary service…" : readiness.isError ? "Could not check the summary service. Retry before uploading." : readiness.data?.message}</Text>
    {readiness.isError || !readiness.data?.ready ? <Button label="Check service again" variant="secondary" onPress={() => readiness.refetch()} /> : null}
    {!draft ? <>
      <Button label={recording ? "Change recording" : "Choose call recording"} variant="secondary" disabled={!local.ready || busy || saving || !readiness.data?.ready} onPress={choose} />
      {recording ? <View style={{ marginTop: spacing.md }}>
        <Text variant="body">{recording.name} · {((recording.size || 0) / (1024 * 1024)).toFixed(1)} MB</Text>
        <Text variant="caption" tone="muted">Check this recording belongs to the call with {name || "this contact"}.</Text>
        <SelectField label="Language spoken" value={speechLanguage} options={languageOptions} disabled={busy} onChange={value => local.setValue(v => ({ ...v, speechLanguage: value }))} />
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <Switch value={consent} onValueChange={setConsent} disabled={busy} accessibilityLabel="Participants agreed to recording and AI summarization" />
          <Text variant="caption" style={{ flex: 1 }}>I confirm all participants agreed to recording and AI summarization.</Text>
        </View>
        <Button label="Generate English summary" disabled={!consent || !readiness.data?.ready} loading={busy} onPress={generate} />
      </View> : null}
    </> : <>
      {local.value.recordingName ? <Text variant="caption" tone="muted">Recording: {local.value.recordingName}</Text> : null}
      <TextField disabled={saving || !!submission.current} label="Review amounts, dates and next steps" value={draft} onChangeText={text => local.setValue(v => ({ ...v, text }))} multiline />
      <Text variant="caption" tone="muted">English draft · Nothing is sent to the client or assigned automatically. Saving requires a connection.</Text>
      <Text variant="caption" tone="muted">{draft.length} characters · {(existingNotes?.length || 0) + draft.length + 33} estimated total with current notes (maximum 4,000)</Text>
      <Button label={submission.current ? "Retry saving reviewed summary" : "Save reviewed summary"} loading={saving} disabled={!draft.trim()} onPress={save} />
      {!submission.current ? <Button label="Discard this draft" variant="ghost" disabled={saving} onPress={async () => { try { await local.clear(); local.setValue({ text: "", recordingName: "", speechLanguage: "auto" }); } catch (e) { setError(errorMessage(e)); } }} /> : null}
    </>}
    {busy ? <Text variant="caption" tone="muted">Processing the recording… This can take up to two minutes. Keep this screen open.</Text> : null}
    {local.status ? <Text variant="caption" tone="muted" style={{ marginTop: spacing.sm }}>{local.status}</Text> : null}
    {error ? <Text tone="danger" variant="caption" style={{ marginTop: spacing.sm }}>{error}</Text> : null}
    {followup && subjectId && ["lead", "investor"].includes(subjectType || "") ? <View style={{ marginTop: spacing.md }}><Button label="Create follow-up from saved summary" variant="secondary" onPress={() => router.push({ pathname: "/m/tasks/new", params: { title: `Follow up with ${name || "client"}`, description: `From call ${activityId}\n\n${followup}`, [subjectType === "lead" ? "relatedLeadId" : "relatedInvestorId"]: subjectId } } as any)} /><Text variant="caption" tone="muted">Review the task, choose a date and confirm before creating it.</Text></View> : null}
  </Card>;
}
