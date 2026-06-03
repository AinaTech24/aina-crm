"use client";

/**
 * In-place edit panel for the Investor detail page (Client Master).
 *
 * Wraps the 6 groups (Identity, Contact, Profile, Compliance, Financials,
 * Lifecycle) and lets the user toggle the whole record into edit mode.
 * Read-only fields (Client ID, PAN, AUM, lifetimeInflow) stay locked even
 * in edit mode because they're system-managed.
 *
 * Posts to PATCH /api/investors/[id].
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Save, X, Loader2 } from "lucide-react";

const CATEGORIES = [
  ["individual", "Individual"],
  ["huf", "HUF"],
  ["nri", "NRI"],
  ["company", "Company"],
  ["corporate", "Corporate (legacy)"],
  ["trust", "Trust"],
  ["minor", "Minor"],
  ["other", "Other"],
] as const;

const SEGMENTS = [
  ["HNI", "HNI"],
  ["Affluent", "Affluent"],
  ["Retail", "Retail"],
  ["NRI", "NRI"],
  ["Corporate", "Corporate"],
] as const;

const STATUSES = [
  ["active", "Active"],
  ["dormant", "Dormant"],
  ["inactive", "Inactive"],
  ["redemption_risk", "Redemption Risk"],
  ["closed", "Closed"],
] as const;

const RISK_PROFILES = [
  ["conservative", "Conservative"],
  ["moderate", "Moderate"],
  ["aggressive", "Aggressive"],
  ["very_aggressive", "Very aggressive"],
] as const;

export function InvestorEditPanel({
  investor,
  showPan = true,
  showDob = true,
  showPhone = true,
  showEmail = true,
  showWhatsApp = true,
  showNominee = true,
  showBank = true,
  showRiskProfile = true,
}: {
  investor: any;
  showPan?: boolean;
  showDob?: boolean;
  showPhone?: boolean;
  showEmail?: boolean;
  showWhatsApp?: boolean;
  showNominee?: boolean;
  showBank?: boolean;
  showRiskProfile?: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const initial = () => ({
    name: investor.name ?? "",
    email: investor.email ?? "",
    phone: investor.phone ?? "",
    alternatePhone: investor.alternatePhone ?? "",
    whatsappPhone: investor.whatsappPhone ?? "",
    gender: investor.gender ?? "",
    occupation: investor.occupation ?? "",
    incomeRange: investor.incomeRange ?? "",
    segmentTag: investor.segmentTag ?? "",
    investorCategory: investor.investorCategory ?? "individual",
    riskProfile: investor.riskProfile ?? "",
    nomineeName: investor.nomineeName ?? "",
    nomineeRelation: investor.nomineeRelation ?? "",
    bankName: investor.bankName ?? "",
    bankAccountNumberMasked: investor.bankAccountNumberMasked ?? "",
    bankIfsc: investor.bankIfsc ?? "",
    bseUccCode: investor.bseUccCode ?? "",
    nseCanCode: investor.nseCanCode ?? "",
    mandateStatus: investor.mandateStatus ?? "none",
    mandateRefNo: investor.mandateRefNo ?? "",
    status: investor.status ?? "active",
    notes: investor.notes ?? "",
    city: investor.address?.city ?? "",
    state: investor.address?.state ?? "",
    pincode: investor.address?.pincode ?? "",
    addressLine1: investor.address?.line1 ?? "",
  });

  const [form, setForm] = useState(initial);

  function set<K extends keyof ReturnType<typeof initial>>(k: K, v: any) {
    setForm((s) => ({ ...s, [k]: v }));
  }

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const payload: any = {
        name: form.name,
      };
      if (showEmail) payload.email = form.email || "";
      if (showPhone) {
        payload.phone = form.phone || undefined;
        payload.whatsappPhone = form.whatsappPhone || undefined;
      }
      if (showRiskProfile) {
        payload.riskProfile = form.riskProfile || undefined;
      }
      if (showNominee) {
        payload.nomineeName = form.nomineeName || undefined;
        payload.nomineeRelation = form.nomineeRelation || undefined;
      }
      if (showBank) {
        payload.bankName = form.bankName || undefined;
        payload.bankAccountNumberMasked = form.bankAccountNumberMasked || undefined;
        payload.bankIfsc = form.bankIfsc || undefined;
      }

      const res = await fetch(`/api/investors/${investor.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await res.json();
      if (!res.ok) {
        setErr(j.error ?? `Save failed (${res.status})`);
        return;
      }
      setEditing(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  function cancel() {
    setForm(initial());
    setEditing(false);
    setErr(null);
  }

  return (
    <div className="border rounded-lg bg-card p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold">Master record</h2>
        {!editing ? (
          <button
            onClick={() => setEditing(true)}
            className="rounded-md border px-3 py-1.5 text-sm flex items-center gap-1.5 hover:bg-accent"
          >
            <Pencil className="size-3.5" /> Edit
          </button>
        ) : (
          <div className="flex gap-2">
            <button
              onClick={cancel}
              disabled={busy}
              className="rounded-md border px-3 py-1.5 text-sm flex items-center gap-1.5 hover:bg-accent disabled:opacity-50"
            >
              <X className="size-3.5" /> Cancel
            </button>
            <button
              onClick={save}
              disabled={busy}
              className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium flex items-center gap-1.5 disabled:opacity-50"
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        )}
      </div>

      {err && (
        <div className="border border-rose-300 bg-rose-50 text-rose-900 rounded-md p-2 text-sm mb-3">{err}</div>
      )}

      <Group title="Identity">
        <KV label="Name">
          {editing ? (
            <input value={form.name} onChange={(e) => set("name", e.target.value)} className={inputCls} />
          ) : (
            <span>{investor.name}</span>
          )}
        </KV>
        {showPan && <KV label="PAN" mono>{investor.pan}</KV>}
        {showDob && (
          <KV label="DOB">
            {investor.dob ? new Date(investor.dob).toLocaleDateString("en-IN") : "—"}
          </KV>
        )}
        <KV label="Gender">
          {editing ? (
            <select value={form.gender} onChange={(e) => set("gender", e.target.value)} className={inputCls}>
              <option value="">—</option>
              <option value="M">Male</option>
              <option value="F">Female</option>
              <option value="O">Other</option>
            </select>
          ) : (
            <span>{labelFor(investor.gender, [["M", "Male"], ["F", "Female"], ["O", "Other"]])}</span>
          )}
        </KV>
      </Group>

      {(showPhone || showEmail) && (
        <Group title="Contact">
          {showPhone && (
            <KV label="Mobile">
              {editing ? (
                <input value={form.phone} onChange={(e) => set("phone", e.target.value)} className={inputCls} />
              ) : (
                <span>{investor.phone ?? "—"}</span>
              )}
            </KV>
          )}
          {showPhone && (
            <KV label="Alt mobile">
              <span>{investor.alternatePhone ?? "—"}</span>
            </KV>
          )}
          {showEmail && (
            <KV label="Email">
              {editing ? (
                <input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} className={inputCls} />
              ) : (
                <span>{investor.email ?? "—"}</span>
              )}
            </KV>
          )}
          {showPhone && (
            <KV label="WhatsApp">
              {editing ? (
                <input value={form.whatsappPhone} onChange={(e) => set("whatsappPhone", e.target.value)} className={inputCls} />
              ) : (
                <span>{investor.whatsappPhone ?? "—"}</span>
              )}
            </KV>
          )}
        </Group>
      )}

      <Group title="Profile">
        <KV label="Client category">
          {editing ? (
            <select value={form.investorCategory} onChange={(e) => set("investorCategory", e.target.value)} className={inputCls}>
              {CATEGORIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          ) : (
            <span className="capitalize">{(investor.investorCategory ?? "—").replace("corporate", "Company")}</span>
          )}
        </KV>
        <KV label="Client type (segment)">
          {editing ? (
            <select value={form.segmentTag} onChange={(e) => set("segmentTag", e.target.value)} className={inputCls}>
              <option value="">—</option>
              {SEGMENTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          ) : (
            <span>{investor.segmentTag ?? "—"}</span>
          )}
        </KV>
        {showRiskProfile && (
          <KV label="Risk profile">
            {editing ? (
              <select value={form.riskProfile} onChange={(e) => set("riskProfile", e.target.value)} className={inputCls}>
                <option value="">Not assessed</option>
                {RISK_PROFILES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            ) : (
              <span className="capitalize">{(investor.riskProfile ?? "not assessed").replace(/_/g, " ")}</span>
            )}
          </KV>
        )}
      </Group>

      {(showNominee || showBank) && (
        <Group title="Nominee & bank">
          {showNominee && (
            <KV label="Nominee name">
              {editing ? (
                <input value={form.nomineeName} onChange={(e) => set("nomineeName", e.target.value)} className={inputCls} />
              ) : (
                <span>{investor.nomineeName ?? "—"}</span>
              )}
            </KV>
          )}
          {showNominee && (
            <KV label="Nominee relation">
              {editing ? (
                <input value={form.nomineeRelation} onChange={(e) => set("nomineeRelation", e.target.value)} className={inputCls} />
              ) : (
                <span>{investor.nomineeRelation ?? "—"}</span>
              )}
            </KV>
          )}
          {showBank && (
            <KV label="Bank">
              {editing ? (
                <input value={form.bankName} onChange={(e) => set("bankName", e.target.value)} className={inputCls} />
              ) : (
                <span>{investor.bankName ?? "—"}</span>
              )}
            </KV>
          )}
          {showBank && (
            <KV label="Account (masked)">
              {editing ? (
                <input value={form.bankAccountNumberMasked} onChange={(e) => set("bankAccountNumberMasked", e.target.value)} className={inputCls} />
              ) : (
                <span className="font-mono">{investor.bankAccountNumberMasked ?? "—"}</span>
              )}
            </KV>
          )}
          {showBank && (
            <KV label="IFSC">
              {editing ? (
                <input value={form.bankIfsc} onChange={(e) => set("bankIfsc", e.target.value)} className={inputCls} />
              ) : (
                <span className="font-mono">{investor.bankIfsc ?? "—"}</span>
              )}
            </KV>
          )}
        </Group>
      )}

      <Group title="Notes">
        {editing ? (
          <textarea
            value={form.notes}
            onChange={(e) => set("notes", e.target.value)}
            rows={3}
            className="w-full border rounded-md px-2 py-1 text-sm bg-background col-span-3"
          />
        ) : (
          <p className="text-sm whitespace-pre-wrap col-span-3 text-muted-foreground">
            {investor.notes || <em>No internal notes.</em>}
          </p>
        )}
      </Group>
    </div>
  );
}

const inputCls = "w-full border rounded-md px-2 py-1 text-sm bg-background";

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t first:border-t-0 first:pt-0 pt-4 mt-4 first:mt-0">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
        {title}
      </div>
      <div className="grid grid-cols-3 gap-x-6 gap-y-2">{children}</div>
    </div>
  );
}

function KV({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-sm mt-0.5 ${mono ? "font-mono" : ""}`}>{children}</div>
    </div>
  );
}

function labelFor(val: any, opts: ReadonlyArray<readonly [string, string]>): string {
  if (!val) return "—";
  return opts.find(([k]) => k === val)?.[1] ?? String(val);
}
