"use client";

/**
 * Add client. The client TYPE comes first and shapes the form
 * (lib/investors/client-types.ts): a minor asks for the guardian, an HUF for
 * the Karta and coparceners, an entity for its incorporation, signatories and
 * beneficial owners, an NRI for overseas details. Personal fields, joint
 * holders and nominees are for individuals only.
 *
 * Added into a family, a member takes the head's address and the family's
 * review frequency (lib/families/shared-details.ts), so neither is asked. A
 * minor's risk profile is the guardian's (migration 0234), so it is not asked
 * either; the guardian's client record is linked instead.
 */

import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { Suspense, useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, HeartHandshake } from "lucide-react";
import { RmSelector } from "@/components/common/RmSelector";
import { SelectField as UiSelectField } from "@/components/ui/SelectField";
import { DateField } from "@/components/ui/DateField";
import { ClientTypeSections, type GuardianLink } from "@/components/investors/ClientTypeSections";
import {
  TypeDetailsSchema, canNominate, cleanTypeDetails, clientTypeDef, clientTypeOptions, hasAdultDetails,
  hasPersonalDetails, majorityDate, singleHoldingOnly, CLIENT_TYPE_KEYS, type ClientTypeDetails,
  HOUSEHOLD_TYPES, MARITAL_STATUSES, defaultHouseholdType, defaultTaxStatus, taxStatusOptions,
  CONTACT_OWNERS, INCOME_RANGES, OCCUPATIONS, withCurrent,
} from "@/lib/investors/client-types";
import { COUNTRIES, INDIAN_STATES, canonicalCountry, canonicalState, isIndianAddress } from "@/lib/geo/places";
import { useMasterLabels } from "@/lib/masters/use-master-labels";
import { usePincodeAutofill } from "@/lib/pincode/use-pincode";
import type { Nominee } from "@/lib/investors/nominee";
import { ReferralsField } from "@/components/investors/ReferralsField";
import type { Referral } from "@/lib/investors/referral";
import { UccCodesField } from "@/components/investors/UccCodesField";
import { cleanUccCodes } from "@/lib/investors/ucc";
import { CustomFieldsSection, missingRequired, type CustomFieldDef } from "@/components/common/CustomFieldInputs";
import { FormActions } from "@/components/ui/FormActions";
import { Button, buttonClass } from "@/components/ui/Button";

function NewInvestorPageInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const familyId = sp.get("familyId");
  const familyRole = sp.get("familyRole") ?? "";
  // ?type=minor (or any client type) opens the form ready for that type.
  const startType = (CLIENT_TYPE_KEYS as readonly string[]).includes(sp.get("type") ?? "") ? (sp.get("type") as string) : "individual";
  const [form, setForm] = useState({
    // Identity & personal
    name: "",
    pan: "",
    dob: "",
    gender: "",
    birthPlace: "",
    motherName: "",
    maritalStatus: "",
    occupation: "",
    incomeRange: "",
    employerName: "", // Company Name
    aadhaarLast4: "",
    // Contact
    email: "",
    emailRelation: "",
    phone: "", // Mobile
    mobileRelation: "",
    whatsappPhone: "",
    // Mailing address
    street: "",
    city: "",
    state: "",
    pincode: "",
    country: "India",
    // Classification
    investorCategory: startType,
    segmentTag: "Retail",
    clientCategory: "",
    riskProfile: "",
    householdType: defaultHouseholdType(startType, !!familyId),
    familyOwnerName: "",
    referralClientName: "",
    modeOfHolding: "",
    bseUccCode: "", // UCC No
    uccCodes: [] as string[],
    taxStatus: defaultTaxStatus(startType),
    residencyStatus: "",
    kycStatus: "pending",
    // Second / joint holder
    secondHolderFirstName: "",
    secondHolderLastName: "",
    secondHolderOccupation: "",
    secondHolderCompanyName: "",
    secondHolderBirthPlace: "",
    secondHolderMotherName: "",
    secondHolderMaritalStatus: "",
    // Relationship & review
    rmId: "" as string | null | "",
    onboardedAt: "",
    anniversaryDate: "",
    lastReviewAt: "", // Last Meeting Date
    nextReviewAt: "", // Next Meeting Date
    reviewFrequency: "",
    // Notes
    notes: "",
  });
  const [nominees, setNominees] = useState<Nominee[]>([]);
  const [typeDetails, setTypeDetails] = useState<ClientTypeDetails>({});
  const [guardianLink, setGuardianLink] = useState<GuardianLink>({ id: null, name: null, riskProfile: null });
  // The family this client joins: what it already owns is not asked again.
  const [family, setFamily] = useState<{ name: string; headName: string | null; headAddress: boolean; reviewFrequency: string | null; becomesHead: boolean } | null>(null);
  useEffect(() => {
    if (!familyId) return;
    let live = true;
    (async () => {
      const fam = await fetch(`/api/families/${familyId}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      if (!fam || !live) return;
      const becomesHead = !fam.primaryInvestorId || ["self", "head", "primary"].includes(familyRole);
      let headName: string | null = null;
      let headAddress = false;
      if (fam.primaryInvestorId && !becomesHead) {
        const h = await fetch(`/api/investors/${fam.primaryInvestorId}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
        headName = h?.investor?.name ?? null;
        const a = h?.investor?.address;
        headAddress = !!a && typeof a === "object" && Object.values(a).some((v) => String(v ?? "").trim());
      }
      if (live) setFamily({ name: fam.familyName ?? fam.headName ?? "the family", headName, headAddress, reviewFrequency: fam.reviewFrequency ?? null, becomesHead });
    })();
    return () => { live = false; };
  }, [familyId, familyRole]);
  const addressFromFamily = !!family && !family.becomesHead && family.headAddress;
  const reviewFromFamily = !!family?.reviewFrequency;
  const kind = clientTypeDef(form.investorCategory).kind;
  const personal = hasPersonalDetails(form.investorCategory);
  const adult = hasAdultDetails(form.investorCategory);
  const singleOnly = singleHoldingOnly(form.investorCategory);
  const [referrals, setReferrals] = useState<Referral[]>([]);
  const [customFields, setCustomFields] = useState<Record<string, any>>({});
  const [cfDefs, setCfDefs] = useState<CustomFieldDef[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function set(k: string, v: string) {
    setForm((s) => ({ ...s, [k]: v }));
  }
  // A new client type brings its own tax status and household type.
  function setType(type: string) {
    setForm((s) => ({
      ...s,
      investorCategory: type,
      taxStatus: taxStatusOptions(type).includes(s.taxStatus) ? s.taxStatus : defaultTaxStatus(type),
      householdType: defaultHouseholdType(type, !!familyId),
    }));
  }
  usePincodeAutofill(form.pincode, (p) => setForm((s) => ({ ...s, city: p.city, state: p.state, country: s.country || "India" })));
  // The firm's own occupation list (Settings → Masters → Occupations).
  const occupations = useMasterLabels("occupation", OCCUPATIONS);
  const u = (v: string) => v.trim() || undefined;

  // Next meeting date = last meeting date + review frequency (auto-derived).
  useEffect(() => {
    const months: Record<string, number> = { monthly: 1, quarterly: 3, half_yearly: 6, annual: 12 };
    const m = months[form.reviewFrequency];
    if (form.lastReviewAt && m) {
      const d = new Date(form.lastReviewAt);
      if (!isNaN(d.getTime())) {
        d.setMonth(d.getMonth() + m);
        const next = d.toISOString().slice(0, 10);
        setForm((s) => (s.nextReviewAt === next ? s : { ...s, nextReviewAt: next }));
      }
    }
  }, [form.lastReviewAt, form.reviewFrequency]);

  // Age is derived from DOB — shown read-only, never stored.
  const age = form.dob ? Math.floor((Date.now() - new Date(form.dob).getTime()) / (365.25 * 864e5)) : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const missCf = missingRequired(cfDefs, customFields);
      if (missCf) { setErr(`${missCf.label} is required.`); return; }
      if (kind === "minor") {
        const turns18 = majorityDate(form.dob);
        if (!turns18) { setErr("A minor needs a date of birth."); return; }
        if (turns18 <= new Date().toISOString().slice(0, 10)) { setErr("This client is 18 or older — choose Individual."); return; }
        if (!typeDetails.guardian?.name?.trim()) { setErr("Add the guardian's name."); return; }
        if (!form.pan.trim() && !typeDetails.guardian?.pan?.trim()) { setErr("Add the minor's PAN or the guardian's PAN."); return; }
      }
      if (kind === "huf" && !typeDetails.karta?.name?.trim()) { setErr("Add the Karta's name."); return; }
      const details = cleanTypeDetails(form.investorCategory, typeDetails);
      const detailsOk = TypeDetailsSchema.safeParse(details);
      if (!detailsOk.success) {
        const at = detailsOk.error.issues[0];
        setErr(`${at?.message ?? "Check the details"}${at?.path?.length ? ` (${at.path.join(" › ")})` : ""}.`);
        return;
      }
      const res = await fetch("/api/investors", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          pan: form.pan.toUpperCase().trim(),
          // Personal fields only for a person; the formation date of an HUF or
          // an entity lives in typeDetails, so a company has no "birthday".
          dob: personal ? u(form.dob) : undefined,
          gender: personal ? form.gender || undefined : undefined,
          birthPlace: personal ? u(form.birthPlace) : undefined,
          motherName: personal ? u(form.motherName) : undefined,
          maritalStatus: adult ? u(form.maritalStatus) : undefined,
          occupation: adult ? u(form.occupation) : undefined,
          incomeRange: u(form.incomeRange),
          employerName: adult ? u(form.employerName) : undefined,
          aadhaarLast4: personal ? u(form.aadhaarLast4) : undefined,
          email: u(form.email),
          emailRelation: u(form.emailRelation),
          phone: u(form.phone),
          mobileRelation: u(form.mobileRelation),
          whatsappPhone: form.whatsappPhone || form.phone || undefined,
          // A family member takes the head's address when mapped in.
          address: addressFromFamily ? undefined : {
            line1: u(form.street),
            city: u(form.city),
            state: u(form.state),
            pincode: u(form.pincode),
            country: u(form.country),
          },
          investorCategory: form.investorCategory,
          typeDetails: details,
          segmentTag: form.segmentTag,
          clientCategory: form.clientCategory || undefined,
          // A minor's risk profile is the guardian's (migration 0234).
          riskProfile: kind === "minor" ? undefined : form.riskProfile || undefined,
          guardianInvestorId: kind === "minor" ? guardianLink.id ?? undefined : undefined,
          householdType: u(form.householdType),
          familyOwnerName: u(form.familyOwnerName),
          referralClientName: u(form.referralClientName),
          modeOfHolding: singleOnly ? "Single" : u(form.modeOfHolding),
          bseUccCode: u(form.bseUccCode),
          uccCodes: cleanUccCodes(form.uccCodes),
          taxStatus: u(form.taxStatus),
          residencyStatus: form.residencyStatus || undefined,
          kycStatus: form.kycStatus || undefined,
          ...(singleOnly ? {} : {
            secondHolderFirstName: u(form.secondHolderFirstName),
            secondHolderLastName: u(form.secondHolderLastName),
            secondHolderOccupation: u(form.secondHolderOccupation),
            secondHolderCompanyName: u(form.secondHolderCompanyName),
            secondHolderBirthPlace: u(form.secondHolderBirthPlace),
            secondHolderMotherName: u(form.secondHolderMotherName),
            secondHolderMaritalStatus: u(form.secondHolderMaritalStatus),
          }),
          rmId: form.rmId || undefined,
          // Only an individual can nominate.
          nominees: (() => {
            if (!canNominate(form.investorCategory)) return undefined;
            const list = nominees.filter((n) => (n.name ?? "").trim());
            return list.length ? list : undefined;
          })(),
          referrals: (() => {
            const list = referrals
              .map((r) => ({
                ...r,
                name: (r.name ?? "").trim(),
                relation: (r.relation ?? "").trim() || undefined,
                mobile: (r.mobile ?? "").trim() || undefined,
                email: (r.email ?? "").trim() || undefined,
                note: (r.note ?? "").trim() || undefined,
              }))
              .filter((r) => r.name);
            return list.length ? list : undefined;
          })(),
          onboardedAt: u(form.onboardedAt),
          anniversaryDate: adult ? u(form.anniversaryDate) : undefined,
          lastReviewAt: u(form.lastReviewAt),
          nextReviewAt: u(form.nextReviewAt),
          reviewFrequency: reviewFromFamily ? undefined : form.reviewFrequency || undefined,
          notes: u(form.notes),
          customFields: Object.keys(customFields).length ? customFields : undefined,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setErr(j.error ?? "Create failed");
        return;
      }
      const j = await res.json();
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

  return (
    <div className="space-y-4 max-w-5xl mx-auto w-full">
<PageHeaderCard title={<>Add client</>} />
{familyId && (
        <div className="rounded-md border border-blue-300 bg-blue-50 text-blue-900 px-4 py-3 text-sm flex items-center gap-2">
          <HeartHandshake className="size-4" />
          <span>
            This client will be added to the selected family
            {familyRole && (
              <>
                {" "}as <strong>{familyRole}</strong>
              </>
            )}
            .
          </span>
        </div>
      )}

      <form onSubmit={submit} className="space-y-4">
        {/* Identity & personal */}
        <Section title={personal ? "Identity & personal" : "Identity"}>
          <SelectField label="Client type" value={form.investorCategory} onChange={setType} options={clientTypeOptions()} />
          <Field label={kind === "huf" ? "HUF name" : kind === "entity" ? "Entity name" : kind === "minor" ? "Minor's full name" : "Full name"} value={form.name} onChange={(v) => set("name", v)} required />
          <Field label={kind === "minor" ? "Minor's PAN (if any)" : "PAN card no"} value={form.pan} onChange={(v) => set("pan", v.toUpperCase())} required={kind !== "minor"} placeholder="ABCDE1234F" />
          {personal && (<>
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-end">
            <Field label="Date of birth" type="date" value={form.dob} onChange={(v) => set("dob", v)} required={kind === "minor"} />
            <div className="text-xs text-muted-foreground pb-2.5 sm:w-20">
              Age: <span className="font-medium text-foreground">{age ?? "—"}</span>
            </div>
          </div>
          <SelectField label="Gender" value={form.gender} onChange={(v) => set("gender", v)} options={[{ value: "", label: "Select" }, { value: "M", label: "Male" }, { value: "F", label: "Female" }, { value: "O", label: "Other" }]} />
          <Field label="Birth place" value={form.birthPlace} onChange={(v) => set("birthPlace", v)} />
          <Field label="Mother's name" value={form.motherName} onChange={(v) => set("motherName", v)} />
          {adult && (<>
          <SelectField label="Marital status" value={form.maritalStatus} onChange={(v) => set("maritalStatus", v)} options={["", ...MARITAL_STATUSES]} />
          <SelectField label="Occupation" value={form.occupation} onChange={(v) => set("occupation", v)} options={["", ...withCurrent(occupations, form.occupation)]} />
          <SelectField label="Income range" value={form.incomeRange} onChange={(v) => set("incomeRange", v)} options={["", ...INCOME_RANGES]} />
          <Field label="Company name" value={form.employerName} onChange={(v) => set("employerName", v)} />
          </>)}
          <Field label="Aadhaar card (last 4)" value={form.aadhaarLast4} onChange={(v) => set("aadhaarLast4", v.replace(/\D/g, "").slice(0, 4))} placeholder="last 4 digits only" />
          </>)}
        </Section>

        <ClientTypeSections
          type={form.investorCategory}
          value={typeDetails}
          onChange={setTypeDetails}
          dob={form.dob}
          nominees={nominees}
          onNomineesChange={setNominees}
          guardianLink={guardianLink}
          onGuardianLinkChange={setGuardianLink}
        />

        {/* Contact */}
        <Section title="Contact">
          <Field label="Email" type="email" value={form.email} onChange={(v) => set("email", v)} />
          <SelectField label="Email belongs to" value={form.emailRelation} onChange={(v) => set("emailRelation", v)} options={["", ...withCurrent(CONTACT_OWNERS, form.emailRelation)]} />
          <Field label="Mobile" value={form.phone} onChange={(v) => set("phone", v)} placeholder="+919XXXXXXXXX" />
          <SelectField label="Mobile belongs to" value={form.mobileRelation} onChange={(v) => set("mobileRelation", v)} options={["", ...withCurrent(CONTACT_OWNERS, form.mobileRelation)]} />
          <Field label="WhatsApp" value={form.whatsappPhone} onChange={(v) => set("whatsappPhone", v)} placeholder="Same as mobile if blank" />
        </Section>

        {/* Mailing address */}
        <Section title="Mailing address" cols={1}>
          {addressFromFamily ? (
            <p className="text-sm text-muted-foreground">
              Same as the family head{family?.headName ? ` (${family.headName})` : ""} — filled in when the client joins the family.
            </p>
          ) : (<>
          <Field label="Mailing street" value={form.street} onChange={(v) => set("street", v)} placeholder="House / building, street, area" />
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <Field label="Pincode" value={form.pincode} onChange={(v) => set("pincode", v.replace(/\D/g, "").slice(0, 6))} placeholder="City and state fill in" />
            <Field label="City" value={form.city} onChange={(v) => set("city", v)} />
            {isIndianAddress(form.country) ? (
              <SelectField label="State" value={canonicalState(form.state) ?? form.state} onChange={(v) => set("state", v)} options={["", ...withCurrent(INDIAN_STATES, canonicalState(form.state) ?? form.state)]} searchable />
            ) : (
              <Field label="State" value={form.state} onChange={(v) => set("state", v)} />
            )}
            <SelectField label="Country" value={canonicalCountry(form.country) ?? form.country} onChange={(v) => set("country", v)} options={["", ...withCurrent(COUNTRIES, canonicalCountry(form.country) ?? form.country)]} searchable />
          </div>
          </>)}
        </Section>

        {/* Classification */}
        <Section title="Classification & compliance">
          <SelectField label="Household type" value={form.householdType} onChange={(v) => set("householdType", v)} options={["", ...HOUSEHOLD_TYPES]} />
          <Field label="Family owner" value={form.familyOwnerName} onChange={(v) => set("familyOwnerName", v)} placeholder="head of family (if part of one)" />
          <SelectField label="Segment" value={form.segmentTag} onChange={(v) => set("segmentTag", v)} options={["HNI", "Affluent", "Retail", "NRI", "Corporate"]} />
          <SelectField label="Client category" value={form.clientCategory} onChange={(v) => set("clientCategory", v)} options={[{ value: "", label: "Select" }, { value: "A", label: "A" }, { value: "B", label: "B" }, { value: "C", label: "C" }, { value: "D", label: "D" }]} />
          <Field label="Referral client name" value={form.referralClientName} onChange={(v) => set("referralClientName", v)} />
          {singleOnly ? (
            <SelectField label="Mode of holding" value="Single" onChange={() => {}} options={["Single"]} />
          ) : (
            <SelectField label="Mode of holding" value={form.modeOfHolding} onChange={(v) => set("modeOfHolding", v)} options={["", "Single", "Joint", "Anyone or Survivor"]} />
          )}
          <Field label="UCC no" value={form.bseUccCode} onChange={(v) => set("bseUccCode", v)} />
          <div className="sm:col-span-2">
            <UccCodesField value={form.uccCodes} onChange={(v) => setForm((p) => ({ ...p, uccCodes: v }))} label="Other UCC codes" />
          </div>
          <SelectField label="Tax status" value={form.taxStatus} onChange={(v) => set("taxStatus", v)} options={["", ...taxStatusOptions(form.investorCategory)]} />
          <SelectField label="Residential status" value={form.residencyStatus} onChange={(v) => set("residencyStatus", v)} options={[{ value: "", label: "Select" }, { value: "indian_resident", label: "Indian resident" }, { value: "nri", label: "NRI" }, { value: "oci", label: "OCI" }, { value: "pio", label: "PIO" }, { value: "foreign_national", label: "Foreign national" }]} />
          <SelectField label="KYC status" value={form.kycStatus} onChange={(v) => set("kycStatus", v)} options={[{ value: "pending", label: "Pending" }, { value: "registered", label: "Registered" }, { value: "verified", label: "Verified" }, { value: "hold", label: "Hold" }, { value: "rejected", label: "Rejected" }, { value: "expired", label: "Expired" }, { value: "re_kyc_required", label: "Re-KYC required" }]} />
          {kind === "minor" ? (
            <div className="block">
              <div className="text-xs font-medium mb-1">Risk profile</div>
              <div className="input-base flex items-center bg-secondary/60 text-muted-foreground">
                {guardianLink.id ? (guardianLink.riskProfile ? `Same as guardian — ${guardianLink.riskProfile.replace(/_/g, " ")}` : "Same as guardian (none yet)") : "Same as the guardian once linked"}
              </div>
            </div>
          ) : (
          <SelectField label="Risk profile" value={form.riskProfile} onChange={(v) => set("riskProfile", v)} options={[{ value: "", label: "Select" }, { value: "conservative", label: "Conservative" }, { value: "moderate", label: "Moderate" }, { value: "aggressive", label: "Aggressive" }, { value: "very_aggressive", label: "Very aggressive" }]} />
          )}
        </Section>

        {/* Second / joint holder — individuals only */}
        {!singleOnly && (
        <Section title="Second / joint holder (optional)">
          <Field label="First name" value={form.secondHolderFirstName} onChange={(v) => set("secondHolderFirstName", v)} />
          <Field label="Last name" value={form.secondHolderLastName} onChange={(v) => set("secondHolderLastName", v)} />
          <SelectField label="Occupation" value={form.secondHolderOccupation} onChange={(v) => set("secondHolderOccupation", v)} options={["", ...withCurrent(occupations, form.secondHolderOccupation)]} />
          <Field label="Company name" value={form.secondHolderCompanyName} onChange={(v) => set("secondHolderCompanyName", v)} />
          <Field label="Birth place" value={form.secondHolderBirthPlace} onChange={(v) => set("secondHolderBirthPlace", v)} />
          <Field label="Mother's name" value={form.secondHolderMotherName} onChange={(v) => set("secondHolderMotherName", v)} />
          <SelectField label="Marital status" value={form.secondHolderMaritalStatus} onChange={(v) => set("secondHolderMaritalStatus", v)} options={["", ...MARITAL_STATUSES]} />
        </Section>
        )}

        {/* Referrals */}
        <Section title="Referrals" cols={1}>
          <ReferralsField value={referrals} onChange={setReferrals} />
        </Section>

        {/* Relationship & review */}
        <Section title="Relationship & review">
          <div className="sm:col-span-2">
            <label className="text-xs font-medium block mb-1">
              Assigned RM
              <span className="ml-1 text-2xs text-muted-foreground font-normal">· optional — defaults to the firm owner</span>
            </label>
            <RmSelector value={form.rmId || null} onChange={(id) => setForm((s) => ({ ...s, rmId: id ?? "" }))} role="rm" placeholder="— Use firm default (owner) —" />
          </div>
          <Field label="Date of onboarding" type="date" value={form.onboardedAt} onChange={(v) => set("onboardedAt", v)} />
          {adult && <Field label="Anniversary date" type="date" value={form.anniversaryDate} onChange={(v) => set("anniversaryDate", v)} />}
          <Field label="Last meeting date" type="date" value={form.lastReviewAt} onChange={(v) => set("lastReviewAt", v)} />
          <Field label="Next meeting date" type="date" future value={form.nextReviewAt} onChange={(v) => set("nextReviewAt", v)} />
          {reviewFromFamily ? (
            <div className="block">
              <div className="text-xs font-medium mb-1">Review frequency</div>
              <div className="input-base flex items-center bg-secondary/60 text-muted-foreground">
                {`From the family — ${({ monthly: "Monthly", quarterly: "Quarterly", half_yearly: "Half-yearly", annual: "Annual" } as Record<string, string>)[family!.reviewFrequency!] ?? family!.reviewFrequency}`}
              </div>
            </div>
          ) : (
          <SelectField label="Review frequency" value={form.reviewFrequency} onChange={(v) => set("reviewFrequency", v)} options={[{ value: "", label: "Select" }, { value: "monthly", label: "Monthly" }, { value: "quarterly", label: "Quarterly" }, { value: "half_yearly", label: "Half-yearly" }, { value: "annual", label: "Annual" }]} />
          )}
        </Section>

        {/* Notes */}
        <Section title="Notes" cols={1}>
          <textarea
            value={form.notes}
            onChange={(e) => set("notes", e.target.value)}
            rows={3}
            className="input-base"
          />
        </Section>

        {/* Firm-defined custom fields (Settings → Custom fields) */}
        <CustomFieldsSection entity="investor" values={customFields} onChange={setCustomFields} onDefsLoaded={setCfDefs} />

        {/* Sticky, so "Create client" is reachable from anywhere in a form that
            is five sections long — it used to sit below the fold with nothing
            to say it was there. The error lives in the same bar as the button
            that triggered it, rather than scrolling away above it. */}
        <FormActions status={err ? <span role="alert" className="text-destructive">{err}</span> : null}>
          <Link href="/dashboard/investors" className={buttonClass("secondary")}>
            Cancel
          </Link>
          <Button type="submit" variant="primary" loading={busy}>
            {busy ? "Creating…" : "Create client"}
          </Button>
        </FormActions>
      </form>
</div>
  );
}

function Section({ title, children, cols = 2 }: { title: string; children: React.ReactNode; cols?: 1 | 2 }) {
  return (
    <div className="border rounded-lg bg-card p-4 sm:p-6 space-y-3">
      <h2 className="section-title">{title}</h2>
      <div className={cols === 1 ? "space-y-3" : "grid grid-cols-1 sm:grid-cols-2 gap-3"}>{children}</div>
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
  future,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  required?: boolean;
  /** A date that may lie ahead (a next meeting); others are capped at today. */
  future?: boolean;
}) {
  const today = new Date().toISOString().slice(0, 10);
  return (
    <label className="block">
      <div className="text-xs font-medium mb-1">
        {label}
        {required && <span className="text-rose-600 ml-0.5">*</span>}
      </div>
      {type === "date" ? (
        <DateField value={value} onChange={(e) => onChange(e.target.value)} max={future ? undefined : today} required={required} className="w-full" />
      ) : (
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          required={required}
          className="input-base"
        />
      )}
    </label>
  );
}

// Themed dropdown — same look as the Assigned-RM picker (shared ui SelectField).
// `options` accepts plain strings or { value, label } pairs.
function SelectField({
  label,
  value,
  onChange,
  options,
  searchable,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<string | { value: string; label: string }>;
  searchable?: boolean;
}) {
  return (
    <label className="block">
      <div className="text-xs font-medium mb-1">{label}</div>
      <UiSelectField value={value} onChange={(e) => onChange(e.target.value)} className="w-full" searchable={searchable}>
        {options.map((o) => {
          const opt = typeof o === "string" ? { value: o, label: o || "Select" } : o;
          return (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          );
        })}
      </UiSelectField>
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
