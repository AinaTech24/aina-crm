/**
 * Insurance fields a firm moving off Zoho kept per line (Investment Options,
 * 2026-11-24). Behind the per-firm flag `insuranceExtraFields`.
 *
 * A policy's extras live in `insurance_policies.details` and a claim's in
 * `insurance_claims.details` (migration 0285) — no new columns, so a firm
 * without the flag never sees or stores them. One list here drives the policy
 * form, the policy page, the claim form, the claim page and the Zoho importer,
 * so a key can never be written under one spelling and read under another
 * (the importer once wrote `chassisNumber` where the form reads `chassisNo`).
 *
 * Plain module — imported by server pages and "use client" forms alike.
 */

export const INSURANCE_EXTRA_FIELDS_FLAG = "insuranceExtraFields";

export type ExtraField = {
  key: string;
  label: string;
  type?: "text" | "number" | "date" | "select";
  options?: [string, string][];
  placeholder?: string;
  /** Takes a whole row of the grid. */
  wide?: boolean;
  /** Bound to a policy COLUMN the form already holds, not to details. */
  formKey?: "livesCovered";
};

export type ExtraTable = {
  key: string;
  label: string;
  columns: { key: string; label: string; width?: string }[];
};

export type ExtraBlock = { title: string; fields: ExtraField[]; tables?: ExtraTable[] };

const money = (key: string, label: string): ExtraField => ({ key, label: `${label} (₹)`, type: "number" });

/** On every policy: what Zoho kept beside the total premium. */
export const PAYMENT_BLOCK: ExtraBlock = {
  title: "Premium & payment",
  fields: [
    money("basicPremium", "Basic premium"),
    { key: "paymentMode", label: "Payment mode", placeholder: "Cheque / Online / UPI" },
    { key: "paymentDate", label: "Payment date", type: "date" },
  ],
};

const MOTOR: ExtraBlock = {
  title: "More motor details",
  fields: [
    { key: "vehicleType", label: "Vehicle type", placeholder: "Two wheeler / Private car" },
    { key: "ownedBy", label: "Vehicle owned by", type: "select", options: [["individual", "Individual"], ["company", "Company"]] },
    { key: "odTpTerm", label: "OD + TP term", placeholder: "1 (OD) + 5 (TP)" },
    money("paOwnerDriverPremium", "PA owner-driver premium"),
    money("llPaidDriverPremium", "LL to paid driver premium"),
    money("cngKitPremium", "CNG / LPG kit premium"),
  ],
};

const ACCIDENT: ExtraBlock = {
  title: "Accident cover",
  fields: [
    money("adSumInsured", "Accidental death sum insured"),
    { key: "adCb", label: "AD cumulative bonus", placeholder: "10% or ₹" },
    money("ptdSumInsured", "Permanent total disability SI"),
    { key: "ptdCb", label: "PTD cumulative bonus", placeholder: "10% or ₹" },
    money("ppdSumInsured", "Permanent partial disability SI"),
    { key: "ppdCb", label: "PPD cumulative bonus", placeholder: "10% or ₹" },
  ],
  tables: [
    {
      key: "coverList",
      label: "Optional covers",
      columns: [
        { key: "cover", label: "Cover" },
        { key: "sumInsured", label: "Sum insured (₹)", width: "w-36" },
      ],
    },
  ],
};

const WORKMEN: ExtraBlock = {
  title: "Workmen's compensation",
  fields: [
    { key: "livesCovered", label: "Employees covered", type: "number", formKey: "livesCovered" },
    money("medicalExpenseLimit", "Medical expense limit"),
  ],
};

const MARINE: ExtraBlock = {
  title: "Marine transit",
  fields: [
    {
      key: "transitMode",
      label: "Mode of transit",
      type: "select",
      options: [["road", "Road"], ["rail", "Rail"], ["sea", "Sea"], ["air", "Air"], ["multimodal", "Multimodal"]],
    },
  ],
};

const PROPERTY: ExtraBlock = {
  title: "Fire & property cover",
  fields: [
    { key: "fireCategory", label: "Category", placeholder: "Fire / CPP" },
    { key: "insuredAs", label: "Insured as", type: "select", options: [["individual", "Individual"], ["institution", "Institution"]] },
    { key: "propertyDescription", label: "Occupancy / property description", wide: true },
  ],
  tables: [
    {
      key: "itemCovers",
      label: "Item-wise covers",
      columns: [
        { key: "item", label: "Item", width: "w-44" },
        { key: "description", label: "Description" },
        { key: "sumInsured", label: "Sum insured (₹)", width: "w-36" },
      ],
    },
    {
      key: "addOnCovers",
      label: "Add-on covers",
      columns: [
        { key: "name", label: "Add-on" },
        { key: "uin", label: "UIN", width: "w-36" },
        { key: "sumInsured", label: "Sum insured (₹)", width: "w-36" },
      ],
    },
  ],
};

const TRAVEL: ExtraBlock = {
  title: "Trip length",
  fields: [{ key: "tripDays", label: "Trip days", type: "number" }],
};

/** Cyber and other general covers: the people on the policy. */
const GENERAL: ExtraBlock = {
  title: "Covered persons",
  fields: [],
  tables: [
    {
      key: "insuredMembers",
      label: "Covered persons",
      columns: [
        { key: "name", label: "Name" },
        { key: "relation", label: "Relation", width: "w-28" },
        { key: "dob", label: "DOB", width: "w-28" },
        { key: "gender", label: "Gender", width: "w-24" },
      ],
    },
  ],
};

/** The line's own block for a policy type, or null. */
export function extraBlockFor(policyType: string): ExtraBlock | null {
  switch (policyType) {
    case "motor": return MOTOR;
    case "personal_accident":
    case "group_personal_accident": return ACCIDENT;
    case "workmen_comp": return WORKMEN;
    case "marine": return MARINE;
    case "fire":
    case "home":
    case "burglary": return PROPERTY;
    case "travel": return TRAVEL;
    case "general_other": return GENERAL;
    default: return null;
  }
}

/** The premium column the health members table gains under the flag. */
export const MEMBER_PREMIUM_COLUMN = { key: "premium", label: "Premium (₹)", width: "w-28" };

// ── Policy page ──────────────────────────────────────────────────────────

/** Labels for the details keys the policy form already asks — the page shows them too. */
const FORM_DETAIL_LABELS: [string, string][] = [
  ["businessType", "Business type"],
  ["policyIssueDate", "Policy issue date"],
  ["previousInsurer", "Previous insurer"],
  ["previousPolicyNo", "Previous policy no."],
  ["vehicleRegNo", "Vehicle reg. no."],
  ["makeModel", "Make / model"],
  ["variant", "Variant"],
  ["fuelType", "Fuel type"],
  ["manufacturingYear", "Manufacturing year"],
  ["rtoLocation", "RTO location"],
  ["engineNo", "Engine no."],
  ["chassisNo", "Chassis no."],
  ["cubicCapacity", "CC"],
  ["seatingCapacity", "Seats"],
  ["coverType", "Cover type"],
  ["ncbPercent", "NCB %"],
  ["odPremium", "OD premium (₹)"],
  ["tpPremium", "TP premium (₹)"],
  ["financier", "Financier"],
  ["destination", "Destination"],
  ["tripStart", "Trip start"],
  ["tripEnd", "Trip end"],
  ["tripType", "Trip type"],
  ["propertyType", "Property type"],
  ["buildingValue", "Building value (₹)"],
  ["contentsValue", "Contents value (₹)"],
  ["roomRentCapInr", "Room-rent cap (₹)"],
  ["coPayPercent", "Co-pay %"],
  ["familyFloater", "Family floater"],
  ["agencyName", "Agency"],
  ["agencyCode", "Agency code"],
  ["grossPremium", "Gross premium (₹)"],
];

export type DetailLine = { label: string; value: string; type?: ExtraField["type"] };

const shown = (v: unknown) => v != null && v !== "" && !(Array.isArray(v) && v.length === 0) && typeof v !== "object";

/** Every filled, labelled details value of a policy, in form order, for its page. */
export function policyDetailLines(policyType: string, details: Record<string, unknown> | null | undefined): DetailLine[] {
  const d = details ?? {};
  const out: DetailLine[] = [];
  const seen = new Set<string>();
  const push = (key: string, label: string, type?: ExtraField["type"], options?: [string, string][]) => {
    if (seen.has(key)) return;
    seen.add(key);
    const v = d[key];
    if (!shown(v)) return;
    const value = typeof v === "boolean" ? (v ? "Yes" : "No") : options?.find(([k]) => k === String(v))?.[1] ?? String(v);
    out.push({ label, value, type });
  };
  for (const [k, l] of FORM_DETAIL_LABELS) push(k, l);
  const block = extraBlockFor(policyType);
  for (const f of [...(block?.fields ?? []), ...PAYMENT_BLOCK.fields]) if (!f.formKey) push(f.key, f.label, f.type, f.options);
  return out;
}

/** The tables a policy page shows: members, the line's own tables and the premium breakdown. */
export function policyDetailTables(policyType: string): ExtraTable[] {
  const block = extraBlockFor(policyType);
  const own = block?.tables ?? [];
  const members: ExtraTable = {
    key: "insuredMembers",
    label: "Insured persons",
    columns: [
      { key: "name", label: "Name" },
      { key: "relation", label: "Relation" },
      { key: "dob", label: "DOB" },
      { key: "gender", label: "Gender" },
      { key: "age", label: "Age" },
      { key: "sumInsured", label: "Sum insured (₹)" },
      { key: "premium", label: "Premium (₹)" },
    ],
  };
  const premium: ExtraTable = {
    key: "premiumBreakdown",
    label: "Premium details",
    columns: [
      { key: "description", label: "Description" },
      { key: "amount", label: "Amount (₹)" },
    ],
  };
  return [...(own.some((t) => t.key === "insuredMembers") ? [] : [members]), ...own, premium];
}

/** A table cell as text (TableEditor rows may hold `{ value }` objects). */
export const cellText = (v: unknown): string =>
  v == null ? "" : typeof v === "object" ? String((v as { value?: unknown }).value ?? "") : String(v);

// ── Claims ───────────────────────────────────────────────────────────────

export const CLAIM_EXTRA_FIELDS: ExtraField[] = [
  { key: "claimNo", label: "Claim no." },
  { key: "intimationNo", label: "Intimation no." },
  { key: "patientName", label: "Patient name" },
  { key: "hospitalName", label: "Hospital / garage" },
  { key: "doctorName", label: "Doctor" },
  { key: "diagnosis", label: "Diagnosis / loss", wide: true },
  { key: "dischargeDate", label: "Discharge date", type: "date" },
  { key: "processDate", label: "Processed on", type: "date" },
  { key: "paymentReceivedOn", label: "Payment (ECS) received on", type: "date" },
  money("deductionAmount", "Deduction"),
  { key: "intimatedBy", label: "Intimated by" },
  { key: "submittedBy", label: "Submitted / uploaded by" },
  { key: "hospitalVisitBy", label: "Hospital visit by" },
  { key: "followupCallBy", label: "Pre / post claim call by" },
  { key: "followupCallOn", label: "Pre / post claim call on", type: "date" },
];

export function claimDetailLines(details: Record<string, unknown> | null | undefined): DetailLine[] {
  const d = details ?? {};
  return CLAIM_EXTRA_FIELDS.filter((f) => shown(d[f.key])).map((f) => ({ label: f.label, value: String(d[f.key]), type: f.type }));
}

/** Keep only string / number / boolean / array-of-rows values — the shape a details form posts. */
export function cleanClaimDetails(d: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of CLAIM_EXTRA_FIELDS) {
    const v = d[f.key];
    if (v == null || v === "") continue;
    if (f.type === "number") {
      const n = Number(v);
      if (Number.isFinite(n)) out[f.key] = n;
    } else out[f.key] = String(v).slice(0, 2000);
  }
  return out;
}

/** A claim's stored details with the form's fields replaced by what it posted; other keys (the Zoho id) kept. */
export function mergeClaimDetails(before: unknown, posted: Record<string, unknown>): Record<string, unknown> {
  const kept: Record<string, unknown> = {};
  const own = new Set(CLAIM_EXTRA_FIELDS.map((f) => f.key));
  if (before && typeof before === "object" && !Array.isArray(before)) {
    for (const [k, v] of Object.entries(before as Record<string, unknown>)) if (!own.has(k)) kept[k] = v;
  }
  return { ...kept, ...cleanClaimDetails(posted) };
}
