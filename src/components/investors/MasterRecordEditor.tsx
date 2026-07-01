"use client";

/**
 * Client-details editor — the single editable surface for the Client 360 master
 * record. Renders an "Edit" button in the master-record header; clicking opens a
 * right drawer with the full editable field set grouped like the read view.
 *
 * This is the merge of the old inline "Edit client details" panel and the
 * "Master record" drawer into ONE editor: every field the add-investor form
 * captures, the themed Select/Date controls, and the multi-nominee / multi-bank
 * editors all live here. Saves via PATCH /api/investors/[id], then refreshes.
 * Computed fields (AUM, lifetime flows, review dates) stay read-only. PAN is the
 * identity key → read-only.
 */

import { useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Pencil, X, Loader2, Save, Plus, Trash2 } from "lucide-react";
import { RmSelector } from "@/components/common/RmSelector";
import { SelectField } from "@/components/ui/SelectField";
import { DateField } from "@/components/ui/DateField";
import { NomineesField } from "@/components/investors/NomineesField";
import type { Nominee } from "@/lib/investors/nominee";

type Investor = Record<string, any>;

export type MasterEditFlags = {
  showDob: boolean;
  showPhone: boolean;
  showEmail: boolean;
  showAddress: boolean;
  showSegment: boolean;
  showKyc: boolean;
  showRisk: boolean;
  showNominee: boolean;
  showBank: boolean;
  showStatus: boolean;
  showRm: boolean;
};

export function MasterRecordEditor({ investor, flags }: { investor: Investor; flags: MasterEditFlags }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const addr = (investor.address as any) ?? {};
  const seedNominees: Nominee[] =
    (investor as any).nominees?.length
      ? (investor as any).nominees
      : investor.nomineeName
        ? [{ name: investor.nomineeName, relation: investor.nomineeRelation ?? "" }]
        : [];
  const seedBanks: { bankName: string; accountMasked?: string; ifsc?: string }[] =
    (investor as any).bankAccounts?.length
      ? (investor as any).bankAccounts
      : investor.bankName
        ? [{ bankName: investor.bankName, accountMasked: investor.bankAccountNumberMasked ?? "", ifsc: investor.bankIfsc ?? "" }]
        : [];

  const [f, setF] = useState({
    name: investor.name ?? "",
    nameAsPerPan: investor.nameAsPerPan ?? "",
    dob: investor.dob ? String(investor.dob).slice(0, 10) : "",
    gender: investor.gender ?? "",
    phone: investor.phone ?? "",
    alternatePhone: investor.alternatePhone ?? "",
    whatsappPhone: investor.whatsappPhone ?? "",
    email: investor.email ?? "",
    line1: addr.line1 ?? "",
    city: addr.city ?? "",
    state: addr.state ?? "",
    pincode: addr.pincode ?? "",
    country: addr.country ?? "",
    occupation: investor.occupation ?? "",
    incomeRange: investor.incomeRange ?? "",
    employerName: investor.employerName ?? "",
    investorCategory: investor.investorCategory ?? "individual",
    segmentTag: investor.segmentTag ?? "",
    clientCategory: investor.clientCategory ?? "",
    serviceTier: investor.serviceTier ?? "",
    reviewFrequency: investor.reviewFrequency ?? "",
    rmId: investor.rmId ?? "",
    kycStatus: investor.kycStatus ?? "pending",
    riskProfile: investor.riskProfile ?? "",
    nominees: seedNominees,
    bankAccounts: seedBanks,
    bseUccCode: investor.bseUccCode ?? "",
    nseCanCode: investor.nseCanCode ?? "",
    mandateStatus: investor.mandateStatus ?? "none",
    mandateRefNo: investor.mandateRefNo ?? "",
    onboardedAt: investor.onboardedAt ? String(investor.onboardedAt).slice(0, 10) : "",
    anniversaryDate: investor.anniversaryDate ? String(investor.anniversaryDate).slice(0, 10) : "",
    status: investor.status ?? "active",
    notes: investor.notes ?? "",
  });

  function set<K extends keyof typeof f>(k: K, v: (typeof f)[K]) {
    setF((s) => ({ ...s, [k]: v }));
  }

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      // Enum value or undefined — never send the "—" placeholder (or "") to the
      // API, whose enum validation would reject it as "invalid body".
      const ev = (v: string | null | undefined) => (v && v !== "—" ? v : undefined);
      // Excel-imported clients can carry enum values outside the API's allowed
      // set (e.g. "Individual" / a custom segment), which made EVERY subsequent
      // save fail with "invalid body". Only emit an enum field when its current
      // value is actually valid — otherwise omit it (leaving the field untouched)
      // so editing the client's other details still saves. Picking a value from
      // the dropdown always sends a valid one.
      const inSet = (v: string | null | undefined, allowed: string[]) =>
        v && allowed.includes(v) ? v : undefined;
      const emailOk = (v: string) => v === "" || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);
      const payload: any = {
        name: f.name,
        nameAsPerPan: f.nameAsPerPan || null,
        dob: f.dob || null,
        gender: inSet(f.gender, ["M", "F", "O"]) ?? null,
        phone: f.phone || null,
        alternatePhone: f.alternatePhone || null,
        whatsappPhone: f.whatsappPhone || null,
        email: emailOk(f.email) ? f.email || "" : undefined,
        address: {
          line1: f.line1 || undefined,
          city: f.city || undefined,
          state: f.state || undefined,
          pincode: f.pincode || undefined,
          country: f.country || undefined,
        },
        occupation: f.occupation || null,
        incomeRange: f.incomeRange || null,
        employerName: f.employerName || null,
        // Treat the "—" placeholder (and "") as empty so the API's enum
        // validation never rejects the literal dash ("invalid body").
        investorCategory: inSet(f.investorCategory, ["individual", "huf", "corporate", "company", "trust", "nri", "minor", "other"]),
        segmentTag: inSet(f.segmentTag, ["HNI", "Affluent", "Retail", "NRI", "Corporate"]),
        clientCategory: inSet(f.clientCategory, ["A", "B", "C", "D"]) ?? null,
        serviceTier: inSet(f.serviceTier, ["A", "B", "C"]) ?? null,
        reviewFrequency: inSet(f.reviewFrequency, ["monthly", "quarterly", "half_yearly", "annual"]) ?? null,
        rmId: f.rmId || undefined,
        kycStatus: inSet(f.kycStatus, ["pending", "registered", "verified", "hold", "rejected", "expired", "re_kyc_required"]),
        riskProfile: inSet(f.riskProfile, ["conservative", "moderate", "aggressive", "very_aggressive"]),
        nominees: f.nominees
          .map((n) => ({ ...n, name: (n.name || "").trim(), relation: (n.relation || "").trim() || undefined }))
          .filter((n) => n.name),
        bankAccounts: f.bankAccounts
          .map((b) => ({
            bankName: (b.bankName || "").trim(),
            accountMasked: (b.accountMasked || "").trim() || undefined,
            ifsc: (b.ifsc || "").trim().toUpperCase() || undefined,
          }))
          .filter((b) => b.bankName),
        bseUccCode: f.bseUccCode || null,
        nseCanCode: f.nseCanCode || null,
        mandateStatus: inSet(f.mandateStatus, ["none", "pending", "active", "expired", "rejected", "cancelled"]),
        mandateRefNo: f.mandateRefNo || null,
        onboardedAt: f.onboardedAt || undefined,
        anniversaryDate: f.anniversaryDate || null,
        status: inSet(f.status, ["active", "dormant", "inactive", "redemption_risk", "closed", "exited"]),
        notes: f.notes,
        // Optimistic-concurrency token: the version we loaded. The API rejects
        // (409) if someone else saved in the meantime, surfaced via setErr below.
        expectedUpdatedAt: (investor as any).updatedAt ?? undefined,
      };
      const res = await fetch(`/api/investors/${investor.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        const fields = Array.isArray(j.issues)
          ? j.issues.map((i: any) => (Array.isArray(i.path) ? i.path.join(".") : "")).filter(Boolean).join(", ")
          : "";
        setErr((j.error ?? `Save failed (${res.status})`) + (fields ? ` — check: ${fields}` : ""));
        return;
      }
      setOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded-md border border-border bg-secondary/40 px-2.5 py-1 text-xs font-medium hover:bg-secondary inline-flex items-center gap-1.5"
        title="Edit client details"
      >
        <Pencil className="size-3.5" /> Edit
      </button>

      {open && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex justify-end" onClick={() => setOpen(false)}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg h-full bg-card border-l border-border shadow-2xl flex flex-col"
          >
            <div className="px-5 py-3 border-b flex items-center justify-between">
              <div className="font-semibold flex items-center gap-2"><Pencil className="size-4 text-brand-cyan" /> Edit client details</div>
              <button onClick={() => setOpen(false)} className="rounded p-1 hover:bg-accent" aria-label="Close"><X className="size-4" /></button>
            </div>

            <div className="flex-1 overflow-y-auto scrollbar-none p-4 space-y-5 text-sm">
              <Grp title="Identity">
                <F label="Name"><input value={f.name} onChange={(e) => set("name", e.target.value)} className="input-base" /></F>
                <F label="Name as per PAN"><input value={f.nameAsPerPan} onChange={(e) => set("nameAsPerPan", e.target.value)} className="input-base" /></F>
                {flags.showDob && <F label="Date of birth"><DateField value={f.dob} onChange={(e) => set("dob", e.target.value)} className="w-full" /></F>}
                <F label="Gender">
                  <SelectField value={f.gender} onChange={(e) => set("gender", e.target.value)} className="w-full" placeholder="—">
                    <option value="">—</option><option value="M">Male</option><option value="F">Female</option><option value="O">Other</option>
                  </SelectField>
                </F>
              </Grp>

              {(flags.showPhone || flags.showEmail || flags.showAddress) && (
                <Grp title="Contact">
                  {flags.showPhone && <F label="Mobile"><input value={f.phone} onChange={(e) => set("phone", e.target.value)} className="input-base" /></F>}
                  {flags.showPhone && <F label="Alternate mobile"><input value={f.alternatePhone} onChange={(e) => set("alternatePhone", e.target.value)} className="input-base" /></F>}
                  {flags.showPhone && <F label="WhatsApp"><input value={f.whatsappPhone} onChange={(e) => set("whatsappPhone", e.target.value)} className="input-base" /></F>}
                  {flags.showEmail && <F label="Email"><input value={f.email} onChange={(e) => set("email", e.target.value)} className="input-base" /></F>}
                  {flags.showAddress && (
                    <>
                      <F label="Address line"><input value={f.line1} onChange={(e) => set("line1", e.target.value)} className="input-base" /></F>
                      <div className="grid grid-cols-2 gap-2">
                        <F label="City"><input value={f.city} onChange={(e) => set("city", e.target.value)} className="input-base" /></F>
                        <F label="State"><input value={f.state} onChange={(e) => set("state", e.target.value)} className="input-base" /></F>
                        <F label="Pincode"><input value={f.pincode} onChange={(e) => set("pincode", e.target.value)} className="input-base" /></F>
                        <F label="Country"><input value={f.country} onChange={(e) => set("country", e.target.value)} className="input-base" /></F>
                      </div>
                    </>
                  )}
                </Grp>
              )}

              <Grp title="Profile">
                <F label="Occupation"><input value={f.occupation} onChange={(e) => set("occupation", e.target.value)} className="input-base" /></F>
                <F label="Income range"><input value={f.incomeRange} onChange={(e) => set("incomeRange", e.target.value)} className="input-base" /></F>
                <F label="Employer"><input value={f.employerName} onChange={(e) => set("employerName", e.target.value)} className="input-base" /></F>
                <F label="Entity type">
                  <SelectField value={f.investorCategory} onChange={(e) => set("investorCategory", e.target.value)} className="w-full">
                    {[["individual", "Individual"], ["huf", "HUF"], ["nri", "NRI"], ["company", "Company"], ["corporate", "Corporate (legacy)"], ["trust", "Trust"], ["minor", "Minor"], ["other", "Other"]].map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </SelectField>
                </F>
                <F label="Client category (A–D)">
                  <SelectField value={f.clientCategory} onChange={(e) => set("clientCategory", e.target.value)} className="w-full" placeholder="— Not categorised —">
                    <option value="">— Not categorised —</option>{["A", "B", "C", "D"].map((c) => <option key={c} value={c}>{`Category ${c}`}</option>)}
                  </SelectField>
                </F>
                {flags.showSegment && (
                  <F label="Segment">
                    <SelectField value={f.segmentTag} onChange={(e) => set("segmentTag", e.target.value)} className="w-full" placeholder="—">
                      <option value="">—</option>{["HNI", "Affluent", "Retail", "NRI", "Corporate"].map((c) => <option key={c} value={c}>{c}</option>)}
                    </SelectField>
                  </F>
                )}
                <F label="Service tier">
                  <SelectField value={f.serviceTier} onChange={(e) => set("serviceTier", e.target.value)} className="w-full" placeholder="—">
                    <option value="">—</option><option value="A">A — Quarterly</option><option value="B">B — Half-yearly</option><option value="C">C — Annual</option>
                  </SelectField>
                </F>
                <F label="Review frequency">
                  <SelectField value={f.reviewFrequency} onChange={(e) => set("reviewFrequency", e.target.value)} className="w-full" placeholder="Auto (by service tier)">
                    <option value="">Auto (by service tier)</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="half_yearly">Half-yearly</option><option value="annual">Yearly</option>
                  </SelectField>
                </F>
                {flags.showRm && (
                  <F label="Assigned RM"><RmSelector value={f.rmId || null} onChange={(id) => set("rmId", id ?? "")} placeholder="— Unassigned —" /></F>
                )}
              </Grp>

              <Grp title="Compliance">
                {flags.showKyc && (
                  <F label="KYC status">
                    <SelectField value={f.kycStatus} onChange={(e) => set("kycStatus", e.target.value)} className="w-full">
                      {["pending", "registered", "verified", "hold", "rejected", "expired", "re_kyc_required"].map((c) => <option key={c} value={c}>{c}</option>)}
                    </SelectField>
                  </F>
                )}
                {flags.showRisk && (
                  <F label="Risk profile">
                    <SelectField value={f.riskProfile} onChange={(e) => set("riskProfile", e.target.value)} className="w-full" placeholder="—">
                      <option value="">—</option>{["conservative", "moderate", "aggressive", "very_aggressive"].map((c) => <option key={c} value={c}>{c.replace(/_/g, " ")}</option>)}
                    </SelectField>
                  </F>
                )}
                {flags.showNominee && (
                  <div>
                    <div className="text-[11px] text-muted-foreground mb-0.5">Nominees</div>
                    <NomineesField value={f.nominees} onChange={(n) => set("nominees", n)} />
                  </div>
                )}
                {flags.showBank && (
                  <div>
                    <div className="text-[11px] text-muted-foreground mb-1">Bank accounts</div>
                    <div className="space-y-2">
                      {f.bankAccounts.length === 0 && <div className="text-xs text-muted-foreground">No bank accounts added.</div>}
                      {f.bankAccounts.map((b, i) => (
                        <div key={i} className="flex gap-2 items-center">
                          <input value={b.bankName} onChange={(e) => set("bankAccounts", f.bankAccounts.map((x, idx) => idx === i ? { ...x, bankName: e.target.value } : x))} placeholder="Bank name" className="input-base flex-1" />
                          <input value={b.accountMasked ?? ""} onChange={(e) => set("bankAccounts", f.bankAccounts.map((x, idx) => idx === i ? { ...x, accountMasked: e.target.value } : x))} placeholder="A/c (masked)" className="input-base w-32 font-mono" />
                          <input value={b.ifsc ?? ""} onChange={(e) => set("bankAccounts", f.bankAccounts.map((x, idx) => idx === i ? { ...x, ifsc: e.target.value } : x))} placeholder="IFSC" className="input-base w-28 font-mono" />
                          <button type="button" onClick={() => set("bankAccounts", f.bankAccounts.filter((_, idx) => idx !== i))} className="text-muted-foreground hover:text-rose-600 shrink-0 p-1" aria-label="Remove bank account"><Trash2 className="size-4" /></button>
                        </div>
                      ))}
                      <button type="button" onClick={() => set("bankAccounts", [...f.bankAccounts, { bankName: "", accountMasked: "", ifsc: "" }])} className="btn-ghost text-xs"><Plus className="size-3.5" /> Add bank account</button>
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <F label="UCC (BSE)"><input value={f.bseUccCode} onChange={(e) => set("bseUccCode", e.target.value)} className="input-base" /></F>
                  <F label="CAN (NSE)"><input value={f.nseCanCode} onChange={(e) => set("nseCanCode", e.target.value)} className="input-base" /></F>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <F label="Mandate status">
                    <SelectField value={f.mandateStatus} onChange={(e) => set("mandateStatus", e.target.value)} className="w-full">
                      {["none", "pending", "active", "expired", "rejected", "cancelled"].map((c) => <option key={c} value={c}>{c}</option>)}
                    </SelectField>
                  </F>
                  <F label="Mandate ref"><input value={f.mandateRefNo} onChange={(e) => set("mandateRefNo", e.target.value)} className="input-base" /></F>
                </div>
              </Grp>

              <Grp title="Lifecycle">
                <div className="grid grid-cols-2 gap-2">
                  <F label="Onboarded on"><DateField value={f.onboardedAt} onChange={(e) => set("onboardedAt", e.target.value)} className="w-full" /></F>
                  <F label="Anniversary"><DateField value={f.anniversaryDate} onChange={(e) => set("anniversaryDate", e.target.value)} className="w-full" /></F>
                </div>
                {flags.showStatus && (
                  <F label="Client status">
                    <SelectField value={f.status} onChange={(e) => set("status", e.target.value)} className="w-full">
                      {["active", "dormant", "inactive", "redemption_risk", "closed", "exited"].map((c) => <option key={c} value={c}>{c.replace(/_/g, " ")}</option>)}
                    </SelectField>
                  </F>
                )}
                <F label="Notes"><textarea value={f.notes} onChange={(e) => set("notes", e.target.value)} rows={3} className="input-base w-full" /></F>
              </Grp>
            </div>

            <div className="px-5 py-3 border-t flex items-center justify-end gap-2 bg-muted/30">
              {err && <span className="text-xs text-rose-600 mr-auto">{err}</span>}
              <button onClick={() => setOpen(false)} className="btn-secondary text-xs">Cancel</button>
              <button onClick={save} disabled={busy} className="btn-primary text-xs inline-flex items-center gap-1">
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} Save
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

function Grp({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">{title}</div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-[11px] text-muted-foreground mb-0.5">{label}</div>
      {children}
    </label>
  );
}
