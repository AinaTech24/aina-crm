import React, { useState } from "react";
import { View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Screen, ScreenHeader, Card, Text, TextField, SelectField, Button } from "../../../../src/components/ui";
import { ErrorState, LoadingState } from "../../../../src/components/states";
import { api } from "../../../../src/api/client";
import { spacing, palette } from "../../../../src/theme/tokens";
import { inr } from "../../../../src/lib/format";
import { toast } from "../../../../src/lib/toast";
import { errorMessage } from "../../../../src/lib/errors";
export default function Targets() {
  const now = new Date();
  const [period, setPeriod] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
  const [scopeType, setScopeType] = useState("user"), [scopeId, setScopeId] = useState("");
  const [edits, setEdits] = useState<Record<string, string>>({}), [busy, setBusy] = useState(false);
  const valid = /^\d{4}-(0[1-9]|1[0-2])$/.test(period);
  const q = useQuery({ queryKey: ["mobile-targets", period, scopeType, scopeId], enabled: valid,
    queryFn: () => api.get<any>("/api/mobile/targets", { period, scopeType, scopeId }) });
  const save = async () => {
    setBusy(true);
    try {
      for (const [metric, value] of Object.entries(edits)) {
        if (!value.trim() || !Number.isFinite(Number(value)) || Number(value) < 0) throw new Error("Enter a valid target; use zero for no planned activity.");
        await api.post("/api/mobile/targets", { period, scopeType, scopeId: q.data.scopeId, metric, target: Number(value) });
      }
      setEdits({}); await q.refetch(); toast.success("Monthly targets saved");
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  return <View style={{ flex: 1 }}><ScreenHeader title="Targets vs achievement" />
    <Screen scroll padded><TextField label="Month (YYYY-MM)" value={period} onChangeText={v => { setPeriod(v); setEdits({}); }} />
      {!valid ? <Text tone="danger">Enter a month such as 2026-09.</Text> : q.isLoading ? <LoadingState /> : q.isError ? <ErrorState onRetry={q.refetch} /> : q.data ? <>
        {q.data.branches.length ? <SelectField label="View" value={scopeType} options={[{ value: "user", label: "Team member" }, { value: "branch", label: "Branch" }]}
          onChange={v => { setScopeType(v); setScopeId(""); setEdits({}); }} /> : null}
        <SelectField label={scopeType === "branch" ? "Branch" : "Team member"} value={q.data.scopeId}
          options={(scopeType === "branch" ? q.data.branches : q.data.members).map((m: any) => ({ value: m.id, label: m.name }))}
          onChange={v => { setScopeId(v); setEdits({}); }} />
        {q.data.metrics.map((m: any) => { const target = m.target === null ? null : Number(m.target), pct = target && target > 0 ? m.actual / target * 100 : 0;
          const format = (n: number) => m.unit === "inr" ? inr(n) : n.toLocaleString("en-IN");
          return <Card key={m.key} style={{ marginVertical: spacing.sm }}><Text variant="subtitle">{m.label}</Text>
            <Text>{format(m.actual)} / {target === null ? "Target not set" : format(target)}</Text>
            {target !== null && target > 0 ? <><View style={{ height: 6, backgroundColor: palette.line, borderRadius: 3, marginVertical: spacing.sm }}><View style={{ height: 6, width: `${Math.min(100, pct)}%`, backgroundColor: palette.brand, borderRadius: 3 }} /></View><Text variant="caption">{Math.round(pct)}% achieved</Text></> : null}
            {q.data.canEdit ? <TextField label="Monthly target" keyboardType="decimal-pad" value={edits[m.key] ?? (target === null ? "" : String(target))} onChangeText={v => setEdits(e => ({ ...e, [m.key]: v }))} /> : null}
          </Card>; })}
        {q.data.canEdit ? <Button label="Save targets" loading={busy} disabled={!Object.keys(edits).length} onPress={save} /> : null}
        <Text variant="caption" tone="muted" style={{ marginVertical: spacing.md }}>Completed meetings and confirmed business only. SIP is normalized to monthly instalments. Insurance uses policy start month and annual premium. These monthly targets are separate from annual CRM quotas.</Text>
      </> : null}</Screen></View>;
}
