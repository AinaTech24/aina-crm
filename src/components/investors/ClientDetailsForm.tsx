"use client";

/**
 * Client details — the full-page editor for the Client 360 master record
 * (/dashboard/investors/[id]/edit). It used to be an eight-step wizard in a
 * narrow pop-up; the firm asked for a full page, so every section now sits on
 * one screen and saves once.
 *
 * Saves via PATCH /api/investors/[id] (optimistic concurrency on updatedAt),
 * then returns to the client. Computed figures (AUM, lifetime flows) stay
 * read-only.
 *
 * PAN is editable so a typo or a PAN-less import can be corrected. The value
 * shown is the client's OWN PAN: an import key in the column (a minor filed
 * under the guardian's PAN) is never put in the box, and such a client's PAN
 * cannot be changed here — the RTA import finds that client by the key.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { RmSelector } from "@/components/common/RmSelector";
import { SelectField } from "@/components/ui/SelectField";
import { DateField } from "@/components/ui/DateField";
import { Field, FieldSection } from "@/components/ui/Field";
import { FormActions } from "@/components/ui/FormActions";
import { Button } from "@/components/ui/Button";
import { notify } from "@/components/ui/Toast";
import { NomineesField } from "@/components/investors/NomineesField";
import { UccCodesField } from "@/components/investors/UccCodesField";
import { cleanUccCodes } from "@/lib/investors/ucc";
import { isMinorKey, ownPan } from "@/lib/investors/pan-display";
import { humanise } from "@/lib/format";
import { formatINR } from "@/lib/utils";
import type { Nominee } from "@/lib/investors/nominee";

type Investor = Record<string, any>;

export type ClientDetailsFlags = {
  showPan: boolean;
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
  showAum: boolean;
  showSip: boolean;
  showInflow: boolean;
};

const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const KYC_STATUSES = ["pending", "registered", "verified", "hold", "rejected", "expired", "re_kyc_required"];
const MANDATE_STATUSES = ["none", "pending", "active", "expired", "rejected", "cancelled"];
const CLIENT_STATUSES = ["active", "dormant", "inactive", "redemption_risk", "closed", "exited"];

export function ClientDetailsForm({ investor, flags }: { investor: Investor; flags: ClientDetailsFlags }) {
  const router = useRouter();
  const backHref = `/dashboard/investors/${investor.id}`;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [panErr, setPanErr] = useState<string | null>(null);

  const addr = (investor.address as any) ?? {};
  const initialPan = ownPan(investor.pan) ?? "";
  // A minor filed under the guardian's PAN: the column holds the import's key.
  const panLocked = !initialPan && isMinorKey(investor.pan);
  const seedNominees: Nominee[] =
    investor.nominees?.length
      ? investor.nominees
      : investor.nomineeName
        ? [{ name: investor.nomineeName, relation: investor.nomineeRelation ?? "" }]
        : [];
  const seedBanks: { bankName: string; accountMasked?: string; ifsc?: string }[] =
    investor.bankAccounts?.length
      ? investor.bankAccounts
      : investor.bankName
        ? [{ bankName: investor.bankName, accountMasked: investor.bankAccountNumberMasked ?? "", ifsc: investor.bankIfsc ?? "" }]
        : [];
  const day = (v: unknown) => (v ? String(v).slice(0, 10) : "");

  const [f, setF] = useState({
    pan: initialPan,
    name: investor.name ?? "",
    nameAsPerPan: investor.nameAsPerPan ?? "",
    maritalStatus: investor.maritalStatus ?? "",
    motherName: investor.motherName ?? "",
    birthPlace: investor.birthPlace ?? "",
    aadhaarLast4: investor.aadhaarLast4 ?? "",
    dob: day(investor.dob),
    gender: investor.gender ?? "",
    phone: investor.phone ?? "",
    alternatePhone: investor.alternatePhone ?? "",
    whatsappPhone: investor.whatsappPhone ?? "",
    email: investor.email ?? "",
    mobileRelation: investor.mobileRelation ?? "",
    emailRelation: investor.emailRelation ?? "",
    line1: addr.line1 ?? "",
    city: addr.city ?? "",
    state: addr.state ?? "",
    pincode: addr.pincode ?? "",
    country: addr.country ?? "",
    occupation: investor.occupation ?? "",
    incomeRange: investor.incomeRange ?? "",
    employerName: investor.employerName ?? "",
    modeOfHolding: investor.modeOfHolding ?? "",
    householdType: investor.householdType ?? "",
    investorCategory: investor.investorCategory ?? "individual",
    segmentTag: investor.segmentTag ?? "",
    clientCategory: investor.clientCategory ?? "",
    serviceTier: investor.serviceTier ?? "",
    // A custom day cadence (reviewFrequencyDays) is shown as "days_<n>" so the
    // one dropdown covers both presets and "every N days".
    reviewFrequency: investor.reviewFrequencyDays ? `days_${investor.reviewFrequencyDays}` : investor.reviewFrequency ?? "",
    rmId: investor.rmId ?? "",
    kycStatus: investor.kycStatus ?? "pending",
    riskProfile: investor.riskProfile ?? "",
    residencyStatus: investor.residencyStatus ?? "",
    taxStatus: investor.taxStatus ?? "",
    panAadhaarLinkStatus: investor.panAadhaarLinkStatus ?? "",
    ckycNumber: investor.ckycNumber ?? "",
    ckycExpiryAt: day(investor.ckycExpiryAt),
    kycValidatedAt: day(investor.kycValidatedAt),
    kraName: investor.kraName ?? "",
    fatcaStatus: investor.fatcaStatus ?? "",
    fatcaExpiryAt: day(investor.fatcaExpiryAt),
    nominees: seedNominees,
    bankAccounts: seedBanks,
    bseUccCode: investor.bseUccCode ?? "",
    nseCanCode: investor.nseCanCode ?? "",
    uccCodes: (investor.uccCodes as string[] | undefined) ?? [],
    mandateStatus: investor.mandateStatus ?? "none",
    mandateRefNo: investor.mandateRefNo ?? "",
    onboardedAt: day(investor.onboardedAt),
    lastReviewAt: day(investor.lastReviewAt),
    nextReviewAt: day(investor.nextReviewAt),
    anniversaryDate: day(investor.anniversaryDate),
    status: investor.status ?? "active",
    notes: investor.notes ?? "",
  });

  function set<K extends keyof typeof f>(k: K, v: (typeof f)[K]) {
    setF((s) => ({ ...s, [k]: v }));
  }

  const hasContact = flags.showPhone || flags.showEmail || flags.showAddress;
  const input = "input-base w-full";

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setPanErr(null);

    // PAN goes out only when it was changed. Clearing it is not allowed: the
    // RTA import and the duplicate check both find the client by it.
    const pan = f.pan.trim().toUpperCase();
    const panChanged = flags.showPan && !panLocked && pan !== initialPan;
    if (panChanged && !pan) return setPanErr("PAN can't be removed. Type the correct PAN instead.");
    if (panChanged && !PAN_RE.test(pan)) return setPanErr("PAN should look like ABCDE1234F.");
    if (!f.name.trim()) return setErr("Name is required.");

    setBusy(true);
    try {
      const inSet = (v: string | null | undefined, allowed: string[]) => (v && allowed.includes(v) ? v : undefined);
      const emailOk = (v: string) => v === "" || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);
      const payload: any = {
        ...(panChanged ? { pan } : {}),
        name: f.name.trim(),
        nameAsPerPan: f.nameAsPerPan || null,
        maritalStatus: f.maritalStatus || null,
        motherName: f.motherName || null,
        birthPlace: f.birthPlace || null,
        // 4 digits or nothing — a half-typed value is dropped rather than
        // failing the whole save with a schema error.
        aadhaarLast4: f.aadhaarLast4 ? (/^\d{4}$/.test(f.aadhaarLast4) ? f.aadhaarLast4 : undefined) : null,
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
        mobileRelation: f.mobileRelation || null,
        emailRelation: f.emailRelation || null,
        modeOfHolding: f.modeOfHolding || null,
        householdType: f.householdType || null,
        residencyStatus: inSet(f.residencyStatus, ["indian_resident", "nri", "oci", "pio", "foreign_national"]) ?? null,
        taxStatus: f.taxStatus || null,
        panAadhaarLinkStatus: inSet(f.panAadhaarLinkStatus, ["linked", "not_linked", "pending", "not_applicable"]) ?? null,
        ckycNumber: f.ckycNumber || null,
        ckycExpiryAt: f.ckycExpiryAt || null,
        kycValidatedAt: f.kycValidatedAt || null,
        kraName: f.kraName || null,
        fatcaStatus: inSet(f.fatcaStatus, ["pending", "verified", "expired"]) ?? null,
        fatcaExpiryAt: f.fatcaExpiryAt || null,
        investorCategory: inSet(f.investorCategory, ["individual", "huf", "corporate", "company", "trust", "nri", "minor", "other"]),
        segmentTag: inSet(f.segmentTag, ["HNI", "Affluent", "Retail", "NRI", "Corporate"]),
        clientCategory: inSet(f.clientCategory, ["A", "B", "C", "D"]) ?? null,
        serviceTier: inSet(f.serviceTier, ["A", "B", "C"]) ?? null,
        // "days_<n>" → custom cadence; anything else → a preset. Exactly one of
        // the two is set, so the API's computeNextReview picks the right basis.
        reviewFrequency: /^days_\d+$/.test(f.reviewFrequency)
          ? null
          : inSet(f.reviewFrequency, ["monthly", "quarterly", "half_yearly", "annual"]) ?? null,
        reviewFrequencyDays: /^days_\d+$/.test(f.reviewFrequency) ? Number(f.reviewFrequency.slice(5)) : null,
        rmId: f.rmId || undefined,
        kycStatus: inSet(f.kycStatus, KYC_STATUSES),
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
        uccCodes: cleanUccCodes(f.uccCodes),
        mandateStatus: inSet(f.mandateStatus, MANDATE_STATUSES),
        mandateRefNo: f.mandateRefNo || null,
        onboardedAt: f.onboardedAt || undefined,
        // null clears the date; the API recomputes nextReviewAt from a NEW
        // lastReviewAt unless an explicit nextReviewAt is also supplied.
        lastReviewAt: f.lastReviewAt || null,
        nextReviewAt: f.nextReviewAt || null,
        anniversaryDate: f.anniversaryDate || null,
        status: inSet(f.status, CLIENT_STATUSES),
        notes: f.notes,
        // Optimistic-concurrency token: the version we loaded. The API rejects
        // (409) if someone else saved in the meantime.
        expectedUpdatedAt: investor.updatedAt ?? undefined,
      };
      const res = await fetch(`/api/investors/${investor.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        if (j.field === "pan") {
          setPanErr(j.error);
          document.getElementById("cd-identity")?.scrollIntoView({ behavior: "smooth", block: "start" });
          return;
        }
        const fields = Array.isArray(j.issues)
          ? j.issues.map((i: any) => (Array.isArray(i.path) ? i.path.join(".") : "")).filter(Boolean).join(", ")
          : "";
        setErr((j.error ?? `Save failed (${res.status})`) + (fields ? ` — check: ${fields}` : ""));
        return;
      }
      notify.success("Client details saved");
      router.push(backHref);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-5" noValidate>
      <div id="cd-identity" className="scroll-mt-24">
      <FieldSection title="Identity">
        {flags.showPan && (
          <Field
            label="PAN"
            error={panErr}
            hint={panLocked ? "This minor is filed under the guardian's PAN by the RTA import, so it can't be changed here." : "Ten characters, e.g. ABCDE1234F."}
          >
            {(id, d, invalid) => panLocked ? (
              <div className="input-base flex w-full items-center bg-secondary/60 text-muted-foreground">Guardian&rsquo;s PAN</div>
            ) : (
              <input
                id={id}
                aria-describedby={d}
                aria-invalid={invalid}
                value={f.pan}
                onChange={(e) => { setPanErr(null); set("pan", e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10)); }}
                placeholder="ABCDE1234F"
                autoComplete="off"
                spellCheck={false}
                className={`${input} font-mono uppercase tracking-wide`}
              />
            )}
          </Field>
        )}
        <Field label="Name" required>
          {(id, d) => <input id={id} aria-describedby={d} value={f.name} onChange={(e) => set("name", e.target.value)} className={input} />}
        </Field>
        <Field label="Name as per PAN">
          {(id, d) => <input id={id} aria-describedby={d} value={f.nameAsPerPan} onChange={(e) => set("nameAsPerPan", e.target.value)} className={input} />}
        </Field>
        {flags.showDob && (
          <Field label="Date of birth">
            {(id) => <DateField id={id} value={f.dob} onChange={(e) => set("dob", e.target.value)} className="w-full" />}
          </Field>
        )}
        <Field label="Gender">
          {(id) => (
            <SelectField id={id} value={f.gender} onChange={(e) => set("gender", e.target.value)} className="w-full" placeholder="Select">
              <option value="">Select</option><option value="M">Male</option><option value="F">Female</option><option value="O">Other</option>
            </SelectField>
          )}
        </Field>
        <Field label="Marital status">
          {(id) => <input id={id} value={f.maritalStatus} onChange={(e) => set("maritalStatus", e.target.value)} placeholder="e.g. Married" className={input} />}
        </Field>
        <Field label="Mother’s name">
          {(id) => <input id={id} value={f.motherName} onChange={(e) => set("motherName", e.target.value)} className={input} />}
        </Field>
        <Field label="Place of birth">
          {(id) => <input id={id} value={f.birthPlace} onChange={(e) => set("birthPlace", e.target.value)} className={input} />}
        </Field>
        <Field label="Aadhaar (last 4)">
          {(id) => <input id={id} value={f.aadhaarLast4} onChange={(e) => set("aadhaarLast4", e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="1234" inputMode="numeric" className={`${input} font-mono`} />}
        </Field>
        <Field label="Client since">
          {(id) => <DateField id={id} value={f.onboardedAt} onChange={(e) => set("onboardedAt", e.target.value)} className="w-full" />}
        </Field>
        <Field label="Anniversary">
          {(id) => <DateField id={id} value={f.anniversaryDate} onChange={(e) => set("anniversaryDate", e.target.value)} className="w-full" />}
        </Field>
      </FieldSection>
      </div>

      {hasContact && (
        <FieldSection title="Contact">
          {flags.showPhone && (
            <>
              <Field label="Mobile">{(id) => <input id={id} value={f.phone} onChange={(e) => set("phone", e.target.value)} inputMode="tel" className={input} />}</Field>
              <Field label="Alternate mobile">{(id) => <input id={id} value={f.alternatePhone} onChange={(e) => set("alternatePhone", e.target.value)} inputMode="tel" className={input} />}</Field>
              <Field label="WhatsApp">{(id) => <input id={id} value={f.whatsappPhone} onChange={(e) => set("whatsappPhone", e.target.value)} inputMode="tel" className={input} />}</Field>
            </>
          )}
          {flags.showEmail && (
            <Field label="Email">{(id) => <input id={id} value={f.email} onChange={(e) => set("email", e.target.value)} inputMode="email" className={input} />}</Field>
          )}
          <Field label="Mobile belongs to">{(id) => <input id={id} value={f.mobileRelation} onChange={(e) => set("mobileRelation", e.target.value)} placeholder="self / spouse / …" className={input} />}</Field>
          <Field label="Email belongs to">{(id) => <input id={id} value={f.emailRelation} onChange={(e) => set("emailRelation", e.target.value)} placeholder="self / spouse / …" className={input} />}</Field>
          {flags.showAddress && (
            <>
              <Field label="Address line" className="sm:col-span-2">{(id) => <input id={id} value={f.line1} onChange={(e) => set("line1", e.target.value)} className={input} />}</Field>
              <Field label="City">{(id) => <input id={id} value={f.city} onChange={(e) => set("city", e.target.value)} className={input} />}</Field>
              <Field label="State">{(id) => <input id={id} value={f.state} onChange={(e) => set("state", e.target.value)} className={input} />}</Field>
              <Field label="Pincode">{(id) => <input id={id} value={f.pincode} onChange={(e) => set("pincode", e.target.value)} inputMode="numeric" className={input} />}</Field>
              <Field label="Country">{(id) => <input id={id} value={f.country} onChange={(e) => set("country", e.target.value)} className={input} />}</Field>
            </>
          )}
        </FieldSection>
      )}

      <FieldSection title="Profile">
        <Field label="Occupation">{(id) => <input id={id} value={f.occupation} onChange={(e) => set("occupation", e.target.value)} className={input} />}</Field>
        <Field label="Income range">{(id) => <input id={id} value={f.incomeRange} onChange={(e) => set("incomeRange", e.target.value)} className={input} />}</Field>
        <Field label="Employer">{(id) => <input id={id} value={f.employerName} onChange={(e) => set("employerName", e.target.value)} className={input} />}</Field>
        <Field label="Entity type">
          {(id) => (
            <SelectField id={id} value={f.investorCategory} onChange={(e) => set("investorCategory", e.target.value)} className="w-full">
              {[["individual", "Individual"], ["huf", "HUF"], ["nri", "NRI"], ["company", "Company"], ["corporate", "Corporate (legacy)"], ["trust", "Trust"], ["minor", "Minor"], ["other", "Other"]].map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </SelectField>
          )}
        </Field>
        <Field label="Client category (A–D)">
          {(id) => (
            <SelectField id={id} value={f.clientCategory} onChange={(e) => set("clientCategory", e.target.value)} className="w-full" placeholder="Select">
              <option value="">Not categorised</option>{["A", "B", "C", "D"].map((c) => <option key={c} value={c}>{`Category ${c}`}</option>)}
            </SelectField>
          )}
        </Field>
        {flags.showSegment && (
          <Field label="Segment">
            {(id) => (
              <SelectField id={id} value={f.segmentTag} onChange={(e) => set("segmentTag", e.target.value)} className="w-full" placeholder="Select">
                <option value="">Select</option>{["HNI", "Affluent", "Retail", "NRI", "Corporate"].map((c) => <option key={c} value={c}>{c}</option>)}
              </SelectField>
            )}
          </Field>
        )}
        <Field label="Mode of holding">{(id) => <input id={id} value={f.modeOfHolding} onChange={(e) => set("modeOfHolding", e.target.value)} placeholder="single / joint / …" className={input} />}</Field>
        <Field label="Household type">{(id) => <input id={id} value={f.householdType} onChange={(e) => set("householdType", e.target.value)} placeholder="Family / Individual" className={input} />}</Field>
        {flags.showRm && (
          <Field label="Assigned RM">{() => <RmSelector value={f.rmId || null} onChange={(id) => set("rmId", id ?? "")} placeholder="— Unassigned —" />}</Field>
        )}
      </FieldSection>

      <FieldSection title="Compliance status">
        {flags.showKyc && (
          <Field label="KYC status">
            {(id) => (
              <SelectField id={id} value={f.kycStatus} onChange={(e) => set("kycStatus", e.target.value)} className="w-full">
                {KYC_STATUSES.map((c) => <option key={c} value={c}>{c === "re_kyc_required" ? "Re-KYC required" : humanise(c)}</option>)}
              </SelectField>
            )}
          </Field>
        )}
        {flags.showRisk && (
          <Field label="Risk profile">
            {(id) => (
              <SelectField id={id} value={f.riskProfile} onChange={(e) => set("riskProfile", e.target.value)} className="w-full" placeholder="Select">
                <option value="">Select</option>{["conservative", "moderate", "aggressive", "very_aggressive"].map((c) => <option key={c} value={c}>{humanise(c)}</option>)}
              </SelectField>
            )}
          </Field>
        )}
        <Field label="Residential status">
          {(id) => (
            <SelectField id={id} value={f.residencyStatus} onChange={(e) => set("residencyStatus", e.target.value)} className="w-full" placeholder="Select">
              <option value="">Select</option>{[["indian_resident", "Indian resident"], ["nri", "NRI"], ["oci", "OCI"], ["pio", "PIO"], ["foreign_national", "Foreign national"]].map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </SelectField>
          )}
        </Field>
        <Field label="Tax status">{(id) => <input id={id} value={f.taxStatus} onChange={(e) => set("taxStatus", e.target.value)} className={input} />}</Field>
        <Field label="PAN–Aadhaar link">
          {(id) => (
            <SelectField id={id} value={f.panAadhaarLinkStatus} onChange={(e) => set("panAadhaarLinkStatus", e.target.value)} className="w-full" placeholder="Select">
              <option value="">Select</option>{[["linked", "Linked"], ["not_linked", "Not linked"], ["pending", "Pending"], ["not_applicable", "Not applicable"]].map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </SelectField>
          )}
        </Field>
        <Field label="KRA">{(id) => <input id={id} value={f.kraName} onChange={(e) => set("kraName", e.target.value)} className={input} />}</Field>
        <Field label="CKYC number">{(id) => <input id={id} value={f.ckycNumber} onChange={(e) => set("ckycNumber", e.target.value)} className={`${input} font-mono`} />}</Field>
        <Field label="CKYC expiry">{(id) => <DateField id={id} value={f.ckycExpiryAt} onChange={(e) => set("ckycExpiryAt", e.target.value)} className="w-full" />}</Field>
        <Field label="KYC validated on">{(id) => <DateField id={id} value={f.kycValidatedAt} onChange={(e) => set("kycValidatedAt", e.target.value)} className="w-full" />}</Field>
        <Field label="FATCA status">
          {(id) => (
            <SelectField id={id} value={f.fatcaStatus} onChange={(e) => set("fatcaStatus", e.target.value)} className="w-full" placeholder="Select">
              <option value="">Select</option>{["pending", "verified", "expired"].map((c) => <option key={c} value={c}>{humanise(c)}</option>)}
            </SelectField>
          )}
        </Field>
        <Field label="FATCA expiry">{(id) => <DateField id={id} value={f.fatcaExpiryAt} onChange={(e) => set("fatcaExpiryAt", e.target.value)} className="w-full" />}</Field>
        <Field label="UCC (BSE)">{(id) => <input id={id} value={f.bseUccCode} onChange={(e) => set("bseUccCode", e.target.value)} className={input} />}</Field>
        <Field label="CAN (NSE)">{(id) => <input id={id} value={f.nseCanCode} onChange={(e) => set("nseCanCode", e.target.value)} className={input} />}</Field>
        <div className="sm:col-span-2">
          <UccCodesField value={f.uccCodes} onChange={(v) => set("uccCodes", v)} label="Other UCC codes" />
        </div>
        <Field label="Mandate status">
          {(id) => (
            <SelectField id={id} value={f.mandateStatus} onChange={(e) => set("mandateStatus", e.target.value)} className="w-full">
              {MANDATE_STATUSES.map((c) => <option key={c} value={c}>{humanise(c)}</option>)}
            </SelectField>
          )}
        </Field>
        <Field label="Mandate ref">{(id) => <input id={id} value={f.mandateRefNo} onChange={(e) => set("mandateRefNo", e.target.value)} className={input} />}</Field>
      </FieldSection>

      {flags.showNominee && (
        <FieldSection title="Nominee">
          <div className="sm:col-span-2">
            <NomineesField value={f.nominees} onChange={(n) => set("nominees", n)} />
          </div>
        </FieldSection>
      )}

      {flags.showBank && (
        <FieldSection title="Bank account">
          <div className="sm:col-span-2 space-y-2">
            {f.bankAccounts.length === 0 && <p className="text-sm text-muted-foreground">No bank account added.</p>}
            {f.bankAccounts.map((b, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
                <input value={b.bankName} onChange={(e) => set("bankAccounts", f.bankAccounts.map((x, idx) => idx === i ? { ...x, bankName: e.target.value } : x))} placeholder="Bank name" aria-label="Bank name" className="input-base min-w-0 flex-1 basis-full sm:basis-auto" />
                <input value={b.accountMasked ?? ""} onChange={(e) => set("bankAccounts", f.bankAccounts.map((x, idx) => idx === i ? { ...x, accountMasked: e.target.value } : x))} placeholder="A/c (masked)" aria-label="Account number (masked)" className="input-base min-w-0 flex-1 font-mono sm:w-44 sm:flex-none" />
                <input value={b.ifsc ?? ""} onChange={(e) => set("bankAccounts", f.bankAccounts.map((x, idx) => idx === i ? { ...x, ifsc: e.target.value } : x))} placeholder="IFSC" aria-label="IFSC" className="input-base min-w-0 flex-1 font-mono sm:w-36 sm:flex-none" />
                <button type="button" onClick={() => set("bankAccounts", f.bankAccounts.filter((_, idx) => idx !== i))} className="btn-icon text-muted-foreground hover:text-destructive" aria-label="Remove bank account"><Trash2 className="size-4" /></button>
              </div>
            ))}
            <Button type="button" variant="ghost" size="sm" onClick={() => set("bankAccounts", [...f.bankAccounts, { bankName: "", accountMasked: "", ifsc: "" }])}>
              <Plus className="size-3.5" /> Add bank account
            </Button>
          </div>
        </FieldSection>
      )}

      <FieldSection title="Financials" description="AUM and lifetime flows are computed from holdings and transactions.">
        <Field label="Service tier">
          {(id) => (
            <SelectField id={id} value={f.serviceTier} onChange={(e) => set("serviceTier", e.target.value)} className="w-full" placeholder="Select">
              <option value="">Select</option><option value="A">A — Quarterly</option><option value="B">B — Half-yearly</option><option value="C">C — Annual</option>
            </SelectField>
          )}
        </Field>
        {(flags.showAum || flags.showSip || flags.showInflow) && (
          <div className="sm:col-span-2 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {flags.showAum && <RO label="Current AUM" value={formatINR(Number(investor.aum ?? 0))} />}
            {flags.showSip && <RO label="Monthly SIP" value={formatINR(Number(investor.activeSipAmount ?? 0))} />}
            {flags.showInflow && <RO label="Lifetime inflow" value={formatINR(Number(investor.lifetimeInflow ?? 0))} />}
            {flags.showInflow && <RO label="Lifetime outflow" value={formatINR(Number(investor.lifetimeOutflow ?? 0))} />}
          </div>
        )}
      </FieldSection>

      <FieldSection title="Review & lifecycle">
        <Field label="Review frequency">
          {(id) => (
            <SelectField id={id} value={f.reviewFrequency} onChange={(e) => set("reviewFrequency", e.target.value)} className="w-full" placeholder="Auto (by service tier)">
              <option value="">Auto (by service tier)</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="days_100">Every 100 days</option><option value="half_yearly">Half-yearly</option><option value="annual">Yearly</option>
            </SelectField>
          )}
        </Field>
        {flags.showStatus && (
          <Field label="Client status">
            {(id) => (
              <SelectField id={id} value={f.status} onChange={(e) => set("status", e.target.value)} className="w-full">
                {CLIENT_STATUSES.map((c) => <option key={c} value={c}>{humanise(c)}</option>)}
              </SelectField>
            )}
          </Field>
        )}
        <Field label="Last review" hint="Changing it re-derives the next review from the frequency.">
          {(id) => <DateField id={id} value={f.lastReviewAt} onChange={(e) => set("lastReviewAt", e.target.value)} className="w-full" />}
        </Field>
        <Field label="Next review" hint="Set it to override the derived date.">
          {(id) => <DateField id={id} value={f.nextReviewAt} onChange={(e) => set("nextReviewAt", e.target.value)} className="w-full" />}
        </Field>
        <Field label="Notes" className="sm:col-span-2">
          {(id) => <textarea id={id} value={f.notes} onChange={(e) => set("notes", e.target.value)} rows={3} className="input-base min-h-20 w-full" />}
        </Field>
      </FieldSection>

      <FormActions status={err ? <span role="alert" className="text-destructive">{err}</span> : undefined}>
        <Button type="button" variant="ghost" onClick={() => router.push(backHref)}>Cancel</Button>
        <Button type="submit" variant="primary" loading={busy}>Save changes</Button>
      </FormActions>
    </form>
  );
}

function RO({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-secondary/70 px-3 py-2">
      <div className="text-2xs text-muted-foreground">{label}</div>
      <div className="text-sm font-medium tabular-nums">{value}</div>
    </div>
  );
}
