"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { PerUserPricing, FeatureAccessGrid, type AddonFeatureUI } from "@/components/super-admin/PackageEditor";

export default function NewPackagePage() {
  const router = useRouter();
  const [form, setForm] = useState({
    key: "",
    name: "",
    description: "",
    monthlyPriceRupees: 0,
    yearlyPriceRupees: 0,
    setupCostRupees: 0,
    perUserMonthlyRupees: 0,
    perUserYearlyRupees: 0,
    maxUsers: 1,
    maxInvestors: 200,
    storageLimitGb: 5,
    trialDays: 14,
    enabledModules: [] as string[],
    enabledFeatures: [] as string[],
    addonFeatures: [] as AddonFeatureUI[],
    isActive: true,
    isPublic: true,
    badge: "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/super-admin/packages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...form,
          monthlyPricePaise: Math.round(form.monthlyPriceRupees * 100),
          yearlyPricePaise: Math.round(form.yearlyPriceRupees * 100),
          setupCostPaise: Math.round(form.setupCostRupees * 100),
          perUserMonthlyPaise: Math.round(form.perUserMonthlyRupees * 100),
          perUserYearlyPaise: Math.round(form.perUserYearlyRupees * 100),
          enabledFeatures: form.enabledFeatures,
          addonFeatures: form.addonFeatures.map((a) => ({
            key: a.key,
            monthlyPaise: Math.round(a.monthlyRupees * 100),
            yearlyPaise: Math.round(a.yearlyRupees * 100),
          })),
        }),
      });
      const j = await res.json();
      if (!res.ok) {
        setErr(j.error ?? "Create failed");
        return;
      }
      router.push("/super-admin/packages");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <Link href="/super-admin/packages" className="text-sm text-muted-foreground hover:underline flex items-center gap-1">
        <ChevronLeft className="size-4" /> Back to packages
      </Link>
      <h1 className="text-2xl font-bold tracking-tight">New package</h1>

      <form onSubmit={submit} className="border rounded-lg bg-card p-5 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <div className="text-xs font-medium mb-1">Key (lowercase, _)<span className="text-rose-600">*</span></div>
            <input required value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") })} className="w-full border rounded-md px-3 py-2 text-sm bg-background font-mono" />
          </label>
          <label className="block">
            <div className="text-xs font-medium mb-1">Display name<span className="text-rose-600">*</span></div>
            <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full border rounded-md px-3 py-2 text-sm bg-background" />
          </label>
        </div>
        <label className="block">
          <div className="text-xs font-medium mb-1">Description</div>
          <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} className="w-full border rounded-md px-3 py-2 text-sm bg-background" />
        </label>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 border-t pt-3">
          <NumberField label="Monthly ₹" value={form.monthlyPriceRupees} onChange={(v) => setForm({ ...form, monthlyPriceRupees: v })} />
          <NumberField label="Yearly ₹" value={form.yearlyPriceRupees} onChange={(v) => setForm({ ...form, yearlyPriceRupees: v })} />
          <NumberField label="Setup ₹ (one-time / org)" value={form.setupCostRupees} onChange={(v) => setForm({ ...form, setupCostRupees: v })} />
          <NumberField label="Max users" value={form.maxUsers} onChange={(v) => setForm({ ...form, maxUsers: v })} />
          <NumberField label="Max investors" value={form.maxInvestors} onChange={(v) => setForm({ ...form, maxInvestors: v })} />
          <NumberField label="Storage GB" value={form.storageLimitGb} onChange={(v) => setForm({ ...form, storageLimitGb: v })} />
          <NumberField label="Trial days" value={form.trialDays} onChange={(v) => setForm({ ...form, trialDays: v })} />
          <label className="block">
            <div className="text-xs font-medium mb-1">Badge (optional)</div>
            <input value={form.badge} onChange={(e) => setForm({ ...form, badge: e.target.value })} placeholder="Most Popular" className="w-full border rounded-md px-3 py-2 text-sm bg-background" />
          </label>
          <label className="flex items-center gap-2 mt-6">
            <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
            <span className="text-sm">Active (available for assignment)</span>
          </label>
          <label className="flex items-center gap-2 mt-6">
            <input type="checkbox" checked={form.isPublic} onChange={(e) => setForm({ ...form, isPublic: e.target.checked })} />
            <span className="text-sm">Publicly listed</span>
          </label>
        </div>

        <PerUserPricing
          perUserMonthlyRupees={form.perUserMonthlyRupees}
          perUserYearlyRupees={form.perUserYearlyRupees}
          setupCostRupees={form.setupCostRupees}
          maxUsers={form.maxUsers}
          onMonthly={(v) => setForm({ ...form, perUserMonthlyRupees: v })}
          onYearly={(v) => setForm({ ...form, perUserYearlyRupees: v })}
        />

        <FeatureAccessGrid
          enabledFeatures={form.enabledFeatures}
          addons={form.addonFeatures}
          onChange={(enabledFeatures, addonFeatures) => setForm({ ...form, enabledFeatures, addonFeatures })}
        />

        {err && <div className="text-sm text-rose-600">{err}</div>}
        <div className="flex justify-end gap-2 pt-2 border-t">
          <Link href="/super-admin/packages" className="rounded-md border px-4 py-2 text-sm">Cancel</Link>
          <button disabled={busy || !form.key || !form.name} className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium disabled:opacity-50">
            {busy ? "Creating…" : "Create package"}
          </button>
        </div>
      </form>
    </div>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <div className="text-xs font-medium mb-1">{label}</div>
      <input type="number" value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full border rounded-md px-3 py-2 text-sm bg-background tabular-nums" />
    </label>
  );
}
