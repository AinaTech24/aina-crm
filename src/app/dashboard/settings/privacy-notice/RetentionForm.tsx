"use client";

/**
 * The firm's retention policy (lib/privacy/retention-core.ts). Erasing is
 * irreversible, so each choice shows what it would erase tonight before it is
 * saved, and the policy stays off until the firm picks a period.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Field, FieldSection } from "@/components/ui/Field";
import { confirmDialog } from "@/components/ui/ConfirmProvider";
import { notify } from "@/components/ui/Toast";
import { formatDate } from "@/lib/format";
import type { RetentionRun } from "@/lib/privacy/retention-core";

const LEAD_OPTIONS = [null, 6, 12, 24, 36];
const CLIENT_OPTIONS = [null, 5, 7, 8, 10];

const toVal = (v: number | null) => (v == null ? "" : String(v));
const fromVal = (v: string) => (v === "" ? null : Number(v));

export function RetentionForm({
  initial,
  lastErased,
}: {
  initial: { lostLeadMonths: number | null; formerClientYears: number | null };
  lastErased: RetentionRun | null;
}) {
  const router = useRouter();
  const [leadMonths, setLeadMonths] = useState(initial.lostLeadMonths);
  const [clientYears, setClientYears] = useState(initial.formerClientYears);
  const [saved, setSaved] = useState(initial);
  const [preview, setPreview] = useState<{ leads: number; clients: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const dirty = leadMonths !== saved.lostLeadMonths || clientYears !== saved.formerClientYears;

  useEffect(() => {
    const qs = new URLSearchParams({ lostLeadMonths: toVal(leadMonths), formerClientYears: toVal(clientYears) });
    let gone = false;
    fetch(`/api/settings/data-retention?${qs}`)
      .then((r) => r.json())
      .then((j) => { if (!gone) setPreview(j.preview ?? null); })
      .catch(() => { if (!gone) setPreview(null); });
    return () => { gone = true; };
  }, [leadMonths, clientYears]);

  async function save() {
    const erasing = (preview?.leads ?? 0) + (preview?.clients ?? 0);
    if (erasing > 0) {
      const ok = await confirmDialog({
        title: "Switch on this retention policy?",
        message: `Tonight it erases ${preview!.leads} lost lead${preview!.leads === 1 ? "" : "s"} and ${preview!.clients} former client${preview!.clients === 1 ? "" : "s"}, and it keeps doing so every night. Erased data cannot be brought back.`,
        confirmLabel: "Switch on",
        tone: "danger",
      });
      if (!ok) return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/settings/data-retention", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lostLeadMonths: leadMonths, formerClientYears: clientYears }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "Could not save");
      setSaved({ lostLeadMonths: leadMonths, formerClientYears: clientYears });
      notify.success(leadMonths == null && clientYears == null ? "Retention policy is off." : "Saved — it runs tonight.");
      router.refresh();
    } catch (e) {
      notify.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <FieldSection
      title="Data retention"
      description="Erase personal data the firm no longer needs, every night. Off until you choose a period. A client who still holds money with the registrar is never erased."
    >
      <Field label="Lost leads">
        {(id, d) => (
          <select id={id} aria-describedby={d} className="input-base w-full" value={toVal(leadMonths)} onChange={(e) => setLeadMonths(fromVal(e.target.value))}>
            {LEAD_OPTIONS.map((m) => (
              <option key={toVal(m)} value={toVal(m)}>{m == null ? "Keep" : `Erase ${m} months after they were lost`}</option>
            ))}
          </select>
        )}
      </Field>
      <Field label="Former clients" hint="The Prevention of Money Laundering Act requires five years after the relationship ends.">
        {(id, d) => (
          <select id={id} aria-describedby={d} className="input-base w-full" value={toVal(clientYears)} onChange={(e) => setClientYears(fromVal(e.target.value))}>
            {CLIENT_OPTIONS.map((y) => (
              <option key={toVal(y)} value={toVal(y)}>{y == null ? "Keep" : `Erase ${y} years after they left`}</option>
            ))}
          </select>
        )}
      </Field>
      <div className="sm:col-span-2 flex flex-wrap items-center gap-3 text-sm">
        <span className="text-muted-foreground">
          {leadMonths == null && clientYears == null
            ? "Nothing is erased."
            : preview
              ? `Tonight this would erase ${preview.leads} lost lead${preview.leads === 1 ? "" : "s"} and ${preview.clients} former client${preview.clients === 1 ? "" : "s"}.`
              : "Counting…"}
          {lastErased ? ` Last erased ${formatDate(lastErased.at)}: ${lastErased.leads} lead${lastErased.leads === 1 ? "" : "s"}, ${lastErased.clients} client${lastErased.clients === 1 ? "" : "s"}.` : ""}
        </span>
        <Button variant="primary" className="ml-auto" onClick={save} disabled={!dirty || saving}>
          {saving ? "Saving…" : "Save retention"}
        </Button>
      </div>
    </FieldSection>
  );
}
