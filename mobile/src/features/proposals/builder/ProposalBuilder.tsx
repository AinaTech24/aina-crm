/**
 * The proposal builder — the live CRM's four steps (web
 * components/proposals/builder/ProposalBuilder), in the order an RM thinks:
 *
 *   1. Client            who it's for, and what the CRM already knows about them
 *   2. Recommend         the one recommendation list, checked against the profile
 *   3. Review as client  the PDF exactly as the client gets it (rendered, not saved)
 *   4. Send              validity, the suitability note, then email / WhatsApp /
 *                        a link — each previewed before it goes
 *
 * The same screen edits a draft (?editId=). Once a proposal has been sent it
 * opens read-only: a sent proposal is the record of what the client saw, so
 * changes go into a new version (Revise), never over the top.
 *
 * ?investorId= / ?leadId= / ?familyId= start with that recipient;
 * ?opportunityId= links the proposal to the opportunity it answers.
 */

import React from "react";
import { View, Pressable, KeyboardAvoidingView, Platform, ScrollView, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { Card } from "../../../components/ui/Card";
import { Text } from "../../../components/ui/Text";
import { Button } from "../../../components/ui/Button";
import { TextField } from "../../../components/ui/TextField";
import { SelectField } from "../../../components/ui/SelectField";
import { ScreenHeader } from "../../../components/ui/ScreenHeader";
import { LoadingState } from "../../../components/states";
import { api } from "../../../api/client";
import {
  useProposal, useRecipientSnapshot, useFamilyMembers, useRefreshProposals, proposalTypeFor, describeError, PROFILE_LABEL,
  type ProposalLine, type ProposalType, type RiskRating, type ProposalSnapshot,
} from "../api";
import { itemKindLabel, itemName } from "../shared/items";
import { draftSuitabilityNote } from "../shared/suitability-note";
import { RecipientPicker, type Recipient } from "./RecipientPicker";
import { SnapshotCard } from "./SnapshotCard";
import { RecommendStep } from "./RecommendStep";
import { ReviewStep } from "./ReviewStep";
import { SendStep } from "./SendStep";
import { Banner, CardHeader, proposalStyles } from "../ui";
import { toast } from "../../../lib/toast";
import { fmtDate } from "../../../lib/format";
import { spacing, palette, radius, fontWeight } from "../../../theme/tokens";

const STEPS = ["Client", "Recommend", "Review as client", "Send"] as const;
const EDITABLE = ["draft", "ready"];
const RISK_FROM_PROFILE: Record<string, RiskRating> = { conservative: "conservative", moderate: "moderate", aggressive: "aggressive", very_aggressive: "aggressive" };
const UUID = /^[0-9a-f-]{36}$/i;

const inDays = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
/** A valid-till DAY means valid all of that day in India. */
const endOfDayIst = (day: string) => (day ? new Date(`${day}T23:59:59+05:30`).toISOString() : undefined);
const dayOf = (iso?: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso).slice(0, 10);
  // The IST calendar day (the list and the send route read validity on it).
  return new Date(d.getTime() + 5.5 * 3600e3).toISOString().slice(0, 10);
};

export function ProposalBuilder({ params }: { params: { editId?: string; investorId?: string; leadId?: string; familyId?: string; opportunityId?: string } }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const editing = useProposal(params.editId ?? "");
  const scrollRef = React.useRef<ScrollView>(null);

  const [proposalId, setProposalId] = React.useState<string | null>(params.editId ?? null);
  const [meta, setMeta] = React.useState<{ number: string | null; version: number; status: string; sentAt: string | null }>({ number: null, version: 1, status: "draft", sentAt: null });
  const [hydrated, setHydrated] = React.useState(!params.editId);

  const [recipient, setRecipient] = React.useState<Recipient | null>(null);
  const [familyMemberId, setFamilyMemberId] = React.useState<string | null>(null);
  const [title, setTitle] = React.useState("Investment Proposal");
  const [riskRating, setRiskRating] = React.useState<RiskRating>("moderate");
  const riskTouched = React.useRef(false);
  const [validUntil, setValidUntil] = React.useState(inDays(30));
  const [coverLetter, setCoverLetter] = React.useState("");
  const [disclaimer, setDisclaimer] = React.useState("");
  /** Why it suits the client — the send route requires it. */
  const [suitabilityNote, setSuitabilityNote] = React.useState("");
  const [items, setItems] = React.useState<ProposalLine[]>([]);
  const type: ProposalType = proposalTypeFor(items);

  const [step, setStep] = React.useState(0);
  const [busy, setBusy] = React.useState<null | "draft">(null);
  const [err, setErr] = React.useState<string | null>(null);
  const refresh = useRefreshProposals(proposalId ?? undefined);

  const locked = !!proposalId && !EDITABLE.includes(meta.status);

  // ── Load: an existing proposal ──
  React.useEffect(() => {
    const p = editing.data;
    if (!p || hydrated) return;
    riskTouched.current = true;
    setMeta({ number: p.proposalNumber ?? null, version: p.version ?? 1, status: p.status, sentAt: p.sentAt ?? null });
    setRecipient({ type: p.recipientType, id: (p.recipientType === "lead" ? p.leadId : p.recipientType === "family" ? p.familyId : p.investorId) ?? "", name: p.recipientName });
    if (p.recipientType === "family" && p.investorId) setFamilyMemberId(p.investorId);
    setTitle(p.title ?? "Investment Proposal");
    setRiskRating(p.riskRating ?? "moderate");
    setValidUntil(p.validUntil ? dayOf(p.validUntil) : inDays(30));
    setCoverLetter(p.coverLetter ?? "");
    setDisclaimer(p.disclaimer ?? "");
    setSuitabilityNote(p.suitabilityNote ?? "");
    setItems(Array.isArray(p.products) ? p.products : []);
    setHydrated(true);
  }, [editing.data, hydrated]);

  // ── …or a recipient passed in: ?investorId= / ?leadId= (named by the snapshot, as on the web) / ?familyId= ──
  const startInvestor = !params.editId && params.investorId && UUID.test(params.investorId) ? params.investorId : null;
  const startLead = !params.editId && !startInvestor && params.leadId && UUID.test(params.leadId) ? params.leadId : null;
  const startFamily = !params.editId && !startInvestor && !startLead && params.familyId && UUID.test(params.familyId) ? params.familyId : null;
  const startSnap = useRecipientSnapshot(startInvestor || startLead ? { investorId: startInvestor, leadId: startLead } : null);
  const startFam = useFamilyMembers(startFamily);
  const prefilled = React.useRef(false);
  React.useEffect(() => {
    if (prefilled.current) return;
    if (startSnap.data?.name && (startInvestor || startLead)) {
      prefilled.current = true;
      setRecipient((cur) => cur ?? { type: startInvestor ? "investor" : "lead", id: (startInvestor ?? startLead)!, name: startSnap.data!.name });
    } else if (startFam.data && startFamily) {
      prefilled.current = true;
      setRecipient((cur) => cur ?? { type: "family", id: startFamily, name: startFam.data!.name });
    }
  }, [startSnap.data, startFam.data, startInvestor, startLead, startFamily]);

  // ── What the CRM knows about the recipient ──
  const snapQ = useRecipientSnapshot(
    recipient
      ? recipient.type === "lead" ? { leadId: recipient.id }
        : recipient.type === "family" ? (familyMemberId ? { investorId: familyMemberId } : { familyId: recipient.id })
        : { investorId: recipient.id }
      : null
  );
  const snapshot: ProposalSnapshot | null = recipient ? snapQ.data ?? null : null;
  React.useEffect(() => {
    const fromProfile = snapshot?.risk?.category ? RISK_FROM_PROFILE[snapshot.risk.category] : null;
    if (fromProfile && !riskTouched.current) setRiskRating(fromProfile);
  }, [snapshot]);

  // The suitability note is drafted from what the earlier steps captured, the
  // first time the RM reaches Send with the box still empty. They read it, add
  // what only they know, and it is theirs from then on.
  const noteDrafted = React.useRef(false);
  React.useEffect(() => {
    if (step !== 3 || locked || noteDrafted.current) return;
    noteDrafted.current = true;
    if (suitabilityNote.trim()) return;
    const draft = draftSuitabilityNote({
      clientName: recipient?.name ?? "",
      riskProfile: snapshot?.risk.status === "Completed" ? snapshot.risk.category : null,
      goals: snapshot?.goals ?? [],
      items,
    });
    if (draft) setSuitabilityNote(draft.slice(0, 2000));
  }, [step, locked, suitabilityNote, recipient, snapshot, items]);

  // ── Validation ──
  const missing = React.useMemo(() => {
    const out: string[] = [];
    if (!recipient) out.push("Pick who the proposal is for.");
    if (title.trim().length < 2) out.push("Give the proposal a title.");
    if (items.length === 0) out.push("Add at least one recommendation.");
    for (const it of items) {
      if (!itemName(it).trim() || itemName(it) === "Recommendation") {
        out.push(`Every ${itemKindLabel(it)} line needs a name.`);
        break;
      }
    }
    return out;
  }, [recipient, title, items]);

  /** What stops a SEND (a draft saves without these). Mirrors the send route. */
  const riskBlocked = items.some((it) => it.kind === "mf") && !!snapshot && !snapshot.riskExempt && snapshot.risk.status !== "Completed";
  const sendBlockers = React.useMemo(() => {
    const out = [...missing];
    if (riskBlocked && snapshot) {
      out.push(
        snapshot.risk.status === "Provisional"
          ? "The client's risk profile is only provisional — they must confirm it before a mutual fund proposal goes out."
          : snapshot.risk.status === "Due for review"
            ? "The client's risk profile is more than a year old — they must redo it before a mutual fund proposal goes out."
            : "A mutual fund proposal needs the client's confirmed risk profile — send them the link from the Client step."
      );
    }
    if (!suitabilityNote.trim()) out.push("Write why this proposal suits the client (suitability note).");
    // The send route refuses a proposal past its validity (409) — say so before the tap.
    if (validUntil && validUntil < dayOf(new Date().toISOString())) out.push("The valid-until date has passed — pick a later date.");
    return out;
  }, [missing, riskBlocked, snapshot, suitabilityNote, validUntil]);

  /** The builder's content, as the preview and the save both send it. */
  const content = () => ({
    title: title.trim(),
    type,
    riskRating,
    validUntil: endOfDayIst(validUntil),
    coverLetter: coverLetter.trim() || undefined,
    disclaimer,
    suitabilityNote: suitabilityNote.trim() || undefined,
    products: items,
  });

  /** Save the proposal (create it the first time); its id, or null when it could not. Throws the API's refusal. */
  const persist = async (): Promise<string | null> => {
    if (missing.length) { setErr(missing[0]); return null; }
    setErr(null);
    const body: Record<string, unknown> = content();
    if (proposalId) {
      await api.patch(`/api/proposals/${proposalId}`, body);
      refresh();
      return proposalId;
    }
    const r = recipient!;
    Object.assign(body, { recipientType: r.type });
    if (r.type === "investor") body.investorId = r.id;
    else if (r.type === "lead") body.leadId = r.id;
    else { body.familyId = r.id; if (familyMemberId) body.investorId = familyMemberId; }
    // Opened from an opportunity ("Create proposal"): link the proposal to it (the server checks it is this client's).
    if (params.opportunityId && UUID.test(params.opportunityId) && r.type !== "lead") body.opportunityId = params.opportunityId;
    const j = await api.post<{ id: string; proposalNumber: string }>("/api/proposals", body);
    setProposalId(j.id);
    setMeta((m) => ({ ...m, number: j.proposalNumber ?? null, version: 1, status: "draft" }));
    refresh();
    return j.id;
  };

  const saveDraft = async () => {
    setBusy("draft");
    try {
      if (await persist()) toast.success("Draft saved");
      else scrollRef.current?.scrollTo({ y: 0, animated: true });
    } catch (e: any) {
      const msg = describeError(e, "Could not save the proposal.");
      setErr(msg);
      toast.error(msg);
    } finally {
      setBusy(null);
    }
  };

  const go = (i: number) => {
    if (i !== 0 && !recipient) return;
    setStep(i);
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  };

  if (params.editId && !hydrated) {
    return (
      <View style={{ flex: 1, backgroundColor: palette.surfaceAlt }}>
        <ScreenHeader title="Proposal" />
        {editing.isError ? <View style={{ padding: spacing.lg }}><Banner tone="danger"><Text variant="caption" tone="danger">This proposal could not be loaded.</Text></Banner></View> : <LoadingState label="Loading the proposal…" />}
      </View>
    );
  }

  const heading = proposalId
    ? `${meta.number ?? "Proposal"}${meta.version > 1 ? ` · version ${meta.version}` : ""}`
    : recipient ? `New proposal · ${recipient.name}` : "New proposal";
  const subtitle = snapshot?.rm ? `RM ${snapshot.rm}${snapshot.family ? ` · ${snapshot.family} family` : ""}` : undefined;
  const errBanner = err ? <Banner tone="danger"><Text variant="caption" style={{ color: palette.danger }}>{err}</Text></Banner> : null;
  const first = recipient?.name?.split(" ")[0];

  return (
    <View style={{ flex: 1, backgroundColor: palette.surfaceAlt }}>
      <ScreenHeader title={heading} subtitle={subtitle} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView ref={scrollRef} contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
          {locked ? (
            <Banner>
              <View style={{ flexDirection: "row", gap: spacing.sm }}>
                <Feather name="lock" size={14} color={palette.muted} style={{ marginTop: 2 }} />
                <Text variant="caption" style={{ flex: 1, color: palette.ink }}>
                  This proposal has been sent{meta.sentAt ? ` (${fmtDate(meta.sentAt)})` : ""}, so it is kept exactly as the client saw it. To change it, open the proposal and choose Revise — that creates version {meta.version + 1} with a fresh link.
                </Text>
              </View>
            </Banner>
          ) : null}

          {/* Stepper */}
          <View style={styles.stepper} accessibilityRole="tablist">
            {STEPS.map((label, i) => {
              const done = i < step, on = i === step;
              return (
                <Pressable key={label} onPress={() => go(i)} style={[styles.step, on && styles.stepOn]} accessibilityRole="tab" accessibilityState={{ selected: on, disabled: i !== 0 && !recipient }}>
                  <View style={[styles.dot, on ? { backgroundColor: palette.brand } : done ? { backgroundColor: palette.successBg } : null]}>
                    {done ? <Feather name="check" size={12} color={palette.success} /> : <Text style={{ fontSize: 11, fontWeight: fontWeight.bold, color: on ? palette.white : palette.muted }}>{i + 1}</Text>}
                  </View>
                  <Text variant="caption" numberOfLines={2} style={{ textAlign: "center", color: on ? palette.brandDark : palette.muted, fontWeight: on ? fontWeight.semibold : fontWeight.medium }}>{label}</Text>
                </Pressable>
              );
            })}
          </View>

          {step !== 3 ? errBanner : null}

          {step === 0 ? (
            <>
              <Card style={proposalStyles.card}>
                <CardHeader title="Who is this for?" />
                <RecipientPicker
                  value={recipient}
                  onChange={(r) => { setRecipient(r); if (!r) setFamilyMemberId(null); }}
                  familyMemberId={familyMemberId}
                  onFamilyMember={setFamilyMemberId}
                  locked={!!proposalId}
                />
              </Card>
              {recipient ? <SnapshotCard snapshot={snapshot} loading={snapQ.isLoading} /> : null}
              <Card style={proposalStyles.card}>
                <CardHeader title="Title and framing" />
                <TextField label="Proposal title" value={title} onChangeText={(v) => setTitle(v.slice(0, 200))} placeholder="Retirement plan" disabled={locked} />
                <SelectField
                  label="Overall risk rating"
                  value={riskRating}
                  disabled={locked}
                  options={[{ value: "conservative", label: "Conservative" }, { value: "moderate", label: "Moderate" }, { value: "aggressive", label: "Aggressive" }, { value: "mixed", label: "Mixed" }]}
                  onChange={(v) => { riskTouched.current = true; setRiskRating(v as RiskRating); }}
                />
                <TextField
                  label="Cover letter"
                  value={coverLetter}
                  onChangeText={(v) => setCoverLetter(v.slice(0, 4000))}
                  multiline
                  disabled={locked}
                  placeholder={`Dear ${first ?? "Sunita"},\n\nFollowing our conversation, here is what we discussed…`}
                />
              </Card>
            </>
          ) : null}

          {step === 1 ? (
            <Card style={proposalStyles.card}>
              <CardHeader
                title={`Recommendations (${items.length})`}
                subtitle={snapshot?.risk.category
                  ? `Checked against a ${PROFILE_LABEL[snapshot.risk.category] ?? snapshot.risk.category} risk profile as you add them.`
                  : "No risk profile on file, so fit can't be checked yet."}
              />
              <RecommendStep items={items} setItems={setItems} snapshot={snapshot} locked={locked} />
            </Card>
          ) : null}

          {step === 2 && recipient ? (
            <ReviewStep
              name={recipient.name}
              title={title}
              items={items}
              previewBody={() => ({
                ...content(),
                recipient: { type: recipient.type, id: recipient.id, ...(familyMemberId ? { memberId: familyMemberId } : {}) },
                proposalNumber: meta.number ?? undefined,
                version: meta.version,
              })}
              disclaimer={disclaimer}
              setDisclaimer={setDisclaimer}
              locked={locked}
            />
          ) : null}

          {step === 3 ? (
            <SendStep
              name={recipient?.name ?? "the client"}
              snapshot={snapshot}
              locked={locked}
              validUntil={validUntil}
              setValidUntil={setValidUntil}
              note={suitabilityNote}
              setNote={setSuitabilityNote}
              blockers={sendBlockers}
              riskBlocked={riskBlocked}
              persist={persist}
              onSent={(id) => router.replace(`/m/proposals/${id}` as any)}
              err={errBanner}
            />
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* One bar for moving through the steps — always in reach. */}
      <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
        {step > 0 ? (
          <Button label="Back" size="sm" variant="ghost" accessibilityLabel={`Back to ${STEPS[step - 1]}`} icon={<Feather name="chevron-left" size={16} color={palette.brandDark} />} onPress={() => go(step - 1)} style={{ paddingHorizontal: spacing.sm }} />
        ) : <View />}
        <View style={{ flexDirection: "row", gap: spacing.sm }}>
          {!locked ? <Button label="Save draft" size="sm" variant="secondary" loading={busy === "draft"} disabled={busy !== null || !recipient} onPress={saveDraft} style={{ paddingHorizontal: spacing.md }} /> : null}
          {step < STEPS.length - 1 ? <Button label={`${STEPS[step + 1]} ›`} size="sm" disabled={!recipient} onPress={() => go(step + 1)} style={{ paddingHorizontal: spacing.md }} /> : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  stepper: { flexDirection: "row", backgroundColor: palette.surface, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: palette.line, marginBottom: spacing.md, overflow: "hidden" },
  step: { flex: 1, alignItems: "center", gap: 4, paddingVertical: spacing.sm, paddingHorizontal: 2, borderBottomWidth: 2, borderBottomColor: palette.line },
  stepOn: { borderBottomColor: palette.brand },
  dot: { width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: palette.surfaceSunken },
  bar: { position: "absolute", left: 0, right: 0, bottom: 0, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.md, backgroundColor: palette.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.line },
});
