/**
 * A proposal — the live CRM's proposal page (web dashboard/proposals/[id]).
 *
 *  - The hero, the four figures, then one card: who it goes to and how to
 *    reach them, the record (Download PDF, Edit while a draft / Revise once
 *    sent), then the next step — send while it is a draft, record the
 *    client's answer once it has gone.
 *  - Send is the RM's own tap: WhatsApp, email or a link, previewed first (a
 *    preview changes nothing). The server's gates answer 412 and the screen
 *    says what to do: the risk profile link, the suitability note (asked for
 *    and saved, then the preview again), or the owner's override.
 *  - Once sent its content is frozen — Revise makes a new version.
 *  - "Client accepted" asks first: the lead becomes Won and onboarding starts.
 *  - Then what the client did (timeline), versions, cover letter, Suitability
 *    & Compliance, the products and any extra disclosure.
 */

import React from "react";
import { View, Linking, Share, StyleSheet, ScrollView, Alert } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { Screen } from "../../../../src/components/ui/Screen";
import { Card } from "../../../../src/components/ui/Card";
import { Text } from "../../../../src/components/ui/Text";
import { Button } from "../../../../src/components/ui/Button";
import { StatusPill } from "../../../../src/components/ui/StatusPill";
import { Skeleton } from "../../../../src/components/ui/Skeleton";
import { ScreenHeader } from "../../../../src/components/ui/ScreenHeader";
import { TextField } from "../../../../src/components/ui/TextField";
import { BottomSheet } from "../../../../src/components/ui/BottomSheet";
import { DateField } from "../../../../src/components/form/DateField";
import { ErrorState } from "../../../../src/components/states";
import { SendFormSheet } from "../../../../src/features/client-forms/SendFormSheet";
import { useMe, hasCap } from "../../../../src/api/me";
import {
  useProposal, useProposals, useUpdateProposal, useSendProposal, useCancelProposal, useReviseProposal, useRecipientSnapshot,
  num, describeError, isDraft, isCancelled, pastValidity, phoneOk, formatPhone, stripHtml,
  CLOSED_FOR_SEND, AWAITING_CLIENT, REVISABLE, STATUS_LABEL, STATUS_TONE, TYPE_LABEL,
  type SendChannel, type SendPreview,
} from "../../../../src/features/proposals/api";
import { draftSuitabilityNote } from "../../../../src/features/proposals/shared/suitability-note";
import type { ClientProfile } from "../../../../src/features/proposals/shared/risk-alignment";
import { downloadProposalPdf } from "../../../../src/features/proposals/pdf";
import { Banner, CardHeader, proposalStyles } from "../../../../src/features/proposals/ui";
import { ProposalTimeline } from "../../../../src/features/proposals/page/Timeline";
import { SuitabilityPanel } from "../../../../src/features/proposals/page/SuitabilityPanel";
import { ProductList } from "../../../../src/features/proposals/page/Products";
import { confirmDelete } from "../../../../src/lib/confirm";
import { toast } from "../../../../src/lib/toast";
import { inr, fmtDate, titleCase } from "../../../../src/lib/format";
import { spacing, palette, radius, fontWeight } from "../../../../src/theme/tokens";

const CHANNEL_LABEL: Record<SendChannel, string> = { whatsapp: "WhatsApp", email: "Email", link: "Link" };

export default function ProposalPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const pid = String(id);
  const { data: p, isLoading, isError, refetch, isRefetching } = useProposal(pid);
  const { data: me } = useMe();
  const all = useProposals();
  const update = useUpdateProposal(pid);
  const { preview, send } = useSendProposal(pid);
  const cancel = useCancelProposal();
  const revise = useReviseProposal(pid);
  const snap = useRecipientSnapshot(p ? (p.investorId ? { investorId: p.investorId } : p.familyId ? { familyId: p.familyId } : { leadId: p.leadId }) : null);

  const [previewing, setPreviewing] = React.useState<SendPreview | null>(null);
  const [gate, setGate] = React.useState<null | { field: string; message: string; summary?: string }>(null);
  const [noteFor, setNoteFor] = React.useState<SendChannel | null>(null);
  const [riskFormOpen, setRiskFormOpen] = React.useState(false);
  const [declineOpen, setDeclineOpen] = React.useState(false);
  const [validityOpen, setValidityOpen] = React.useState(false);
  const [pdfBusy, setPdfBusy] = React.useState(false);

  if (isLoading || !p) {
    return (
      <View style={{ flex: 1, backgroundColor: palette.surfaceAlt }}>
        <ScreenHeader title="Proposal" />
        {isError ? <ErrorState message="This proposal could not be loaded." onRetry={() => refetch()} /> : (
          <View style={{ padding: spacing.lg }}><Skeleton width="100%" height={120} /><Skeleton width="100%" height={80} style={{ marginTop: spacing.md }} /></View>
        )}
      </View>
    );
  }

  const caps = me?.capabilities;
  const canWrite = hasCap(caps, "proposal.write");
  const canSendCap = hasCap(caps, "proposal.send");
  const sendable = canSendCap && !CLOSED_FOR_SEND.has(p.status);
  const draft = isDraft(p.status);
  const expired = pastValidity(p) && !CLOSED_FOR_SEND.has(p.status);
  const versions = (all.data ?? []).filter((v) => v.proposalNumber === p.proposalNumber).sort((a, b) => (a.version ?? 1) - (b.version ?? 1));
  const latest = versions[versions.length - 1];
  const firstName = String(p.recipientName ?? "").split(" ")[0] || "The client";
  const phone = String(p.recipientPhone ?? "").trim();
  const vLabel = (p.version ?? 1) > 1 || versions.length > 1 ? ` · v${p.version ?? 1}` : "";
  const s = snap.data;
  // The note drafted from this proposal and the client's CONFIRMED risk profile.
  const suggestedNote = draftSuitabilityNote({
    clientName: String(p.recipientName ?? ""),
    riskProfile: s?.risk.status === "Completed" ? s.risk.category : null,
    goals: s?.goals ?? [],
    items: p.products ?? [],
  });
  const riskSubject = s && !s.riskExempt ? { type: s.kind, id: s.subjectId } : p.investorId ? { type: "investor" as const, id: p.investorId } : p.leadId ? { type: "lead" as const, id: p.leadId } : null;

  /** A refused preview or send: say what stands in the way, and how to clear it. */
  const onGate = (e: any, channel: SendChannel) => {
    const field = e?.body?.field as string | undefined;
    const msg = describeError(e, "Couldn't send the proposal");
    if (e?.status === 412 && field === "suitabilityNote") { setGate(null); setNoteFor(channel); return; }
    if (e?.status === 412 && field) { setGate({ field, message: msg, summary: e?.body?.alignment?.summary }); return; }
    if (e?.status === 409 && pastValidity(p)) { toast.error(msg); setValidityOpen(true); return; }
    const findings = Array.isArray(e?.body?.findings) ? e.body.findings.map((f: any) => f?.message ?? f?.rule).filter(Boolean) : [];
    toast.error(findings.length ? `${msg} — ${findings.join("; ")}` : msg);
  };

  const startSend = async (channel: SendChannel) => {
    setGate(null);
    try { setPreviewing(await preview.mutateAsync(channel)); } catch (e) { onGate(e, channel); }
  };
  const confirmSend = async () => {
    if (!previewing) return;
    const channel = previewing.channel;
    try {
      const r = await send.mutateAsync(channel);
      setPreviewing(null);
      if (r.waUrl) Linking.openURL(r.waUrl).catch(() => {});
      if (r.url) Share.share({ message: r.url }).catch(() => {});
      toast.success(channel === "whatsapp" ? "WhatsApp opened — review and tap Send." : channel === "email" ? "Proposal emailed to the client with the PDF attached." : "Link ready — share it with the client");
    } catch (e) { setPreviewing(null); onGate(e, channel); }
  };

  const markSent = () => Alert.alert("Record it as sent?", "Nothing goes to the client from here — use this when you gave it in person or by your own email.", [
    { text: "Cancel", style: "cancel" },
    { text: "Mark as sent", onPress: () => update.mutate({ status: "sent" }, { onSuccess: () => toast.success("Proposal marked as sent.") }) },
  ]);
  const accept = () => Alert.alert(
    `Mark ${p.proposalNumber} accepted?`,
    "The lead becomes Won and the client is sent the document checklist to start onboarding.",
    [{ text: "Cancel", style: "cancel" }, { text: "Yes, client accepted", onPress: () => update.mutate({ status: "accepted" }, { onSuccess: () => toast.success("Proposal marked accepted.") }) }],
  );
  const doRevise = () => Alert.alert(`Revise — create v${(p.version ?? 1) + 1}?`, "The sent version is kept as the record of what the client saw; its link is withdrawn.", [
    { text: "Cancel", style: "cancel" },
    { text: "Revise", onPress: () => revise.mutate(undefined, { onSuccess: (r) => { toast.success(`Version ${r.version} created — the old link is withdrawn.`); router.replace(`/m/proposals/new?editId=${r.id}` as any); } }) },
  ]);
  const remove = () => confirmDelete({ title: "Cancel this proposal?", message: "It is withdrawn and moves to Rejected.", confirmLabel: "Cancel proposal" }, () => {
    cancel.mutate(pid, { onSuccess: () => { toast.success("Proposal cancelled"); router.back(); } });
  });
  const downloadPdf = async () => {
    setPdfBusy(true);
    try { await downloadProposalPdf(p.id, p.proposalNumber); } catch (e: any) { toast.error(e?.message ?? "Couldn't download the PDF"); } finally { setPdfBusy(false); }
  };

  const invest = num(p.totalInvestment);
  const corpus = num(p.expectedCorpus);

  return (
    <View style={{ flex: 1, backgroundColor: palette.surfaceAlt }}>
      <ScreenHeader title={`${p.proposalNumber}${vLabel}`} />
      <Screen scroll padded contentStyle={{ paddingTop: spacing.lg, paddingBottom: spacing["3xl"] }} refreshing={isRefetching} onRefresh={() => { refetch(); snap.refetch(); }}>
        {/* Hero */}
        <View style={styles.hero}>
          <Text variant="caption" style={{ color: "rgba(255,255,255,0.75)", letterSpacing: 1.2, fontWeight: fontWeight.semibold }}>{p.proposalNumber}{vLabel}</Text>
          <Text variant="title" style={{ color: palette.white, marginTop: 4 }}>{p.title}</Text>
          <Text variant="caption" style={{ color: "rgba(255,255,255,0.88)", marginTop: 4 }}>
            {[TYPE_LABEL[p.type] ?? titleCase(p.type), `For ${p.recipientName}`, p.validUntil ? `Valid till ${fmtDate(p.validUntil)}` : null].filter(Boolean).join("  ·  ")}
          </Text>
          <View style={{ marginTop: spacing.md }}><StatusPill label={STATUS_LABEL[p.status] ?? titleCase(p.status)} tone={STATUS_TONE[p.status] ?? "neutral"} size="sm" /></View>
        </View>

        {p.status === "superseded" && latest && latest.id !== p.id ? (
          <Banner onPress={() => router.replace(`/m/proposals/${latest.id}` as any)}>
            <Text variant="caption" style={{ color: palette.ink }}>This is version {p.version ?? 1}. It was replaced by version {latest.version}, and its client link was withdrawn.</Text>
            <Text variant="caption" tone="brand">Open version {latest.version}</Text>
          </Banner>
        ) : null}
        {expired && canWrite ? (
          <Banner tone="warning" onPress={() => setValidityOpen(true)}>
            <Text variant="caption" style={{ color: palette.ink }}>Its validity ended on {fmtDate(p.validUntil)} — it can't be sent until you extend it.</Text>
            <Text variant="caption" tone="brand">Extend validity</Text>
          </Banner>
        ) : null}

        {/* KPIs */}
        <View style={styles.kpis}>
          <Kpi label="Total investment" value={invest > 0 ? inr(invest) : "—"} />
          <Kpi label="Projected corpus" value={corpus > 0 ? inr(corpus) : "—"} tint={palette.success} />
          <Kpi label="Risk rating" value={p.riskRating ? titleCase(p.riskRating) : "—"} />
          <Kpi label="Recommendations" value={String(p.products.length)} />
        </View>

        {/* Who it goes to, the record, the next step */}
        <Card style={proposalStyles.card}>
          <Text variant="subtitle">To {p.recipientName}</Text>
          <View style={{ marginTop: spacing.xs, gap: 4 }}>
            <View style={styles.contact}>
              <Feather name="phone" size={13} color={palette.muted} />
              {phone ? <Text variant="caption" style={{ color: palette.ink }}>{formatPhone(phone)}</Text> : <Text variant="caption" tone="muted">No mobile on file</Text>}
              {phone && !phoneOk(phone) ? <StatusPill size="sm" tone="warning" label="Check number" /> : null}
            </View>
            <View style={styles.contact}>
              <Feather name="mail" size={13} color={palette.muted} />
              {p.recipientEmail ? <Text variant="caption" style={{ color: palette.ink, flexShrink: 1 }}>{p.recipientEmail}</Text> : <Text variant="caption" tone="muted">No email on file</Text>}
            </View>
          </View>
          <View style={styles.actions}>
            <Button label="Download PDF" size="sm" variant="secondary" loading={pdfBusy} icon={<Feather name="download" size={14} color={palette.ink} />} onPress={downloadPdf} />
            {canWrite && draft ? <Button label="Edit" size="sm" variant="secondary" icon={<Feather name="edit-2" size={14} color={palette.ink} />} onPress={() => router.push(`/m/proposals/new?editId=${p.id}` as any)} /> : null}
            {canWrite && REVISABLE.has(p.status) ? (
              <Button label={`Revise (creates v${(p.version ?? 1) + 1})`} size="sm" variant={p.status === "changes_requested" ? "primary" : "secondary"} loading={revise.isPending}
                icon={<Feather name="git-branch" size={14} color={p.status === "changes_requested" ? palette.white : palette.ink} />} onPress={doRevise} />
            ) : null}
          </View>
          {sendable || (canWrite && (draft || AWAITING_CLIENT.has(p.status))) ? (
            <View style={styles.divider}>
              {sendable ? (
                <View style={styles.actions}>
                  <Button label="Send via WhatsApp" size="sm" variant={draft ? "primary" : "secondary"} disabled={!phone || preview.isPending} loading={preview.isPending && preview.variables === "whatsapp"}
                    icon={<Feather name="message-circle" size={14} color={draft ? palette.white : palette.ink} />} onPress={() => startSend("whatsapp")} accessibilityLabel={phone ? "Send via WhatsApp" : "Send via WhatsApp — no mobile number on file"} />
                  <Button label="Send via Email" size="sm" variant="secondary" disabled={!p.recipientEmail || preview.isPending} loading={preview.isPending && preview.variables === "email"}
                    icon={<Feather name="mail" size={14} color={palette.ink} />} onPress={() => startSend("email")} accessibilityLabel={p.recipientEmail ? "Send via Email" : "Send via Email — no email on file"} />
                  <Button label="Link" size="sm" variant="secondary" disabled={preview.isPending} loading={preview.isPending && preview.variables === "link"}
                    icon={<Feather name="link" size={14} color={palette.ink} />} onPress={() => startSend("link")} />
                </View>
              ) : null}
              {canWrite ? (
                <View style={styles.actions}>
                  {draft ? <Button label="Mark as Sent" size="sm" variant="ghost" icon={<Feather name="send" size={14} color={palette.brandDark} />} onPress={markSent} /> : null}
                  {AWAITING_CLIENT.has(p.status) ? (
                    <>
                      <Button label="Mark Accepted" size="sm" variant={p.status === "changes_requested" ? "secondary" : "primary"} loading={update.isPending && update.variables?.status === "accepted"}
                        icon={<Feather name="check-circle" size={14} color={p.status === "changes_requested" ? palette.ink : palette.white} />} onPress={accept} />
                      <Button label="Mark Rejected" size="sm" variant="secondary" icon={<Feather name="x-circle" size={14} color={palette.ink} />} onPress={() => setDeclineOpen(true)} />
                    </>
                  ) : null}
                </View>
              ) : null}
            </View>
          ) : null}
          {gate ? (
            <View style={{ marginTop: spacing.md }}>
              <Banner tone="danger">
                <Text variant="caption" style={{ fontWeight: fontWeight.semibold, color: palette.danger }}>Can't send yet</Text>
                <Text variant="caption" style={{ color: palette.ink }}>{gate.message}</Text>
                {gate.summary ? <Text variant="caption" tone="muted">{gate.summary}</Text> : null}
                {gate.field === "riskProfile" && riskSubject ? <Text variant="caption" tone="brand" onPress={() => setRiskFormOpen(true)}>Send the client the risk profile link</Text> : null}
                {gate.field === "suitabilityOverrideReason" ? <Text variant="caption" tone="muted">Only the firm's owner can override this, with a documented reason, in Suitability & Compliance below.</Text> : null}
              </Banner>
            </View>
          ) : null}
        </Card>

        {/* What the client did */}
        <Card style={proposalStyles.card}>
          <CardHeader title={`What ${firstName} did`} />
          <ProposalTimeline proposal={p} />
        </Card>
        {versions.length > 1 ? (
          <Card style={proposalStyles.card}>
            <CardHeader title="Versions" />
            {versions.map((v) => (
              <View key={v.id} style={styles.version}>
                {v.id === p.id
                  ? <Text variant="body" style={{ flex: 1, color: palette.ink, fontWeight: fontWeight.semibold }}>Version {v.version ?? 1} (this one)</Text>
                  : <Text variant="body" tone="brand" style={{ flex: 1 }} onPress={() => router.push(`/m/proposals/${v.id}` as any)}>Version {v.version ?? 1}</Text>}
                <StatusPill size="sm" dot={false} label={STATUS_LABEL[v.status] ?? titleCase(v.status)} tone={STATUS_TONE[v.status] ?? "neutral"} />
              </View>
            ))}
          </Card>
        ) : null}

        {p.coverLetter ? (
          <Card style={proposalStyles.card}>
            <CardHeader title="Cover letter" />
            <Text variant="body" style={{ color: palette.ink, lineHeight: 22 }}>{p.coverLetter}</Text>
          </Card>
        ) : null}

        <SuitabilityPanel
          proposal={p}
          suggestedNote={suggestedNote}
          profile={(s?.risk.category ?? null) as ClientProfile}
          canWrite={canWrite}
        />

        <Card style={proposalStyles.card}>
          <CardHeader title={`Products (${p.products.length})`} />
          <ProductList products={p.products} acceptedItems={p.acceptedItems} />
        </Card>

        {p.disclaimer ? (
          <Card style={proposalStyles.card}>
            <CardHeader title="Disclaimer" />
            <Text variant="caption" tone="muted" style={{ lineHeight: 19 }}>{p.disclaimer}</Text>
          </Card>
        ) : null}

        {canWrite && !["accepted", "partially_approved", "executed", "superseded"].includes(p.status) && !isCancelled(p) ? (
          <Button label="Cancel proposal" variant="ghost" size="sm" onPress={remove} style={{ alignSelf: "center", marginTop: spacing.md }} />
        ) : null}
      </Screen>

      <BottomSheet visible={!!previewing} onClose={() => setPreviewing(null)} title={previewing ? `Send by ${CHANNEL_LABEL[previewing.channel]}` : ""}>
        {previewing?.to ? <Text variant="caption" tone="muted">To {previewing.to}{previewing.subject ? ` · ${previewing.subject}` : ""}</Text> : null}
        <ScrollView style={styles.previewBox}>
          <Text variant="caption" style={{ color: palette.ink, lineHeight: 19 }}>{previewing?.text ?? stripHtml(previewing?.html)}</Text>
        </ScrollView>
        {previewing?.attachment ? <Text variant="caption" tone="muted">Attached: {previewing.attachment}</Text> : null}
        <Button
          label={previewing?.channel === "email" ? "Send email" : previewing?.channel === "whatsapp" ? "Open WhatsApp and send" : "Mark sent and share link"}
          full loading={send.isPending} onPress={confirmSend} style={{ marginTop: spacing.md }}
        />
      </BottomSheet>

      <NoteSheet
        visible={!!noteFor}
        initial={p.suitabilityNote?.trim() ? p.suitabilityNote : suggestedNote}
        drafted={!p.suitabilityNote?.trim() && !!suggestedNote}
        busy={update.isPending}
        onClose={() => setNoteFor(null)}
        onSave={(note) => {
          const channel = noteFor!;
          update.mutate({ suitabilityNote: note }, { onSuccess: () => { setNoteFor(null); startSend(channel); } });
        }}
      />
      <DeclineSheet visible={declineOpen} onClose={() => setDeclineOpen(false)} busy={update.isPending}
        onSave={(reason) => update.mutate({ status: "rejected", ...(reason ? { rejectionReason: reason } : {}) }, { onSuccess: () => { toast.success("Proposal marked rejected."); setDeclineOpen(false); } })} />
      <ValiditySheet visible={validityOpen} onClose={() => setValidityOpen(false)} busy={update.isPending}
        onSave={(day) => update.mutate({ validUntil: new Date(`${day}T23:59:59+05:30`).toISOString() }, { onSuccess: () => { toast.success(`Valid until ${fmtDate(day)}`); setValidityOpen(false); } })} />
      {riskSubject ? <SendFormSheet visible={riskFormOpen} onClose={() => setRiskFormOpen(false)} subjectType={riskSubject.type} subjectId={riskSubject.id} name={p.recipientName} /> : null}
    </View>
  );
}

/** The send route asked for the suitability note: ask for it (drafted from the proposal), save it, then preview again. */
function NoteSheet({ visible, initial, drafted, busy, onClose, onSave }: { visible: boolean; initial: string; drafted: boolean; busy: boolean; onClose: () => void; onSave: (note: string) => void }) {
  const [note, setNote] = React.useState(initial);
  React.useEffect(() => { if (visible) setNote(initial); }, [visible, initial]);
  return (
    <BottomSheet visible={visible} onClose={onClose} title="Suitability note">
      {drafted ? <Text variant="caption" tone="muted" style={{ marginBottom: spacing.sm }}>Drafted from this proposal. Read it, add anything specific to this client, then send.</Text> : null}
      <TextField label="Why does this proposal suit the client?" value={note} onChangeText={(v) => setNote(v.slice(0, 2000))} multiline
        placeholder="e.g. Long-term wealth creation; the funds sit within the client's risk profile and 10-year horizon." />
      <Button label="Save and send" full loading={busy} disabled={!note.trim()} onPress={() => onSave(note.trim())} />
    </BottomSheet>
  );
}

function DeclineSheet({ visible, onClose, onSave, busy }: { visible: boolean; onClose: () => void; onSave: (reason: string) => void; busy: boolean }) {
  const [reason, setReason] = React.useState("");
  return (
    <BottomSheet visible={visible} onClose={onClose} title="Mark this proposal rejected?">
      <Text variant="caption" tone="muted" style={{ marginBottom: spacing.sm }}>A reason helps the next person picking up this client.</Text>
      <TextField label="Reason for rejection (optional)" value={reason} onChangeText={(v) => setReason(v.slice(0, 500))} multiline placeholder="e.g. went with another advisor" />
      <Button label="Mark rejected" variant="danger" full loading={busy} onPress={() => onSave(reason.trim())} />
    </BottomSheet>
  );
}

function ValiditySheet({ visible, onClose, onSave, busy }: { visible: boolean; onClose: () => void; onSave: (day: string) => void; busy: boolean }) {
  const [day, setDay] = React.useState(() => {
    const d = new Date(Date.now() + 30 * 864e5);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  return (
    <BottomSheet visible={visible} onClose={onClose} title="Extend validity">
      <DateField label="Valid until" value={day} onChange={setDay} />
      <Button label="Save" full loading={busy} onPress={() => day && onSave(day)} />
    </BottomSheet>
  );
}

function Kpi({ label, value, tint }: { label: string; value: string; tint?: string }) {
  return (
    <View style={styles.kpi}>
      <Text variant="caption" tone="muted" style={{ fontSize: 11, letterSpacing: 0.5, fontWeight: fontWeight.semibold }}>{label.toUpperCase()}</Text>
      <Text style={{ fontSize: 18, fontWeight: fontWeight.bold, color: tint ?? palette.ink, marginTop: 4 }} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { backgroundColor: palette.brandDark, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.md },
  kpis: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.md },
  kpi: { flexGrow: 1, flexBasis: "45%", backgroundColor: palette.surface, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, borderColor: palette.line, padding: spacing.md },
  contact: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flexWrap: "wrap" },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.md },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.line, marginTop: spacing.md },
  version: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 6 },
  previewBox: { maxHeight: 300, marginTop: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: palette.surfaceSunken },
});
