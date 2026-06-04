"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldAlert, Save } from "lucide-react";
import { NAV_ACCESS_GROUPS, ALL_NAV_ITEMS } from "@/config/nav-access";

// All fields from catalog.ts grouped by subject
const AVAILABLE_FIELDS = {
  investor: [
    { key: "name", label: "Name" },
    { key: "pan", label: "PAN" },
    { key: "email", label: "Email" },
    { key: "phone", label: "Phone" },
    { key: "city", label: "City" },
    { key: "state", label: "State" },
    { key: "pincode", label: "Pincode" },
    { key: "investor_category", label: "Category" },
    { key: "segment_tag", label: "Segment Tag" },
    { key: "status", label: "Status" },
    { key: "aum", label: "AUM (₹)" },
    { key: "active_sip_amount", label: "Active SIP (₹)" },
    { key: "lifetime_inflow", label: "Lifetime Inflow" },
    { key: "kyc_status", label: "KYC Status" },
    { key: "ckyc_expiry_at", label: "CKYC Expiry" },
    { key: "fatca_expiry_at", label: "FATCA Expiry" },
    { key: "risk_profile", label: "Risk Profile" },
    { key: "dob", label: "Date of Birth" },
    { key: "rm_id", label: "Relationship Manager" },
    { key: "branch_id", label: "Branch" },
  ],
  lead: [
    { key: "name", label: "Name" },
    { key: "email", label: "Email" },
    { key: "phone", label: "Phone" },
    { key: "stage", label: "Stage" },
    { key: "source", label: "Source" },
    { key: "score", label: "Lead Score" },
    { key: "owner_id", label: "Owner" },
  ],
  task: [
    { key: "title", label: "Title" },
    { key: "type", label: "Type" },
    { key: "status", label: "Status" },
    { key: "priority", label: "Priority" },
    { key: "assignee_id", label: "Assignee" },
    { key: "due_at", label: "Due Date" },
  ],
  user: [
    { key: "name", label: "Name" },
    { key: "email", label: "Email" },
    { key: "status", label: "Status" },
    { key: "euin", label: "EUIN" },
    { key: "nism_expiry_at", label: "NISM Expiry" },
  ],
};

const ALL_NAV_KEYS = ALL_NAV_ITEMS.map((i) => i.key);

export function TenantAccessControl({
  tenantId,
  initialAllowedNav,
  initialAllowedFields,
}: {
  tenantId: string;
  initialAllowedNav: string[] | null;
  initialAllowedFields: string[] | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // null grant = the firm gets the package default; when customizing we start
  // from the current grant (or "everything").
  const [nav, setNav] = useState<string[]>(initialAllowedNav || ALL_NAV_KEYS);
  const [customNavActive, setCustomNavActive] = useState(!!initialAllowedNav);

  // If allowed fields is null, all fields are allowed. We keep track of the selected fields list.
  const [allowedFields, setAllowedFields] = useState<string[]>(initialAllowedFields || []);
  const [customFieldsActive, setCustomFieldsActive] = useState(!!initialAllowedFields);

  const toggleNav = (key: string) => {
    setNav((prev) => (prev.includes(key) ? prev.filter((m) => m !== key) : [...prev, key]));
    setSaved(false);
  };

  const toggleField = (fqName: string) => {
    setAllowedFields((prev) => (prev.includes(fqName) ? prev.filter((f) => f !== fqName) : [...prev, fqName]));
    setSaved(false);
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(`/api/super-admin/tenants/${tenantId}/access`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          allowedNav: customNavActive ? nav : null,
          allowedFields: customFieldsActive ? allowedFields : null,
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Failed to save overrides");
      setSaved(true);
      router.refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border rounded-lg bg-card p-6 space-y-6 mt-6">
      <div className="flex items-center justify-between border-b pb-3">
        <div>
          <h2 className="text-lg font-bold tracking-tight">Module & Field Access Control</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Configure tenant-specific module availability and restricted data fields.
          </p>
        </div>
        <button
          onClick={save}
          disabled={busy}
          className="btn-primary text-xs flex items-center gap-1.5"
        >
          <Save className="size-3.5" /> {busy ? "Saving overrides..." : "Save overrides"}
        </button>
      </div>

      {error && (
        <div className="text-xs text-rose-700 bg-rose-50 rounded-md p-3 flex items-start gap-2">
          <ShieldAlert className="size-4 mt-0.5" /> {error}
        </div>
      )}

      {saved && <div className="text-xs text-emerald-700 bg-emerald-50 rounded-md p-2">✓ Overrides saved successfully</div>}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Sidebar Access (admin → MFD) */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Sidebar Access</h3>
            <label className="flex items-center gap-1.5 text-xs font-medium cursor-pointer">
              <input
                type="checkbox"
                checked={customNavActive}
                onChange={(e) => {
                  setCustomNavActive(e.target.checked);
                  if (e.target.checked && nav.length === 0) setNav(ALL_NAV_KEYS);
                  setSaved(false);
                }}
              />
              Customize Access
            </label>
          </div>
          {!customNavActive ? (
            <div className="text-xs text-muted-foreground bg-secondary/30 p-3 rounded-md border">
              This firm can open all sidebar items allowed by its package plan. Check &quot;Customize Access&quot;
              to pick exactly which sidebar items the MFD can use ({ALL_NAV_KEYS.length} available).
            </div>
          ) : (
            <div className="space-y-3 max-h-[440px] overflow-y-auto border rounded-md p-4 bg-secondary/10 scrollbar-thin">
              <div className="flex gap-3 text-[11px] font-medium">
                <button type="button" onClick={() => { setNav(ALL_NAV_KEYS); setSaved(false); }} className="text-primary hover:underline">
                  Select all
                </button>
                <button type="button" onClick={() => { setNav([]); setSaved(false); }} className="text-muted-foreground hover:underline">
                  Clear all
                </button>
                <span className="text-muted-foreground ml-auto">{nav.length}/{ALL_NAV_KEYS.length} selected</span>
              </div>
              {NAV_ACCESS_GROUPS.map((grp) => (
                <div key={grp.title} className="space-y-1.5">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground border-b pb-0.5">
                    {grp.title}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {grp.items.map((m) => (
                      <label
                        key={m.key}
                        className="flex items-center gap-2 border rounded p-1.5 bg-card hover:bg-secondary/40 text-[11px] cursor-pointer"
                      >
                        <input type="checkbox" checked={nav.includes(m.key)} onChange={() => toggleNav(m.key)} />
                        <span>{m.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Field Access */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Allowed Data Fields</h3>
            <label className="flex items-center gap-1.5 text-xs font-medium cursor-pointer">
              <input
                type="checkbox"
                checked={customFieldsActive}
                onChange={(e) => {
                  setCustomFieldsActive(e.target.checked);
                  setSaved(false);
                }}
              />
              Customize Data Fields
            </label>
          </div>
          {!customFieldsActive ? (
            <div className="text-xs text-muted-foreground bg-secondary/30 p-3 rounded-md border">
              All catalog fields are currently available to this tenant. Check "Customize Data Fields" above to restrict access.
            </div>
          ) : (
            <div className="space-y-4 max-h-[350px] overflow-y-auto border rounded-md p-4 bg-secondary/10 scrollbar-thin">
              {Object.entries(AVAILABLE_FIELDS).map(([subject, fields]) => (
                <div key={subject} className="space-y-2">
                  <h4 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground border-b pb-1">
                    {subject} fields
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {fields.map((f) => {
                      const fqName = `${subject}.${f.key}`;
                      return (
                        <label
                          key={fqName}
                          className="flex items-center gap-2 border rounded p-1.5 bg-card hover:bg-secondary/40 text-[11px] cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={allowedFields.includes(fqName) || allowedFields.includes(f.key)}
                            onChange={() => toggleField(fqName)}
                          />
                          <span>{f.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
