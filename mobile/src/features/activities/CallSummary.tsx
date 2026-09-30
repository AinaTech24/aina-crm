import React, { useState } from "react";
import { View, Switch, Platform } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { Card, Text, Button, TextField } from "../../components/ui";
import { apiRequest } from "../../api/client";
import { useUpdateActivity } from "./api";
import { spacing } from "../../theme/tokens";
import { toast } from "../../lib/toast";
import { errorMessage } from "../../lib/errors";

export function CallSummary({ activityId, existingNotes }: { activityId: string; existingNotes: string | null }) {
  const [consent, setConsent] = useState(false), [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState(""), [error, setError] = useState("");
  const update = useUpdateActivity(activityId);
  const generate = async () => {
    if (!consent) return;
    setError("");
    try {
      const file = await DocumentPicker.getDocumentAsync({ type: "audio/*", copyToCacheDirectory: true });
      if (file.canceled) return;
      const a = file.assets[0];
      if (!a.size || a.size > 12 * 1024 * 1024) throw new Error("Choose a recording under 12 MB.");
      setBusy(true);
      const form = new FormData();
      form.append("activityId", activityId); form.append("participantConsent", "confirmed");
      form.append("audio", Platform.OS === "web" ? a.file! : { uri: a.uri, name: a.name, type: a.mimeType || "audio/mp4" } as any);
      const result = await apiRequest<{ summary: Record<string, string> }>("/api/mobile/call-summary", { method: "POST", form, timeout: 110000 });
      const labels: Record<string, string> = { discussion: "Discussion", requirements: "Client requirements", products: "Products discussed", objections: "Objections", nextSteps: "Proposed next steps" };
      setDraft(Object.entries(result.summary).map(([k, v]) => `${labels[k] || k}: ${v}`).join("\n\n"));
    } catch (e) { setError(errorMessage(e, "Unable to summarize this recording")); }
    finally { setBusy(false); }
  };
  const save = async () => {
    const notes = [existingNotes, `Reviewed English call summary:\n${draft}`].filter(Boolean).join("\n\n");
    if (notes.length > 4000) return setError("Notes and summary exceed 4,000 characters. Shorten the draft before saving.");
    try { await update.mutateAsync({ notes }); setDraft(""); setConsent(false); toast.success("Summary saved or queued for sync"); }
    catch (e) { setError(errorMessage(e)); }
  };
  return <Card style={{ marginTop: spacing.lg }}>
    <Text variant="subtitle">Call summary</Text>
    <Text variant="caption" tone="muted" style={{ marginVertical: spacing.sm }}>Choose a consented SIM call recording. English, Hindi and Gujarati speech is summarized in English. The recording is sent to the configured AI service.</Text>
    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
      <Switch value={consent} onValueChange={setConsent} disabled={busy} accessibilityLabel="Participants agreed to recording and AI summarization" />
      <Text variant="caption" style={{ flex: 1 }}>I confirm the participants agreed to recording and AI summarization.</Text>
    </View>
    <Button label="Choose recording & summarize" disabled={!consent || busy} loading={busy} onPress={generate} />
    {error ? <Text tone="danger" variant="caption">{error}</Text> : null}
    {draft ? <><TextField label="Review the draft before saving" value={draft} onChangeText={setDraft} multiline />
      <Button label="Save reviewed summary" disabled={!draft.trim()} loading={update.isPending} onPress={save} />
      <Text variant="caption" tone="muted">Create a task or meeting separately after confirming the proposed next steps.</Text></> : null}
  </Card>;
}
