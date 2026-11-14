/**
 * Step 4 — Send (web ProposalBuilder step 4 + SendChannels).
 *
 * Validity, then the suitability note (drafted for the RM from the earlier
 * steps — they read it and make it theirs), then what still stops a send.
 * With nothing in the way: email / WhatsApp / a link. Picking one SAVES the
 * proposal and shows exactly what goes (the send route's preview — nothing is
 * sent or changed); only the RM's tap on Send sends it.
 */

import React from "react";
import { View, ScrollView, Linking, Share, StyleSheet, ActivityIndicator } from "react-native";
import { Feather } from "@expo/vector-icons";
import { Card } from "../../../components/ui/Card";
import { Text } from "../../../components/ui/Text";
import { Button } from "../../../components/ui/Button";
import { TextField } from "../../../components/ui/TextField";
import { DateField } from "../../../components/form/DateField";
import { SendFormSheet } from "../../client-forms/SendFormSheet";
import { api } from "../../../api/client";
import { stripHtml, describeError, useRefreshProposals, type ProposalSnapshot, type SendChannel, type SendPreview, type SendResult } from "../api";
import { Banner, CardHeader, proposalStyles } from "../ui";
import { toast } from "../../../lib/toast";
import { fmtDate } from "../../../lib/format";
import { spacing, palette, radius, fontWeight } from "../../../theme/tokens";

export function SendStep({
  name, snapshot, locked, validUntil, setValidUntil, note, setNote, blockers, riskBlocked, persist, onSent, err,
}: {
  name: string;
  snapshot: ProposalSnapshot | null | undefined;
  locked: boolean;
  validUntil: string;
  setValidUntil: (d: string) => void;
  note: string;
  setNote: (s: string) => void;
  blockers: string[];
  /** A mutual fund proposal without the client's confirmed risk profile. */
  riskBlocked: boolean;
  persist: () => Promise<string | null>;
  onSent: (id: string) => void;
  err: React.ReactNode;
}) {
  const first = name.split(" ")[0] || "the client";
  const [linkOpen, setLinkOpen] = React.useState(false);
  const canLink = !!snapshot && !snapshot.riskExempt;

  return (
    <Card style={proposalStyles.card}>
      <CardHeader title="Send" />
      {locked ? (
        <Text variant="body" style={{ marginBottom: spacing.lg }}>Valid until {validUntil ? fmtDate(validUntil) : "—"}</Text>
      ) : (
        <DateField label="Valid until" value={validUntil} onChange={setValidUntil} />
      )}
      <TextField
        label={`Why this suits ${first}`}
        required
        value={note}
        onChangeText={(v) => setNote(v.slice(0, 2000))}
        multiline
        disabled={locked}
        placeholder="e.g. 15-year retirement goal; equity within the client's aggressive band; discussed the volatility."
      />
      {snapshot && !snapshot.hasEmail && !snapshot.hasPhone ? (
        <Banner tone="warning"><Text variant="caption" style={{ color: palette.ink }}>{name} has no email or phone on file — only a link can reach them.</Text></Banner>
      ) : null}
      {err}
      {blockers.length > 0 ? (
        <View style={{ gap: 4, marginBottom: spacing.md }}>
          {blockers.map((b) => <Text key={b} variant="caption" tone="danger">{b}</Text>)}
          {riskBlocked && canLink ? (
            <Button label="Send risk profile link" size="sm" variant="secondary" icon={<Feather name="link" size={14} color={palette.ink} />} onPress={() => setLinkOpen(true)} style={{ marginTop: spacing.sm, alignSelf: "flex-start" }} />
          ) : null}
        </View>
      ) : !locked ? (
        <SendChannels firstName={first} hasEmail={!!snapshot?.hasEmail} hasPhone={!!snapshot?.hasPhone} persist={persist} onSent={onSent} onRiskLink={canLink ? () => setLinkOpen(true) : undefined} />
      ) : null}
      <Text variant="caption" tone="muted" style={{ marginTop: spacing.sm }}>Sending marks it Proposal Sent and sets you a follow-up; you'll see when it is opened.</Text>
      {canLink && snapshot ? <SendFormSheet visible={linkOpen} onClose={() => setLinkOpen(false)} subjectType={snapshot.kind} subjectId={snapshot.subjectId} name={snapshot.name} /> : null}
    </Card>
  );
}

const CHANNELS: Array<{ key: SendChannel; label: string; icon: React.ComponentProps<typeof Feather>["name"] }> = [
  { key: "email", label: "Email", icon: "mail" },
  { key: "whatsapp", label: "WhatsApp", icon: "message-circle" },
  { key: "link", label: "Link", icon: "link" },
];

/**
 * The three ways out. Picking one saves the proposal and shows exactly what
 * goes (POST /send with preview); the button then sends it: email from the
 * firm's mailbox with the PDF attached, WhatsApp through the RM's own
 * WhatsApp (wa.me), or the client's proposal link to share.
 */
function SendChannels({ firstName, hasEmail, hasPhone, persist, onSent, onRiskLink }: {
  firstName: string;
  hasEmail: boolean;
  hasPhone: boolean;
  persist: () => Promise<string | null>;
  onSent: (id: string) => void;
  onRiskLink?: () => void;
}) {
  const [channel, setChannel] = React.useState<SendChannel | null>(null);
  const [preview, setPreview] = React.useState<SendPreview | null>(null);
  const [busy, setBusy] = React.useState<"preview" | "send" | null>(null);
  const [error, setError] = React.useState<{ message: string; field?: string } | null>(null);
  const [sentLink, setSentLink] = React.useState<{ id: string; url: string } | null>(null);
  const [id, setId] = React.useState<string | null>(null);
  const refresh = useRefreshProposals(id ?? undefined);

  const fail = (e: any, fallback: string) => setError({ message: describeError(e, fallback), field: e?.body?.field });

  const pick = async (next: SendChannel) => {
    setChannel(next);
    setPreview(null);
    setError(null);
    setBusy("preview");
    try {
      const pid = await persist();
      if (!pid) { setChannel(null); return; }
      setId(pid);
      setPreview(await api.post<SendPreview>(`/api/proposals/${pid}/send`, { channel: next, preview: true }));
    } catch (e: any) {
      fail(e, "Couldn't prepare the message.");
      setChannel(null);
    } finally {
      setBusy(null);
    }
  };

  const send = async () => {
    if (!channel) return;
    setBusy("send");
    setError(null);
    try {
      const pid = await persist();
      if (!pid) return;
      const r = await api.post<SendResult>(`/api/proposals/${pid}/send`, { channel });
      refresh();
      if (channel === "whatsapp" && r.waUrl) {
        Linking.openURL(r.waUrl).catch(() => {});
        toast.success("WhatsApp opened with the message — press send there");
        onSent(pid);
      } else if (channel === "link" && r.url) {
        setSentLink({ id: pid, url: r.url });
        Share.share({ message: r.url }).catch(() => {});
      } else {
        toast.success(`Emailed to ${firstName}, with the PDF attached`);
        onSent(pid);
      }
    } catch (e: any) {
      fail(e, "Couldn't send the proposal.");
    } finally {
      setBusy(null);
    }
  };

  if (sentLink) {
    return (
      <Banner tone="success">
        <Text variant="caption" style={{ color: palette.ink, fontWeight: fontWeight.semibold }}>Proposal marked sent. Share this link with {firstName}:</Text>
        <Text variant="caption" selectable style={{ color: palette.ink70 }}>{sentLink.url}</Text>
        <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm }}>
          <Button label="Share link" size="sm" variant="secondary" icon={<Feather name="share-2" size={14} color={palette.ink} />} onPress={() => Share.share({ message: sentLink.url }).catch(() => {})} />
          <Button label="Done" size="sm" onPress={() => onSent(sentLink.id)} />
        </View>
      </Banner>
    );
  }

  return (
    <View style={{ gap: spacing.md }}>
      <View style={{ flexDirection: "row", gap: spacing.sm }} accessibilityLabel="How to send">
        {CHANNELS.map((o) => {
          const off = (o.key === "email" && !hasEmail) || (o.key === "whatsapp" && !hasPhone);
          const on = channel === o.key;
          return (
            <View key={o.key} style={{ flex: 1 }}>
              <Button
                label={o.label}
                size="sm"
                variant={on ? "primary" : "secondary"}
                disabled={off || busy !== null}
                accessibilityLabel={off ? `${o.label} — no ${o.key === "email" ? "email" : "phone"} on file` : o.label}
                icon={<Feather name={o.icon} size={14} color={on ? palette.white : palette.ink} />}
                onPress={() => pick(o.key)}
                style={{ paddingHorizontal: spacing.xs }}
              />
            </View>
          );
        })}
      </View>
      {!hasEmail || !hasPhone ? (
        <Text variant="caption" tone="muted">{!hasEmail && !hasPhone ? "No email or phone on file." : !hasEmail ? "No email on file." : "No phone on file."}</Text>
      ) : null}

      {busy === "preview" ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <ActivityIndicator size="small" color={palette.muted} />
          <Text variant="caption" tone="muted">Preparing the message…</Text>
        </View>
      ) : null}

      {error ? (
        <Banner tone="danger">
          <Text variant="caption" style={{ color: palette.danger }}>{error.message}</Text>
          {error.field === "riskProfile" && onRiskLink ? <Text variant="caption" tone="brand" onPress={onRiskLink}>Send the client the risk profile link</Text> : null}
          {error.field === "suitabilityOverrideReason" ? <Text variant="caption" tone="muted">Only the firm's owner can override this, with a documented reason, on the proposal page.</Text> : null}
        </Banner>
      ) : null}

      {preview && channel ? (
        <View style={{ gap: spacing.sm }}>
          {preview.to ? <Text variant="caption" tone="muted">To {preview.to}{preview.subject ? ` · ${preview.subject}` : ""}</Text> : null}
          <ScrollView style={styles.preview} nestedScrollEnabled>
            <Text variant="caption" style={{ color: palette.ink, lineHeight: 19 }}>{preview.text ?? stripHtml(preview.html)}</Text>
          </ScrollView>
          {preview.attachment ? <Text variant="caption" tone="muted">Attached: {preview.attachment}</Text> : null}
          <Button
            label={channel === "email" ? "Send email" : channel === "whatsapp" ? "Open WhatsApp and send" : "Mark sent and share link"}
            loading={busy === "send"}
            disabled={busy !== null}
            onPress={send}
            full
            icon={<Feather name={channel === "link" ? "share-2" : "send"} size={15} color={palette.white} />}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  preview: { maxHeight: 280, padding: spacing.md, borderRadius: radius.md, backgroundColor: palette.surfaceSunken, borderWidth: 1, borderColor: palette.line },
});
