"use client";

/**
 * The employee's tax declaration: regime, amounts, previous employer, proofs
 * — with the year's tax under both regimes worked out live from their salary
 * (lib/payroll/calc.ts), so the choice is made on numbers, not guesses.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { notify } from "@/components/ui/Toast";
import { calculatePay, type EmployeeIn } from "@/lib/payroll/calc";
import type { PayrollSettings } from "@/lib/payroll/settings";
import { PROOF_ITEMS, declarationWarnings, type Declaration, type ProofKey, type Proofs, type TaxRegimeKey } from "@/lib/payroll/tax";
import { PROOF_STATUS } from "@/lib/payroll/labels";
import { errText, inr, send } from "@/components/payroll/send";

type Props = {
  fyLabel: string;
  proofDeadline: string;
  period: string;
  settings: PayrollSettings;
  employee: EmployeeIn | null;
  ytd: { taxableGross: number; tds: number };
  initial: { regime: TaxRegimeKey; declared: Declaration; proofs: Proofs; submitted: boolean };
};

const n = (s: string) => {
  const v = Number(s.replace(/[^\d.]/g, ""));
  return Number.isFinite(v) && v > 0 ? v : undefined;
};

export function TaxForm({ fyLabel, proofDeadline, period, settings, employee, ytd, initial }: Props) {
  const router = useRouter();
  const [regime, setRegime] = useState<TaxRegimeKey>(initial.regime);
  const [d, setD] = useState<Declaration>(initial.declared);
  const [proofAmt, setProofAmt] = useState<Partial<Record<ProofKey, string>>>({});
  const [busy, setBusy] = useState(false);
  const set = (k: keyof Declaration, v: unknown) => setD((x) => ({ ...x, [k]: v }));

  const projection = useMemo(() => {
    if (!employee) return null;
    const run = (r: TaxRegimeKey) => calculatePay(employee, { period, lopDays: 0, adjustments: [], ytd, tax: { regime: r, declaration: d, proofsApplied: false } }, settings);
    const mine = run(regime);
    return { mine, yearNew: regime === "new" ? mine.tax.yearTax : mine.tax.other.yearTax, yearOld: regime === "old" ? mine.tax.yearTax : mine.tax.other.yearTax };
  }, [employee, period, ytd, d, regime, settings]);

  const warnings = declarationWarnings(d, regime);
  const better = projection && projection.yearOld !== projection.yearNew ? (projection.yearOld < projection.yearNew ? "old" : "new") : null;

  async function save(submit: boolean) {
    setBusy(true);
    try {
      const proofs = Object.fromEntries(
        Object.entries(proofAmt).flatMap(([k, v]) => (v != null && v !== "" ? [[k, { amount: Number(v.replace(/[^\d.]/g, "")) || 0 }]] : []))
      );
      await send("/api/me/pay/declaration", "PUT", { regime, declared: d, submit, proofs: Object.keys(proofs).length ? proofs : undefined });
      notify.success(submit || initial.submitted ? "Saved. Your next payslip's tax uses it." : "Draft saved.");
      setProofAmt({});
      router.refresh();
    } catch (e) {
      notify.error(errText(e));
    } finally {
      setBusy(false);
    }
  }

  const amountField = (k: keyof Declaration, label: string, hint?: string) => (
    <Field label={label} hint={hint} optional>
      {(id, desc) => (
        <input id={id} aria-describedby={desc} className="input-base w-full" inputMode="numeric" value={(d[k] as number | undefined) ?? ""} onChange={(e) => set(k, n(e.target.value))} />
      )}
    </Field>
  );

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title={`Your tax for ${fyLabel}`} />
        <CardBody>
        {projection ? (
          <div className="space-y-3 text-sm">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg bg-secondary/60 p-3">
                <div className="text-muted-foreground">New regime</div>
                <div className="text-lg font-bold tabular-nums">{inr(projection.yearNew)}</div>
                {better === "new" && <Badge tone="success">Lower for you</Badge>}
              </div>
              <div className="rounded-lg bg-secondary/60 p-3">
                <div className="text-muted-foreground">Old regime, with what you declare</div>
                <div className="text-lg font-bold tabular-nums">{inr(projection.yearOld)}</div>
                {better === "old" && <Badge tone="success">Lower for you</Badge>}
              </div>
              <div className="rounded-lg bg-secondary/60 p-3">
                <div className="text-muted-foreground">Deducted each month from now</div>
                <div className="text-lg font-bold tabular-nums">{inr(projection.mine.tds)}</div>
                <div className="text-2xs text-muted-foreground">{inr(projection.mine.tax.alreadyDeducted)} deducted so far this year</div>
              </div>
            </div>
            <p className="text-muted-foreground">
              Worked out on your salary for the rest of the year. The firm&apos;s CA has the final word; nothing here is tax advice.
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Your salary is not set in payroll yet, so your tax cannot be worked out. You can still declare.</p>
        )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Regime" />
        <CardBody>
        <div className="dash-seg w-fit" role="group" aria-label="Tax regime">
          <button type="button" aria-pressed={regime === "new"} onClick={() => setRegime("new")}>New regime</button>
          <button type="button" aria-pressed={regime === "old"} onClick={() => setRegime("old")}>Old regime</button>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          {regime === "new"
            ? "Lower rates and a ₹75,000 standard deduction; the deductions below do not count."
            : "Higher rates, a ₹50,000 standard deduction, and the deductions below."}
        </p>
        </CardBody>
      </Card>

      {regime === "old" && (
        <Card>
          <CardHeader title="Deductions you will claim this year" />
          <CardBody>
          <div className="grid gap-4 sm:grid-cols-2">
            {amountField("rentPaid", "Rent you pay in the year (₹)", "For the HRA exemption.")}
            <Field label="City" optional>
              {(id) => (
                <select id={id} className="input-base w-full" value={d.metro ? "metro" : "other"} onChange={(e) => set("metro", e.target.value === "metro")}>
                  <option value="other">Other city</option>
                  <option value="metro">Mumbai, Delhi, Kolkata or Chennai</option>
                </select>
              )}
            </Field>
            <Field label="Landlord's name" optional>
              {(id) => <input id={id} className="input-base w-full" value={d.landlordName ?? ""} onChange={(e) => set("landlordName", e.target.value)} />}
            </Field>
            <Field label="Landlord's PAN" optional hint="Needed above ₹1 lakh rent a year.">
              {(id, desc) => <input id={id} aria-describedby={desc} className="input-base w-full uppercase" maxLength={10} value={d.landlordPan ?? ""} onChange={(e) => set("landlordPan", e.target.value.toUpperCase())} />}
            </Field>
            {PROOF_ITEMS.filter((p) => p.key !== "rentPaid").map((p) => <div key={p.key}>{amountField(p.key, p.label, p.hint)}</div>)}
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!d.seniorSelf} onChange={(e) => set("seniorSelf", e.target.checked)} /> I am 60 or older</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!d.seniorParents} onChange={(e) => set("seniorParents", e.target.checked)} /> A parent I insure is 60 or older</label>
          </div>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader title="Previous employer this year" />
        <CardBody>
        <div className="grid gap-4 sm:grid-cols-2">
          {amountField("prevIncome", "Taxable salary there (₹)", "From their Form 16 or Form 12B.")}
          {amountField("prevTds", "Tax they deducted (₹)")}
        </div>
        </CardBody>
      </Card>

      {regime === "old" && (
        <Card>
          <CardHeader title="Proofs" subtitle={`Submit by ${proofDeadline}. After that, only verified proofs reduce your tax.`} />
          <CardBody>
          <div className="divide-y divide-border text-sm">
            {PROOF_ITEMS.map((p) => {
              const declared = d[p.key] ?? 0;
              const pr = initial.proofs[p.key];
              if (!declared && !pr) return null;
              return (
                <div key={p.key} className="flex flex-wrap items-center gap-3 py-2">
                  <span className="min-w-0 flex-1">{p.label}<span className="block text-2xs text-muted-foreground">Declared {inr(declared)}</span></span>
                  {pr && <Badge tone={PROOF_STATUS[pr.status]?.tone ?? "neutral"}>{PROOF_STATUS[pr.status]?.label}{pr.amount != null ? ` · ${inr(pr.amount)}` : ""}</Badge>}
                  <label className="w-40">
                    <span className="sr-only">Amount with proof for {p.label}</span>
                    <input className="input-base w-full" inputMode="numeric" placeholder="Amount with proof" value={proofAmt[p.key] ?? ""} onChange={(e) => setProofAmt({ ...proofAmt, [p.key]: e.target.value })} />
                  </label>
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-2xs text-muted-foreground">Give the receipts or certificates to payroll; they verify each amount here.</p>
          </CardBody>
        </Card>
      )}

      {warnings.length > 0 && (
        <div className="rounded-xl border border-warning/50 bg-warning/5 p-3 text-sm space-y-1">{warnings.map((w) => <div key={w}>{w}</div>)}</div>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        {!initial.submitted && <Button variant="secondary" disabled={busy} onClick={() => save(false)}>Save draft</Button>}
        <Button variant="primary" disabled={busy} onClick={() => save(true)}>{busy ? "Saving…" : initial.submitted ? "Save changes" : "Submit declaration"}</Button>
      </div>
    </div>
  );
}
