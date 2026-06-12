"use client";

/**
 * Client-side package editor. Renders every spec field — Active/Inactive
 * toggle, prices, limits, trial days, and the module grid. Saves via PATCH
 * to `/api/super-admin/packages/[id]`.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";
// Granular per-feature access: the package editor lists every sidebar feature
// (grouped like the sidebar) from the single nav-access catalog, so AINA can
// set each Off / Included / Add-on individually. defaultFeaturesForModules
// pre-fills the grid for a legacy package from its old coarse module set.
import { NAV_ACCESS_GROUPS, defaultFeaturesForModules } from "@/config/nav-access";

type Pkg = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  monthlyPricePaise: number;
  yearlyPricePaise: number;
  setupCostPaise: number;
  perUserMonthlyPaise: number;
  perUserYearlyPaise: number;
  maxUsers: number;
  maxInvestors: number;
  storageLimitGb: number;
  trialDays: number;
  enabledModules: string[];
  addonModules: Array<{ module: string; monthlyPaise: number; yearlyPaise: number }>;
  enabledFeatures: string[];
  addonFeatures: Array<{ key: string; monthlyPaise: number; yearlyPaise: number }>;
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
    perUserMonthlyRupees: pkg.perUserMonthlyPaise / 100,
    perUserYearlyRupees: pkg.perUserYearlyPaise / 100,
    maxUsers: pkg.maxUsers,
    maxInvestors: pkg.maxInvestors,
    storageLimitGb: pkg.storageLimitGb,
    trialDays: pkg.trialDays,
    enabledFeatures:
      pkg.enabledFeatures && pkg.enabledFeatures.length > 0
        ? pkg.enabledFeatures
        : defaultFeaturesForModules(pkg.enabledModules ?? []),
    addonFeatures: (pkg.addonFeatures ?? []).map((a) => ({
      key: a.key,
      monthlyRupees: a.monthlyPaise / 100,
      yearlyRupees: a.yearlyPaise / 100,
    })),
    isActive: pkg.isActive,
    isPublic: pkg.isPublic,
    badge: pkg.badge ?? "",
    sortOrder: pkg.sortOrder ?? 0,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

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
          perUserMonthlyPaise: Math.round(form.perUserMonthlyRupees * 100),
          perUserYearlyPaise: Math.round(form.perUserYearlyRupees * 100),
          maxUsers: form.maxUsers,
          maxInvestors: form.maxInvestors,
          storageLimitGb: form.storageLimitGb,
          trialDays: form.trialDays,
          enabledFeatures: form.enabledFeatures,
          addonFeatures: form.addonFeatures.map((a) => ({
            key: a.key,
            monthlyPaise: Math.round(a.monthlyRupees * 100),
            yearlyPaise: Math.round(a.yearlyRupees * 100),
          })),
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
        <NumberField label="Setup ₹ (one-time / org)" value={form.setupCostRupees} onChange={(v) => setForm({ ...form, setupCostRupees: v })} />
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
        onChange={(enabledFeatures, addonFeatures) => setForm((s) => ({ ...s, enabledFeatures, addonFeatures }))}
      />

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

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

export type AddonFeatureUI = { key: string; monthlyRupees: number; yearlyRupees: number };
type FeatureState = "off" | "included" | "addon";

const ALL_FEATURE_KEYS = NAV_ACCESS_GROUPS.flatMap((g) => g.items.map((i) => i.key));

/**
 * Feature access grid — every sidebar feature (~65, grouped like the sidebar)
 * is in one of three states for a package:
 *   • Included — free with the package (goes into enabledFeatures)
 *   • Add-on   — purchasable on top, carries its own ₹/mo + ₹/yr (addonFeatures)
 *   • Off      — not offered (hidden from the firm's sidebar)
 * Shared by the editor and the new-package form. Keyed by nav href.
 */
export function FeatureAccessGrid({
  enabledFeatures,
  addons,
  onChange,
}: {
  enabledFeatures: string[];
  addons: AddonFeatureUI[];
  onChange: (enabledFeatures: string[], addons: AddonFeatureUI[]) => void;
}) {
  const stateOf = (k: string): FeatureState =>
    enabledFeatures.includes(k) ? "included" : addons.some((a) => a.key === k) ? "addon" : "off";

  function setState(k: string, next: FeatureState) {
    const enabled = enabledFeatures.filter((x) => x !== k);
    const adds = addons.filter((a) => a.key !== k);
    if (next === "included") enabled.push(k);
    if (next === "addon") adds.push({ key: k, monthlyRupees: 0, yearlyRupees: 0 });
    onChange(enabled, adds);
  }

  function setPrice(k: string, field: "monthlyRupees" | "yearlyRupees", v: number) {
    onChange(
      enabledFeatures,
      addons.map((a) => (a.key === k ? { ...a, [field]: v } : a))
    );
  }

  function bulk(next: "included" | "off") {
    if (next === "included") onChange([...ALL_FEATURE_KEYS], []);
    else onChange([], []);
  }

  return (
    <div className="border-t pt-3">
      <div className="flex items-center justify-between mb-1">
        <div className="text-xs font-medium">
          Feature access ·{" "}
          <span className="text-emerald-700">{enabledFeatures.length} included</span>
          {addons.length > 0 && <span className="text-amber-700"> · {addons.length} add-on</span>}
          <span className="text-muted-foreground"> · {ALL_FEATURE_KEYS.length} total</span>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => bulk("included")} className="text-xs underline text-muted-foreground hover:text-foreground">
            Include all
          </button>
          <button type="button" onClick={() => bulk("off")} className="text-xs underline text-muted-foreground hover:text-foreground">
            Turn all off
          </button>
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground mb-2">
        <span className="font-medium text-emerald-700">Included</span> = free with the package ·{" "}
        <span className="font-medium text-amber-700">Add-on</span> = the MFD can buy it for the price you set ·{" "}
        <span className="font-medium">Off</span> = hidden from this firm.
      </p>
      <div className="max-h-96 overflow-y-auto border rounded bg-muted/20">
        {NAV_ACCESS_GROUPS.map((group) => (
          <div key={group.title}>
            <div className="sticky top-0 z-10 bg-secondary/90 backdrop-blur px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground border-y">
              {group.title}
            </div>
            <div className="divide-y">
              {group.items.map((item) => {
                const st = stateOf(item.key);
                const addon = addons.find((a) => a.key === item.key);
                return (
                  <div key={item.key} className="flex items-center gap-2 px-2.5 py-1.5">
                    <span className="flex-1 min-w-0" title={item.key}>
                      <span className="block text-xs font-medium truncate">{item.label}</span>
                    </span>
                    <div className="inline-flex rounded-md border overflow-hidden text-[11px] shrink-0">
                      {(["off", "included", "addon"] as FeatureState[]).map((opt) => (
                        <button
                          key={opt}
                          type="button"
                          onClick={() => setState(item.key, opt)}
                          className={`px-2 py-1 capitalize transition-colors ${
                            st === opt
                              ? opt === "included"
                                ? "bg-emerald-600 text-white"
                                : opt === "addon"
                                  ? "bg-amber-500 text-white"
                                  : "bg-gray-500 text-white"
                              : "bg-background hover:bg-muted text-muted-foreground"
                          }`}
                        >
                          {opt === "addon" ? "Add-on" : opt}
                        </button>
                      ))}
                    </div>
                    {st === "addon" && (
                      <div className="flex items-center gap-1 shrink-0">
                        <PriceMini placeholder="₹/yr" value={addon?.yearlyRupees ?? 0} onChange={(v) => setPrice(item.key, "yearlyRupees", v)} />
                        <PriceMini placeholder="₹/mo" value={addon?.monthlyRupees ?? 0} onChange={(v) => setPrice(item.key, "monthlyRupees", v)} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PriceMini({ value, onChange, placeholder }: { value: number; onChange: (v: number) => void; placeholder: string }) {
  return (
    <input
      type="number"
      min={0}
      value={value || ""}
      placeholder={placeholder}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-20 border rounded px-1.5 py-1 text-[11px] bg-background tabular-nums"
      title={placeholder}
    />
  );
}

/**
 * Per-user (per-seat) pricing block — shared by the editor and the new-package
 * form. The two fields define what an MFD pays to add ONE extra staff seat;
 * the live preview shows the running total so the cost model is obvious.
 */
export function PerUserPricing({
  perUserMonthlyRupees,
  perUserYearlyRupees,
  setupCostRupees,
  maxUsers,
  onMonthly,
  onYearly,
}: {
  perUserMonthlyRupees: number;
  perUserYearlyRupees: number;
  setupCostRupees: number;
  maxUsers: number;
  onMonthly: (v: number) => void;
  onYearly: (v: number) => void;
}) {
  const seats = Math.max(1, Number(maxUsers) || 1);
  return (
    <div className="border-t pt-3">
      <div className="text-xs font-medium mb-1">Per-user pricing (add-on seats)</div>
      <p className="text-[11px] text-muted-foreground mb-2">
        Setup is a one-time fee charged once <span className="font-medium">per organisation</span>. When an MFD wants
        more staff logins, each extra user costs this much — billed per their cycle.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <NumberField label="Per user / year ₹" value={perUserYearlyRupees} onChange={onYearly} />
        <NumberField label="Per user / month ₹" value={perUserMonthlyRupees} onChange={onMonthly} />
      </div>
      <div className="mt-2 rounded-md bg-muted/40 border px-3 py-2 text-[11px] text-muted-foreground space-y-0.5">
        <div>
          <span className="font-medium text-foreground">1 extra user</span> ={" "}
          {inr(perUserYearlyRupees)}/yr <span className="opacity-60">or</span> {inr(perUserMonthlyRupees)}/mo
        </div>
        <div>
          <span className="font-medium text-foreground">{seats} users</span> ={" "}
          {inr(seats * perUserYearlyRupees)}/yr <span className="opacity-60">or</span>{" "}
          {inr(seats * perUserMonthlyRupees)}/mo
          {setupCostRupees > 0 && <> + {inr(setupCostRupees)} one-time setup (per org)</>}
        </div>
      </div>
    </div>
  );
}
