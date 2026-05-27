"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";

export default function NewTenantPage() {
  const router = useRouter();
  const [packages, setPackages] = useState<any[]>([]);
  const [form, setForm] = useState({
    firmName: "",
    arn: "",
    ownerName: "",
    ownerEmail: "",
    ownerPassword: "",
    packageKey: "",
    billingCycle: "yearly",
    trialDays: 14,
  });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/super-admin/packages")
      .then((r) => r.json())
      .then((j) => setPackages(j.packages ?? []));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const res = await fetch("/api/super-admin/tenants", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      const j = await res.json();
      if (!res.ok) {
        setErr(j.error ?? "Create failed");
        return;
      }
      router.push(`/super-admin/tenants/${j.tenantId}`);
    } finally {
      setBusy(false);
    }
  }

  function set(k: string, v: string | number) {
    setForm((s) => ({ ...s, [k]: v }));
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <Link
        href="/super-admin/tenants"
        className="text-sm text-muted-foreground hover:underline flex items-center gap-1"
      >
        <ChevronLeft className="size-4" /> Back to tenants
      </Link>

      <h1 className="text-2xl font-bold tracking-tight">Create MFD tenant</h1>
      <p className="text-sm text-muted-foreground">
        Sets up the firm + owner user + subscription on the chosen package.
      </p>

      <form onSubmit={submit} className="border rounded-lg bg-card p-6 space-y-3">
        <Field label="Firm legal name" value={form.firmName} setValue={(v) => set("firmName", v)} required />
        <Field label="ARN" value={form.arn} setValue={(v) => set("arn", v)} required placeholder="ARN-XXXXX" />
        <div className="border-t pt-3">
          <div className="text-xs font-medium uppercase text-muted-foreground mb-2">Owner account</div>
          <Field label="Owner name" value={form.ownerName} setValue={(v) => set("ownerName", v)} required />
          <Field label="Owner email" value={form.ownerEmail} setValue={(v) => set("ownerEmail", v)} required type="email" />
          <Field label="Temporary password (8+)" value={form.ownerPassword} setValue={(v) => set("ownerPassword", v)} required type="password" />
        </div>

        <div className="border-t pt-3">
          <div className="text-xs font-medium uppercase text-muted-foreground mb-2">Subscription</div>
          <div>
            <div className="text-xs font-medium mb-1">Package</div>
            <select
              value={form.packageKey}
              onChange={(e) => set("packageKey", e.target.value)}
              required
              className="w-full border rounded-md px-3 py-2 text-sm bg-background"
            >
              <option value="">Select a package…</option>
              {packages.map((p: any) => (
                <option key={p.key} value={p.key}>
                  {p.name} (₹{(p.yearly_price_paise ?? 0) / 100}/yr · {p.max_users} users · {p.max_investors} clients)
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3 mt-3">
            <div>
              <div className="text-xs font-medium mb-1">Billing cycle</div>
              <select
                value={form.billingCycle}
                onChange={(e) => set("billingCycle", e.target.value)}
                className="w-full border rounded-md px-3 py-2 text-sm bg-background"
              >
                <option value="yearly">Yearly</option>
                <option value="monthly">Monthly</option>
                <option value="custom">Custom</option>
              </select>
            </div>
            <Field
              label="Trial days"
              type="number"
              value={String(form.trialDays)}
              setValue={(v) => set("trialDays", Number(v))}
            />
          </div>
        </div>

        {err && <div className="text-sm text-rose-600">{err}</div>}

        <div className="flex justify-end gap-2 pt-2 border-t">
          <Link href="/super-admin/tenants" className="rounded-md border px-4 py-2 text-sm">
            Cancel
          </Link>
          <button
            disabled={busy}
            className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {busy ? "Creating…" : "Create tenant + owner"}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({
  label,
  value,
  setValue,
  type = "text",
  placeholder,
  required,
}: {
  label: string;
  value: string;
  setValue: (v: string) => void;
  type?: string;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <label className="block mt-2">
      <div className="text-xs font-medium mb-1">
        {label}
        {required && <span className="text-rose-600 ml-0.5">*</span>}
      </div>
      <input
        type={type}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        required={required}
        className="w-full border rounded-md px-3 py-2 text-sm bg-background"
      />
    </label>
  );
}
