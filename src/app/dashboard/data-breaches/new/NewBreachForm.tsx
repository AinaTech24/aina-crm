"use client";

/**
 * Log a breach the moment the firm learns of it — the 72-hour clock runs from
 * "became aware". Only the essentials here; the rest (what data, why, what is
 * being done) is filled in on the breach's page as it becomes known.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Field, FieldSection } from "@/components/ui/Field";
import { FormActions } from "@/components/ui/FormActions";
import { DateTimeField } from "@/components/ui/DateTimeField";
import { notify } from "@/components/ui/Toast";

/** The picker's local "yyyy-mm-ddTHH:mm" as an India-time instant. */
const toIso = (v: string) => (v ? `${v}:00+05:30` : null);

function nowLocal(): string {
  const d = new Date(Date.now() + 5.5 * 3600 * 1000);
  return d.toISOString().slice(0, 16);
}

export function NewBreachForm() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [detected, setDetected] = useState(nowLocal());
  const [occurred, setOccurred] = useState("");
  const [description, setDescription] = useState("");
  const [count, setCount] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/data-breaches", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title,
          detectedAt: toIso(detected),
          occurredAt: toIso(occurred),
          description,
          affectedCount: count.trim() === "" ? null : Number(count),
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "Could not save");
      notify.success(`Logged as ${j.reference}. The Board's report is due in 72 hours.`);
      router.push(`/dashboard/data-breaches/${j.id}`);
    } catch (e) {
      notify.error(e instanceof Error ? e.message : "Could not save");
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <FieldSection title="What happened">
        <Field label="Short title" required className="sm:col-span-2" hint="For example: laptop with client files stolen; email sent to the wrong client list.">
          {(id, d) => <input id={id} aria-describedby={d} className="input-base w-full" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />}
        </Field>
        <Field label="Became aware" required hint="The 72 hours start here.">
          {(id) => <DateTimeField id={id} value={detected} onChange={(e) => setDetected(e.target.value)} />}
        </Field>
        <Field label="It happened" optional>
          {(id) => <DateTimeField id={id} value={occurred} onChange={(e) => setOccurred(e.target.value)} />}
        </Field>
        <Field label="People affected" optional hint="An estimate is fine — update it later.">
          {(id, d) => <input id={id} aria-describedby={d} inputMode="numeric" className="input-base w-full" value={count} onChange={(e) => setCount(e.target.value.replace(/\D/g, ""))} />}
        </Field>
        <Field label="Details" optional className="sm:col-span-2">
          {(id, d) => <textarea id={id} aria-describedby={d} rows={4} className="input-base w-full" maxLength={4000} value={description} onChange={(e) => setDescription(e.target.value)} />}
        </Field>
      </FieldSection>
      <FormActions className="card-surface rounded-xl border">
        <Button variant="primary" onClick={save} disabled={saving || title.trim().length < 3 || !detected}>
          {saving ? "Saving…" : "Log breach"}
        </Button>
      </FormActions>
    </div>
  );
}
