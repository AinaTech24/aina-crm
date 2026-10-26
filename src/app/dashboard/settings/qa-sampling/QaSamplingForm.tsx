"use client";

/** The QA sampling form (lib/qa/sampling.ts): on/off, the weekly share, which task types. */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { FormActions } from "@/components/ui/FormActions";
import { notify } from "@/components/ui/Toast";
import { humanise } from "@/lib/format";
import type { QaSettings } from "@/lib/qa/sampling";

export function QaSamplingForm({ initial, types }: { initial: QaSettings; types: string[] }) {
  const router = useRouter();
  const [qa, setQa] = useState<QaSettings>(initial);
  const [saved, setSaved] = useState(JSON.stringify(initial));
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(qa) !== saved;
  const options = [...new Set([...types, ...qa.types])];

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/settings/qa-sampling", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ qa }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "Could not save");
      setQa(j.qa);
      setSaved(JSON.stringify(j.qa));
      notify.success(j.qa.enabled ? "QA sampling saved — checks are picked every Monday." : "QA sampling saved — switched off.");
      router.refresh();
    } catch (e) {
      notify.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  const toggleType = (t: string) =>
    setQa((q) => ({ ...q, types: q.types.includes(t) ? q.types.filter((x) => x !== t) : [...q.types, t] }));

  return (
    <div className="card-surface">
      <div className="space-y-6 p-5 sm:p-6">
        <label className="flex items-start gap-3">
          <input type="checkbox" className="mt-1" checked={qa.enabled} onChange={(e) => setQa((q) => ({ ...q, enabled: e.target.checked }))} />
          <span>
            <span className="block font-medium">Check a sample of completed work every week</span>
            <span className="block text-sm text-muted-foreground">
              Each Monday, the person&apos;s reporting manager (else their branch head, else the owner) gets a check for each task picked.
            </span>
          </span>
        </label>

        <label className="flex flex-wrap items-center gap-2">
          <span className="font-medium">Share of each person&apos;s completed tasks</span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={100}
            className="input-base w-20 text-right tabular-nums"
            value={qa.percent}
            onChange={(e) => setQa((q) => ({ ...q, percent: Math.round(Number(e.target.value) || 0) }))}
          />
          <span className="text-sm text-muted-foreground">% — at least one task when they finished any</span>
        </label>

        <fieldset>
          <legend className="font-medium">Task types</legend>
          <p className="text-sm text-muted-foreground">{qa.types.length ? `${qa.types.length} chosen` : "None ticked = every type"}</p>
          {options.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">No completed tasks yet.</p>
          ) : (
            <div className="mt-3 flex flex-wrap gap-2">
              {options.map((t) => (
                <label key={t} className={`chip cursor-pointer gap-1.5 ${qa.types.includes(t) ? "ring-1 ring-primary" : ""}`}>
                  <input type="checkbox" checked={qa.types.includes(t)} onChange={() => toggleType(t)} />
                  {humanise(t)}
                </label>
              ))}
            </div>
          )}
        </fieldset>
      </div>
      <FormActions status={dirty ? "Unsaved changes" : "All changes saved"}>
        <Button variant="primary" onClick={save} loading={saving} disabled={!dirty || saving}>Save</Button>
      </FormActions>
    </div>
  );
}
