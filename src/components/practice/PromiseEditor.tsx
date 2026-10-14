"use client";

/**
 * One service tier's promise: the sentence every client of the tier is owed,
 * and — for whoever manages the practice — a form to change it. Saves through
 * PUT /api/practice/promise; a blank cadence means "not promised".
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { notify } from "@/components/ui/Toast";

export type PromiseItemsValue = {
  reviewEveryDays: number | null;
  callEveryDays: number | null;
  statementEveryDays: number | null;
  birthdayWish: boolean;
  querySlaHours: number | null;
};

type Draft = Record<"reviewEveryDays" | "callEveryDays" | "statementEveryDays" | "querySlaHours", string> & { birthdayWish: boolean };

const NUMBER_FIELDS: Array<{ key: keyof Omit<Draft, "birthdayWish">; label: string; unit: string; max: number }> = [
  { key: "reviewEveryDays", label: "Portfolio review every", unit: "days", max: 730 },
  { key: "callEveryDays", label: "Call every", unit: "days", max: 365 },
  { key: "statementEveryDays", label: "Statement every", unit: "days", max: 365 },
  { key: "querySlaHours", label: "Query answered within", unit: "hours", max: 720 },
];

const toDraft = (v: PromiseItemsValue): Draft => ({
  reviewEveryDays: v.reviewEveryDays?.toString() ?? "",
  callEveryDays: v.callEveryDays?.toString() ?? "",
  statementEveryDays: v.statementEveryDays?.toString() ?? "",
  querySlaHours: v.querySlaHours?.toString() ?? "",
  birthdayWish: v.birthdayWish,
});

export function PromiseEditor({
  tier,
  items,
  description,
  clients,
  isDefault,
  canEdit,
}: {
  tier: string;
  items: PromiseItemsValue;
  description: string;
  /** Live clients in the tier. */
  clients: number;
  /** The firm has not set this tier yet — the starting promise applies. */
  isDefault: boolean;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => toDraft(items));
  const [errors, setErrors] = useState<Partial<Record<keyof Draft, string>>>({});
  const [saving, setSaving] = useState(false);

  function validate(): PromiseItemsValue | null {
    const next: Partial<Record<keyof Draft, string>> = {};
    const out: PromiseItemsValue = {
      reviewEveryDays: null, callEveryDays: null, statementEveryDays: null, querySlaHours: null,
      birthdayWish: draft.birthdayWish,
    };
    for (const f of NUMBER_FIELDS) {
      const raw = draft[f.key].trim();
      if (!raw) continue;
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 1 || n > f.max) {
        next[f.key] = `A whole number of ${f.unit} from 1 to ${f.max}, or blank for "not promised".`;
        continue;
      }
      out[f.key] = n;
    }
    setErrors(next);
    return Object.keys(next).length ? null : out;
  }

  async function save() {
    const value = validate();
    if (!value) return;
    setSaving(true);
    try {
      const res = await fetch("/api/practice/promise", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tier, items: value }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        notify.error(j.error ?? "Could not save the promise.");
        return;
      }
      notify.success(`Tier ${tier} promise saved.`);
      setEditing(false);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm leading-relaxed text-foreground">{description}</p>
      <p className="text-xs text-muted-foreground">
        {clients.toLocaleString("en-IN")} live {clients === 1 ? "client" : "clients"} in this tier
        {isDefault ? " · the starting promise, not yet set by the firm" : ""}
      </p>

      {canEdit && !editing && (
        <Button size="sm" variant="secondary" icon={<Pencil className="size-4" aria-hidden />} onClick={() => { setDraft(toDraft(items)); setErrors({}); setEditing(true); }}>
          Edit promise
        </Button>
      )}

      {canEdit && editing && (
        <form
          className="space-y-3 border-t border-border pt-3"
          onSubmit={(e) => { e.preventDefault(); void save(); }}
        >
          {NUMBER_FIELDS.map((f) => (
            <Field key={f.key} label={`${f.label} (${f.unit})`} error={errors[f.key]} hint={f.key === "querySlaHours" ? "Complaints keep their own 21-day clock." : undefined}>
              {(id, describedBy, invalid) => (
                <input
                  id={id}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={f.max}
                  placeholder="Not promised"
                  aria-describedby={describedBy}
                  aria-invalid={invalid || undefined}
                  className="input-base w-full"
                  value={draft[f.key]}
                  onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                />
              )}
            </Field>
          ))}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.birthdayWish}
              onChange={(e) => setDraft((d) => ({ ...d, birthdayWish: e.target.checked }))}
            />
            A birthday wish
          </label>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" size="sm" loading={saving}>Save promise</Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={saving}>Cancel</Button>
          </div>
        </form>
      )}
    </div>
  );
}
