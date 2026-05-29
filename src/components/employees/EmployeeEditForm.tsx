"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Save, AlertCircle } from "lucide-react";
import { can, type Capability } from "@/lib/auth/rbac";

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

const ALL_CAPABILITIES = [
  {
    group: "Clients & Leads",
    items: [
      { key: "investor.view.all", label: "View All Clients" },
      { key: "investor.view.assigned", label: "View Assigned Clients Only" },
      { key: "investor.edit.all", label: "Edit All Clients" },
      { key: "investor.edit.assigned", label: "Edit Assigned Clients Only" },
      { key: "investor.bulk_export", label: "Bulk Export Clients" },
      { key: "investor.note.add", label: "Add Client Notes" },
      { key: "lead.view.all", label: "View All Leads" },
      { key: "lead.view.assigned", label: "View Assigned Leads Only" },
      { key: "lead.edit.all", label: "Edit All Leads" },
      { key: "lead.edit.assigned", label: "Edit Assigned Leads Only" },
    ]
  },
  {
    group: "Transactions & Operations",
    items: [
      { key: "transactions.view", label: "View Transactions" },
      { key: "transactions.execute", label: "Execute Transactions" },
      { key: "onboarding.manage", label: "Manage Onboarding" },
      { key: "kyc.manage", label: "Manage KYC Status" },
      { key: "review_meeting.manage.all", label: "Manage All Review Meetings" },
      { key: "review_meeting.manage.assigned", label: "Manage Assigned Review Meetings" },
      { key: "task.view.all", label: "View All Tasks" },
      { key: "task.view.assigned", label: "View Assigned Tasks Only" },
      { key: "task.edit.all", label: "Edit All Tasks" },
      { key: "task.edit.assigned", label: "Edit Assigned Tasks Only" },
      { key: "service_request.view.all", label: "View All Service Requests" },
      { key: "service_request.view.assigned", label: "View Assigned Service Requests" },
      { key: "service_request.manage", label: "Manage Service Requests" },
      { key: "complaint.manage", label: "Manage Complaints" },
    ]
  },
  {
    group: "Workflows & Marketing",
    items: [
      { key: "workflow.view", label: "View Workflow Rules" },
      { key: "workflow.edit", label: "Edit Workflow Rules" },
      { key: "workflow.publish", label: "Publish Workflow Rules" },
      { key: "segments.view", label: "View Segments & Filters" },
      { key: "segments.manage", label: "Manage Segments & Filters" },
      { key: "template.view", label: "View Comms Templates" },
      { key: "template.edit", label: "Edit Comms Templates" },
      { key: "template.approve", label: "Approve Comms Templates" },
      { key: "campaign.send", label: "Send Marketing Campaigns" },
      { key: "content_calendar.manage", label: "Manage Content Calendar" },
      { key: "consent.manage", label: "Manage Client Consents" },
      { key: "sop.manage", label: "Manage SOP Library" },
    ]
  },
  {
    group: "Compliance & Settings",
    items: [
      { key: "compliance.view", label: "View DDQ Compliance Status" },
      { key: "compliance.edit", label: "Edit DDQ Compliance Info" },
      { key: "compliance.approve", label: "Approve DDQ Compliance Items" },
      { key: "risk_profile.manage", label: "Manage Risk Profiles" },
      { key: "document.view", label: "View Documents" },
      { key: "document.upload", label: "Upload Documents" },
      { key: "document.delete", label: "Delete Documents" },
      { key: "settings.users", label: "Manage Users & Roles Settings" },
      { key: "settings.billing", label: "Manage Subscription & Billing" },
      { key: "settings.masters", label: "Manage Master Lists" },
      { key: "settings.security", label: "Manage Cybersecurity Settings" },
    ]
  },
  {
    group: "Dashboards & Reports",
    items: [
      { key: "dashboard.view.owner", label: "Owner Cockpit Dashboard" },
      { key: "dashboard.view.compliance", label: "Compliance Summary Dashboard" },
      { key: "dashboard.view.marketing", label: "Marketing Dashboard" },
      { key: "dashboard.view.ops", label: "Operations Dashboard" },
      { key: "dashboard.view.rm", label: "Relationship Manager Dashboard" },
      { key: "reports.business", label: "Access Business MIS Reports" },
      { key: "reports.team", label: "Access Team Performance Reports" },
      { key: "reports.commission", label: "Access Commission Reconciliation Reports" },
    ]
  }
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
  // — Network FP "ARN/EUIN Tracker" parity (migration 0018). Compliance team
  //   fills these so the per-team licensing report at
  //   /dashboard/reports/arn-euin-tracker stays current.
  employeeCode: string;
  distributingAmcs: string[];
  // NISM
  nismCertificateNo: string;
  nismExamDate: string | null;
  nismExpiryAt: string | null;
  nismCategory: string;
  // EUIN
  euin: string;
  euinExpiryAt: string | null;
  // ARN (personal — distinct from firm ARN on the tenant row)
  personalArn: string;
  arnRegistrationDate: string | null;
  arnExpiryAt: string | null;
  // DSC
  dscSubmitted: boolean;
  dscLastSubmittedAt: string | null;
  dscExpiryAt: string | null;
  status: string;
  permissions: string[] | null;
};

export function EmployeeEditForm({
  employee,
  teammates,
}: {
  employee: EmployeeFormValues;
  teammates: { id: string; name: string; email: string | null }[];
}) {
  const router = useRouter();
  const [v, setV] = useState<EmployeeFormValues>({ ...employee, permissions: employee.permissions || [] });
  const [customActive, setCustomActive] = useState(!!employee.permissions);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function toggleRole(k: string) {
    setV((p) => ({ ...p, roles: p.roles.includes(k) ? p.roles.filter((r) => r !== k) : [...p.roles, k] }));
  }
  
  const togglePermission = (cap: string) => {
    setV((p) => {
      const prevPerms = p.permissions || [];
      const next = prevPerms.includes(cap)
        ? prevPerms.filter((x) => x !== cap)
        : [...prevPerms, cap];
      return { ...p, permissions: next };
    });
  };

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
          permissions: customActive ? (v.permissions || []) : null,
          department: v.department || null,
          joiningDate: v.joiningDate || null,
          reportingManagerId: v.reportingManagerId || null,
          annualTarget: v.annualTarget,
          sipMonthlyTarget: v.sipMonthlyTarget,
          notes: v.notes || null,
          employeeCode: v.employeeCode || null,
          distributingAmcs: v.distributingAmcs.length ? v.distributingAmcs : null,
          euin: v.euin || null,
          euinExpiryAt: v.euinExpiryAt || null,
          nismCertificateNo: v.nismCertificateNo || null,
          nismExamDate: v.nismExamDate || null,
          nismExpiryAt: v.nismExpiryAt || null,
          nismCategory: v.nismCategory || null,
          personalArn: v.personalArn || null,
          arnRegistrationDate: v.arnRegistrationDate || null,
          arnExpiryAt: v.arnExpiryAt || null,
          dscSubmitted: v.dscSubmitted,
          dscLastSubmittedAt: v.dscLastSubmittedAt || null,
          dscExpiryAt: v.dscExpiryAt || null,
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

      {/* Custom Permissions Override */}
      <div className="border rounded-lg p-4 bg-secondary/10 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold">Customize Access Permissions</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              Override default role-based capabilities and dashboard/report access.
            </div>
          </div>
          <label className="flex items-center gap-1.5 text-xs font-medium cursor-pointer">
            <input
              type="checkbox"
              checked={customActive}
              onChange={(e) => {
                setCustomActive(e.target.checked);
                // If checking custom active, populate from roles defaults if empty
                if (e.target.checked && (!v.permissions || v.permissions.length === 0)) {
                  const defaults: string[] = [];
                  ALL_CAPABILITIES.forEach((grp) => {
                    grp.items.forEach((item) => {
                      if (can(v.roles, item.key as Capability)) {
                        defaults.push(item.key);
                      }
                    });
                  });
                  setV((prev) => ({ ...prev, permissions: defaults }));
                }
                setSaved(false);
              }}
            />
            <span>Customize</span>
          </label>
        </div>

        {customActive && (
          <div className="space-y-4 max-h-[300px] overflow-y-auto border rounded-md p-3 bg-card scrollbar-thin">
            {ALL_CAPABILITIES.map((grp) => (
              <div key={grp.group} className="space-y-1.5">
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground border-b pb-0.5">
                  {grp.group}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
                  {grp.items.map((item) => {
                    const isChecked = v.permissions?.includes(item.key) ?? false;
                    return (
                      <label
                        key={item.key}
                        className="flex items-center gap-2 border rounded p-1.5 hover:bg-secondary/40 text-[11px] cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => togglePermission(item.key)}
                        />
                        <span>{item.label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {!customActive && (
          <div className="text-[11px] text-muted-foreground bg-secondary/30 p-2.5 rounded border">
            Using default permissions determined by selected roles:{" "}
            <strong className="text-foreground">{v.roles.join(", ")}</strong>. Check "Customize" to set granular access overrides.
          </div>
        )}
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

      {/* Compliance / licensing — Network FP "ARN/EUIN Tracker" parity.
          These fields drive the team licensing report at
          /dashboard/reports/arn-euin-tracker + the daily expiry events. */}
      <details className="border rounded-md p-3 bg-secondary/20" open>
        <summary className="text-xs font-semibold cursor-pointer">
          Compliance — ARN / EUIN / NISM / DSC
        </summary>

        {/* HR + AMCs */}
        <div className="grid grid-cols-2 gap-3 mt-3">
          <Field label="Employee Code">
            <input
              value={v.employeeCode}
              onChange={(e) => update("employeeCode", e.target.value)}
              className="input-base text-sm w-full font-mono"
              placeholder="e.g. EMP-001"
            />
          </Field>
          <Field label="Distributing AMCs (comma-separated)">
            <input
              value={v.distributingAmcs.join(", ")}
              onChange={(e) =>
                update(
                  "distributingAmcs",
                  e.target.value
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean)
                )
              }
              className="input-base text-sm w-full"
              placeholder="HDFC, ICICI, SBI, Axis"
            />
          </Field>
        </div>

        {/* NISM block */}
        <div className="mt-4 mb-1 text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
          NISM
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="NISM Certificate No.">
            <input
              value={v.nismCertificateNo}
              onChange={(e) => update("nismCertificateNo", e.target.value)}
              className="input-base text-sm w-full font-mono"
            />
          </Field>
          <Field label="NISM Category (V-A, V-B, …)">
            <input
              value={v.nismCategory}
              onChange={(e) => update("nismCategory", e.target.value)}
              className="input-base text-sm w-full"
              placeholder="V-A"
            />
          </Field>
          <Field label="NISM Exam Date">
            <input
              type="date"
              value={v.nismExamDate ?? ""}
              onChange={(e) => update("nismExamDate", e.target.value || null)}
              className="input-base text-sm w-full"
            />
          </Field>
          <Field label="NISM Expiry Date">
            <input
              type="date"
              value={v.nismExpiryAt ?? ""}
              onChange={(e) => update("nismExpiryAt", e.target.value || null)}
              className="input-base text-sm w-full"
            />
          </Field>
        </div>

        {/* ARN block */}
        <div className="mt-4 mb-1 text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
          Personal ARN (only for sub-distributors / individual MFDs)
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="ARN Number">
            <input
              value={v.personalArn}
              onChange={(e) => update("personalArn", e.target.value)}
              className="input-base text-sm w-full font-mono"
              placeholder="ARN-123456"
            />
          </Field>
          <Field label="ARN Registration Date">
            <input
              type="date"
              value={v.arnRegistrationDate ?? ""}
              onChange={(e) =>
                update("arnRegistrationDate", e.target.value || null)
              }
              className="input-base text-sm w-full"
            />
          </Field>
          <Field label="ARN Expiry Date">
            <input
              type="date"
              value={v.arnExpiryAt ?? ""}
              onChange={(e) => update("arnExpiryAt", e.target.value || null)}
              className="input-base text-sm w-full"
            />
          </Field>
        </div>

        {/* EUIN block */}
        <div className="mt-4 mb-1 text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
          EUIN
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="EUIN Number">
            <input
              value={v.euin}
              onChange={(e) => update("euin", e.target.value)}
              className="input-base text-sm w-full font-mono"
              placeholder="E123456"
            />
          </Field>
          <Field label="EUIN Expiry Date">
            <input
              type="date"
              value={v.euinExpiryAt ?? ""}
              onChange={(e) => update("euinExpiryAt", e.target.value || null)}
              className="input-base text-sm w-full"
            />
          </Field>
        </div>

        {/* DSC block */}
        <div className="mt-4 mb-1 text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
          DSC (Digital Signature Certificate)
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="DSC Submitted?">
            <label className="flex items-center gap-2 h-9 px-3 border rounded-md bg-background">
              <input
                type="checkbox"
                checked={v.dscSubmitted}
                onChange={(e) => update("dscSubmitted", e.target.checked)}
                className="size-4"
              />
              <span className="text-xs">
                {v.dscSubmitted ? "Yes, on file" : "Not submitted"}
              </span>
            </label>
          </Field>
          <Field label="DSC Last Submitted Date">
            <input
              type="date"
              value={v.dscLastSubmittedAt ?? ""}
              onChange={(e) =>
                update("dscLastSubmittedAt", e.target.value || null)
              }
              className="input-base text-sm w-full"
            />
          </Field>
          <Field label="DSC Expiry Date">
            <input
              type="date"
              value={v.dscExpiryAt ?? ""}
              onChange={(e) => update("dscExpiryAt", e.target.value || null)}
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
