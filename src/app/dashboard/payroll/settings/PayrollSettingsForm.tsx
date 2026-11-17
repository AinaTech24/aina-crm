"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Field, FieldSection } from "@/components/ui/Field";
import { FormActions } from "@/components/ui/FormActions";
import { notify } from "@/components/ui/Toast";
import type { PayrollSettings } from "@/lib/payroll/settings";
import { STATES } from "@/lib/payroll/statutory";

export function PayrollSettingsForm({ initial, canManage }: { initial: PayrollSettings; canManage: boolean }) {
  const router = useRouter();
  const [s, setS] = useState(initial);
  const [saved, setSaved] = useState(JSON.stringify(initial));
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(s) !== saved;

  async function save() {
    setBusy(true);
    try {
      const res = await fetch("/api/payroll/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(s) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "Could not save");
      setSaved(JSON.stringify(s));
      notify.success("Saved — recalculate any draft pay run to use it.");
      router.refresh();
    } catch (e) {
      notify.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  const pct = (v: number) => String(Math.round(v * 100));

  return (
    <div className="space-y-5">
      <FieldSection title="Pay">
        <Field label="Salary per day" hint="What a month's salary is divided by when someone has days without pay.">
          {(id, d) => (
            <select id={id} aria-describedby={d} className="input-base w-full" disabled={!canManage} value={s.payableDaysMethod} onChange={(e) => setS({ ...s, payableDaysMethod: e.target.value as PayrollSettings["payableDaysMethod"] })}>
              <option value="calendar">Days in the month (28–31)</option>
              <option value="fixed30">Always 30</option>
              <option value="fixed26">Always 26 (working days)</option>
            </select>
          )}
        </Field>
        <Field label="Pay day" hint="Day of the month salaries are paid.">
          {(id, d) => <input id={id} aria-describedby={d} type="number" min={1} max={31} className="input-base w-full" disabled={!canManage} value={s.payDay} onChange={(e) => setS({ ...s, payDay: Math.min(31, Math.max(1, Number(e.target.value) || 1)) })} />}
        </Field>
        <Field label="Default work state" hint="Used for Professional Tax when a person's payroll details have none.">
          {(id, d) => (
            <select id={id} aria-describedby={d} className="input-base w-full" disabled={!canManage} value={s.defaultState} onChange={(e) => setS({ ...s, defaultState: e.target.value })}>
              {STATES.map((x) => <option key={x.code} value={x.code}>{x.name}</option>)}
            </select>
          )}
        </Field>
      </FieldSection>

      <FieldSection title="Salary structure" description="How a monthly gross is split. A person's own Basic, set on their salary, wins.">
        <Field label="Basic (% of gross)" hint="The Code on Wages counts wages as at least 50% of pay; below that, a warning shows.">
          {(id, d) => <input id={id} aria-describedby={d} type="number" min={30} max={100} className="input-base w-full" disabled={!canManage} value={pct(s.basicPct)} onChange={(e) => setS({ ...s, basicPct: Math.min(1, Math.max(0.3, Number(e.target.value) / 100)) })} />}
        </Field>
        <Field label="HRA (% of Basic)" hint="50% for metro cities, 40% elsewhere is the usual choice. The rest is Special Allowance.">
          {(id, d) => <input id={id} aria-describedby={d} type="number" min={0} max={50} className="input-base w-full" disabled={!canManage} value={pct(s.hraPctOfBasic)} onChange={(e) => setS({ ...s, hraPctOfBasic: Math.min(0.5, Math.max(0, Number(e.target.value) / 100)) })} />}
        </Field>
      </FieldSection>

      <FieldSection title="Provident Fund">
        <Field label="PF is worked on">
          {(id, d) => (
            <select id={id} aria-describedby={d} className="input-base w-full" disabled={!canManage} value={s.pfWageMode} onChange={(e) => setS({ ...s, pfWageMode: e.target.value as PayrollSettings["pfWageMode"] })}>
              <option value="capped">Basic up to ₹15,000 (the statutory ceiling)</option>
              <option value="full">The full Basic</option>
            </select>
          )}
        </Field>
      </FieldSection>

      <p className="text-xs text-muted-foreground">
        PF, ESI, Professional Tax and income-tax rates are built in with the dates they apply from. Confirm them with your CA before the first pay run.
      </p>

      {canManage && (
        <FormActions className="card-surface rounded-xl border" status={dirty ? "Unsaved changes" : "All changes saved"}>
          <Button variant="primary" onClick={save} disabled={!dirty || busy}>{busy ? "Saving…" : "Save settings"}</Button>
        </FormActions>
      )}
    </div>
  );
}
