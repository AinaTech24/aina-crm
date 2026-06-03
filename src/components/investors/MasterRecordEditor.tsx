"use client";

/**
 * Master Record editor — makes the Client 360 master record editable.
 *
 * Renders a "Edit" button in the master-record header; clicking opens a right
 * drawer with the full editable field set grouped like the read view. Saves
 * via PATCH /api/investors/[id] (which now accepts every field here), then
 * refreshes the page. Computed fields (AUM, lifetime flows, review dates) stay
 * read-only and aren't shown here. PAN is the unique identity key → read-only.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, X, Loader2, Save } from "lucide-react";
import { RmSelector } from "@/components/common/RmSelector";

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
    serviceTier: investor.serviceTier ?? "",
    rmId: investor.rmId ?? "",
    kycStatus: investor.kycStatus ?? "pending",
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
  });

  function set<K extends keyof typeof f>(k: K, v: (typeof f)[K]) {
    setF((s) => ({ ...s, [k]: v }));
  }

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const payload: any = {
        name: f.name,
        nameAsPerPan: f.nameAsPerPan || null,
        dob: f.dob || null,
        gender: f.gender || null,
        phone: f.phone || null,
        alternatePhone: f.alternatePhone || null,
        whatsappPhone: f.whatsappPhone || null,
        email: f.email || "",
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
        investorCategory: f.investorCategory,
        segmentTag: f.segmentTag || undefined,
        serviceTier: f.serviceTier || null,
        rmId: f.rmId || undefined,
        kycStatus: f.kycStatus,
        riskProfile: f.riskProfile || undefined,
        nomineeName: f.nomineeName || null,
        nomineeRelation: f.nomineeRelation || null,
        bankName: f.bankName || null,
        bankAccountNumberMasked: f.bankAccountNumberMasked || null,
        bankIfsc: f.bankIfsc || null,
        bseUccCode: f.bseUccCode || null,
        nseCanCode: f.nseCanCode || null,
        mandateStatus: f.mandateStatus,
        mandateRefNo: f.mandateRefNo || null,
        status: f.status,
      };
      const res = await fetch(`/api/investors/${investor.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setErr(j.error ?? `Save failed (${res.status})`);
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
        title="Edit the master record"
      >
        <Pencil className="size-3.5" /> Edit
      </button>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/40 flex justify-end" onClick={() => setOpen(false)}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg h-full bg-card border-l border-border shadow-2xl flex flex-col"
          >
            <div className="px-5 py-3 border-b flex items-center justify-between">
              <div className="font-semibold flex items-center gap-2"><Pencil className="size-4 text-brand-cyan" /> Edit master record</div>
              <button onClick={() => setOpen(false)} className="rounded p-1 hover:bg-accent" aria-label="Close"><X className="size-4" /></button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-5 text-sm">
              <Grp title="Identity">
                <F label="Name"><input value={f.name} onChange={(e) => set("name", e.target.value)} className="input-base" /></F>
                <F label="Name as per PAN"><input value={f.nameAsPerPan} onChange={(e) => set("nameAsPerPan", e.target.value)} className="input-base" /></F>
                {flags.showDob && <F label="Date of birth"><input type="date" value={f.dob} onChange={(e) => set("dob", e.target.value)} className="input-base" /></F>}
                <F label="Gender">
                  <select value={f.gender} onChange={(e) => set("gender", e.target.value)} className="input-base">
                    <option value="">—</option><option value="M">Male</option><option value="F">Female</option><option value="O">Other</option>
                  </select>
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
                <F label="Client category">
                  <select value={f.investorCategory} onChange={(e) => set("investorCategory", e.target.value)} className="input-base">
                    {["individual", "huf", "corporate", "trust", "nri", "minor", "other"].map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </F>
                {flags.showSegment && (
                  <F label="Segment">
                    <select value={f.segmentTag} onChange={(e) => set("segmentTag", e.target.value)} className="input-base">
                      <option value="">—</option>{["HNI", "Affluent", "Retail", "NRI", "Corporate"].map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </F>
                )}
                <F label="Service tier">
                  <select value={f.serviceTier} onChange={(e) => set("serviceTier", e.target.value)} className="input-base">
                    <option value="">—</option><option value="A">A — Quarterly</option><option value="B">B — Half-yearly</option><option value="C">C — Annual</option>
                  </select>
                </F>
                {flags.showRm && (
                  <F label="Assigned RM"><RmSelector value={f.rmId || null} onChange={(id) => set("rmId", id ?? "")} placeholder="— Unassigned —" /></F>
                )}
              </Grp>

              <Grp title="Compliance">
                {flags.showKyc && (
                  <F label="KYC status">
                    <select value={f.kycStatus} onChange={(e) => set("kycStatus", e.target.value)} className="input-base">
                      {["pending", "registered", "verified", "hold", "rejected", "expired", "re_kyc_required"].map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </F>
                )}
                {flags.showRisk && (
                  <F label="Risk profile">
                    <select value={f.riskProfile} onChange={(e) => set("riskProfile", e.target.value)} className="input-base">
                      <option value="">—</option>{["conservative", "moderate", "aggressive", "very_aggressive"].map((c) => <option key={c} value={c}>{c.replace(/_/g, " ")}</option>)}
                    </select>
                  </F>
                )}
                {flags.showNominee && (
                  <div className="grid grid-cols-2 gap-2">
                    <F label="Nominee name"><input value={f.nomineeName} onChange={(e) => set("nomineeName", e.target.value)} className="input-base" /></F>
                    <F label="Nominee relation"><input value={f.nomineeRelation} onChange={(e) => set("nomineeRelation", e.target.value)} className="input-base" /></F>
                  </div>
                )}
                {flags.showBank && (
                  <>
                    <F label="Bank name"><input value={f.bankName} onChange={(e) => set("bankName", e.target.value)} className="input-base" /></F>
                    <div className="grid grid-cols-2 gap-2">
                      <F label="Account (masked)"><input value={f.bankAccountNumberMasked} onChange={(e) => set("bankAccountNumberMasked", e.target.value)} className="input-base" /></F>
                      <F label="IFSC"><input value={f.bankIfsc} onChange={(e) => set("bankIfsc", e.target.value)} className="input-base" /></F>
                    </div>
                  </>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <F label="UCC (BSE)"><input value={f.bseUccCode} onChange={(e) => set("bseUccCode", e.target.value)} className="input-base" /></F>
                  <F label="CAN (NSE)"><input value={f.nseCanCode} onChange={(e) => set("nseCanCode", e.target.value)} className="input-base" /></F>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <F label="Mandate status">
                    <select value={f.mandateStatus} onChange={(e) => set("mandateStatus", e.target.value)} className="input-base">
                      {["none", "pending", "active", "expired", "rejected", "cancelled"].map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </F>
                  <F label="Mandate ref"><input value={f.mandateRefNo} onChange={(e) => set("mandateRefNo", e.target.value)} className="input-base" /></F>
                </div>
              </Grp>

              {flags.showStatus && (
                <Grp title="Lifecycle">
                  <F label="Client status">
                    <select value={f.status} onChange={(e) => set("status", e.target.value)} className="input-base">
                      {["active", "dormant", "inactive", "redemption_risk", "closed", "exited"].map((c) => <option key={c} value={c}>{c.replace(/_/g, " ")}</option>)}
                    </select>
                  </F>
                </Grp>
              )}
            </div>

            <div className="px-5 py-3 border-t flex items-center justify-end gap-2 bg-muted/30">
              {err && <span className="text-xs text-rose-600 mr-auto">{err}</span>}
              <button onClick={() => setOpen(false)} className="btn-secondary text-xs">Cancel</button>
              <button onClick={save} disabled={busy} className="btn-primary text-xs inline-flex items-center gap-1">
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} Save
              </button>
            </div>
          </div>
        </div>
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
