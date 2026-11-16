/**
 * One row of a Zoho CRM "Contacts" export → what the CRM stores for that
 * client. Pure (no database), so the mapping is tested on its own
 * (tests/zoho-import.test.ts) and the preview and the import read every row
 * the same way.
 *
 * Decisions (We Care Freedom Wealth, 2026-11-14):
 *  - Contact Owner is the client's RM, matched to a CRM user by name or email.
 *  - Record Id is kept as the client's Zoho id (custom field), which is how a
 *    Zoho meeting finds its client and how a second run updates instead of
 *    duplicating.
 *  - Product columns hold Yes / No: Yes marks the product "Held with us" on the
 *    Cross-sell card, and each column is also kept as its own checkbox.
 *  - Columns with no CRM field become the firm's custom fields.
 *  - Zoho's money figures (investments, current value, AUM, SIP amount, folio
 *    count, XIRR) are NOT imported: AUM and SIPs come only from the registrar.
 */

import { CLIENT_TYPE_KEYS } from "@/lib/investors/client-types";
import { parseUccCell } from "@/lib/investors/ucc";
import type { RiskCategory } from "@/lib/risk-profile/apply";
import { ageOn, cell, email, isoDate, istMidnight, mobile, nameKey, pan, yesNo, zohoId } from "./values";

/** Headers that tell a Contacts export apart from anything else. */
export const CONTACT_SIGNATURE = ["Record Id", "Contact Owner", "Contact Name"];

/** A firm custom field this import creates (only when the file has a value for it). */
export type ZohoCustomField = { key: string; label: string; type: "text" | "checkbox" | "textarea"; column: string };

/** Product columns → their Cross-sell bucket. Each is also kept as a checkbox field. */
export const PRODUCT_COLUMNS: Array<{ column: string; crossSell: string; key: string }> = [
  { column: "PMS", crossSell: "pms", key: "cf_zoho_pms" },
  { column: "Demat Account", crossSell: "demat", key: "cf_zoho_demat_account" },
  { column: "SIP", crossSell: "mutual_funds", key: "cf_zoho_sip" },
  { column: "Lumpsum", crossSell: "mutual_funds", key: "cf_zoho_lumpsum" },
  { column: "Life Insurance", crossSell: "life_insurance", key: "cf_zoho_life_insurance" },
  { column: "ULIP", crossSell: "life_insurance", key: "cf_zoho_ulip" },
  { column: "Health Insurance", crossSell: "health_insurance", key: "cf_zoho_health_insurance" },
  { column: "Super Top Up", crossSell: "health_insurance", key: "cf_zoho_super_top_up" },
  { column: "Critical Illness", crossSell: "health_insurance", key: "cf_zoho_critical_illness" },
  { column: "Personal Accident", crossSell: "general_insurance", key: "cf_zoho_personal_accident" },
  { column: "Vehicle Insurance", crossSell: "general_insurance", key: "cf_zoho_vehicle_insurance" },
  { column: "Travel Insurance", crossSell: "general_insurance", key: "cf_zoho_travel_insurance" },
  { column: "Corporate Insurance", crossSell: "general_insurance", key: "cf_zoho_corporate_insurance" },
];

/** Text columns kept as custom fields as they are. */
const TEXT_FIELDS: Array<[column: string, key: string, label: string]> = [
  ["Lead Source", "cf_zoho_lead_source", "Lead Source"],
  ["Tag", "cf_zoho_tag", "Tag"],
  ["IIFL Account", "cf_zoho_iifl_account", "IIFL Account"],
  ["SISO", "cf_zoho_siso", "SISO"],
  ["TIN Number", "cf_zoho_tin_number", "TIN Number"],
  ["Is Tin Number Updated?", "cf_zoho_tin_updated", "Is TIN Number Updated?"],
  ["Goal GPS", "cf_zoho_goal_gps", "Goal GPS"],
  ["Model Portfolio", "cf_zoho_model_portfolio", "Model Portfolio"],
  ["FHP Qualified", "cf_zoho_fhp_qualified", "FHP Qualified"],
  ["File/Email", "cf_zoho_file_email", "File / Email"],
  ["Serial No.", "cf_zoho_serial_no", "Serial No."],
  ["Added By", "cf_zoho_added_by", "Added By (Zoho)"],
  ["If Nominee Minor, Guardian Name", "cf_zoho_nominee_guardian", "Nominee's Guardian (if minor)"],
];

/** The Zoho id field — always created; it links meetings and re-runs. */
export const ZOHO_ID_FIELD: ZohoCustomField = { key: "cf_zoho_record_id", label: "Zoho Record ID", type: "text", column: "Record Id" };

/** Every custom field the import may create, in display order. */
export const CONTACT_CUSTOM_FIELDS: ZohoCustomField[] = [
  ZOHO_ID_FIELD,
  ...TEXT_FIELDS.map(([column, key, label]) => ({ key, label, type: "text" as const, column })),
  // Kept only when the value is not one the CRM field understands.
  { key: "cf_zoho_risk_profile", label: "Risk Profile (Zoho)", type: "text", column: "Risk Profile" },
  { key: "cf_zoho_client_category", label: "Client Category (Zoho)", type: "text", column: "Client Category" },
  { key: "cf_zoho_review_type", label: "Review Type (Zoho)", type: "text", column: "Review Type" },
  { key: "cf_zoho_guardian_name", label: "Guardian Name (Zoho)", type: "text", column: "Guardian Name" },
  { key: "cf_zoho_family_or_individual", label: "Family or Individual (Zoho)", type: "text", column: "Family or Individual" },
  ...PRODUCT_COLUMNS.map((p) => ({ key: p.key, label: p.column, type: "checkbox" as const, column: p.column })),
];

/** Zoho columns deliberately left out, with the reason the preview shows. */
export const IGNORED_CONTACT_COLUMNS: Record<string, string> = {
  "Total Investments": "Money figures come from the registrar feeds",
  "Total Current Value": "Money figures come from the registrar feeds",
  "Family AUM": "Money figures come from the registrar feeds",
  "Monthly SIP": "Money figures come from the registrar feeds",
  "Number of SIP": "Money figures come from the registrar feeds",
  "Number of active Folios": "Money figures come from the registrar feeds",
  "Total XIRR": "Money figures come from the registrar feeds",
  "Age in Yrs": "Worked out from the date of birth",
  "Month of Birth": "Worked out from the date of birth",
  Currency: "Not used",
  "Last Activity Time": "Zoho housekeeping",
  "Connected To.module": "Zoho housekeeping",
  "Connected To.id": "Zoho housekeeping",
  Salutation: "Used only to set gender",
};

export type MappedContact = {
  zohoId: string;
  ownerText: string;
  name: string;
  pan: string | null;
  email: string | null;
  phone: string | null;
  dob: string | null;
  gender: "M" | "F" | null;
  occupation: string | null;
  employerName: string | null;
  aadhaarLast4: string | null;
  address: { line1: string; city: string; state: string; pincode: string; country: string };
  onboardedAt: Date | null;
  lastReviewAt: Date | null;
  nextReviewAt: Date | null;
  reviewFrequency: "monthly" | "quarterly" | "half_yearly" | "annual" | null;
  clientCategory: "A" | "B" | "C" | "D" | null;
  segmentTag: "HNI" | "Affluent" | "Retail" | "NRI" | "Corporate" | null;
  householdType: string | null;
  investorCategory: (typeof CLIENT_TYPE_KEYS)[number] | null;
  isMinor: boolean;
  guardianName: string | null;
  riskProfile: RiskCategory | null;
  uccCodes: string[];
  nominee: { name: string; relation?: string; dob?: string } | null;
  notes: string | null;
  /** Products marked Yes → their Cross-sell bucket (held_with_us). */
  crossSell: Record<string, "held_with_us">;
  /** Values for the firm's custom fields (keys from CONTACT_CUSTOM_FIELDS). */
  custom: Record<string, string | boolean>;
  familyOwnerZohoId: string;
  familyOwnerName: string;
  referralZohoId: string;
  referralName: string;
  /** Things the preview should tell the user about this row. */
  warnings: string[];
};

const RISK_SYNONYMS: Array<[RegExp, RiskCategory]> = [
  [/^(very\s*(aggressive|high)|highly\s*aggressive|very_aggressive)$/i, "very_aggressive"],
  [/^(aggressive|high|growth)$/i, "aggressive"],
  [/^(moderate|medium|balanced)$/i, "moderate"],
  [/^(conservative|low|safe)$/i, "conservative"],
];

/** A Zoho risk-profile text the CRM's four categories cover, else null (the text is kept as-is). */
export function riskFromZoho(v: string): RiskCategory | null {
  const s = v.trim();
  for (const [re, cat] of RISK_SYNONYMS) if (re.test(s)) return cat;
  return null;
}

/** "Quarterly", "Half Yearly", "Yearly" … → the CRM's review frequency. */
export function reviewFrequencyFromZoho(v: string): MappedContact["reviewFrequency"] {
  const s = v.toLowerCase().replace(/[^a-z]/g, "");
  if (!s) return null;
  if (s.startsWith("month")) return "monthly";
  if (s.startsWith("quarter")) return "quarterly";
  if (s.startsWith("half") || s.startsWith("semi") || s.includes("sixmonth")) return "half_yearly";
  if (s.startsWith("annual") || s.startsWith("year")) return "annual";
  return null;
}

function genderFromSalutation(v: string): "M" | "F" | null {
  const s = v.toLowerCase().replace(/[^a-z]/g, "");
  if (s === "mr" || s === "master") return "M";
  if (s === "mrs" || s === "ms" || s === "miss") return "F";
  return null;
}

function clean(v: unknown): string | null {
  const s = cell(v);
  return s ? s.slice(0, 2000) : null;
}

/** Map one Contacts row. `now` decides who is a minor. */
export function mapZohoContact(row: Record<string, unknown>, now: Date = new Date()): MappedContact {
  const g = (col: string) => cell(row[col]);
  const warnings: string[] = [];

  const rawPan = g("Pan Card No");
  const p = pan(rawPan);
  if (rawPan && !p) warnings.push(`PAN "${rawPan}" is not a valid PAN — left blank`);
  const rawEmail = g("Email");
  const e = email(rawEmail);
  if (rawEmail && !e) warnings.push(`Email "${rawEmail}" is not valid — left blank`);

  const salutation = g("Salutation");
  const name = g("Contact Name").replace(/\s+/g, " ");
  const dob = isoDate(row["Date of Birth"]);
  const aadhaarDigits = g("Adhaar Card").replace(/\.0+$/, "").replace(/\D/g, "");

  // Guardian Name on a client under 18 makes them a Minor (held through a guardian).
  const guardianName = g("Guardian Name") || null;
  const isMinor = !!(guardianName && dob && ageOn(dob, now) < 18);

  // Client category: A–D is the CRM's own grade, HNI / Affluent / … its segment.
  const catRaw = g("Client Category");
  const grade = /^[abcd]$/i.test(catRaw) ? (catRaw.toUpperCase() as "A" | "B" | "C" | "D") : null;
  const segments = ["HNI", "Affluent", "Retail", "NRI", "Corporate"] as const;
  const segment = segments.find((s) => s.toLowerCase() === catRaw.toLowerCase()) ?? null;

  const riskRaw = g("Risk Profile");
  const risk = riskRaw ? riskFromZoho(riskRaw) : null;
  const reviewRaw = g("Review Type");
  const reviewFrequency = reviewFrequencyFromZoho(reviewRaw);

  const famType = g("Family or Individual");
  const householdType = /^fam/i.test(famType) ? "Family" : /^ind/i.test(famType) ? "Individual" : /^huf$/i.test(famType) ? "HUF" : /^(com|corp)/i.test(famType) ? "Company" : null;

  const custom: Record<string, string | boolean> = {};
  const id = zohoId(row["Record Id"]);
  if (id) custom[ZOHO_ID_FIELD.key] = id;
  for (const [column, key] of TEXT_FIELDS) {
    const v = clean(row[column]);
    if (v) custom[key] = v;
  }
  if (famType && !householdType) custom.cf_zoho_family_or_individual = famType;
  if (riskRaw && !risk) custom.cf_zoho_risk_profile = riskRaw;
  if (catRaw && !grade && !segment) custom.cf_zoho_client_category = catRaw;
  if (reviewRaw && !reviewFrequency) custom.cf_zoho_review_type = reviewRaw;
  if (guardianName && !isMinor) custom.cf_zoho_guardian_name = guardianName;

  const crossSell: Record<string, "held_with_us"> = {};
  for (const prod of PRODUCT_COLUMNS) {
    const yn = yesNo(row[prod.column]);
    if (yn === true) {
      crossSell[prod.crossSell] = "held_with_us";
      custom[prod.key] = true;
    } else if (yn === null && g(prod.column)) {
      warnings.push(`${prod.column}: "${g(prod.column)}" is not Yes / No — left blank`);
    }
  }

  // Only individuals nominate (the firm's rule) — a minor keeps no nominee.
  const nomineeName = g("Nominee Details");
  const nominee = nomineeName && !isMinor
    ? { name: nomineeName.slice(0, 200), relation: g("Nominee Relation") || undefined, dob: isoDate(row["Nominee Date of Birth"]) ?? undefined }
    : null;
  if (nomineeName && isMinor) warnings.push("Minor client — nominee not recorded (only individuals nominate)");

  const city = g("Mailing City") || g("Other City");
  const notes = clean(row["Description"]);

  return {
    zohoId: id,
    ownerText: g("Contact Owner"),
    name,
    pan: p || null,
    email: e || null,
    phone: mobile(row["Mobile"]) || null,
    dob,
    gender: genderFromSalutation(salutation),
    occupation: clean(row["Profession"]),
    employerName: clean(row["Company Name"]),
    aadhaarLast4: aadhaarDigits.length >= 4 ? aadhaarDigits.slice(-4) : null,
    address: {
      line1: g("Mailing Street"),
      city,
      state: g("Mailing State"),
      pincode: g("Mailing Zip").replace(/\.0+$/, ""),
      country: g("Mailing Country") || "India",
    },
    onboardedAt: istMidnight(row["Date of Onboarding"]),
    lastReviewAt: istMidnight(row["Last Meeting Date"]),
    nextReviewAt: istMidnight(row["Next Meeting Date"]),
    reviewFrequency,
    clientCategory: grade,
    segmentTag: segment,
    householdType,
    investorCategory: isMinor ? "minor" : null,
    isMinor,
    guardianName: isMinor ? guardianName : null,
    riskProfile: risk,
    uccCodes: parseUccCell(g("CAN/IIN No")),
    nominee,
    notes,
    crossSell,
    custom,
    familyOwnerZohoId: zohoId(row["Family Owner.id"]),
    familyOwnerName: g("Family Owner"),
    referralZohoId: zohoId(row["Referal Client Name.id"]),
    referralName: g("Referal Client Name"),
    warnings,
  };
}

/** Does the user resolve a Zoho owner / host cell? Name (any case, spacing, dots) or email. */
export function ownerKey(v: string): string {
  return v.includes("@") ? v.trim().toLowerCase() : nameKey(v);
}
