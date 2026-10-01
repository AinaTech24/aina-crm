"use client";

/**
 * Record or edit a fixed deposit. The maturity date and the tenure drive each
 * other (type a tenure → the date follows; pick a date → the tenure follows),
 * and the maturity amount is computed live from lib/fixed-deposits/terms.ts
 * unless the receipt's figure is typed in.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Calculator } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field, FieldSection } from "@/components/ui/Field";
import { SelectField } from "@/components/ui/SelectField";
import { DateField } from "@/components/ui/DateField";
import { FormActions } from "@/components/ui/FormActions";
import { notify } from "@/components/ui/Toast";
import { InvestorLookup } from "@/components/common/InvestorLookup";
import { formatMoney } from "@/lib/format";
import {
  COMPOUNDING_LABELS, HOLDING_LABELS, ISSUER_TYPE_LABELS, PAYOUT_LABELS, STATUS_LABELS, TAX_FORM_LABELS,
  computeMaturity, maturityDateFor, tenureBetween,
} from "@/lib/fixed-deposits/terms";
import type { FdFormValue } from "@/lib/fixed-deposits/form";

const ISSUERS = [
  "State Bank of India", "HDFC Bank", "ICICI Bank", "Axis Bank", "Kotak Mahindra Bank", "Bank of Baroda",
  "Punjab National Bank", "Canara Bank", "Union Bank of India", "IDFC FIRST Bank", "IndusInd Bank", "Yes Bank",
  "AU Small Finance Bank", "Equitas Small Finance Bank", "Ujjivan Small Finance Bank", "Unity Small Finance Bank",
  "Bajaj Finance", "Shriram Finance", "Mahindra Finance", "PNB Housing Finance", "LIC Housing Finance",
  "Sundaram Finance", "ICICI Home Finance", "Post Office Time Deposit",
];

const TENURES: Array<[string, number, number]> = [
  ["6 months", 6, 0], ["1 year", 12, 0], ["15 months", 15, 0], ["2 years", 24, 0], ["3 years", 36, 0], ["5 years", 60, 0],
];

const n = (s: string) => (s.trim() === "" ? null : Number(s));

export function FdForm({
  initial, staff, lockClient = false, cancelHref,
}: {
  initial: FdFormValue;
  staff: Array<{ id: string; name: string }>;
  /** The client cannot change (editing, or adding from a client page). */
  lockClient?: boolean;
  cancelHref: string;
}) {
  const router = useRouter();
  const [v, setV] = useState<FdFormValue>(initial);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = <K extends keyof FdFormValue>(k: K, val: FdFormValue[K]) => setV((p) => ({ ...p, [k]: val }));

  const initialTenure = initial.depositDate && initial.maturityDate ? tenureBetween(initial.depositDate, initial.maturityDate) : { months: 12, days: 0 };
  const [months, setMonths] = useState(String(initialTenure.months || ""));
  const [days, setDays] = useState(String(initialTenure.days || ""));

  function fromTenure(m: string, d: string, dep = v.depositDate) {
    setMonths(m); setDays(d);
    if (dep && (Number(m) > 0 || Number(d) > 0)) set("maturityDate", maturityDateFor(dep, Number(m) || 0, Number(d) || 0));
  }
  function fromMaturity(date: string) {
    set("maturityDate", date);
    if (v.depositDate && date > v.depositDate) {
      const t = tenureBetween(v.depositDate, date);
      setMonths(t.months ? String(t.months) : ""); setDays(t.days ? String(t.days) : "");
    }
  }
  function fromDeposit(date: string) {
    set("depositDate", date);
    if (date && (Number(months) > 0 || Number(days) > 0)) set("maturityDate", maturityDateFor(date, Number(months) || 0, Number(days) || 0));
  }

  const figures = useMemo(() => computeMaturity({
    principal: Number(v.principal), rate: Number(v.interestRate), depositDate: v.depositDate, maturityDate: v.maturityDate,
    payout: v.payout, compounding: v.compounding,
  }), [v.principal, v.interestRate, v.depositDate, v.maturityDate, v.payout, v.compounding]);

  // A receipt figure below the deposit is a typo (a cumulative FD only grows).
  const receiptTooLow = v.payout === "cumulative" && n(v.maturityAmount) != null && Number(v.maturityAmount) > 0
    && Number(v.principal) > 0 && Number(v.maturityAmount) < Number(v.principal);
  const receipt = receiptTooLow ? null : n(v.maturityAmount);

  const commissionEstimate = n(v.commissionRate) != null && Number(v.principal) > 0
    ? Math.round(Number(v.principal) * Number(v.commissionRate)) / 100 : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const err: Record<string, string> = {};
    if (!v.investorId) err.investor = "Pick the client";
    if (!v.issuer.trim()) err.issuer = "Enter the bank or company";
    if (!(Number(v.principal) > 0)) err.principal = "Enter the amount deposited";
    if (v.interestRate.trim() === "" || !(Number(v.interestRate) >= 0)) err.interestRate = "Enter the interest rate";
    if (!v.depositDate) err.depositDate = "Pick the deposit date";
    if (!v.maturityDate || v.maturityDate <= v.depositDate) err.maturityDate = "Maturity must be after the deposit date";
    if (receiptTooLow) err.maturityAmount = "Cannot be less than the amount deposited";
    setErrors(err);
    if (Object.keys(err).length) { notify.error("Some details are missing"); return; }

    const body: Record<string, unknown> = {
      rmId: v.rmId || null,
      issuer: v.issuer.trim(),
      issuerType: v.issuerType,
      schemeName: v.schemeName.trim() || null,
      fdNumber: v.fdNumber.trim() || null,
      depositDate: v.depositDate,
      maturityDate: v.maturityDate,
      principal: Number(v.principal),
      interestRate: Number(v.interestRate),
      payout: v.payout,
      compounding: v.compounding,
      maturityAmount: v.payout === "cumulative" ? n(v.maturityAmount) : null,
      holding: v.holding,
      jointHolders: v.holding === "single" ? null : v.jointHolders.trim() || null,
      nomineeName: v.nomineeName.trim() || null,
      seniorCitizen: v.seniorCitizen,
      taxForm: v.taxForm,
      autoRenew: v.autoRenew,
      status: v.status,
      commissionRate: n(v.commissionRate),
      commissionAmount: n(v.commissionAmount) ?? commissionEstimate,
      remarks: v.remarks.trim() || null,
    };
    if (!v.id) {
      body.investorId = v.investorId;
      if (v.renewedFromId) body.renewedFromId = v.renewedFromId;
    }

    setBusy(true);
    try {
      const res = await fetch(v.id ? `/api/fixed-deposits/${v.id}` : "/api/fixed-deposits", {
        method: v.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { notify.error(j.error ?? "Could not save the fixed deposit"); return; }
      notify.success(v.id ? "Fixed deposit updated" : "Fixed deposit recorded — a maturity follow-up is on the RM's list");
      router.push(`/dashboard/fixed-deposits/${j.fixedDeposit.id}`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const input = "input-base w-full";

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <FieldSection title="Client" description="Whose deposit this is, and the RM who follows it up at maturity.">
        <Field label="Client" required error={errors.investor}>
          {() => lockClient ? (
            <div className="input-base flex w-full items-center bg-secondary/60">{v.investorName}</div>
          ) : (
            <InvestorLookup
              value={v.investorId || null}
              displayName={v.investorName || null}
              onSelect={(id, name) => setV((p) => ({ ...p, investorId: id, investorName: name }))}
              onClear={() => setV((p) => ({ ...p, investorId: "", investorName: "" }))}
              placeholder="Search client by name, PAN, mobile…"
              required
            />
          )}
        </Field>
        <Field label="Relationship manager" optional hint="Defaults to the client's RM.">
          {(id, d) => (
            <SelectField id={id} aria-describedby={d} value={v.rmId} onChange={(e) => set("rmId", e.target.value)} className="w-full">
              <option value="">The client's RM</option>
              {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </SelectField>
          )}
        </Field>
      </FieldSection>

      <FieldSection title="Deposit" description="As printed on the deposit receipt.">
        <Field label="Bank or company" required error={errors.issuer}>
          {(id, d) => (
            <>
              <input id={id} aria-describedby={d} className={input} list="fd-issuers" value={v.issuer}
                onChange={(e) => set("issuer", e.target.value)} placeholder="e.g. HDFC Bank" autoComplete="off" />
              <datalist id="fd-issuers">{ISSUERS.map((i) => <option key={i} value={i} />)}</datalist>
            </>
          )}
        </Field>
        <Field label="Issuer type">
          {(id, d) => (
            <SelectField id={id} aria-describedby={d} value={v.issuerType} onChange={(e) => set("issuerType", e.target.value)} className="w-full">
              {Object.entries(ISSUER_TYPE_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </SelectField>
          )}
        </Field>
        <Field label="Scheme" optional>
          {(id, d) => <input id={id} aria-describedby={d} className={input} value={v.schemeName} onChange={(e) => set("schemeName", e.target.value)} placeholder="e.g. Tax Saver FD" />}
        </Field>
        <Field label="FD / receipt number" optional>
          {(id, d) => <input id={id} aria-describedby={d} className={input} value={v.fdNumber} onChange={(e) => set("fdNumber", e.target.value)} />}
        </Field>
        <Field label="Amount deposited (₹)" required error={errors.principal}>
          {(id, d) => <input id={id} aria-describedby={d} className={input} inputMode="decimal" value={v.principal}
            onChange={(e) => set("principal", e.target.value.replace(/[^0-9.]/g, ""))} placeholder="500000" />}
        </Field>
        <Field label="Interest rate (% a year)" required error={errors.interestRate}
          hint={v.seniorCitizen ? "Enter the senior-citizen rate the receipt shows." : undefined}>
          {(id, d) => <input id={id} aria-describedby={d} className={input} inputMode="decimal" value={v.interestRate}
            onChange={(e) => set("interestRate", e.target.value.replace(/[^0-9.]/g, ""))} placeholder="7.25" />}
        </Field>
      </FieldSection>

      <FieldSection title="Tenure and interest" description="Type a tenure or pick the maturity date — the other follows.">
        <Field label="Deposit date" required error={errors.depositDate}>
          {(id) => <DateField id={id} value={v.depositDate} onChange={(e) => fromDeposit(e.target.value)} />}
        </Field>
        <Field label="Tenure" hint={
          <span className="flex flex-wrap gap-1.5">
            {TENURES.map(([label, m, d]) => (
              <button key={label} type="button" className="chip hover:bg-secondary" onClick={() => fromTenure(String(m), d ? String(d) : "")}>{label}</button>
            ))}
          </span>
        }>
          {(id, d) => (
            <div className="flex items-center gap-2">
              <input id={id} aria-describedby={d} aria-label="Months" className="input-base w-24" inputMode="numeric" value={months}
                onChange={(e) => fromTenure(e.target.value.replace(/\D/g, ""), days)} />
              <span className="text-sm text-muted-foreground">months</span>
              <input aria-label="Days" className="input-base w-20" inputMode="numeric" value={days}
                onChange={(e) => fromTenure(months, e.target.value.replace(/\D/g, ""))} />
              <span className="text-sm text-muted-foreground">days</span>
            </div>
          )}
        </Field>
        <Field label="Maturity date" required error={errors.maturityDate}>
          {(id) => <DateField id={id} value={v.maturityDate} min={v.depositDate || undefined} onChange={(e) => fromMaturity(e.target.value)} />}
        </Field>
        <Field label="Interest payout">
          {(id, d) => (
            <SelectField id={id} aria-describedby={d} value={v.payout} onChange={(e) => set("payout", e.target.value)} className="w-full">
              {Object.entries(PAYOUT_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </SelectField>
          )}
        </Field>
        {v.payout === "cumulative" && (
          <Field label="Compounding" hint="Banks compound quarterly; many corporate FDs yearly.">
            {(id, d) => (
              <SelectField id={id} aria-describedby={d} value={v.compounding} onChange={(e) => set("compounding", e.target.value)} className="w-full">
                {Object.entries(COMPOUNDING_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </SelectField>
            )}
          </Field>
        )}
        {v.payout === "cumulative" && (
          <Field label="Maturity amount from the receipt (₹)" optional error={errors.maturityAmount ?? (receiptTooLow ? "Cannot be less than the amount deposited" : null)}
            hint={figures ? `Leave blank to use the calculated ${formatMoney(figures.maturityAmount, { scale: "full" })}.` : "Leave blank to have it calculated."}>
            {(id, d) => <input id={id} aria-describedby={d} className={input} inputMode="decimal" value={v.maturityAmount}
              onChange={(e) => set("maturityAmount", e.target.value.replace(/[^0-9.]/g, ""))} />}
          </Field>
        )}
        <div className="sm:col-span-2">
          <div className="flex items-start gap-3 rounded-lg bg-secondary/70 p-4">
            <Calculator className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            {figures ? (
              <dl className="grid flex-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
                <div><dt className="text-xs text-muted-foreground">On maturity</dt>
                  <dd className="font-semibold tabular-nums">{formatMoney(receipt ?? figures.maturityAmount, { scale: "full" })}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Interest over the tenure</dt>
                  <dd className="font-semibold tabular-nums">{formatMoney(v.payout === "cumulative" && receipt != null ? receipt - Number(v.principal) : figures.interest, { scale: "full" })}</dd></div>
                {figures.periodicInterest != null && (
                  <div><dt className="text-xs text-muted-foreground">Each {PAYOUT_LABELS[v.payout]?.split(" ")[0].toLowerCase()} payout</dt>
                    <dd className="font-semibold tabular-nums">{formatMoney(figures.periodicInterest, { scale: "full" })}</dd></div>
                )}
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">Enter the amount, rate and dates to see the maturity value.</p>
            )}
          </div>
        </div>
      </FieldSection>

      <FieldSection title="Holders and tax">
        <Field label="Holding">
          {(id, d) => (
            <SelectField id={id} aria-describedby={d} value={v.holding} onChange={(e) => set("holding", e.target.value)} className="w-full">
              {Object.entries(HOLDING_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </SelectField>
          )}
        </Field>
        {v.holding !== "single" ? (
          <Field label="Joint holders" optional>
            {(id, d) => <input id={id} aria-describedby={d} className={input} value={v.jointHolders} onChange={(e) => set("jointHolders", e.target.value)} placeholder="Names, in order" />}
          </Field>
        ) : <div className="hidden sm:block" />}
        <Field label="Nominee" optional>
          {(id, d) => <input id={id} aria-describedby={d} className={input} value={v.nomineeName} onChange={(e) => set("nomineeName", e.target.value)} />}
        </Field>
        <Field label="Form 15G / 15H" hint="Submitted so the bank does not deduct TDS.">
          {(id, d) => (
            <SelectField id={id} aria-describedby={d} value={v.taxForm} onChange={(e) => set("taxForm", e.target.value)} className="w-full">
              {Object.entries(TAX_FORM_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </SelectField>
          )}
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={v.seniorCitizen} onChange={(e) => set("seniorCitizen", e.target.checked)} />
          Senior-citizen rate
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={v.autoRenew} onChange={(e) => set("autoRenew", e.target.checked)} />
          Set to auto-renew at maturity
        </label>
      </FieldSection>

      <FieldSection title="Status and commission">
        <Field label="Status" hint="Applied = form submitted, receipt not yet issued.">
          {(id, d) => (
            <SelectField id={id} aria-describedby={d} value={v.status} onChange={(e) => set("status", e.target.value)} className="w-full">
              {Object.entries(STATUS_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </SelectField>
          )}
        </Field>
        <Field label="Commission rate (%)" optional>
          {(id, d) => <input id={id} aria-describedby={d} className={input} inputMode="decimal" value={v.commissionRate}
            onChange={(e) => set("commissionRate", e.target.value.replace(/[^0-9.]/g, ""))} placeholder="0.50" />}
        </Field>
        <Field label="Commission amount (₹)" optional
          hint={commissionEstimate != null && !v.commissionAmount ? `Leave blank to record ${formatMoney(commissionEstimate, { scale: "full" })} (rate × amount).` : undefined}>
          {(id, d) => <input id={id} aria-describedby={d} className={input} inputMode="decimal" value={v.commissionAmount}
            onChange={(e) => set("commissionAmount", e.target.value.replace(/[^0-9.]/g, ""))} />}
        </Field>
        <Field label="Remarks" optional className="sm:col-span-2">
          {(id, d) => <textarea id={id} aria-describedby={d} className="input-base min-h-20 w-full" value={v.remarks} onChange={(e) => set("remarks", e.target.value)} />}
        </Field>
      </FieldSection>

      <FormActions>
        <Button type="button" variant="ghost" onClick={() => router.push(cancelHref)}>Cancel</Button>
        <Button type="submit" variant="primary" loading={busy}>{v.id ? "Save changes" : "Save fixed deposit"}</Button>
      </FormActions>
    </form>
  );
}
