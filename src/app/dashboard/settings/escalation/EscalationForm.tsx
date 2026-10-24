"use client";

/**
 * The escalation ladder form (lib/tasks/escalation-ladder.ts). One default row
 * and any number of specific rules (department / type / priority); each gives
 * the hours overdue at which a task reaches the manager, the branch head and
 * the owner. A blank hour skips that level.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { FormActions } from "@/components/ui/FormActions";
import { notify } from "@/components/ui/Toast";
import { formatDate, humanise } from "@/lib/format";
import type { Ladder, LadderRule } from "@/lib/tasks/escalation-ladder";

const DEPARTMENTS = ["sales", "operations", "back_office", "compliance", "marketing", "advisory", "support", "leadership", "other"];
const PRIORITIES = ["urgent", "high", "normal", "low"] as const;
const LEVELS = [
  { key: "l1Hours", label: "Manager" },
  { key: "l2Hours", label: "Branch head" },
  { key: "l3Hours", label: "Owner" },
] as const;

type HourKey = (typeof LEVELS)[number]["key"];

function HoursInput({ value, onChange, label }: { value: number | null; onChange: (v: number | null) => void; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <input
        type="number"
        inputMode="numeric"
        min={1}
        max={1440}
        aria-label={`${label} — hours overdue`}
        className="input-base w-20 text-right tabular-nums"
        placeholder="—"
        value={value ?? ""}
        onChange={(e) => {
          const n = e.target.value.trim() === "" ? null : Math.round(Number(e.target.value));
          onChange(n != null && Number.isFinite(n) ? n : null);
        }}
      />
      <span className="text-sm text-muted-foreground">h</span>
    </div>
  );
}

export function EscalationForm({ initial, types }: { initial: Ladder; types: string[] }) {
  const router = useRouter();
  const [ladder, setLadder] = useState<Ladder>(initial);
  const [saved, setSaved] = useState(JSON.stringify(initial));
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(ladder) !== saved;

  const setFallback = (k: HourKey, v: number | null) => setLadder((l) => ({ ...l, fallback: { ...l.fallback, [k]: v } }));
  const setRule = (i: number, patch: Partial<LadderRule>) =>
    setLadder((l) => ({ ...l, rules: l.rules.map((r, j) => (j === i ? { ...r, ...patch } : r)) }));

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/settings/escalation", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ladder }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "Could not save");
      setLadder(j.ladder);
      setSaved(JSON.stringify(j.ladder));
      notify.success(j.ladder.enabled ? "Escalation saved — overdue tasks from now on will climb." : "Escalation saved — switched off.");
      router.refresh();
    } catch (e) {
      notify.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  const typeOptions = [...new Set([...types, ...ladder.rules.map((r) => r.type).filter((t): t is string => !!t)])];

  return (
    <div className="card-surface">
      <div className="space-y-6 p-5 sm:p-6">
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            className="mt-1"
            checked={ladder.enabled}
            onChange={(e) => setLadder((l) => ({ ...l, enabled: e.target.checked }))}
          />
          <span>
            <span className="block font-medium">Escalate overdue tasks</span>
            <span className="block text-sm text-muted-foreground">
              {ladder.enabled && initial.enabled && initial.activeSince
                ? `On since ${formatDate(initial.activeSince)} — tasks due before then do not climb.`
                : "Only tasks that fall due after you switch this on will climb."}
            </span>
          </span>
        </label>

        <div className="overflow-x-auto">
          <table className="w-max min-w-full text-sm">
            <thead>
              <tr>
                <th className="text-left">Applies to</th>
                {LEVELS.map((l) => <th key={l.key} className="text-left">{l.label}</th>)}
                <th className="relative w-10"><span className="sr-only">Remove</span></th>
              </tr>
            </thead>
            <tbody>
              {ladder.rules.map((r, i) => (
                <tr key={i}>
                  <td>
                    <div className="flex gap-2">
                      <select className="input-base w-auto" aria-label="Department" value={r.department ?? ""} onChange={(e) => setRule(i, { department: e.target.value || null })}>
                        <option value="">Any department</option>
                        {DEPARTMENTS.map((d) => <option key={d} value={d}>{humanise(d)}</option>)}
                      </select>
                      <select className="input-base w-auto" aria-label="Task type" value={r.type ?? ""} onChange={(e) => setRule(i, { type: e.target.value || null })}>
                        <option value="">Any type</option>
                        {typeOptions.map((t) => <option key={t} value={t}>{humanise(t)}</option>)}
                      </select>
                      <select className="input-base w-auto" aria-label="Priority" value={r.priority ?? ""} onChange={(e) => setRule(i, { priority: (e.target.value || null) as LadderRule["priority"] })}>
                        <option value="">Any priority</option>
                        {PRIORITIES.map((p) => <option key={p} value={p}>{humanise(p)}</option>)}
                      </select>
                    </div>
                  </td>
                  {LEVELS.map((l) => (
                    <td key={l.key}><HoursInput label={l.label} value={r[l.key]} onChange={(v) => setRule(i, { [l.key]: v })} /></td>
                  ))}
                  <td>
                    <button
                      type="button"
                      className="btn-icon"
                      aria-label="Remove rule"
                      onClick={() => setLadder((x) => ({ ...x, rules: x.rules.filter((_, j) => j !== i) }))}
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </button>
                  </td>
                </tr>
              ))}
              <tr>
                <td className="font-medium">Everything else</td>
                {LEVELS.map((l) => (
                  <td key={l.key}><HoursInput label={l.label} value={ladder.fallback[l.key]} onChange={(v) => setFallback(l.key, v)} /></td>
                ))}
                <td />
              </tr>
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button
            variant="secondary"
            onClick={() =>
              setLadder((l) => ({
                ...l,
                rules: [...l.rules, { department: null, type: null, priority: "urgent", l1Hours: 4, l2Hours: 8, l3Hours: 24 }],
              }))
            }
            disabled={ladder.rules.length >= 50}
          >
            <Plus className="size-4" aria-hidden /> Add rule
          </Button>
          <p className="text-sm text-muted-foreground">Hours overdue. Blank skips that level. The most specific rule wins.</p>
        </div>
      </div>
      <FormActions status={dirty ? "Unsaved changes" : "All changes saved"}>
        <Button variant="primary" onClick={save} loading={saving} disabled={!dirty || saving}>Save</Button>
      </FormActions>
    </div>
  );
}
