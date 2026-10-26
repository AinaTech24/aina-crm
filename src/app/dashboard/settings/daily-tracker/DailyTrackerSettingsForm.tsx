"use client";

/** The tracker reminder time (lib/team/daily-discipline.ts): every half hour 08:00–14:00, or none. */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { FormActions } from "@/components/ui/FormActions";
import { notify } from "@/components/ui/Toast";

const TIMES = Array.from({ length: 13 }, (_, i) => {
  const m = 8 * 60 + i * 30;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
});
const label = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
};

export function DailyTrackerSettingsForm({ initial }: { initial: string | null }) {
  const router = useRouter();
  const [value, setValue] = useState(initial ?? "");
  const [saved, setSaved] = useState(initial ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/settings/daily-tracker", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ remindAt: value || null }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "Could not save");
      setSaved(value);
      notify.success(value ? `Saved — the team is reminded at ${label(value)}.` : "Saved — no reminder.");
      router.refresh();
    } catch (e) {
      notify.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  const options = initial && !TIMES.includes(initial) ? [initial, ...TIMES] : TIMES;
  return (
    <div className="card-surface">
      <div className="p-5 sm:p-6">
        <Field
          label="Remind the team to fill in the tracker at"
          hint="Once a day, Monday to Saturday, not on a firm holiday — only to people who have not filled it in yet. Owners are not reminded."
        >
          {(id, describedBy) => (
            <select id={id} aria-describedby={describedBy} className="input-base w-full max-w-xs" value={value} onChange={(e) => setValue(e.target.value)}>
              <option value="">No reminder</option>
              {options.map((t) => <option key={t} value={t}>{label(t)}</option>)}
            </select>
          )}
        </Field>
      </div>
      <FormActions status={value !== saved ? "Unsaved changes" : "All changes saved"}>
        <Button variant="primary" onClick={save} loading={saving} disabled={value === saved || saving}>Save</Button>
      </FormActions>
    </div>
  );
}
