"use client";

/**
 * The client's KYC / account-opening details, filled by the MFD on the
 * client's behalf and saved to the client master (/api/leads/[id]/capture-kyc).
 *
 *   mode "documents" — every field; saving moves the journey to Documents
 *                      Received.
 *   mode "update"    — "Update Client Information": only the required fields
 *                      still empty (all of them one click away); saving moves
 *                      the journey to Update Information.
 *
 * Either way it returns to the page the user came from.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FormActions } from "@/components/ui/FormActions";
import { DateField } from "@/components/ui/DateField";
import { notify } from "@/components/ui/Toast";
import { isFieldVisible, validateNomineeAllocations, type KycField } from "@/lib/onboarding/kyc-fields";

export function CollectDetailsForm({ leadId, backHref, mode = "documents" }: { leadId: string; backHref: string; mode?: "documents" | "update" }) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [fields, setFields] = useState<KycField[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // "update" mode: the required fields that were empty when the page opened.
  // Frozen at load so a field does not vanish while it is being typed in.
  const [pending, setPending] = useState<Set<string> | null>(null);
  const [showAll, setShowAll] = useState(mode === "documents");

  useEffect(() => {
    let live = true;
    fetch(`/api/leads/${leadId}/capture-kyc`, { cache: "no-store" })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d?.error ?? `HTTP ${r.status}`);
        return d;
      })
      .then((d) => {
        if (!live) return;
        const fs: KycField[] = Array.isArray(d.fields) ? d.fields : [];
        const vs: Record<string, string> = d.values ?? {};
        setFields(fs);
        setValues(vs);
        setPending(new Set(fs.filter((f) => f.required && isFieldVisible(f, vs) && !(vs[f.key] ?? "").trim()).map((f) => f.key)));
      })
      .catch((e) => live && setError(e?.message ?? "Couldn't load the details form."))
      .finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [leadId]);

  async function submit() {
    // Enforce required fields that are currently visible (showIf-driven).
    const miss = fields.find((f) => f.required && isFieldVisible(f, values) && !(values[f.key] ?? "").trim());
    if (miss) { setError(`Please fill: ${miss.label}`); return; }
    const allocErr = validateNomineeAllocations(values);
    if (allocErr) { setError(allocErr); return; }
    setSubmitting(true);
    setError(null);
    try {
      // Only send values for fields currently visible.
      const payload: Record<string, string> = {};
      for (const f of fields) {
        if (!isFieldVisible(f, values)) continue;
        const val = (values[f.key] ?? "").trim();
        if (val) payload[f.key] = val;
      }
      const r = await fetch(`/api/leads/${leadId}/capture-kyc`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ values: payload, advance: mode === "documents" }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error ?? `HTTP ${r.status}`);
      if (mode === "update") {
        const a = await fetch(`/api/leads/${leadId}/blueprint/advance`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ toStageKey: "update_information", remarks: "Client information updated" }),
        });
        const ad = await a.json().catch(() => ({}));
        if (!a.ok) throw new Error(`Details saved, but the journey could not move on: ${ad?.error ?? `HTTP ${a.status}`}`);
      }
      // A non-fatal warning (e.g. a duplicate PAN was skipped): the rest saved.
      if (d?.warning) notify.warning(d.warning);
      else notify.success(mode === "update" ? "Client information updated" : "Details saved — moved to Documents Received");
      router.push(backHref);
      router.refresh();
    } catch (e: any) {
      setError(e?.message ?? "Couldn't save the details.");
      setSubmitting(false);
    }
  }

  // Group VISIBLE fields by section (showIf conditionals collapse live).
  const sections: Array<[string, KycField[]]> = [];
  for (const f of fields) {
    if (!isFieldVisible(f, values)) continue;
    if (!showAll && !pending?.has(f.key)) continue;
    let g = sections.find((s) => s[0] === f.section);
    if (!g) { g = [f.section, []]; sections.push(g); }
    g[1].push(f);
  }

  if (loading) {
    return (
      <Card className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading the form…
      </Card>
    );
  }

  const nothingPending = mode === "update" && !!pending && pending.size === 0;

  return (
    <div className="space-y-4">
      {mode === "update" && (
        <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
          <p className="text-sm text-muted-foreground">
            {nothingPending
              ? "Every required detail is already on file."
              : `${pending?.size ?? 0} required ${pending?.size === 1 ? "detail is" : "details are"} still missing.`}
          </p>
          <Button variant="ghost" size="sm" onClick={() => setShowAll((v) => !v)}>
            {showAll ? "Show only what's missing" : "Show all fields"}
          </Button>
        </Card>
      )}
      {sections.map(([section, fs]) => (
        <Card key={section} className="space-y-3 p-5">
          <h2 className="text-xs font-bold uppercase tracking-wider text-brand-cyan">{section}</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {fs.map((f) => (
              <CollectField key={f.key} field={f} value={values[f.key] ?? ""} onChange={(v) => setValues((prev) => ({ ...prev, [f.key]: v }))} />
            ))}
          </div>
        </Card>
      ))}

      <FormActions
        status={error ? (
          <span className="flex items-start gap-1.5 text-sm text-destructive"><AlertTriangle className="mt-0.5 size-4" /> {error}</span>
        ) : undefined}
      >
        <Button variant="secondary" onClick={() => router.push(backHref)} disabled={submitting}>Cancel</Button>
        <Button
          variant="primary"
          onClick={submit}
          disabled={submitting || !fields.length}
          icon={submitting ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
        >
          {mode === "update" ? "Save & mark Information Updated" : "Save & mark Documents Received"}
        </Button>
      </FormActions>
    </div>
  );
}

function CollectField({ field, value, onChange }: { field: KycField; value: string; onChange: (v: string) => void }) {
  const cls = "input-base text-sm w-full";
  return (
    <label className="block">
      <div className="mb-1 text-sm font-medium text-foreground">
        {field.label}
        {field.required && <span className="ml-1 text-rose-500">*</span>}
      </div>
      {field.type === "select" ? (
        <select value={value} onChange={(e) => onChange(e.target.value)} className={cls}>
          <option value="">— select —</option>
          {field.options?.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      ) : field.type === "date" ? (
        <DateField value={value} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input
          type={field.type === "tel" ? "tel" : field.type === "email" ? "email" : field.type === "number" ? "number" : "text"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder ?? ""}
          className={cls}
        />
      )}
      {field.helpText && <div className="mt-1 text-2xs text-muted-foreground">{field.helpText}</div>}
    </label>
  );
}
