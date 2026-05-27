"use client";

/**
 * MFD Organisation Profile — spec § 6, Module 1.
 *
 * Three groups:
 *   1. Editable by Owner — identity, contact, address, branding, business profile.
 *   2. Master records (read-only here) — ARN, EUIN, GSTIN, Owner Name, Created date.
 *   3. License / package (read-only here, AINA controls) — package, status, dates.
 *
 * Logo upload: posts to /api/compliance/upload-url (kind=general) to get a
 * presigned PUT URL, uploads the file directly to S3, then patches the tenant
 * with the resulting public URL.
 */

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Save, Loader2, Upload, CreditCard } from "lucide-react";

type OwnerLite = { id: string; name: string; email: string } | null;

export function OrganisationProfileForm({
  tenant,
  owner,
  subscription,
  pkg,
  license,
}: {
  tenant: any;
  owner: OwnerLite;
  subscription: any | null;
  pkg: any | null;
  license: any;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({
    displayName: tenant.displayName ?? "",
    legalName: tenant.legalName ?? "",
    email: tenant.email ?? "",
    phone: tenant.phone ?? "",
    website: tenant.website ?? "",
    primaryColor: tenant.primaryColor ?? "#1f2937",
    secondaryColor: tenant.secondaryColor ?? "#0ea5e9",
    logoUrl: tenant.logoUrl ?? "",
    aumRange: tenant.aumRange ?? "",
    sipBookRange: tenant.sipBookRange ?? "",
    teamSize: tenant.teamSize ?? "",
    currentSoftwareUsed: tenant.currentSoftwareUsed ?? "",
    addressLine1: tenant.address?.line1 ?? "",
    city: tenant.address?.city ?? "",
    state: tenant.address?.state ?? "",
    pincode: tenant.address?.pincode ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/tenant", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...form,
          address: {
            line1: form.addressLine1,
            city: form.city,
            state: form.state,
            pincode: form.pincode,
            country: "India",
          },
        }),
      });
      const j = await res.json();
      if (!res.ok) {
        setErr(j.error ?? "Save failed");
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function uploadLogo(file: File) {
    setErr(null);
    setUploading(true);
    try {
      // 1. Ask server for a presigned PUT URL
      const presign = await fetch("/api/compliance/upload-url", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type || "image/png",
          kind: "general",
        }),
      });
      const presignJson = await presign.json();
      if (!presign.ok) throw new Error(presignJson.error ?? "presign failed");

      // 2. PUT the file directly to S3
      const put = await fetch(presignJson.url, {
        method: "PUT",
        headers: { "content-type": file.type || "image/png" },
        body: file,
      });
      if (!put.ok) throw new Error("upload to S3 failed");

      // 3. Derive the public URL — assumes the bucket is public-read or has a
      //    CDN in front. For private buckets, swap in a presigned GET here.
      const base = (process.env.NEXT_PUBLIC_S3_PUBLIC_URL ?? "").replace(/\/+$/, "");
      const publicUrl = base
        ? `${base}/${presignJson.key}`
        : presignJson.url.split("?")[0]; // fallback: strip query string from PUT URL

      setForm((s) => ({ ...s, logoUrl: publicUrl }));
    } catch (e: any) {
      setErr(e.message ?? "logo upload failed");
    } finally {
      setUploading(false);
    }
  }

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) void uploadLogo(f);
  }

  function set(k: string, v: string) {
    setForm((s) => ({ ...s, [k]: v }));
  }

  return (
    <form onSubmit={save} className="space-y-4">
      {/* -------------------------------- Identity -------------------------------- */}
      <Section title="Identity">
        <Row label="Organisation name (display)" value={form.displayName} onChange={(v) => set("displayName", v)} required />
        <Row label="Legal name" value={form.legalName} onChange={(v) => set("legalName", v)} required />
        <Row label="Owner name" value={owner?.name ?? "—"} disabled note={owner ? owner.email : ""} />
        <Row label="ARN" value={tenant.arn ?? "—"} disabled note="Managed by AINA" />
        <Row label="Principal EUIN" value={tenant.principalEuin ?? "—"} disabled note="Managed by AINA" />
        <Row label="GSTIN" value={tenant.gstNumber ?? "—"} disabled />
        <Row
          label="Created"
          value={tenant.createdAt ? new Date(tenant.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—"}
          disabled
        />
      </Section>

      {/* --------------------------------- Contact -------------------------------- */}
      <Section title="Contact">
        <Row label="Email" value={form.email} onChange={(v) => set("email", v)} type="email" />
        <Row label="Mobile / phone" value={form.phone} onChange={(v) => set("phone", v)} placeholder="+91…" />
        <Row label="Website" value={form.website} onChange={(v) => set("website", v)} placeholder="https://" />
      </Section>

      {/* --------------------------------- Address -------------------------------- */}
      <Section title="Address">
        <Row label="Address line" value={form.addressLine1} onChange={(v) => set("addressLine1", v)} />
        <div className="grid grid-cols-3 gap-3">
          <Field label="City">
            <input value={form.city} onChange={(e) => set("city", e.target.value)} className="w-full border rounded-md px-3 py-2 text-sm bg-background" />
          </Field>
          <Field label="State">
            <input value={form.state} onChange={(e) => set("state", e.target.value)} className="w-full border rounded-md px-3 py-2 text-sm bg-background" />
          </Field>
          <Field label="Pincode">
            <input value={form.pincode} onChange={(e) => set("pincode", e.target.value)} className="w-full border rounded-md px-3 py-2 text-sm bg-background" />
          </Field>
        </div>
      </Section>

      {/* --------------------------------- Branding ------------------------------- */}
      <Section title="Branding">
        <div className="grid grid-cols-[120px_1fr] gap-4 items-center">
          <div className="size-24 rounded-md border bg-muted/30 grid place-items-center overflow-hidden">
            {form.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={form.logoUrl} alt="logo" className="max-h-full max-w-full object-contain" />
            ) : (
              <span className="text-xs text-muted-foreground">No logo</span>
            )}
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <input ref={fileRef} type="file" accept="image/*" onChange={onPickFile} className="hidden" />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="rounded-md border px-3 py-1.5 text-sm flex items-center gap-1.5 hover:bg-accent disabled:opacity-50"
              >
                {uploading ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
                {uploading ? "Uploading…" : "Upload logo"}
              </button>
              {form.logoUrl && (
                <button
                  type="button"
                  onClick={() => set("logoUrl", "")}
                  className="text-xs text-muted-foreground hover:text-rose-700 hover:underline"
                >
                  Remove
                </button>
              )}
            </div>
            <Row
              label="…or paste logo URL"
              value={form.logoUrl}
              onChange={(v) => set("logoUrl", v)}
              placeholder="https://…/logo.png"
            />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 items-end pt-3 border-t">
          <Field label="Primary colour">
            <input
              type="color"
              value={form.primaryColor}
              onChange={(e) => set("primaryColor", e.target.value)}
              className="h-10 w-full border rounded-md cursor-pointer"
            />
          </Field>
          <Field label="Secondary colour">
            <input
              type="color"
              value={form.secondaryColor}
              onChange={(e) => set("secondaryColor", e.target.value)}
              className="h-10 w-full border rounded-md cursor-pointer"
            />
          </Field>
          <Field label="Preview">
            <div
              className="h-10 rounded-md border flex items-center justify-center text-white text-sm font-semibold"
              style={{ backgroundColor: form.primaryColor }}
            >
              {form.displayName || "Firm"}
            </div>
          </Field>
        </div>
      </Section>

      {/* ----------------------------- Business profile --------------------------- */}
      <Section title="Business profile">
        <Row label="Approx AUM range" value={form.aumRange} onChange={(v) => set("aumRange", v)} placeholder="e.g. ₹50Cr – ₹100Cr" />
        <Row label="SIP book range" value={form.sipBookRange} onChange={(v) => set("sipBookRange", v)} placeholder="e.g. ₹50L – ₹1Cr" />
        <Row label="Team size" value={form.teamSize} onChange={(v) => set("teamSize", v)} placeholder="1–5, 6–10, 11–25, 25+" />
        <Row label="Current software" value={form.currentSoftwareUsed} onChange={(v) => set("currentSoftwareUsed", v)} placeholder="e.g. Wealth Elite, Excel, Investwell" />
      </Section>

      {/* --------------------------- License / package ---------------------------- */}
      <Section title="License & package">
        <div className="grid grid-cols-2 gap-3">
          <Row
            label="Package selected"
            value={pkg ? `${pkg.name} (${pkg.key})` : license.packageKey ?? "—"}
            disabled
            note="Contact AINA to change package"
          />
          <Row label="License status" value={license.status ?? "—"} disabled tone={license.isRestricted ? "rose" : "emerald"} />
          <Row
            label="License start"
            value={fmtDate(subscription?.licenseStartAt)}
            disabled
          />
          <Row
            label="License end"
            value={fmtDate(subscription?.licenseEndAt)}
            disabled
          />
          <Row
            label="Trial ends"
            value={fmtDate(subscription?.trialEndsAt)}
            disabled
          />
          <Row
            label="Next renewal"
            value={fmtDate(subscription?.nextRenewalAt)}
            disabled
          />
        </div>
        <div className="flex justify-end pt-2">
          <Link
            href="/dashboard/billing"
            className="text-sm text-primary hover:underline flex items-center gap-1.5"
          >
            <CreditCard className="size-3.5" /> Manage billing
          </Link>
        </div>
      </Section>

      {err && <div className="text-sm text-rose-600">{err}</div>}

      <div className="flex justify-end gap-2 sticky bottom-4 bg-card border rounded-lg p-3">
        {saved && <span className="text-xs text-emerald-600 self-center">✓ Saved</span>}
        <button
          disabled={busy}
          className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium flex items-center gap-1.5 disabled:opacity-50"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          {busy ? "Saving…" : "Save changes"}
        </button>
      </div>
    </form>
  );
}

function fmtDate(d: any): string {
  if (!d) return "—";
  const date = new Date(d);
  if (isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border rounded-lg bg-card p-5 space-y-3">
      <h2 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground">{title}</h2>
      {children}
    </div>
  );
}

function Row({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  required,
  disabled,
  note,
  tone,
}: {
  label: string;
  value: string;
  onChange?: (v: string) => void;
  type?: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  note?: string;
  tone?: "emerald" | "rose";
}) {
  return (
    <Field label={label} note={note}>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        className={`w-full border rounded-md px-3 py-2 text-sm bg-background disabled:opacity-70 disabled:cursor-not-allowed ${
          tone === "rose" ? "text-rose-700" : tone === "emerald" ? "text-emerald-700" : ""
        }`}
      />
    </Field>
  );
}

function Field({ label, children, note }: { label: string; children: React.ReactNode; note?: string }) {
  return (
    <label className="block">
      <div className="text-xs font-medium mb-1 flex items-center justify-between">
        <span>{label}</span>
        {note && <span className="text-[10px] text-muted-foreground font-normal">{note}</span>}
      </div>
      {children}
    </label>
  );
}
