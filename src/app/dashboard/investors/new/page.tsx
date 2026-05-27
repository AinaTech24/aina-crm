"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, HeartHandshake } from "lucide-react";

function NewInvestorPageInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const familyId = sp.get("familyId");
  const familyRole = sp.get("familyRole") ?? "";
  const [form, setForm] = useState({
    name: "",
    pan: "",
    email: "",
    phone: "",
    whatsappPhone: "",
    dob: "",
    segmentTag: "Retail",
    investorCategory: "individual",
    city: "",
    state: "",
    pincode: "",
    notes: "",
  });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const res = await fetch("/api/investors", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          pan: form.pan.toUpperCase().trim(),
          email: form.email || undefined,
          phone: form.phone || undefined,
          whatsappPhone: form.whatsappPhone || form.phone || undefined,
          dob: form.dob || undefined,
          segmentTag: form.segmentTag,
          investorCategory: form.investorCategory,
          address: { city: form.city, state: form.state, pincode: form.pincode, country: "India" },
          notes: form.notes || undefined,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setErr(j.error ?? "Create failed");
        return;
      }
      const j = await res.json();

      // If we came from a family page, link the new investor to that family.
      if (familyId) {
        await fetch(`/api/families/${familyId}/members`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ investorId: j.id, familyRole: familyRole || undefined }),
        });
        router.push(`/dashboard/families/${familyId}`);
      } else {
        router.push(`/dashboard/investors/${j.id}`);
      }
    } finally {
      setBusy(false);
    }
  }

  function set(k: string, v: string) {
    setForm((s) => ({ ...s, [k]: v }));
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <Link
        href="/dashboard/investors"
        className="text-sm text-muted-foreground hover:underline flex items-center gap-1"
      >
        <ChevronLeft className="size-4" /> Back to investors
      </Link>

      <h1 className="text-2xl font-bold tracking-tight">Add investor</h1>
      <p className="text-sm text-muted-foreground">PAN is the unique key — used for dedup against AMC + RTA feeds.</p>

      {familyId && (
        <div className="rounded-md border border-blue-300 bg-blue-50 text-blue-900 px-4 py-3 text-sm flex items-center gap-2">
          <HeartHandshake className="size-4" />
          <span>
            This investor will be added to the selected family
            {familyRole && (
              <>
                {" "}as <strong>{familyRole}</strong>
              </>
            )}
            .
          </span>
        </div>
      )}

      <form onSubmit={submit} className="border rounded-lg bg-card p-6 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Full name" value={form.name} onChange={(v) => set("name", v)} required />
          <Field label="PAN" value={form.pan} onChange={(v) => set("pan", v.toUpperCase())} required placeholder="ABCDE1234F" />
          <Field label="Date of birth" type="date" value={form.dob} onChange={(v) => set("dob", v)} />
          <SelectField
            label="Segment"
            value={form.segmentTag}
            onChange={(v) => set("segmentTag", v)}
            options={["HNI", "Affluent", "Retail", "NRI", "Corporate"]}
          />
          <SelectField
            label="Category"
            value={form.investorCategory}
            onChange={(v) => set("investorCategory", v)}
            options={["individual", "huf", "corporate", "trust", "nri", "minor", "other"]}
          />
          <Field label="Email" type="email" value={form.email} onChange={(v) => set("email", v)} />
          <Field label="Phone" value={form.phone} onChange={(v) => set("phone", v)} placeholder="+919XXXXXXXXX" />
          <Field label="WhatsApp" value={form.whatsappPhone} onChange={(v) => set("whatsappPhone", v)} placeholder="Same as phone if blank" />
        </div>

        <div className="border-t pt-4">
          <div className="text-xs font-medium mb-2 text-muted-foreground uppercase">Address</div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="City" value={form.city} onChange={(v) => set("city", v)} />
            <Field label="State" value={form.state} onChange={(v) => set("state", v)} />
            <Field label="Pincode" value={form.pincode} onChange={(v) => set("pincode", v)} />
          </div>
        </div>

        <div>
          <label className="text-xs font-medium block mb-1">Notes</label>
          <textarea
            value={form.notes}
            onChange={(e) => set("notes", e.target.value)}
            rows={3}
            className="w-full border rounded-md px-3 py-2 text-sm bg-background"
          />
        </div>

        {err && <div className="text-sm text-rose-600">{err}</div>}

        <div className="flex justify-end gap-2 pt-2 border-t">
          <Link href="/dashboard/investors" className="rounded-md border px-4 py-2 text-sm">
            Cancel
          </Link>
          <button
            disabled={busy}
            className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {busy ? "Creating…" : "Create investor"}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <div className="text-xs font-medium mb-1">
        {label}
        {required && <span className="text-rose-600 ml-0.5">*</span>}
      </div>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        className="w-full border rounded-md px-3 py-2 text-sm bg-background"
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <label className="block">
      <div className="text-xs font-medium mb-1">{label}</div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border rounded-md px-3 py-2 text-sm bg-background"
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

export default function NewInvestorPage() {
  return (
    <Suspense fallback={null}>
      <NewInvestorPageInner />
    </Suspense>
  );
}
