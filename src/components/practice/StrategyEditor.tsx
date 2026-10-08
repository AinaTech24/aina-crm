"use client";

/**
 * The owner's primary aim and strategic objective, edited in place. Saves
 * through PUT /api/practice/strategy. Money is typed in the units an MFD
 * speaks in (Cr for AUM, Lakh for the SIP book and revenue) and sent in rupees.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { notify } from "@/components/ui/Toast";

export type StrategyEditorValue = {
  primaryAim: string | null;
  objectiveYear: number | null;
  targets: {
    aum?: number | null;
    clients?: number | null;
    sipBook?: number | null;
    revenue?: number | null;
    teamSize?: number | null;
    ownerHoursPerWeek?: number | null;
  };
  ownerHoursNow: number | null;
};

type TargetKey = keyof StrategyEditorValue["targets"];

const TARGET_FIELDS: Array<{ key: TargetKey; label: string; unit: string; factor: number; integer: boolean; max: number }> = [
  { key: "aum", label: "AUM", unit: "₹ Cr", factor: 1e7, integer: false, max: 1e8 },
  { key: "clients", label: "Clients", unit: "clients", factor: 1, integer: true, max: 10_000_000 },
  { key: "sipBook", label: "Monthly SIP book", unit: "₹ Lakh a month", factor: 1e5, integer: false, max: 1e9 },
  { key: "revenue", label: "Revenue", unit: "₹ Lakh a year", factor: 1e5, integer: false, max: 1e9 },
  { key: "teamSize", label: "Team", unit: "people", factor: 1, integer: true, max: 100_000 },
  { key: "ownerHoursPerWeek", label: "Your hours a week in the practice", unit: "hours", factor: 1, integer: false, max: 168 },
];

function toUnits(v: number | null | undefined, factor: number): string {
  if (v == null) return "";
  const n = v / factor;
  return String(Math.round(n * 100) / 100);
}

export function StrategyEditor({
  value,
  isNew,
  startOpen = false,
}: {
  value: StrategyEditorValue;
  /** No objective saved yet — saving captures today's figures as the baseline. */
  isNew: boolean;
  startOpen?: boolean;
}) {
  const router = useRouter();
  const year = new Date().getFullYear();
  const years = Array.from({ length: 10 }, (_, i) => year + 1 + i);
  const [open, setOpen] = useState(startOpen);
  const [aim, setAim] = useState(value.primaryAim ?? "");
  const [objectiveYear, setObjectiveYear] = useState(String(value.objectiveYear && years.includes(value.objectiveYear) ? value.objectiveYear : year + 5));
  const [targets, setTargets] = useState<Record<TargetKey, string>>(() =>
    Object.fromEntries(TARGET_FIELDS.map((f) => [f.key, toUnits(value.targets[f.key], f.factor)])) as Record<TargetKey, string>,
  );
  const [hoursNow, setHoursNow] = useState(value.ownerHoursNow?.toString() ?? "");
  const [rebaseline, setRebaseline] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  async function save() {
    const next: Record<string, string> = {};
    const out: Record<string, number | null> = {};
    for (const f of TARGET_FIELDS) {
      const raw = targets[f.key].trim();
      if (!raw) { out[f.key] = null; continue; }
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0 || n > f.max || (f.integer && !Number.isInteger(n))) {
        next[f.key] = f.integer ? "A whole number, or blank." : "A number, or blank.";
        continue;
      }
      out[f.key] = Math.round(n * f.factor * 100) / 100;
    }
    let hours: number | null = null;
    if (hoursNow.trim()) {
      const h = Number(hoursNow);
      if (!Number.isFinite(h) || h < 0 || h > 168) next.hoursNow = "Hours a week, from 0 to 168.";
      else hours = h;
    }
    if (!Object.values(out).some((v) => v != null) && !Object.keys(next).length) {
      next.aum = "Set at least one figure the practice should reach.";
    }
    setErrors(next);
    if (Object.keys(next).length) return;

    setSaving(true);
    try {
      const res = await fetch("/api/practice/strategy", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          primaryAim: aim.trim() || null,
          objectiveYear: Number(objectiveYear),
          targets: out,
          ownerHoursNow: hours,
          rebaseline: isNew ? undefined : rebaseline,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        notify.error(j.error ?? "Could not save the objective.");
        return;
      }
      notify.success(isNew ? "Objective set. Today's figures are its baseline." : "Objective saved.");
      setOpen(false);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <Button variant={isNew ? "primary" : "secondary"} size="sm" icon={<Pencil className="size-4" aria-hidden />} onClick={() => setOpen(true)}>
        {isNew ? "Set the objective" : "Edit objective"}
      </Button>
    );
  }

  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <Field label="What do you want the practice to give you — and when?" hint="In your own words: the life the practice should pay for, the time it should give back.">
        {(id, describedBy) => (
          <textarea
            id={id}
            aria-describedby={describedBy}
            rows={3}
            maxLength={2000}
            className="input-base w-full"
            value={aim}
            onChange={(e) => setAim(e.target.value)}
          />
        )}
      </Field>

      <Field label="By the end of" hint="An Indian financial year, April to March.">
        {(id, describedBy) => (
          <select id={id} aria-describedby={describedBy} className="input-base w-full sm:w-64" value={objectiveYear} onChange={(e) => setObjectiveYear(e.target.value)}>
            {years.map((y) => (
              <option key={y} value={y}>FY{y} (Apr {y - 1} – Mar {y})</option>
            ))}
          </select>
        )}
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        {TARGET_FIELDS.map((f) => (
          <Field key={f.key} label={`${f.label} (${f.unit})`} error={errors[f.key]} optional>
            {(id, describedBy, invalid) => (
              <input
                id={id}
                type="number"
                inputMode="decimal"
                min={0}
                step="any"
                aria-describedby={describedBy}
                aria-invalid={invalid || undefined}
                className="input-base w-full"
                value={targets[f.key]}
                onChange={(e) => setTargets((t) => ({ ...t, [f.key]: e.target.value }))}
              />
            )}
          </Field>
        ))}
        <Field label="Your hours a week in the practice today" error={errors.hoursNow} hint="The CRM cannot measure this; your answer is the figure." optional>
          {(id, describedBy, invalid) => (
            <input
              id={id}
              type="number"
              inputMode="decimal"
              min={0}
              max={168}
              aria-describedby={describedBy}
              aria-invalid={invalid || undefined}
              className="input-base w-full"
              value={hoursNow}
              onChange={(e) => setHoursNow(e.target.value)}
            />
          )}
        </Field>
      </div>

      {!isNew && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={rebaseline} onChange={(e) => setRebaseline(e.target.checked)} />
          Start the path again from today&apos;s figures (a new baseline)
        </label>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" size="sm" loading={saving}>{isNew ? "Set the objective" : "Save objective"}</Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
      </div>
    </form>
  );
}
