"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Save, AlertCircle } from "lucide-react";

const DEPARTMENTS = [
  { value: "sales", label: "Sales" },
  { value: "operations", label: "Operations" },
  { value: "back_office", label: "Back Office" },
  { value: "compliance", label: "Compliance" },
  { value: "marketing", label: "Marketing" },
  { value: "advisory", label: "Advisory" },
  { value: "support", label: "Support" },
  { value: "leadership", label: "Leadership" },
  { value: "other", label: "Other" },
];

const ROLES = [
  { key: "owner", label: "Owner / Admin" },
  { key: "rm", label: "Relationship Manager" },
  { key: "branch_head", label: "Branch Head" },
  { key: "back_office", label: "Back Office" },
  { key: "marketing", label: "Marketing" },
  { key: "compliance", label: "Compliance / DDQ" },
  { key: "team_member", label: "Limited Team Member" },
];

const STATUSES = [
  { value: "invited", label: "Invited (not yet activated)" },
  { value: "active", label: "Active" },
  { value: "suspended", label: "Suspended" },
  { value: "offboarding", label: "Offboarding" },
  { value: "offboarded", label: "Offboarded" },
];

export type EmployeeFormValues = {
  id: string;
  name: string;
  email: string;
  phone: string;
  roles: string[];
  department: string | null;
  joiningDate: string | null;
  reportingManagerId: string | null;
  annualTarget: number | null;
  sipMonthlyTarget: number | null;
  notes: string;
  euin: string;
  nismCertificateNo: string;
  nismExpiryAt: string | null;
  status: string;
};

export function EmployeeEditForm({
  employee,
  teammates,
}: {
  employee: EmployeeFormValues;
  teammates: { id: string; name: string; email: string | null }[];
}) {
  const router = useRouter();
  const [v, setV] = useState<EmployeeFormValues>(employee);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function toggleRole(k: string) {
    setV((p) => ({ ...p, roles: p.roles.includes(k) ? p.roles.filter((r) => r !== k) : [...p.roles, k] }));
  }
  function update<K extends keyof EmployeeFormValues>(k: K, val: EmployeeFormValues[K]) {
    setV((p) => ({ ...p, [k]: val }));
    setSaved(false);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const r = await fetch(`/api/employees/${employee.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: v.name,
          phone: v.phone || null,
          roles: v.roles,
          department: v.department || null,
          joiningDate: v.joiningDate || null,
          reportingManagerId: v.reportingManagerId || null,
          annualTarget: v.annualTarget,
          sipMonthlyTarget: v.sipMonthlyTarget,
          notes: v.notes || null,
          euin: v.euin || null,
          nismCertificateNo: v.nismCertificateNo || null,
          nismExpiryAt: v.nismExpiryAt || null,
          status: v.status,
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data?.error ?? `HTTP ${r.status}`);
      setSaved(true);
      router.refresh();
    } catch (err: any) {
      setError(err?.message ?? "Failed to save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card-surface p-5 space-y-5">
      <h3 className="font-semibold text-sm">Employee details</h3>

      {error && (
        <div className="text-xs text-rose-700 bg-rose-50 rounded-md p-2 flex items-start gap-2">
          <AlertCircle className="size-3.5 mt-0.5" /> {error}
        </div>
      )}
      {saved && <div className="text-xs text-emerald-700 bg-emerald-50 rounded-md p-2">✓ Saved</div>}

      {/* Identity row */}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Employee Name *">
          <input value={v.name} onChange={(e) => update("name", e.target.value)} className="input-base text-sm w-full" required />
        </Field>
        <Field label="Email (read-only)">
          <input value={v.email} disabled className="input-base text-sm w-full bg-secondary/50" />
        </Field>
        <Field label="Mobile">
          <input value={v.phone} onChange={(e) => update("phone", e.target.value)} className="input-base text-sm w-full" placeholder="+91 9xxxxxxxxx" />
        </Field>
        <Field label="Status">
          <select value={v.status} onChange={(e) => update("status", e.target.value)} className="input-base text-sm w-full">
            {STATUSES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </Field>
      </div>

      {/* Roles */}
      <div>
        <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-1.5">Roles</div>
        <div className="grid grid-cols-2 gap-1.5 md:grid-cols-3">
          {ROLES.map((r) => (
            <label key={r.key} className="flex items-center gap-1.5 border rounded-md p-1.5 cursor-pointer hover:bg-secondary/40 text-xs">
              <input type="checkbox" checked={v.roles.includes(r.key)} onChange={() => toggleRole(r.key)} />
              {r.label}
            </label>
          ))}
        </div>
      </div>

      {/* HR fields */}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Department">
          <select
            value={v.department ?? ""}
            onChange={(e) => update("department", (e.target.value || null) as any)}
            className="input-base text-sm w-full"
          >
            <option value="">—</option>
            {DEPARTMENTS.map((d) => (
              <option key={d.value} value={d.value}>{d.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Joining Date">
          <input
            type="date"
            value={v.joiningDate ?? ""}
            onChange={(e) => update("joiningDate", e.target.value || null)}
            className="input-base text-sm w-full"
          />
        </Field>
        <Field label="Reporting Manager">
          <select
            value={v.reportingManagerId ?? ""}
            onChange={(e) => update("reportingManagerId", e.target.value || null)}
            className="input-base text-sm w-full"
          >
            <option value="">(none)</option>
            {teammates.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Annual Target (₹)">
          <input
            type="number"
            min={0}
            step={10000}
            value={v.annualTarget ?? ""}
            onChange={(e) => update("annualTarget", e.target.value === "" ? null : Number(e.target.value))}
            className="input-base text-sm w-full"
            placeholder="e.g. 50000000"
          />
        </Field>
        <Field label="Monthly SIP Target (₹)">
          <input
            type="number"
            min={0}
            step={10000}
            value={v.sipMonthlyTarget ?? ""}
            onChange={(e) => update("sipMonthlyTarget", e.target.value === "" ? null : Number(e.target.value))}
            className="input-base text-sm w-full"
            placeholder="e.g. 500000"
          />
        </Field>
      </div>

      {/* Compliance fields */}
      <details className="border rounded-md p-3 bg-secondary/20">
        <summary className="text-xs font-semibold cursor-pointer">Compliance — EUIN / NISM (optional)</summary>
        <div className="grid grid-cols-2 gap-3 mt-3">
          <Field label="EUIN">
            <input value={v.euin} onChange={(e) => update("euin", e.target.value)} className="input-base text-sm w-full font-mono" />
          </Field>
          <Field label="NISM Certificate No.">
            <input
              value={v.nismCertificateNo}
              onChange={(e) => update("nismCertificateNo", e.target.value)}
              className="input-base text-sm w-full font-mono"
            />
          </Field>
          <Field label="NISM Expiry">
            <input
              type="date"
              value={v.nismExpiryAt ?? ""}
              onChange={(e) => update("nismExpiryAt", e.target.value || null)}
              className="input-base text-sm w-full"
            />
          </Field>
        </div>
      </details>

      {/* Notes */}
      <Field label="Notes (HR / manager comments)">
        <textarea
          rows={3}
          value={v.notes}
          onChange={(e) => update("notes", e.target.value)}
          className="input-base text-sm w-full"
          placeholder="Any HR or manager notes about this employee."
        />
      </Field>

      <div className="flex justify-end pt-3 border-t">
        <button type="submit" disabled={busy} className="btn-primary text-sm">
          <Save className="size-4" /> {busy ? "Saving…" : "Save changes"}
        </button>
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-1">{label}</div>
      {children}
    </label>
  );
}
