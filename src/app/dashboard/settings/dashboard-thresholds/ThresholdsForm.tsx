"use client";

/**
 * The dashboard-thresholds form. Every field shows its code default beside it,
 * so an administrator can see what they are changing FROM; a blank field means
 * "use the default", which is also what Reset does for all of them.
 *
 * Fractions (the near-target band) are edited as a percentage — "80", not
 * "0.8" — and converted on the way out.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { FormActions } from "@/components/ui/FormActions";
import { confirmDialog } from "@/components/ui/ConfirmProvider";
import { notify } from "@/components/ui/Toast";
import { formatMoney } from "@/lib/format";

type Def = {
  key: string;
  label: string;
  hint: string;
  kind: "days" | "hours" | "rupees" | "fraction" | "choice";
  min?: number;
  max?: number;
  choices?: Array<{ value: string; label: string }>;
};

function toInput(def: Def, v: unknown): string {
  if (v == null || v === "") return "";
  if (def.kind === "fraction") return String(Math.round(Number(v) * 100));
  return String(v);
}

function fromInput(def: Def, s: string): unknown {
  if (s.trim() === "") return null;
  if (def.kind === "choice") return s;
  const n = Number(s);
  if (!Number.isFinite(n)) return s; // let the server refuse it and say so
  return def.kind === "fraction" ? n / 100 : n;
}

function describe(def: Def, v: unknown): string {
  if (def.kind === "choice") return def.choices?.find((c) => c.value === v)?.label ?? String(v);
  if (def.kind === "fraction") return `${Math.round(Number(v) * 100)}%`;
  if (def.kind === "rupees") return formatMoney(Number(v));
  if (def.kind === "hours") return `${v} hour${Number(v) === 1 ? "" : "s"}`;
  return `${v} day${Number(v) === 1 ? "" : "s"}`;
}

export function ThresholdsForm({
  fields, defaults, overrides,
}: {
  fields: Def[];
  defaults: Record<string, unknown>;
  overrides: Record<string, unknown>;
}) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>(
    () => Object.fromEntries(fields.map((f) => [f.key, toInput(f, overrides[f.key])])),
  );
  const [saving, setSaving] = useState(false);
  const dirty = fields.some((f) => values[f.key] !== toInput(f, overrides[f.key]));

  async function save() {
    setSaving(true);
    try {
      const settings = Object.fromEntries(fields.map((f) => [f.key, fromInput(f, values[f.key] ?? "")]));
      const res = await fetch("/api/settings/dashboard-thresholds", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ settings }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "Could not save");
      if (Array.isArray(j.rejected) && j.rejected.length) {
        const names = fields.filter((f) => j.rejected.includes(f.key)).map((f) => f.label).join(", ");
        notify.warning(`Saved, except: ${names} — outside the allowed range, so the default still applies.`);
      } else {
        notify.success("Dashboard thresholds saved.");
      }
      router.refresh();
    } catch (e) {
      notify.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  async function reset() {
    const ok = await confirmDialog({
      title: "Reset every threshold?",
      message: "All dashboards go back to the built-in defaults. Your saved values are removed.",
      confirmLabel: "Reset to defaults",
      tone: "danger",
    });
    if (!ok) return;
    setSaving(true);
    try {
      const res = await fetch("/api/settings/dashboard-thresholds", { method: "DELETE" });
      if (!res.ok) throw new Error("Could not reset");
      setValues(Object.fromEntries(fields.map((f) => [f.key, ""])));
      notify.success("Thresholds reset to defaults.");
      router.refresh();
    } catch (e) {
      notify.error(e instanceof Error ? e.message : "Could not reset");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card-surface">
      <div className="p-5 sm:p-6">
        <div className="mb-5">
          <h2 className="section-title">Judgement thresholds</h2>
          <p className="section-subtitle mt-0.5">
            Where the dashboards draw their lines. Leave a field blank to use the default shown beside it.
          </p>
        </div>
        <div className="grid gap-x-8 gap-y-6 md:grid-cols-2">
            {fields.map((f) => (
              <Field
                key={f.key}
                label={f.label}
                hint={
                  <>
                    {f.hint}. Default: <span className="font-medium">{describe(f, defaults[f.key])}</span>
                    {f.kind !== "choice" && f.min != null && f.max != null && (
                      <> · allowed {f.kind === "fraction" ? `${Math.round(f.min * 100)}–${Math.round(f.max * 100)}%` : f.kind === "rupees" ? `${formatMoney(f.min)} – ${formatMoney(f.max)}` : `${f.min}–${f.max} ${f.kind === "hours" ? "hours" : "days"}`}</>
                    )}
                  </>
                }
                optional
              >
                {(id, describedBy) =>
                  f.kind === "choice" ? (
                    <select
                      id={id}
                      aria-describedby={describedBy}
                      className="input-base w-full max-w-sm"
                      value={values[f.key] ?? ""}
                      onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                    >
                      <option value="">Default — {describe(f, defaults[f.key])}</option>
                      {f.choices?.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                    </select>
                  ) : (
                    <div className="flex items-center gap-2">
                      {f.kind === "rupees" && <span className="text-sm text-muted-foreground">₹</span>}
                      <input
                        id={id}
                        aria-describedby={describedBy}
                        type="number"
                        inputMode="numeric"
                        className="input-base w-40 text-right tabular-nums"
                        placeholder={toInput(f, defaults[f.key])}
                        value={values[f.key] ?? ""}
                        onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                      />
                      <span className="whitespace-nowrap text-sm text-muted-foreground">
                        {f.kind === "days" ? "days" : f.kind === "hours" ? "hours" : f.kind === "fraction" ? "% of target" : ""}
                      </span>
                    </div>
                  )
                }
              </Field>
            ))}
        </div>
      </div>
      <FormActions status={dirty ? "Unsaved changes" : "All changes saved"}>
        <Button variant="ghost" onClick={reset} disabled={saving}>Reset to defaults</Button>
        <Button variant="primary" onClick={save} loading={saving} disabled={!dirty || saving}>Save thresholds</Button>
      </FormActions>
    </div>
  );
}
