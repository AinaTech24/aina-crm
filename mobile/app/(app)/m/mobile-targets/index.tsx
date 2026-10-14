import React, { useState } from "react";
import { View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Screen, ScreenHeader, Card, Text, TextField, SelectField, Button } from "../../../../src/components/ui";
import { ErrorState, LoadingState } from "../../../../src/components/states";
import { api } from "../../../../src/api/client";
import { MonthField } from "../../../../src/components/form/MonthField";
import { spacing, palette } from "../../../../src/theme/tokens";
import { inr } from "../../../../src/lib/format";
import { toast } from "../../../../src/lib/toast";
import { errorMessage } from "../../../../src/lib/errors";
export default function Targets() {
  const now = new Date();
  const [period, setPeriod] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
  const [scopeType, setScopeType] = useState("user"), [scopeId, setScopeId] = useState("");
  const [editing, setEditing] = useState(false);
  const [edits, setEdits] = useState<Record<string, string>>({}), [busy, setBusy] = useState(false);
  const valid = /^\d{4}-(0[1-9]|1[0-2])$/.test(period);
  const q = useQuery({ queryKey: ["mobile-targets", period, scopeType, scopeId], enabled: valid,
    queryFn: () => api.get<any>("/api/mobile/targets", { period, scopeType, scopeId }) });
  const save = async () => {
    setBusy(true);
    try {
      const metrics = Object.entries(edits).map(([metric, value]) => {
        const definition = q.data.metrics.find((m: any) => m.key === metric);
        if (!value.trim() || !Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 1e12 || (definition?.unit === "count" && !Number.isInteger(Number(value)))) throw new Error("Enter non-negative targets; meeting and policy counts must be whole numbers.");
        return { metric, target: Number(value) };
      });
      await api.post("/api/mobile/targets", { period, scopeType, scopeId: q.data.scopeId, metrics });
      setEditing(false);
      setEdits({}); await q.refetch(); toast.success("Monthly targets saved");
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  return <View style={{ flex: 1 }}><ScreenHeader title="Targets vs achievement" />
    <Screen scroll padded><MonthField value={period} disabled={editing || busy} onChange={setPeriod} />
      {!valid ? <Text tone="danger">Enter a month such as 2026-09.</Text> : q.isLoading ? <LoadingState /> : q.isError ? <ErrorState onRetry={q.refetch} /> : q.data ? <>
        {!editing && q.data.branches.length ? <SelectField label="View" value={scopeType} options={[{ value: "user", label: "Team member" }, { value: "branch", label: "Branch" }]}
          onChange={v => { setScopeType(v); setScopeId(""); setEdits({}); }} /> : null}
        {!editing ? <SelectField label={scopeType === "branch" ? "Branch" : "Team member"} value={q.data.scopeId}
          options={(scopeType === "branch" ? q.data.branches : q.data.members).map((m: any) => ({ value: m.id, label: m.name }))}
          onChange={v => { setScopeId(v); setEdits({}); }} /> : null}
        {q.data.canEdit && !editing ? <Button label="Edit monthly targets" variant="secondary" onPress={() => setEditing(true)} /> : null}
        {q.data.metrics.map((m: any) => { const target = m.target === null ? null : Number(m.target), pct = target && target > 0 ? m.actual / target * 100 : 0;
          const format = (n: number) => m.unit === "inr" ? inr(n) : n.toLocaleString("en-IN");
          return <Card key={m.key} style={{ marginVertical: spacing.sm }}><Text variant="subtitle">{m.label}</Text>
            <Text>{format(m.actual)} / {target === null ? "Target not set" : format(target)}</Text>
            {target !== null && target > 0 ? <><View style={{ height: 6, backgroundColor: palette.line, borderRadius: 3, marginVertical: spacing.sm }}><View style={{ height: 6, width: `${Math.min(100, pct)}%`, backgroundColor: palette.brand, borderRadius: 3 }} /></View><Text variant="caption">{Math.round(pct)}% achieved</Text></> : null}
            {target !== null ? <Text tone="muted">Remaining: {format(Math.max(0, target - m.actual))}</Text> : null}
            {q.data.canEdit && editing ? <TextField disabled={busy} label="Monthly target" keyboardType="decimal-pad" value={edits[m.key] ?? (target === null ? "" : String(target))} onChangeText={v => setEdits(e => ({ ...e, [m.key]: v }))} /> : null}
          </Card>; })}
        {q.data.canEdit && editing ? <View style={{ gap: spacing.sm }}><Button label="Save all targets" loading={busy} disabled={!Object.keys(edits).length} onPress={save} /><Button label="Cancel edits" variant="secondary" disabled={busy} onPress={() => { setEdits({}); setEditing(false); }} /></View> : null}
        <Text variant="caption" tone="muted" style={{ marginVertical: spacing.md }}>Completed meetings and confirmed business only. SIP is normalized to monthly instalments. Insurance uses policy start month and annual premium. These monthly targets are separate from annual CRM quotas.</Text>
      </> : null}</Screen></View>;
}
