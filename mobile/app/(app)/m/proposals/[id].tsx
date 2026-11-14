/**
 * A proposal — the live CRM's proposal page for the phone.
 *
 *  - Send is the RM's own tap: pick WhatsApp, email or a link, see exactly
 *    what the client will get (a preview changes nothing), then Send. The
 *    server's gates answer 412 and the screen says what to do: the client's
 *    risk profile (send them the link), the suitability note, or the owner's
 *    suitability override.
 *  - A draft is edited; once sent it is frozen — Revise makes a new version.
 *  - The client's answer: Accept (asks first — the lead becomes Won and
 *    onboarding starts) or Decline with a reason. A partial approval marks
 *    each line accepted or not taken.
 */

import React from "react";
import { View, Pressable, Linking, Share, StyleSheet, ActivityIndicator, Alert, ScrollView } from "react-native";
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
import { SendFormSheet } from "../../../../src/features/client-forms/SendFormSheet";
import { useMe, hasCap } from "../../../../src/api/me";
import {
  useProposal, useUpdateProposal, useSendProposal, useCancelProposal, useReviseProposal,
  lineTitle, lineAmount, num, describeError, isDraft, isCancelled, pastValidity,
  CLOSED_FOR_SEND, AWAITING_CLIENT, REVISABLE, LINE_KIND_LABEL, STATUS_LABEL, RISKOMETER_LABEL,
  type ProposalLine, type ProposalStatus, type SendChannel, type SendPreview,
} from "../../../../src/features/proposals/api";
import { confirmDelete } from "../../../../src/lib/confirm";
import { toast } from "../../../../src/lib/toast";
import { inr, fmtDate, titleCase } from "../../../../src/lib/format";
import { spacing, palette, radius, fontWeight } from "../../../../src/theme/tokens";
import { toneColors, type Tone } from "../../../../src/theme";

const STATUS_TONE: Record<ProposalStatus, Tone> = {
  draft: "neutral", ready: "info", sent: "info", viewed: "brand", changes_requested: "warning", accepted: "success",
  partially_approved: "success", executed: "success", rejected: "danger", expired: "warning", superseded: "neutral",
};
const CHANNEL_LABEL: Record<SendChannel, string> = { whatsapp: "WhatsApp", email: "Email", link: "Link" };
const stripHtml = (h?: string) => (h ?? "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<br\s*\/?>|<\/p>|<\/div>|<\/tr>|<\/h\d>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\n{3,}/g, "\n\n").trim();

export default function ProposalDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const pid = String(id);
  const { data: p, isLoading } = useProposal(pid);
  const { data: me } = useMe();
  const update = useUpdateProposal(pid);
  const { preview, send } = useSendProposal(pid);
  const cancel = useCancelProposal();
  const revise = useReviseProposal(pid);

  const [note, setNote] = React.useState<string | null>(null);
  const [noteOpen, setNoteOpen] = React.useState(false);
  const [previewing, setPreviewing] = React.useState<SendPreview | null>(null);
  const [gate, setGate] = React.useState<null | { field: string; message: string; summary?: string }>(null);
  const [riskFormOpen, setRiskFormOpen] = React.useState(false);
  const [declineOpen, setDeclineOpen] = React.useState(false);
  const [validityOpen, setValidityOpen] = React.useState(false);

  if (isLoading || !p) {
    return (
      <View style={{ flex: 1, backgroundColor: palette.surfaceAlt }}>
        <ScreenHeader title="Proposal" />
        <View style={{ padding: spacing.lg }}><Skeleton width="100%" height={120} /><Skeleton width="100%" height={80} style={{ marginTop: spacing.md }} /></View>
      </View>
    );
  }

  const invest = num(p.totalInvestment);
  const corpus = num(p.expectedCorpus);
  const suitability = note ?? p.suitabilityNote ?? "";
  const canSend = hasCap(me?.capabilities, "proposal.send") && !CLOSED_FOR_SEND.has(p.status);
  const expired = pastValidity(p) && !CLOSED_FOR_SEND.has(p.status);
  const accepted = Array.isArray(p.acceptedItems) ? new Set(p.acceptedItems) : null;

  /** A refused preview or send: say what stands in the way, and how to clear it. */
  const onGate = (e: any) => {
    const field = e?.body?.field as string | undefined;
    const msg = describeError(e, "Couldn't send the proposal");
    if (e?.status === 412 && field === "suitabilityNote") { toast.error("Add the suitability note first"); setNoteOpen(true); return; }
    if (e?.status === 412 && field) { setGate({ field, message: msg, summary: e?.body?.alignment?.summary }); return; }
    if (e?.status === 409 && pastValidity(p)) { toast.error(msg); setValidityOpen(true); return; }
    const findings = Array.isArray(e?.body?.findings) ? e.body.findings.map((f: any) => f?.message ?? f?.rule).filter(Boolean) : [];
    toast.error(findings.length ? `${msg} — ${findings.join("; ")}` : msg);
  };

  const startSend = async (channel: SendChannel) => {
    try {
      setPreviewing(await preview.mutateAsync(channel));
    } catch (e) { onGate(e); }
  };
  const confirmSend = async () => {
    if (!previewing) return;
    const channel = previewing.channel;
    try {
      const r = await send.mutateAsync(channel);
      setPreviewing(null);
      if (r.waUrl) Linking.openURL(r.waUrl).catch(() => {});
      if (r.url) Share.share({ message: r.url }).catch(() => {});
      toast.success(channel === "whatsapp" ? "Opening WhatsApp…" : channel === "email" ? "Proposal emailed" : "Link ready — share it with the client");
    } catch (e) { setPreviewing(null); onGate(e); }
  };

  const accept = () => Alert.alert(
    `Mark ${p.proposalNumber} accepted?`,
    "The lead becomes Won and the client is sent the document checklist to start onboarding.",
    [{ text: "Cancel", style: "cancel" }, { text: "Yes, client accepted", onPress: () => update.mutate({ status: "accepted" }, { onSuccess: () => toast.success("Marked accepted") }) }],
  );
  const doRevise = () => Alert.alert("Revise this proposal?", "A new draft version is made from it; this one stays as the record of what the client saw.", [
    { text: "Cancel", style: "cancel" },
    { text: "Revise", onPress: () => revise.mutate(undefined, { onSuccess: (r) => router.replace(`/m/proposals/new?editId=${r.id}` as any) }) },
  ]);
  const saveNote = () => update.mutate({ suitabilityNote: suitability }, { onSuccess: () => { toast.success("Suitability note saved"); setNoteOpen(false); } });
  const remove = () => confirmDelete({ title: "Cancel this proposal?", message: "It is withdrawn and leaves your list.", confirmLabel: "Cancel proposal" }, () => {
    cancel.mutate(pid, { onSuccess: () => { toast.success("Proposal cancelled"); router.back(); } });
  });
  const riskSubject = p.investorId ? { type: "investor" as const, id: p.investorId } : p.leadId ? { type: "lead" as const, id: p.leadId } : null;

  return (
    <View style={{ flex: 1, backgroundColor: palette.surfaceAlt }}>
      <ScreenHeader title={p.proposalNumber} subtitle={p.version && p.version > 1 ? `Version ${p.version}` : titleCase(p.type.replace(/_/g, " "))} />
      <Screen scroll padded contentStyle={{ paddingTop: spacing.lg, paddingBottom: spacing["3xl"] }}>
        {p.status === "superseded" && p.supersededById ? (
          <Pressable onPress={() => router.replace(`/m/proposals/${p.supersededById}` as any)} style={[styles.banner, { borderColor: palette.line }]}>
            <Text variant="caption">An older version — a newer one replaced it.</Text>
            <Text variant="caption" tone="brand">Open the latest version →</Text>
          </Pressable>
        ) : null}
        {p.status === "changes_requested" && p.changeRequestNote ? (
          <View style={[styles.banner, { borderColor: palette.warning, backgroundColor: palette.warning + "12" }]}>
            <Text variant="caption" style={{ fontWeight: fontWeight.semibold }}>The client asked for changes</Text>
            <Text variant="caption">“{p.changeRequestNote}”</Text>
          </View>
        ) : null}
        {expired ? (
          <Pressable onPress={() => setValidityOpen(true)} style={[styles.banner, { borderColor: palette.warning, backgroundColor: palette.warning + "12" }]}>
            <Text variant="caption">Its validity ended on {fmtDate(p.validUntil)} — it can't be sent or accepted until you extend it.</Text>
            <Text variant="caption" tone="brand">Extend validity</Text>
          </Pressable>
        ) : null}

        <Card>
          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.sm }}>
            <Text variant="title" style={{ flex: 1 }}>{p.title}</Text>
            <StatusPill label={STATUS_LABEL[p.status] ?? titleCase(p.status)} tone={STATUS_TONE[p.status] ?? "neutral"} size="sm" />
          </View>
          <Text variant="body" tone="muted" style={{ marginTop: 4 }}>{p.recipientName}</Text>
          <Text variant="caption" tone="faint" style={{ marginTop: 2 }}>
            {[p.validUntil ? `Valid until ${fmtDate(p.validUntil)}` : null, p.sentAt ? `Sent ${fmtDate(p.sentAt)}` : null, p.viewCount ? `Viewed ${p.viewCount}×` : null].filter(Boolean).join(" · ")}
          </Text>
          <View style={styles.kpis}>
            <Kpi label="Investment" value={invest > 0 ? inr(invest) : "—"} />
            <View style={styles.vline} />
            <Kpi label="Proj. corpus" value={corpus > 0 ? inr(corpus) : "—"} />
            <View style={styles.vline} />
            <Kpi label="Items" value={String(p.products.length)} />
          </View>
        </Card>

        <SectionLabel text={`PRODUCTS (${p.products.length})`} />
        <Card flat style={{ padding: 0, overflow: "hidden" }}>
          {p.products.length === 0 ? (
            <View style={{ padding: spacing.lg }}><Text variant="body" tone="muted">No product line items.</Text></View>
          ) : p.products.map((l, i) => (
            <ProductRow key={i} line={l} last={i === p.products.length - 1} taken={accepted ? accepted.has(i) : null} />
          ))}
        </Card>

        {p.coverLetter ? (
          <>
            <SectionLabel text="COVER LETTER" />
            <Card flat><Text variant="body" style={{ color: palette.ink, lineHeight: 21 }}>{p.coverLetter}</Text></Card>
          </>
        ) : null}

        <SectionLabel text="SUITABILITY NOTE" />
        <Pressable onPress={() => setNoteOpen(true)}>
          <Card flat style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
            <Feather name={suitability.trim() ? "check-circle" : "alert-circle"} size={18} color={suitability.trim() ? toneColors("success").fg : toneColors("warning").fg} />
            <Text variant="body" style={{ flex: 1, color: suitability.trim() ? palette.ink : palette.muted }} numberOfLines={3}>
              {suitability.trim() ? suitability : "Why this suits the client — needed before sending."}
            </Text>
            <Feather name="edit-2" size={14} color={palette.faint} />
          </Card>
        </Pressable>

        {gate ? (
          <View style={[styles.banner, { borderColor: palette.danger, backgroundColor: palette.danger + "0D", marginTop: spacing.lg }]}>
            <Text variant="caption" style={{ fontWeight: fontWeight.semibold, color: palette.danger }}>Can't send yet</Text>
            <Text variant="caption">{gate.message}</Text>
            {gate.summary ? <Text variant="caption" tone="muted">{gate.summary}</Text> : null}
            {gate.field === "riskProfile" && riskSubject ? <Text variant="caption" tone="brand" onPress={() => setRiskFormOpen(true)}>Send the client the risk profile link</Text> : null}
            {gate.field === "suitabilityOverrideReason" ? <Text variant="caption" tone="muted">Only the firm's owner can approve this, on the web.</Text> : null}
          </View>
        ) : null}

        {isDraft(p.status) ? (
          <Button label="Edit proposal" variant="secondary" icon={<Feather name="edit-2" size={15} color={palette.ink} />} onPress={() => router.push(`/m/proposals/new?editId=${p.id}` as any)} style={{ marginTop: spacing.xl }} />
        ) : null}

        {canSend && !expired ? (
          <>
            <SectionLabel text="SEND" />
            <View style={styles.sendRow}>
              {(["whatsapp", "email", "link"] as SendChannel[]).map((c) => (
                <Pressable key={c} style={[styles.sendBtn, { backgroundColor: c === "whatsapp" ? palette.success : c === "email" ? palette.brand : palette.ink }]} onPress={() => startSend(c)} disabled={preview.isPending} accessibilityRole="button">
                  {preview.isPending && preview.variables === c ? <ActivityIndicator color={palette.white} size="small" /> : <Feather name={c === "whatsapp" ? "message-circle" : c === "email" ? "mail" : "link"} size={16} color={palette.white} />}
                  <Text style={styles.sendTxt}>{CHANNEL_LABEL[c]}</Text>
                </Pressable>
              ))}
            </View>
          </>
        ) : null}

        {AWAITING_CLIENT.has(p.status) && !expired ? (
          <View style={styles.sendRow}>
            <Pressable style={[styles.outBtn, { borderColor: toneColors("success").fg }]} onPress={accept}>
              <Text style={{ color: toneColors("success").fg, fontWeight: fontWeight.semibold }}>Client accepted</Text>
            </Pressable>
            <Pressable style={[styles.outBtn, { borderColor: toneColors("danger").fg }]} onPress={() => setDeclineOpen(true)}>
              <Text style={{ color: toneColors("danger").fg, fontWeight: fontWeight.semibold }}>Client declined</Text>
            </Pressable>
          </View>
        ) : null}

        {REVISABLE.has(p.status) ? (
          <Button label="Revise — make a new version" variant="secondary" loading={revise.isPending} icon={<Feather name="copy" size={15} color={palette.ink} />} onPress={doRevise} style={{ marginTop: spacing.lg }} />
        ) : null}

        {!["accepted", "partially_approved", "executed", "superseded"].includes(p.status) && !isCancelled(p) ? (
          <Pressable onPress={remove} style={{ alignSelf: "center", marginTop: spacing.xl, padding: spacing.md }}>
            <Text variant="caption" style={{ color: toneColors("danger").fg }}>Cancel proposal</Text>
          </Pressable>
        ) : null}
      </Screen>

      <BottomSheet visible={noteOpen} onClose={() => setNoteOpen(false)} title="Suitability note">
        <TextField label="Why this suits the client" value={suitability} onChangeText={setNote} multiline placeholder="e.g. Aligned with the client's moderate risk profile and 10-year horizon…" />
        <Button label="Save note" full loading={update.isPending} onPress={saveNote} />
      </BottomSheet>

      <BottomSheet visible={!!previewing} onClose={() => setPreviewing(null)} title={previewing ? `Send by ${CHANNEL_LABEL[previewing.channel]}` : ""}>
        {previewing?.to ? <Text variant="caption" tone="muted">To {previewing.to}</Text> : null}
        {previewing?.subject ? <Text variant="body" style={{ fontWeight: fontWeight.semibold, marginTop: spacing.xs }}>{previewing.subject}</Text> : null}
        <ScrollView style={styles.previewBox}>
          <Text variant="caption" style={{ color: palette.ink, lineHeight: 19 }}>{previewing?.text ?? stripHtml(previewing?.html)}</Text>
        </ScrollView>
        {previewing?.attachment ? <Text variant="caption" tone="muted">Attached: {previewing.attachment}</Text> : null}
        <Button label="Send now" full loading={send.isPending} onPress={confirmSend} style={{ marginTop: spacing.md }} />
      </BottomSheet>

      <DeclineSheet visible={declineOpen} onClose={() => setDeclineOpen(false)} busy={update.isPending}
        onSave={(reason) => update.mutate({ status: "rejected", ...(reason ? { rejectionReason: reason } : {}) }, { onSuccess: () => { toast.success("Marked declined"); setDeclineOpen(false); } })} />
      <ValiditySheet visible={validityOpen} onClose={() => setValidityOpen(false)} busy={update.isPending}
        onSave={(day) => update.mutate({ validUntil: new Date(`${day}T23:59:59+05:30`).toISOString() }, { onSuccess: () => { toast.success(`Valid until ${fmtDate(day)}`); setValidityOpen(false); } })} />
      {riskSubject ? <SendFormSheet visible={riskFormOpen} onClose={() => setRiskFormOpen(false)} subjectType={riskSubject.type} subjectId={riskSubject.id} name={p.recipientName} /> : null}
    </View>
  );
}

function DeclineSheet({ visible, onClose, onSave, busy }: { visible: boolean; onClose: () => void; onSave: (reason: string) => void; busy: boolean }) {
  const [reason, setReason] = React.useState("");
  return (
    <BottomSheet visible={visible} onClose={onClose} title="Client declined">
      <TextField label="Why (optional)" value={reason} onChangeText={(v) => setReason(v.slice(0, 500))} multiline />
      <Button label="Mark declined" variant="danger" full loading={busy} onPress={() => onSave(reason.trim())} />
    </BottomSheet>
  );
}

function ValiditySheet({ visible, onClose, onSave, busy }: { visible: boolean; onClose: () => void; onSave: (day: string) => void; busy: boolean }) {
  const [day, setDay] = React.useState(() => new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10));
  return (
    <BottomSheet visible={visible} onClose={onClose} title="Extend validity">
      <DateField label="Valid until" value={day} onChange={setDay} />
      <Button label="Save" full loading={busy} onPress={() => day && onSave(day)} />
    </BottomSheet>
  );
}

function ProductRow({ line, last, taken }: { line: ProposalLine; last: boolean; taken: boolean | null }) {
  const amt = lineAmount(line);
  const sub = subFor(line);
  return (
    <View style={[styles.pRow, !last && styles.divider]}>
      <View style={styles.pTag}><Text variant="caption" style={{ color: palette.brand, fontWeight: fontWeight.semibold, fontSize: 10 }}>{LINE_KIND_LABEL[line.kind].toUpperCase()}</Text></View>
      <View style={{ flex: 1 }}>
        <Text variant="body" numberOfLines={2}>{lineTitle(line)}</Text>
        {sub ? <Text variant="caption" tone="muted" numberOfLines={1}>{sub}</Text> : null}
        {taken != null ? <Text variant="caption" style={{ color: taken ? palette.success : palette.muted, fontWeight: fontWeight.semibold }}>{taken ? "Accepted" : "Not taken"}</Text> : null}
      </View>
      {amt > 0 ? <Text variant="caption" style={{ fontWeight: fontWeight.semibold, color: palette.ink }}>{inr(amt)}</Text> : null}
    </View>
  );
}

function subFor(l: ProposalLine): string {
  if (l.kind === "mf") {
    const t = l.recommendationType ?? "sip";
    const amt = t === "sip" ? (l.monthlyAmount ? `${inr(l.monthlyAmount)}/mo SIP` : null)
      : t === "lumpsum" ? (l.lumpsum ? `${inr(l.lumpsum)} lumpsum` : null)
      : t === "swp" ? (l.monthlyWithdrawal ? `${inr(l.monthlyWithdrawal)}/mo SWP` : null)
      : (l.monthlyTransfer ? `${inr(l.monthlyTransfer)}/mo STP${l.toSchemeName ? ` → ${l.toSchemeName}` : ""}` : null);
    return [l.amcName, amt, l.riskRating ? RISKOMETER_LABEL[l.riskRating] : null].filter(Boolean).join(" · ");
  }
  if (l.kind === "insurance") return [l.insurer, l.policyType ? titleCase(l.policyType.replace(/_/g, " ")) : null, l.sumAssured ? `${inr(l.sumAssured)} cover` : null].filter(Boolean).join(" · ");
  if (l.kind === "pms") return [l.manager, l.proposedAmount ? inr(l.proposedAmount) : null].filter(Boolean).join(" · ");
  if (l.kind === "aif") return [l.manager, l.category?.toUpperCase(), l.proposedAmount ? inr(l.proposedAmount) : null].filter(Boolean).join(" · ");
  return [l.company, l.amount ? inr(l.amount) : null].filter(Boolean).join(" · ");
}

function Kpi({ label, value }: { label: string; value: string }) {
  return <View style={{ flex: 1, alignItems: "center" }}><Text style={{ fontSize: 15, fontWeight: fontWeight.bold }} numberOfLines={1}>{value}</Text><Text variant="caption" tone="muted">{label}</Text></View>;
}
function SectionLabel({ text }: { text: string }) {
  return <Text variant="caption" tone="faint" style={{ letterSpacing: 0.6, marginTop: spacing.xl, marginBottom: spacing.sm }}>{text}</Text>;
}

const styles = StyleSheet.create({
  banner: { borderWidth: 1, borderRadius: radius.md, padding: spacing.md, gap: 4, marginBottom: spacing.md, backgroundColor: palette.surface },
  kpis: { flexDirection: "row", alignItems: "center", marginTop: spacing.lg, paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.line },
  vline: { width: StyleSheet.hairlineWidth, height: 26, backgroundColor: palette.line },
  pRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md, paddingHorizontal: spacing.lg },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line },
  pTag: { backgroundColor: palette.brandLight, borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 3 },
  sendRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  sendBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.xs, borderRadius: radius.md, paddingVertical: spacing.md },
  sendTxt: { color: palette.white, fontWeight: fontWeight.semibold },
  outBtn: { flex: 1, alignItems: "center", justifyContent: "center", borderWidth: 1, borderRadius: radius.md, paddingVertical: spacing.md },
  previewBox: { maxHeight: 300, marginTop: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: palette.surfaceSunken },
});
