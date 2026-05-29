"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, Sparkles, Loader2 } from "lucide-react";
import { InvestorLookup } from "@/components/common/InvestorLookup";
import { RmSelector } from "@/components/common/RmSelector";
import { SubDistributorLookup } from "@/components/common/SubDistributorLookup";

/** Sources that require / suggest linking an existing client as the referrer. */
const REFERRAL_SOURCES = new Set(["referral", "existing_client"]);

export default function NewLeadPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    city: "",
    source: "manual",
    intendedAmount: "",
    notes: "",
    referredByInvestorId: "" as string | null | "",
    referredByName: "" as string | null | "",
    ownerId: "" as string | null | "",
    subDistributorId: "" as string | null | "",
    subDistributorName: "" as string | null | "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const payload: any = { ...form };
      // Strip empty referrer fields so we don't send "" to a uuid column
      if (!form.referredByInvestorId) {
        delete payload.referredByInvestorId;
        delete payload.referredByName;
      }
      // Same for the RM picker — empty string would fail the uuid check.
      // When ownerId is unset the API auto-assigns via round-robin.
      if (!form.ownerId) {
        delete payload.ownerId;
      }
      // Strip the displayName-only field (it's UI helper, not a column);
      // omit subDistributorId if not picked.
      delete payload.subDistributorName;
      if (!form.subDistributorId) {
        delete payload.subDistributorId;
      }
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await res.json();
      if (!res.ok) {
        setErr(j.error ?? "Create failed");
        return;
      }
      router.push("/dashboard/leads");
    } finally {
      setBusy(false);
    }
  }

  function set(k: string, v: string) {
    setForm((s) => ({ ...s, [k]: v }));
  }

  const showReferrerLookup = REFERRAL_SOURCES.has(form.source);

  return (
    <div className="space-y-4 max-w-2xl">
      <Link
        href="/dashboard/leads"
        className="text-sm text-muted-foreground hover:underline hover:text-foreground flex items-center gap-1 transition-colors"
      >
        <ChevronLeft className="size-4" /> Back to leads
      </Link>

      <div>
        <h1 className="page-title">
          <Sparkles className="size-6 text-brand-cyan" /> New lead
        </h1>
        <p className="page-subtitle mt-1">
          Once created, the lead-nurture workflow auto-kicks in (if installed + active).
        </p>
      </div>

      <form onSubmit={submit} className="card-surface p-5 space-y-4">
        <Row label="Name" value={form.name} setValue={(v) => set("name", v)} required />
        <Row
          label="Email"
          value={form.email}
          setValue={(v) => set("email", v)}
          type="email"
          placeholder="name@example.com"
        />
        <Row
          label="Phone"
          value={form.phone}
          setValue={(v) => set("phone", v)}
          placeholder="+919XXXXXXXXX"
        />
        <Row label="City" value={form.city} setValue={(v) => set("city", v)} />

        <div>
          <div className="text-xs font-medium mb-1">Source</div>
          <select
            value={form.source}
            onChange={(e) => {
              const v = e.target.value;
              set("source", v);
              // Clear referrer fields if user switches away from a referral source
              if (!REFERRAL_SOURCES.has(v)) {
                setForm((s) => ({ ...s, referredByInvestorId: "", referredByName: "" }));
              }
            }}
            className="input-base"
          >
            <option value="referral">Client Referral</option>
            <option value="existing_client">Existing Client Reference</option>
            <option value="website">Website</option>
            <option value="social_media">Social Media</option>
            <option value="webinar">Webinar</option>
            <option value="seminar">Seminar</option>
            <option value="walk_in">Walk-in</option>
            <option value="google">Google</option>
            <option value="cold_call">Cold Call</option>
            <option value="other">Other</option>
            <option value="manual">— Manual entry —</option>
          </select>
        </div>

        {/* Conditional referrer lookup — appears only for referral / existing-client sources */}
        {showReferrerLookup && (
          <div className="rounded-xl bg-brand-cyan-light/30 border border-brand-cyan/20 p-3.5 space-y-2 animate-fade-in">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold text-brand-cyan-deep uppercase tracking-wider">
                Referred by (Client) <span className="text-rose-600">*</span>
              </div>
              <span className="text-[10px] text-muted-foreground">
                Lookup from Clients module
              </span>
            </div>
            <InvestorLookup
              value={form.referredByInvestorId || null}
              displayName={form.referredByName || null}
              onSelect={(id, name) =>
                setForm((s) => ({
                  ...s,
                  referredByInvestorId: id,
                  referredByName: name,
                }))
              }
              onClear={() =>
                setForm((s) => ({ ...s, referredByInvestorId: "", referredByName: "" }))
              }
              placeholder="Type the existing client's name, PAN, or mobile…"
              required={showReferrerLookup}
            />
            <p className="text-[11px] text-muted-foreground">
              The referring client will be linked so referral credit is tracked end-to-end.
            </p>
          </div>
        )}

        <div>
          <div className="text-xs font-medium mb-1">
            Sub-distributor
            <span className="ml-1 text-[10px] text-muted-foreground font-normal">
              · optional · channel partner credit
            </span>
          </div>
          <SubDistributorLookup
            value={form.subDistributorId || null}
            displayName={form.subDistributorName || null}
            onSelect={(id, name) =>
              setForm((s) => ({
                ...s,
                subDistributorId: id,
                subDistributorName: name,
              }))
            }
            onClear={() =>
              setForm((s) => ({ ...s, subDistributorId: "", subDistributorName: "" }))
            }
          />
          <p className="text-[10px] text-muted-foreground mt-1">
            Attribute this lead to a channel partner. On conversion, their
            commission split applies in the brokerage reconciler.
          </p>
        </div>

        <div>
          <div className="text-xs font-medium mb-1">
            Assign RM
            <span className="ml-1 text-[10px] text-muted-foreground font-normal">
              · leave blank for auto round-robin
            </span>
          </div>
          <RmSelector
            value={form.ownerId || null}
            onChange={(id) => setForm((s) => ({ ...s, ownerId: id ?? "" }))}
            role="rm"
            placeholder="— Auto-assign via round-robin —"
          />
        </div>

        <Row
          label="Intended investment (₹)"
          value={form.intendedAmount}
          setValue={(v) => set("intendedAmount", v)}
          placeholder="e.g. 500000"
        />

        <div>
          <div className="text-xs font-medium mb-1">Notes</div>
          <textarea
            value={form.notes}
            onChange={(e) => set("notes", e.target.value)}
            rows={3}
            placeholder="Anything the RM should know about this lead…"
            className="input-base"
          />
        </div>

        {err && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 text-destructive text-sm px-3 py-2">
            {err}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t border-border">
          <Link href="/dashboard/leads" className="btn-secondary">
            Cancel
          </Link>
          <button
            type="submit"
            disabled={
              busy ||
              !form.name ||
              (showReferrerLookup && !form.referredByInvestorId)
            }
            className="btn-primary"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            {busy ? "Creating…" : "Create lead"}
          </button>
        </div>
      </form>
    </div>
  );
}

function Row({
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
    <label className="block">
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
        className="input-base"
      />
    </label>
  );
}
