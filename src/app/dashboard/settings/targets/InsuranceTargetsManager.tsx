"use client";

/**
 * Firm-level FY targets for the insurance vertical — what the Insurance
 * Business Command Centre's meters and FY scorecard compare against. Saves on
 * blur, like the branch grid; clearing a field removes the target ("Not set"),
 * it does not store zero.
 */

import { useState } from "react";
import { Check, Loader2, ShieldCheck } from "lucide-react";
import { notify } from "@/components/ui/Toast";

type Metric = { key: string; label: string; format: "currency" | "count" };

export function InsuranceTargetsManager({ metrics, initial, fiscalYear }: { metrics: readonly Metric[]; initial: Record<string, number>; fiscalYear: string }) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(metrics.map((m) => [m.key, initial[m.key] == null ? "" : String(initial[m.key])])));
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  async function persist(key: string, value: string) {
    const original = initial[key];
    if ((original == null ? "" : String(original)) === value.trim()) return;
    setSaving(key);
    try {
      const res = await fetch("/api/insurance/targets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ metricKey: key, fiscalYear, targetValue: value.trim() === "" ? "" : Number(value) }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        notify.error(j?.error ?? "Couldn't save that target.");
        return;
      }
      if (value.trim() === "") delete initial[key];
      else initial[key] = Number(value);
      setSaved(key);
      setTimeout(() => setSaved((c) => (c === key ? null : c)), 1500);
    } catch {
      notify.error("Couldn't reach the server.");
    } finally {
      setSaving((c) => (c === key ? null : c));
    }
  }

  return (
    <section id="insurance" className="card-surface scroll-mt-24 p-5 sm:p-6" aria-label="Insurance targets">
      <h2 className="section-title flex items-center gap-2"><ShieldCheck className="size-4 text-muted-foreground" /> Insurance targets · FY {fiscalYear}</h2>
      
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {metrics.map((m) => (
          <label key={m.key} className="block">
            <span className="mb-1 block text-xs font-medium text-foreground">{m.label}</span>
            <span className="relative block">
              {m.format === "currency" && <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">₹</span>}
              <input
                inputMode="decimal"
                value={values[m.key] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [m.key]: e.target.value.replace(/[^0-9.]/g, "") }))}
                onBlur={(e) => persist(m.key, e.target.value)}
                placeholder="Not set"
                aria-label={`${m.label} target for FY ${fiscalYear}`}
                className={`input-base h-9 w-full text-sm tabular-nums ${m.format === "currency" ? "pl-6" : ""}`}
              />
              <span className="absolute right-2 top-1/2 -translate-y-1/2">
                {saving === m.key && <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-label="Saving" />}
                {saved === m.key && <Check className="size-3.5 text-success" aria-label="Saved" />}
              </span>
            </span>
          </label>
        ))}
      </div>
    </section>
  );
}
