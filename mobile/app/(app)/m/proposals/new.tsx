/**
 * Create or edit a proposal — the live CRM's builder (web ProposalBuilder):
 * recipient → framing (title, overall risk from the client's profile,
 * validity, cover letter) → product lines → save as a DRAFT. Nothing is sent
 * from here; sending is the RM's own tap on the proposal screen.
 *
 *  - Every MF scheme and AMC is picked from the firm's Scheme Master, Regular
 *    plans only; a pick carries the scheme code, category and riskometer.
 *  - An MF line is a SIP, lumpsum, SWP or STP and keeps only that type's fields.
 *  - ?editId= edits a draft (a sent proposal is frozen — revise it instead).
 *  - ?leadId= / ?investorId= start with that recipient; ?opportunityId= links
 *    the proposal to the opportunity it answers.
 */

import React from "react";
import { View, Pressable, ScrollView, StyleSheet } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { Screen } from "../../../../src/components/ui/Screen";
import { Card } from "../../../../src/components/ui/Card";
import { Text } from "../../../../src/components/ui/Text";
import { TextField } from "../../../../src/components/ui/TextField";
import { SelectField } from "../../../../src/components/ui/SelectField";
import { Segmented } from "../../../../src/components/ui/Segmented";
import { SearchBar } from "../../../../src/components/ui/SearchBar";
import { ScreenHeader } from "../../../../src/components/ui/ScreenHeader";
import { BottomSheet } from "../../../../src/components/ui/BottomSheet";
import { LoadingState } from "../../../../src/components/states";
import { SendFormSheet } from "../../../../src/features/client-forms/SendFormSheet";
import { useSearch } from "../../../../src/features/search/api";
import {
  useCreateProposal, useUpdateProposal, useProposal, useSchemeSearch, useAmcs, useRecipientSnapshot,
  lineTitle, lineAmount, proposalTypeFor, ratingFromProfile, riskometerLevel, riskReady, describeError,
  LINE_KIND_LABEL, RISKOMETER_LABEL, INSURERS,
  type ProposalLine, type LineKind, type RecipientType, type RiskRating, type MfLine, type RecommendationType, type SchemeHit,
} from "../../../../src/features/proposals/api";
import { toast } from "../../../../src/lib/toast";
import { api } from "../../../../src/api/client";
import { inr, fmtDate } from "../../../../src/lib/format";
import { spacing, palette, radius, fontWeight } from "../../../../src/theme/tokens";

type Recipient = { type: RecipientType; id: string; name: string; phone?: string | null };

const RISKS: Array<{ key: RiskRating; label: string }> = [
  { key: "conservative", label: "Conservative" }, { key: "moderate", label: "Moderate" },
  { key: "aggressive", label: "Aggressive" }, { key: "mixed", label: "Mixed" },
];
const KINDS: LineKind[] = ["mf", "insurance", "pms", "aif", "other"];

export default function ProposalBuilder() {
  const router = useRouter();
  const params = useLocalSearchParams<{ leadId?: string; investorId?: string; opportunityId?: string; editId?: string }>();
  const editing = useProposal(params.editId ?? "");
  const create = useCreateProposal();
  const update = useUpdateProposal(params.editId ?? "");

  const [recipient, setRecipient] = React.useState<Recipient | null>(null);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [title, setTitle] = React.useState("Investment Proposal");
  const [risk, setRisk] = React.useState<RiskRating | null>(null);
  const [validUntil, setValidUntil] = React.useState(() => new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10));
  const [coverLetter, setCoverLetter] = React.useState("");
  const [products, setProducts] = React.useState<ProposalLine[]>([]);
  const [lineOpen, setLineOpen] = React.useState<null | { index: number | null }>(null);
  const [riskFormOpen, setRiskFormOpen] = React.useState(false);
  const [hydrated, setHydrated] = React.useState(!params.editId);

  // Edit a draft: start from what is saved.
  React.useEffect(() => {
    const p = editing.data;
    if (!p || hydrated) return;
    setRecipient({ type: p.recipientType, id: (p.investorId ?? p.leadId ?? p.familyId)!, name: p.recipientName, phone: p.recipientPhone });
    setTitle(p.title);
    setRisk(p.riskRating);
    if (p.validUntil) setValidUntil(String(p.validUntil).slice(0, 10));
    setCoverLetter(p.coverLetter ?? "");
    setProducts(p.products ?? []);
    setHydrated(true);
  }, [editing.data, hydrated]);

  // ?leadId= / ?investorId= — opened from a lead's journey or a client.
  React.useEffect(() => {
    if (params.editId) return;
    let alive = true;
    const load = params.leadId
      ? api.get<any>(`/api/leads/${params.leadId}`).then((l) => ({ type: "lead" as const, id: l.id, name: l.name, phone: l.phone }))
      : params.investorId
      ? api.get<any>(`/api/investors/${params.investorId}`).then(({ investor: i }) => ({ type: "investor" as const, id: i.id, name: i.name, phone: i.phone }))
      : null;
    load?.then((r) => { if (alive && r?.id) setRecipient((cur) => cur ?? r); }).catch(() => {});
    return () => { alive = false; };
  }, [params.leadId, params.investorId, params.editId]);

  const snap = useRecipientSnapshot(recipient ? {
    investorId: recipient.type === "investor" ? recipient.id : null,
    leadId: recipient.type === "lead" ? recipient.id : null,
    familyId: recipient.type === "family" ? recipient.id : null,
  } : null);
  // The overall risk starts at the client's profile, as on the web.
  React.useEffect(() => {
    if (risk == null && snap.data) setRisk(ratingFromProfile(snap.data.risk.category) ?? "moderate");
  }, [snap.data, risk]);

  const total = products.reduce((s, l) => s + lineAmount(l), 0);
  const hasMf = products.some((l) => l.kind === "mf");
  const busy = create.isPending || update.isPending;

  const save = async () => {
    if (!recipient) return toast.error("Pick a client or lead first");
    if (title.trim().length < 2) return toast.error("Give the proposal a title");
    if (products.length === 0) return toast.error("Add at least one product");
    const content = {
      title: title.trim(),
      type: proposalTypeFor(products),
      riskRating: risk ?? undefined,
      coverLetter: coverLetter.trim() || undefined,
      products,
      validUntil: validUntil ? new Date(`${validUntil}T23:59:59+05:30`).toISOString() : undefined,
    };
    try {
      if (params.editId) {
        await update.mutateAsync(content);
        toast.success("Proposal saved");
        router.back();
        return;
      }
      const r = await create.mutateAsync({
        recipientType: recipient.type,
        ...(recipient.type === "investor" ? { investorId: recipient.id } : recipient.type === "lead" ? { leadId: recipient.id } : { familyId: recipient.id }),
        ...content,
        ...(params.opportunityId && recipient.type === "investor" ? { opportunityId: params.opportunityId } : {}),
      });
      toast.success("Draft saved — send it when you're ready");
      router.replace(`/m/proposals/${r.id}` as any);
    } catch (e) {
      toast.error(describeError(e, "Couldn't save the proposal"));
    }
  };

  if (params.editId && !hydrated) return <View style={{ flex: 1, backgroundColor: palette.surfaceAlt }}><ScreenHeader title="Edit proposal" /><LoadingState /></View>;

  return (
    <View style={{ flex: 1, backgroundColor: palette.surfaceAlt }}>
      <ScreenHeader title={params.editId ? "Edit proposal" : "New proposal"} />
      <Screen scroll padded contentStyle={{ paddingTop: spacing.lg, paddingBottom: 140 }}>
        <SectionLabel text="RECIPIENT" />
        {recipient ? (
          <Pressable onPress={() => !params.editId && setPickerOpen(true)} disabled={!!params.editId}>
            <Card flat style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
              <View style={styles.avatar}><Text style={{ color: palette.white, fontWeight: fontWeight.bold }}>{recipient.name.slice(0, 1).toUpperCase()}</Text></View>
              <View style={{ flex: 1 }}>
                <Text variant="body" numberOfLines={1}>{recipient.name}</Text>
                <Text variant="caption" tone="muted">{recipient.type === "investor" ? "Client" : recipient.type === "lead" ? "Lead" : "Family"}{recipient.phone ? ` · ${recipient.phone}` : ""}</Text>
              </View>
              {!params.editId ? <Feather name="edit-2" size={14} color={palette.faint} /> : null}
            </Card>
          </Pressable>
        ) : (
          <Pressable style={styles.addBtn} onPress={() => setPickerOpen(true)}>
            <Feather name="user-plus" size={16} color={palette.brand} />
            <Text style={{ color: palette.brand, fontWeight: fontWeight.semibold }}>Choose client or lead</Text>
          </Pressable>
        )}
        {snap.data ? (
          <View style={[styles.riskBox, !riskReady(snap.data) && hasMf && { borderColor: palette.warning, backgroundColor: palette.warning + "12" }]}>
            <Text variant="caption">
              Risk profile: <Text variant="caption" style={{ fontWeight: fontWeight.semibold }}>{snap.data.riskExempt ? "Not needed (minor)" : `${snap.data.risk.category ? snap.data.risk.category.replace(/_/g, " ") : "—"} · ${snap.data.risk.status}`}</Text>
              {snap.data.risk.signedAt ? ` · signed ${fmtDate(snap.data.risk.signedAt)}` : ""}
            </Text>
            {!riskReady(snap.data) && hasMf ? (
              <>
                <Text variant="caption" tone="muted">A mutual fund proposal can be sent only after the client confirms a risk profile (signed in the last 12 months).</Text>
                <Text variant="caption" tone="brand" onPress={() => setRiskFormOpen(true)}>Send the risk profile link</Text>
              </>
            ) : null}
          </View>
        ) : null}

        <SectionLabel text="DETAILS" />
        <Card flat>
          <TextField label="Title" value={title} onChangeText={setTitle} required />
          <Text variant="label" tone="muted" style={{ marginBottom: spacing.xs }}>Overall risk</Text>
          <Segmented options={RISKS} value={risk ?? "moderate"} onChange={(v) => setRisk(v as RiskRating)} />
          <View style={{ height: spacing.lg }} />
          <TextField label="Valid until (YYYY-MM-DD)" value={validUntil} onChangeText={setValidUntil} />
          <TextField label="Cover letter (optional)" value={coverLetter} onChangeText={setCoverLetter} multiline />
        </Card>

        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.xl, marginBottom: spacing.sm }}>
          <Text variant="caption" tone="faint" style={{ letterSpacing: 0.6 }}>PRODUCTS ({products.length})</Text>
          {total > 0 ? <Text variant="caption" style={{ fontWeight: fontWeight.semibold, color: palette.ink }}>{inr(total)}</Text> : null}
        </View>
        {products.map((l, i) => (
          <Pressable key={i} onPress={() => setLineOpen({ index: i })}>
            <Card flat style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, marginBottom: spacing.sm }}>
              <View style={styles.pTag}><Text variant="caption" style={{ color: palette.brand, fontWeight: fontWeight.semibold, fontSize: 10 }}>{LINE_KIND_LABEL[l.kind].toUpperCase()}</Text></View>
              <View style={{ flex: 1 }}>
                <Text variant="body" numberOfLines={1}>{lineTitle(l)}</Text>
                <Text variant="caption" tone="muted" numberOfLines={1}>{lineSub(l)}</Text>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel="Remove product" onPress={() => setProducts((p) => p.filter((_, ix) => ix !== i))} hitSlop={8}><Feather name="x" size={18} color={palette.faint} /></Pressable>
            </Card>
          </Pressable>
        ))}
        <Pressable style={styles.addBtn} onPress={() => setLineOpen({ index: null })}>
          <Feather name="plus" size={16} color={palette.brand} />
          <Text style={{ color: palette.brand, fontWeight: fontWeight.semibold }}>Add product</Text>
        </Pressable>
      </Screen>

      <View style={styles.footer}>
        <Pressable style={[styles.save, (!recipient || products.length === 0 || busy) && { opacity: 0.5 }]} onPress={save} disabled={busy}>
          <Text style={styles.saveTxt}>{busy ? "Saving…" : params.editId ? "Save changes" : "Save draft"}</Text>
        </Pressable>
      </View>

      <RecipientPicker visible={pickerOpen} onClose={() => setPickerOpen(false)} onPick={(r) => { setRecipient(r); setRisk(null); setPickerOpen(false); }} />
      {lineOpen ? (
        <LineEditor
          initial={lineOpen.index != null ? products[lineOpen.index] : null}
          onClose={() => setLineOpen(null)}
          onSave={(l) => {
            setProducts((p) => (lineOpen.index != null ? p.map((x, i) => (i === lineOpen.index ? l : x)) : [...p, l]));
            setLineOpen(null);
          }}
        />
      ) : null}
      {recipient && snap.data && recipient.type !== "family" ? (
        <SendFormSheet visible={riskFormOpen} onClose={() => setRiskFormOpen(false)} subjectType={snap.data.kind} subjectId={snap.data.subjectId} name={recipient.name} />
      ) : null}
    </View>
  );
}

function lineSub(l: ProposalLine): string {
  if (l.kind === "mf") {
    const t = l.recommendationType ?? "sip";
    const amt = t === "sip" ? (l.monthlyAmount ? `${inr(l.monthlyAmount)}/mo SIP` : null)
      : t === "lumpsum" ? (l.lumpsum ? `${inr(l.lumpsum)} lumpsum` : null)
      : t === "swp" ? (l.monthlyWithdrawal ? `${inr(l.monthlyWithdrawal)}/mo SWP` : null)
      : (l.monthlyTransfer ? `${inr(l.monthlyTransfer)}/mo STP` : null);
    return [l.amcName, amt, l.riskRating ? RISKOMETER_LABEL[l.riskRating] : null].filter(Boolean).join(" · ");
  }
  const amt = lineAmount(l);
  return amt > 0 ? inr(amt) : "";
}

// ── Recipient picker (clients + leads via global search) ──
function RecipientPicker({ visible, onClose, onPick }: { visible: boolean; onClose: () => void; onPick: (r: Recipient) => void }) {
  const [q, setQ] = React.useState("");
  const search = useSearch(q);
  return (
    <BottomSheet visible={visible} onClose={onClose} title="Choose recipient">
      <SearchBar value={q} onChangeText={setQ} placeholder="Search clients & leads…" />
      <ScrollView style={{ maxHeight: 360, marginTop: spacing.sm }} keyboardShouldPersistTaps="handled">
        {(search.data?.investors ?? []).map((i) => (
          <Pressable key={`i-${i.id}`} style={styles.pickRow} onPress={() => onPick({ type: "investor", id: i.id, name: i.name, phone: i.phone })}>
            <View style={[styles.avatar, { backgroundColor: palette.violet }]}><Text style={{ color: palette.white, fontWeight: fontWeight.bold, fontSize: 12 }}>{i.name.slice(0, 1).toUpperCase()}</Text></View>
            <View style={{ flex: 1 }}><Text variant="body" numberOfLines={1}>{i.name}</Text><Text variant="caption" tone="muted">Client{i.phone ? ` · ${i.phone}` : ""}</Text></View>
          </Pressable>
        ))}
        {(search.data?.leads ?? []).map((l) => (
          <Pressable key={`l-${l.id}`} style={styles.pickRow} onPress={() => onPick({ type: "lead", id: l.id, name: l.name, phone: l.phone })}>
            <View style={[styles.avatar, { backgroundColor: palette.brand }]}><Text style={{ color: palette.white, fontWeight: fontWeight.bold, fontSize: 12 }}>{l.name.slice(0, 1).toUpperCase()}</Text></View>
            <View style={{ flex: 1 }}><Text variant="body" numberOfLines={1}>{l.name}</Text><Text variant="caption" tone="muted">Lead{l.phone ? ` · ${l.phone}` : ""}</Text></View>
          </Pressable>
        ))}
        {q.trim().length >= 2 && !search.isLoading && (search.data?.investors.length ?? 0) + (search.data?.leads.length ?? 0) === 0 ? (
          <Text variant="body" tone="muted" style={{ textAlign: "center", padding: spacing.lg }}>No matches.</Text>
        ) : null}
      </ScrollView>
    </BottomSheet>
  );
}

// ── Line editor ──
type F = Record<string, string>;
/** A number field's value, within the API's limit (it answers 400 above it). */
const capped = (v: string | undefined, max?: number, int?: boolean): number | undefined => {
  if (v == null || v.trim() === "") return undefined;
  const n = Number(v.replace(/,/g, ""));
  if (!Number.isFinite(n) || n < 0) return undefined;
  const r = int ? Math.round(n) : n;
  return max != null ? Math.min(r, max) : r;
};
const str = (v: unknown) => (v == null ? "" : String(v));

function LineEditor({ initial, onClose, onSave }: { initial: ProposalLine | null; onClose: () => void; onSave: (l: ProposalLine) => void }) {
  const [kind, setKind] = React.useState<LineKind>(initial?.kind ?? "mf");
  const [f, setF] = React.useState<F>(() => Object.fromEntries(Object.entries(initial ?? {}).map(([k, v]) => [k, str(v)])));
  const set = (k: string) => (v: string) => setF((s) => ({ ...s, [k]: v }));
  const [schemeFor, setSchemeFor] = React.useState<null | "from" | "to">(null);
  const rec = (f.recommendationType || "sip") as RecommendationType;

  const pickScheme = (s: SchemeHit) => {
    if (schemeFor === "to") setF((x) => ({ ...x, toSchemeName: s.schemeName, toSchemeCode: s.schemeCode }));
    else setF((x) => ({ ...x, schemeName: s.schemeName, schemeCode: s.schemeCode, amcName: s.amc ?? "", category: s.category ?? "", riskRating: riskometerLevel(s.risk?.band) ?? "" }));
    setSchemeFor(null);
  };

  const save = () => {
    const t = (k: string) => (f[k]?.trim() ? f[k].trim() : undefined);
    let line: ProposalLine;
    if (kind === "mf") {
      if (!f.schemeName || !f.schemeCode) return toast.error("Pick the scheme from the Scheme Master");
      if (rec === "stp" && !f.toSchemeCode) return toast.error("Pick the scheme it transfers to");
      const base: MfLine = {
        kind: "mf", schemeName: f.schemeName, schemeCode: f.schemeCode, amcName: t("amcName"), category: t("category"),
        riskRating: (t("riskRating") as MfLine["riskRating"]) || undefined, planType: "regular", recommendationType: rec,
        goal: t("goal"), notes: t("notes"),
      };
      line = rec === "sip" ? { ...base, monthlyAmount: capped(f.monthlyAmount), stepUpPct: capped(f.stepUpPct, 100), lumpsum: capped(f.lumpsum), sipTermYears: capped(f.sipTermYears, 50), expectedReturn: capped(f.expectedReturn, 60) }
        : rec === "lumpsum" ? { ...base, lumpsum: capped(f.lumpsum), sipTermYears: capped(f.sipTermYears, 50), expectedReturn: capped(f.expectedReturn, 60) }
        : rec === "swp" ? { ...base, corpusRequired: capped(f.corpusRequired), monthlyWithdrawal: capped(f.monthlyWithdrawal), swpPeriodMonths: capped(f.swpPeriodMonths, 600, true) }
        : { ...base, toSchemeName: f.toSchemeName, toSchemeCode: f.toSchemeCode, monthlyTransfer: capped(f.monthlyTransfer), numInstallments: capped(f.numInstallments, 600, true) };
      if (rec === "sip" && !line.monthlyAmount) return toast.error("Enter the monthly SIP");
      if (rec === "lumpsum" && !(line as MfLine).lumpsum) return toast.error("Enter the lumpsum");
    } else if (kind === "insurance") {
      if (!t("policyName")) return toast.error("Policy name is required");
      const insurer = f.insurer === "__other" ? t("insurerOther") : t("insurer");
      line = { kind, policyName: f.policyName.trim(), insurer, policyType: (t("policyType") as any) || undefined, sumAssured: capped(f.sumAssured), annualPremium: capped(f.annualPremium), termYears: capped(f.termYears, 99), notes: t("notes") };
    } else if (kind === "pms") {
      if (!t("strategyName")) return toast.error("Strategy name is required");
      line = { kind, strategyName: f.strategyName.trim(), manager: t("manager"), proposedAmount: capped(f.proposedAmount), expectedReturn: capped(f.expectedReturn, 60), termYears: capped(f.termYears, 50), notes: t("notes") };
    } else if (kind === "aif") {
      if (!t("fundName")) return toast.error("Fund name is required");
      line = { kind, fundName: f.fundName.trim(), manager: t("manager"), category: (t("category") as any) || undefined, proposedAmount: capped(f.proposedAmount), lockInYears: capped(f.lockInYears, 20), targetIrr: capped(f.targetIrr, 60), notes: t("notes") };
    } else {
      if (!t("productName")) return toast.error("Product name is required");
      line = { kind, productName: f.productName.trim(), company: t("company"), amount: capped(f.amount), expectedReturn: capped(f.expectedReturn, 60), termYears: capped(f.termYears, 99), notes: t("notes") };
    }
    onSave(line);
  };

  const n = (k: string, label: string) => <TextField key={k} label={label} value={f[k] ?? ""} onChangeText={set(k)} keyboardType="numeric" />;
  const insurerListed = !f.insurer || f.insurer === "__other" || INSURERS.includes(f.insurer);

  return (
    <BottomSheet visible onClose={onClose} title={initial ? "Edit product" : "Add product"}>
      {!initial ? <Segmented options={KINDS.map((k) => ({ key: k, label: LINE_KIND_LABEL[k] }))} value={kind} onChange={(v) => { setKind(v as LineKind); setF({}); }} /> : null}
      <ScrollView style={{ maxHeight: 460, marginTop: spacing.lg }} keyboardShouldPersistTaps="handled">
        {kind === "mf" ? (
          <>
            <Pressable style={styles.schemeBtn} onPress={() => setSchemeFor("from")} accessibilityRole="button">
              <Feather name="search" size={15} color={palette.brand} />
              <View style={{ flex: 1 }}>
                <Text variant="body" numberOfLines={2} style={{ color: f.schemeName ? palette.ink : palette.faint }}>{f.schemeName || "Pick a scheme from the Scheme Master"}</Text>
                {f.schemeName ? <Text variant="caption" tone="muted" numberOfLines={1}>{[f.amcName, f.category, f.riskRating ? RISKOMETER_LABEL[f.riskRating as keyof typeof RISKOMETER_LABEL] : null].filter(Boolean).join(" · ")}</Text> : null}
              </View>
            </Pressable>
            <Text variant="label" tone="muted" style={{ marginBottom: spacing.xs }}>Recommendation</Text>
            <Segmented options={[{ key: "sip", label: "SIP" }, { key: "lumpsum", label: "Lumpsum" }, { key: "swp", label: "SWP" }, { key: "stp", label: "STP" }]} value={rec} onChange={(v) => set("recommendationType")(v)} />
            <View style={{ height: spacing.md }} />
            {rec === "sip" ? <>{n("monthlyAmount", "Monthly SIP (₹)")}{n("stepUpPct", "Yearly step-up (%)")}{n("lumpsum", "Lumpsum alongside (₹)")}{n("sipTermYears", "SIP term (years)")}{n("expectedReturn", "Expected return (% a year)")}</> : null}
            {rec === "lumpsum" ? <>{n("lumpsum", "Lumpsum (₹)")}{n("sipTermYears", "Horizon (years)")}{n("expectedReturn", "Expected return (% a year)")}</> : null}
            {rec === "swp" ? <>{n("corpusRequired", "Corpus required (₹)")}{n("monthlyWithdrawal", "Monthly withdrawal (₹)")}{n("swpPeriodMonths", "Period (months)")}</> : null}
            {rec === "stp" ? (
              <>
                <Pressable style={styles.schemeBtn} onPress={() => setSchemeFor("to")} accessibilityRole="button">
                  <Feather name="arrow-right" size={15} color={palette.brand} />
                  <Text variant="body" numberOfLines={2} style={{ flex: 1, color: f.toSchemeName ? palette.ink : palette.faint }}>{f.toSchemeName || "Transfer into… (Scheme Master)"}</Text>
                </Pressable>
                {n("monthlyTransfer", "Monthly transfer (₹)")}{n("numInstallments", "Instalments")}
              </>
            ) : null}
            <TextField label="Goal (optional)" value={f.goal ?? ""} onChangeText={set("goal")} />
          </>
        ) : null}
        {kind === "insurance" ? (
          <>
            <TextField label="Policy name" required value={f.policyName ?? ""} onChangeText={set("policyName")} />
            <SelectField label="Insurer" value={insurerListed ? f.insurer || null : "__other"} placeholder="Pick the insurer"
              options={[...INSURERS.map((i) => ({ value: i, label: i })), { value: "__other", label: "Other" }]} onChange={set("insurer")} />
            {f.insurer === "__other" || !insurerListed ? <TextField label="Insurer name" value={f.insurerOther ?? (insurerListed ? "" : f.insurer)} onChangeText={set("insurerOther")} /> : null}
            <SelectField label="Policy type" value={f.policyType || null} placeholder="Select"
              options={[{ value: "term", label: "Term" }, { value: "health", label: "Health" }, { value: "ulip", label: "ULIP" }, { value: "endowment", label: "Endowment" }, { value: "money_back", label: "Money back" }, { value: "other", label: "Other" }]} onChange={set("policyType")} />
            {n("sumAssured", "Sum assured (₹)")}{n("annualPremium", "Annual premium (₹)")}{n("termYears", "Term (years)")}
          </>
        ) : null}
        {kind === "pms" ? <><TextField label="Strategy name" required value={f.strategyName ?? ""} onChangeText={set("strategyName")} /><TextField label="Manager" value={f.manager ?? ""} onChangeText={set("manager")} />{n("proposedAmount", "Proposed amount (₹)")}{n("expectedReturn", "Expected return (% a year)")}{n("termYears", "Term (years)")}</> : null}
        {kind === "aif" ? (
          <>
            <TextField label="Fund name" required value={f.fundName ?? ""} onChangeText={set("fundName")} />
            <TextField label="Manager" value={f.manager ?? ""} onChangeText={set("manager")} />
            <SelectField label="Category" value={f.category || null} placeholder="Select" options={[{ value: "cat1", label: "Category I" }, { value: "cat2", label: "Category II" }, { value: "cat3", label: "Category III" }]} onChange={set("category")} />
            {n("proposedAmount", "Proposed amount (₹)")}{n("lockInYears", "Lock-in (years)")}{n("targetIrr", "Target IRR (%)")}
          </>
        ) : null}
        {kind === "other" ? <><TextField label="Product name" required value={f.productName ?? ""} onChangeText={set("productName")} /><TextField label="Company" value={f.company ?? ""} onChangeText={set("company")} />{n("amount", "Amount (₹)")}{n("expectedReturn", "Expected return (% a year)")}{n("termYears", "Term (years)")}</> : null}
        <TextField label="Notes (optional)" value={f.notes ?? ""} onChangeText={set("notes")} multiline />
      </ScrollView>
      <Pressable style={[styles.save, { marginTop: spacing.sm }]} onPress={save}>
        <Text style={styles.saveTxt}>{initial ? "Save product" : "Add to proposal"}</Text>
      </Pressable>
      {schemeFor ? <SchemePicker onClose={() => setSchemeFor(null)} onPick={pickScheme} /> : null}
    </BottomSheet>
  );
}

/** The firm's Scheme Master, Regular plans only — pick, never type. */
function SchemePicker({ onClose, onPick }: { onClose: () => void; onPick: (s: SchemeHit) => void }) {
  const [q, setQ] = React.useState("");
  const [amc, setAmc] = React.useState<string | null>(null);
  const amcs = useAmcs();
  const res = useSchemeSearch(q, amc);
  const rows = res.data?.schemes ?? [];
  const empty = res.data?.masterEmpty || amcs.data?.masterEmpty;
  return (
    <BottomSheet visible onClose={onClose} title="Pick a scheme">
      {empty ? <Text variant="caption" style={{ color: palette.warning, marginBottom: spacing.sm }}>The firm's Scheme Master is empty — sync it in the CRM first.</Text> : null}
      <SelectField label="AMC" value={amc} placeholder="Any AMC" options={(amcs.data?.amcs ?? []).map((a) => ({ value: a.code, label: a.name }))} onChange={setAmc} />
      <SearchBar value={q} onChangeText={setQ} placeholder="Search scheme name…" />
      <ScrollView style={{ maxHeight: 340, marginTop: spacing.sm }} keyboardShouldPersistTaps="handled">
        {rows.map((s) => (
          <Pressable key={s.schemeCode} style={styles.pickRow} onPress={() => onPick(s)}>
            <View style={{ flex: 1 }}>
              <Text variant="body" numberOfLines={2}>{s.schemeName}</Text>
              <Text variant="caption" tone="muted" numberOfLines={1}>{[s.amc, s.category, s.risk?.label].filter(Boolean).join(" · ")}</Text>
            </View>
            <Feather name="plus-circle" size={16} color={palette.brand} />
          </Pressable>
        ))}
        {(q.trim().length >= 2 || amc) && !res.isFetching && rows.length === 0 && !empty ? <Text variant="body" tone="muted" style={{ textAlign: "center", padding: spacing.lg }}>No Regular-plan scheme matches.</Text> : null}
      </ScrollView>
    </BottomSheet>
  );
}

function SectionLabel({ text }: { text: string }) {
  return <Text variant="caption" tone="faint" style={{ letterSpacing: 0.6, marginTop: spacing.xl, marginBottom: spacing.sm }}>{text}</Text>;
}

const styles = StyleSheet.create({
  avatar: { width: 36, height: 36, borderRadius: radius.pill, backgroundColor: palette.brand, alignItems: "center", justifyContent: "center" },
  addBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, borderWidth: 1, borderColor: palette.brand, borderStyle: "dashed", borderRadius: radius.md, paddingVertical: spacing.md },
  pTag: { backgroundColor: palette.brandLight, borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 3 },
  pickRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.lineSoft },
  riskBox: { marginTop: spacing.sm, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.surface, gap: 4 },
  schemeBtn: { flexDirection: "row", alignItems: "center", gap: spacing.sm, borderWidth: 1, borderColor: palette.line, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md, backgroundColor: palette.surface },
  footer: { position: "absolute", left: 0, right: 0, bottom: 0, padding: spacing.lg, backgroundColor: palette.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.line },
  save: { backgroundColor: palette.brand, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: "center" },
  saveTxt: { color: palette.white, fontWeight: fontWeight.semibold, fontSize: 15 },
});

