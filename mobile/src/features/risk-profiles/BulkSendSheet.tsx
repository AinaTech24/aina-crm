/**
 * "Send to all not profiled" — the web's RiskBulkBar. Nothing is sent from the
 * tap: the server first says who would get the email (dryRun) — the channel,
 * the template and its subject, and everyone who will NOT get it and why —
 * and confirming posts the ids back in the server's batch size, with a count.
 */

import React, { useEffect, useRef, useState } from "react";
import { View, ScrollView, ActivityIndicator, StyleSheet, useWindowDimensions } from "react-native";
import { BottomSheet } from "../../components/ui/BottomSheet";
import { Text } from "../../components/ui/Text";
import { Button } from "../../components/ui/Button";
import { toast } from "../../lib/toast";
import { palette, radius, spacing, fontWeight } from "../../theme/tokens";
import { previewSendLink, sendLinkBatch, useRiskRefresh, type SendLinkPreview } from "./api";

const n = (v: number) => v.toLocaleString("en-IN");
const clients = (v: number) => `${n(v)} ${v === 1 ? "client" : "clients"}`;
/** "Hello {{investor.first_name}}" → "Hello [first name]": merge tokens read as code to an RM. */
const readable = (subject: string) =>
  subject.replace(/\{\{\s*(?:[\w]+\.)*([\w]+)\s*\}\}/g, (_, k: string) => `[${k.replace(/_/g, " ")}]`);

export function BulkSendSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { height } = useWindowDimensions();
  const refresh = useRiskRefresh();
  const [preview, setPreview] = useState<SendLinkPreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; of: number } | null>(null);
  const request = useRef(0);
  const sending = progress !== null;

  useEffect(() => {
    if (!visible) return;
    const mine = ++request.current;
    setPreview(null);
    setLoadError(null);
    previewSendLink({ audience: "not_profiled" })
      .then((p) => { if (mine === request.current) setPreview(p); })
      .catch((e: any) => { if (mine === request.current) setLoadError(e?.message ?? "Couldn't work out who would get the email."); });
  }, [visible]);

  const close = () => {
    if (sending) return;
    request.current++;
    onClose();
  };

  async function send() {
    if (!preview || preview.ids.length === 0) return;
    const ids = preview.ids;
    const size = Math.max(1, preview.batchSize);
    let sent = 0, skipped = 0, failed = 0, notSent = 0;
    setProgress({ done: 0, of: ids.length });
    try {
      for (let i = 0; i < ids.length; i += size) {
        const chunk = ids.slice(i, i + size);
        try {
          const j = await sendLinkBatch(chunk);
          sent += Number(j.sent ?? 0);
          skipped += Number(j.skipped ?? 0);
          failed += Array.isArray(j.failed) ? j.failed.length : 0;
          notSent += Number(j.notSent ?? 0);
        } catch (e: any) {
          toast.error(`${e?.message ?? "The send stopped."} ${sent ? `${clients(sent)} had already been emailed.` : "Nothing was sent."}`);
          return;
        }
        setProgress({ done: Math.min(ids.length, i + chunk.length), of: ids.length });
      }
      const extra = [
        skipped ? `${n(skipped)} skipped by consent or compliance checks` : "",
        failed ? `${n(failed)} failed` : "",
        notSent ? `${n(notSent)} no longer eligible` : "",
      ].filter(Boolean);
      if (sent) toast.success(`Emailed the risk profile link to ${clients(sent)}.${extra.length ? ` ${extra.join(", ")}.` : ""}`);
      else toast.error(extra.length ? `${extra.join(", ")}.` : "No emails went out.");
      onClose();
    } finally {
      setProgress(null);
      refresh();
    }
  }

  const problems = preview?.templates.filter((t) => t.problem && t.blocked > 0) ?? [];
  const title = preview
    ? preview.sendable > 0 ? `Email the risk profile link to ${clients(preview.sendable)}?` : "No one here can be emailed yet"
    : "Email every client who is not profiled?";

  return (
    <BottomSheet visible={visible} onClose={close} title={title}>
      <ScrollView style={{ maxHeight: height * 0.62 }} keyboardShouldPersistTaps="handled">
        <Text variant="caption" tone="muted">Each client gets a personal link to the questionnaire. No login needed, valid for 21 days.</Text>

        {!preview && !loadError ? (
          <View style={styles.row}><ActivityIndicator size="small" color={palette.brand} /><Text variant="caption" tone="muted">Checking who will get it…</Text></View>
        ) : null}
        {loadError ? <Text variant="caption" tone="danger" style={{ marginTop: spacing.md }}>{loadError}</Text> : null}

        {preview ? (
          <View style={{ marginTop: spacing.md, gap: spacing.md }}>
            <View>
              <Text variant="label" tone="muted">Channel</Text>
              <Text variant="body" style={{ fontWeight: fontWeight.semibold }}>Email</Text>
            </View>
            <View>
              <Text variant="label" tone="muted">{preview.templates.length > 1 ? "Templates" : "Template"}</Text>
              {preview.templates.length === 0 ? <Text variant="caption" tone="muted">None: no active client selected.</Text> : null}
              {preview.templates.map((t) => (
                <View key={t.key} style={{ marginTop: 2 }}>
                  <Text variant="body" style={{ fontWeight: fontWeight.semibold }}>
                    {t.name}{preview.templates.length > 1 ? <Text variant="caption" tone="muted"> · {clients(t.sending)}</Text> : null}
                  </Text>
                  {t.subject ? <Text variant="caption" tone="muted">Subject: {readable(t.subject)}</Text> : null}
                </View>
              ))}
            </View>

            {preview.noEmail > 0 || preview.recent > 0 || preview.blocked > 0 ? (
              <View style={styles.box}>
                <Text variant="label" style={{ fontWeight: fontWeight.semibold, color: palette.ink }}>Not sent</Text>
                {preview.noEmail > 0 ? (
                  <Text variant="caption" tone="muted">
                    • {clients(preview.noEmail)} with no email on file
                    {preview.noEmailSample.length > 0 ? ` (${preview.noEmailSample.join(", ")}${preview.noEmail > preview.noEmailSample.length ? ", …" : ""})` : ""}
                  </Text>
                ) : null}
                {preview.recent > 0 ? <Text variant="caption" tone="muted">• {clients(preview.recent)} already emailed a link in the last {preview.recentDays} days</Text> : null}
                {problems.map((t) => <Text key={t.key} variant="caption" tone="danger">• {clients(t.blocked)}: {t.problem}</Text>)}
              </View>
            ) : null}

            <Text variant="caption" tone="muted">Consent and compliance checks run on every email; anyone who fails them is skipped and logged.</Text>

            {progress ? (
              <View>
                <View style={styles.track}><View style={[styles.fill, { width: `${Math.round((progress.done / Math.max(1, progress.of)) * 100)}%` }]} /></View>
                <Text variant="caption" tone="muted" style={{ marginTop: 4 }}>Sending… {n(progress.done)} of {n(progress.of)}</Text>
              </View>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
      <View style={styles.actions}>
        <View style={{ flex: 1 }}><Button label="Cancel" variant="secondary" onPress={close} disabled={sending} full /></View>
        <View style={{ flex: 1 }}>
          <Button
            label={preview && preview.sendable > 0 ? `Send ${n(preview.sendable)} ${preview.sendable === 1 ? "email" : "emails"}` : "Send"}
            onPress={send}
            loading={sending}
            disabled={!preview || preview.sendable === 0 || sending}
            full
          />
        </View>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.md },
  box: { backgroundColor: palette.surfaceSunken, borderRadius: radius.md, padding: spacing.md, gap: 4 },
  track: { height: 6, borderRadius: 3, backgroundColor: palette.surfaceSunken, overflow: "hidden" },
  fill: { height: 6, borderRadius: 3, backgroundColor: palette.brand },
  actions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.lg },
});
