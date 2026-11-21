/**
 * Investor create / edit form — parity with the web /dashboard/investors/new
 * page and the client master. Same sections, same options, same POST body to
 * /api/investors, same family-linking side effect + redirect.
 *
 * The client master follows the CLIENT TYPE (the firm's request of
 * 2026-10-12, ../investors/client-types.ts): each type sees only its own
 * fields — a minor's guardian, an HUF's Karta and coparceners, an entity's
 * incorporation, signatories and beneficial owners, an NRI's overseas
 * details, a proprietor's business name — and only individuals nominate.
 * Those details travel as `typeDetails`; the server keeps only what the type
 * uses. Removed from the master at the firm's request (2026-10-13): CKYC
 * expiry, FATCA expiry and Service tier — do not put them back.
 *
 * Address: a complete Indian pincode fills a BLANK city, state and country
 * (../investors/pincode.ts, the CRM's rule of 2026-11-14) — never a typed
 * value; a typed state that disagrees stays, with a "Use <state>" switch. The
 * pincode already on file when the edit form opens is not looked up. State
 * and country pick from the CRM's lists (../investors/places.ts).
 *
 * What the family owns is not asked again (CLAUDE.md "Creating a family"):
 * the client page passes famReview / famMember / famName to the edit form, so
 * a family's review frequency shows read-only and is never sent, and a
 * member's address says it follows the head's.
 */

import type { FormSpec, FormValues } from "./types";
import {
  clientTypeOptions, clientKind, canNominate, singleHoldingOnly, hasPersonalDetails, hasAdultDetails,
  majorityDate, isPan, ownPan, taxStatusOptions, defaultTaxStatus, withCurrent,
  MARITAL_STATUSES, HOUSEHOLD_TYPES, CONTACT_OWNERS, NOMINEE_RELATIONS, COPARCENER_RELATIONS, SIGNATORY_DESIGNATIONS,
  BUSINESS_NATURES, GUARDIAN_RELATIONS, FATCA_ENTITY_CLASSES, NRI_ACCOUNT_TYPES,
} from "../investors/client-types";
import { INDIAN_STATES, COUNTRIES, canonicalState, isIndianAddress } from "../investors/places";
import { pincodeFillFor, pincodeHint, shouldLookUpPincode } from "../investors/pincode";
import { fmtDate } from "../../lib/format";
import { clientPickerLine } from "../investors/picker";
import { PanExistsNotice } from "../investors/PanExistsNotice";

const u = (v: string) => (v?.trim() ? v.trim() : undefined);
const num = (v: string) => {
  const n = parseFloat(String(v));
  return isNaN(n) ? undefined : n;
};
const upper = (v: string) => v.toUpperCase();
const optPan = (v?: string) => (v?.trim() ? v.trim().toUpperCase() : undefined);
/** Today in India (YYYY-MM-DD) — a UTC date reads yesterday until 05:30 IST. */
const today = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The CRM's lists (lib/investors/client-types.ts) the app's copy lacks. */
const INCOME_RANGES = ["Below ₹5L", "₹5L – ₹15L", "₹15L – ₹50L", "₹50L – ₹1Cr", "₹1Cr – ₹5Cr", "Above ₹5Cr"];
const OCCUPATIONS = ["Salaried", "Self-Employed", "Business Owner", "Professional (Doctor/CA/Lawyer)", "Retired", "Homemaker", "Student", "Other"];
/** Household type from the client type and whether the client joins a family (web defaultHouseholdType). */
function defaultHouseholdType(type: string, inFamily: boolean): string {
  const kind = clientKind(type);
  if (kind === "huf") return "HUF";
  if (kind === "entity") return "Company";
  return inFamily ? "Family" : "Individual";
}
const REVIEW_LABEL: Record<string, string> = { monthly: "Monthly", quarterly: "Quarterly", half_yearly: "Half-yearly", annual: "Annual" };
const addrOf = (v: FormValues) => ({ pincode: String(v.pincode ?? ""), city: String(v.city ?? ""), state: String(v.state ?? ""), country: String(v.country ?? "") });
/** A pincode that should be looked up now: typed (not the one on file at open), complete, Indian. */
const pinToFill = (v: FormValues) => {
  const pin = String(v.pincode ?? "").trim();
  return pin && pin !== v._pinWas && pin !== v._pinDone && shouldLookUpPincode(pin, String(v.country ?? "")) ? pin : "";
};

const kindIs = (k: string) => (v: FormValues) => clientKind(v.investorCategory) === k;
const typeIs = (t: string) => (v: FormValues) => v.investorCategory === t;
const personal = (v: FormValues) => hasPersonalDetails(v.investorCategory);
const adult = (v: FormValues) => hasAdultDetails(v.investorCategory);
/** A list of rows with the unnamed ones dropped, or undefined when none is left. */
function named<T extends { name: string }>(xs: any[] | undefined, map: (x: any) => T): T[] | undefined {
  const out = (xs ?? []).map(map).filter((x) => x.name);
  return out.length ? out : undefined;
}

/** The type's own details (web TypeDetailsSchema); the server keeps only what the type uses. */
function typeDetailsOf(f: FormValues) {
  return {
    guardian: { name: u(f.gName), pan: optPan(f.gPan), relation: f.gRelation || undefined, dob: u(f.gDob), mobile: u(f.gMobile), email: u(f.gEmail) },
    karta: { name: u(f.kName), pan: optPan(f.kPan), dob: u(f.kDob), mobile: u(f.kMobile), email: u(f.kEmail) },
    coparceners: named(f.coparceners, (c) => ({ name: (c.name ?? "").trim(), relation: u(c.relation), dob: u(c.dob) })),
    entity: {
      formedOn: u(f.eFormedOn), registrationNo: u(f.eRegNo), placeOfIncorporation: u(f.ePlace), natureOfBusiness: u(f.eNature),
      netWorth: num(f.eNetWorth), netWorthAsOn: u(f.eNetWorthAsOn), fatcaClass: f.eFatcaClass || undefined, giin: u(f.eGiin),
    },
    signatories: named(f.signatories, (s) => ({ name: (s.name ?? "").trim(), pan: optPan(s.pan), designation: u(s.designation), mobile: u(s.mobile), email: u(s.email) })),
    ubos: named(f.ubos, (o) => ({ name: (o.name ?? "").trim(), pan: optPan(o.pan), holdingPct: num(o.holdingPct) })),
    nri: { countryOfResidence: u(f.nCountry), overseasAddress: u(f.nOverseasAddress), taxResidencyCountry: u(f.nTaxCountry), foreignTin: u(f.nForeignTin), accountType: f.nAccountType || undefined },
    businessName: u(f.businessName),
    nominationOptOut: canNominate(f.investorCategory) && f.nominationOptOut ? true : undefined,
  };
}

const TYPE_DETAIL_BLANKS = {
  gName: "", gPan: "", gRelation: "", gDob: "", gMobile: "", gEmail: "", guardianInvestorId: "",
  kName: "", kPan: "", kDob: "", kMobile: "", kEmail: "", coparceners: [],
  eFormedOn: "", eRegNo: "", ePlace: "", eNature: "", eNetWorth: "", eNetWorthAsOn: "", eFatcaClass: "", eGiin: "",
  signatories: [], ubos: [],
  nCountry: "", nOverseasAddress: "", nTaxCountry: "", nForeignTin: "", nAccountType: "",
  businessName: "", nominationOptOut: false,
};

const RISK_OPTIONS = [{ value: "", label: "Not assessed" }, { value: "conservative", label: "Conservative" }, { value: "moderate", label: "Moderate" }, { value: "aggressive", label: "Aggressive" }, { value: "very_aggressive", label: "Very aggressive" }];

export const investorForm: FormSpec = {
  title: "Add investor",
  endpoint: "/api/investors",
  submitLabel: "Create investor",
  invalidate: ["investors", "investor-kpis"],
  // A PAN already in the CRM is never a second client: offer Reactivate / Open (create only).
  notice: PanExistsNotice,

  // ?type=minor (etc.) opens the form ready for that client type, as on the web.
  initial: (params) => {
    const type = clientTypeOptions().some((o) => o.value === params.type) ? params.type! : "individual";
    return {
      name: "",
      pan: "",
      dob: "",
      gender: "",
      birthPlace: "",
      motherName: "",
      maritalStatus: "",
      occupation: "",
      incomeRange: "",
      employerName: "",
      aadhaarLast4: "",
      email: "",
      emailRelation: "",
      phone: "",
      mobileRelation: "",
      whatsappPhone: "",
      street: "",
      city: "",
      state: "",
      pincode: "",
      country: "India",
      householdType: defaultHouseholdType(type, !!params.familyId),
      familyOwnerName: "",
      investorCategory: type,
      _taxType: type,
      segmentTag: "Retail",
      clientCategory: "",
      referralClientName: "",
      modeOfHolding: singleHoldingOnly(type) ? "Single" : "",
      bseUccCode: "",
      taxStatus: defaultTaxStatus(type),
      residencyStatus: "",
      kycStatus: "pending",
      secondHolderFirstName: "",
      secondHolderLastName: "",
      secondHolderOccupation: "",
      secondHolderCompanyName: "",
      secondHolderBirthPlace: "",
      secondHolderMotherName: "",
      secondHolderMaritalStatus: "",
      nominees: [],
      referrals: [],
      rmId: "",
      onboardedAt: "",
      anniversaryDate: "",
      lastReviewAt: "",
      nextReviewAt: "",
      reviewFrequency: "",
      notes: "",
      ...TYPE_DETAIL_BLANKS,
      dateOfDemise: "",
      _pinWas: "", _pinDone: "", _pinState: "", _useState: false,
      _famMember: "", _famReview: "", _famName: "",
      // Edit-only fields (hidden in create via section visibleIf on `_edit`).
      _edit: "",
      _panLocked: "",
      alternatePhone: "",
      status: "",
      riskProfile: "",
      mandateStatus: "",
      mandateRefNo: "",
      nseCanCode: "",
      nameAsPerPan: "",
      panAadhaarLinkStatus: "",
      ckycNumber: "",
      kycValidatedAt: "",
      bankAccounts: [],
      _familyId: params.familyId ?? "",
    };
  },

  derive: (v) => {
    const out: Partial<FormValues> = {};
    // Next meeting date = last meeting date + review frequency (auto-derived).
    const months: Record<string, number> = { monthly: 1, quarterly: 3, half_yearly: 6, annual: 12 };
    // Only when the last date or the frequency changes (the web's effect deps),
    // so a next date picked by hand survives every other keystroke. Calendar
    // arithmetic in UTC: a local-midnight date printed with toISOString() is
    // the previous day in India.
    const m = months[v.reviewFrequency];
    const revKey = `${v.lastReviewAt ?? ""}|${v.reviewFrequency ?? ""}`;
    if (revKey !== v._revKey) {
      out._revKey = revKey;
      const d = new Date(`${String(v.lastReviewAt ?? "").slice(0, 10)}T00:00:00Z`);
      if (v.lastReviewAt && m && !isNaN(d.getTime())) {
        d.setUTCMonth(d.getUTCMonth() + m);
        const next = d.toISOString().slice(0, 10);
        if (v.nextReviewAt !== next) out.nextReviewAt = next;
      }
    }
    // A type change re-defaults a tax status that does not fit the new type
    // (one already on file stays until the type changes), and a type that
    // cannot hold jointly holds singly.
    if (v.investorCategory !== v._taxType) {
      out._taxType = v.investorCategory;
      if (!taxStatusOptions(v.investorCategory).includes(v.taxStatus)) out.taxStatus = defaultTaxStatus(v.investorCategory);
      if (singleHoldingOnly(v.investorCategory)) out.modeOfHolding = "Single";
      // A new client type brings its own household type (Add client, as the web).
      if (!v._edit) out.householdType = defaultHouseholdType(v.investorCategory, !!v._familyId);
    }
    // Pincode -> blank city / state / country. Moving off the pincode on file
    // forgets it, so typing it back looks it up (the web's usePincodeAutofill).
    const pinNow = String(v.pincode ?? "").trim();
    if (v._pinWas && pinNow !== v._pinWas) out._pinWas = "";
    if (v._pinDone && pinNow !== v._pinDone) { out._pinDone = ""; out._pinState = ""; }
    const cur = { ...v, ...out };
    if (pinToFill(cur)) {
      const f = pincodeFillFor(addrOf(cur));
      if (f) Object.assign(out, f.set, { _pinDone: pinNow, _pinState: f.stateMismatch ?? "" });
    }
    if (v._useState && v._pinState) Object.assign(out, { state: v._pinState, _pinState: "", _useState: false });
    else if (v._useState) out._useState = false;
    return Object.keys(out).length ? out : null;
  },

  // `derive` starts the pincode lookup but can only fill on the NEXT change;
  // watch for the answer and re-run derive when it lands (blanks only — derive's
  // own rule), so city / state appear at once. pincodeHint reads the cache
  // without asking again, so a failed lookup is not retried in a loop.
  effect: (v, { rederive }) => {
    if (!pinToFill(v)) return;
    const addr = addrOf(v);
    if (pincodeHint(addr)) return;
    let tries = 0;
    const timer = setInterval(() => {
      if (pincodeHint(addr) || ++tries >= 40) { clearInterval(timer); rederive(); }
    }, 250);
    return () => clearInterval(timer);
  },

  validate: (v) => {
    const e: Record<string, string> = {};
    const kind = clientKind(v.investorCategory);
    const pan = (v.pan ?? "").trim();
    if (!v.name?.trim()) e.name = "Full name is required";
    if (pan && !isPan(pan)) e.pan = "PAN should look like ABCDE1234F";
    else if (!pan && kind !== "minor" && !v._panLocked) e.pan = "PAN card no is required";
    if (kind === "minor") {
      const turns18 = majorityDate(v.dob);
      if (!turns18) e.dob = "A minor needs a date of birth";
      else if (turns18 <= today()) e.dob = "This client is 18 or older — choose Individual";
      if (!v.gName?.trim()) e.gName = "Add the guardian's name";
      if (!pan && !v.gPan?.trim() && !v._panLocked) e.pan = "Add the minor's PAN or the guardian's PAN";
    }
    if (kind === "huf" && !v.kName?.trim()) e.kName = "Add the Karta's name";
    for (const k of ["gPan", "kPan"]) if (v[k]?.trim() && !isPan(v[k].trim().toUpperCase())) e[k] = "PAN should look like ABCDE1234F";
    // What the server's schema would refuse with a bare "invalid body".
    if (v.name?.trim() && v.name.trim().length < 2) e.name = "Enter the full name";
    if (v.email?.trim() && !EMAIL.test(v.email.trim())) e.email = "Enter a valid email";
    if (v.aadhaarLast4?.trim() && !/^\d{4}$/.test(v.aadhaarLast4.trim())) e.aadhaarLast4 = "Only the last 4 digits";
    const badRowPan = (rows: any[] | undefined) => (rows ?? []).some((r) => r?.name?.trim() && r?.pan?.trim() && !isPan(r.pan.trim().toUpperCase()));
    if (kind === "entity" && badRowPan(v.signatories)) e.signatories = "A signatory's PAN should look like ABCDE1234F";
    if (kind === "entity" && badRowPan(v.ubos)) e.ubos = "A beneficial owner's PAN should look like ABCDE1234F";
    if (kind === "entity" && (v.ubos ?? []).some((o: any) => o?.holdingPct !== "" && o?.holdingPct != null && !(Number(o.holdingPct) >= 0 && Number(o.holdingPct) <= 100))) e.ubos = "Holding % must be between 0 and 100";
    if (canNominate(v.investorCategory) && !v.nominationOptOut) {
      const shares = (v.nominees ?? []).filter((n: any) => n?.name?.trim() && n?.sharePct !== "" && n?.sharePct != null).map((n: any) => Number(n.sharePct));
      if (shares.some((x: number) => !(x >= 0 && x <= 100))) e.nominees = "A nominee's share must be between 0% and 100%";
      else if (shares.reduce((a: number, b: number) => a + b, 0) > 100) e.nominees = "The nominees' shares add up to more than 100%";
    }
    if (v.dateOfDemise && v.dateOfDemise > today()) e.dateOfDemise = "The date of death can't be in the future";
    return Object.keys(e).length ? e : null;
  },

  sections: [
    {
      title: "Identity & personal",
      fields: [
        { key: "investorCategory", label: "Client type", type: "select", required: true, options: (v) => clientTypeOptions(v.investorCategory) },
        { key: "name", label: "Full name", required: true },
        // A minor filed under the guardian's PAN has no PAN of their own to edit.
        { key: "pan", label: "PAN card no", placeholder: "ABCDE1234F", autoCapitalize: "characters", transform: upper, visibleIf: (v) => !(v._panLocked && kindIs("minor")(v)) },
        { key: "dob", label: "Date of birth", type: "date", maxToday: true, visibleIf: personal },
        { key: "_turns18", label: "Turns 18 on", type: "readonly", visibleIf: kindIs("minor"), format: (_x, f) => (majorityDate(f.dob) ? fmtDate(majorityDate(f.dob)) : "—") },
        { key: "gender", label: "Gender", type: "select", visibleIf: personal, options: [{ value: "", label: "Select" }, { value: "M", label: "Male" }, { value: "F", label: "Female" }, { value: "O", label: "Other" }] },
        { key: "birthPlace", label: "Birth place", visibleIf: personal },
        { key: "motherName", label: "Mother's name", visibleIf: personal },
        { key: "maritalStatus", label: "Marital status", type: "select", visibleIf: adult, options: (v) => withCurrent(MARITAL_STATUSES, v.maritalStatus) },
        { key: "occupation", label: "Occupation", type: "select", visibleIf: adult, options: (v) => withCurrent(OCCUPATIONS, v.occupation) },
        { key: "incomeRange", label: "Income range", type: "select", visibleIf: adult, options: (v) => withCurrent(INCOME_RANGES, v.incomeRange) },
        { key: "employerName", label: "Company name", visibleIf: adult },
        { key: "aadhaarLast4", label: "Aadhaar card (last 4)", keyboard: "number-pad" as any, placeholder: "last 4 digits only", visibleIf: personal, transform: (v) => v.replace(/\D/g, "").slice(0, 4) },
        { key: "businessName", label: "Business name", visibleIf: typeIs("sole_proprietor") },
      ],
    },
    {
      title: "Guardian",
      visibleIf: kindIs("minor"),
      fields: [
        { key: "gName", label: "Guardian's name", required: true },
        { key: "gPan", label: "Guardian's PAN", autoCapitalize: "characters", transform: upper, placeholder: "ABCDE1234F" },
        { key: "gRelation", label: "Relationship", type: "select", options: [{ value: "", label: "Select" }, ...GUARDIAN_RELATIONS] },
        { key: "gDob", label: "Guardian's date of birth", type: "date", maxToday: true },
        { key: "gMobile", label: "Guardian's mobile", type: "tel" },
        { key: "gEmail", label: "Guardian's email", type: "email" },
        {
          key: "guardianInvestorId", label: "Guardian's client record", type: "typeahead", searchEndpoint: "/api/search", searchEnvelope: "investors",
          searchLabel: (i) => i.name, searchSublabel: clientPickerLine,
          placeholder: "Search the guardian's client record…",
          help: "The minor's risk profile is the guardian's. Left blank, the guardian is found by the PAN above.",
        },
      ],
    },
    {
      title: "Karta & coparceners",
      visibleIf: kindIs("huf"),
      fields: [
        { key: "eFormedOn", label: "Date the HUF was formed", type: "date", maxToday: true },
        { key: "kName", label: "Karta's name", required: true },
        { key: "kPan", label: "Karta's PAN", autoCapitalize: "characters", transform: upper, placeholder: "ABCDE1234F" },
        { key: "kDob", label: "Karta's date of birth", type: "date", maxToday: true },
        { key: "kMobile", label: "Karta's mobile", type: "tel" },
        { key: "kEmail", label: "Karta's email", type: "email" },
        {
          key: "coparceners", label: "Coparceners", type: "repeater", addLabel: "Add coparcener",
          itemTitle: (c, i) => c.name?.trim() || `Coparcener ${i + 1}`,
          itemFields: [
            { key: "name", label: "Name" },
            { key: "relation", label: "Relation to the Karta", type: "select", options: (r) => withCurrent(COPARCENER_RELATIONS, r.relation) },
            { key: "dob", label: "Date of birth", type: "date", maxToday: true },
          ],
        },
      ],
    },
    {
      title: "Entity",
      visibleIf: kindIs("entity"),
      fields: [
        { key: "eFormedOn", label: "Date of incorporation / registration", type: "date", maxToday: true },
        { key: "eRegNo", label: "Registration no. (CIN / LLPIN / …)", autoCapitalize: "characters" },
        { key: "ePlace", label: "Place of incorporation" },
        { key: "eNature", label: "Nature of business", type: "select", options: (v) => withCurrent(BUSINESS_NATURES, v.eNature) },
        { key: "eNetWorth", label: "Net worth (₹)", type: "number" },
        { key: "eNetWorthAsOn", label: "Net worth as on", type: "date", maxToday: true },
        { key: "eFatcaClass", label: "FATCA / CRS classification", type: "select", options: [{ value: "", label: "Select" }, ...FATCA_ENTITY_CLASSES] },
        { key: "eGiin", label: "GIIN", autoCapitalize: "characters", visibleIf: (v) => v.eFatcaClass === "financial_institution" },
        {
          key: "signatories", label: "Authorised signatories", type: "repeater", addLabel: "Add signatory",
          itemTitle: (s, i) => s.name?.trim() || `Signatory ${i + 1}`,
          itemFields: [
            { key: "name", label: "Name" },
            { key: "designation", label: "Designation", type: "select", options: (r) => withCurrent(SIGNATORY_DESIGNATIONS, r.designation) },
            { key: "pan", label: "PAN", autoCapitalize: "characters", transform: upper },
            { key: "mobile", label: "Mobile", type: "tel" },
            { key: "email", label: "Email", type: "email" },
          ],
        },
        {
          key: "ubos", label: "Beneficial owners", type: "repeater", addLabel: "Add beneficial owner",
          itemTitle: (o, i) => o.name?.trim() || `Owner ${i + 1}`,
          itemFields: [
            { key: "name", label: "Name" },
            { key: "pan", label: "PAN", autoCapitalize: "characters", transform: upper },
            { key: "holdingPct", label: "Holding %", type: "number" },
          ],
        },
      ],
    },
    {
      title: "Overseas details",
      visibleIf: typeIs("nri"),
      fields: [
        { key: "nCountry", label: "Country of residence" },
        { key: "nOverseasAddress", label: "Overseas address", type: "textarea" },
        { key: "nTaxCountry", label: "Tax residency country" },
        { key: "nForeignTin", label: "Foreign TIN" },
        { key: "nAccountType", label: "Invests from", type: "select", options: [{ value: "", label: "Select" }, ...NRI_ACCOUNT_TYPES] },
      ],
    },
    {
      title: "Contact",
      fields: [
        { key: "email", label: "Email", type: "email" },
        { key: "emailRelation", label: "Email belongs to", type: "select", options: (v) => withCurrent(CONTACT_OWNERS, v.emailRelation) },
        { key: "phone", label: "Mobile", type: "tel", placeholder: "+919XXXXXXXXX" },
        { key: "mobileRelation", label: "Mobile belongs to", type: "select", options: (v) => withCurrent(CONTACT_OWNERS, v.mobileRelation) },
        { key: "whatsappPhone", label: "WhatsApp", type: "tel", placeholder: "Same as mobile if blank" },
      ],
    },
    {
      title: "Mailing address",
      fields: [
        {
          key: "_addrFamily", label: "From the family", type: "readonly", visibleIf: (v) => !!v._famMember,
          format: (_x, f) => `${f._famName || "This family"}: a member's address is the head's, and the CRM keeps it in step. A change here is kept only while the head has no address.`,
        },
        { key: "street", label: "Mailing street", placeholder: "House / building, street, area" },
        { key: "pincode", label: "Pincode", keyboard: "number-pad" as any, transform: (x) => x.replace(/\D/g, "").slice(0, 6), help: "A complete pincode fills a blank city and state." },
        { key: "_pinHint", label: "Pincode", type: "readonly", visibleIf: (v) => !!pincodeHint(addrOf(v)) && String(v.pincode ?? "").trim() !== v._pinWas, format: (_x, f) => pincodeHint(addrOf(f)) },
        { key: "_useState", label: "Use the pincode's state", type: "switch", visibleIf: (v) => !!v._pinState && (canonicalState(v.state) ?? v.state) !== v._pinState, help: "The state typed stays unless you switch this on." },
        { key: "city", label: "City" },
        // A dropdown for an Indian address (the CRM's list, a value on file kept); free text abroad.
        { key: "state", label: "State", type: "select", visibleIf: (v) => isIndianAddress(v.country), options: (v) => withCurrent(INDIAN_STATES, v.state) },
        { key: "state", label: "State / region", visibleIf: (v) => !isIndianAddress(v.country) },
        { key: "country", label: "Country", type: "select", options: (v) => withCurrent(COUNTRIES, v.country) },
      ],
    },
    {
      title: "Classification & compliance",
      fields: [
        { key: "householdType", label: "Household type", type: "select", options: (v) => withCurrent(HOUSEHOLD_TYPES, v.householdType) },
        { key: "familyOwnerName", label: "Family owner", placeholder: "head of family (if part of one)" },
        { key: "segmentTag", label: "Segment", type: "select", options: ["HNI", "Affluent", "Retail", "NRI", "Corporate"] },
        { key: "clientCategory", label: "Client category", type: "select", options: [{ value: "", label: "Select" }, { value: "A", label: "A" }, { value: "B", label: "B" }, { value: "C", label: "C" }, { value: "D", label: "D" }] },
        { key: "referralClientName", label: "Referral client name" },
        { key: "modeOfHolding", label: "Mode of holding", type: "select", visibleIf: (v) => !singleHoldingOnly(v.investorCategory), options: ["", "Single", "Joint", "Anyone or Survivor"] },
        { key: "bseUccCode", label: "UCC no" },
        { key: "taxStatus", label: "Tax status", type: "select", options: (v) => withCurrent(taxStatusOptions(v.investorCategory), v.taxStatus) },
        { key: "residencyStatus", label: "Residential status", type: "select", options: [{ value: "", label: "Select" }, { value: "indian_resident", label: "Indian resident" }, { value: "nri", label: "NRI" }, { value: "oci", label: "OCI" }, { value: "pio", label: "PIO" }, { value: "foreign_national", label: "Foreign national" }] },
        { key: "kycStatus", label: "KYC status", type: "select", options: [{ value: "pending", label: "Pending" }, { value: "registered", label: "Registered" }, { value: "verified", label: "Verified" }, { value: "hold", label: "Hold" }, { value: "rejected", label: "Rejected" }, { value: "expired", label: "Expired" }, { value: "re_kyc_required", label: "Re-KYC required" }] },
        // A minor's risk profile IS the guardian's (kept equal by the database) — never sent for a minor.
        { key: "riskProfile", label: "Risk profile", type: "select", visibleIf: (v) => !kindIs("minor")(v), options: RISK_OPTIONS },
        { key: "_minorRisk", label: "Risk profile", type: "readonly", visibleIf: kindIs("minor"), format: () => "Same as the guardian" },
      ],
    },
    {
      title: "Second / joint holder (optional)",
      visibleIf: (v) => !singleHoldingOnly(v.investorCategory),
      fields: [
        { key: "secondHolderFirstName", label: "First name" },
        { key: "secondHolderLastName", label: "Last name" },
        { key: "secondHolderOccupation", label: "Occupation", type: "select", options: (v) => withCurrent(OCCUPATIONS, v.secondHolderOccupation) },
        { key: "secondHolderCompanyName", label: "Company name" },
        { key: "secondHolderBirthPlace", label: "Birth place" },
        { key: "secondHolderMotherName", label: "Mother's name" },
        { key: "secondHolderMaritalStatus", label: "Marital status", type: "select", options: (v) => withCurrent(MARITAL_STATUSES, v.secondHolderMaritalStatus) },
      ],
    },
    {
      // Only an individual nominates (SEBI) — or records that they chose not to.
      title: "Nomination",
      visibleIf: (v) => canNominate(v.investorCategory),
      fields: [
        { key: "nominationOptOut", label: "Client chose not to nominate", type: "switch" },
        {
          key: "nominees",
          label: "Nominees",
          type: "repeater",
          addLabel: "Add nominee",
          visibleIf: (v) => !v.nominationOptOut,
          itemTitle: (n, i) => n.name?.trim() || `Nominee ${i + 1}`,
          itemFields: [
            { key: "name", label: "Name" },
            { key: "relation", label: "Relation", type: "select", options: (r) => withCurrent(NOMINEE_RELATIONS, r.relation) },
            { key: "dob", label: "Date of birth", type: "date", maxToday: true },
            { key: "mobile", label: "Mobile", type: "tel" },
            { key: "pan", label: "PAN", autoCapitalize: "characters", transform: upper },
            { key: "sharePct", label: "Share %", type: "number" },
          ],
        },
      ],
    },
    {
      title: "Referrals",
      fields: [
        {
          key: "referrals",
          label: "Referrals",
          type: "repeater",
          addLabel: "Add referral",
          itemTitle: (r, i) => r.name?.trim() || `Referral ${i + 1}`,
          itemFields: [
            { key: "name", label: "Name" },
            { key: "relation", label: "Relation", placeholder: "Friend / Family / Colleague" },
            { key: "mobile", label: "Mobile", type: "tel" },
            { key: "email", label: "Email", type: "email" },
            { key: "note", label: "Note", type: "textarea" },
          ],
        },
      ],
    },
    {
      title: "Relationship & review",
      fields: [
        {
          key: "rmId",
          label: "Assigned RM",
          type: "lookup",
          lookupEndpoint: "/api/employees?role=rm",
          lookupEnvelope: "rows",
          lookupLabel: (e) => e.name + (Array.isArray(e.roles) && e.roles.length ? ` · ${e.roles[0]}` : ""),
          placeholder: "— Use firm default (owner) —",
          clearable: true,
          help: "optional — defaults to the firm owner",
        },
        { key: "onboardedAt", label: "Date of onboarding", type: "date", maxToday: true },
        { key: "anniversaryDate", label: "Anniversary date", type: "date", maxToday: true, visibleIf: adult },
        { key: "lastReviewAt", label: "Last meeting date", type: "date", maxToday: true },
        { key: "nextReviewAt", label: "Next meeting date", type: "date" },
        { key: "reviewFrequency", label: "Review frequency", type: "select", visibleIf: (v) => !v._famReview, options: [{ value: "", label: "Select" }, { value: "monthly", label: "Monthly" }, { value: "quarterly", label: "Quarterly" }, { value: "half_yearly", label: "Half-yearly" }, { value: "annual", label: "Annual" }] },
        { key: "_reviewFamily", label: "Review frequency", type: "readonly", visibleIf: (v) => !!v._famReview, format: (_x, f) => `From the family — ${REVIEW_LABEL[f._famReview] ?? f._famReview}` },
        { key: "dateOfDemise", label: "Date of death (demise)", type: "date", maxToday: true, help: "Recording it makes the client Inactive: live SIPs are stopped and pending orders cancelled." },
      ],
    },
    {
      // Edit-only — mirrors the web MasterRecordEditor's status / risk block.
      title: "Status & lifecycle",
      visibleIf: (v) => v._edit === "1",
      fields: [
        { key: "status", label: "Client status", type: "select", help: "Inactive stops all live SIPs and cancels pending orders.", options: [{ value: "active", label: "Active" }, { value: "dormant", label: "Dormant" }, { value: "inactive", label: "Inactive" }, { value: "redemption_risk", label: "Redemption risk" }, { value: "closed", label: "Closed" }, { value: "exited", label: "Exited" }] },
        { key: "alternatePhone", label: "Alternate mobile", type: "tel" },
        { key: "mandateStatus", label: "Mandate status", type: "select", options: [{ value: "", label: "—" }, { value: "none", label: "None" }, { value: "pending", label: "Pending" }, { value: "active", label: "Active" }, { value: "expired", label: "Expired" }, { value: "rejected", label: "Rejected" }, { value: "cancelled", label: "Cancelled" }] },
        { key: "mandateRefNo", label: "Mandate ref no" },
        { key: "nseCanCode", label: "NSE CAN" },
      ],
    },
    {
      // Edit-only — KYC tracker fields.
      title: "KYC tracker",
      visibleIf: (v) => v._edit === "1",
      fields: [
        { key: "nameAsPerPan", label: "Name as per PAN" },
        { key: "panAadhaarLinkStatus", label: "PAN–Aadhaar link", type: "select", visibleIf: adult, options: [{ value: "", label: "—" }, { value: "linked", label: "Linked" }, { value: "not_linked", label: "Not linked" }, { value: "pending", label: "Pending" }, { value: "not_applicable", label: "Not applicable" }] },
        { key: "ckycNumber", label: "CKYC number" },
        { key: "kycValidatedAt", label: "KYC validated on", type: "date", maxToday: true },
      ],
    },
    {
      // Edit-only — multi bank accounts (create form has none).
      title: "Bank accounts",
      visibleIf: (v) => v._edit === "1",
      fields: [
        {
          key: "bankAccounts",
          label: "Bank accounts",
          type: "repeater",
          addLabel: "Add bank account",
          itemTitle: (b, i) => b.bankName?.trim() || `Bank ${i + 1}`,
          itemFields: [
            { key: "bankName", label: "Bank name" },
            { key: "accountMasked", label: "Account number" },
            { key: "ifsc", label: "IFSC", autoCapitalize: "characters", transform: upper },
          ],
        },
      ],
    },
    {
      title: "Notes",
      fields: [{ key: "notes", label: "Notes", type: "textarea" }],
    },
  ],

  buildBody: (form) => {
    const type = form.investorCategory;
    const isPersonal = hasPersonalDetails(type);
    const isAdult = hasAdultDetails(type);
    const minor = clientKind(type) === "minor";
    const joint = !singleHoldingOnly(type);
    // The pincode's answer, if it came in after the last change: blanks only.
    const pinFill: { city?: string; state?: string; country?: string } = pinToFill(form) ? pincodeFillFor(addrOf(form))?.set ?? {} : {};
    const banks = ((form.bankAccounts as any[]) ?? [])
      .map((b) => ({ bankName: (b.bankName ?? "").trim(), accountMasked: u(b.accountMasked), ifsc: optPan(b.ifsc) }))
      .filter((b) => b.bankName);
    return {
      name: form.name,
      // Blank on an edit leaves the stored PAN (or the registrar's key) alone.
      pan: form.pan.toUpperCase().trim() || undefined,
      // Personal fields only for a person; an HUF's or entity's formation date
      // lives in typeDetails, so a company has no "birthday".
      dob: isPersonal ? u(form.dob) : undefined,
      gender: isPersonal ? form.gender || undefined : undefined,
      birthPlace: isPersonal ? u(form.birthPlace) : undefined,
      motherName: isPersonal ? u(form.motherName) : undefined,
      maritalStatus: isAdult ? u(form.maritalStatus) : undefined,
      occupation: isAdult ? u(form.occupation) : undefined,
      incomeRange: isAdult ? u(form.incomeRange) : undefined,
      employerName: isAdult ? u(form.employerName) : undefined,
      aadhaarLast4: isPersonal ? u(form.aadhaarLast4) : undefined,
      email: u(form.email),
      emailRelation: u(form.emailRelation),
      phone: u(form.phone),
      mobileRelation: u(form.mobileRelation),
      whatsappPhone: form.whatsappPhone || form.phone || undefined,
      address: {
        line1: u(form.street),
        city: u(pinFill.city ?? form.city),
        state: u(pinFill.state ?? form.state),
        pincode: u(form.pincode),
        country: u(pinFill.country ?? form.country),
      },
      investorCategory: type,
      typeDetails: typeDetailsOf(form),
      guardianInvestorId: minor && form.guardianInvestorId ? form.guardianInvestorId : undefined,
      segmentTag: form.segmentTag,
      clientCategory: form.clientCategory || undefined,
      householdType: u(form.householdType),
      familyOwnerName: u(form.familyOwnerName),
      referralClientName: u(form.referralClientName),
      modeOfHolding: joint ? u(form.modeOfHolding) : "Single",
      bseUccCode: u(form.bseUccCode),
      taxStatus: u(form.taxStatus),
      residencyStatus: form.residencyStatus || undefined,
      kycStatus: form.kycStatus || undefined,
      secondHolderFirstName: joint ? u(form.secondHolderFirstName) : undefined,
      secondHolderLastName: joint ? u(form.secondHolderLastName) : undefined,
      secondHolderOccupation: joint ? u(form.secondHolderOccupation) : undefined,
      secondHolderCompanyName: joint ? u(form.secondHolderCompanyName) : undefined,
      secondHolderBirthPlace: joint ? u(form.secondHolderBirthPlace) : undefined,
      secondHolderMotherName: joint ? u(form.secondHolderMotherName) : undefined,
      secondHolderMaritalStatus: joint ? u(form.secondHolderMaritalStatus) : undefined,
      rmId: form.rmId || undefined,
      // Only an individual nominates; for any other type no list is sent (and
      // the server never deletes nominees already on file).
      nominees: canNominate(type) && !form.nominationOptOut
        ? named(form.nominees, (n) => ({
            name: (n.name ?? "").trim(),
            relation: u(n.relation),
            dob: u(n.dob),
            mobile: u(n.mobile),
            pan: optPan(n.pan),
            sharePct: num(n.sharePct),
          }))
        : undefined,
      referrals: named(form.referrals, (r) => ({
        name: (r.name ?? "").trim(),
        relation: u(r.relation),
        mobile: u(r.mobile),
        email: u(r.email),
        note: u(r.note),
      })),
      onboardedAt: u(form.onboardedAt),
      anniversaryDate: isAdult ? u(form.anniversaryDate) : undefined,
      lastReviewAt: u(form.lastReviewAt),
      nextReviewAt: u(form.nextReviewAt),
      // The family's cadence is the family's to change (the API ignores it for a member).
      reviewFrequency: form._famReview ? undefined : form.reviewFrequency || undefined,
      notes: u(form.notes),
      // Edit-only fields — empty (hence undefined) on create, so they're omitted.
      alternatePhone: u(form.alternatePhone),
      status: form.status || undefined,
      // Clearing a recorded date sends null (the client becomes Active again; stopped SIPs stay stopped).
      dateOfDemise: form.dateOfDemise ? form.dateOfDemise : form._demiseWas ? null : undefined,
      // A minor's risk profile is the guardian's — never sent for a minor.
      riskProfile: minor ? undefined : form.riskProfile || undefined,
      mandateStatus: form.mandateStatus || undefined,
      mandateRefNo: u(form.mandateRefNo),
      nseCanCode: u(form.nseCanCode),
      nameAsPerPan: u(form.nameAsPerPan),
      panAadhaarLinkStatus: isAdult ? form.panAadhaarLinkStatus || undefined : undefined,
      ckycNumber: u(form.ckycNumber),
      kycValidatedAt: u(form.kycValidatedAt),
      bankAccounts: banks.length ? banks : undefined,
    };
  },

  editTitle: "Edit client",
  editRecordEnvelope: "investor",
  editInitial: (rec, params) => {
    const dstr = (v: any) => (v ? String(v).slice(0, 10) : "");
    const addr = rec.address ?? {};
    const td = rec.typeDetails ?? {};
    const type = rec.investorCategory ?? "individual";
    const nominees = rec.nominees?.length
      ? rec.nominees
      : rec.nomineeName
        ? [{ name: rec.nomineeName, relation: rec.nomineeRelation ?? "", dob: dstr(rec.nomineeDob) }]
        : [];
    const bankAccounts = rec.bankAccounts?.length
      ? rec.bankAccounts
      : rec.bankName
        ? [{ bankName: rec.bankName, accountMasked: rec.bankAccountNumberMasked ?? "", ifsc: rec.bankIfsc ?? "" }]
        : [];
    const pan = ownPan(rec.pan);
    return {
      _edit: "1",
      // The stored value is a registrar key (a minor under the guardian's PAN,
      // a client with no PAN on the feed), not a PAN: never sent back as one.
      _panLocked: rec.pan && !pan ? "1" : "",
      name: rec.name ?? "",
      pan,
      dob: dstr(rec.dob),
      gender: rec.gender ?? "",
      birthPlace: rec.birthPlace ?? "",
      motherName: rec.motherName ?? "",
      maritalStatus: rec.maritalStatus ?? "",
      occupation: rec.occupation ?? "",
      incomeRange: rec.incomeRange ?? "",
      employerName: rec.employerName ?? "",
      aadhaarLast4: rec.aadhaarLast4 ?? "",
      email: rec.email ?? "",
      emailRelation: rec.emailRelation ?? "",
      phone: rec.phone ?? "",
      mobileRelation: rec.mobileRelation ?? "",
      whatsappPhone: rec.whatsappPhone ?? "",
      alternatePhone: rec.alternatePhone ?? "",
      street: addr.line1 ?? "",
      city: addr.city ?? "",
      state: addr.state ?? "",
      pincode: addr.pincode ?? "",
      country: addr.country ?? "India",
      // The pincode on file is not looked up when the form opens.
      _pinWas: String(addr.pincode ?? "").trim(), _pinDone: "", _pinState: "", _useState: false,
      _famMember: params?.famMember === "1" ? "1" : "",
      _famReview: params?.famReview ?? "",
      _famName: params?.famName ?? "",
      householdType: rec.householdType ?? "",
      familyOwnerName: rec.familyOwnerName ?? "",
      investorCategory: type,
      _taxType: type,
      segmentTag: rec.segmentTag ?? "Retail",
      clientCategory: rec.clientCategory ?? "",
      referralClientName: rec.referralClientName ?? "",
      modeOfHolding: rec.modeOfHolding ?? "",
      bseUccCode: rec.bseUccCode ?? "",
      nseCanCode: rec.nseCanCode ?? "",
      taxStatus: rec.taxStatus ?? "",
      residencyStatus: rec.residencyStatus ?? "",
      kycStatus: rec.kycStatus ?? "pending",
      nameAsPerPan: rec.nameAsPerPan ?? "",
      panAadhaarLinkStatus: rec.panAadhaarLinkStatus ?? "",
      ckycNumber: rec.ckycNumber ?? "",
      kycValidatedAt: dstr(rec.kycValidatedAt),
      status: rec.status ?? "active",
      dateOfDemise: rec.dateOfDemise ? String(rec.dateOfDemise).slice(0, 10) : "",
      _demiseWas: rec.dateOfDemise ? "1" : "",
      riskProfile: rec.riskProfile ?? "",
      mandateStatus: rec.mandateStatus ?? "",
      mandateRefNo: rec.mandateRefNo ?? "",
      secondHolderFirstName: rec.secondHolderFirstName ?? "",
      secondHolderLastName: rec.secondHolderLastName ?? "",
      secondHolderOccupation: rec.secondHolderOccupation ?? "",
      secondHolderCompanyName: rec.secondHolderCompanyName ?? "",
      secondHolderBirthPlace: rec.secondHolderBirthPlace ?? "",
      secondHolderMotherName: rec.secondHolderMotherName ?? "",
      secondHolderMaritalStatus: rec.secondHolderMaritalStatus ?? "",
      nominees,
      nominationOptOut: !!td.nominationOptOut,
      referrals: rec.referrals ?? [],
      bankAccounts,
      rmId: rec.rmId ?? "",
      onboardedAt: dstr(rec.onboardedAt),
      anniversaryDate: dstr(rec.anniversaryDate),
      lastReviewAt: dstr(rec.lastReviewAt),
      nextReviewAt: dstr(rec.nextReviewAt),
      // A family member's cadence is the family's (next review is derived from it).
      reviewFrequency: params?.famReview || rec.reviewFrequency || "",
      // The next review on file is kept when the form opens; changing the last
      // date or the frequency re-derives it.
      _revKey: `${dstr(rec.lastReviewAt)}|${params?.famReview || rec.reviewFrequency || ""}`,
      notes: rec.notes ?? "",
      // The type's own details
      gName: td.guardian?.name ?? "", gPan: td.guardian?.pan ?? "", gRelation: td.guardian?.relation ?? "",
      gDob: dstr(td.guardian?.dob), gMobile: td.guardian?.mobile ?? "", gEmail: td.guardian?.email ?? "",
      guardianInvestorId: "",
      kName: td.karta?.name ?? "", kPan: td.karta?.pan ?? "", kDob: dstr(td.karta?.dob), kMobile: td.karta?.mobile ?? "", kEmail: td.karta?.email ?? "",
      coparceners: td.coparceners ?? [],
      eFormedOn: dstr(td.entity?.formedOn), eRegNo: td.entity?.registrationNo ?? "", ePlace: td.entity?.placeOfIncorporation ?? "",
      eNature: td.entity?.natureOfBusiness ?? "", eNetWorth: td.entity?.netWorth != null ? String(td.entity.netWorth) : "",
      eNetWorthAsOn: dstr(td.entity?.netWorthAsOn), eFatcaClass: td.entity?.fatcaClass ?? "", eGiin: td.entity?.giin ?? "",
      signatories: td.signatories ?? [],
      ubos: (td.ubos ?? []).map((o: any) => ({ ...o, holdingPct: o.holdingPct != null ? String(o.holdingPct) : "" })),
      nCountry: td.nri?.countryOfResidence ?? "", nOverseasAddress: td.nri?.overseasAddress ?? "", nTaxCountry: td.nri?.taxResidencyCountry ?? "",
      nForeignTin: td.nri?.foreignTin ?? "", nAccountType: td.nri?.accountType ?? "",
      businessName: td.businessName ?? "",
      _familyId: "",
    };
  },

  afterCreate: async (json, form, { router, params, post }) => {
    const familyId = params.familyId;
    if (familyId) {
      await post(`/api/families/${familyId}/members`, {
        investorId: json.id,
        familyRole: params.familyRole || undefined,
      });
      router.replace(`/m/families/${familyId}` as any);
    } else {
      router.replace(`/m/investors/${json.id}` as any);
    }
  },
};
