"use client";

/**
 * New Insurance Policy form.
 *
 *  1. Pick the client (InvestorLookup).
 *  2. Plan details — insurer, plan name, type, sum assured, premium.
 *  3. Schedule — start, term, next premium due.
 *  4. Nominee.
 *  5. Status + remarks.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  Shield,
  Loader2,
  Save,
  Calendar,
  Users,
  IndianRupee,
  CalendarClock,
} from "lucide-react";
import { InvestorLookup } from "@/components/common/InvestorLookup";
import { formatINR } from "@/lib/utils";

const POLICY_TYPES: [string, string][] = [
  ["term", "Term Life"],
  ["ulip", "ULIP"],
  ["endowment", "Endowment"],
  ["money_back", "Money-back"],
  ["health", "Health"],
  ["critical_illness", "Critical Illness"],
  ["personal_accident", "Personal Accident"],
  ["motor", "Motor"],
  ["travel", "Travel"],
  ["home", "Home"],
  ["life_other", "Life — Other"],
  ["general_other", "General — Other"],
];

const FREQ_FACTORS: Record<string, number> = {
  single: 0, // single-pay — annualized equivalent N/A
  annual: 1,
  semi_annual: 2,
  quarterly: 4,
  monthly: 12,
};

export default function NewInsurancePage() {
  const router = useRouter();
  const [investor, setInvestor] = useState<{ id: string; name: string } | null>(null);
  const [form, setForm] = useState({
    policyNumber: "",
    insurer: "",
    planName: "",
    policyType: "term",
    livesCovered: 1,
    sumAssured: "",
    annualPremium: "",
    premiumFrequency: "annual",
    premiumPayingTermYears: "",
    policyTermYears: "",
    policyStartDate: new Date().toISOString().slice(0, 10),
    maturityDate: "",
    nextPremiumDueDate: "",
    nomineeName: "",
    nomineeRelation: "",
    nomineeShare: 100,
    status: "active",
    remarks: "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((s) => ({ ...s, [k]: v }));
  }

  /** Derived: premium per installment based on annualPremium ÷ frequency factor. */
  const installment = useMemo(() => {
    const ann = parseFloat(form.annualPremium) || 0;
    const factor = FREQ_FACTORS[form.premiumFrequency] ?? 1;
    if (!ann || !factor) return null;
    return ann / factor;
  }, [form.annualPremium, form.premiumFrequency]);

  /** Auto-derive maturity date from start + policyTermYears. */
  function autoMaturity() {
    if (!form.policyStartDate || !form.policyTermYears) return;
    const start = new Date(form.policyStartDate);
    start.setFullYear(start.getFullYear() + Number(form.policyTermYears));
    set("maturityDate", start.toISOString().slice(0, 10));
  }

  async function save() {
    if (!investor) {
      setErr("Pick a client first.");
      return;
    }
    if (!form.insurer.trim() || !form.planName.trim()) {
      setErr("Insurer and plan name are required.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const payload: any = {
        investorId: investor.id,
        policyNumber: form.policyNumber || undefined,
        insurer: form.insurer,
        planName: form.planName,
        policyType: form.policyType,
        livesCovered: Number(form.livesCovered) || 1,
        sumAssured: form.sumAssured ? Number(form.sumAssured) : undefined,
        annualPremium: form.annualPremium ? Number(form.annualPremium) : undefined,
        premiumFrequency: form.premiumFrequency,
        premiumPayingTermYears: form.premiumPayingTermYears
          ? Number(form.premiumPayingTermYears)
          : undefined,
        policyTermYears: form.policyTermYears ? Number(form.policyTermYears) : undefined,
        policyStartDate: form.policyStartDate || undefined,
        maturityDate: form.maturityDate || undefined,
        nextPremiumDueDate: form.nextPremiumDueDate || undefined,
        nomineeName: form.nomineeName || undefined,
        nomineeRelation: form.nomineeRelation || undefined,
        nomineeShare: Number(form.nomineeShare) || 100,
        status: form.status,
        remarks: form.remarks || undefined,
      };
      const res = await fetch("/api/insurance", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await res.json();
      if (!res.ok) {
        setErr(j.error ?? `Save failed (${res.status})`);
        return;
      }
      router.push(`/dashboard/insurance/${j.id}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 max-w-5xl">
      <Link
        href="/dashboard/insurance"
        className="text-sm text-muted-foreground hover:underline hover:text-foreground flex items-center gap-1 transition-colors"
      >
        <ChevronLeft className="size-4" /> Back to policies
      </Link>

      <div>
        <h1 className="page-title">
          <Shield className="size-6 text-brand-cyan" /> Add insurance policy
        </h1>
        <p className="page-subtitle">
          Record an existing policy the client owns — Term · ULIP · Endowment · Health · Motor.
        </p>
      </div>

      {/* Client picker */}
      <div className="card-surface p-5 space-y-2">
        <div className="flex items-center gap-2">
          <div className="h-4 w-1 rounded-full brand-bar" />
          <h2 className="section-title">1. Policyholder</h2>
        </div>
        <InvestorLookup
          value={investor?.id ?? null}
          displayName={investor?.name ?? null}
          onSelect={(id, name) => setInvestor({ id, name })}
          onClear={() => setInvestor(null)}
          placeholder="Search client by name, PAN, mobile…"
          required
        />
      </div>

      {/* Plan details */}
      <div className="card-surface p-5 space-y-3">
        <div className="flex items-center gap-2">
          <div className="h-4 w-1 rounded-full brand-bar" />
          <h2 className="section-title">2. Plan details</h2>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Insurer *" placeholder="HDFC Life" value={form.insurer} setValue={(v) => set("insurer", v)} />
          <div className="col-span-2">
            <Field
              label="Plan name *"
              placeholder="Click 2 Protect Super"
              value={form.planName}
              setValue={(v) => set("planName", v)}
            />
          </div>
          <Field
            label="Policy number"
            placeholder="HD123456789"
            value={form.policyNumber}
            setValue={(v) => set("policyNumber", v)}
          />
          <label className="block">
            <div className="text-xs font-medium mb-1">Policy type *</div>
            <select
              value={form.policyType}
              onChange={(e) => set("policyType", e.target.value)}
              className="input-base"
            >
              {POLICY_TYPES.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <Field
            label="Lives covered"
            type="number"
            placeholder="1"
            value={String(form.livesCovered)}
            setValue={(v) => set("livesCovered", Number(v) || 1)}
          />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field
            label="Sum assured (₹)"
            type="number"
            placeholder="10000000"
            value={form.sumAssured}
            setValue={(v) => set("sumAssured", v)}
          />
          <Field
            label="Annual premium (₹)"
            type="number"
            placeholder="18000"
            value={form.annualPremium}
            setValue={(v) => set("annualPremium", v)}
          />
          <label className="block">
            <div className="text-xs font-medium mb-1">Premium frequency</div>
            <select
              value={form.premiumFrequency}
              onChange={(e) => set("premiumFrequency", e.target.value)}
              className="input-base"
            >
              <option value="single">Single-pay</option>
              <option value="annual">Annual</option>
              <option value="semi_annual">Semi-annual</option>
              <option value="quarterly">Quarterly</option>
              <option value="monthly">Monthly</option>
            </select>
          </label>
        </div>
        {installment != null && (
          <div className="rounded-lg bg-brand-cyan-light/30 border border-brand-cyan/20 px-3 py-2 text-xs flex items-center gap-2">
            <IndianRupee className="size-3.5 text-brand-cyan-deep" />
            <span>
              Each installment ≈{" "}
              <strong className="tabular-nums">{formatINR(Math.round(installment))}</strong> ·{" "}
              {form.premiumFrequency.replace(/_/g, " ")}
            </span>
          </div>
        )}
      </div>

      {/* Schedule */}
      <div className="card-surface p-5 space-y-3">
        <div className="flex items-center gap-2">
          <div className="h-4 w-1 rounded-full brand-bar" />
          <h2 className="section-title">3. Schedule</h2>
        </div>
        <div className="grid grid-cols-4 gap-3">
          <Field
            label="Policy start"
            type="date"
            value={form.policyStartDate}
            setValue={(v) => set("policyStartDate", v)}
          />
          <Field
            label="Policy term (years)"
            type="number"
            placeholder="30"
            value={form.policyTermYears}
            setValue={(v) => set("policyTermYears", v)}
          />
          <Field
            label="Premium paying term"
            type="number"
            placeholder="20"
            value={form.premiumPayingTermYears}
            setValue={(v) => set("premiumPayingTermYears", v)}
          />
          <div className="flex flex-col">
            <Field
              label="Maturity"
              type="date"
              value={form.maturityDate}
              setValue={(v) => set("maturityDate", v)}
            />
            <button
              type="button"
              onClick={autoMaturity}
              className="text-[10px] text-brand-cyan-deep hover:underline mt-1 text-left"
            >
              ⤷ Auto from start + term
            </button>
          </div>
          <Field
            label="Next premium due"
            type="date"
            value={form.nextPremiumDueDate}
            setValue={(v) => set("nextPremiumDueDate", v)}
          />
        </div>
      </div>

      {/* Nominee */}
      <div className="card-surface p-5 space-y-3">
        <div className="flex items-center gap-2">
          <div className="h-4 w-1 rounded-full brand-bar" />
          <h2 className="section-title">4. Nominee</h2>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field
            label="Nominee name"
            placeholder="Spouse / Child / Parent"
            value={form.nomineeName}
            setValue={(v) => set("nomineeName", v)}
          />
          <Field
            label="Relation"
            placeholder="Spouse"
            value={form.nomineeRelation}
            setValue={(v) => set("nomineeRelation", v)}
          />
          <Field
            label="Share %"
            type="number"
            value={String(form.nomineeShare)}
            setValue={(v) => set("nomineeShare", Number(v) || 100)}
          />
        </div>
      </div>

      {/* Status + remarks */}
      <div className="card-surface p-5 space-y-3">
        <div className="flex items-center gap-2">
          <div className="h-4 w-1 rounded-full brand-bar" />
          <h2 className="section-title">5. Status & remarks</h2>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <label className="block">
            <div className="text-xs font-medium mb-1">Status</div>
            <select
              value={form.status}
              onChange={(e) => set("status", e.target.value)}
              className="input-base"
            >
              <option value="proposed">Proposed</option>
              <option value="in_underwriting">In underwriting</option>
              <option value="active">Active</option>
              <option value="lapsed">Lapsed</option>
              <option value="matured">Matured</option>
              <option value="surrendered">Surrendered</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </label>
          <div className="col-span-2">
            <Field
              label="Remarks"
              placeholder="Notes — surrender value, rider details, claim history…"
              value={form.remarks}
              setValue={(v) => set("remarks", v)}
            />
          </div>
        </div>

        {err && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 text-destructive text-sm px-3 py-2">
            {err}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t border-border">
          <Link href="/dashboard/insurance" className="btn-secondary">
            Cancel
          </Link>
          <button
            type="button"
            onClick={save}
            disabled={busy || !investor || !form.insurer || !form.planName}
            className="btn-primary"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            {busy ? "Saving…" : "Save policy"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  setValue,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  setValue: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <div className="text-xs font-medium mb-1">{label}</div>
      <input
        type={type}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        className="input-base"
      />
    </label>
  );
}
