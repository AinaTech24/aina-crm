"use client";

/**
 * Branch FY targets — the grid that fills the "Not set" columns on the
 * director's branch scoreboard.
 *
 * One input per branch × metric. Saves on blur rather than behind a Save
 * button: a grid with one button per row invites half-saved state, and a grid
 * with one button for everything makes a single typo a whole-page failure.
 *
 * Clearing a field REMOVES the target rather than storing zero. Those are
 * different statements — "we have no target for this branch" versus "our target
 * is nothing" — and the scoreboard renders them differently.
 */

import { useState } from "react";
import { Building2, Check, Loader2 } from "lucide-react";
import { notify } from "@/components/ui/Toast";
import type { BranchTargetMetric } from "@/lib/targets/branch-targets";

type Branch = { id: string; name: string };

export function BranchTargetsManager({
  branches,
  metrics,
  initial,
  fiscalYear,
}: {
  branches: Branch[];
  metrics: BranchTargetMetric[];
  /** branchId → metricKey → value */
  initial: Record<string, Record<string, number>>;
  fiscalYear: string;
}) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const b of branches) {
      for (const m of metrics) {
        const v = initial[b.id]?.[m.key];
        out[`${b.id}:${m.key}`] = v == null ? "" : String(v);
      }
    }
    return out;
  });
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  async function persist(branchId: string, metricKey: string, value: string) {
    const cell = `${branchId}:${metricKey}`;
    const original = initial[branchId]?.[metricKey];
    const unchanged = (original == null ? "" : String(original)) === value.trim();
    if (unchanged) return;

    setSaving(cell);
    try {
      const res = await fetch("/api/branch-targets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          branchId,
          metricKey,
          fiscalYear,
          targetValue: value.trim() === "" ? "" : Number(value),
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        notify.error(j?.error ?? "Couldn't save that target.");
        return;
      }
      // Track the new baseline so a re-blur without an edit does not re-save.
      (initial[branchId] ??= {});
      if (value.trim() === "") delete initial[branchId][metricKey];
      else initial[branchId][metricKey] = Number(value);
      setSaved(cell);
      setTimeout(() => setSaved((c) => (c === cell ? null : c)), 1500);
    } catch {
      notify.error("Couldn't reach the server.");
    } finally {
      setSaving((c) => (c === cell ? null : c));
    }
  }

  if (branches.length === 0) {
    return (
      <div className="card-surface p-5">
        <p className="text-sm text-muted-foreground">
          No branches yet. Add one under Settings → Organisation, then set its targets here.
        </p>
      </div>
    );
  }

  return (
    <section className="card-surface overflow-hidden">
      <div className="px-5 pt-4 pb-3">
        <h2 className="section-title flex items-center gap-2">
          <Building2 className="size-4 text-muted-foreground" />
          Branch targets — FY {fiscalYear}
        </h2>
        
      </div>

      <div className="table-scroll">
        <table className="w-full">
          <caption className="sr-only">Branch targets for FY {fiscalYear}</caption>
          <thead>
            <tr>
              <th scope="col">Branch</th>
              {metrics.map((m) => (
                <th key={m.key} scope="col" className="text-right">
                  {m.label}
                  <span className="block text-2xs font-normal normal-case text-muted-foreground">
                    {m.unit === "inr" ? "₹" : "count"}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {branches.map((b) => (
              <tr key={b.id}>
                <td className="py-3 font-medium">{b.name}</td>
                {metrics.map((m) => {
                  const cell = `${b.id}:${m.key}`;
                  return (
                    <td key={m.key} className="py-2">
                      <div className="flex items-center justify-end gap-1.5">
                        <input
                          type="number"
                          min={0}
                          inputMode="numeric"
                          aria-label={`${m.label} target for ${b.name}`}
                          title={m.hint}
                          value={values[cell] ?? ""}
                          onChange={(e) => setValues((v) => ({ ...v, [cell]: e.target.value }))}
                          onBlur={(e) => persist(b.id, m.key, e.target.value)}
                          className="input-base w-32 text-right tabular-nums"
                          placeholder="—"
                        />
                        <span className="w-4 shrink-0">
                          {saving === cell && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
                          {saved === cell && <Check className="size-3.5 text-success" />}
                        </span>
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
