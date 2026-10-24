import React, { useState, useEffect } from "react";
import { View, ScrollView, KeyboardAvoidingView, Platform } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Screen, ScreenHeader, Text, Card, Button, TextField, SelectField } from "../../../../src/components/ui";
import { TypeaheadField } from "../../../../src/components/form/TypeaheadField";
import { DateField } from "../../../../src/components/form/DateField";
import { api } from "../../../../src/api/client";
import { spacing, palette } from "../../../../src/theme/tokens";
import { inr, titleCase } from "../../../../src/lib/format";
import { ErrorState, LoadingState } from "../../../../src/components/states";
import { toast } from "../../../../src/lib/toast";
import { errorMessage } from "../../../../src/lib/errors";
import { useFormDraft } from "../../../../src/lib/useFormDraft";
import { isoDay } from "../../../../src/features/dashboard/api";
const blank = () => ({ investorId: "", client: "", rmId: "", product: "sip", amount: "", name: "", provider: "", date: isoDay(new Date()), reference: "", notes: "" });
export default function BusinessEntries() {
  const qc = useQueryClient(), router = useRouter(), insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ create?: string }>();
  const [mode, setMode] = useState<"list" | "entry" | "review" | "saved">(params.create === "1" ? "entry" : "list");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const draft = useFormDraft("business-entry", blank, true);
  const form = draft.value, setForm = draft.setValue;
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [filters, setFilters] = useState({ q: "", product: "", rmId: "", from: "", to: "" });
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0), [showFilters, setShowFilters] = useState(false);
  useEffect(() => { const timer = setTimeout(() => { setFilters(f => ({ ...f, q: search })); setPage(0); }, 350); return () => clearTimeout(timer); }, [search]);
  const q = useQuery({ queryKey: ["mobile-business", filters, page], queryFn: () => api.get<any>("/api/mobile/business", { ...filters, page: String(page) }) });
  const field = (key: keyof typeof form, value: string) => { setForm(f => ({ ...f, [key]: value })); setErrors(e => ({ ...e, [key]: "" })); };
  const filter = (key: keyof typeof filters, value: string) => { setPage(0); setFilters(f => ({ ...f, [key]: value })); };
  const insurance = ["life", "health", "motor"].includes(form.product);
  const review = () => {
    const e: Record<string, string> = {};
    if (!form.investorId) e.investorId = "Choose a client";
    if (!form.rmId) e.rmId = "Choose the credited RM";
    if (!form.name.trim()) e.name = "Enter the product name";
    if (!form.provider.trim()) e.provider = "Enter the provider";
    if (!(Number(form.amount) > 0) || !Number.isFinite(Number(form.amount)) || Number(form.amount) > 1e12) e.amount = "Enter an amount greater than zero and no more than ₹1 trillion";
    const d = new Date(form.date + "T00:00:00");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.date) || !Number.isFinite(d.getTime()) || isoDay(d) !== form.date) e.date = "Choose a valid date";
    setErrors(e); setError(""); if (!Object.keys(e).length) setMode("review");
  };
  const save = async () => {
    setError(""); setBusy(true);
    try {
      await api.post("/api/mobile/business", { ...form, amount: Number(form.amount) });
      qc.invalidateQueries({ queryKey: ["mobile-business"] }); qc.invalidateQueries({ queryKey: ["mobile-targets"] });
      await draft.clear().catch(() => toast.info("Business saved. The local draft could not be removed."));
      setMode("saved"); toast.success("Business saved to CRM");
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  const issue = (key: string) => errors[key] ? <Text tone="danger" style={{ marginBottom: spacing.sm }}>{errors[key]}</Text> : null;
  const back = () => { if (busy) return; if (mode === "review") setMode("entry"); else if (mode !== "list") setMode("list"); else router.back(); };
  return <View style={{ flex: 1, backgroundColor: palette.surfaceAlt }}>
    <ScreenHeader title={mode === "list" ? "Business history" : mode === "review" ? "Review business" : mode === "saved" ? "Business saved" : "Enter business"} subtitle={mode === "entry" ? "Complete the details, then review before saving" : "SIP · Lumpsum · Insurance"} onBack={back} />
    {q.isLoading || !draft.ready ? <LoadingState /> : q.isError ? <ErrorState onRetry={q.refetch} /> : mode === "list" || !q.data?.canEnter ? <Screen scroll padded onRefresh={q.refetch} refreshing={q.isRefetching}>
      {q.data?.canEnter ? <Button label="Enter business" onPress={() => setMode("entry")} /> : null}
      <TextField label="Search client" value={search} onChangeText={setSearch} />
      <Button label={showFilters ? "Hide filters" : "Filter history"} variant="secondary" onPress={() => setShowFilters(!showFilters)} />
      {showFilters ? <Card style={{ marginVertical: spacing.md }}>
        <SelectField label="Product" value={filters.product} options={[{ value: "", label: "All products" }, ...["mutual_fund", "life", "health", "motor", "other"].map(value => ({ value, label: titleCase(value) }))]} onChange={v => filter("product", v)} />
        <SelectField label="RM" value={filters.rmId} options={[{ value: "", label: "All visible RMs" }, ...(q.data?.members || []).map((m: any) => ({ value: m.id, label: m.name }))]} onChange={v => filter("rmId", v)} />
        <DateField label="From" value={filters.from} onChange={v => filter("from", v)} /><DateField label="To" value={filters.to} onChange={v => filter("to", v)} />
        <Button label="Clear filters" variant="secondary" onPress={() => { setFilters({ q: "", product: "", rmId: "", from: "", to: "" }); setSearch(""); setPage(0); }} />
      </Card> : null}
      {!q.data?.entries.length ? <Text style={{ marginVertical: spacing.lg }}>No business matches these filters.</Text> : null}
      {(q.data?.entries || []).map((e: any) => <Card key={`${e.kind}-${e.id}`} style={{ marginTop: spacing.md }}><Text variant="subtitle">{e.client}</Text><Text>{titleCase(e.product)} · {inr(Number(e.amount || 0))}</Text><Text tone="muted">{e.date || "No date"} · {e.rm || "Unassigned"} · {titleCase(e.status)}</Text></Card>)}
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginVertical: spacing.lg }}><Button label="Previous" variant="secondary" disabled={!page} onPress={() => setPage(p => p - 1)} /><Text>Page {page + 1}</Text><Button label="Next" variant="secondary" disabled={!q.data?.hasMore} onPress={() => setPage(p => p + 1)} /></View>
    </Screen> : mode === "saved" ? <Screen padded scroll><Card><Text variant="subtitle">{inr(Number(form.amount))} recorded</Text><Text>{form.client} · {form.name}</Text><Text tone="muted">Saved to your firm's business records.</Text></Card><View style={{ gap: spacing.md, marginTop: spacing.lg }}><Button label="Add another business" onPress={() => { setForm(blank()); setErrors({}); setMode("entry"); }} /><Button label="Done" variant="secondary" onPress={() => { setForm(blank()); setMode("list"); }} /></View></Screen> : <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg }} keyboardShouldPersistTaps="handled">
        {draft.status ? <Text variant="caption" tone="muted" style={{ marginBottom: spacing.md }}>{draft.status}</Text> : null}
        {mode === "review" ? <Card style={{ gap: spacing.md }}>
          <Text variant="subtitle">{form.client || "Selected client"}</Text><Text>Credit to: {q.data?.members.find((m: any) => m.id === form.rmId)?.name}</Text>
          <Text>{titleCase(form.product)} · {form.name}</Text><Text>{form.provider}</Text><Text variant="heading">{inr(Number(form.amount))}</Text>
          <Text tone="muted">{insurance ? "Annual premium" : form.product === "sip" ? "Monthly SIP instalment" : "Investment amount"}</Text><Text>Date: {form.date}</Text>
          {form.reference ? <Text>Reference: {form.reference}</Text> : null}{form.notes ? <Text>{form.notes}</Text> : null}
          <Button label="Edit details" variant="secondary" disabled={busy} onPress={() => setMode("entry")} />
        </Card> : <>
          <Card><Text variant="subtitle">Client & credited RM</Text>
            <TypeaheadField field={{ key: "investorId", label: "Client", required: true, searchEndpoint: "/api/search", searchEnvelope: "investors", searchLabel: r => r.name }} value={form.investorId} displayLabel={form.client} onSelect={r => field("client", r.name)} onChange={v => { field("investorId", v); if (!v) field("client", ""); }} />{issue("investorId")}
            <SelectField label="Credit to RM" required value={form.rmId} options={(q.data?.members || []).map((m: any) => ({ value: m.id, label: m.name }))} onChange={v => field("rmId", v)} />{issue("rmId")}
          </Card>
          <Card style={{ marginTop: spacing.md }}><Text variant="subtitle">Product details</Text>
            <SelectField label="Product" value={form.product} options={["sip", "lumpsum", "life", "health", "motor", "other"].map(value => ({ value, label: titleCase(value) }))} onChange={v => field("product", v)} />
            <TextField label={insurance ? "Plan name" : "Scheme / product name"} required value={form.name} error={errors.name} onChangeText={v => field("name", v)} />
            <TextField label={insurance ? "Insurer" : "AMC / provider"} required value={form.provider} error={errors.provider} onChangeText={v => field("provider", v)} />
            <TextField label={insurance ? "Annual premium (₹)" : form.product === "sip" ? "Monthly SIP instalment (₹)" : "Investment amount (₹)"} required keyboardType="decimal-pad" value={form.amount} error={errors.amount} onChangeText={v => field("amount", v)} />
            {Number(form.amount) > 0 ? <Text tone="muted">{inr(Number(form.amount))}</Text> : null}
            <DateField label="Business / policy start date" required value={form.date} error={errors.date} onChange={v => field("date", v)} />
            <TextField label={insurance ? "Policy number" : "Folio / reference"} value={form.reference} onChangeText={v => field("reference", v)} /><TextField label="Notes" value={form.notes} onChangeText={v => field("notes", v)} multiline />
          </Card>
        </>}
        {error ? <Text tone="danger" style={{ marginTop: spacing.md }}>{error}</Text> : null}
      </ScrollView>
      <View style={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.md, backgroundColor: palette.surface }}><Text variant="caption" tone="muted" style={{ marginBottom: spacing.sm }}>Internet connection required to save business.</Text><Button full label={mode === "review" ? "Save business" : "Review business"} loading={busy} onPress={mode === "review" ? save : review} /></View>
    </KeyboardAvoidingView>}
  </View>;
}
