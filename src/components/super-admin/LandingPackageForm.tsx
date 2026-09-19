"use client";

/**
 * Create/edit form for a public landing-page pricing card. One component drives
 * both /super-admin/landing-packages/new (no `initial`) and .../[id] (edit).
 * All fields the public card renders are exposed here.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Plus, Trash2, Loader2, GripVertical } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

export type LandingPackageInitial = {
  id: string;
  name: string;
  tagline: string | null;
  priceLabel: string | null;
  unitLabel: string | null;
  setupLabel: string | null;
  setupOriginalLabel: string | null;
  discountBadge: string | null;
  seatsLabel: string | null;
  inheritsLabel: string | null;
  features: string[];
  featured: boolean;
  badgeLabel: string | null;
  isCustom: boolean;
  ctaLabel: string;
  ctaHref: string;
  sortOrder: number;
  published: boolean;
};

export function LandingPackageForm({ initial }: { initial?: LandingPackageInitial }) {
  const router = useRouter();
  const editing = !!initial;

  const [name, setName] = useState(initial?.name ?? "");
  const [tagline, setTagline] = useState(initial?.tagline ?? "");
  const [priceLabel, setPriceLabel] = useState(initial?.priceLabel ?? "");
  const [unitLabel, setUnitLabel] = useState(initial?.unitLabel ?? "");
  const [setupLabel, setSetupLabel] = useState(initial?.setupLabel ?? "");
  const [setupOriginalLabel, setSetupOriginalLabel] = useState(initial?.setupOriginalLabel ?? "");
  const [discountBadge, setDiscountBadge] = useState(initial?.discountBadge ?? "");
  const [seatsLabel, setSeatsLabel] = useState(initial?.seatsLabel ?? "");
  const [inheritsLabel, setInheritsLabel] = useState(initial?.inheritsLabel ?? "");
  const [features, setFeatures] = useState<string[]>(initial?.features ?? [""]);
  const [featured, setFeatured] = useState(initial?.featured ?? false);
  const [badgeLabel, setBadgeLabel] = useState(initial?.badgeLabel ?? "");
  const [isCustom, setIsCustom] = useState(initial?.isCustom ?? false);
  const [ctaLabel, setCtaLabel] = useState(initial?.ctaLabel ?? "Start Free Trial");
  const [ctaHref, setCtaHref] = useState(initial?.ctaHref ?? "/signup");
  const [sortOrder, setSortOrder] = useState(String(initial?.sortOrder ?? 0));
  const [published, setPublished] = useState(initial?.published ?? true);

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateFeature(i: number, v: string) {
    setFeatures((f) => f.map((x, idx) => (idx === i ? v : x)));
  }
  function addFeature() {
    setFeatures((f) => [...f, ""]);
  }
  function removeFeature(i: number) {
    setFeatures((f) => f.filter((_, idx) => idx !== i));
  }

  async function save() {
    setError(null);
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    setSaving(true);
    const body = {
      name: name.trim(),
      tagline: tagline.trim() || null,
      priceLabel: priceLabel.trim() || null,
      unitLabel: unitLabel.trim() || null,
      setupLabel: setupLabel.trim() || null,
      setupOriginalLabel: setupOriginalLabel.trim() || null,
      discountBadge: discountBadge.trim() || null,
      seatsLabel: seatsLabel.trim() || null,
      inheritsLabel: inheritsLabel.trim() || null,
      features: features.map((f) => f.trim()).filter(Boolean),
      featured,
      badgeLabel: badgeLabel.trim() || null,
      isCustom,
      ctaLabel: ctaLabel.trim() || "Start Free Trial",
      ctaHref: ctaHref.trim() || "/signup",
      sortOrder: Number.isFinite(parseInt(sortOrder, 10)) ? parseInt(sortOrder, 10) : 0,
      published,
    };
    try {
      const res = await fetch(
        editing ? `/api/super-admin/landing-packages/${initial!.id}` : "/api/super-admin/landing-packages",
        {
          method: editing ? "PATCH" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }
      );
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Save failed (${res.status})`);
      }
      router.push("/super-admin/landing-packages");
      router.refresh();
    } catch (e: any) {
      setError(e?.message || "Save failed.");
      setSaving(false);
    }
  }

  async function doDelete() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/super-admin/landing-packages/${initial!.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`Delete failed (${res.status})`);
      router.push("/super-admin/landing-packages");
      router.refresh();
    } catch (e: any) {
      setError(e?.message || "Delete failed.");
      setDeleting(false);
      setConfirmDel(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/super-admin/landing-packages" className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-5" />
          </Link>
          <div>
            <h1 className="page-title">{editing ? "Edit landing card" : "New landing card"}</h1>
            <p className="text-muted-foreground text-sm">The pricing cards shown on the public landing page.</p>
          </div>
        </div>
        {editing && (
          <button
            type="button"
            onClick={() => setConfirmDel(true)}
            className="rounded-md border border-rose-200 text-rose-600 px-3 py-1.5 text-sm font-medium flex items-center gap-1.5 hover:bg-rose-50"
          >
            <Trash2 className="size-4" /> Delete
          </button>
        )}
      </div>

      {error && <div className="rounded-md bg-rose-50 border border-rose-200 text-rose-700 text-sm px-3 py-2">{error}</div>}

      <div className="rounded-lg border bg-card p-5 space-y-4">
        <Field label="Name" required>
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Growth" />
        </Field>
        <Field label="Tagline" hint="Short line under the name.">
          <textarea className={inputCls} rows={2} value={tagline} onChange={(e) => setTagline(e.target.value)} />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Price label" hint="e.g. ₹9,499 — leave blank for custom.">
            <input className={inputCls} value={priceLabel} onChange={(e) => setPriceLabel(e.target.value)} placeholder="₹9,499" />
          </Field>
          <Field label="Unit label" hint="e.g. / user / year">
            <input className={inputCls} value={unitLabel} onChange={(e) => setUnitLabel(e.target.value)} placeholder="/ user / year" />
          </Field>
          <Field label="Setup label" hint="One-time setup, e.g. ₹45,000">
            <input className={inputCls} value={setupLabel} onChange={(e) => setSetupLabel(e.target.value)} placeholder="₹45,000" />
          </Field>
          <Field label="Seats label" hint="e.g. 3 users = ₹28,497 / year">
            <input className={inputCls} value={seatsLabel} onChange={(e) => setSeatsLabel(e.target.value)} />
          </Field>
        </div>

        <Field label="Inherits label" hint='e.g. "Everything in Growth, plus:" — shown above the feature list.'>
          <input className={inputCls} value={inheritsLabel} onChange={(e) => setInheritsLabel(e.target.value)} />
        </Field>

        {/* Setup-price discount */}
        <div className="rounded-lg border border-dashed border-emerald-300 bg-emerald-50/30 p-4 space-y-3">
          <div className="text-sm font-semibold text-emerald-800">Setup-price discount <span className="font-normal text-muted-foreground">(optional)</span></div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Discount banner" hint='Ribbon on the card, e.g. "20% OFF". Blank = no banner.'>
              <input className={inputCls} value={discountBadge} onChange={(e) => setDiscountBadge(e.target.value)} placeholder="20% OFF" />
            </Field>
            <Field label="Original setup price" hint="Shown struck-through before the discounted setup price.">
              <input className={inputCls} value={setupOriginalLabel} onChange={(e) => setSetupOriginalLabel(e.target.value)} placeholder="₹45,000" />
            </Field>
          </div>
          <p className="text-xs text-muted-foreground">
            Set <span className="font-medium text-foreground">Setup label</span> above to the <span className="font-medium text-foreground">discounted</span> price,
            then put the old price here — the card shows it crossed out with the banner.
          </p>
        </div>
      </div>

      {/* Features */}
      <div className="rounded-lg border bg-card p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-semibold text-sm">Features</div>
            <div className="text-xs text-muted-foreground">The bulleted list on the card.</div>
          </div>
          <button type="button" onClick={addFeature} className="text-sm text-primary flex items-center gap-1 hover:underline">
            <Plus className="size-4" /> Add feature
          </button>
        </div>
        <div className="space-y-2">
          {features.length === 0 && <div className="text-sm text-muted-foreground">No features yet.</div>}
          {features.map((f, i) => (
            <div key={i} className="flex items-center gap-2">
              <GripVertical className="size-4 text-muted-foreground/40 shrink-0" />
              <input
                className={inputCls}
                value={f}
                onChange={(e) => updateFeature(i, e.target.value)}
                placeholder="Feature description"
              />
              <button
                type="button"
                onClick={() => removeFeature(i)}
                className="text-muted-foreground hover:text-rose-600 shrink-0"
                aria-label="Remove feature"
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Call to action */}
      <div className="rounded-lg border bg-card p-5 space-y-4">
        <div className="font-semibold text-sm">Call to action</div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Button label">
            <input className={inputCls} value={ctaLabel} onChange={(e) => setCtaLabel(e.target.value)} placeholder="Start Free Trial" />
          </Field>
          <Field label="Button link" hint="/signup, tel:+91…, or https://…">
            <input className={inputCls} value={ctaHref} onChange={(e) => setCtaHref(e.target.value)} placeholder="/signup" />
          </Field>
        </div>
        <Field label="Badge label" hint='Ribbon on the card, e.g. "Most Popular" or "Enterprise". Blank = auto.'>
          <input className={inputCls} value={badgeLabel} onChange={(e) => setBadgeLabel(e.target.value)} />
        </Field>
      </div>

      {/* Display */}
      <div className="rounded-lg border bg-card p-5 space-y-4">
        <div className="font-semibold text-sm">Display</div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Sort order" hint="Lower shows first.">
            <input className={inputCls} type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
          </Field>
        </div>
        <div className="flex flex-col gap-3 pt-1">
          <Toggle label="Published" hint="Show this card on the public landing page." checked={published} onChange={setPublished} />
          <Toggle label="Featured" hint="Highlighted / raised card with an accent border." checked={featured} onChange={setFeatured} />
          <Toggle
            label="Custom (enterprise) card"
            hint="Renders as the 'talk to us' style card; typically no price + a phone CTA."
            checked={isCustom}
            onChange={setIsCustom}
          />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium flex items-center gap-2 disabled:opacity-60"
        >
          {saving && <Loader2 className="size-4 animate-spin" />}
          {editing ? "Save changes" : "Create card"}
        </button>
        <Link href="/super-admin/landing-packages" className="text-sm text-muted-foreground hover:text-foreground">
          Cancel
        </Link>
      </div>

      <ConfirmDialog
        open={confirmDel}
        title="Delete this landing card?"
        message="It will be removed from the public landing page immediately. This can't be undone."
        confirmLabel={deleting ? "Deleting…" : "Delete"}
        cancelLabel="Keep it"
        tone="danger"
        busy={deleting}
        onConfirm={doDelete}
        onCancel={() => setConfirmDel(false)}
      />
    </div>
  );
}

const inputCls =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30";

function Field({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium">
        {label}
        {required && <span className="text-rose-500"> *</span>}
      </span>
      {children}
      {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} className="flex items-start gap-3 text-left">
      <span
        className={`mt-0.5 h-5 w-9 rounded-full transition-colors shrink-0 relative ${checked ? "bg-primary" : "bg-input"}`}
      >
        <span
          className={`absolute top-0.5 size-4 rounded-full bg-white shadow transition-all ${checked ? "left-[1.125rem]" : "left-0.5"}`}
        />
      </span>
      <span>
        <span className="text-sm font-medium block">{label}</span>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </span>
    </button>
  );
}
