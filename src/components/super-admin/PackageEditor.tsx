"use client";

/**
 * Client-side package editor. Renders every spec field — Active/Inactive
 * toggle, prices, limits, trial days, and the module grid. Saves via PATCH
 * to `/api/super-admin/packages/[id]`.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";

const ALL_MODULES = [
  "crm", "lead_management", "client_master", "family_mapping", "onboarding",
  "risk_profile", "goal_planning", "transactions", "sip_tracker", "sip_rejection",
  "review_meetings", "service_requests", "complaints", "ddq", "marketing_campaigns",
  "content_calendar", "tasks", "employees", "reports", "documents", "cybersecurity",
  "ai_assistant", "automation_workflows", "broadcasts", "white_label", "audit_log",
  "sub_distributor",
];

type Pkg = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  monthlyPricePaise: number;
  yearlyPricePaise: number;
  setupCostPaise: number;
  maxUsers: number;
  maxInvestors: number;
  storageLimitGb: number;
  trialDays: number;
  enabledModules: string[];
  isActive: boolean;
  isPublic: boolean;
  badge: string | null;
  sortOrder: number | null;
};

export function PackageEditor({ pkg }: { pkg: Pkg }) {
  const router = useRouter();
  const [form, setForm] = useState({
    name: pkg.name,
    description: pkg.description ?? "",
    monthlyPriceRupees: pkg.monthlyPricePaise / 100,
    yearlyPriceRupees: pkg.yearlyPricePaise / 100,
    setupCostRupees: pkg.setupCostPaise / 100,
    maxUsers: pkg.maxUsers,
    maxInvestors: pkg.maxInvestors,
    storageLimitGb: pkg.storageLimitGb,
    trialDays: pkg.trialDays,
    enabledModules: pkg.enabledModules ?? [],
    isActive: pkg.isActive,
    isPublic: pkg.isPublic,
    badge: pkg.badge ?? "",
    sortOrder: pkg.sortOrder ?? 0,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  function toggleMod(m: string) {
    setForm((s) => ({
      ...s,
      enabledModules: s.enabledModules.includes(m)
        ? s.enabledModules.filter((x) => x !== m)
        : [...s.enabledModules, m],
    }));
  }

  function toggleAll(value: boolean) {
    setForm((s) => ({ ...s, enabledModules: value ? [...ALL_MODULES] : [] }));
  }

  async function save() {
    setBusy(true);
    setErr(null);
    setOk(null);
    try {
      const res = await fetch(`/api/super-admin/packages/${pkg.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          description: form.description || null,
          monthlyPricePaise: Math.round(form.monthlyPriceRupees * 100),
          yearlyPricePaise: Math.round(form.yearlyPriceRupees * 100),
          setupCostPaise: Math.round(form.setupCostRupees * 100),
          maxUsers: form.maxUsers,
          maxInvestors: form.maxInvestors,
          storageLimitGb: form.storageLimitGb,
          trialDays: form.trialDays,
          enabledModules: form.enabledModules,
          isActive: form.isActive,
          isPublic: form.isPublic,
          badge: form.badge || null,
          sortOrder: form.sortOrder,
        }),
      });
      const j = await res.json();
      if (!res.ok) {
        setErr(j.error ?? "Save failed");
        return;
      }
      setOk("Saved.");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function quickToggleActive() {
    const next = !form.isActive;
    setForm((s) => ({ ...s, isActive: next }));
    setBusy(true);
    try {
      await fetch(`/api/super-admin/packages/${pkg.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isActive: next }),
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border rounded-lg bg-card p-5 space-y-3">
      <div className="flex items-center justify-between border-b pb-3">
        <div>
          <div className="text-xs text-muted-foreground">Status</div>
          <div className="text-sm font-medium">{form.isActive ? "Active — listed for tenants" : "Inactive — hidden from public listing"}</div>
        </div>
        <button
          onClick={quickToggleActive}
          disabled={busy}
          className={`rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${
            form.isActive
              ? "border border-rose-200 text-rose-700 hover:bg-rose-50"
              : "bg-emerald-600 text-white hover:bg-emerald-700"
          }`}
        >
          {form.isActive ? "Disable package" : "Activate package"}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <div className="text-xs font-medium mb-1">Display name</div>
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="w-full border rounded-md px-3 py-2 text-sm bg-background"
          />
        </label>
        <label className="block">
          <div className="text-xs font-medium mb-1">Badge (optional)</div>
          <input
            value={form.badge}
            onChange={(e) => setForm({ ...form, badge: e.target.value })}
            placeholder="Most Popular"
            className="w-full border rounded-md px-3 py-2 text-sm bg-background"
          />
        </label>
      </div>
      <label className="block">
        <div className="text-xs font-medium mb-1">Description</div>
        <textarea
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          rows={2}
          className="w-full border rounded-md px-3 py-2 text-sm bg-background"
        />
      </label>

      <div className="grid grid-cols-3 gap-3 border-t pt-3">
        <NumberField label="Monthly ₹" value={form.monthlyPriceRupees} onChange={(v) => setForm({ ...form, monthlyPriceRupees: v })} />
        <NumberField label="Yearly ₹" value={form.yearlyPriceRupees} onChange={(v) => setForm({ ...form, yearlyPriceRupees: v })} />
        <NumberField label="Setup ₹" value={form.setupCostRupees} onChange={(v) => setForm({ ...form, setupCostRupees: v })} />
        <NumberField label="Max users" value={form.maxUsers} onChange={(v) => setForm({ ...form, maxUsers: v })} />
        <NumberField label="Max investors" value={form.maxInvestors} onChange={(v) => setForm({ ...form, maxInvestors: v })} />
        <NumberField label="Storage GB" value={form.storageLimitGb} onChange={(v) => setForm({ ...form, storageLimitGb: v })} />
        <NumberField label="Trial days" value={form.trialDays} onChange={(v) => setForm({ ...form, trialDays: v })} />
        <NumberField label="Sort order" value={form.sortOrder} onChange={(v) => setForm({ ...form, sortOrder: v })} />
        <label className="flex items-center gap-2 mt-6">
          <input
            type="checkbox"
            checked={form.isPublic}
            onChange={(e) => setForm({ ...form, isPublic: e.target.checked })}
          />
          <span className="text-sm">Publicly listed</span>
        </label>
      </div>

      <div className="border-t pt-3">
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs font-medium">
            Modules enabled ({form.enabledModules.length}/{ALL_MODULES.length})
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => toggleAll(true)}
              className="text-xs underline text-muted-foreground hover:text-foreground"
            >
              Enable all
            </button>
            <button
              type="button"
              onClick={() => toggleAll(false)}
              className="text-xs underline text-muted-foreground hover:text-foreground"
            >
              Disable all
            </button>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-1.5 max-h-72 overflow-y-auto border rounded p-2 bg-muted/30">
          {ALL_MODULES.map((m) => (
            <label
              key={m}
              className="flex items-center gap-1.5 text-xs px-1.5 py-1 hover:bg-background rounded cursor-pointer"
            >
              <input
                type="checkbox"
                checked={form.enabledModules.includes(m)}
                onChange={() => toggleMod(m)}
              />
              <span className="font-mono">{m}</span>
            </label>
          ))}
        </div>
      </div>

      {err && <div className="text-sm text-rose-600">{err}</div>}
      {ok && <div className="text-sm text-emerald-700">{ok}</div>}
      <div className="flex justify-end gap-2 pt-2 border-t">
        <button
          onClick={save}
          disabled={busy}
          className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium disabled:opacity-50 flex items-center gap-1.5"
        >
          <Save className="size-4" /> {busy ? "Saving…" : "Save changes"}
        </button>
      </div>
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <div className="text-xs font-medium mb-1">{label}</div>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full border rounded-md px-3 py-2 text-sm bg-background tabular-nums"
      />
    </label>
  );
}
