"use client";

/**
 * One person's payroll set-up. The salary preview runs the same engine as the
 * pay run (lib/payroll/calc.ts), so what you see here is what the month pays —
 * a full month, with tax estimated as if this salary ran the whole year.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { Field, FieldSection } from "@/components/ui/Field";
import { DateField } from "@/components/ui/DateField";
import { notify } from "@/components/ui/Toast";
import { calculatePay } from "@/lib/payroll/calc";
import type { PayrollSettings } from "@/lib/payroll/settings";
import { STATES } from "@/lib/payroll/statutory";

type Profile = {
  panLast4: string | null;
  uan: string;
  pfNumber: string;
  esiNumber: string;
  bankName: string;
  bankLast4: string | null;
  ifsc: string;
  paymentMode: "bank" | "cheque" | "cash";
  workState: string;
  gender: string;
  pfEnabled: boolean;
  esiMode: "auto" | "off";
  exitDate: string;
  openingFyStart: string | null;
  openingTaxableGross: number | null;
  openingTds: number | null;
};
type Salary = { id: string; effectiveFrom: string; monthlyGross: number; basicOverride: number | null; hraOverride: number | null; note: string | null };

const rupees = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const today = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
/** April 1st of the financial year we are in. */
const currentFyStart = () => {
  const t = today();
  const y = Number(t.slice(0, 4));
  return `${Number(t.slice(5, 7)) >= 4 ? y : y - 1}-04-01`;
};

async function put(userId: string, body: unknown) {
  const res = await fetch(`/api/payroll/employees/${userId}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error ?? "Could not save");
}

export function EmployeePayForm({
  userId,
  canManage,
  settings,
  joiningDate,
  profile,
  history,
}: {
  userId: string;
  canManage: boolean;
  settings: PayrollSettings;
  joiningDate: string | null;
  profile: Profile;
  history: Salary[];
}) {
  const router = useRouter();
  const current = history[0] ?? null;
  const [p, setP] = useState(profile);
  const [pan, setPan] = useState("");
  const [account, setAccount] = useState("");
  const [gross, setGross] = useState(current ? String(current.monthlyGross) : "");
  const [from, setFrom] = useState(current ? today() : joiningDate ?? today());
  const [basic, setBasic] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const fy = currentFyStart();
  const openingThisYear = profile.openingFyStart === fy;
  const [openGross, setOpenGross] = useState(openingThisYear && profile.openingTaxableGross != null ? String(profile.openingTaxableGross) : "");
  const [openTds, setOpenTds] = useState(openingThisYear && profile.openingTds != null ? String(profile.openingTds) : "");

  const preview = useMemo(() => {
    const g = Number(gross);
    if (!g) return null;
    return calculatePay(
      { monthlyGross: g, basicOverride: basic ? Number(basic) : null, pfEnabled: p.pfEnabled, esiMode: p.esiMode, workState: p.workState, gender: p.gender || null },
      { period: "2026-04-01", lopDays: 0, adjustments: [], ytd: { taxableGross: 0, tds: 0 } },
      settings
    );
  }, [gross, basic, p.pfEnabled, p.esiMode, p.workState, p.gender, settings]);

  async function saveProfile() {
    setBusy("profile");
    try {
      await put(userId, {
        profile: {
          pan: pan.trim() || undefined,
          bankAccount: account.trim() || undefined,
          uan: p.uan, pfNumber: p.pfNumber, esiNumber: p.esiNumber, bankName: p.bankName, ifsc: p.ifsc,
          paymentMode: p.paymentMode, workState: p.workState, gender: p.gender, pfEnabled: p.pfEnabled, esiMode: p.esiMode,
          exitDate: p.exitDate || null,
          opening: openGross || openTds ? { fyStart: fy, taxableGross: Number(openGross || 0), tds: Number(openTds || 0) } : null,
        },
      });
      setPan("");
      setAccount("");
      notify.success("Payroll details saved.");
      router.refresh();
    } catch (e) {
      notify.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(null);
    }
  }

  async function saveSalary() {
    setBusy("salary");
    try {
      await put(userId, { salary: { monthlyGross: Number(gross), effectiveFrom: from, basicOverride: basic ? Number(basic) : null, note: note.trim() || undefined } });
      setNote("");
      notify.success(current ? "Salary revised. Run or recalculate payroll to use it." : "Salary set.");
      router.refresh();
    } catch (e) {
      notify.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(null);
    }
  }

  const text = (key: keyof Profile, label: string, opts: { placeholder?: string; max?: number } = {}) => (
    <Field label={label} optional>
      {(id, d) => (
        <input id={id} aria-describedby={d} className="input-base w-full" disabled={!canManage} maxLength={opts.max ?? 60} placeholder={opts.placeholder}
          value={String(p[key] ?? "")} onChange={(e) => setP({ ...p, [key]: e.target.value })} />
      )}
    </Field>
  );

  return (
    <div className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
      <div className="space-y-5 min-w-0">
        <FieldSection title="Salary" description={current ? `Current: ${rupees(current.monthlyGross)} a month from ${current.effectiveFrom}. A change is a new revision; history is kept.` : "No salary yet — set one to put this person on pay runs."}>
          <Field label="Monthly gross (₹)" required>
            {(id, d) => <input id={id} aria-describedby={d} inputMode="numeric" className="input-base w-full" disabled={!canManage} value={gross} onChange={(e) => setGross(e.target.value.replace(/\D/g, ""))} />}
          </Field>
          <Field label="Applies from" required hint="A date in the past is fine — recalculate that month's draft run to pick it up.">
            {(id) => <DateField id={id} value={from} onChange={(e) => setFrom(e.target.value)} disabled={!canManage} />}
          </Field>
          <Field label="Basic (₹)" optional hint={`Leave blank for ${Math.round(settings.basicPct * 100)}% of gross.`}>
            {(id, d) => <input id={id} aria-describedby={d} inputMode="numeric" className="input-base w-full" disabled={!canManage} value={basic} onChange={(e) => setBasic(e.target.value.replace(/\D/g, ""))} />}
          </Field>
          <Field label="Note" optional>
            {(id, d) => <input id={id} aria-describedby={d} className="input-base w-full" disabled={!canManage} maxLength={300} placeholder="e.g. Annual increment" value={note} onChange={(e) => setNote(e.target.value)} />}
          </Field>
          {canManage && (
            <div className="sm:col-span-2 flex justify-end">
              <Button variant="primary" onClick={saveSalary} disabled={!!busy || !Number(gross) || !from}>{busy === "salary" ? "Saving…" : current ? "Save revision" : "Set salary"}</Button>
            </div>
          )}
        </FieldSection>

        <FieldSection title="Payroll details" description="PAN and bank account are stored encrypted and shown only by their last digits.">
          <Field label="PAN" optional hint={p.panLast4 ? `On file: ••••••${p.panLast4}. Type a new one to replace it.` : undefined}>
            {(id, d) => <input id={id} aria-describedby={d} className="input-base w-full uppercase" disabled={!canManage} maxLength={10} value={pan} onChange={(e) => setPan(e.target.value.toUpperCase())} />}
          </Field>
          {text("uan", "UAN (PF)")}
          {text("pfNumber", "PF member number")}
          {text("esiNumber", "ESI IP number")}
          <Field label="Work state" hint="Decides Professional Tax.">
            {(id, d) => (
              <select id={id} aria-describedby={d} className="input-base w-full" disabled={!canManage} value={p.workState} onChange={(e) => setP({ ...p, workState: e.target.value })}>
                {STATES.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
              </select>
            )}
          </Field>
          <Field label="Gender" optional hint="Some states (Maharashtra) have different Professional Tax slabs for women.">
            {(id, d) => (
              <select id={id} aria-describedby={d} className="input-base w-full" disabled={!canManage} value={p.gender} onChange={(e) => setP({ ...p, gender: e.target.value })}>
                <option value="">Not recorded</option><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option>
              </select>
            )}
          </Field>
          <Field label="Paid by">
            {(id, d) => (
              <select id={id} aria-describedby={d} className="input-base w-full" disabled={!canManage} value={p.paymentMode} onChange={(e) => setP({ ...p, paymentMode: e.target.value as Profile["paymentMode"] })}>
                <option value="bank">Bank transfer</option><option value="cheque">Cheque</option><option value="cash">Cash</option>
              </select>
            )}
          </Field>
          {text("bankName", "Bank")}
          <Field label="Account number" optional hint={p.bankLast4 ? `On file: ••••${p.bankLast4}. Type a new one to replace it.` : undefined}>
            {(id, d) => <input id={id} aria-describedby={d} inputMode="numeric" className="input-base w-full" disabled={!canManage} maxLength={20} value={account} onChange={(e) => setAccount(e.target.value.replace(/\D/g, ""))} />}
          </Field>
          {text("ifsc", "IFSC", { max: 11 })}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4" disabled={!canManage} checked={p.pfEnabled} onChange={(e) => setP({ ...p, pfEnabled: e.target.checked })} /> Deduct PF
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4" disabled={!canManage} checked={p.esiMode === "auto"} onChange={(e) => setP({ ...p, esiMode: e.target.checked ? "auto" : "off" })} /> ESI when eligible
          </label>
          <Field label={`Salary paid earlier in FY ${fy.slice(0, 4)}-${String(Number(fy.slice(2, 4)) + 1).padStart(2, "0")} (₹)`} optional hint="Before this firm ran payroll in the CRM — taxable salary already paid this year. TDS is worked on the whole year.">
            {(id, d) => <input id={id} aria-describedby={d} inputMode="numeric" className="input-base w-full" disabled={!canManage} value={openGross} onChange={(e) => setOpenGross(e.target.value.replace(/\D/g, ""))} />}
          </Field>
          <Field label="TDS already deducted this year (₹)" optional>
            {(id, d) => <input id={id} aria-describedby={d} inputMode="numeric" className="input-base w-full" disabled={!canManage} value={openTds} onChange={(e) => setOpenTds(e.target.value.replace(/\D/g, ""))} />}
          </Field>
          <Field label="Last working day" optional hint="Set when the person leaves; they are paid up to this day.">
            {(id) => <DateField id={id} value={p.exitDate} onChange={(e) => setP({ ...p, exitDate: e.target.value })} disabled={!canManage} />}
          </Field>
          {canManage && (
            <div className="sm:col-span-2 flex justify-end">
              <Button variant="primary" onClick={saveProfile} disabled={!!busy}>{busy === "profile" ? "Saving…" : "Save details"}</Button>
            </div>
          )}
        </FieldSection>
      </div>

      <div className="space-y-5 min-w-0">
        <Card>
          <CardHeader title="A full month at this salary" />
          <div className="px-5 pb-5 text-sm">
            {!preview ? (
              <p className="text-muted-foreground">Enter a monthly gross to see the payslip.</p>
            ) : (
              <table className="table-raw w-full">
                <tbody>
                  {preview.earnings.map((l) => <tr key={l.code}><td className="py-1">{l.label}</td><td className="py-1 text-right tabular-nums">{rupees(l.amount)}</td></tr>)}
                  <tr className="border-t border-border font-semibold"><td className="py-1.5">Gross</td><td className="py-1.5 text-right tabular-nums">{rupees(preview.gross)}</td></tr>
                  {preview.deductions.map((l) => <tr key={l.code}><td className="py-1 text-muted-foreground">less {l.label}</td><td className="py-1 text-right tabular-nums">{rupees(l.amount)}</td></tr>)}
                  <tr className="border-t border-border font-semibold"><td className="py-1.5">Net pay</td><td className="py-1.5 text-right tabular-nums">{rupees(preview.net)}</td></tr>
                  <tr><td className="pt-3 text-muted-foreground">Cost to the firm</td><td className="pt-3 text-right tabular-nums">{rupees(preview.employerCost)}</td></tr>
                  <tr><td className="text-muted-foreground">Yearly (CTC)</td><td className="text-right tabular-nums">{rupees(preview.employerCost * 12)}</td></tr>
                </tbody>
              </table>
            )}
            {preview && preview.warnings.length > 0 && (
              <div className="mt-3 rounded-lg border border-warning/50 bg-warning/5 p-3 space-y-1">{preview.warnings.map((w) => <p key={w}>{w}</p>)}</div>
            )}
            <p className="mt-3 text-2xs text-muted-foreground">Tax is estimated as if this salary ran the whole year under the new regime.</p>
          </div>
        </Card>

        <Card>
          <CardHeader title="Salary history" />
          <div className="px-5 pb-5 text-sm">
            {history.length === 0 ? (
              <p className="text-muted-foreground">No salary yet.</p>
            ) : (
              <ul className="space-y-2">
                {history.map((h) => (
                  <li key={h.id} className="flex flex-wrap justify-between gap-2">
                    <span>From {h.effectiveFrom}{h.note ? ` — ${h.note}` : ""}</span>
                    <span className="tabular-nums font-medium">{rupees(h.monthlyGross)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
