import React, { useState } from "react";
import { View, ScrollView } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Screen, ScreenHeader, Text, Card, Button, TextField, SelectField, BottomSheet } from "../../../../src/components/ui";
import { TypeaheadField } from "../../../../src/components/form/TypeaheadField";
import { api } from "../../../../src/api/client";
import { spacing } from "../../../../src/theme/tokens";
import { inr, titleCase } from "../../../../src/lib/format";
import { ErrorState, LoadingState } from "../../../../src/components/states";
import { toast } from "../../../../src/lib/toast";
import { errorMessage } from "../../../../src/lib/errors";
const today = () => new Date().toLocaleDateString("en-CA");
export default function BusinessEntries() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["mobile-business"], queryFn: () => api.get<any>("/api/mobile/business") });
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [form, setForm] = useState({ investorId: "", rmId: "", product: "sip", amount: "", name: "", provider: "", date: today(), reference: "", notes: "" });
  const field = (key: keyof typeof form, value: string) => setForm(f => ({ ...f, [key]: value }));
  const insurance = ["life", "health", "motor"].includes(form.product);
  const save = async () => {
    setError("");
    if (!form.investorId || !form.rmId || !form.name.trim() || !form.provider.trim() || !(Number(form.amount) > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(form.date)) return setError("Choose a client and RM, then complete product, amount and date.");
    setBusy(true);
    try { await api.post("/api/mobile/business", { ...form, amount: Number(form.amount) }); await qc.invalidateQueries({ queryKey: ["mobile-business"] }); qc.invalidateQueries({ queryKey: ["mobile-targets"] }); setOpen(false); field("amount", ""); toast.success("Business entered"); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  return <View style={{ flex: 1 }}><ScreenHeader title="Business entries" subtitle="SIP · Lumpsum · Insurance" />
    <Screen scroll padded onRefresh={q.refetch} refreshing={q.isRefetching}>
      {q.isLoading ? <LoadingState /> : q.isError ? <ErrorState onRetry={q.refetch} /> : <>
        {q.data.canEnter ? <Button label="Enter business" onPress={() => setOpen(true)} /> : <Text tone="muted" variant="caption">Operations enters business. Your records appear here.</Text>}
        {(q.data.entries as any[]).length === 0 ? <Text style={{ marginTop: spacing.lg }}>No business entries yet.</Text> : null}
        {(q.data.entries as any[]).map(e => <Card key={e.id} style={{ marginTop: spacing.md }}><Text variant="subtitle">{e.client}</Text>
          <Text>{titleCase(e.product)} · {inr(Number(e.amount || 0))}</Text><Text tone="muted" variant="caption">{e.date || "No date"} · {e.rm || "Unassigned"} · {e.status}</Text></Card>)}
      </>}
    </Screen>
    <BottomSheet visible={open} onClose={() => { if (!busy) setOpen(false); }} title="Enter business">
      <ScrollView style={{ maxHeight: 480 }} keyboardShouldPersistTaps="handled">
      <TypeaheadField field={{ key: "investorId", label: "Client", searchEndpoint: "/api/search", searchEnvelope: "investors", searchLabel: r => r.name }} value={form.investorId} onChange={v => field("investorId", v)} />
      <SelectField label="Credit to RM" value={form.rmId} options={(q.data?.members || []).map((m: any) => ({ value: m.id, label: m.name }))} onChange={v => field("rmId", v)} />
      <SelectField label="Product" value={form.product} options={["sip", "lumpsum", "life", "health", "motor", "other"].map(value => ({ value, label: titleCase(value) }))} onChange={v => field("product", v)} />
      <TextField label={insurance ? "Plan name" : "Scheme / product name"} value={form.name} onChangeText={v => field("name", v)} />
      <TextField label={insurance ? "Insurer" : "AMC / provider"} value={form.provider} onChangeText={v => field("provider", v)} />
      <TextField label={insurance ? "Annual premium (₹)" : form.product === "sip" ? "Monthly SIP instalment (₹)" : "Investment amount (₹)"} keyboardType="decimal-pad" value={form.amount} onChangeText={v => field("amount", v)} />
      <TextField label="Business / policy start date (YYYY-MM-DD)" value={form.date} onChangeText={v => field("date", v)} />
      <TextField label={insurance ? "Policy number" : "Folio / reference"} value={form.reference} onChangeText={v => field("reference", v)} />
      <TextField label="Notes" value={form.notes} onChangeText={v => field("notes", v)} multiline />
      {error ? <Text tone="danger">{error}</Text> : null}<Button label="Save business" loading={busy} onPress={save} />
      </ScrollView>
    </BottomSheet>
  </View>;
}
